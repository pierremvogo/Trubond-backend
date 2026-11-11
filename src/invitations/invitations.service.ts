import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import {
  InvitationChannel,
  InvitationStatus,
  NotificationChannel,
  NotificationStatus,
  Prisma,
  TestStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { InvitationTokenService } from './invitation-token.service';
import { InvitationCryptoService } from './invitation-crypto.service';

@Injectable()
export class InvitationsService {
  private readonly invitationValidityMs = 24 * 60 * 60 * 1000;

  private readonly activeStatuses: InvitationStatus[] = [
    InvitationStatus.CREATED,
    InvitationStatus.QUEUED,
    InvitationStatus.SENT,
    InvitationStatus.DELIVERED,
    InvitationStatus.OPENED,
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: InvitationTokenService,
    private readonly cryptoService: InvitationCryptoService,
  ) {}

  async verifyFundedTest(testId: string): Promise<void> {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      select: {
        id: true,
        status: true,
        recipientPhoneHmac: true,
        recipientPhoneEnc: true,
      },
    });

    if (!test) {
      throw new NotFoundException('Test introuvable');
    }

    if (test.status !== TestStatus.FUNDED) {
      throw new ConflictException('Le test doit être financé avant la création de son invitation');
    }

    if (!test.recipientPhoneHmac || !test.recipientPhoneEnc) {
      throw new ConflictException('Le numéro du destinataire est absent');
    }
  }

  async createInvitationForFundedTest(testId: string): Promise<string> {
    return this.prisma.$transaction(
      async (tx) => {
        // Verrouiller le test pour sérialiser les créations
        // d'invitations concernant le même test.
        const lockedTests = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM tests
          WHERE id = ${testId}::uuid
          FOR UPDATE
        `;

        if (lockedTests.length === 0) {
          throw new NotFoundException('Test introuvable');
        }

        // Vérifier le financement à l'intérieur de la transaction.
        const test = await tx.test.findUnique({
          where: { id: testId },
          select: {
            status: true,
            recipientPhoneHmac: true,
            recipientPhoneEnc: true,
          },
        });

        if (!test) {
          throw new NotFoundException('Test introuvable');
        }

        if (test.status !== TestStatus.FUNDED) {
          throw new ConflictException(
            'Le test doit être financé avant la création de son invitation',
          );
        }

        if (!test.recipientPhoneHmac || !test.recipientPhoneEnc) {
          throw new ConflictException('Le numéro du destinataire est absent');
        }

        const now = new Date();

        const existing = await tx.invitation.findFirst({
          where: {
            testId,
            status: { in: this.activeStatuses },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            expiresAt: true,
          },
        });

        if (existing) {
          if (!existing.expiresAt || existing.expiresAt > now) {
            return existing.id;
          }

          // L'invitation expirée ne doit plus être envoyée.
          await tx.invitation.update({
            where: { id: existing.id },
            data: {
              status: InvitationStatus.EXPIRED,
              tokenEncrypted: null,
            },
          });

          // Désactiver ses livraisons encore en attente.
          await tx.invitationDelivery.updateMany({
            where: {
              invitationId: existing.id,
              status: NotificationStatus.QUEUED,
            },
            data: {
              status: NotificationStatus.SKIPPED,
            },
          });
        }

        const { token, tokenHash } = this.tokenService.generate();

        const tokenEncrypted = this.cryptoService.encrypt(token);

        const expiresAt = new Date(now.getTime() + this.invitationValidityMs);

        const invitation = await tx.invitation.create({
          data: {
            testId,
            tokenHash,
            tokenEncrypted,
            channel: InvitationChannel.WHATSAPP,
            status: InvitationStatus.QUEUED,
            expiresAt,

            deliveries: {
              create: {
                channel: NotificationChannel.WHATSAPP,
                status: NotificationStatus.QUEUED,
                availableAt: now,
              },
            },
          },
          select: {
            id: true,
          },
        });

        return invitation.id;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10000,
        timeout: 15000,
      },
    );
  }
}
