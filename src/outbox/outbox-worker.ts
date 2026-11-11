import 'dotenv/config';

import { NestFactory } from '@nestjs/core';

import { OutboxWorkerModule } from './outbox-worker.module';
import { OutboxProcessor } from './outbox.processor';

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

  if (mode !== 'INSPECT' && mode !== 'PROCESS_ONCE') {
    throw new Error('Mode non autorisé : utiliser INSPECT ou PROCESS_ONCE');
  }

  if (mode === 'PROCESS_ONCE' && process.env.CONFIRM_OUTBOX_PROCESSING !== 'YES') {
    throw new Error('Traitement interdit : CONFIRM_OUTBOX_PROCESSING doit être YES');
  }

  const app = await NestFactory.createApplicationContext(OutboxWorkerModule, {
    logger: ['error', 'warn'],
  });

  try {
    const processor = app.get(OutboxProcessor);

    if (mode === 'INSPECT') {
      console.log('Inspection des événements Outbox en attente');

      const count = await processor.inspectPendingEvents();

      console.log(`${count} événement(s) en attente`);
      console.log('Aucun événement traité');

      return;
    }

    console.log('Recherche d’un événement test.funded disponible');

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
