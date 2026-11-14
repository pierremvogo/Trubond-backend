import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { OutboxStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from '../invitations/invitations.service';

@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);

  private readonly maxAttempts = 5;
  private readonly lockTimeoutMs = 10 * 60 * 1000;
  private readonly lockHeartbeatMs = 60 * 1000;

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

  async findPendingFundedEventIds(limit = 5): Promise<string[]> {
    const safeLimit = Math.max(1, Math.min(limit, 5));

    const events = await this.prisma.outboxEvent.findMany({
      where: {
        eventType: 'test.funded',
        status: OutboxStatus.PENDING,
        availableAt: { lte: new Date() },
        attempts: { lt: this.maxAttempts },
      },
      orderBy: { createdAt: 'asc' },
      take: safeLimit,
      select: { id: true },
    });

    return events.map((event) => event.id);
  }

  async recoverStuckFundedEvents(): Promise<number> {
    const now = new Date();

    const lockLimit = new Date(now.getTime() - this.lockTimeoutMs);

    const recovered = await this.prisma.outboxEvent.updateMany({
      where: {
        eventType: 'test.funded',
        status: OutboxStatus.PROCESSING,
        lockedAt: { lt: lockLimit },
        attempts: { lt: this.maxAttempts },
      },
      data: {
        status: OutboxStatus.PENDING,
        lockedAt: null,
        lockToken: null,
        availableAt: now,
      },
    });

    const failed = await this.prisma.outboxEvent.updateMany({
      where: {
        eventType: 'test.funded',
        status: OutboxStatus.PROCESSING,
        lockedAt: { lt: lockLimit },
        attempts: { gte: this.maxAttempts },
      },
      data: {
        status: OutboxStatus.FAILED,
        lockedAt: null,
        lockToken: null,
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

  async renewFundedEventLock(eventId: string, lockToken: string): Promise<boolean> {
    const now = new Date();

    const lockLimit = new Date(now.getTime() - this.lockTimeoutMs);

    const result = await this.prisma.outboxEvent.updateMany({
      where: {
        id: eventId,
        eventType: 'test.funded',
        status: OutboxStatus.PROCESSING,
        lockToken,
        lockedAt: {
          gte: lockLimit,
        },
      },
      data: {
        lockedAt: now,
      },
    });

    return result.count === 1;
  }

  async processOneFundedEvent(eventId: string): Promise<boolean> {
    const now = new Date();
    const lockToken = randomUUID();

    const claimed = await this.prisma.outboxEvent.updateMany({
      where: {
        id: eventId,
        eventType: 'test.funded',
        status: OutboxStatus.PENDING,
        availableAt: { lte: now },
        attempts: { lt: this.maxAttempts },
      },
      data: {
        status: OutboxStatus.PROCESSING,
        lockedAt: now,
        lockToken,
        attempts: { increment: 1 },
      },
    });

    if (claimed.count !== 1) {
      return false;
    }

    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

    let heartbeatInFlight: Promise<void> | undefined;

    let lockLost = false;
    let heartbeatStopped = false;

    const heartbeat = async (): Promise<void> => {
      if (heartbeatStopped || lockLost) {
        return;
      }

      try {
        const renewed = await this.renewFundedEventLock(eventId, lockToken);

        if (!renewed) {
          lockLost = true;

          this.logger.error(`Événement ${eventId} : verrou perdu ou expiré`);
        }
      } catch (error: unknown) {
        lockLost = true;

        this.logger.error(
          `Événement ${eventId} : échec du renouvellement du verrou`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    };

    const stopHeartbeat = async (): Promise<void> => {
      heartbeatStopped = true;

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }

      if (heartbeatInFlight) {
        await heartbeatInFlight;
      }
    };

    try {
      heartbeatTimer = setInterval(() => {
        if (heartbeatStopped || heartbeatInFlight || lockLost) {
          return;
        }

        heartbeatInFlight = heartbeat().finally(() => {
          heartbeatInFlight = undefined;
        });
      }, this.lockHeartbeatMs);

      const event = await this.prisma.outboxEvent.findUniqueOrThrow({
        where: { id: eventId },
        select: { aggregateId: true },
      });

      if (lockLost) {
        return false;
      }

      await this.invitationsService.createInvitationForFundedTest(event.aggregateId);

      await stopHeartbeat();

      if (lockLost) {
        this.logger.warn(`Événement ${eventId} : publication annulée, verrou perdu`);

        return false;
      }

      const publicationTime = new Date();

      const publicationLockLimit = new Date(publicationTime.getTime() - this.lockTimeoutMs);

      const published = await this.prisma.outboxEvent.updateMany({
        where: {
          id: eventId,
          eventType: 'test.funded',
          status: OutboxStatus.PROCESSING,
          lockToken,
          lockedAt: {
            gte: publicationLockLimit,
          },
        },
        data: {
          status: OutboxStatus.PUBLISHED,
          publishedAt: publicationTime,
          lockedAt: null,
          lockToken: null,
          lastError: null,
        },
      });

      if (published.count !== 1) {
        this.logger.warn(`Événement ${eventId} : réservation perdue ou expirée avant publication`);

        return false;
      }

      this.logger.log(`Événement ${eventId} traité avec succès`);

      return true;
    } catch (error: unknown) {
      await stopHeartbeat();

      const message = error instanceof Error ? error.message : 'Erreur inconnue';

      if (lockLost) {
        this.logger.warn(`Événement ${eventId} : erreur après perte du verrou`);

        return false;
      }

      const event = await this.prisma.outboxEvent.findUnique({
        where: { id: eventId },
        select: { attempts: true },
      });

      const attempts = event?.attempts ?? this.maxAttempts;

      const exhausted = attempts >= this.maxAttempts;

      const delayMinutes = Math.pow(2, Math.max(0, attempts - 1));

      const failureTime = new Date();

      const failureLockLimit = new Date(failureTime.getTime() - this.lockTimeoutMs);

      const updated = await this.prisma.outboxEvent.updateMany({
        where: {
          id: eventId,
          eventType: 'test.funded',
          status: OutboxStatus.PROCESSING,
          lockToken,
          lockedAt: {
            gte: failureLockLimit,
          },
        },
        data: {
          status: exhausted ? OutboxStatus.FAILED : OutboxStatus.PENDING,
          lockedAt: null,
          lockToken: null,
          availableAt: new Date(failureTime.getTime() + delayMinutes * 60 * 1000),
          lastError: message.slice(0, 2000),
        },
      });

      if (updated.count !== 1) {
        this.logger.warn(
          `Événement ${eventId} : réservation perdue ou expirée pendant la gestion de l'erreur`,
        );

        return false;
      }

      this.logger.error(
        `Échec de l'événement ${eventId} — tentative ${attempts}/${this.maxAttempts}`,
      );

      return false;
    } finally {
      await stopHeartbeat();
    }
  }
}
