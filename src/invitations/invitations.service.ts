import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  InvitationChannel,
  InvitationStatus,
  NotificationStatus,
  PaymentProvider,
  PaymentStatus,
  RefundStatus,
  Prisma,
  TestActorType,
  TestStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { TestPhoneSecurity } from '../tests/test-phone-security.service';
import { RewardClaimsService } from '../reward-claims/reward-claims.service';
import { InvitationTokenService } from './invitation-token.service';
import { InvitationCryptoService } from './invitation-crypto.service';

@Injectable()
export class InvitationsService {
  private readonly invitationValidityMs = this.readInvitationValidityMs();

  private readInvitationValidityMs(): number {
    const raw = process.env.INVITATION_EXPIRATION_MINUTES ?? '1440';
    if (!/^[1-9]\d*$/.test(raw)) {
      throw new Error('INVITATION_EXPIRATION_MINUTES doit être un entier positif');
    }
    const minutes = Number(raw);
    if (!Number.isSafeInteger(minutes) || minutes > 10080) {
      throw new Error('INVITATION_EXPIRATION_MINUTES doit être compris entre 1 et 10080');
    }
    return minutes * 60 * 1000;
  }

  private readonly activeStatuses: InvitationStatus[] = [
    InvitationStatus.CREATED,
    InvitationStatus.QUEUED,
    InvitationStatus.SENT,
    InvitationStatus.DELIVERED,
    InvitationStatus.OPENED,
  ];

