import { OutboxProcessor } from './outbox.processor';
import { TestExpirationService } from '../tests/test-expiration.service';

export async function runOutboxWorkerCycle(
  processor: OutboxProcessor,
  isStopRequested: () => boolean,
  expirationService?: TestExpirationService,
): Promise<void> {
  if (isStopRequested()) return;

  // Ne traiter les expirations que dans les modes PROCESS_*.
  if (expirationService) {
    const result = await expirationService.processExpiredInvitations(50);
    console.log(
      `Expirations : ${result.inspected} examinés, ${result.expired} expirés, ${result.skipped} ignorés`,
    );
  }

  if (isStopRequested()) return;

  const recoveredCount = await processor.recoverStuckFundedEvents();
  if (recoveredCount > 0) {
    console.log(`Récupération Outbox : ${recoveredCount} événement(s) débloqué(s) ou clôturé(s)`);
  }

  if (isStopRequested()) return;

  const eventIds = await processor.findPendingFundedEventIds(1);
  const eventId = eventIds[0];
  if (!eventId || isStopRequested()) return;

  const success = await processor.processOneFundedEvent(eventId);
  if (!success) console.warn(`Événement ${eventId} non traité`);
}
