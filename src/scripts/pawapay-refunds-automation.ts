import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { PaymentProvider, RefundStatus } from '@prisma/client';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { PawapayRefundsService } from '../payments/pawapay/pawapay-refunds.service';

const EXCLUDED_IDS = [
  'd00fbdd9-71a8-402a-b805-70ec90e5624e',
  '3fd94c11-13bd-4479-8ee0-0c654f8ce7e6',
];

async function main(): Promise<void> {
  if (
    process.env.PAWAPAY_ENV?.trim().toUpperCase() !== 'SANDBOX' ||
    process.env.OUTBOX_WORKER_MODE !== 'INSPECT_LOOP' ||
    process.env.ENABLE_PAWAPAY_REFUND_SENDING !== 'NO' ||
    process.env.PAWAPAY_REFUND_AUTOMATION !== 'YES'
  ) {
    throw new Error('Automatisation non autorisée : configuration Sandbox requise');
  }
  const cutoffValue = process.env.PAWAPAY_REFUND_AUTOMATION_START_AT;
  if (!cutoffValue || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(cutoffValue)) {
    throw new Error('PAWAPAY_REFUND_AUTOMATION_START_AT doit être une date UTC ISO explicite');
  }
  const cutoff = new Date(cutoffValue);
  if (Number.isNaN(cutoff.getTime())) throw new Error('Date de début invalide');

  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const prisma = app.get(PrismaService);
    const service = app.get(PawapayRefundsService);
    // Réconcilier en premier : aucune réémission d'un PENDING.
    const pending = await prisma.refund.findMany({
      where: {
        provider: PaymentProvider.PAWAPAY,
        status: RefundStatus.PENDING,
        providerReference: { not: null },
        createdAt: { gte: cutoff },
        id: { notIn: EXCLUDED_IDS },
      },
      select: { id: true },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });
    let errors = 0;
    for (const row of pending) {
      const result = await service.reconcileOne(row.id);
      console.log('reconcile', row.id, result);
      errors += result.errors + result.requiresReview;
    }

    const created = await prisma.refund.findMany({
      where: {
        provider: PaymentProvider.PAWAPAY,
        status: RefundStatus.CREATED,
        providerReference: null,
        reason: 'INVITATION_EXPIRED_24H',
        createdAt: { gte: cutoff },
        id: { notIn: EXCLUDED_IDS },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    for (const row of created) {
      const result = await service.initiateAutomatedOne(row.id, cutoff);
      console.log('initiate', row.id, result);
      errors += result.uncertain + result.rejected;
    }
    if (errors) throw new Error(`${errors} remboursement(s) à examiner ; aucun retry automatique`);
  } finally {
    await app.close();
  }
}
main().catch((error: unknown) => {
  console.error(
    '[PAWAPAY REFUND AUTOMATION]',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
