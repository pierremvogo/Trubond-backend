import { Injectable, Logger } from '@nestjs/common';

import { PaymentProvider, PaymentStatus, RefundStatus, TestStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { PawapayApiService } from './pawapay-api.service';

import { PawapayRefundFinalizationService } from './pawapay-refund-finalization.service';

const MANUAL_REFUND_ID = 'd00fbdd9-71a8-402a-b805-70ec90e5624e';

const MANUAL_DEPOSIT_ID = '18bd4e4e-1dbc-4398-a069-48d75ec508b6';
const TARGET_REFUND_ID = '3fd94c11-13bd-4479-8ee0-0c654f8ce7e6';

@Injectable()
export class PawapayRefundsService {
  private readonly logger = new Logger(PawapayRefundsService.name);

  constructor(
    private readonly prisma: PrismaService,

    private readonly api: PawapayApiService,

    private readonly finalization: PawapayRefundFinalizationService,
  ) {}

  private isEligible(
    refund: NonNullable<Awaited<ReturnType<PawapayRefundsService['loadRefund']>>>,
  ): boolean {
    const payment = refund.payment;

    return (
      refund.provider === PaymentProvider.PAWAPAY &&
      refund.test.status === TestStatus.REFUND_PENDING &&
      refund.amount > 0n &&
      refund.amount === refund.test.rewardAmount &&
      refund.currency === refund.test.currency &&
      !!payment &&
      payment.testId === refund.testId &&
      payment.provider === PaymentProvider.PAWAPAY &&
      payment.status === PaymentStatus.SUCCEEDED &&
      !!payment.confirmedAt &&
      payment.currency === refund.currency &&
      payment.amount >= refund.amount &&
      !!payment.providerReference &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        payment.providerReference,
      )
    );
  }

  private loadRefund(id: string) {
    return this.prisma.refund.findUnique({
      where: { id },

      include: { test: true, payment: true },
    });
  }

  // Ancienne API non ciblée : désactivée pour éviter un envoi hors scheduler.

  async initiateOne(_id: string): Promise<never> {
    throw new Error('Initiation directe désactivée : utiliser le scheduler contrôlé');
  }

  async initiatePending(_limit = 10): Promise<never> {
    throw new Error('Initiation groupée directe désactivée : utiliser le scheduler contrôlé');
  }

  // La ligne SQL est insérée AVANT tout POST et ne peut jamais être supprimée

  // automatiquement. La contrainte PRIMARY KEY protège aussi entre instances Render.

  // Ce mécanisme garantit au plus UNE tentative manuelle de POST par refundId.

  async sendManualSandboxOnce(
    id: string,
  ): Promise<'ACCEPTED' | 'DUPLICATE_IGNORED' | 'REJECTED' | 'UNCERTAIN'> {
    if (id !== MANUAL_REFUND_ID) throw new Error('Remboursement manuel non autorisé');

    if (
      process.env.PAWAPAY_ENV?.trim().toUpperCase() !== 'SANDBOX' ||
      process.env.OUTBOX_WORKER_MODE !== 'INSPECT_LOOP' ||
      process.env.ENABLE_PAWAPAY_REFUND_SENDING !== 'NO'
    ) {
      throw new Error('Mode Sandbox manuel non sécurisé');
    }

    const refund = await this.loadRefund(id);

    if (
      !refund ||
      !this.isEligible(refund) ||
      refund.status !== RefundStatus.PENDING ||
      refund.providerReference !== id ||
      refund.reason !== 'INVITATION_EXPIRED_24H' ||
      refund.amount !== 20000n ||
      refund.currency !== 'XAF' ||
      refund.payment?.providerReference !== MANUAL_DEPOSIT_ID
    ) {
      throw new Error('État local ou montants incompatibles avec la reprise ciblée');
    }

    // Préflight distant sans POST. Ne suffit pas, à lui seul, à prouver

    // qu'aucune requête ancienne n'a été envoyée.

    const remote = await this.api.getRefund(id);

    if (remote.status !== 'NOT_FOUND') {
      throw new Error('Remboursement présent ou statut pawaPay inconnu : POST interdit');
    }

    // Validation opérationnelle explicite. Elle doit être définie seulement

    // après examen des logs de la tentative antérieure, qui montraient un rejet

    // local avant fetch. Elle n'est PAS un mécanisme d'authentification.

    if (process.env.TRUEBOND_MANUAL_REFUND_APPROVED !== id) {
      throw new Error('Approbation opérationnelle manquante : TRUEBOND_MANUAL_REFUND_APPROVED');
    }

    // INSERT atomique et durable. Aucune seconde exécution ne passe cette barrière.

    // Si le processus tombe après INSERT, on conserve UNCERTAIN et on réconcilie.

    const inserted = await this.prisma.$executeRaw`

      INSERT INTO "PawapayManualRefundAttempt"

        ("refundId", "depositId", "amount", "currency", "outcome")

      VALUES (${id}::uuid, ${MANUAL_DEPOSIT_ID}::uuid, ${20000n}, ${'XAF'}, ${'UNCERTAIN'})

      ON CONFLICT ("refundId") DO NOTHING

    `;

    if (inserted !== 1) {
      throw new Error('Tentative manuelle déjà enregistrée : aucun nouveau POST autorisé');
    }

    const permit = this.api.createManualPermitForRecordedAttempt(true);

    try {
      const response = await this.api.initiateRefund(
        {
          refundId: id,

          depositId: MANUAL_DEPOSIT_ID,

          amount: '20000',

          currency: 'XAF',

          clientReferenceId: refund.idempotencyKey,
        },

        permit,
      );

      if (response.refundId !== id) return 'UNCERTAIN';

      const status = response.status;

      if (status !== 'ACCEPTED' && status !== 'DUPLICATE_IGNORED' && status !== 'REJECTED') {
        return 'UNCERTAIN';
      }

      await this.prisma.$executeRaw`

        UPDATE "PawapayManualRefundAttempt"

        SET "outcome" = ${status}

        WHERE "refundId" = ${id}::uuid

      `;

      if (status === 'REJECTED') {
        await this.prisma.refund.updateMany({
          where: { id, status: RefundStatus.PENDING },

          data: { status: RefundStatus.REQUIRES_REVIEW },
        });
      }

      return status;
    } catch (error) {
      this.logger.error(
        `Envoi manuel ${id} : résultat incertain, aucun renvoi`,

        error instanceof Error ? error.message : String(error),
      );

      return 'UNCERTAIN';
    }
  }

  // Exclusivement pour le cron Sandbox. Réservation CREATED -> PENDING

  // avant le POST : aucun retry automatique si timeout ou crash.

  async initiateAutomatedOne(id: string, cutoff: Date) {
    if (
      process.env.PAWAPAY_ENV?.trim().toUpperCase() !== 'SANDBOX' ||
      process.env.OUTBOX_WORKER_MODE !== 'INSPECT_LOOP' ||
      process.env.ENABLE_PAWAPAY_REFUND_SENDING !== 'NO' ||
      process.env.PAWAPAY_REFUND_AUTOMATION !== 'YES'
    ) {
      throw new Error('Automatisation désactivée ou environnement non sécurisé');
    }

    const excluded = new Set([
      'd00fbdd9-71a8-402a-b805-70ec90e5624e', // manuel déjà finalisé
    ]);

    const summary = {
      inspected: 1,

      reserved: 0,

      accepted: 0,

      rejected: 0,

      uncertain: 0,

      skipped: 0,
    };

    if (excluded.has(id)) {
      summary.skipped++;

      return summary;
    }

    const refund = await this.loadRefund(id);

    if (
      !refund ||
      (refund.createdAt < cutoff && refund.id !== TARGET_REFUND_ID) ||
      !this.isEligible(refund) ||
      refund.status !== RefundStatus.CREATED ||
      refund.providerReference !== null ||
      !['INVITATION_EXPIRED_24H', 'TEST_FAILED'].includes(refund.reason) ||
      refund.idempotencyKey !==
        (refund.reason === 'TEST_FAILED'
          ? `test-failed-${refund.testId}`
          : `test-expiry-${refund.testId}`) ||
      (refund.reason === 'TEST_FAILED' &&
        (!refund.test.completedAt || refund.test.completedAt < cutoff))
    ) {
      summary.skipped++;

      return summary;
    }

    if (refund.reason === 'TEST_FAILED') {
      const attempt = await this.prisma.testAttempt.findUnique({
        where: { testId: refund.testId },

        select: { isCorrect: true },
      });

      if (!attempt || attempt.isCorrect) {
        summary.skipped++;

        return summary;
      }
    }

    const claim = await this.prisma.refund.updateMany({
      where: { id, status: RefundStatus.CREATED, providerReference: null },

      data: { status: RefundStatus.PENDING, providerReference: id },
    });

    if (claim.count !== 1) {
      summary.skipped++;

      return summary;
    }

    summary.reserved++;

    // Le permis n'est créé qu'après la réservation durable.

    // En cas de panne, PENDING reste à réconcilier ; aucun second POST.

    try {
      const permit = this.api.createAutomatedPermitForClaimedRefund(true);

      const response = await this.api.initiateRefund(
        {
          refundId: id,

          depositId: refund.payment!.providerReference!,

          amount: refund.amount.toString(),

          currency: refund.currency,

          clientReferenceId: refund.idempotencyKey,
        },

        permit,
      );

      if (response.refundId !== id) {
        summary.uncertain++;

        return summary;
      }

      if (response.status === 'ACCEPTED' || response.status === 'DUPLICATE_IGNORED') {
        summary.accepted++;

        return summary;
      }

      if (response.status === 'REJECTED') {
        await this.prisma.refund.updateMany({
          where: { id, status: RefundStatus.PENDING, providerReference: id },

          data: { status: RefundStatus.REQUIRES_REVIEW },
        });

        summary.rejected++;

        return summary;
      }

      summary.uncertain++;
    } catch (error) {
      this.logger.error(
        `Envoi automatisé ${id} incertain ; aucun renvoi`,

        error instanceof Error ? error.message : String(error),
      );

      summary.uncertain++;
    }

    return summary;
  }

  async reconcileOne(id: string) {
    const summary = {
      inspected: 1,

      finalized: 0,

      alreadyFinalized: 0,

      pending: 0,

      requiresReview: 0,

      errors: 0,
    };

    const refund = await this.loadRefund(id);

    if (
      !refund ||
      refund.provider !== PaymentProvider.PAWAPAY ||
      refund.status !== RefundStatus.PENDING ||
      refund.providerReference !== id ||
      !this.isEligible(refund)
    ) {
      summary.requiresReview++;

      return summary;
    }

    const depositId = refund.payment!.providerReference!;

    try {
      const result = await this.api.getRefund(id);

      if (result.status === 'NOT_FOUND') {
        this.logger.warn(`Remboursement ${id} introuvable chez pawaPay`);

        summary.pending++;

        return summary;
      }

      if (result.status !== 'FOUND' || !result.data) {
        summary.requiresReview++;

        return summary;
      }

      const data = result.data;

      let amountMatch = false;

      if (typeof data.amount === 'string' && /^\d+(?:\.\d+)?$/.test(data.amount)) {
        const [integer, decimal = ''] = data.amount.split('.');

        amountMatch = !!integer && /^0*$/.test(decimal) && BigInt(integer) === refund.amount;
      }

      if (
        data.refundId !== id ||
        data.currency !== refund.currency ||
        !amountMatch ||
        (data.depositId !== undefined && data.depositId !== depositId)
      ) {
        summary.requiresReview++;

        return summary;
      }

      if (data.status === 'COMPLETED') {
        const outcome = await this.finalization.finalizeConfirmedRefund(id, {
          refundId: data.refundId,

          depositId,

          amount: data.amount,

          currency: data.currency,

          status: 'COMPLETED',
        });

        if (outcome === 'FINALIZED') summary.finalized++;
        else if (outcome === 'ALREADY_FINALIZED') summary.alreadyFinalized++;
        else throw new Error(`Résultat de finalisation inconnu : ${String(outcome)}`);
      } else if (data.status === 'FAILED') {
        const updated = await this.prisma.refund.updateMany({
          where: { id, status: RefundStatus.PENDING },

          data: { status: RefundStatus.REQUIRES_REVIEW },
        });

        if (updated.count === 1) summary.requiresReview++;
        else summary.pending++;
      } else if (data.status === 'PROCESSING') {
        summary.pending++;
      } else {
        summary.requiresReview++;
      }
    } catch (error) {
      this.logger.error(
        `Erreur de réconciliation ${id}`,

        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );

      summary.errors++;
    }

    return summary;
  }

  async reconcilePending(limit = 50) {
    const refunds = await this.prisma.refund.findMany({
      where: {
        provider: PaymentProvider.PAWAPAY,

        status: RefundStatus.PENDING,

        providerReference: { not: null },
      },

      select: { id: true },

      orderBy: { updatedAt: 'asc' },

      take: Math.min(Math.max(Math.trunc(limit) || 1, 1), 100),
    });

    const summary = {
      inspected: 0,

      finalized: 0,

      alreadyFinalized: 0,

      pending: 0,

      requiresReview: 0,

      errors: 0,
    };

    for (const refund of refunds) {
      const result = await this.reconcileOne(refund.id);

      for (const key of Object.keys(summary) as Array<keyof typeof summary>)
        summary[key] += result[key];
    }

    return summary;
  }
}
