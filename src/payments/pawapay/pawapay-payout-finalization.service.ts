import { ConflictException, Injectable } from '@nestjs/common';

import {
  LedgerEntrySide,
  LedgerTransactionType,
  PaymentMethodType,
  PaymentProvider,
  PaymentStatus,
  PayoutStatus,
  Prisma,
  RewardClaimStatus,
  TestActorType,
  TestStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { TestPhoneSecurity } from '../../tests/test-phone-security.service';
import { PawapayApiService } from './pawapay-api.service';

type PayoutFinalizationResult = 'FINALIZED' | 'ALREADY_FINALIZED';

@Injectable()
export class PawapayPayoutFinalizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly api: PawapayApiService,
    private readonly phoneSecurity: TestPhoneSecurity,
  ) {}

  // ====================================================
  // SECURITE SANDBOX
  // ====================================================

  private assertSandbox(): void {
    if (
      process.env.PAWAPAY_ENV?.trim().toUpperCase() !== 'SANDBOX' ||
      process.env.NODE_ENV === 'production' ||
      process.env.OTP_DELIVERY_PROVIDER !== 'socket'
    ) {
      throw new ConflictException('Finalisation hors Sandbox interdite.');
    }

    // La finalisation reste possible lorsque
    // les nouveaux envois sont désactivés.
    //
    // Un versement déjà effectué doit pouvoir
    // être réconcilié avec la comptabilité.
  }

  // ====================================================
  // VALIDATION DE LA DESTINATION
  // ====================================================

  private validateDestination(destinationEnc: string, destinationHmac: string): string {
    const destination = this.phoneSecurity.decrypt(destinationEnc);

    const normalized = this.phoneSecurity.normalize(destination);

    if (
      !/^\+2376\d{8}$/.test(normalized) ||
      this.phoneSecurity.hmac(normalized) !== destinationHmac
    ) {
      throw new ConflictException('Destination du versement incohérente.');
    }

    return normalized;
  }

  // ====================================================
  // FINALISATION DU VERSEMENT
  // ====================================================

  async finalizeConfirmedPayout(payoutId: string): Promise<PayoutFinalizationResult> {
    this.assertSandbox();

    // ==================================================
    // 1. VERIFICATION DISTANTE
    // ==================================================

    // Aucun callback ni statut ACCEPTED ne suffit
    // à confirmer le décaissement.
    //
    // Consultation directe de l'API pawaPay.

    const remote = await this.api.getPayout(payoutId);

    if (
      remote.status !== 'FOUND' ||
      !remote.data ||
      remote.data.status !== 'COMPLETED' ||
      remote.data.payoutId !== payoutId
    ) {
      throw new ConflictException('Versement non confirmé par pawaPay.');
    }

    const confirmed = remote.data;

    // ==================================================
    // 2. TRANSACTION COMPTABLE ATOMIQUE
    // ==================================================

    return this.prisma.$transaction(
      async (tx) => {
        // Identification du test associé.

        const candidate = await tx.payout.findUnique({
          where: {
            id: payoutId,
          },

          select: {
            testId: true,
          },
        });

        if (!candidate) {
          throw new ConflictException('Versement introuvable.');
        }

        // ==============================================
        // 3. VERROUILLAGE
        // ==============================================

        // Même ordre de verrouillage que
        // la réservation et les remboursements.

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

        if (!payout) {
          throw new ConflictException('Données du versement indisponibles.');
        }

        const claim = await tx.rewardClaim.findUnique({
          where: {
            testId: payout.testId,
          },
        });

        if (!claim) {
          throw new ConflictException('Réclamation introuvable.');
        }

        // ==============================================
        // 4. VALIDATION FINANCIERE
        // ==============================================

        const amountMatch =
          typeof confirmed.amount === 'string' &&
          /^\d+(?:\.0+)?$/.test(confirmed.amount) &&
          BigInt(confirmed.amount.split('.')[0]!) === payout.amountNet;

        if (
          payout.provider !== PaymentProvider.PAWAPAY ||
          payout.methodType !== PaymentMethodType.MOBILE_MONEY ||
          payout.attempt !== 1 ||
          payout.providerReference !== payoutId ||
          payout.currency !== 'XAF' ||
          confirmed.currency !== payout.currency ||
          payout.test.currency !== payout.currency ||
          !amountMatch ||
          payout.amountNet <= 0n ||
          payout.amountNet !== payout.test.rewardAmount ||
          payout.amountGross !== payout.amountNet ||
          payout.providerFeeAmount !== 0n ||
          payout.idempotencyKey !== `reward-payout-${payout.testId}-1`
        ) {
          throw new ConflictException('Incohérence financière du versement.');
        }

        if (payout.operator !== 'MTN_MOMO_CMR' && payout.operator !== 'ORANGE_CMR') {
          throw new ConflictException('Opérateur Mobile Money incompatible.');
        }

        // ==============================================
        // 5. VALIDATION DE LA RECLAMATION
        // ==============================================

        if (
          !claim.identityVerifiedAt ||
          !claim.destinationVerifiedAt ||
          !claim.authorizedAt ||
          !claim.destinationHmac ||
          !claim.destinationEnc ||
          claim.destinationVerifiedAt < claim.identityVerifiedAt ||
          claim.authorizedAt < claim.destinationVerifiedAt ||
          claim.authorizedAt > new Date() ||
          claim.destinationHmac !== payout.destinationHmac
        ) {
          throw new ConflictException('Autorisation du bénéficiaire incohérente.');
        }

        // L'expiration du token ou de la réclamation
        // ne doit pas empêcher la comptabilisation
        // d'un versement déjà exécuté.

        // ==============================================
        // 6. VALIDATION DE LA DESTINATION
        // ==============================================

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

        if (
          !confirmed.recipient ||
          confirmed.recipient.type !== 'MMO' ||
          !confirmed.recipient.accountDetails
        ) {
          throw new ConflictException('Destination pawaPay non vérifiable.');
        }

        const remoteAccount = confirmed.recipient.accountDetails;

        const remotePhone = remoteAccount.phoneNumber;

        if (typeof remotePhone !== 'string' || !/^\+?2376\d{8}$/.test(remotePhone)) {
          throw new ConflictException('Numéro distant incompatible.');
        }

        const normalizedPhone = this.phoneSecurity.normalize(
          remotePhone.startsWith('+') ? remotePhone : `+${remotePhone}`,
        );

        if (
          normalizedPhone !== payoutDestination ||
          this.phoneSecurity.hmac(normalizedPhone) !== payout.destinationHmac ||
          remoteAccount.provider !== payout.operator
        ) {
          throw new ConflictException('Destination pawaPay incohérente.');
        }

        // ==============================================
        // 7. VERIFICATION DE LA BONNE REPONSE
        // ==============================================

        if (payout.test.attempt?.isCorrect !== true) {
          throw new ConflictException('Le test ne possède pas de réponse correcte.');
        }

        // ==============================================
        // 8. VERIFICATION DU FINANCEMENT INITIAL
        // ==============================================

        const payments = await tx.payment.findMany({
          where: {
            testId: payout.testId,

            provider: PaymentProvider.PAWAPAY,

            status: PaymentStatus.SUCCEEDED,

            currency: payout.currency,

            confirmedAt: {
              not: null,
            },
          },
        });

        const payment = payments[0];

        if (
          payments.length !== 1 ||
          !payment ||
          !payment.providerReference ||
          payment.amount !== payout.test.totalAmount ||
          payment.amount < payout.amountNet
        ) {
          throw new ConflictException('Financement initial non confirmé.');
        }

        // ==============================================
        // 9. ABSENCE D'OPERATION CONCURRENTE
        // ==============================================

        const otherPayouts = await tx.payout.count({
          where: {
            testId: payout.testId,

            id: {
              not: payout.id,
            },
          },
        });

        const refunds = await tx.refund.count({
          where: {
            testId: payout.testId,
          },
        });

        if (otherPayouts !== 0 || refunds !== 0) {
          throw new ConflictException('Autre opération financière détectée.');
        }

        // ==============================================
        // 10. COMPTES COMPTABLES
        // ==============================================

        const escrowAccounts = await tx.ledgerAccount.findMany({
          where: {
            code: 'ESCROW',

            ownerType: 'TEST',

            ownerId: payout.testId,

            currency: payout.currency,
          },
        });

        const clearingAccounts = await tx.ledgerAccount.findMany({
          where: {
            code: 'PSP_CLEARING',

            ownerType: 'PLATFORM',

            ownerId: 'PLATFORM',

            currency: payout.currency,
          },
        });

        const escrow = escrowAccounts[0];

        const clearing = clearingAccounts[0];

        if (
          escrowAccounts.length !== 1 ||
          clearingAccounts.length !== 1 ||
          !escrow ||
          !clearing ||
          escrow.id === clearing.id ||
          escrow.normalSide !== LedgerEntrySide.CREDIT ||
          clearing.normalSide !== LedgerEntrySide.DEBIT
        ) {
          throw new ConflictException('Comptes comptables requis incohérents.');
        }

        // ==============================================
        // 11. IDEMPOTENCE COMPTABLE
        // ==============================================

        const ledgerKey = `pawapay-payout-settlement-${payout.id}`;

        const existingLedger = await tx.ledgerTransaction.findUnique({
          where: {
            idempotencyKey: ledgerKey,
          },

          include: {
            entries: true,
          },
        });

        const settlementCount = await tx.ledgerTransaction.count({
          where: {
            payoutId: payout.id,
          },
        });

        // Un versement déjà finalisé ne doit
        // jamais produire de nouvelles écritures.

        if (payout.status === PayoutStatus.SUCCEEDED) {
          if (
            payout.test.status !== TestStatus.COMPLETED ||
            claim.status !== RewardClaimStatus.PAID ||
            !payout.confirmedAt ||
            !existingLedger ||
            settlementCount !== 1 ||
            existingLedger.type !== LedgerTransactionType.PAYOUT_SETTLEMENT ||
            existingLedger.payoutId !== payout.id ||
            existingLedger.testId !== payout.testId ||
            existingLedger.paymentId !== payment.id ||
            existingLedger.currency !== payout.currency ||
            existingLedger.entries.length !== 2
          ) {
            throw new ConflictException('Versement déjà réussi mais comptabilité incohérente.');
          }

          const debit = existingLedger.entries.find(
            (entry) =>
              entry.accountId === escrow.id &&
              entry.side === LedgerEntrySide.DEBIT &&
              entry.amount === payout.amountNet &&
              entry.currency === payout.currency,
          );

          const credit = existingLedger.entries.find(
            (entry) =>
              entry.accountId === clearing.id &&
              entry.side === LedgerEntrySide.CREDIT &&
              entry.amount === payout.amountNet &&
              entry.currency === payout.currency,
          );

          if (!debit || !credit) {
            throw new ConflictException('Écritures comptables incohérentes.');
          }

          return 'ALREADY_FINALIZED';
        }

        // ==============================================
        // 12. VERIFICATION DES ETATS
        // ==============================================

        if (
          payout.status !== PayoutStatus.PENDING ||
          payout.test.status !== TestStatus.PAYOUT_PENDING ||
          claim.status !== RewardClaimStatus.PAYOUT_PENDING ||
          payout.confirmedAt !== null ||
          existingLedger ||
          settlementCount !== 0
        ) {
          throw new ConflictException('État incompatible avec la finalisation.');
        }

        if (!escrow.isActive || !clearing.isActive) {
          throw new ConflictException('Comptes comptables inactifs.');
        }

        // ==============================================
        // 13. CONTROLE DU SOLDE SEQUESTRE
        // ==============================================

        const escrowEntries = await tx.ledgerEntry.findMany({
          where: {
            accountId: escrow.id,

            currency: payout.currency,
          },

          select: {
            side: true,
            amount: true,
          },
        });

        const escrowBalance = escrowEntries.reduce(
          (balance, entry) =>
            balance + (entry.side === LedgerEntrySide.CREDIT ? entry.amount : -entry.amount),
          0n,
        );

        if (escrowBalance !== payout.amountNet) {
          throw new ConflictException('Solde séquestre incompatible avec le versement.');
        }

        // Dernière vérification de l'environnement.

        this.assertSandbox();

        // ==============================================
        // 14. REGLEMENT COMPTABLE
        // ==============================================

        await tx.ledgerTransaction.create({
          data: {
            idempotencyKey: ledgerKey,

            type: LedgerTransactionType.PAYOUT_SETTLEMENT,

            currency: payout.currency,

            description: 'Versement de la récompense confirmé par pawaPay',

            testId: payout.testId,

            paymentId: payment.id,

            payoutId: payout.id,

            entries: {
              create: [
                {
                  accountId: escrow.id,

                  side: LedgerEntrySide.DEBIT,

                  amount: payout.amountNet,

                  currency: payout.currency,

                  memo: 'Libération du séquestre',
                },
                {
                  accountId: clearing.id,

                  side: LedgerEntrySide.CREDIT,

                  amount: payout.amountNet,

                  currency: payout.currency,

                  memo: 'Décaissement pawaPay confirmé',
                },
              ],
            },
          },
        });

        // ==============================================
        // 15. FINALISATION DU VERSEMENT
        // ==============================================

        const confirmedAt = new Date();

        const updatedPayout = await tx.payout.updateMany({
          where: {
            id: payout.id,

            status: PayoutStatus.PENDING,

            providerReference: payoutId,

            confirmedAt: null,
          },

          data: {
            status: PayoutStatus.SUCCEEDED,

            confirmedAt,

            failureCode: null,
          },
        });

        if (updatedPayout.count !== 1) {
          throw new ConflictException('Transition du versement refusée.');
        }

        // ==============================================
        // 16. FINALISATION DE LA RECLAMATION
        // ==============================================

        const updatedClaim = await tx.rewardClaim.updateMany({
          where: {
            id: claim.id,

            status: RewardClaimStatus.PAYOUT_PENDING,
          },

          data: {
            status: RewardClaimStatus.PAID,
          },
        });

        if (updatedClaim.count !== 1) {
          throw new ConflictException('Transition de la réclamation refusée.');
        }

        // ==============================================
        // 17. FINALISATION DU TEST
        // ==============================================

        const updatedTest = await tx.test.updateMany({
          where: {
            id: payout.testId,

            status: TestStatus.PAYOUT_PENDING,
          },

          data: {
            status: TestStatus.COMPLETED,

            version: {
              increment: 1,
            },
          },
        });

        if (updatedTest.count !== 1) {
          throw new ConflictException('Transition du test refusée.');
        }

        // ==============================================
        // 18. HISTORIQUE DU TEST
        // ==============================================

        await tx.testEvent.create({
          data: {
            testId: payout.testId,

            fromStatus: TestStatus.PAYOUT_PENDING,

            toStatus: TestStatus.COMPLETED,

            actorType: TestActorType.WORKER,

            reason: 'Versement de la récompense confirmé par pawaPay',

            source: 'PAWAPAY_PAYOUT_RECONCILIATION',

            correlationId: payout.id,
          },
        });

        // Toutes les modifications sont validées
        // ensemble par la transaction SQL.
        //
        // En cas d'erreur, rollback intégral.

        return 'FINALIZED';
      },

      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,

        timeout: 15000,
      },
    );
  }
}
