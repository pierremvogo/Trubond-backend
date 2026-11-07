import { ConflictException, Injectable } from '@nestjs/common';
import { PaymentProvider, PaymentStatus, Prisma, TestActorType, TestStatus } from '@prisma/client';
import Stripe from 'stripe';

import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';

@Injectable()
export class StripeWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  async process(event: Stripe.Event): Promise<void> {
    const supported = new Set([
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'payment_intent.canceled',
      'payment_intent.processing',
    ]);

    if (!supported.has(event.type)) return;

    const eventIntent = event.data.object as Stripe.PaymentIntent;

    const testId = eventIntent.metadata?.testId;
    const paymentId = eventIntent.metadata?.paymentId;

    // Les événements sans nos métadonnées
    // ne concernent pas les paiements TRUEBOND.
    if (!testId || !paymentId) return;

    // Pour les événements non définitifs, vérifier
    // le statut courant chez Stripe.
    // Cela évite de traiter un ancien "processing"
    // comme si c'était encore l'état actuel.
    const currentIntent =
      event.type === 'payment_intent.succeeded'
        ? eventIntent
        : await this.stripe.client.paymentIntents.retrieve(eventIntent.id);

    if (
      currentIntent.id !== eventIntent.id ||
      currentIntent.metadata.testId !== testId ||
      currentIntent.metadata.paymentId !== paymentId
    ) {
      throw new ConflictException('Métadonnées Stripe incohérentes');
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${testId}::text)
          )
        `;

        const existingEvent = await tx.webhookEvent.findUnique({
          where: {
            provider_providerEventId: {
              provider: PaymentProvider.STRIPE,
              providerEventId: event.id,
            },
          },
        });

        if (existingEvent?.processedAt) return;

        const payment = await tx.payment.findUnique({
          where: { id: paymentId },
          include: { test: true },
        });

        if (
          !payment ||
          payment.provider !== PaymentProvider.STRIPE ||
          payment.testId !== testId ||
          payment.currency.toLowerCase() !== eventIntent.currency ||
          payment.amount !== BigInt(eventIntent.amount) ||
          payment.test.currency !== payment.currency ||
          (payment.providerReference !== null && payment.providerReference !== eventIntent.id)
        ) {
          throw new ConflictException('Événement Stripe incohérent avec le paiement');
        }

        // En cas de webhook reçu avant la réponse
        // de createPaymentIntent(), la référence peut
        // encore être null. Le verrou protège son écriture.
        if (!payment.providerReference) {
          await tx.payment.update({
            where: { id: paymentId },
            data: {
              providerReference: eventIntent.id,
            },
          });
        }

        if (!existingEvent) {
          await tx.webhookEvent.create({
            data: {
              provider: PaymentProvider.STRIPE,
              providerEventId: event.id,
              eventType: event.type,
              signatureVerified: true,
              paymentId,
            },
          });
        }

        const alreadySucceeded = payment.status === PaymentStatus.SUCCEEDED;

        if (event.type === 'payment_intent.succeeded') {
          if (!alreadySucceeded) {
            await tx.payment.update({
              where: { id: paymentId },
              data: {
                status: PaymentStatus.SUCCEEDED,
                confirmedAt: new Date(),
                failureCode: null,
                failureMessage: null,
              },
            });
          }

          const updated = await tx.test.updateMany({
            where: {
              id: testId,
              status: {
                in: [TestStatus.DRAFT, TestStatus.PAYMENT_PENDING],
              },
            },
            data: {
              status: TestStatus.FUNDED,
              version: { increment: 1 },
            },
          });

          if (updated.count === 1) {
            await tx.testEvent.create({
              data: {
                testId,
                fromStatus: payment.test.status,
                toStatus: TestStatus.FUNDED,
                actorType: TestActorType.SYSTEM,
                source: 'stripe.webhook',
                correlationId: event.id,
                reason: 'Paiement confirmé par Stripe',
              },
            });

            await tx.outboxEvent.create({
              data: {
                eventType: 'test.funded',
                aggregateType: 'Test',
                aggregateId: testId,
                dedupeKey: `test-funded-${testId}`,
                payload: {
                  testId,
                  paymentId,
                },
              },
            });
          }
        } else if (!alreadySucceeded) {
          // Si Stripe indique déjà "succeeded",
          // attendre son événement de confirmation.
          // Ne jamais régresser un test financé.
          const canUpdate =
            payment.test.status === TestStatus.DRAFT ||
            payment.test.status === TestStatus.PAYMENT_PENDING;

          if (canUpdate) {
            if (currentIntent.status === 'canceled') {
              await tx.payment.update({
                where: { id: paymentId },
                data: {
                  status: PaymentStatus.CANCELLED,
                },
              });
            } else if (currentIntent.status === 'processing') {
              if (payment.status !== PaymentStatus.CANCELLED) {
                await tx.payment.update({
                  where: { id: paymentId },
                  data: {
                    status: PaymentStatus.PENDING,
                  },
                });
              }
            } else if (currentIntent.status === 'requires_payment_method') {
              if (payment.status !== PaymentStatus.CANCELLED) {
                await tx.payment.update({
                  where: { id: paymentId },
                  data: {
                    status: PaymentStatus.FAILED,
                    failureCode: currentIntent.last_payment_error?.code ?? null,
                    failureMessage: null,
                  },
                });
              }
            }
          }
        }

        await tx.webhookEvent.update({
          where: {
            provider_providerEventId: {
              provider: PaymentProvider.STRIPE,
              providerEventId: event.id,
            },
          },
          data: {
            processedAt: new Date(),
            processingError: null,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }
}
