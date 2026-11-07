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
    const supportedEvents = new Set([
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'payment_intent.canceled',
      'payment_intent.processing',
    ]);

    if (!supportedEvents.has(event.type)) {
      return;
    }

    const eventIntent = event.data.object as Stripe.PaymentIntent;

    const testId = eventIntent.metadata?.testId;
    const paymentId = eventIntent.metadata?.paymentId;

    if (!testId || !paymentId) {
      throw new ConflictException('Métadonnées Stripe manquantes');
    }

    // Pour les événements non définitifs, récupérer
    // le statut courant auprès de Stripe afin de ne
    // pas réappliquer un ancien statut.
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
        // Sérialise les traitements liés au même test.
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${testId}::text)
          )
        `;

        // Idempotence des événements Stripe.
        const existingEvent = await tx.webhookEvent.findUnique({
          where: {
            provider_providerEventId: {
              provider: PaymentProvider.STRIPE,
              providerEventId: event.id,
            },
          },
        });

        if (existingEvent?.processedAt) {
          return;
        }

        const payment = await tx.payment.findUnique({
          where: {
            id: paymentId,
          },
          include: {
            test: true,
          },
        });

        if (!payment) {
          throw new ConflictException('Paiement introuvable pour ce webhook');
        }

        // Vérification de l'identité du paiement.
        if (payment.provider !== PaymentProvider.STRIPE || payment.testId !== testId) {
          throw new ConflictException('Webhook associé à un paiement incorrect');
        }

        // Vérification du montant et de la devise Stripe.
        if (
          payment.currency.toLowerCase() !== eventIntent.currency ||
          payment.amount !== BigInt(eventIntent.amount) ||
          payment.test.currency !== payment.currency
        ) {
          throw new ConflictException('Montant ou devise Stripe incohérent');
        }

        // Vérification de la référence Stripe.
        if (payment.providerReference !== null && payment.providerReference !== eventIntent.id) {
          throw new ConflictException('Référence PaymentIntent incohérente');
        }

        // Vérification de la décomposition financière.
        //
        // Test.totalAmount :
        //   récompense + commission TRUEBOND
        //
        // Payment.amount :
        //   Test.totalAmount + frais opérateur
        if (
          payment.serviceFeeAmount !== payment.test.serviceFeeAmount ||
          payment.amount !== payment.test.totalAmount + payment.providerFeeAmount ||
          payment.providerFeeAmount < 0n ||
          payment.serviceFeeAmount < 0n
        ) {
          throw new ConflictException('Décomposition financière du paiement incohérente');
        }

        // Vérifier qu'un tarif opérateur a bien été
        // enregistré lors de la réservation du paiement.
        if (!payment.feeScheduleId) {
          throw new ConflictException('Tarif opérateur absent du paiement');
        }

        // Vérifier que le tarif enregistré correspond
        // bien à Stripe et à une opération COLLECTION.
        // Il n'a pas besoin d'être encore actif :
        // le paiement conserve le tarif de sa création.
        const feeSchedule = await tx.feeSchedule.findUnique({
          where: {
            id: payment.feeScheduleId,
          },
        });

        if (
          !feeSchedule ||
          feeSchedule.provider !== PaymentProvider.STRIPE ||
          feeSchedule.operationType !== 'COLLECTION' ||
          feeSchedule.currency !== payment.currency
        ) {
          throw new ConflictException('Tarif COLLECTION Stripe incohérent');
        }

        // Rattacher la référence Stripe si elle n'avait
        // pas encore été enregistrée (webhook rapide).
        if (!payment.providerReference) {
          await tx.payment.update({
            where: {
              id: paymentId,
            },
            data: {
              providerReference: eventIntent.id,
            },
          });
        }

        // Enregistrer l'événement avant son traitement.
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

        // ==========================================
        // PAIEMENT CONFIRMÉ
        // ==========================================
        if (event.type === 'payment_intent.succeeded') {
          if (!alreadySucceeded) {
            // Ne jamais transformer en succès un paiement
            // localement annulé sans vérification manuelle.
            if (payment.status === PaymentStatus.CANCELLED) {
              throw new ConflictException('Paiement annulé localement mais confirmé par Stripe');
            }

            await tx.payment.update({
              where: {
                id: paymentId,
              },
              data: {
                status: PaymentStatus.SUCCEEDED,
                confirmedAt: new Date(),
                failureCode: null,
                failureMessage: null,

                // Les frais réels Stripe ne sont pas
                // connus par ce seul événement.
                // providerFeeActualAmount reste inchangé.
              },
            });
          }

          // Transition autorisée uniquement depuis
          // DRAFT ou PAYMENT_PENDING.
          const updated = await tx.test.updateMany({
            where: {
              id: testId,
              status: {
                in: [TestStatus.DRAFT, TestStatus.PAYMENT_PENDING],
              },
            },
            data: {
              status: TestStatus.FUNDED,
              version: {
                increment: 1,
              },
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

            // Événement métier pour le traitement
            // asynchrone après financement du test.
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
        }

        // ==========================================
        // AUTRES STATUTS STRIPE
        // ==========================================
        else if (!alreadySucceeded) {
          const canUpdate =
            payment.test.status === TestStatus.DRAFT ||
            payment.test.status === TestStatus.PAYMENT_PENDING;

          if (canUpdate) {
            if (currentIntent.status === 'canceled') {
              await tx.payment.update({
                where: {
                  id: paymentId,
                },
                data: {
                  status: PaymentStatus.CANCELLED,
                },
              });
            } else if (currentIntent.status === 'processing') {
              if (payment.status !== PaymentStatus.CANCELLED) {
                await tx.payment.update({
                  where: {
                    id: paymentId,
                  },
                  data: {
                    status: PaymentStatus.PENDING,
                  },
                });
              }
            } else if (currentIntent.status === 'requires_payment_method') {
              if (payment.status !== PaymentStatus.CANCELLED) {
                await tx.payment.update({
                  where: {
                    id: paymentId,
                  },
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

        // Marquer le webhook comme traité.
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
