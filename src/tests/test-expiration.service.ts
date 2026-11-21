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
  private readonly validityMs = 24 * 60 * 60 * 1000;

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

    const candidates = await this.prisma.test.findMany({
      where: {
        status: { in: [TestStatus.FUNDED, TestStatus.SENT] },
        attempt: null,
        invitations: {
          some: {
            createdAt: {
              lte: new Date(now.getTime() - this.validityMs),
            },
          },
        },
        // Pour le moment, seuls les paiements pawaPay sont traités.
        payments: {
          some: {
            provider: PaymentProvider.PAWAPAY,
            status: PaymentStatus.SUCCEEDED,
            confirmedAt: { not: null },
          },
        },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 50,
    });

    let expired = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      try {
        if (await this.expireOne(candidate.id)) {
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
        // Verrouiller le test pour éviter les traitements concurrents.
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
          where: { id: testId },
          select: {
            status: true,
            currency: true,
            rewardAmount: true,
            serviceFeeAmount: true,
            totalAmount: true,
            attempt: {
              select: { id: true },
            },
            invitations: {
              orderBy: { createdAt: 'asc' },
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

        const eligibleStatuses: TestStatus[] = [TestStatus.FUNDED, TestStatus.SENT];

        if (!eligibleStatuses.includes(test.status)) {
          return false;
        }

        const first = test.invitations[0];

        if (!first) {
          return false;
        }

        const now = new Date();

        // L'expiration dépend de la toute première invitation.
        if (first.createdAt.getTime() + this.validityMs > now.getTime()) {
          return false;
        }

        // Ne pas expirer un test dont une invitation
        // est encore active et non révoquée.
        if (
          test.invitations.some(
            (invitation) =>
              this.activeStatuses.includes(invitation.status) &&
              !invitation.revokedAt &&
              invitation.expiresAt !== null &&
              invitation.expiresAt > now,
          )
        ) {
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

        // Seul un paiement pawaPay réellement confirmé est accepté.
        const payment = await tx.payment.findFirst({
          where: {
            testId,
            provider: PaymentProvider.PAWAPAY,
            status: PaymentStatus.SUCCEEDED,
            confirmedAt: { not: null },
            currency: test.currency,
            amount: { gte: test.totalAmount },
          },
          orderBy: { confirmedAt: 'desc' },
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

        // Éviter la création de plusieurs remboursements.
        const existingRefund = await tx.refund.findFirst({
          where: { testId },
          select: { id: true },
        });

        if (existingRefund) {
          throw new Error('Remboursement déjà enregistré : examen nécessaire');
        }

        // CORRECTION :
        // PostgreSQL exige REFUND_PENDING avant la création
        // d'un Refund au statut CREATED.
        await tx.test.update({
          where: { id: testId },
          data: {
            status: TestStatus.REFUND_PENDING,
            version: { increment: 1 },
          },
        });

        // Préparer le remboursement uniquement.
        // Aucun appel financier sortant n'est effectué ici.
        await tx.refund.create({
          data: {
            testId,
            paymentId: payment.id,
            attempt: 1,
            provider: payment.provider,
            methodType: payment.methodType,
            operator: destination.correspondent,
            status: RefundStatus.CREATED,

            // Rembourser uniquement la récompense.
            // Les frais de service sont exclus.
            amount: test.rewardAmount,
            currency: test.currency,

            reason: 'INVITATION_EXPIRED_24H',
            destinationEnc: destination.phoneNumberEnc,
            destinationHmac: null,

            idempotencyKey: `test-expiry-${testId}`,
            requestedBy: 'SYSTEM',
          },
        });

        // Expirer toutes les invitations encore actives.
        await tx.invitation.updateMany({
          where: {
            testId,
            status: { in: this.activeStatuses },
          },
          data: {
            status: InvitationStatus.EXPIRED,
            tokenEncrypted: null,
          },
        });

        // Annuler les notifications non encore envoyées.
        await tx.invitationDelivery.updateMany({
          where: {
            invitation: { testId },
            status: NotificationStatus.QUEUED,
          },
          data: {
            status: NotificationStatus.SKIPPED,
          },
        });

        // Conserver l'historique de la transition.
        await tx.testEvent.create({
          data: {
            testId,
            fromStatus: test.status,
            toStatus: TestStatus.REFUND_PENDING,
            actorType: TestActorType.SYSTEM,
            source: 'tests.expiration',
            reason:
              'Invitation expirée après 24 heures sans réponse ; remboursement de la récompense demandé',
          },
        });

        // Enregistrer l'événement pour traitement ultérieur.
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
