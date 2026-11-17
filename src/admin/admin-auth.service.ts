import { Injectable, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';

import { createHash, timingSafeEqual } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';

export type AdminContext = {
  adminId: string;
};

@Injectable()
export class AdminAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async validate(token: string): Promise<AdminContext> {
    const expected = process.env.ADMIN_ACCESS_TOKEN;
    const adminId = process.env.PRIMARY_ADMIN_ID;

    if (!expected || !adminId || expected.length < 32) {
      throw new ServiceUnavailableException('Authentification administrateur non configurée');
    }

    if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
      throw new UnauthorizedException('Authentification administrateur invalide');
    }

    const receivedHash = createHash('sha256').update(token).digest();

    const expectedHash = createHash('sha256').update(expected).digest();

    if (!timingSafeEqual(receivedHash, expectedHash)) {
      throw new UnauthorizedException('Authentification administrateur invalide');
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: {
        id: adminId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!admin || admin.status !== 'ACTIVE') {
      throw new UnauthorizedException('Administrateur non autorisé');
    }

    return {
      adminId: admin.id,
    };
  }
}
