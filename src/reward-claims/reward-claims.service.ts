import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { Prisma, RewardClaimStatus, TestStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { InvitationTokenService } from '../invitations/invitation-token.service';

import { OtpChallengeService } from '../auth/otp/otp-challenge.service';
import { TestPhoneSecurity } from '../tests/test-phone-security.service';

@Injectable()
export class RewardClaimsService {
  // Paramètres provisoires, configurables ultérieurement.
  private readonly accessValidityMs = 15 * 60 * 1000;
  private readonly claimValidityMs = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: InvitationTokenService,
    private readonly otp: OtpChallengeService,
    private readonly phoneSecurity: TestPhoneSecurity,
  ) {}

  /**
   * Crée une réclamation dans la transaction du test.
   *
   * IMPORTANT :
   * - Ne pas ouvrir une seconde transaction.
   * - Appeler uniquement après avoir confirmé la bonne réponse.
   * - Le token retourné n'autorise aucun paiement.
   */
  async createForSuccessfulTest(
    tx: Prisma.TransactionClient,
    testId: string,
  ): Promise<{ claimId: string; accessToken: string }> {
    const test = await tx.test.findUnique({
      where: { id: testId },
      select: {
        id: true,
        status: true,
        attempt: {
          select: { isCorrect: true },
        },
      },
    });

    if (!test) {
      throw new NotFoundException('Test introuvable');
    }

    if (test.status !== TestStatus.SUCCESS || test.attempt?.isCorrect !== true) {
      throw new ConflictException('La réclamation nécessite un test réussi.');
    }

    const existingClaim = await tx.rewardClaim.findUnique({
      where: { testId },
      select: { id: true },
    });

    if (existingClaim) {
      throw new ConflictException('Une réclamation existe déjà pour ce test.');
    }

    const { token, tokenHash } = this.tokenService.generate();
    const now = new Date();

    const claim = await tx.rewardClaim.create({
      data: {
        testId,
        status: RewardClaimStatus.PENDING_IDENTITY,
        accessTokenHash: tokenHash,
        accessExpiresAt: new Date(now.getTime() + this.accessValidityMs),
        expiresAt: new Date(now.getTime() + this.claimValidityMs),
      },
      select: { id: true },
    });

    return {
      claimId: claim.id,
      accessToken: token,
    };
  }

  /**
   * Vérifie un accès temporaire.
   *
   * Ce contrôle ne constitue pas une preuve d'identité.
   * Aucun décaissement ne doit être autorisé sur cette seule base.
   */
  async resolveAccess(accessToken: string) {
    if (typeof accessToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(accessToken)) {
      throw new BadRequestException('Token de réclamation invalide.');
    }

    const tokenHash = this.tokenService.hash(accessToken);

    const claim = await this.prisma.rewardClaim.findUnique({
      where: { accessTokenHash: tokenHash },
      select: {
        id: true,
        testId: true,
        status: true,
        accessExpiresAt: true,
        expiresAt: true,
        identityVerifiedAt: true,
        destinationVerifiedAt: true,
        test: { select: { rewardAmount: true, currency: true } },
      },
    });

    if (!claim) {
      throw new NotFoundException('Réclamation introuvable.');
    }

    const now = new Date();

    if (claim.expiresAt <= now || !claim.accessExpiresAt || claim.accessExpiresAt <= now) {
      throw new GoneException('Cet accès à la réclamation a expiré.');
    }

    if (
      claim.status === RewardClaimStatus.EXPIRED ||
      claim.status === RewardClaimStatus.CANCELLED ||
      claim.status === RewardClaimStatus.PAID
    ) {
      throw new ConflictException('Cette réclamation ne peut plus être modifiée.');
    }

    return {
      claimId: claim.id,
      rewardAmount: claim.test.rewardAmount.toString(),
      currency: claim.test.currency,
      status: claim.status,
      identityVerified: claim.identityVerifiedAt !== null,
      destinationVerified: claim.destinationVerifiedAt !== null,
      expiresAt: claim.expiresAt,
      accessExpiresAt: claim.accessExpiresAt,
    };
  }

  /**
   * Renouvelle un token après vérification d'identité.
   *
   * Cette méthode ne doit être appelée que dans une transaction
   * ayant déjà validé et consommé l'OTP d'identité.
   *
   * Le verrou du test doit être acquis par l'appelant.
   * Le token courant doit également être validé par l'appelant.
   */
  async rotateAfterIdentityVerification(
    tx: Prisma.TransactionClient,
    claimId: string,
  ): Promise<{ accessToken: string }> {
    const claim = await tx.rewardClaim.findUnique({
      where: { id: claimId },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        identityVerifiedAt: true,
      },
    });

    if (!claim) {
      throw new NotFoundException('Réclamation introuvable.');
    }

    if (
      claim.status !== RewardClaimStatus.IDENTITY_VERIFIED ||
      !claim.identityVerifiedAt ||
      claim.expiresAt <= new Date()
    ) {
      throw new ConflictException("L'identité du bénéficiaire n'est pas vérifiée.");
    }

    const { token, tokenHash } = this.tokenService.generate();
    const now = new Date();

    const accessExpiresAt = new Date(
      Math.min(now.getTime() + this.accessValidityMs, claim.expiresAt.getTime()),
    );

    await tx.rewardClaim.update({
      where: { id: claim.id },
      data: {
        accessTokenHash: tokenHash,
        accessExpiresAt,
      },
    });

    return { accessToken: token };
  }
  private assertDevelopment() {
    if (process.env.NODE_ENV === 'production' || process.env.OTP_DELIVERY_PROVIDER !== 'socket') {
      throw new ServiceUnavailableException('Vérification de récompense indisponible.');
    }
  }

  private async lockedClaim(
    tx: Prisma.TransactionClient,
    token: string,
    status: RewardClaimStatus,
  ) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new BadRequestException('Token invalide.');
    const hash = this.tokenService.hash(token);
    const initial = await tx.rewardClaim.findUnique({
      where: { accessTokenHash: hash },
      select: { testId: true },
    });
    if (!initial) throw new NotFoundException('Réclamation introuvable.');
    await tx.$queryRaw`SELECT id FROM tests WHERE id = ${initial.testId}::uuid FOR UPDATE`;
    const claim = await tx.rewardClaim.findUnique({
      where: { accessTokenHash: hash },
      include: { test: { include: { attempt: true } } },
    });
    if (!claim) throw new NotFoundException('Réclamation introuvable.');
    if (
      !claim.accessExpiresAt ||
      claim.accessExpiresAt <= new Date() ||
      claim.expiresAt <= new Date()
    )
      throw new GoneException('Accès expiré.');
    if (
      claim.status !== status ||
      claim.test.status !== TestStatus.SUCCESS ||
      !claim.test.attempt?.isCorrect
    )
      throw new ConflictException('Étape non autorisée.');
    return claim;
  }

  async requestIdentityOtp(token: string, channelToken: string) {
    this.assertDevelopment();
    return this.prisma.$transaction(
      async (tx) => {
        const claim = await this.lockedClaim(tx, token, RewardClaimStatus.PENDING_IDENTITY);
        if (!claim.test.recipientPhoneEnc)
          throw new ConflictException('Numéro bénéficiaire indisponible.');
        const phone = this.phoneSecurity.decrypt(claim.test.recipientPhoneEnc);
        if (this.phoneSecurity.hmac(phone) !== claim.test.recipientPhoneHmac)
          throw new ConflictException('Numéro bénéficiaire incohérent.');
        return this.otp.issueRewardOtp(phone, claim.testId, channelToken);
      },
      { timeout: 15000 },
    );
  }

  async verifyIdentityOtp(token: string, challengeId: string, code: string) {
    this.assertDevelopment();
    const result = await this.prisma.$transaction(async (tx) => {
      const claim = await this.lockedClaim(tx, token, RewardClaimStatus.PENDING_IDENTITY);
      if (
        !(await this.otp.consumeRewardOtp(
          tx,
          challengeId,
          code,
          claim.testId,
          claim.test.recipientPhoneHmac,
        ))
      )
        return null;
      await tx.rewardClaim.update({
        where: { id: claim.id },
        data: { status: RewardClaimStatus.IDENTITY_VERIFIED, identityVerifiedAt: new Date() },
      });
      return this.rotateAfterIdentityVerification(tx, claim.id);
    });
    if (!result) throw new BadRequestException('Code invalide ou expiré.');
    return { ...result, status: RewardClaimStatus.IDENTITY_VERIFIED };
  }

  async requestDestinationOtp(token: string, phone: string, channelToken: string) {
    this.assertDevelopment();
    const normalized = this.phoneSecurity.normalize(phone);
    if (!/^\+2376\d{8}$/.test(normalized))
      throw new BadRequestException('Numéro camerounais requis.');
    return this.prisma.$transaction(
      async (tx) => {
        const claim = await this.lockedClaim(tx, token, RewardClaimStatus.IDENTITY_VERIFIED);
        const result = await this.otp.issueRewardOtp(normalized, claim.testId, channelToken);
        await tx.rewardClaim.update({
          where: { id: claim.id },
          data: {
            destinationEnc: this.phoneSecurity.encrypt(normalized),
            destinationHmac: this.phoneSecurity.hmac(normalized),
            destinationVerifiedAt: null,
          },
        });
        return result;
      },
      { timeout: 15000 },
    );
  }

  async verifyDestinationOtp(token: string, challengeId: string, code: string) {
    this.assertDevelopment();
    const result = await this.prisma.$transaction(async (tx) => {
      const claim = await this.lockedClaim(tx, token, RewardClaimStatus.IDENTITY_VERIFIED);
      if (!claim.destinationHmac || !claim.destinationEnc || !claim.identityVerifiedAt)
        throw new ConflictException('Destination non renseignée.');
      if (
        !(await this.otp.consumeRewardOtp(
          tx,
          challengeId,
          code,
          claim.testId,
          claim.destinationHmac,
        ))
      )
        return false;
      await tx.rewardClaim.update({
        where: { id: claim.id },
        data: { status: RewardClaimStatus.DESTINATION_VERIFIED, destinationVerifiedAt: new Date() },
      });
      return true;
    });
    if (!result) throw new BadRequestException('Code invalide ou expiré.');
    return { status: RewardClaimStatus.DESTINATION_VERIFIED };
  }
}
