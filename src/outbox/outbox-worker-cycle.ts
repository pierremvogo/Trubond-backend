import { OutboxProcessor } from './outbox.processor';

export async function runOutboxWorkerCycle(
  processor: OutboxProcessor,
  isStopRequested: () => boolean,
): Promise<void> {
  if (isStopRequested()) {
    return;
  }

  const recoveredCount = await processor.recoverStuckFundedEvents();

  if (recoveredCount > 0) {
    console.log(`Récupération Outbox : ${recoveredCount} événement(s) débloqué(s) ou clôturé(s)`);
  }

  if (isStopRequested()) {
    return;
  }

  const eventIds = await processor.findPendingFundedEventIds(1);

  const eventId = eventIds[0];

  if (!eventId || isStopRequested()) {
    return;
  }

  const success = await processor.processOneFundedEvent(eventId);

  if (!success) {
    console.warn(`Événement ${eventId} non traité`);
  }
}
