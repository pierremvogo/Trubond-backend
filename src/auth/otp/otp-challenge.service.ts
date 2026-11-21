import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { OtpPurpose, OtpStatus, Prisma } from '@prisma/client';

import { randomInt, randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';

import { constantEqual, hmac, otpHash } from '../auth.crypto';

import { SocketOtpProvider } from './socket-otp.provider';

@Injectable()
export class OtpChallengeService {
  private readonly logger = new Logger(OtpChallengeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly socketOtp: SocketOtpProvider,
  ) {}

  private assertDevOtpEnabled(): void {
    if (process.env.NODE_ENV === 'production' || process.env.OTP_DELIVERY_PROVIDER !== 'socket') {
      throw new ServiceUnavailableException('OTP Socket.IO indisponible dans cet environnement');
    }
  }

  async issueRewardOtp(
    phone: string,
    testId: string,
    channelToken: string,
  ): Promise<{
    challengeId: string;
    message: string;
  }> {
    this.assertDevOtpEnabled();

    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      throw new BadRequestException('Numéro attendu au format E.164');
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(testId)) {
      throw new BadRequestException('Identifiant du test invalide');
    }

    if (!channelToken) {
      throw new BadRequestException('Le canal OTP de développement est requis');
    }

    const recipientHmac = hmac(phone);

    const recent = await this.prisma.otpChallenge.count({
      where: {
        recipientHmac,
        createdAt: {
          gt: new Date(Date.now() - 60_000),
        },
      },
    });

    if (recent > 0) {
      throw new BadRequestException('Veuillez patienter avant de redemander un code');
    }

    const challengeId = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await this.prisma.otpChallenge.create({
      data: {
        id: challengeId,
        recipientHmac,
        codeHash: otpHash(challengeId, code),
        purpose: OtpPurpose.PAYOUT_CONFIRMATION,
        testId,
        status: OtpStatus.CREATED,
        expiresAt: new Date(Date.now() + 300_000),
        maxAttempts: 5,
      },
    });

    try {
      const result = await this.socketOtp.sendOtp(channelToken, challengeId, code);

      await this.prisma.otpChallenge.update({
        where: {
          id: challengeId,
        },
        data: {
          status: OtpStatus.SENT,
          provider: 'OTHER',
          providerRef: result.providerRef,
        },
      });
    } catch (error: unknown) {
      await this.prisma.otpChallenge.updateMany({
        where: {
          id: challengeId,
          status: OtpStatus.CREATED,
        },
        data: {
          status: OtpStatus.FAILED,
        },
      });

      this.logger.error(
        'Échec de livraison OTP récompense',
        error instanceof Error ? error.stack : String(error),
      );

      throw new ServiceUnavailableException('Envoi OTP impossible');
    }

    return {
      challengeId,
      message: 'Un code de vérification a été demandé',
    };
  }

  /**
   * À appeler uniquement dans une transaction qui vérifie
   * également l'autorisation métier de la réclamation.
   *
   * Ne déclenche aucun paiement.
   */
  async consumeRewardOtp(
    tx: Prisma.TransactionClient,
    challengeId: string,
    code: string,
    testId: string,
    expectedRecipientHmac: string,
  ): Promise<boolean> {
    const challenge = await tx.otpChallenge.findUnique({
      where: {
        id: challengeId,
      },
    });

    if (
      !challenge ||
      challenge.testId !== testId ||
      challenge.recipientHmac !== expectedRecipientHmac ||
      challenge.purpose !== OtpPurpose.PAYOUT_CONFIRMATION ||
      challenge.status !== OtpStatus.SENT ||
      challenge.expiresAt <= new Date() ||
      challenge.attempts >= challenge.maxAttempts
    ) {
      return false;
    }

    const match = constantEqual(challenge.codeHash, otpHash(challengeId, code));

    const changed = await tx.otpChallenge.updateMany({
      where: {
        id: challengeId,
        testId,
        recipientHmac: expectedRecipientHmac,
        purpose: OtpPurpose.PAYOUT_CONFIRMATION,
        status: OtpStatus.SENT,
        attempts: challenge.attempts,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        attempts: {
          increment: 1,
        },
        status: match
          ? OtpStatus.VERIFIED
          : challenge.attempts + 1 >= challenge.maxAttempts
            ? OtpStatus.LOCKED
            : OtpStatus.SENT,
        verifiedAt: match ? new Date() : null,
      },
    });

    return changed.count === 1 && match;
  }
}
