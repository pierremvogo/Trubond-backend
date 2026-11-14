import { OutboxProcessor } from './outbox.processor';
import { runOutboxWorkerCycle } from './outbox-worker-cycle';

describe('Outbox Worker - cycle de traitement', () => {
  const recoverStuckFundedEvents = jest.fn();
  const findPendingFundedEventIds = jest.fn();
  const processOneFundedEvent = jest.fn();

  let processor: OutboxProcessor;

  beforeEach(() => {
    jest.resetAllMocks();

    processor = {
      recoverStuckFundedEvents,
      findPendingFundedEventIds,
      processOneFundedEvent,
    } as unknown as OutboxProcessor;

    recoverStuckFundedEvents.mockResolvedValue(0);
    findPendingFundedEventIds.mockResolvedValue([]);
    processOneFundedEvent.mockResolvedValue(true);
  });

  it('ne fait rien si un arrêt est déjà demandé', async () => {
    await runOutboxWorkerCycle(processor, () => true);

    expect(recoverStuckFundedEvents).not.toHaveBeenCalled();
    expect(findPendingFundedEventIds).not.toHaveBeenCalled();
    expect(processOneFundedEvent).not.toHaveBeenCalled();
  });

  it('récupère les événements bloqués avant de rechercher les événements en attente', async () => {
    await runOutboxWorkerCycle(processor, () => false);

    expect(recoverStuckFundedEvents).toHaveBeenCalledTimes(1);
    expect(findPendingFundedEventIds).toHaveBeenCalledWith(1);

    expect(recoverStuckFundedEvents.mock.invocationCallOrder[0]).toBeLessThan(
      findPendingFundedEventIds.mock.invocationCallOrder[0]!,
    );
  });

  it('traite un événement disponible', async () => {
    findPendingFundedEventIds.mockResolvedValue(['event-123']);

    await runOutboxWorkerCycle(processor, () => false);

    expect(processOneFundedEvent).toHaveBeenCalledTimes(1);
    expect(processOneFundedEvent).toHaveBeenCalledWith('event-123');
  });

  it('ne traite aucun événement si la file est vide', async () => {
    await runOutboxWorkerCycle(processor, () => false);

    expect(processOneFundedEvent).not.toHaveBeenCalled();
  });

  it('ne lance pas de traitement si un arrêt est demandé après la récupération', async () => {
    let stopRequested = false;

    recoverStuckFundedEvents.mockImplementation(async () => {
      stopRequested = true;
      return 0;
    });

    await runOutboxWorkerCycle(processor, () => stopRequested);

    expect(findPendingFundedEventIds).not.toHaveBeenCalled();
    expect(processOneFundedEvent).not.toHaveBeenCalled();
  });

  it('ne traite pas un événement si un arrêt est demandé après la sélection', async () => {
    let stopRequested = false;

    findPendingFundedEventIds.mockImplementation(async () => {
      stopRequested = true;
      return ['event-123'];
    });

    await runOutboxWorkerCycle(processor, () => stopRequested);

    expect(processOneFundedEvent).not.toHaveBeenCalled();
  });

  it('transmet une erreur de récupération sans lancer de traitement', async () => {
    recoverStuckFundedEvents.mockRejectedValue(new Error('Erreur de connexion PostgreSQL'));

    await expect(runOutboxWorkerCycle(processor, () => false)).rejects.toThrow(
      'Erreur de connexion PostgreSQL',
    );

    expect(findPendingFundedEventIds).not.toHaveBeenCalled();
    expect(processOneFundedEvent).not.toHaveBeenCalled();
  });

  it('transmet une erreur de traitement après la sélection', async () => {
    findPendingFundedEventIds.mockResolvedValue(['event-123']);

    processOneFundedEvent.mockRejectedValue(new Error('Erreur pendant le traitement'));

    await expect(runOutboxWorkerCycle(processor, () => false)).rejects.toThrow(
      'Erreur pendant le traitement',
    );

    expect(recoverStuckFundedEvents).toHaveBeenCalledTimes(1);
    expect(findPendingFundedEventIds).toHaveBeenCalledWith(1);
    expect(processOneFundedEvent).toHaveBeenCalledWith('event-123');
  });

  it('continue normalement lorsqu’un événement ne peut pas être traité', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      findPendingFundedEventIds.mockResolvedValue(['event-123']);
      processOneFundedEvent.mockResolvedValue(false);

      await expect(runOutboxWorkerCycle(processor, () => false)).resolves.toBeUndefined();

      expect(processOneFundedEvent).toHaveBeenCalledWith('event-123');

      expect(warnSpy).toHaveBeenCalledWith('Événement event-123 non traité');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('transmet une erreur de sélection sans lancer de traitement', async () => {
    findPendingFundedEventIds.mockRejectedValue(new Error('Erreur de sélection Outbox'));

    await expect(runOutboxWorkerCycle(processor, () => false)).rejects.toThrow(
      'Erreur de sélection Outbox',
    );

    expect(recoverStuckFundedEvents).toHaveBeenCalledTimes(1);
    expect(findPendingFundedEventIds).toHaveBeenCalledWith(1);
    expect(processOneFundedEvent).not.toHaveBeenCalled();
  });
});
