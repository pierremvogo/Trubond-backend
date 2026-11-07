import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PaymentMethodType,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  TestActorType,
  TestStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';

@Injectable()
export class StripePaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  async createPaymentIntent(userId: string, testId: string) {
    // Réserver une tentative sous verrou PostgreSQL.
    // Les webhooks utiliseront le même verrou par test.
    const reservation = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${testId}::text)
          )
        `;

        const test = await tx.test.findFirst({
          where: { id: testId, initiatorId: userId },
          select: {
            id: true,
            status: true,
            totalAmount: true,
            currency: true,
          },
        });

        if (!test) {
          throw new NotFoundException('Test introuvable');
        }

        if (test.status !== TestStatus.DRAFT && test.status !== TestStatus.PAYMENT_PENDING) {
          throw new ConflictException('Ce test ne peut plus être payé');
        }

        if (test.currency !== 'XAF') {
          throw new ConflictException('Devise non prise en charge');
        }

        const amount = Number(test.totalAmount);

        if (!Number.isSafeInteger(amount) || amount <= 0) {
          throw new ConflictException('Montant de paiement invalide');
        }

        const latest = await tx.payment.findFirst({
          where: {
            testId,
            provider: PaymentProvider.STRIPE,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });

        if (latest?.status === PaymentStatus.SUCCEEDED) {
          throw new ConflictException('Paiement déjà confirmé');
        }

        // Une tentative annulée définitivement peut
        // être remplacée par une nouvelle tentative.
        // Les autres sont reprises.
        const payment =
          latest && latest.status !== PaymentStatus.CANCELLED
            ? latest
            : await tx.payment.create({
                data: {
                  testId,
                  provider: PaymentProvider.STRIPE,
                  methodType: PaymentMethodType.CARD,
                  status: PaymentStatus.CREATED,
                  amount: test.totalAmount,
                  currency: test.currency,
                  idempotencyKey: `tb-${randomUUID()}`,
                },
              });

        if (payment.amount !== test.totalAmount || payment.currency !== test.currency) {
          throw new ConflictException('Montant enregistré incohérent');
        }

        return { test, payment, amount };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );

    const { test, payment, amount } = reservation;

    // Aucun appel réseau Stripe dans la transaction DB.
    const intent = payment.providerReference
      ? await this.stripe.client.paymentIntents.retrieve(payment.providerReference)
      : await this.stripe.client.paymentIntents.create(
          {
            amount,
            currency: 'xaf',
            automatic_payment_methods: {
              enabled: true,
            },
            metadata: {
              testId: test.id,
              paymentId: payment.id,
            },
          },
          {
            idempotencyKey: payment.idempotencyKey,
          },
        );

    if (
      intent.amount !== amount ||
      intent.currency.toUpperCase() !== test.currency ||
      intent.metadata.testId !== test.id ||
      intent.metadata.paymentId !== payment.id
    ) {
      throw new ConflictException('PaymentIntent Stripe incohérent');
    }

    if (intent.status === 'succeeded' || intent.status === 'canceled') {
      // Ne pas présenter un PaymentIntent terminé.
      // Un webhook peut encore être en cours.
      throw new ConflictException('PaymentIntent terminé. Actualisez le statut du test.');
    }

    if (!intent.client_secret) {
      throw new ServiceUnavailableException('Stripe n’a pas retourné de clientSecret');
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${testId}::text)
          )
        `;

        const currentTest = await tx.test.findUnique({
          where: { id: testId },
          select: { status: true },
        });

        const currentPayment = await tx.payment.findUnique({
          where: { id: payment.id },
        });

        if (!currentTest || !currentPayment) {
          throw new NotFoundException('Test ou paiement introuvable');
        }

        if (
          currentTest.status !== TestStatus.DRAFT &&
          currentTest.status !== TestStatus.PAYMENT_PENDING
        ) {
          throw new ConflictException('Le test a changé de statut');
        }

        if (
          currentPayment.status === PaymentStatus.SUCCEEDED ||
          currentPayment.status === PaymentStatus.CANCELLED
        ) {
          throw new ConflictException('Le paiement a changé de statut');
        }

        if (currentPayment.providerReference && currentPayment.providerReference !== intent.id) {
          throw new ConflictException('Référence Stripe incohérente');
        }

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            providerReference: intent.id,
            // Une erreur de paiement antérieure
            // n'empêche pas de réessayer le même intent.
            status: PaymentStatus.PENDING,
          },
        });

        if (currentTest.status === TestStatus.DRAFT) {
          const updated = await tx.test.updateMany({
            where: {
              id: testId,
              status: TestStatus.DRAFT,
            },
            data: {
              status: TestStatus.PAYMENT_PENDING,
              version: { increment: 1 },
            },
          });

          if (updated.count === 1) {
            await tx.testEvent.create({
              data: {
                testId,
                fromStatus: TestStatus.DRAFT,
                toStatus: TestStatus.PAYMENT_PENDING,
                actorType: TestActorType.USER,
                actorId: userId,
                source: 'stripe.payment_intent',
                reason: 'Paiement Stripe initialisé',
              },
            });
          }
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );

    return {
      testId,
      paymentId: payment.id,
      clientSecret: intent.client_secret,
      amount: test.totalAmount.toString(),
      currency: test.currency,
    };
  }
}
