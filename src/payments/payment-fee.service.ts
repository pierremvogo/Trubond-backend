import { ConflictException, Injectable } from '@nestjs/common';

import { FeeOperationType, PaymentProvider } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface CollectionFeeQuote {
  feeScheduleId: string;
  provider: PaymentProvider;
  subtotalAmount: bigint;
  providerFeeAmount: bigint;
  totalAmount: bigint;
  currency: string;
}

@Injectable()
export class PaymentFeeService {
  constructor(private readonly prisma: PrismaService) {}

  async quoteCollection(
    countryCode: string,
    currency: string,
    provider: PaymentProvider,
    subtotalAmount: bigint,
  ): Promise<CollectionFeeQuote> {
    if (subtotalAmount <= 0n) {
      throw new ConflictException('Montant de base invalide');
    }

    const now = new Date();

    const schedule = await this.prisma.feeSchedule.findFirst({
      where: {
        countryCode,
        currency,
        provider,
        operationType: FeeOperationType.COLLECTION,
        active: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });

    if (!schedule) {
      throw new ConflictException(`Aucun tarif COLLECTION actif pour ${provider}`);
    }

    const fixed = schedule.fixedAmount;
    const rate = BigInt(schedule.rateBps);

    if (fixed < 0n || rate < 0n || rate >= 10000n) {
      throw new ConflictException('Configuration des frais invalide');
    }

    // Calcul en entiers pour éviter les erreurs
    // d'arrondi des montants financiers.
    //
    // Hypothèse configurable à valider :
    // frais prélevés sur le total débité.

    const numerator = (subtotalAmount + fixed) * 10000n;

    const denominator = 10000n - rate;

    const totalAmount = (numerator + denominator - 1n) / denominator;

    return {
      feeScheduleId: schedule.id,
      provider,
      subtotalAmount,
      providerFeeAmount: totalAmount - subtotalAmount,
      totalAmount,
      currency,
    };
  }
}
