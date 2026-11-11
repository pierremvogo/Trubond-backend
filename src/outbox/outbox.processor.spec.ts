
import { OutboxStatus } from '@prisma/client';

import { OutboxProcessor } from './outbox.processor';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from '../invitations/invitations.service';

describe('OutboxProcessor - récupération des événements bloqués', () => {
  const updateMany = jest.fn();

  let processor: OutboxProcessor;

  beforeEach(() => {
    jest.clearAllMocks();

    const prisma = {
      outboxEvent: {
        updateMany,
      },
    } as unknown as PrismaService;

    const invitations = {} as InvitationsService;

    processor = new OutboxProcessor(prisma, invitations);
  });

  it('récupère les événements avec moins de 5 tentatives', async () => {
    updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const result = await processor.recoverStuckFundedEvents();

    expect(result).toBe(1);
    expect(updateMany).toHaveBeenCalledTimes(2);

    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          eventType: 'test.funded',
          status: OutboxStatus.PROCESSING,
          attempts: { lt: 5 },
        }),
        data: expect.objectContaining({
          status: OutboxStatus.PENDING,
          lockedAt: null,
        }),
      }),
    );
  });

  it('marque FAILED les événements ayant atteint 5 tentatives', async () => {
    updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const result = await processor.recoverStuckFundedEvents();

    expect(result).toBe(1);

    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          eventType: 'test.funded',
          status: OutboxStatus.PROCESSING,
          attempts: { gte: 5 },
        }),
        data: expect.objectContaining({
          status: OutboxStatus.FAILED,
          lockedAt: null,
        }),
      }),
    );
  });

  it('ne signale aucune récupération lorsque la file est vide', async () => {
    updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });

    const result = await processor.recoverStuckFundedEvents();

    expect(result).toBe(0);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
