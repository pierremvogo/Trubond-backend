import 'dotenv/config';

import { NestFactory } from '@nestjs/core';

import { InvitationTestModule } from './invitation-test.module';
import { OutboxProcessor } from '../src/outbox/outbox.processor';

async function main(): Promise<void> {
  const eventId = '961ff5cf-2890-40f1-a509-9e03f04a6114';

  if (process.env.CONFIRM_RENDER_INVITATION_TEST !== 'YES') {
    throw new Error('Test non autorisé : CONFIRM_RENDER_INVITATION_TEST doit être YES');
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL est absente');
  }

  const url = new URL(databaseUrl);

  if (!url.hostname.endsWith('.render.com')) {
    throw new Error('La connexion ne pointe pas vers PostgreSQL Render');
  }

  if (url.searchParams.get('sslmode') !== 'require') {
    throw new Error('La connexion Render doit utiliser sslmode=require');
  }

  const app = await NestFactory.createApplicationContext(InvitationTestModule, {
    logger: ['error', 'warn'],
  });

  try {
    const processor = app.get(OutboxProcessor);

    console.log('Traitement du deuxieme événement test.funded');

    const success = await processor.processOneFundedEvent(eventId);

    if (!success) {
      throw new Error('Événement non traité : vérifier son état dans PostgreSQL');
    }

    console.log('SUCCÈS : deuxieme événement traité');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Erreur du test :', error instanceof Error ? error.message : 'Erreur inconnue');

  process.exitCode = 1;
});
