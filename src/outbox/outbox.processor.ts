import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OutboxStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OutboxProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.inspectPendingEvents();
    } catch (error) {
      this.logger.error(
        'Impossible de consulter les événements outbox',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async inspectPendingEvents(): Promise<number> {
    const events = await this.prisma.outboxEvent.findMany({
      where: {
        eventType: 'test.funded',
        status: OutboxStatus.PENDING,
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: 20,
      select: {
        id: true,
        aggregateId: true,
        eventType: true,
      },
    });

    this.logger.log(`${events.length} événement(s) test.funded en attente`);

    for (const event of events) {
      this.logger.log(`Événement ${event.id} — Test ${event.aggregateId}`);
    }

    return events.length;
  }
}
