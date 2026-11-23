import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaymentProvider, RefundStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PawapayRefundsService } from './pawapay-refunds.service';

const TARGET_REFUND_ID = '3fd94c11-13bd-4479-8ee0-0c654f8ce7e6';
const EXCLUDED_REFUNDS = ['d00fbdd9-71a8-402a-b805-70ec90e5624e'];
const AUTOMATED_REASONS = ['INVITATION_EXPIRED_24H', 'TEST_FAILED'];
const DEFAULT_STALE_MINUTES = 30;

@Injectable()
export class PawapayRefundsSchedulerService {
  private readonly logger = new Logger(PawapayRefundsSchedulerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly refunds: PawapayRefundsService,
  ) {}

  private getCutoff(): Date | null {
    const raw = process.env.PAWAPAY_REFUND_AUTOMATION_START_AT;
    if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw)) {
      this.logger.error('PAWAPAY_REFUND_AUTOMATION_START_AT : date UTC explicite obligatoire');
      return null;
    }
    const cutoff = new Date(raw);
    if (Number.isNaN(cutoff.getTime()) || cutoff.toISOString() !== new Date(raw).toISOString()) {
      this.logger.error('Date de démarrage des remboursements invalide');
      return null;
    }
    return cutoff;
  }

  private getStaleMinutes(): number {
    const raw = process.env.PAWAPAY_REFUND_STALE_MINUTES;
    if (!raw) return DEFAULT_STALE_MINUTES;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 5 || value > 10080) {
      this.logger.warn('PAWAPAY_REFUND_STALE_MINUTES invalide : valeur par défaut 30 min');
      return DEFAULT_STALE_MINUTES;
    }
    return value;
  }

  @Cron('*/5 * * * *', {
    name: 'pawapay-sandbox-refunds',
    timeZone: 'UTC',
    waitForCompletion: true,
  })
  async execute(): Promise<void> {
    if (this.running) return;
    if (process.env.PAWAPAY_ENV?.trim().toUpperCase() !== 'SANDBOX') return;

    const cutoff = this.getCutoff();
    if (!cutoff || Date.now() < cutoff.getTime()) return;

    this.running = true;
    try {
      // Surveillance en lecture seule, même si les envois automatiques sont désactivés.
      const staleBefore = new Date(Date.now() - this.getStaleMinutes() * 60_000);
      const baseWhere = {
        provider: PaymentProvider.PAWAPAY,
        reason: { in: AUTOMATED_REASONS },
        OR: [{ createdAt: { gte: cutoff } }, { id: TARGET_REFUND_ID }],
        id: { notIn: EXCLUDED_REFUNDS },
      };

      const [stalePending, reviewCount] = await Promise.all([
        this.prisma.refund.findMany({
          where: {
            ...baseWhere,
            status: RefundStatus.PENDING,
            updatedAt: { lte: staleBefore },
          },
          select: { id: true, updatedAt: true, providerReference: true },
          orderBy: { updatedAt: 'asc' },
          take: 25,
        }),
        this.prisma.refund.count({
          where: { ...baseWhere, status: RefundStatus.REQUIRES_REVIEW },
        }),
      ]);

      if (stalePending.length) {
        this.logger.warn(
          `ALERTE_REMBOURSEMENT: ${stalePending.length} remboursement(s) PENDING ancien(s) ` +
            `(échantillon limité à 25, seuil ${this.getStaleMinutes()} min). ` +
            `IDs: ${stalePending.map((r) => r.id).join(', ')}. ` +
            'Ne pas relancer de POST ; vérifier pawaPay et les journaux.',
        );
      }
      if (reviewCount > 0) {
        this.logger.warn(
          `ALERTE_REMBOURSEMENT: ${reviewCount} remboursement(s) REQUIRES_REVIEW. ` +
            'Intervention humaine requise ; aucun renvoi automatique.',
        );
      }

      // Aucun appel pawaPay lorsque le mode de sécurité n'est pas entièrement activé.
      if (
        process.env.OUTBOX_WORKER_MODE !== 'INSPECT_LOOP' ||
        process.env.ENABLE_PAWAPAY_REFUND_SENDING !== 'NO' ||
        process.env.PAWAPAY_REFUND_AUTOMATION !== 'YES'
      )
        return;

      let anomalies = 0;
      const pending = await this.prisma.refund.findMany({
        where: {
          ...baseWhere,
          status: RefundStatus.PENDING,
          providerReference: { not: null },
        },
        select: { id: true },
        orderBy: { updatedAt: 'asc' },
        take: 50,
      });
      for (const row of pending) {
        try {
          const result = await this.refunds.reconcileOne(row.id);
          anomalies += result.errors + result.requiresReview;
          this.logger.log(`Réconciliation ${row.id}: ${JSON.stringify(result)}`);
        } catch (error) {
          anomalies++;
          this.logger.error(
            `Réconciliation ${row.id} : ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      const created = await this.prisma.refund.findMany({
        where: {
          ...baseWhere,
          status: RefundStatus.CREATED,
          providerReference: null,
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });
      for (const row of created) {
        try {
          const result = await this.refunds.initiateAutomatedOne(row.id, cutoff);
          anomalies += result.uncertain + result.rejected;
          this.logger.log(`Initiation ${row.id}: ${JSON.stringify(result)}`);
        } catch (error) {
          anomalies++;
          this.logger.error(
            `Initiation ${row.id} : ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      this.logger.log(
        `Réconciliation : ${pending.length}; initiations éligibles : ${created.length}`,
      );
      if (anomalies) this.logger.warn(`${anomalies} remboursement(s) à examiner`);
    } catch (error) {
      this.logger.error(
        'Cycle pawaPay interrompu',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
