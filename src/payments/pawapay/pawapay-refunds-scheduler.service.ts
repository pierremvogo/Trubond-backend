import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaymentProvider, RefundStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PawapayRefundsService } from './pawapay-refunds.service';

const EXCLUDED_REFUNDS = [
  'd00fbdd9-71a8-402a-b805-70ec90e5624e',
  '3fd94c11-13bd-4479-8ee0-0c654f8ce7e6',
];

@Injectable()
export class PawapayRefundsSchedulerService {
  private readonly logger = new Logger(PawapayRefundsSchedulerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly refunds: PawapayRefundsService,
  ) {}

  @Cron('*/5 * * * *', {
    name: 'pawapay-sandbox-refunds',
    timeZone: 'UTC',
    waitForCompletion: true,
  })
  async execute(): Promise<void> {
    if (this.running) return;
    if (
      process.env.PAWAPAY_ENV?.trim().toUpperCase() !== 'SANDBOX' ||
      process.env.OUTBOX_WORKER_MODE !== 'INSPECT_LOOP' ||
      process.env.ENABLE_PAWAPAY_REFUND_SENDING !== 'NO' ||
      process.env.PAWAPAY_REFUND_AUTOMATION !== 'YES'
    )
      return;

    const raw = process.env.PAWAPAY_REFUND_AUTOMATION_START_AT;
    if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw)) {
      this.logger.error('PAWAPAY_REFUND_AUTOMATION_START_AT doit être une date ISO UTC explicite');
      return;
    }
    const cutoff = new Date(raw);
    if (Number.isNaN(cutoff.getTime()) || Date.now() < cutoff.getTime()) return;

    this.running = true;
    try {
      // Ne pas maintenir une transaction SQL ouverte pendant des appels HTTP.
      // La sécurité multi-instances et anti-double-POST doit être assurée
      // atomiquement par initiateAutomatedOne et la couche de persistance.
      let anomalies = 0;
      const pending = await this.prisma.refund.findMany({
        where: {
          provider: PaymentProvider.PAWAPAY,
          status: RefundStatus.PENDING,
          providerReference: { not: null },
          createdAt: { gte: cutoff },
          id: { notIn: EXCLUDED_REFUNDS },
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
            `Échec réconciliation ${row.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      const created = await this.prisma.refund.findMany({
        where: {
          provider: PaymentProvider.PAWAPAY,
          status: RefundStatus.CREATED,
          providerReference: null,
          reason: 'INVITATION_EXPIRED_24H',
          createdAt: { gte: cutoff },
          id: { notIn: EXCLUDED_REFUNDS },
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
            `Échec initiation ${row.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
      if (anomalies) this.logger.warn(`${anomalies} opération(s) nécessitent une vérification`);
    } catch (error) {
      this.logger.error(
        'Cycle de remboursements interrompu',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
