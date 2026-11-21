import { Injectable, Logger } from '@nestjs/common';

import { PaymentProvider, PaymentStatus, RefundStatus, TestStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { PawapayApiService } from './pawapay-api.service';
import { PawapayRefundFinalizationService } from './pawapay-refund-finalization.service';

@Injectable()
export class PawapayRefundsService {
  private readonly logger = new Logger(PawapayRefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: PawapayApiService,
    private readonly finalization: PawapayRefundFinalizationService,
  ) {}

  async initiatePending(limit = 10) {
    const candidates = await this.prisma.refund.findMany({
      where: {
        provider: PaymentProvider.PAWAPAY,
        status: RefundStatus.CREATED,
        providerReference: null,
        reason: 'INVITATION_EXPIRED_24H',
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 50),
    });

    const summary = {
      inspected: candidates.length,
      reserved: 0,
      accepted: 0,
      rejected: 0,
      uncertain: 0,
      skipped: 0,
    };

    for (const candidate of candidates) {
      const refund = await this.prisma.refund.findUnique({
        where: { id: candidate.id },
        include: {
          test: true,
          payment: true,
        },
      });

      if (!refund) {
        summary.skipped++;
        continue;
      }

      const payment = refund.payment;

      if (
        refund.test.status !== TestStatus.REFUND_PENDING ||
        refund.amount <= 0n ||
        refund.amount !== refund.test.rewardAmount ||
        refund.currency !== refund.test.currency ||
        !payment ||
        payment.testId !== refund.testId ||
        payment.provider !== PaymentProvider.PAWAPAY ||
        payment.status !== PaymentStatus.SUCCEEDED ||
        !payment.confirmedAt ||
        payment.currency !== refund.currency ||
        payment.amount < refund.amount ||
        !payment.providerReference ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          payment.providerReference,
        )
      ) {
        this.logger.warn(`Remboursement ${refund.id} non éligible`);
        summary.skipped++;
        continue;
      }

      const claim = await this.prisma.refund.updateMany({
        where: {
          id: refund.id,
          status: RefundStatus.CREATED,
          providerReference: null,
        },
        data: {
          status: RefundStatus.PENDING,
          providerReference: refund.id,
        },
      });

      if (claim.count !== 1) {
        summary.skipped++;
        continue;
      }

      summary.reserved++;

      try {
        const response = await this.api.initiateRefund({
          refundId: refund.id,
          depositId: payment.providerReference,
          amount: refund.amount.toString(),
          currency: refund.currency,
          clientReferenceId: refund.idempotencyKey,
        });

        if (response.refundId !== refund.id) {
          summary.uncertain++;
          continue;
        }

        if (response.status === 'ACCEPTED' || response.status === 'DUPLICATE_IGNORED') {
          summary.accepted++;
          continue;
        }

        if (response.status === 'REJECTED') {
          await this.prisma.refund.updateMany({
            where: {
              id: refund.id,
              status: RefundStatus.PENDING,
            },
            data: {
              status: RefundStatus.REQUIRES_REVIEW,
            },
          });

          summary.rejected++;
          continue;
        }

        summary.uncertain++;
      } catch (error) {
        this.logger.error(
          `Remboursement ${refund.id} : résultat incertain`,
          error instanceof Error ? error.message : String(error),
        );

        // Ne jamais renvoyer automatiquement le POST.
        summary.uncertain++;
      }
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
      include: {
        payment: true,
      },
      orderBy: { updatedAt: 'asc' },
      take: Math.min(Math.max(Math.trunc(limit) || 1, 1), 100),
    });

    const summary = {
      inspected: refunds.length,
      finalized: 0,
      alreadyFinalized: 0,
      pending: 0,
      requiresReview: 0,
      errors: 0,
    };

    for (const refund of refunds) {
      const reference = refund.providerReference;
      const payment = refund.payment;
      const depositId = payment?.providerReference;

      // Vérifier le lien entre le remboursement et le dépôt initial.
      if (
        !reference ||
        reference !== refund.id ||
        !depositId ||
        !payment ||
        payment.provider !== PaymentProvider.PAWAPAY ||
        payment.status !== PaymentStatus.SUCCEEDED ||
        payment.testId !== refund.testId ||
        payment.currency !== refund.currency ||
        refund.amount <= 0n ||
        refund.amount > payment.amount
      ) {
        this.logger.error(`Données locales incohérentes pour le remboursement ${refund.id}`);

        summary.requiresReview++;
        continue;
      }

      try {
        // GET /v2/refunds/{refundId}
        // Cet appel consulte uniquement le statut distant.
        const result = await this.api.getRefund(reference);

        if (result.status !== 'FOUND' || !result.data) {
          summary.pending++;
          continue;
        }

        const data = result.data;

        // pawaPay v2 ne garantit pas depositId dans cette réponse.
        // On vérifie donc les champs réellement nécessaires.
        const validAmount = typeof data.amount === 'string' && /^\d+(?:\.\d+)?$/.test(data.amount);

        let amountMatch = false;

        if (validAmount) {
          const [integerPart, decimalPart = ''] = data.amount.split('.');

          amountMatch =
            !!integerPart && /^0*$/.test(decimalPart) && BigInt(integerPart) === refund.amount;
        }

        if (data.refundId !== reference || data.currency !== refund.currency || !amountMatch) {
          this.logger.error(`Réponse pawaPay incohérente pour le remboursement ${refund.id}`);

          summary.requiresReview++;
          continue;
        }

        // Seule la confirmation COMPLETED autorise
        // la finalisation financière dans TrueBond.
        if (data.status === 'COMPLETED') {
          const outcome = await this.finalization.finalizeConfirmedRefund(refund.id, {
            refundId: data.refundId,
            // Le dépôt d'origine provient de notre base,
            // et non d'un champ absent de la réponse pawaPay.
            depositId,
            amount: data.amount,
            currency: data.currency,
            status: 'COMPLETED',
          });

          if (outcome === 'FINALIZED') {
            summary.finalized++;
          } else if (outcome === 'ALREADY_FINALIZED') {
            summary.alreadyFinalized++;
          } else {
            throw new Error(`Résultat de finalisation inconnu : ${String(outcome)}`);
          }

          continue;
        }

        // Un remboursement refusé par pawaPay
        // nécessite un examen avant toute nouvelle tentative.
        if (data.status === 'FAILED') {
          const updated = await this.prisma.refund.updateMany({
            where: {
              id: refund.id,
              status: RefundStatus.PENDING,
            },
            data: {
              status: RefundStatus.REQUIRES_REVIEW,
            },
          });

          if (updated.count === 1) {
            summary.requiresReview++;
          } else {
            summary.pending++;
          }

          continue;
        }

        // Le remboursement est toujours en traitement.
        if (data.status === 'PROCESSING') {
          summary.pending++;
          continue;
        }

        // Ne pas assimiler un statut inconnu à un succès.
        this.logger.error(
          `Statut pawaPay inconnu pour le remboursement ${refund.id}: ${String(data.status)}`,
        );

        summary.requiresReview++;
      } catch (error) {
        this.logger.error(
          `Erreur de réconciliation ${refund.id}`,
          error instanceof Error ? (error.stack ?? error.message) : String(error),
        );

        summary.errors++;
      }
    }

    return summary;
  }
}
