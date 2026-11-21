import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma, RewardClaimStatus, TestStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { InvitationTokenService } from '../invitations/invitation-token.service';

@Injectable()
export class RewardClaimsService {
  // Paramètres provisoires, configurables ultérieurement.
  private readonly accessValidityMs = 15 * 60 * 1000;
  private readonly claimValidityMs = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: InvitationTokenService,
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
}
