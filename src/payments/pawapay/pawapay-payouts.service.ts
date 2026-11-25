import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  LedgerEntrySide,
  PaymentMethodType,
  PaymentProvider,
  PaymentStatus,
  PayoutStatus,
  Prisma,
  RewardClaimStatus,
  TestActorType,
  TestStatus,
} from '@prisma/client';

import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { TestPhoneSecurity } from '../../tests/test-phone-security.service';
import { InvitationTokenService } from '../../invitations/invitation-token.service';

import {
  PawapayApiService,
  PawapayPayoutProvider,
  PawapayPayoutRequest,
} from './pawapay-api.service';

type PayoutSendingResult = 'ACCEPTED' | 'DUPLICATE_IGNORED' | 'REQUIRES_REVIEW' | 'SKIPPED';

@Injectable()
export class PawapayPayoutsService {
  private readonly logger = new Logger(PawapayPayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly phoneSecurity: TestPhoneSecurity,
    private readonly tokenService: InvitationTokenService,
    private readonly api: PawapayApiService,
  ) {}

  // ====================================================
  // SECURITE SANDBOX
  // ====================================================

  private assertSandbox(): void {
    if (
      process.env.PAWAPAY_ENV?.trim().toUpperCase() !== 'SANDBOX' ||
      process.env.NODE_ENV === 'production' ||
      process.env.OTP_DELIVERY_PROVIDER !== 'socket' ||
      process.env.ENABLE_PAWAPAY_PAYOUT_PREPARATION !== 'YES'
    ) {
      throw new ServiceUnavailableException('Préparation du versement indisponible.');
    }
  }

