import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaymentProvider, RefundStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PawapayRefundsService } from './pawapay-refunds.service';

const TARGET_REFUND_ID = '8d0c681a-f9d0-4c25-a355-5c17ea7eb327';
const TARGET_TEST_ID = '3a417534-f121-438d-a0f7-1cde882a6d8c';
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

    const targetId = process.env.PAWAPAY_REFUND_TARGET_ID?.trim();
    if (targetId !== TARGET_REFUND_ID || EXCLUDED_REFUNDS.includes(targetId)) {
      this.logger.warn('Scheduler pawaPay suspendu : remboursement cible non autorisé');
      return;
    }

    const raw = process.env.PAWAPAY_REFUND_AUTOMATION_START_AT;
    if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw)) {
      this.logger.error('PAWAPAY_REFUND_AUTOMATION_START_AT doit être une date ISO UTC explicite');
      return;
    }
    const cutoff = new Date(raw);
    if (Number.isNaN(cutoff.getTime())) {
      this.logger.error('Date d’activation du scheduler invalide');
      return;
    }
    if (Date.now() < cutoff.getTime()) {
      this.logger.log(`Scheduler pawaPay en attente. Activation prévue : ${cutoff.toISOString()}`);
      return;
    }

    this.running = true;
    try {
      let anomalies = 0;
      // Ne réconcilier que le remboursement ciblé.
      const pending = await this.prisma.refund.findMany({
        where: {
          id: TARGET_REFUND_ID,
          testId: TARGET_TEST_ID,
          provider: PaymentProvider.PAWAPAY,
          status: RefundStatus.PENDING,
          providerReference: TARGET_REFUND_ID,
          createdAt: { gte: cutoff },
        },
        select: { id: true },
        take: 1,
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

      // N'initier que le remboursement précis de 45 000 XAF.
      const created = await this.prisma.refund.findMany({
        where: {
          id: TARGET_REFUND_ID,
          testId: TARGET_TEST_ID,
          provider: PaymentProvider.PAWAPAY,
          status: RefundStatus.CREATED,
          providerReference: null,
          amount: 45000n,
          currency: 'XAF',
          reason: 'INVITATION_EXPIRED_24H',
          idempotencyKey: `test-expiry-${TARGET_TEST_ID}`,
          createdAt: { gte: cutoff },
        },
        select: { id: true },
        take: 1,
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
      this.logger.log(`Remboursements à réconcilier : ${pending.length}`);
      this.logger.log(`Nouveaux remboursements éligibles : ${created.length}`);
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
