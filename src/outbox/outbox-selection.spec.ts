
import { OutboxStatus } from '@prisma/client';

import { OutboxProcessor } from './outbox.processor';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from '../invitations/invitations.service';

describe('OutboxProcessor - sélection des événements', () => {
  const findMany = jest.fn();

  let processor: OutboxProcessor;

  beforeEach(() => {
    jest.clearAllMocks();

    const prisma = {
      outboxEvent: {
        findMany,
      },
    } as unknown as PrismaService;

    const invitations = {} as InvitationsService;

    processor = new OutboxProcessor(prisma, invitations);
  });

  it('sélectionne uniquement les événements disponibles', async () => {
    findMany.mockResolvedValueOnce([
      { id: 'event-1' },
      { id: 'event-2' },
    ]);

    const result = await processor.findPendingFundedEventIds();

    expect(result).toEqual(['event-1', 'event-2']);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        eventType: 'test.funded',
        status: OutboxStatus.PENDING,
        availableAt: {
          lte: expect.any(Date),
        },
        attempts: {
          lt: 5,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: 5,
      select: {
        id: true,
      },
    });
  });

  it('limite la sélection à cinq événements maximum', async () => {
    findMany.mockResolvedValueOnce([]);

    await processor.findPendingFundedEventIds(100);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5,
      }),
    );
  });

  it('respecte une limite inférieure à cinq', async () => {
    findMany.mockResolvedValueOnce([]);

    await processor.findPendingFundedEventIds(2);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
      }),
    );
  });
});