  private assertSendingEnabled(): Date {
    this.assertSandbox();

    if (
      process.env.OUTBOX_WORKER_MODE !== 'INSPECT_LOOP' ||
      process.env.ENABLE_PAWAPAY_PAYOUT_SENDING !== 'YES' ||
      process.env.PAWAPAY_PAYOUT_AUTOMATION !== 'YES'
    ) {
      throw new ServiceUnavailableException('Envoi automatique des versements désactivé.');
    }

    const raw = process.env.PAWAPAY_PAYOUT_AUTOMATION_START_AT;

    if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw)) {
      throw new ServiceUnavailableException('Date UTC de démarrage obligatoire.');
    }

    const cutoff = new Date(raw);

    const normalized = raw.replace(
      /(?:\.(\d{1,3}))?Z$/,
      (_, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`,
    );

    if (
      Number.isNaN(cutoff.getTime()) ||
      cutoff.toISOString() !== normalized ||
      cutoff.getTime() > Date.now()
    ) {
      throw new ServiceUnavailableException('Automatisation des versements non active.');
    }

    return cutoff;
  }

  // ====================================================
  // VALIDATIONS
  // ====================================================

  private validateToken(token: string): void {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new BadRequestException('Token de réclamation invalide.');
    }
  }

  private validatePayoutId(payoutId: string): void {
    if (
      typeof payoutId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payoutId)
    ) {
      throw new BadRequestException('Identifiant de versement invalide.');
    }
  }

  private validateOperator(operator: string | null): asserts operator is PawapayPayoutProvider {
    if (operator !== 'MTN_MOMO_CMR' && operator !== 'ORANGE_CMR') {
      throw new BadRequestException('Opérateur Mobile Money non pris en charge.');
    }
  }

  private validateDestination(destinationEnc: string, destinationHmac: string): string {
    const destination = this.phoneSecurity.decrypt(destinationEnc);

    const normalized = this.phoneSecurity.normalize(destination);

    if (
      !/^\+2376\d{8}$/.test(normalized) ||
      this.phoneSecurity.hmac(normalized) !== destinationHmac
    ) {
      throw new ConflictException('Destination Mobile Money incohérente.');
    }

    return normalized;
  }

  // ====================================================
  // VERIFICATION FINANCIERE COMMUNE
  // ====================================================

  private async assertFundingAndEscrow(
    tx: Prisma.TransactionClient,
    test: {
      id: string;
      currency: string;
      rewardAmount: bigint;
      totalAmount: bigint;
    },
  ): Promise<void> {
    if (test.currency !== 'XAF' || test.rewardAmount <= 0n) {
      throw new ConflictException('Montant ou devise incompatible.');
    }

    // Vérification du financement initial.

    const payments = await tx.payment.findMany({
      where: {
        testId: test.id,
        provider: PaymentProvider.PAWAPAY,
        status: PaymentStatus.SUCCEEDED,
        confirmedAt: { not: null },
        currency: test.currency,
      },
    });

    const payment = payments[0];

    if (
      payments.length !== 1 ||
      !payment ||
      !payment.providerReference ||
      payment.amount !== test.totalAmount ||
      payment.amount < test.rewardAmount
    ) {
      throw new ConflictException('Financement initial non confirmé.');
    }

    // Aucun remboursement concurrent.

    const refundCount = await tx.refund.count({
      where: {
        testId: test.id,
      },
    });

    if (refundCount !== 0) {
      throw new ConflictException('Un remboursement existe déjà pour ce test.');
    }

    // Compte séquestre du test.

    const escrowAccounts = await tx.ledgerAccount.findMany({
      where: {
        code: 'ESCROW',
        ownerType: 'TEST',
        ownerId: test.id,
        currency: test.currency,
        isActive: true,
      },
    });

    const escrow = escrowAccounts[0];

    if (escrowAccounts.length !== 1 || !escrow || escrow.normalSide !== LedgerEntrySide.CREDIT) {
      throw new ConflictException('Compte séquestre introuvable ou incohérent.');
    }

    // Compte de règlement pawaPay.

    const clearingAccounts = await tx.ledgerAccount.findMany({
      where: {
        code: 'PSP_CLEARING',
        ownerType: 'PLATFORM',
        ownerId: 'PLATFORM',
        currency: test.currency,
        isActive: true,
      },
    });

    if (
      clearingAccounts.length !== 1 ||
      clearingAccounts[0]?.normalSide !== LedgerEntrySide.DEBIT
    ) {
      throw new ConflictException('Compte de règlement indisponible.');
    }

    // Solde réel du séquestre.

    const entries = await tx.ledgerEntry.findMany({
      where: {
        accountId: escrow.id,
        currency: test.currency,
      },

      select: {
        side: true,
        amount: true,
      },
    });

    const balance = entries.reduce(
      (total, entry) =>
        total + (entry.side === LedgerEntrySide.CREDIT ? entry.amount : -entry.amount),
      0n,
    );

    if (balance !== test.rewardAmount) {
      throw new ConflictException('Solde séquestre incompatible avec la récompense.');
    }
  }

  // ====================================================
  // PREPARATION DU VERSEMENT
  // ====================================================

  async preparePayout(accessToken: string, operator: PawapayPayoutProvider) {
    this.assertSandbox();

    this.validateToken(accessToken);

    this.validateOperator(operator);

    const tokenHash = this.tokenService.hash(accessToken);

    return this.prisma.$transaction(
      async (tx) => {
        const initial = await tx.rewardClaim.findUnique({
          where: {
            accessTokenHash: tokenHash,
          },

          select: {
            testId: true,
          },
        });

        if (!initial) {
          throw new NotFoundException('Réclamation introuvable.');
        }

        // Verrou commun aux opérations financières.

        await tx.$queryRaw`
          SELECT id
          FROM tests
          WHERE id = ${initial.testId}::uuid
          FOR UPDATE
        `;

        const claim = await tx.rewardClaim.findUnique({
          where: {
            accessTokenHash: tokenHash,
          },

          include: {
            test: {
              include: {
                attempt: true,
              },
            },
          },
        });

        if (!claim) {
          throw new NotFoundException('Réclamation introuvable.');
        }

        const now = new Date();

        if (!claim.accessExpiresAt || claim.accessExpiresAt <= now || claim.expiresAt <= now) {
          throw new GoneException('Accès à la réclamation expiré.');
        }

        // Retour idempotent.

        if (
          claim.status === RewardClaimStatus.AUTHORIZED ||
          claim.status === RewardClaimStatus.PAYOUT_PENDING ||
          claim.status === RewardClaimStatus.PAID
        ) {
          const existing = await tx.payout.findUnique({
            where: {
              testId_attempt: {
                testId: claim.testId,
                attempt: 1,
              },
            },
          });

          if (
            !existing ||
            existing.provider !== PaymentProvider.PAWAPAY ||
            existing.operator !== operator ||
            existing.destinationHmac !== claim.destinationHmac ||
            existing.amountNet !== claim.test.rewardAmount ||
            existing.currency !== claim.test.currency
          ) {
            throw new ConflictException('Une opération différente existe déjà.');
          }

          return {
            claimId: claim.id,
            payoutId: existing.id,
            status: claim.status,
            payoutStatus: existing.status,
            amount: existing.amountNet.toString(),
            currency: existing.currency,
            operator: existing.operator,
          };
        }

        // Vérification de la réclamation.

        if (
          claim.status !== RewardClaimStatus.DESTINATION_VERIFIED ||
          claim.test.status !== TestStatus.SUCCESS ||
          claim.test.attempt?.isCorrect !== true ||
          !claim.identityVerifiedAt ||
          !claim.destinationVerifiedAt ||
          !claim.destinationEnc ||
          !claim.destinationHmac ||
          claim.authorizedAt !== null
        ) {
          throw new ConflictException('Réclamation non éligible au versement.');
        }

        if (claim.destinationVerifiedAt < claim.identityVerifiedAt) {
          throw new ConflictException('Ordre des vérifications incohérent.');
        }

        const test = claim.test;

        // Destination issue exclusivement de la base.

        this.validateDestination(claim.destinationEnc, claim.destinationHmac);

        // Vérifications financières.

        await this.assertFundingAndEscrow(tx, test);

        const payoutCount = await tx.payout.count({
          where: {
            testId: test.id,
          },
        });

        if (payoutCount !== 0) {
          throw new ConflictException('Un versement existe déjà pour ce test.');
        }

        // Création durable du versement.
        //
        // Aucun appel POST pawaPay à cette étape.
        //
        // Le bénéficiaire reçoit la récompense entière.

        const payout = await tx.payout.create({
          data: {
            id: randomUUID(),
            testId: test.id,
            attempt: 1,

            provider: PaymentProvider.PAWAPAY,

            methodType: PaymentMethodType.MOBILE_MONEY,

            operator,

            status: PayoutStatus.CREATED,

            amountGross: test.rewardAmount,
            amountNet: test.rewardAmount,

            providerFeeAmount: 0n,

            currency: test.currency,

            destinationEnc: claim.destinationEnc,
            destinationHmac: claim.destinationHmac,

            idempotencyKey: `reward-payout-${test.id}-1`,
          },
        });

        // Autorisation durable du bénéficiaire.

        const updatedClaim = await tx.rewardClaim.updateMany({
          where: {
            id: claim.id,

            status: RewardClaimStatus.DESTINATION_VERIFIED,

            authorizedAt: null,
          },

          data: {
            status: RewardClaimStatus.AUTHORIZED,
            authorizedAt: now,
          },
        });

        if (updatedClaim.count !== 1) {
          throw new ConflictException('Autorisation du versement refusée.');
        }

        // Le test reste SUCCESS jusqu'à la réservation.

        return {
          claimId: claim.id,
          payoutId: payout.id,

          status: RewardClaimStatus.AUTHORIZED,

          payoutStatus: PayoutStatus.CREATED,

          amount: payout.amountNet.toString(),

          currency: payout.currency,

          operator: payout.operator,
        };
      },

      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,

        timeout: 15000,
      },
    );
  }

  // ====================================================
  // RESERVATION DURABLE AVANT ENVOI
  // ====================================================

  private async reservePayoutForSending(
    payoutId: string,
    expectedRequest: PawapayPayoutRequest,
  ): Promise<PawapayPayoutRequest | null> {
    const cutoff = this.assertSendingEnabled();

    return this.prisma.$transaction(
      async (tx) => {
        const candidate = await tx.payout.findUnique({
          where: {
            id: payoutId,
          },

          select: {
            testId: true,
          },
        });

        if (!candidate) {
          return null;
        }

        // Même ordre de verrouillage que la
        // finalisation et les remboursements.

        await tx.$queryRaw`
          SELECT id
          FROM tests
          WHERE id = ${candidate.testId}::uuid
          FOR UPDATE
        `;

        await tx.$queryRaw`
          SELECT id
          FROM payouts
          WHERE id = ${payoutId}::uuid
          FOR UPDATE
        `;

        const payout = await tx.payout.findUnique({
          where: {
            id: payoutId,
          },

          include: {
            test: {
              include: {
                attempt: true,
              },
            },
          },
        });

        if (
          !payout ||
          payout.status !== PayoutStatus.CREATED ||
          payout.providerReference !== null
        ) {
          return null;
        }

        if (
          payout.provider !== PaymentProvider.PAWAPAY ||
          payout.methodType !== PaymentMethodType.MOBILE_MONEY ||
          payout.attempt !== 1 ||
          payout.createdAt < cutoff ||
          payout.currency !== 'XAF' ||
          payout.currency !== payout.test.currency ||
          payout.amountNet <= 0n ||
          payout.amountGross !== payout.amountNet ||
          payout.amountNet !== payout.test.rewardAmount ||
          payout.providerFeeAmount !== 0n ||
          payout.test.status !== TestStatus.SUCCESS ||
          payout.test.attempt?.isCorrect !== true ||
          payout.idempotencyKey !== `reward-payout-${payout.testId}-1`
        ) {
          throw new ConflictException('Versement non éligible à la réservation.');
        }

        const claim = await tx.rewardClaim.findUnique({
          where: {
            testId: payout.testId,
          },
        });

        const now = new Date();

        if (
          !claim ||
          claim.status !== RewardClaimStatus.AUTHORIZED ||
          !claim.identityVerifiedAt ||
          !claim.destinationVerifiedAt ||
          !claim.authorizedAt ||
          !claim.destinationEnc ||
          !claim.destinationHmac ||
          claim.expiresAt <= now ||
          claim.authorizedAt < cutoff ||
          claim.authorizedAt > now ||
          claim.destinationVerifiedAt < claim.identityVerifiedAt ||
          claim.authorizedAt < claim.destinationVerifiedAt ||
          claim.destinationHmac !== payout.destinationHmac
        ) {
          throw new ConflictException('Autorisation du bénéficiaire incohérente.');
        }

        this.validateOperator(payout.operator);

        const payoutDestination = this.validateDestination(
          payout.destinationEnc,
          payout.destinationHmac,
        );

        const claimDestination = this.validateDestination(
          claim.destinationEnc,
          claim.destinationHmac,
        );

        if (payoutDestination !== claimDestination) {
          throw new ConflictException('Destination du versement modifiée.');
        }

        // Nouvelle vérification du financement
        // sous verrou transactionnel.

        await this.assertFundingAndEscrow(tx, payout.test);

        const otherPayouts = await tx.payout.count({
          where: {
            testId: payout.testId,

            id: {
              not: payout.id,
            },
          },
        });

        if (otherPayouts !== 0) {
          throw new ConflictException('Un autre versement existe déjà.');
        }

        // Vérification de l'absence d'un règlement
        // comptable déjà enregistré.

        const settlementCount = await tx.ledgerTransaction.count({
          where: {
            payoutId: payout.id,
          },
        });

        if (settlementCount !== 0) {
          throw new ConflictException('Une écriture comptable existe déjà.');
        }

        const request: PawapayPayoutRequest = {
          payoutId: payout.id,

          amount: payout.amountNet.toString(),

          currency: 'XAF',

          recipient: {
            type: 'MMO',

            accountDetails: {
              phoneNumber: payoutDestination.slice(1),

              provider: payout.operator,
            },
          },
        };

        // Vérifie que les données n'ont pas changé
        // depuis la consultation d'active-conf.

        if (JSON.stringify(request) !== JSON.stringify(expectedRequest)) {
          throw new ConflictException('Requête modifiée avant réservation.');
        }

        // Dernière vérification de l'activation.

        this.assertSendingEnabled();

        // Réservation atomique.
        //
        // L'identifiant pawaPay est fixé avant
        // tout appel réseau.

        const reserved = await tx.payout.updateMany({
          where: {
            id: payout.id,
            status: PayoutStatus.CREATED,
            providerReference: null,
          },

          data: {
            status: PayoutStatus.PENDING,
            providerReference: payout.id,
            failureCode: null,
          },
        });

        if (reserved.count !== 1) {
          throw new ConflictException('Réservation du versement refusée.');
        }

        // Transition de la réclamation.

        const updatedClaim = await tx.rewardClaim.updateMany({
          where: {
            id: claim.id,
            status: RewardClaimStatus.AUTHORIZED,
          },

          data: {
            status: RewardClaimStatus.PAYOUT_PENDING,
          },
        });

        if (updatedClaim.count !== 1) {
          throw new ConflictException('Transition de la réclamation refusée.');
        }

        // Transition du test.

        const updatedTest = await tx.test.updateMany({
          where: {
            id: payout.testId,
            status: TestStatus.SUCCESS,
          },

          data: {
            status: TestStatus.PAYOUT_PENDING,

            version: {
              increment: 1,
            },
          },
        });

        if (updatedTest.count !== 1) {
          throw new ConflictException('Transition du test refusée.');
        }

        // Historique de la réservation.

        await tx.testEvent.create({
          data: {
            testId: payout.testId,

            fromStatus: TestStatus.SUCCESS,

            toStatus: TestStatus.PAYOUT_PENDING,

            actorType: TestActorType.WORKER,

            reason: 'Versement de la récompense réservé pour envoi',

            source: 'PAWAPAY_PAYOUT_AUTOMATION',

            correlationId: payout.id,
          },
        });

        return request;
      },

      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,

        timeout: 15000,
      },
    );
  }

  // ====================================================
  // SIGNALER UNE SITUATION AMBIGUE
  // ====================================================

  private async flagForReview(payoutId: string, code: string): Promise<void> {
    try {
      await this.prisma.payout.updateMany({
        where: {
          id: payoutId,
          provider: PaymentProvider.PAWAPAY,
          providerReference: payoutId,
          status: PayoutStatus.PENDING,
        },

        data: {
          failureCode: code,
        },
      });
    } catch {
      this.logger.error(`Impossible d'enregistrer l'alerte : ${payoutId}`);
    }

    // Le versement reste PENDING.
    //
    // Aucun remboursement automatique.
    // Aucun nouvel envoi automatique.

    this.logger.warn(`PAYOUT_REVIEW_REQUIRED : ${payoutId} — ${code}`);
  }

  // ====================================================
  // ENVOI AUTOMATIQUE
  // ====================================================

  async sendCreatedPayout(payoutId: string): Promise<PayoutSendingResult> {
    const cutoff = this.assertSendingEnabled();

    this.validatePayoutId(payoutId);

    const candidate = await this.prisma.payout.findUnique({
      where: {
        id: payoutId,
      },
    });

    if (
      !candidate ||
      candidate.provider !== PaymentProvider.PAWAPAY ||
      candidate.status !== PayoutStatus.CREATED ||
      candidate.providerReference !== null ||
      candidate.createdAt < cutoff
    ) {
      return 'SKIPPED';
    }

    this.validateOperator(candidate.operator);

    if (candidate.currency !== 'XAF' || candidate.amountNet <= 0n) {
      throw new ConflictException('Montant ou devise incompatible.');
    }

    const destination = this.validateDestination(
      candidate.destinationEnc,
      candidate.destinationHmac,
    );

    const expectedRequest: PawapayPayoutRequest = {
      payoutId: candidate.id,

      amount: candidate.amountNet.toString(),

      currency: 'XAF',

      recipient: {
        type: 'MMO',

        accountDetails: {
          phoneNumber: destination.slice(1),

          provider: candidate.operator,
        },
      },
    };

    // 1. Vérification de la disponibilité pawaPay.
    //
    // En cas d'indisponibilité, le versement
    // reste CREATED et aucun POST n'est effectué.

    await this.api.assertPayoutAvailability(candidate.operator, candidate.amountNet.toString());

    // 2. Réservation durable en base.
    //
    // La transaction doit être validée avant
    // de poursuivre.

    const request = await this.reservePayoutForSending(payoutId, expectedRequest);

    if (!request) {
      return 'SKIPPED';
    }

    // 3. Création et consommation du permis.
    //
    // À partir d'ici, toute erreur laisse
    // le versement PENDING.
    //
    // Aucun retry du POST n'est autorisé.

    try {
      const permit = this.api.createPermitForReservedPayout(request);

      const response = await this.api.initiatePayout(request, permit);

      if (!response || response.payoutId !== payoutId) {
        await this.flagForReview(payoutId, 'INVALID_PROVIDER_RESPONSE');

        return 'REQUIRES_REVIEW';
      }

      if (response.status === 'ACCEPTED') {
        this.logger.log(`Versement accepté par pawaPay : ${payoutId}`);

        // ACCEPTED ne signifie pas COMPLETED.

        return 'ACCEPTED';
      }

      if (response.status === 'DUPLICATE_IGNORED') {
        this.logger.warn(`Versement déjà connu de pawaPay : ${payoutId}`);

        // Le scheduler consultera le même UUID.

        return 'DUPLICATE_IGNORED';
      }

      if (response.status === 'REJECTED') {
        await this.flagForReview(payoutId, 'PROVIDER_REJECTED');

        return 'REQUIRES_REVIEW';
      }

      await this.flagForReview(payoutId, 'UNKNOWN_PROVIDER_STATUS');

      return 'REQUIRES_REVIEW';
    } catch {
      // Une erreur HTTP ou réseau ne prouve pas
      // que le décaissement n'a pas été exécuté.

      await this.flagForReview(payoutId, 'PAYOUT_INITIATION_UNCERTAIN');

      return 'REQUIRES_REVIEW';
    }
  }

  // ====================================================
  // CONSULTATION DU VERSEMENT
  // ====================================================

  async getStatus(accessToken: string) {
    this.validateToken(accessToken);

    return this.prisma.$transaction(
      async (tx) => {
        const claim = await tx.rewardClaim.findUnique({
          where: {
            accessTokenHash: this.tokenService.hash(accessToken),
          },

          include: {
            test: true,
          },
        });

        if (!claim) {
          throw new NotFoundException('Réclamation introuvable.');
        }

        const now = new Date();

        if (!claim.accessExpiresAt || claim.accessExpiresAt <= now || claim.expiresAt <= now) {
          throw new GoneException('Accès à la réclamation expiré.');
        }

        const payout = await tx.payout.findUnique({
          where: {
            testId_attempt: {
              testId: claim.testId,
              attempt: 1,
            },
          },

          select: {
            id: true,
            status: true,
            amountNet: true,
            currency: true,
            operator: true,
            confirmedAt: true,
          },
        });

        return {
          claimId: claim.id,

          status: claim.status,

          testStatus: claim.test.status,

          rewardAmount: claim.test.rewardAmount.toString(),

          currency: claim.test.currency,

          payout: payout
            ? {
                payoutId: payout.id,

                status: payout.status,

                amount: payout.amountNet.toString(),

                currency: payout.currency,

                operator: payout.operator,

                confirmedAt: payout.confirmedAt,
              }
            : null,
        };
      },

      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,

        timeout: 10000,
      },
    );
  }
}
