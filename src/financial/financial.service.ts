import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface FinancialAmounts {
  testId: string;
  currency: string;
  rewardAmount: bigint;
  serviceFeeAmount: bigint;
  totalAmount: bigint;
  status: string;
}

@Injectable()
export class FinancialService {
  constructor(private readonly prisma: PrismaService) {}

  async getTestAmounts(testId: string): Promise<FinancialAmounts> {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      select: {
        id: true,
        currency: true,
        rewardAmount: true,
        serviceFeeAmount: true,
        totalAmount: true,
        status: true,
      },
    });

    if (!test) {
      throw new NotFoundException('Test introuvable');
    }

    if (
      test.rewardAmount < 0n ||
      test.serviceFeeAmount < 0n ||
      test.totalAmount !== test.rewardAmount + test.serviceFeeAmount
    ) {
      throw new Error('Montants financiers incohérents');
    }

    return {
      testId: test.id,
      currency: test.currency,
      rewardAmount: test.rewardAmount,
      serviceFeeAmount: test.serviceFeeAmount,
      totalAmount: test.totalAmount,
      status: test.status,
    };
  }
}
