import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { PaymentProvider, PaymentStatus, RefundStatus, TestStatus } from '@prisma/client';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { PawapayRefundsService } from '../payments/pawapay/pawapay-refunds.service';

type Mode = 'send' | 'reconcile';
const REFUND_ID = 'd00fbdd9-71a8-402a-b805-70ec90e5624e';
const DEPOSIT_ID = '18bd4e4e-1dbc-4398-a069-48d75ec508b6';

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg !== 'send' && arg !== 'reconcile') {
    throw new Error('Usage: node dist/scripts/refund-sandbox-once.js send|reconcile');
  }
  const mode: Mode = arg;
  if (process.env.PAWAPAY_ENV?.trim().toUpperCase() !== 'SANDBOX') {
    throw new Error('PAWAPAY_ENV=SANDBOX requis');
  }
  if (
    process.env.OUTBOX_WORKER_MODE !== 'INSPECT_LOOP' ||
    process.env.ENABLE_PAWAPAY_REFUND_SENDING !== 'NO'
  ) {
    throw new Error(
      'Worker non sécurisé : INSPECT_LOOP et ENABLE_PAWAPAY_REFUND_SENDING=NO requis',
    );
  }
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const prisma = app.get(PrismaService);
    const service = app.get(PawapayRefundsService);
    const refund = await prisma.refund.findUnique({
      where: { id: REFUND_ID },
      include: { payment: true, test: true },
    });
    if (
      !refund ||
      refund.provider !== PaymentProvider.PAWAPAY ||
      refund.amount !== 20000n ||
      refund.currency !== 'XAF' ||
      refund.test.rewardAmount !== 20000n ||
      refund.payment?.provider !== PaymentProvider.PAWAPAY ||
      refund.payment.status !== PaymentStatus.SUCCEEDED ||
      !refund.payment.confirmedAt ||
      refund.payment.testId !== refund.testId ||
      refund.payment.currency !== 'XAF' ||
      refund.payment.providerReference !== DEPOSIT_ID ||
      refund.test.status !== TestStatus.REFUND_PENDING ||
      refund.status !== RefundStatus.PENDING ||
      refund.providerReference !== REFUND_ID
    ) {
      throw new Error('Contrôle du remboursement ciblé échoué : aucun appel distant');
    }

    if (mode === 'send') {
      const result = await service.sendManualSandboxOnce(REFUND_ID);
      console.log('Résultat initiation manuelle :', result);
      if (result !== 'ACCEPTED' && result !== 'DUPLICATE_IGNORED') {
        throw new Error('Initiation non confirmée : réconcilier, ne jamais relancer send');
      }
    } else {
      const result = await service.reconcileOne(REFUND_ID);
      console.log('Résultat réconciliation :', result);
      if (result.errors > 0 || result.requiresReview > 0) {
        throw new Error('Réconciliation à examiner manuellement');
      }
    }
  } finally {
    await app.close();
  }
}
main().catch((error: unknown) => {
  console.error('[REFUND SANDBOX]', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
