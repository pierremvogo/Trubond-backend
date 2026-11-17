import {
  BadRequestException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';

import { InvitationsService } from './invitations.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationTokenService } from './invitation-token.service';
import { InvitationCryptoService } from './invitation-crypto.service';
import { TestPhoneSecurity } from '../tests/test-phone-security.service';

describe('InvitationsService - resolveInvitation', () => {
  const token = 'A'.repeat(43);

  const findUnique = jest.fn();
  const hash = jest.fn();

  const prisma = {
    invitation: { findUnique },
  } as unknown as PrismaService;

  const tokenService = {
    hash,
  } as unknown as InvitationTokenService;

  const cryptoService = {} as InvitationCryptoService;
  const phoneSecurity = {} as TestPhoneSecurity;

  const service = new InvitationsService(
    prisma,
    tokenService,
    cryptoService,
    phoneSecurity,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    hash.mockReturnValue('hash-fictif');
  });

  it('rejette un token malformé avant toute requête en base', async () => {
    await expect(service.resolveInvitation('token-invalide')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(hash).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejette un token de format valide mais inconnu', async () => {
    findUnique.mockResolvedValue(null);

    await expect(service.resolveInvitation(token)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(hash).toHaveBeenCalledWith(token);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: 'hash-fictif' },
      }),
    );
  });

  it('rejette une invitation expirée', async () => {
    findUnique.mockResolvedValue({
      id: 'invitation-fictive',
      status: 'CREATED',
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      revokedAt: null,
      test: {
        status: 'FUNDED',
        currency: 'XAF',
        rewardAmount: 20000n,
        expiresAt: null,
      },
    });

    await expect(service.resolveInvitation(token)).rejects.toBeInstanceOf(
      GoneException,
    );
  });
});
