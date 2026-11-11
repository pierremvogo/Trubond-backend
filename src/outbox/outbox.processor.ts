import { Injectable, Logger } from '@nestjs/common';
import { OutboxStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from '../invitations/invitations.service';

@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);

  private readonly maxAttempts = 5;
  private readonly lockTimeoutMs = 10 * 60 * 1000;

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

  async findPendingFundedEventIds(limit = 5): Promise<string[]> {
    const safeLimit = Math.max(1, Math.min(limit, 5));

    const events = await this.prisma.outboxEvent.findMany({
      where: {
        eventType: 'test.funded',
        status: OutboxStatus.PENDING,
        availableAt: {
          lte: new Date(),
        },
        attempts: {
          lt: this.maxAttempts,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: safeLimit,
      select: {
        id: true,
      },
    });

    return events.map((event) => event.id);
  }

  async recoverStuckFundedEvents(): Promise<number> {
    const now = new Date();

    const lockLimit = new Date(now.getTime() - this.lockTimeoutMs);

    // Récupérer les événements bloqués qui peuvent encore être retentés.
    const recovered = await this.prisma.outboxEvent.updateMany({
      where: {
        eventType: 'test.funded',
        status: OutboxStatus.PROCESSING,
        lockedAt: {
          lt: lockLimit,
        },
        attempts: {
          lt: this.maxAttempts,
        },
      },
      data: {
        status: OutboxStatus.PENDING,
        lockedAt: null,
        availableAt: now,
      },
    });

    // Clôturer les événements bloqués ayant épuisé leurs tentatives.
    const failed = await this.prisma.outboxEvent.updateMany({
      where: {
        eventType: 'test.funded',
        status: OutboxStatus.PROCESSING,
        lockedAt: {
          lt: lockLimit,
        },
        attempts: {
          gte: this.maxAttempts,
        },
      },
      data: {
        status: OutboxStatus.FAILED,
        lockedAt: null,
        lastError: 'Traitement interrompu : limite de tentatives atteinte',
      },
    });

    if (recovered.count > 0) {
      this.logger.warn(`${recovered.count} événement(s) bloqué(s) récupéré(s)`);
    }

    if (failed.count > 0) {
      this.logger.error(`${failed.count} événement(s) bloqué(s) marqué(s) FAILED`);
    }

    return recovered.count + failed.count;
  }

  async processOneFundedEvent(eventId: string): Promise<boolean> {
    const now = new Date();

    // Réservation atomique de l'événement.
    const claimed = await this.prisma.outboxEvent.updateMany({
      where: {
        id: eventId,
        eventType: 'test.funded',
        status: OutboxStatus.PENDING,
        availableAt: {
          lte: now,
        },
        attempts: {
          lt: this.maxAttempts,
        },
      },
      data: {
        status: OutboxStatus.PROCESSING,
        lockedAt: now,
        attempts: {
          increment: 1,
        },
      },
    });

    if (claimed.count !== 1) {
      return false;
    }

    try {
      const event = await this.prisma.outboxEvent.findUniqueOrThrow({
        where: {
          id: eventId,
        },
        select: {
          aggregateId: true,
        },
      });

      await this.invitationsService.createInvitationForFundedTest(event.aggregateId);

      const published = await this.prisma.outboxEvent.updateMany({
        where: {
          id: eventId,
          status: OutboxStatus.PROCESSING,
          lockedAt: now,
        },
        data: {
          status: OutboxStatus.PUBLISHED,
          publishedAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });

      if (published.count !== 1) {
        this.logger.warn(`Événement ${eventId} : réservation perdue avant publication`);

        return false;
      }

      this.logger.log(`Événement ${eventId} traité avec succès`);

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';

      const event = await this.prisma.outboxEvent.findUnique({
        where: {
          id: eventId,
        },
        select: {
          attempts: true,
        },
      });

      const attempts = event?.attempts ?? this.maxAttempts;

      const exhausted = attempts >= this.maxAttempts;

      // Délais : 1, 2, 4, puis 8 minutes.
      const delayMinutes = Math.pow(2, Math.max(0, attempts - 1));

      await this.prisma.outboxEvent.updateMany({
        where: {
          id: eventId,
          status: OutboxStatus.PROCESSING,
          lockedAt: now,
        },
        data: {
          status: exhausted ? OutboxStatus.FAILED : OutboxStatus.PENDING,

          lockedAt: null,

          availableAt: new Date(Date.now() + delayMinutes * 60 * 1000),

          lastError: message.slice(0, 2000),
        },
      });

      this.logger.error(
        `Échec de l'événement ${eventId} — tentative ${attempts}/${this.maxAttempts}`,
      );

      return false;
    }
  }
}
