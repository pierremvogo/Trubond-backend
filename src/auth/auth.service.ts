import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { OtpPurpose, OtpStatus, Prisma, UserStatus } from '@prisma/client';

import { randomInt, randomUUID } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';

import {
  ChangePasswordDto,
  DeleteAccountDto,
  LoginDto,
  RegisterDto,
  ResetDto,
  VerifyDto,
} from './auth.dto';

import {
  constantEqual,
  decrypt,
  encrypt,
  hashPassword,
  hmac,
  otpHash,
  verifyPassword,
} from './auth.crypto';

import { SessionService } from './session.service';
import { SocketOtpProvider } from './otp/socket-otp.provider';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly socketOtp: SocketOtpProvider,
  ) {}

  private phoneKey(phone: string): string {
    return hmac(phone);
  }

  /**
   * Vérifie que le service OTP Socket.IO est utilisé
   * uniquement dans un environnement de développement.
   */
  private assertDevOtpEnabled(): void {
    if (process.env.NODE_ENV === 'production' || process.env.OTP_DELIVERY_PROVIDER !== 'socket') {
      throw new ServiceUnavailableException('OTP Socket.IO indisponible dans cet environnement');
    }
  }

  /**
   * Génère et envoie un OTP via Socket.IO.
   *
   * Le code OTP n'est jamais stocké en clair.
   * Il est conservé sous forme de HMAC dans Prisma.
   */
  private async issueOtp(phone: string, purpose: OtpPurpose, channelToken?: string) {
    this.assertDevOtpEnabled();

    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      throw new BadRequestException('Numéro attendu au format E.164, ex. +2376XXXXXXXX');
    }

    if (!channelToken) {
      throw new BadRequestException('Le header x-dev-otp-channel est requis');
    }

    const recipientHmac = this.phoneKey(phone);

    // Limitation : un OTP par minute et par numéro.
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

    const id = randomUUID();

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    // Créer le challenge avant l'envoi.
    await this.prisma.otpChallenge.create({
      data: {
        id,
        recipientHmac,
        codeHash: otpHash(id, code),
        purpose,
        status: OtpStatus.CREATED,
        expiresAt: new Date(Date.now() + 5 * 60_000),
        maxAttempts: 5,
      },
    });

    try {
      // Livraison uniquement via Socket.IO.
      const result = await this.socketOtp.sendOtp(channelToken, id, code);

      await this.prisma.otpChallenge.update({
        where: { id },
        data: {
          status: OtpStatus.SENT,
          provider: 'OTHER',
          ...(result.providerRef !== undefined ? { providerRef: result.providerRef } : {}),
        },
      });
    } catch (error: unknown) {
      await this.prisma.otpChallenge.updateMany({
        where: {
          id,
          status: OtpStatus.CREATED,
        },
        data: {
          status: OtpStatus.FAILED,
        },
      });

      this.logger.error(
        'OTP Socket.IO : échec de livraison',
        error instanceof Error ? error.stack : String(error),
      );

      throw new ServiceUnavailableException('Envoi OTP impossible, réessayez plus tard');
    }

    return {
      challengeId: id,
      message: 'Un code de vérification a été demandé',
    };
  }

  /**
   * Consomme un OTP dans la même transaction
   * que l'opération métier protégée.
   */
  private async consumeOtp(
    tx: Prisma.TransactionClient,
    challengeId: string,
    code: string,
    purpose: OtpPurpose,
  ): Promise<string | null> {
    const challenge = await tx.otpChallenge.findUnique({
      where: { id: challengeId },
    });

    if (
      !challenge ||
      challenge.purpose !== purpose ||
      challenge.status !== OtpStatus.SENT ||
      challenge.expiresAt <= new Date() ||
      challenge.attempts >= challenge.maxAttempts
    ) {
      return null;
    }

    const match = constantEqual(challenge.codeHash, otpHash(challengeId, code));

    const changed = await tx.otpChallenge.updateMany({
      where: {
        id: challengeId,
        status: OtpStatus.SENT,
        attempts: challenge.attempts,
      },
      data: {
        attempts: { increment: 1 },
        status: match
          ? OtpStatus.VERIFIED
          : challenge.attempts + 1 >= challenge.maxAttempts
            ? OtpStatus.LOCKED
            : OtpStatus.SENT,
        verifiedAt: match ? new Date() : null,
      },
    });

    if (changed.count !== 1) {
      return null;
    }

    return match ? challenge.recipientHmac : null;
  }

  /**
   * 1. INSCRIPTION
   */
  async register(dto: RegisterDto, channelToken?: string) {
    this.assertDevOtpEnabled();

    if (!channelToken) {
      throw new BadRequestException('Le header x-dev-otp-channel est requis');
    }

    this.logger.log('REGISTER: début');

    const phone = dto.phone.trim();

    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      throw new BadRequestException('Numéro attendu au format E.164, ex. +2376XXXXXXXX');
    }

    const phoneHmac = this.phoneKey(phone);

    const existing = await this.prisma.user.findUnique({
      where: { phoneHmac },
    });

    if (existing) {
      // Ne jamais permettre à une inscription de remplacer
      // le mot de passe d'un compte existant sans preuve
      // d'autorisation, même s'il n'est pas confirmé.
      throw new ConflictException('Ce numéro est déjà enregistré');
    }

    const passwordHash = await hashPassword(dto.password);

    await this.prisma.user.create({
      data: {
        phoneHmac,
        phoneEnc: encrypt(phone),
        countryCode: dto.countryCode,
        passwordHash,
      },
    });

    this.logger.log('REGISTER: utilisateur créé');

    const otp = await this.issueOtp(phone, OtpPurpose.SIGN_UP, channelToken);

    this.logger.log('REGISTER: OTP demandé');

    return {
      challengeId: otp.challengeId,
      message: otp.message,
    };
  }

  /**
   * 2. CONFIRMATION INSCRIPTION
   */
  async verifySignup(dto: VerifyDto) {
    const userId = await this.prisma.$transaction(async (tx) => {
      const phoneHmac = await this.consumeOtp(tx, dto.challengeId, dto.code, OtpPurpose.SIGN_UP);

      if (!phoneHmac) {
        return null;
      }

      const user = await tx.user.findUnique({
        where: { phoneHmac },
      });

      if (!user || user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException();
      }

      await tx.user.update({
        where: { id: user.id },
        data: {
          phoneVerifiedAt: new Date(),
        },
      });

      return user.id;
    });

    if (!userId) {
      throw new BadRequestException('Code invalide ou expiré');
    }

    return this.sessions.createSession(userId);
  }

  /**
   * 3. CONNEXION
   * Connexion directe par téléphone et mot de passe,
   * sans vérification OTP.
   */
  async login(dto: LoginDto) {
    const phone = dto.phone.trim();

    const user = await this.prisma.user.findUnique({
      where: {
        phoneHmac: this.phoneKey(phone),
      },
    });

    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      !user.phoneVerifiedAt ||
      !user.passwordHash ||
      !(await verifyPassword(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    // Identifiants valides :
    // création directe de la session et des tokens.
    return this.sessions.createSession(user.id);
  }

  /**
   * 4. VÉRIFICATION OTP CONNEXION
   */
  async verifyLogin(dto: VerifyDto) {
    const userId = await this.prisma.$transaction(async (tx) => {
      const phoneHmac = await this.consumeOtp(tx, dto.challengeId, dto.code, OtpPurpose.SIGN_IN);

      if (!phoneHmac) {
        return null;
      }

      const user = await tx.user.findUnique({
        where: { phoneHmac },
      });

      if (!user || user.status !== UserStatus.ACTIVE || !user.phoneVerifiedAt) {
        throw new UnauthorizedException();
      }

      return user.id;
    });

    if (!userId) {
      throw new BadRequestException('Code invalide ou expiré');
    }

    return this.sessions.createSession(userId);
  }

  /**
   * 5. MOT DE PASSE OUBLIÉ
   */
  async forgotPassword(phone: string, channelToken?: string) {
    this.assertDevOtpEnabled();

    const user = await this.prisma.user.findUnique({
      where: {
        phoneHmac: this.phoneKey(phone),
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE || !user.phoneVerifiedAt) {
      return {
        message: 'Si le compte existe, un code sera envoyé',
      };
    }

    return this.issueOtp(phone, OtpPurpose.PASSWORD_RESET, channelToken);
  }

  /**
   * 6. RÉINITIALISATION DU MOT DE PASSE
   */
  async resetPassword(dto: ResetDto) {
    const passwordHash = await hashPassword(dto.newPassword);

    const changed = await this.prisma.$transaction(async (tx) => {
      const phoneHmac = await this.consumeOtp(
        tx,
        dto.challengeId,
        dto.code,
        OtpPurpose.PASSWORD_RESET,
      );

      if (!phoneHmac) {
        return false;
      }

      const user = await tx.user.findUnique({
        where: { phoneHmac },
      });

      if (!user || user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException();
      }

      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      await tx.session.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      return true;
    });

    if (!changed) {
      throw new BadRequestException('Code invalide ou expiré');
    }

    return {
      message: 'Mot de passe modifié',
    };
  }

  /**
   * 7. CHANGEMENT DU MOT DE PASSE
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (
      !user?.passwordHash ||
      user.status !== UserStatus.ACTIVE ||
      !(await verifyPassword(dto.oldPassword, user.passwordHash))
    ) {
      throw new UnauthorizedException();
    }

    const passwordHash = await hashPassword(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash },
      });

      await tx.session.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    });

    return {
      message: 'Mot de passe modifié, reconnectez-vous',
    };
  }

  /**
   * 8. RENOUVELLEMENT DES TOKENS
   */
  refresh(refreshToken: string) {
    return this.sessions.refresh(refreshToken);
  }

  /**
   * 9. DÉCONNEXION
   */
  logout(userId: string, familyId: string) {
    return this.sessions.logout(userId, familyId);
  }

  /**
   * 10. DÉCONNEXION GLOBALE
   */
  logoutAll(userId: string) {
    return this.sessions.logoutAll(userId);
  }

  /**
   * 11. PROFIL UTILISATEUR
   */

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phoneEnc: true,
        countryCode: true,
        locale: true,
        status: true,
        createdAt: true,
        phoneVerifiedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException();
    }

    const phone = decrypt(user.phoneEnc);

    return {
      id: user.id,
      phone,
      countryCode: user.countryCode,
      locale: user.locale,
      status: user.status,
      createdAt: user.createdAt,
      phoneVerifiedAt: user.phoneVerifiedAt,
    };
  }

  async deleteAccount(userId: string, dto: DeleteAccountDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        passwordHash: true,
      },
    });

    // Ne pas révéler inutilement l'état du compte.
    if (!user || user.status !== UserStatus.ACTIVE || !user.passwordHash) {
      throw new UnauthorizedException('Compte non autorisé');
    }

    const passwordIsValid = await verifyPassword(dto.password, user.passwordHash);

    if (!passwordIsValid) {
      throw new UnauthorizedException('Mot de passe incorrect');
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Mise à jour conditionnelle :
      // empêche une deuxième suppression simultanée.
      const result = await tx.user.updateMany({
        where: {
          id: userId,
          status: UserStatus.ACTIVE,
        },
        data: {
          status: UserStatus.DELETED,
          deletedAt: now,
          passwordHash: null,
        },
      });

      if (result.count !== 1) {
        throw new UnauthorizedException('Compte non autorisé');
      }

      // Révocation de toutes les sessions.
      await tx.session.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });
    });

    return {
      message: 'Compte désactivé avec succès',
    };
  }
}
