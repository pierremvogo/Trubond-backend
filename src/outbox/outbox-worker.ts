import 'dotenv/config';

import { NestFactory } from '@nestjs/core';

import { OutboxWorkerModule } from './outbox-worker.module';
import { OutboxProcessor } from './outbox.processor';
import { runOutboxWorkerCycle } from './outbox-worker-cycle';
import { TestExpirationService } from '../tests/test-expiration.service';
import { PawapayRefundsService } from '../payments/pawapay/pawapay-refunds.service';

let stopRequested = false;

process.once('SIGTERM', () => {
  console.log('Signal SIGTERM reçu : arrêt du worker demandé');
  stopRequested = true;
});

process.once('SIGINT', () => {
  console.log('Signal SIGINT reçu : arrêt du worker demandé');
  stopRequested = true;
});

async function sleep(milliseconds: number): Promise<void> {
  let elapsed = 0;

  while (elapsed < milliseconds && !stopRequested) {
    const waitTime = Math.min(1000, milliseconds - elapsed);

    await new Promise<void>((resolve) => setTimeout(resolve, waitTime));

    elapsed += waitTime;
  }
}

async function main(): Promise<void> {
  if (process.env.ENABLE_OUTBOX_WORKER !== 'YES') {
    console.log('Worker Outbox désactivé : ENABLE_OUTBOX_WORKER doit être YES');
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL est absente');
  }

  const mode = process.env.OUTBOX_WORKER_MODE;

  const allowedModes = [
    'INSPECT',
    'INSPECT_LOOP',
    'PROCESS_ONCE',
    'PROCESS_LOOP',
    'EXPIRATION_ONCE',
    'REFUND_RECONCILE_ONCE',
  ];

  if (!mode || !allowedModes.includes(mode)) {
    throw new Error(`Mode non autorisé : ${mode ?? 'absent'}`);
  }

  const processingModes = [
    'PROCESS_ONCE',
    'PROCESS_LOOP',
    'EXPIRATION_ONCE',
    'REFUND_RECONCILE_ONCE',
  ];

  if (processingModes.includes(mode) && process.env.CONFIRM_OUTBOX_PROCESSING !== 'YES') {
    throw new Error('Traitement interdit : CONFIRM_OUTBOX_PROCESSING doit être YES');
  }

  if (mode === 'PROCESS_LOOP' && process.env.CONFIRM_OUTBOX_LOOP !== 'YES') {
    throw new Error('Traitement continu interdit : CONFIRM_OUTBOX_LOOP doit être YES');
  }

  const app = await NestFactory.createApplicationContext(OutboxWorkerModule, {
    logger: ['error', 'warn'],
  });

  try {
    const processor = app.get(OutboxProcessor);
    const expirationService = app.get(TestExpirationService);

    // MODE 1 : réconciliation distante uniquement.
    // Aucun nouveau remboursement n'est initié ici.
    if (mode === 'REFUND_RECONCILE_ONCE') {
      if (stopRequested) {
        console.log('Arrêt demandé');
        return;
      }

      console.log('Worker : réconciliation des remboursements pawaPay');

      const refunds = app.get(PawapayRefundsService);

      const result = await refunds.reconcilePending(50);

      console.log('Résultat réconciliation :', JSON.stringify(result));

      if (result.errors > 0) {
        throw new Error('Certaines vérifications de remboursement ont échoué');
      }

      return;
    }

    // MODE 2 : traitement continu de l'Outbox.
    if (mode === 'PROCESS_LOOP') {
      console.log('Worker Outbox : traitement continu activé');

      while (!stopRequested) {
        try {
          await runOutboxWorkerCycle(processor, () => stopRequested, expirationService);
        } catch (error: unknown) {
          console.error(
            'Erreur pendant le traitement Outbox :',
            error instanceof Error ? error.message : 'Erreur inconnue',
          );
        }

        await sleep(60_000);
      }

      console.log('Worker Outbox : traitement continu arrêté');
      return;
    }

    // MODE 3 : inspection continue.
    if (mode === 'INSPECT_LOOP') {
      console.log('Worker Outbox : inspection continue activée');

      while (!stopRequested) {
        try {
          const count = await processor.inspectPendingEvents();

          console.log(
            `Inspection terminée : ${count} événement(s) en attente. Aucun événement traité.`,
          );
        } catch (error: unknown) {
          console.error(
            'Erreur pendant l’inspection Outbox :',
            error instanceof Error ? error.message : 'Erreur inconnue',
          );
        }

        await sleep(60_000);
      }

      console.log('Worker Outbox : arrêt propre terminé');
      return;
    }

    // MODE 4 : inspection ponctuelle.
    if (mode === 'INSPECT') {
      console.log('Inspection des événements Outbox en attente');

      const count = await processor.inspectPendingEvents();

      console.log(`${count} événement(s) en attente`);
      console.log('Aucun événement traité');

      return;
    }

    // MODE 5 : expiration ponctuelle uniquement.
    if (mode === 'EXPIRATION_ONCE') {
      if (stopRequested) {
        console.log('Arrêt demandé : aucune expiration lancée');
        return;
      }

      console.log('Worker Outbox : traitement ponctuel des expirations activé');

      console.log('Aucun traitement des événements test.funded ne sera lancé');

      const result = await expirationService.processExpiredInvitations(50);

      console.log(`Expirations : ${result.expired} test(s) passé(s) en REFUND_PENDING`);

      console.log(
        `Bilan : ${result.inspected} test(s) inspecté(s), ${result.expired} expiré(s), ${result.skipped} ignoré(s) ou en erreur`,
      );

      if (result.skipped > 0) {
        throw new Error(
          `${result.skipped} expiration(s) non effectuée(s) : consulter les journaux`,
        );
      }

      console.log('Traitement ponctuel des expirations terminé');

      return;
    }

    // MODE 6 : PROCESS_ONCE.
    // Expiration + un événement test.funded.
    if (stopRequested) {
      console.log('Arrêt demandé : aucun traitement lancé');
      return;
    }

    const result = await expirationService.processExpiredInvitations(50);

    console.log(`Expirations : ${result.expired} test(s) passé(s) en REFUND_PENDING`);

    if (stopRequested) {
      console.log('Arrêt demandé : aucun traitement lancé');
      return;
    }

    console.log('Recherche d’un événement test.funded disponible');

    const recoveredCount = await processor.recoverStuckFundedEvents();

    if (recoveredCount > 0) {
      console.log(`Récupération Outbox : ${recoveredCount} événement(s) débloqué(s) ou clôturé(s)`);
    }

    if (stopRequested) {
      console.log('Arrêt demandé : aucun traitement lancé');
      return;
    }

    const eventIds = await processor.findPendingFundedEventIds(1);

    if (eventIds.length === 0) {
      console.log('Aucun événement disponible');
      return;
    }

    const eventId = eventIds[0];

    if (!eventId) {
      throw new Error('Identifiant Outbox introuvable');
    }

    if (stopRequested) {
      console.log('Arrêt demandé : aucun traitement lancé');
      return;
    }

    console.log(`Traitement de l’événement ${eventId}`);

    const success = await processor.processOneFundedEvent(eventId);

    if (!success) {
      throw new Error('Événement non traité : vérifier son état avant de relancer');
    }

    console.log('Événement traité avec succès');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    'Erreur du worker Outbox :',
    error instanceof Error ? error.message : 'Erreur inconnue',
  );

  process.exitCode = 1;
});
