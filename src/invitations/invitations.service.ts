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
    await this.verifyFundedTest(testId);

    const now = new Date();

    // Vérifier si une invitation active existe déjà.
    const existing = await this.prisma.invitation.findFirst({
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
      // L'index unique empêche de créer une autre invitation
      // tant que l'ancienne possède un statut actif.
      if (!existing.expiresAt || existing.expiresAt > now) {
        return existing.id;
      }

      // Une invitation expirée doit être marquée EXPIRED
      // avant d'en créer une nouvelle.
      await this.prisma.invitation.updateMany({
        where: {
          id: existing.id,
          status: { in: this.activeStatuses },
          expiresAt: { lte: now },
        },
        data: {
          status: InvitationStatus.EXPIRED,
          tokenEncrypted: null,
        },
      });
    }

    const { token, tokenHash } = this.tokenService.generate();

    const tokenEncrypted = this.cryptoService.encrypt(token);

    const expiresAt = new Date(Date.now() + this.invitationValidityMs);

    try {
      const invitation = await this.prisma.invitation.create({
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
              availableAt: new Date(),
            },
          },
        },
        select: {
          id: true,
        },
      });

      // Prisma crée l'invitation et sa livraison
      // de manière atomique grâce à l'écriture imbriquée.
      return invitation.id;
    } catch (error) {
      // En cas de traitement concurrent du même événement,
      // l'index unique peut déclencher une erreur P2002.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const concurrentInvitation = await this.prisma.invitation.findFirst({
          where: {
            testId,
            status: { in: this.activeStatuses },
          },
          select: { id: true },
        });

        if (concurrentInvitation) {
          return concurrentInvitation.id;
        }
      }

      throw error;
    }
  }
}