  private readonly answerableTestStatuses: TestStatus[] = [TestStatus.FUNDED, TestStatus.SENT];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: InvitationTokenService,
    private readonly cryptoService: InvitationCryptoService,
    private readonly phoneSecurity: TestPhoneSecurity,
    private readonly rewardClaimsService: RewardClaimsService,
  ) {}

  private buildInvitationUrl(token: string): string {
    const configured = process.env.TRUEBOND_INVITATION_BASE_URL;

    if (!configured) {
      throw new ServiceUnavailableException("L'URL des invitations n'est pas configurée");
    }

    let url: URL;

    try {
      url = new URL(configured);
    } catch {
      throw new ServiceUnavailableException("L'URL des invitations est invalide");
    }

    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new ServiceUnavailableException("L'URL des invitations doit utiliser HTTPS");
    }

    url.searchParams.set('token', token);
    return url.toString();
  }

  private hashInvitationToken(token: string): string {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new BadRequestException("Token d'invitation invalide");
    }

    return this.tokenService.hash(token);
  }

  async verifyFundedTest(testId: string): Promise<void> {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      select: {
        id: true,
        status: true,
        recipientPhoneHmac: true,
        recipientPhoneEnc: true,
      },
    });

    if (!test) {
      throw new NotFoundException('Test introuvable');
    }

    if (test.status !== TestStatus.FUNDED) {
      throw new ConflictException('Le test doit être financé avant la création de son invitation');
    }

    if (!test.recipientPhoneHmac || !test.recipientPhoneEnc) {
      throw new ConflictException('Le numéro du destinataire est absent');
    }
  }

  async createInvitationForFundedTest(testId: string): Promise<string> {
    return this.prisma.$transaction(
      async (tx) => {
        const lockedTests = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM tests
          WHERE id = ${testId}::uuid
          FOR UPDATE
        `;

        if (lockedTests.length === 0) {
          throw new NotFoundException('Test introuvable');
        }

        const test = await tx.test.findUnique({
          where: { id: testId },
          select: {
            status: true,
            recipientPhoneHmac: true,
            recipientPhoneEnc: true,
          },
        });

        if (!test) {
          throw new NotFoundException('Test introuvable');
        }

        if (test.status !== TestStatus.FUNDED) {
          throw new ConflictException(
            'Le test doit être financé avant la création de son invitation',
          );
        }

        if (!test.recipientPhoneHmac || !test.recipientPhoneEnc) {
          throw new ConflictException('Le numéro du destinataire est absent');
        }

        const now = new Date();

        // Une invitation déjà créée fixe définitivement sa fenêtre de validité.
        // Ne jamais renouveler le lien après expiration.
        const firstInvitation = await tx.invitation.findFirst({
          where: { testId },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true, expiresAt: true },
        });
        if (
          firstInvitation &&
          firstInvitation.expiresAt !== null &&
          firstInvitation.expiresAt <= now
        ) {
          throw new GoneException('La période de validité de l’invitation est terminée');
        }

        const activeInvitations = await tx.invitation.findMany({
          where: {
            testId,
            status: { in: this.activeStatuses },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            expiresAt: true,
            tokenEncrypted: true,
            status: true,
          },
        });

        const validInvitation = activeInvitations.find(
          (invitation) =>
            invitation.tokenEncrypted !== null &&
            invitation.expiresAt !== null &&
            invitation.expiresAt > now &&
            (!firstInvitation ||
              (firstInvitation.expiresAt !== null &&
                invitation.expiresAt <= firstInvitation.expiresAt)),
        );

        if (validInvitation) {
          await tx.invitationDelivery.updateMany({
            where: {
              invitationId: validInvitation.id,
              status: NotificationStatus.QUEUED,
            },
            data: {
              status: NotificationStatus.SKIPPED,
            },
          });

          if (validInvitation.status === InvitationStatus.QUEUED) {
            await tx.invitation.update({
              where: { id: validInvitation.id },
              data: { status: InvitationStatus.CREATED },
            });
          }

          return validInvitation.id;
        }

        if (firstInvitation) {
          throw new GoneException('Le lien initial ne peut pas être renouvelé');
        }

        if (activeInvitations.length > 0) {
          const ids = activeInvitations.map((invitation) => invitation.id);

          await tx.invitation.updateMany({
            where: {
              id: { in: ids },
              status: { in: this.activeStatuses },
            },
            data: {
              status: InvitationStatus.EXPIRED,
              tokenEncrypted: null,
            },
          });

          await tx.invitationDelivery.updateMany({
            where: {
              invitationId: { in: ids },
              status: NotificationStatus.QUEUED,
            },
            data: {
              status: NotificationStatus.SKIPPED,
            },
          });
        }

        const { token, tokenHash } = this.tokenService.generate();

        const invitation = await tx.invitation.create({
          data: {
            testId,
            tokenHash,
            tokenEncrypted: this.cryptoService.encrypt(token),
            channel: InvitationChannel.OTHER,
            status: InvitationStatus.CREATED,
            expiresAt: new Date(now.getTime() + this.invitationValidityMs),
          },
          select: { id: true },
        });

        return invitation.id;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10000,
        timeout: 15000,
      },
    );
  }

  async getInvitationLink(userId: string, testId: string) {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      select: {
        id: true,
        initiatorId: true,
      },
    });

    if (!test) {
      throw new NotFoundException('Test introuvable');
    }

    if (test.initiatorId !== userId) {
      throw new ForbiddenException("Vous n'êtes pas autorisé à consulter cette invitation");
    }

    this.buildInvitationUrl('configuration-check');

    const invitationId = await this.createInvitationForFundedTest(testId);

    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
      select: {
        id: true,
        testId: true,
        tokenEncrypted: true,
        expiresAt: true,
        status: true,
      },
    });

    if (!invitation?.tokenEncrypted) {
      throw new ConflictException("Le lien de cette invitation n'est plus disponible");
    }

    if (!invitation.expiresAt || invitation.expiresAt <= new Date()) {
      throw new GoneException('Cette invitation a expiré');
    }

    const token = this.cryptoService.decrypt(invitation.tokenEncrypted);

    return {
      testId: invitation.testId,
      invitationId: invitation.id,
      invitationUrl: this.buildInvitationUrl(token),
      expiresAt: invitation.expiresAt,
      status: invitation.status,
    };
  }

  async resolveInvitation(token: string) {
    const tokenHash = this.hashInvitationToken(token);

    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        revokedAt: true,
        test: {
          select: {
            status: true,
            currency: true,
            rewardAmount: true,
            expiresAt: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation introuvable');
    }

    const now = new Date();

    if (
      invitation.revokedAt ||
      !invitation.expiresAt ||
      invitation.expiresAt <= now ||
      (invitation.test.expiresAt && invitation.test.expiresAt <= now)
    ) {
      throw new GoneException("Cette invitation n'est plus disponible");
    }

    if (!this.activeStatuses.includes(invitation.status)) {
      throw new GoneException("Cette invitation n'est plus disponible");
    }

    if (!this.answerableTestStatuses.includes(invitation.test.status)) {
      throw new GoneException('Ce test ne peut plus être ouvert');
    }

    if (invitation.test.currency !== 'XAF') {
      throw new ConflictException('Devise du test non prise en charge par cet écran');
    }

    const amount = invitation.test.rewardAmount;

    if (amount < 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ConflictException('Montant de récompense invalide');
    }

    return {
      invitationId: invitation.id,
      rewardXaf: Number(amount),
      currency: invitation.test.currency,
      expiresAt: invitation.expiresAt,
    };
  }

  async submitAnswer(token: string, phone: string) {
    const tokenHash = this.hashInvitationToken(token);

    // Normalisation et HMAC uniquement côté serveur.
    const normalizedPhone = this.phoneSecurity.normalize(phone);
    const answerHmac = this.phoneSecurity.hmac(normalizedPhone);

    return this.prisma.$transaction(
      async (tx) => {
        // Lecture initiale pour retrouver le test.
        const invitationRef = await tx.invitation.findUnique({
          where: { tokenHash },
          select: {
            id: true,
            testId: true,
          },
        });

        if (!invitationRef) {
          throw new NotFoundException('Invitation introuvable');
        }

        // Toutes les soumissions d'un même test sont sérialisées.
        const lockedTests = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM tests
          WHERE id = ${invitationRef.testId}::uuid
          FOR UPDATE
        `;

        if (lockedTests.length === 0) {
          throw new NotFoundException('Test introuvable');
        }

        // Relire les données après l'acquisition du verrou.
        const invitation = await tx.invitation.findUnique({
          where: { id: invitationRef.id },
          select: {
            id: true,
            testId: true,
            status: true,
            expiresAt: true,
            revokedAt: true,
          },
        });

        const test = await tx.test.findUnique({
          where: { id: invitationRef.testId },
          select: {
            id: true,
            status: true,
            expiresAt: true,
            currency: true,
          },
        });

        if (!invitation || !test) {
          throw new NotFoundException('Invitation ou test introuvable');
        }

        const now = new Date();

        if (
          invitation.revokedAt ||
          !invitation.expiresAt ||
          invitation.expiresAt <= now ||
          (test.expiresAt && test.expiresAt <= now)
        ) {
          throw new GoneException("Cette invitation n'est plus disponible");
        }

        if (!this.activeStatuses.includes(invitation.status)) {
          throw new GoneException("Cette invitation n'est plus disponible");
        }

        if (!this.answerableTestStatuses.includes(test.status)) {
          throw new ConflictException('Ce test ne peut plus recevoir de réponse');
        }

        if (test.currency !== 'XAF') {
          throw new ConflictException('Devise du test non prise en charge');
        }

        const existingAttempt = await tx.testAttempt.findUnique({
          where: { testId: test.id },
          select: { id: true },
        });

        if (existingAttempt) {
          throw new ConflictException('Une réponse a déjà été enregistrée pour ce test');
        }

        const matchingPhone = await tx.testExpectedPhone.findFirst({
          where: {
            testId: test.id,
            phoneHmac: answerHmac,
          },
          select: { id: true },
        });

        const isCorrect = matchingPhone !== null;

        const resultStatus = isCorrect ? TestStatus.SUCCESS : TestStatus.FAILURE;

        await tx.testAttempt.create({
          data: {
            testId: test.id,
            answerHmac,
            isCorrect,
            source: 'invitation_link',
          },
        });

        await tx.test.update({
          where: { id: test.id },
          data: {
            status: resultStatus,
            completedAt: now,
            version: { increment: 1 },
          },
        });

        await tx.testEvent.create({
          data: {
            testId: test.id,
            fromStatus: test.status,
            toStatus: resultStatus,
            actorType: TestActorType.SYSTEM,
            source: 'invitations.submit-answer',
            reason: isCorrect
              ? 'Réponse correcte du destinataire'
              : 'Réponse incorrecte du destinataire',
          },
        });

        let refundRequested = false;

        // Une mauvaise réponse est définitive : enregistrer une demande de
        // remboursement dans CETTE transaction, sans appel réseau pawaPay.
        // Le verrou FOR UPDATE sur tests protège contre l'expiration concurrente.
        if (!isCorrect) {
          const startRaw =
            process.env.TEST_FAILURE_REFUND_START_AT ??
            process.env.TEST_EXPIRATION_AUTOMATION_START_AT;
          if (!startRaw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(startRaw)) {
            throw new ServiceUnavailableException(
              'TEST_FAILURE_REFUND_START_AT non configurée (ou ancien paramètre de compatibilité)',
            );
          }
          const startAt = new Date(startRaw);
          if (Number.isNaN(startAt.getTime()) || now < startAt) {
            throw new ServiceUnavailableException(
              'Date de démarrage des remboursements invalide ou future',
            );
          }

          const financialTest = await tx.test.findUnique({
            where: { id: test.id },
            select: {
              createdAt: true,
              rewardAmount: true,
              serviceFeeAmount: true,
              totalAmount: true,
              currency: true,
            },
          });
          if (!financialTest || financialTest.createdAt < startAt) {
            // Ne pas créer de nouveau remboursement automatique historique.
            // L'échec reste enregistré normalement pour ces anciens tests.
          } else {
            if (
              financialTest.rewardAmount <= 0n ||
              financialTest.serviceFeeAmount < 0n ||
              financialTest.totalAmount !==
                financialTest.rewardAmount + financialTest.serviceFeeAmount
            ) {
              throw new ConflictException('Montants du test incohérents');
            }
            const payment = await tx.payment.findFirst({
              where: {
                testId: test.id,
                provider: PaymentProvider.PAWAPAY,
                status: PaymentStatus.SUCCEEDED,
                confirmedAt: { not: null },
                currency: financialTest.currency,
                amount: { gte: financialTest.totalAmount },
              },
              orderBy: { confirmedAt: 'desc' },
              select: {
                id: true,
                provider: true,
                methodType: true,
                providerReference: true,
                pawapayDepositRequest: {
                  select: { phoneNumberEnc: true, correspondent: true },
                },
              },
            });
            const destination = payment?.pawapayDepositRequest;
            if (
              !payment ||
              !payment.providerReference ||
              !destination?.phoneNumberEnc ||
              !destination.correspondent
            ) {
              // Pas d'échec enregistré sans remboursement préparé : rollback.
              throw new ConflictException(
                'Paiement ou destination pawaPay non confirmé : réponse non enregistrée',
              );
            }
            const existingRefund = await tx.refund.findFirst({
              where: { testId: test.id },
              select: { id: true },
            });
            if (existingRefund) {
              throw new ConflictException('Un remboursement existe déjà pour ce test');
            }
            await tx.refund.create({
              data: {
                testId: test.id,
                paymentId: payment.id,
                attempt: 1,
                provider: payment.provider,
                methodType: payment.methodType,
                operator: destination.correspondent,
                status: RefundStatus.CREATED,
                amount: financialTest.rewardAmount,
                currency: financialTest.currency,
                reason: 'TEST_FAILED',
                destinationEnc: destination.phoneNumberEnc,
                destinationHmac: null,
                idempotencyKey: `test-failed-${test.id}`,
                requestedBy: 'SYSTEM',
              },
            });
            refundRequested = true;
            await tx.test.update({
              where: { id: test.id },
              data: {
                status: TestStatus.REFUND_PENDING,
                version: { increment: 1 },
              },
            });
            await tx.testEvent.create({
              data: {
                testId: test.id,
                fromStatus: TestStatus.FAILURE,
                toStatus: TestStatus.REFUND_PENDING,
                actorType: TestActorType.SYSTEM,
                source: 'invitations.submit-answer',
                reason: 'Échec définitif ; remboursement de la récompense demandé',
              },
            });
            await tx.outboxEvent.upsert({
              where: { dedupeKey: `test-refund-requested-${test.id}` },
              create: {
                eventType: 'test.refund_requested',
                aggregateType: 'Test',
                aggregateId: test.id,
                dedupeKey: `test-refund-requested-${test.id}`,
                payload: { testId: test.id, reason: 'TEST_FAILED' },
              },
              update: {},
            });
          }
        }

        // Créer la réclamation uniquement en cas de réponse correcte.
        // La création et le résultat du test partagent la même transaction.
        const rewardClaim = isCorrect
          ? await this.rewardClaimsService.createForSuccessfulTest(tx, test.id)
          : null;

        // Enregistrer le résultat dans l'outbox, dans la même transaction.
        // Le worker financier traitera cet événement séparément.
        // Aucun appel Stripe n'est effectué ici.
        await tx.outboxEvent.create({
          data: {
            eventType: isCorrect ? 'test.succeeded' : 'test.failed',
            aggregateType: 'Test',
            aggregateId: test.id,
            dedupeKey: `test-result-${test.id}`,
            payload: {
              testId: test.id,
              result: isCorrect ? 'SUCCESS' : 'FAILURE',
            },
          },
        });

        await tx.invitation.updateMany({
          where: {
            testId: test.id,
            status: { in: this.activeStatuses },
          },
          data: {
            status: InvitationStatus.ACCEPTED,
            tokenEncrypted: null,
            acceptedAt: now,
          },
        });

        await tx.invitationDelivery.updateMany({
          where: {
            invitation: { testId: test.id },
            status: NotificationStatus.QUEUED,
          },
          data: {
            status: NotificationStatus.SKIPPED,
          },
        });

        return {
          testId: test.id,
          result: isCorrect ? 'SUCCESS' : 'FAILURE',
          isCorrect,
          status: refundRequested ? TestStatus.REFUND_PENDING : resultStatus,
          rewardClaim: rewardClaim
            ? {
                claimId: rewardClaim.claimId,
                accessToken: rewardClaim.accessToken,
                identityVerificationRequired: true,
              }
            : null,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10000,
        timeout: 15000,
      },
    );
  }
}
