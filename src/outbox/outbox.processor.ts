import { Injectable, Logger } from '@nestjs/common';
import { OutboxStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from '../invitations/invitations.service';

@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invitationsService: InvitationsService,
  ) {}

  async inspectPendingEvents(): Promise<number> {
    const events = await this.prisma.outboxEvent.findMany({
      where: {
        eventType: 'test.funded',
        status: OutboxStatus.PENDING,
      },
      orderBy: { createdAt: 'asc' },
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

  async processOneFundedEvent(eventId: string): Promise<boolean> {
    const now = new Date();

    // Réservation atomique : un seul worker peut prendre l'événement.
    const claimed = await this.prisma.outboxEvent.updateMany({
      where: {
        id: eventId,
        eventType: 'test.funded',
        status: OutboxStatus.PENDING,
        availableAt: { lte: now },
      },
      data: {
        status: OutboxStatus.PROCESSING,
        lockedAt: now,
        attempts: { increment: 1 },
      },
    });

    if (claimed.count !== 1) {
      return false;
    }

    try {
      const event = await this.prisma.outboxEvent.findUniqueOrThrow({
        where: { id: eventId },
        select: {
          aggregateId: true,
          eventType: true,
        },
      });

      await this.invitationsService.createInvitationForFundedTest(event.aggregateId);

      await this.prisma.outboxEvent.update({
        where: { id: eventId },
        data: {
          status: OutboxStatus.PUBLISHED,
          publishedAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });

      this.logger.log(`Événement ${eventId} traité avec succès`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';

      // Réessai différé de 5 minutes.
      await this.prisma.outboxEvent.update({
        where: { id: eventId },
        data: {
          status: OutboxStatus.PENDING,
          lockedAt: null,
          availableAt: new Date(Date.now() + 5 * 60 * 1000),
          lastError: message.slice(0, 2000),
        },
      });

      this.logger.error(`Échec du traitement de l'événement ${eventId}`);
      return false;
    }
  }
}
