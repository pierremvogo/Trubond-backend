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
import { PaymentFeeService } from './payment-fee.service';
import { StripeService } from './stripe.service';

@Injectable()
export class StripePaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly paymentFees: PaymentFeeService,
  ) {}

  async createPaymentIntent(userId: string, testId: string) {
    // Prélecture : utile pour calculer le devis sans
    // effectuer d'appel Stripe dans une transaction DB.
    const initialTest = await this.prisma.test.findFirst({
      where: { id: testId, initiatorId: userId },
      select: {
        id: true,
        currency: true,
        totalAmount: true,
        initiator: {
          select: { countryCode: true },
        },
      },
    });

    if (!initialTest) {
      throw new NotFoundException('Test introuvable');
    }

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
            currency: true,
            totalAmount: true,
            serviceFeeAmount: true,
            initiator: {
              select: { countryCode: true },
            },
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

        let payment = latest;

        if (!payment || payment.status === PaymentStatus.CANCELLED) {
          // Le tarif est lu dans la même transaction.
          // Il doit être actif et applicable à Stripe.
          const now = new Date();

          const schedule = await tx.feeSchedule.findFirst({
            where: {
              countryCode: test.initiator.countryCode,
              currency: test.currency,
              provider: PaymentProvider.STRIPE,
              operationType: 'COLLECTION',
              active: true,
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
            },
            orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
          });

          if (!schedule) {
            throw new ConflictException('Aucun tarif COLLECTION Stripe actif pour ce pays');
          }

          // Calcul exact avec BigInt.
          // Hypothèse : les frais sont prélevés
          // sur le montant total encaissé.
          const rate = BigInt(schedule.rateBps);
          const fixed = schedule.fixedAmount;

          if (fixed < 0n || rate < 0n || rate >= 10000n) {
            throw new ConflictException('Tarif opérateur invalide');
          }

          const numerator = (test.totalAmount + fixed) * 10000n;

          const denominator = 10000n - rate;

          const total = (numerator + denominator - 1n) / denominator;

          const operatorFee = total - test.totalAmount;

          if (total <= 0n || total > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new ConflictException('Montant Stripe invalide');
          }

          payment = await tx.payment.create({
            data: {
              testId,
              provider: PaymentProvider.STRIPE,
              methodType: PaymentMethodType.CARD,
              status: PaymentStatus.CREATED,
              amount: total,
              currency: test.currency,
              idempotencyKey: `tb-${randomUUID()}`,
              feeScheduleId: schedule.id,
              providerFeeAmount: operatorFee,
              providerFeeActualAmount: null,
              serviceFeeAmount: test.serviceFeeAmount,
            },
          });
        }

        // Un devis déjà réservé ne doit pas être
        // recalculé à partir du tarif du jour.
        if (
          payment.currency !== test.currency ||
          payment.serviceFeeAmount !== test.serviceFeeAmount ||
          payment.amount !== test.totalAmount + payment.providerFeeAmount
        ) {
          throw new ConflictException('Montants du paiement incohérents');
        }

        const amount = Number(payment.amount);

        if (!Number.isSafeInteger(amount) || amount <= 0) {
          throw new ConflictException('Montant de paiement invalide');
        }

        return { test, payment, amount };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );

    const { test, payment, amount } = reservation;

    // Appel réseau hors transaction PostgreSQL.
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
      amount: payment.amount.toString(),
      currency: payment.currency,
      rewardAmount: (test.totalAmount - test.serviceFeeAmount).toString(),
      serviceFeeAmount: payment.serviceFeeAmount.toString(),
      providerFeeAmount: payment.providerFeeAmount.toString(),
    };
  }
}
