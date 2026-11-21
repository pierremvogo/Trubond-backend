import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { PaymentProvider, PaymentStatus, RefundStatus, TestStatus } from '@prisma/client';

import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { PawapayRefundsService } from '../payments/pawapay/pawapay-refunds.service';

type CommandMode = 'send' | 'reconcile';

const REFUND_ID = 'd00fbdd9-71a8-402a-b805-70ec90e5624e';

const DEPOSIT_ID = '18bd4e4e-1dbc-4398-a069-48d75ec508b6';

const EXPECTED_AMOUNT = 20000n;
const EXPECTED_CURRENCY = 'XAF';

function getMode(): CommandMode {
  const mode = process.argv[2];

  if (mode !== 'send' && mode !== 'reconcile') {
    throw new Error('Utilisation : refund-sandbox-once.js send|reconcile');
  }

  return mode;
}

function assertSandbox(): void {
  if (process.env.PAWAPAY_ENV !== 'SANDBOX') {
    throw new Error('Opération interdite : PAWAPAY_ENV doit être SANDBOX.');
  }

  if (process.env.ENABLE_PAWAPAY_REFUND_SENDING !== 'NO') {
    throw new Error(
      'Conserver ENABLE_PAWAPAY_REFUND_SENDING=NO ' + 'pour empêcher les envois automatiques.',
    );
  }

  if (process.env.OUTBOX_WORKER_MODE !== 'INSPECT_LOOP') {
    throw new Error('OUTBOX_WORKER_MODE doit être INSPECT_LOOP.');
  }
}

async function main(): Promise<void> {
  const mode = getMode();

  assertSandbox();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const refundsService = app.get(PawapayRefundsService);

    const refund = await prisma.refund.findUnique({
      where: {
        id: REFUND_ID,
      },
      include: {
        payment: true,
        test: true,
      },
    });

    if (!refund) {
      throw new Error(`Remboursement introuvable : ${REFUND_ID}`);
    }

    if (refund.provider !== PaymentProvider.PAWAPAY) {
      throw new Error('Le fournisseur du remboursement est incorrect.');
    }

    if (refund.amount !== EXPECTED_AMOUNT) {
      throw new Error('Montant incorrect : 20000 XAF attendus.');
    }

    if (refund.currency !== EXPECTED_CURRENCY) {
      throw new Error('Devise incorrecte : XAF attendu.');
    }

    if (!refund.payment) {
      throw new Error('Paiement associé introuvable.');
    }

    if (
      refund.payment.provider !== PaymentProvider.PAWAPAY ||
      refund.payment.status !== PaymentStatus.SUCCEEDED
    ) {
      throw new Error('Le paiement initial doit être confirmé par pawaPay.');
    }

    if (refund.payment.providerReference !== DEPOSIT_ID) {
      throw new Error('Le depositId ne correspond pas au dépôt attendu.');
    }

    if (refund.payment.testId !== refund.testId) {
      throw new Error('Le paiement et le remboursement ne concernent pas le même test.');
    }

    if (refund.payment.currency !== EXPECTED_CURRENCY) {
      throw new Error('La devise du paiement initial est incohérente.');
    }

    if (
      refund.test.status !== TestStatus.REFUND_PENDING &&
      refund.test.status !== TestStatus.REFUNDED
    ) {
      throw new Error('Le test ne se trouve pas dans un état compatible.');
    }

    console.log('--------------------------------');
    console.log('TRUEBOND - REMBOURSEMENT SANDBOX');
    console.log('--------------------------------');
    console.log('Mode :', mode);
    console.log('Refund ID :', refund.id);
    console.log('Deposit ID :', DEPOSIT_ID);
    console.log('Montant :', refund.amount.toString(), 'XAF');
    console.log('Statut :', refund.status);
    console.log('--------------------------------');

    if (mode === 'send') {
      if (refund.status !== RefundStatus.CREATED) {
        throw new Error('Envoi interdit : le remboursement n’est plus CREATED.');
      }

      if (refund.test.status !== TestStatus.REFUND_PENDING) {
        throw new Error('Envoi interdit : le test n’est pas REFUND_PENDING.');
      }

      /*
       * IMPORTANT
       *
       * initiatePending() accepte un nombre et traite un lot.
       * Ne jamais lui passer REFUND_ID ni appeler
       * initiatePending(1) pour ce test ciblé.
       *
       * La méthode initiateOne(refundId) doit être
       * implémentée dans PawapayRefundsService
       * avant de permettre cet envoi.
       */

      throw new Error(
        'ENVOI BLOQUÉ : ajouter initiateOne(refundId) ' +
          'dans PawapayRefundsService avant de déclencher ' +
          'ce remboursement ciblé.',
      );
    }

    if (mode === 'reconcile') {
      if (refund.status === RefundStatus.SUCCEEDED) {
        console.log('Remboursement déjà finalisé. Aucun nouvel appel nécessaire.');
        return;
      }

      if (refund.status !== RefundStatus.PENDING) {
        throw new Error('Réconciliation interdite : statut PENDING attendu.');
      }

      /*
       * reconcilePending() accepte un nombre et traite un lot.
       * Ne pas appeler reconcilePending(1).
       *
       * Une méthode reconcileOne(refundId) doit être
       * ajoutée au service avant la réconciliation ciblée.
       */

      throw new Error(
        'RÉCONCILIATION BLOQUÉE : ajouter reconcileOne(refundId) ' + 'dans PawapayRefundsService.',
      );
    }

    // Conserve une référence explicite au service injecté.
    void refundsService;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    '[TRUEBOND REFUND SANDBOX]',
    error instanceof Error ? error.message : String(error),
  );

  process.exitCode = 1;
});
