import 'dotenv/config';

import { NestFactory } from '@nestjs/core';

import { OutboxWorkerModule } from './outbox-worker.module';
import { OutboxProcessor } from './outbox.processor';

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
  const interval = 1_000;
  let elapsed = 0;

  while (elapsed < milliseconds && !stopRequested) {
    const waitTime = Math.min(interval, milliseconds - elapsed);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, waitTime);
    });

    elapsed += waitTime;
  }
}

async function main(): Promise<void> {
  if (process.env.ENABLE_OUTBOX_WORKER !== 'YES') {
    console.log('Worker Outbox désactivé : ENABLE_OUTBOX_WORKER doit être YES');
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL est absente');
  }

  const mode = process.env.OUTBOX_WORKER_MODE;

  if (
    mode !== 'INSPECT' &&
    mode !== 'INSPECT_LOOP' &&
    mode !== 'PROCESS_ONCE' &&
    mode !== 'PROCESS_LOOP'
  ) {
    throw new Error(
      'Mode non autorisé : utiliser INSPECT, INSPECT_LOOP, PROCESS_ONCE ou PROCESS_LOOP',
    );
  }

  if (
    (mode === 'PROCESS_ONCE' || mode === 'PROCESS_LOOP') &&
    process.env.CONFIRM_OUTBOX_PROCESSING !== 'YES'
  ) {
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

    if (mode === 'PROCESS_LOOP') {
      console.log('Worker Outbox : traitement continu activé');

      while (!stopRequested) {
        try {
          const eventIds = await processor.findPendingFundedEventIds(1);

          const eventId = eventIds[0];

          if (eventId && !stopRequested) {
            const success = await processor.processOneFundedEvent(eventId);

            if (!success) {
              console.warn(`Événement ${eventId} non traité`);
            }
          }
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

    if (mode === 'INSPECT') {
      console.log('Inspection des événements Outbox en attente');

      const count = await processor.inspectPendingEvents();

      console.log(`${count} événement(s) en attente`);
      console.log('Aucun événement traité');

      return;
    }

    console.log('Recherche d’un événement test.funded disponible');

    const recoveredCount = await processor.recoverStuckFundedEvents();

    if (recoveredCount > 0) {
      console.log(`Récupération Outbox : ${recoveredCount} événement(s) débloqué(s) ou clôturé(s)`);
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
