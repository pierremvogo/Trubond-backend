import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  InvitationChannel,
  InvitationStatus,
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

  private buildInvitationUrl(token: string): string {
    const configured = process.env.TRUEBOND_INVITATION_BASE_URL;

    if (!configured) {
      throw new ServiceUnavailableException("L'URL des invitations n'est pas configurée");
    }

    let url: URL;

    try {
      url = new URL(configured);
    } catch {
      throw new ServiceUnavailableException("L'URL des invitations est invalide");
    }

    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new ServiceUnavailableException("L'URL des invitations doit utiliser HTTPS");
    }

    url.searchParams.set('token', token);
    return url.toString();
  }

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
        const lockedTests = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM tests
          WHERE id = ${testId}::uuid
          FOR UPDATE
        `;

        if (lockedTests.length === 0) {
          throw new NotFoundException('Test introuvable');
        }

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

        const now = new Date();

        const activeInvitations = await tx.invitation.findMany({
          where: {
            testId,
            status: { in: this.activeStatuses },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            expiresAt: true,
            tokenEncrypted: true,
            status: true,
          },
        });

        const validInvitation = activeInvitations.find(
          (invitation) =>
            invitation.tokenEncrypted && (!invitation.expiresAt || invitation.expiresAt > now),
        );

        if (validInvitation) {
          await tx.invitationDelivery.updateMany({
            where: {
              invitationId: validInvitation.id,
              status: NotificationStatus.QUEUED,
            },
            data: { status: NotificationStatus.SKIPPED },
          });

          if (validInvitation.status === InvitationStatus.QUEUED) {
            await tx.invitation.update({
              where: { id: validInvitation.id },
              data: { status: InvitationStatus.CREATED },
            });
          }

          return validInvitation.id;
        }

        if (test.status !== TestStatus.FUNDED) {
          throw new ConflictException(
            'Le test doit être financé avant la création de son invitation',
          );
        }

        if (!test.recipientPhoneHmac || !test.recipientPhoneEnc) {
          throw new ConflictException('Le numéro du destinataire est absent');
        }

        if (activeInvitations.length > 0) {
          const ids = activeInvitations.map((invitation) => invitation.id);

          await tx.invitation.updateMany({
            where: {
              id: { in: ids },
              status: { in: this.activeStatuses },
            },
            data: {
              status: InvitationStatus.EXPIRED,
              tokenEncrypted: null,
            },
          });

          await tx.invitationDelivery.updateMany({
            where: {
              invitationId: { in: ids },
              status: NotificationStatus.QUEUED,
            },
            data: { status: NotificationStatus.SKIPPED },
          });
        }

        const { token, tokenHash } = this.tokenService.generate();

        const invitation = await tx.invitation.create({
          data: {
            testId,
            tokenHash,
            tokenEncrypted: this.cryptoService.encrypt(token),
            channel: InvitationChannel.OTHER,
            status: InvitationStatus.CREATED,
            expiresAt: new Date(now.getTime() + this.invitationValidityMs),
          },
          select: { id: true },
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

  async getInvitationLink(userId: string, testId: string) {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      select: {
        id: true,
        initiatorId: true,
      },
    });

    if (!test) {
      throw new NotFoundException('Test introuvable');
    }

    if (test.initiatorId !== userId) {
      throw new ForbiddenException("Vous n'êtes pas autorisé à consulter cette invitation");
    }

    // Vérifier la configuration avant toute création.
    this.buildInvitationUrl('configuration-check');

    const invitationId = await this.createInvitationForFundedTest(testId);

    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
      select: {
        id: true,
        testId: true,
        tokenEncrypted: true,
        expiresAt: true,
        status: true,
      },
    });

    if (!invitation?.tokenEncrypted) {
      throw new ConflictException("Le lien de cette invitation n'est plus disponible");
    }

    if (invitation.expiresAt && invitation.expiresAt <= new Date()) {
      throw new GoneException('Cette invitation a expiré');
    }

    const token = this.cryptoService.decrypt(invitation.tokenEncrypted);

    return {
      testId: invitation.testId,
      invitationId: invitation.id,
      invitationUrl: this.buildInvitationUrl(token),
      expiresAt: invitation.expiresAt,
      status: invitation.status,
    };
  }

  async resolveInvitation(token: string) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new BadRequestException("Token d'invitation invalide");
    }

    const tokenHash = this.tokenService.hash(token);

    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        revokedAt: true,
        test: {
          select: {
            status: true,
            currency: true,
            rewardAmount: true,
            expiresAt: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation introuvable');
    }

    const now = new Date();

    if (
      invitation.revokedAt ||
      (invitation.expiresAt && invitation.expiresAt <= now) ||
      (invitation.test.expiresAt && invitation.test.expiresAt <= now)
    ) {
      throw new GoneException("Cette invitation n'est plus disponible");
    }

    if (!this.activeStatuses.includes(invitation.status)) {
      throw new GoneException("Cette invitation n'est plus disponible");
    }

    // Les tests terminés ou annulés ne peuvent pas
    // être ouverts via une invitation.
    const blockedTestStatuses: TestStatus[] = [
      TestStatus.SUCCESS,
      TestStatus.FAILURE,
      TestStatus.EXPIRED,
      TestStatus.COMPLETED,
      TestStatus.REFUNDED,
      TestStatus.DISPUTED,
      TestStatus.CANCELLED,
    ];

    if (blockedTestStatuses.includes(invitation.test.status)) {
      throw new GoneException('Ce test ne peut plus être ouvert');
    }

    if (invitation.test.currency !== 'XAF') {
      throw new ConflictException('Devise du test non prise en charge par cet écran');
    }

    const amount = invitation.test.rewardAmount;

    if (amount < 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ConflictException('Montant de récompense invalide');
    }

    return {
      invitationId: invitation.id,
      rewardXaf: Number(amount),
      currency: invitation.test.currency,
      expiresAt: invitation.expiresAt,
    };
  }
}
