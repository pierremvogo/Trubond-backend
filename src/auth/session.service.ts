import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';

import { Prisma, UserStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';

import { constantEqual, hmac, randomToken } from './auth.crypto';

const ACCESS_SECONDS = 15 * 60;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthContext = {
  userId: string;
  familyId: string;
};

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
};

type RefreshResult =
  | {
      kind: 'ok';
      userId: string;
      familyId: string;
      next: string;
    }
  | {
      kind: 'invalid' | 'replay';
    };

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Empreinte du refresh token.
   * Le token brut n'est jamais stocké en base.
   */
  private refreshHash(token: string): string {
    return hmac(token, 'AUTH_SESSION_KEY');
  }

  /**
   * Access token signé :
   * userId.familyId.exp.signature
   */
  private issueAccess(userId: string, familyId: string): string {
    const exp = Math.floor(Date.now() / 1000) + ACCESS_SECONDS;

    const raw = `${userId}.${familyId}.${exp}`;

    const signature = hmac(raw, 'AUTH_ACCESS_KEY');

    return `${raw}.${signature}`;
  }

  private tokens(userId: string, familyId: string, refreshToken: string): Tokens {
    return {
      accessToken: this.issueAccess(userId, familyId),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_SECONDS,
    };
  }

  /**
   * 1. CRÉATION D'UNE SESSION
   */
  async createSession(userId: string): Promise<Tokens> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        phoneVerifiedAt: true,
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE || !user.phoneVerifiedAt) {
      throw new UnauthorizedException('Utilisateur non autorisé');
    }

    const familyId = randomUUID();
    const refreshToken = randomToken();
    const now = new Date();

    await this.prisma.session.create({
      data: {
        userId,
        familyId,
        tokenHash: this.refreshHash(refreshToken),
        expiresAt: new Date(now.getTime() + REFRESH_MS),
        lastActivityAt: now,
      },
    });

    return this.tokens(userId, familyId, refreshToken);
  }

  /**
   * 2. RENOUVELLEMENT DU REFRESH TOKEN
   *
   * Rotation atomique avec transaction PostgreSQL.
   */
  async refresh(refreshToken: string): Promise<Tokens> {
    if (
      typeof refreshToken !== 'string' ||
      refreshToken.length < 20 ||
      refreshToken.length > 2048
    ) {
      throw new UnauthorizedException('Refresh token invalide');
    }

    const hash = this.refreshHash(refreshToken);

    let result: RefreshResult;

    try {
      result = await this.prisma.$transaction(
        async (tx): Promise<RefreshResult> => {
          const now = new Date();

          const old = await tx.session.findUnique({
            where: {
              tokenHash: hash,
            },
            include: {
              user: {
                select: {
                  status: true,
                  phoneVerifiedAt: true,
                },
              },
            },
          });

          if (!old) {
            return { kind: 'invalid' };
          }

          /**
           * Ancien token déjà remplacé :
           * possible réutilisation frauduleuse.
           *
           * On révoque toute la famille.
           */
          if (old.replacedById) {
            await tx.session.updateMany({
              where: {
                userId: old.userId,
                familyId: old.familyId,
                revokedAt: null,
              },
              data: {
                revokedAt: now,
              },
            });

            // Ne pas throw ici :
            // la révocation doit être commit.
            return { kind: 'replay' };
          }

          if (
            old.revokedAt !== null ||
            old.expiresAt <= now ||
            old.user.status !== UserStatus.ACTIVE ||
            !old.user.phoneVerifiedAt
          ) {
            return { kind: 'invalid' };
          }

          const next = randomToken();
          const nextId = randomUUID();

          /**
           * La nouvelle session est créée avant
           * de renseigner replacedById, car ce champ
           * référence sessions.id.
           */
          await tx.session.create({
            data: {
              id: nextId,
              userId: old.userId,
              familyId: old.familyId,
              tokenHash: this.refreshHash(next),
              expiresAt: new Date(now.getTime() + REFRESH_MS),
              lastActivityAt: now,
            },
          });

          /**
           * Compare-and-swap :
           * l'ancienne génération ne peut être
           * remplacée qu'une seule fois.
           */
          const updated = await tx.session.updateMany({
            where: {
              id: old.id,
              revokedAt: null,
              replacedById: null,
              expiresAt: {
                gt: now,
              },
            },
            data: {
              revokedAt: now,
              replacedById: nextId,
              lastActivityAt: now,
            },
          });

          if (updated.count !== 1) {
            // La transaction sera annulée,
            // y compris la nouvelle session.
            throw new ConflictException('Rotation concurrente');
          }

          return {
            kind: 'ok',
            userId: old.userId,
            familyId: old.familyId,
            next,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException('Renouvellement concurrent : réessayez');
      }

      throw error;
    }

    if (result.kind !== 'ok') {
      throw new UnauthorizedException(
        result.kind === 'replay'
          ? 'Réutilisation détectée : connexion révoquée'
          : 'Refresh token invalide ou expiré',
      );
    }

    return this.tokens(result.userId, result.familyId, result.next);
  }

  /**
   * 3. VALIDATION DE L'ACCESS TOKEN
   *
   * Compatible avec AccessTokenGuard.
   */
  async validateAccess(token: string): Promise<AuthContext> {
    if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
      throw new UnauthorizedException('Access token invalide');
    }

    const parts = token.split('.');

    if (parts.length !== 4) {
      throw new UnauthorizedException('Format du token invalide');
    }

    const [userId, familyId, exp, signature] = parts;

    /**
     * Important :
     * cette vérification résout les erreurs
     * noUncheckedIndexedAccess de TypeScript.
     */
    if (!userId || !familyId || !exp || !signature) {
      throw new UnauthorizedException('Access token incomplet');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(userId) || !uuidRegex.test(familyId) || !/^\d{10,12}$/.test(exp)) {
      throw new UnauthorizedException('Données du token invalides');
    }

    const raw = `${userId}.${familyId}.${exp}`;

    const expectedSignature = hmac(raw, 'AUTH_ACCESS_KEY');

    if (!constantEqual(signature, expectedSignature)) {
      throw new UnauthorizedException('Signature du token invalide');
    }

    const expiration = Number(exp);
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (!Number.isSafeInteger(expiration) || expiration <= nowSeconds) {
      throw new UnauthorizedException('Access token expiré');
    }

    /**
     * Vérification de la session en base :
     * - famille active ;
     * - session non révoquée ;
     * - utilisateur actif ;
     * - téléphone vérifié.
     */
    const session = await this.prisma.session.findFirst({
      where: {
        userId,
        familyId,
        revokedAt: null,
        replacedById: null,
        expiresAt: {
          gt: new Date(),
        },
        user: {
          status: UserStatus.ACTIVE,
          phoneVerifiedAt: {
            not: null,
          },
        },
      },
      select: {
        id: true,
      },
    });

    if (!session) {
      throw new UnauthorizedException('Session expirée ou révoquée');
    }

    return {
      userId,
      familyId,
    };
  }

  /**
   * 4. DÉCONNEXION D'UNE SESSION
   */
  async logout(userId: string, familyId: string): Promise<{ message: string }> {
    await this.prisma.session.updateMany({
      where: {
        userId,
        familyId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return {
      message: 'Déconnecté',
    };
  }

  /**
   * 5. DÉCONNEXION DE TOUS LES APPAREILS
   */
  async logoutAll(userId: string): Promise<{ message: string }> {
    await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return {
      message: 'Toutes les sessions ont été révoquées',
    };
  }

  /**
   * 6. LISTE DES SESSIONS ACTIVES
   */
  async listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        replacedById: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      select: {
        familyId: true,
        createdAt: true,
        lastActivityAt: true,
        expiresAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * 7. RÉVOCATION D'UNE SESSION SPÉCIFIQUE
   */
  async revokeSession(userId: string, familyId: string): Promise<{ message: string }> {
    return this.logout(userId, familyId);
  }
}
