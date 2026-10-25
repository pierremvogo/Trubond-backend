import { NotFoundException } from '@nestjs/common';
import { FinancialService } from './financial.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FinancialService', () => {
  const findUnique = jest.fn();
  const prisma = { test: { findUnique } } as unknown as PrismaService;
  const service = new FinancialService(prisma);

  beforeEach(() => jest.resetAllMocks());

  it('lit et valide 20 000 + 2 500 = 22 500 XAF', async () => {
    findUnique.mockResolvedValue({
      id: 'test-1',
      currency: 'XAF',
      rewardAmount: 20000n,
      serviceFeeAmount: 2500n,
      totalAmount: 22500n,
      status: 'DRAFT',
    });
    const result = await service.getTestAmounts('test-1');
    expect(result.rewardAmount).toBe(20000n);
    expect(result.serviceFeeAmount).toBe(2500n);
    expect(result.totalAmount).toBe(22500n);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'test-1' } }),
    );
  });

  it('refuse des montants incohérents', async () => {
    findUnique.mockResolvedValue({
      id: 'test-2',
      currency: 'XAF',
      rewardAmount: 20000n,
      serviceFeeAmount: 2500n,
      totalAmount: 20000n,
      status: 'DRAFT',
    });
    await expect(service.getTestAmounts('test-2')).rejects.toThrow(
      'Montants financiers incohérents',
    );
  });

  it('refuse un montant négatif', async () => {
    findUnique.mockResolvedValue({
      id: 'test-3',
      currency: 'XAF',
      rewardAmount: -1n,
      serviceFeeAmount: 2500n,
      totalAmount: 2499n,
      status: 'DRAFT',
    });
    await expect(service.getTestAmounts('test-3')).rejects.toThrow(
      'Montants financiers incohérents',
    );
  });

  it('signale un test absent', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.getTestAmounts('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
