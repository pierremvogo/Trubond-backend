import { Injectable, Logger } from '@nestjs/common';

import {
  InvitationStatus,
  NotificationChannel,
  NotificationStatus,
  TestStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { decrypt as decryptPhone } from '../auth/auth.crypto';
import { InvitationCryptoService } from './invitation-crypto.service';

type MetaResponse = {
  messages?: Array<{ id?: string }>;
  error?: {
    code?: number;
    message?: string;
  };
};

@Injectable()
export class WhatsappDeliveryService {
  private readonly logger = new Logger(WhatsappDeliveryService.name);

  private readonly staleLockMs = 2 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly invitationCrypto: InvitationCryptoService,
  ) {}

  private enabled(): boolean {
    return process.env.WHATSAPP_ENABLED === 'true';
  }

  private buildInvitationUrl(token: string): string {
    const base = process.env.TRUEBOND_INVITATION_BASE_URL;

    if (!base) {
      throw new Error('TRUEBOND_INVITATION_BASE_URL manquant');
    }

    const url = new URL(base);

    if (url.protocol !== 'https:') {
      throw new Error('Le lien invitation doit utiliser HTTPS');
    }

    url.searchParams.set('token', token);

    return url.toString();
  }

  private normalizePhone(phone: string): string {
    const normalized = phone.replace(/[\s().-]/g, '');

    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      throw new Error('Numéro destinataire non conforme au format E.164');
    }

    return normalized.slice(1);
  }

  private async sendTemplate(phone: string, invitationUrl: string): Promise<string> {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    const graphVersion = process.env.WHATSAPP_GRAPH_VERSION;

    const templateName = process.env.WHATSAPP_TEMPLATE_NAME;

    const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'fr';

    if (!accessToken || !phoneNumberId || !graphVersion || !templateName) {
      throw new Error('Configuration Meta WhatsApp incomplète');
    }

    const endpoint = `https://graph.facebook.com/` + `${graphVersion}/${phoneNumberId}/messages`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: language,
          },
          components: [
            {
              type: 'body',
              parameters: [
                {
                  type: 'text',
                  text: invitationUrl,
                },
              ],
            },
          ],
        },
      }),
    });

    const result = (await response.json()) as MetaResponse;

    if (!response.ok) {
      const code = result.error?.code ?? response.status;

      throw new Error(`Meta WhatsApp a refusé le message (code ${code})`);
    }

    const messageId = result.messages?.[0]?.id;

    if (!messageId) {
      throw new Error('Meta n’a pas retourné de référence de message');
    }

    return messageId;
  }

  async recoverStaleDeliveries(): Promise<number> {
    const cutoff = new Date(Date.now() - this.staleLockMs);

    const result = await this.prisma.invitationDelivery.updateMany({
      where: {
        channel: NotificationChannel.WHATSAPP,
        status: NotificationStatus.QUEUED,
        lockedAt: {
          lt: cutoff,
        },
      },
      data: {
        status: NotificationStatus.FAILED,
        lockedAt: null,
        lastError: 'Tentative interrompue : vérification manuelle requise avant tout renvoi',
      },
    });

    return result.count;
  }

  async processNext(): Promise<boolean> {
    if (!this.enabled()) {
      return false;
    }

    const now = new Date();

    const candidate = await this.prisma.invitationDelivery.findFirst({
      where: {
        channel: NotificationChannel.WHATSAPP,
        status: NotificationStatus.QUEUED,
        lockedAt: null,
        attempts: 0,
        availableAt: {
          lte: now,
        },
      },
      orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
      },
    });

    if (!candidate) {
      return false;
    }

    // Une seule instance peut réserver cette livraison.
    const claimed = await this.prisma.invitationDelivery.updateMany({
      where: {
        id: candidate.id,
        channel: NotificationChannel.WHATSAPP,
        status: NotificationStatus.QUEUED,
        lockedAt: null,
        attempts: 0,
        availableAt: {
          lte: now,
        },
      },
      data: {
        lockedAt: now,
        attempts: {
          increment: 1,
        },
      },
    });

    if (claimed.count !== 1) {
      return true;
    }

    try {
      const delivery = await this.prisma.invitationDelivery.findUnique({
        where: {
          id: candidate.id,
        },
        include: {
          invitation: {
            include: {
              test: {
                select: {
                  status: true,
                  recipientPhoneEnc: true,
                },
              },
            },
          },
        },
      });

      if (!delivery) {
        throw new Error('Livraison introuvable après réservation');
      }

      const invitation = delivery.invitation;

      const allowedStatuses: InvitationStatus[] = [
        InvitationStatus.CREATED,
        InvitationStatus.QUEUED,
      ];

      const valid =
        allowedStatuses.includes(invitation.status) &&
        invitation.test.status === TestStatus.FUNDED &&
        !!invitation.expiresAt &&
        invitation.expiresAt > new Date() &&
        !!invitation.tokenEncrypted &&
        !!invitation.test.recipientPhoneEnc;

      if (!valid) {
        await this.prisma.invitationDelivery.updateMany({
          where: {
            id: candidate.id,
            status: NotificationStatus.QUEUED,
            lockedAt: now,
          },
          data: {
            status: NotificationStatus.SKIPPED,
            lockedAt: null,
            lastError: 'Invitation non éligible à l’envoi',
          },
        });

        return true;
      }

      const phone = this.normalizePhone(decryptPhone(invitation.test.recipientPhoneEnc!));

      const token = this.invitationCrypto.decrypt(invitation.tokenEncrypted!);

      const invitationUrl = this.buildInvitationUrl(token);

      const providerRef = await this.sendTemplate(phone, invitationUrl);

      const sentAt = new Date();

      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.invitationDelivery.updateMany({
          where: {
            id: candidate.id,
            status: NotificationStatus.QUEUED,
            lockedAt: now,
          },
          data: {
            status: NotificationStatus.SENT,
            providerRef,
            sentAt,
            lockedAt: null,
            lastError: null,
          },
        });

        if (updated.count !== 1) {
          return;
        }

        await tx.invitation.updateMany({
          where: {
            id: invitation.id,
            status: {
              in: allowedStatuses,
            },
          },
          data: {
            status: InvitationStatus.SENT,
            sentAt,
            providerRef,
          },
        });
      });

      this.logger.log(`Livraison WhatsApp ${candidate.id} acceptée par Meta`);

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur WhatsApp inconnue';

      // Aucun renvoi automatique : le résultat de
      // l'appel externe peut être incertain.
      await this.prisma.invitationDelivery.updateMany({
        where: {
          id: candidate.id,
          status: NotificationStatus.QUEUED,
          lockedAt: now,
        },
        data: {
          status: NotificationStatus.FAILED,
          lockedAt: null,
          lastError: message.slice(0, 2000),
        },
      });

      this.logger.error(`Livraison WhatsApp ${candidate.id} échouée : ${message}`);

      return true;
    }
  }
}
