import { Injectable, Logger } from '@nestjs/common';
import {
  InvitationStatus,
  NotificationStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  RefundStatus,
  TestActorType,
  TestStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TestExpirationService {
  private readonly logger = new Logger(TestExpirationService.name);

  // Durée de secours pour les anciennes invitations sans expiresAt.
  private readonly validityMs = 60 * 60 * 1000;

  private readonly activeStatuses: InvitationStatus[] = [
    InvitationStatus.CREATED,
    InvitationStatus.QUEUED,
    InvitationStatus.SENT,
    InvitationStatus.DELIVERED,
    InvitationStatus.OPENED,
  ];

  constructor(private readonly prisma: PrismaService) {}

  async processExpiredInvitations(limit = 50): Promise<{
    inspected: number;
    expired: number;
    skipped: number;
  }> {
    const now = new Date();

    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 50;

    // La première invitation détermine l'échéance du test.
    // On recherche les candidats dont une invitation est expirée,
    // puis on vérifie la première invitation sous verrou.
    const targetTestId = process.env.TEST_EXPIRATION_TARGET_TEST_ID?.trim();

    if (!targetTestId) {
      this.logger.warn('Expiration suspendue : aucun test cible configuré');

      return {
        inspected: 0,
        expired: 0,
        skipped: 0,
      };
    }

    const candidates = await this.prisma.test.findMany({
      where: {
        id: targetTestId,

        status: {
          in: [TestStatus.FUNDED, TestStatus.SENT],
        },
        attempt: null,
        invitations: {
          some: {
            OR: [
              {
                expiresAt: {
                  lte: now,
                },
              },
              {
                expiresAt: null,
                createdAt: {
                  lte: new Date(now.getTime() - this.validityMs),
                },
              },
            ],
          },
        },
        payments: {
          some: {
            provider: PaymentProvider.PAWAPAY,
            status: PaymentStatus.SUCCEEDED,
            confirmedAt: {
              not: null,
            },
          },
        },
      },
      select: {
        id: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: safeLimit,
    });

    let expired = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      try {
        const success = await this.expireOne(candidate.id);

        if (success) {
          expired++;
        } else {
          skipped++;
        }
      } catch (error: unknown) {
        skipped++;

        this.logger.error(
          `Expiration du test ${candidate.id} non effectuée`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return {
      inspected: candidates.length,
      expired,
      skipped,
    };
  }

  private async expireOne(testId: string): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        // Verrouillage PostgreSQL contre les traitements concurrents.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM tests
          WHERE id = ${testId}::uuid
          FOR UPDATE
        `;

        if (locked.length === 0) {
          return false;
        }

        const test = await tx.test.findUnique({
          where: {
            id: testId,
          },
          select: {
            status: true,
            currency: true,
            rewardAmount: true,
            serviceFeeAmount: true,
            totalAmount: true,
            attempt: {
              select: {
                id: true,
              },
            },
            invitations: {
              orderBy: {
                createdAt: 'asc',
              },
              select: {
                id: true,
                createdAt: true,
                expiresAt: true,
                status: true,
                revokedAt: true,
              },
            },
          },
        });

        if (!test || test.attempt) {
          return false;
        }

        // Correction TypeScript :
        // comparaison directe au lieu d'un tableau inféré
        // comme ("FUNDED" | "SENT")[].
        if (test.status !== TestStatus.FUNDED && test.status !== TestStatus.SENT) {
          return false;
        }

        const first = test.invitations[0];

        if (!first) {
          return false;
        }

        const now = new Date();

        // Respecter la date d'expiration enregistrée.
        // Cela protège les invitations historiques de 24 heures.
        const expirationDate =
          first.expiresAt ?? new Date(first.createdAt.getTime() + this.validityMs);

        if (expirationDate > now) {
          return false;
        }

        // Ne pas expirer un test ayant encore
        // une invitation active et non révoquée.
        const hasActiveInvitation = test.invitations.some(
          (invitation) =>
            this.activeStatuses.includes(invitation.status) &&
            !invitation.revokedAt &&
            invitation.expiresAt !== null &&
            invitation.expiresAt > now,
        );

        if (hasActiveInvitation) {
          return false;
        }

        // Vérifier la cohérence des montants.
        if (
          test.rewardAmount <= 0n ||
          test.serviceFeeAmount < 0n ||
          test.totalAmount !== test.rewardAmount + test.serviceFeeAmount
        ) {
          throw new Error('Montants financiers incohérents : remboursement suspendu');
        }

        // Seul un dépôt pawaPay confirmé est accepté.
        const payment = await tx.payment.findFirst({
          where: {
            testId,
            provider: PaymentProvider.PAWAPAY,
            status: PaymentStatus.SUCCEEDED,
            confirmedAt: {
              not: null,
            },
            currency: test.currency,
            amount: {
              gte: test.totalAmount,
            },
          },
          orderBy: {
            confirmedAt: 'desc',
          },
          select: {
            id: true,
            provider: true,
            methodType: true,
            pawapayDepositRequest: {
              select: {
                phoneNumberEnc: true,
                correspondent: true,
              },
            },
          },
        });

        if (!payment) {
          throw new Error('Aucun dépôt pawaPay confirmé correspondant : examen nécessaire');
        }

        // Vérifier la destination du remboursement.
        const destination = payment.pawapayDepositRequest;

        if (!destination?.phoneNumberEnc || !destination.correspondent) {
          throw new Error('Destination pawaPay incomplète : remboursement suspendu');
        }

        // Un seul remboursement autorisé par test.
        const existingRefund = await tx.refund.findFirst({
          where: {
            testId,
          },
          select: {
            id: true,
          },
        });

        if (existingRefund) {
          throw new Error('Remboursement déjà enregistré : examen nécessaire');
        }

        // La transition REFUND_PENDING précède
        // la création du remboursement.
        await tx.test.update({
          where: {
            id: testId,
          },
          data: {
            status: TestStatus.REFUND_PENDING,
            version: {
              increment: 1,
            },
          },
        });

        // Préparation du remboursement.
        // Aucun appel pawaPay sortant ici.
        await tx.refund.create({
          data: {
            testId,
            paymentId: payment.id,
            attempt: 1,
            provider: payment.provider,
            methodType: payment.methodType,
            operator: destination.correspondent,
            status: RefundStatus.CREATED,

            // Seule la récompense est remboursée.
            amount: test.rewardAmount,
            currency: test.currency,

            // Motif conservé pour la compatibilité
            // avec PawapayRefundsSchedulerService.
            reason: 'INVITATION_EXPIRED_24H',

            destinationEnc: destination.phoneNumberEnc,
            destinationHmac: null,

            idempotencyKey: `test-expiry-${testId}`,

            requestedBy: 'SYSTEM',
          },
        });

        // Invalider toutes les invitations actives.
        await tx.invitation.updateMany({
          where: {
            testId,
            status: {
              in: this.activeStatuses,
            },
          },
          data: {
            status: InvitationStatus.EXPIRED,
            tokenEncrypted: null,
          },
        });

        // Annuler les notifications en attente.
        await tx.invitationDelivery.updateMany({
          where: {
            invitation: {
              testId,
            },
            status: NotificationStatus.QUEUED,
          },
          data: {
            status: NotificationStatus.SKIPPED,
          },
        });

        // Historique métier.
        await tx.testEvent.create({
          data: {
            testId,
            fromStatus: test.status,
            toStatus: TestStatus.REFUND_PENDING,
            actorType: TestActorType.SYSTEM,
            source: 'tests.expiration',
            reason: 'Invitation expirée sans réponse ; remboursement de la récompense demandé',
          },
        });

        // Événement Outbox idempotent.
        await tx.outboxEvent.upsert({
          where: {
            dedupeKey: `test-refund-requested-${testId}`,
          },
          create: {
            eventType: 'test.refund_requested',
            aggregateType: 'Test',
            aggregateId: testId,
            dedupeKey: `test-refund-requested-${testId}`,
            payload: {
              testId,
              reason: 'INVITATION_EXPIRED_24H',
            },
          },
          update: {},
        });

        return true;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10000,
        timeout: 15000,
      },
    );
  }
}
