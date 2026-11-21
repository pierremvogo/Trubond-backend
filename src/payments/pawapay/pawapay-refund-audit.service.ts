import { Injectable } from '@nestjs/common';
import { PaymentProvider, PaymentStatus, RefundStatus, TestStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PawapayRefundAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async inspect(limit = 50) {
    const refunds = await this.prisma.refund.findMany({
      where: {
        provider: PaymentProvider.PAWAPAY,
        status: RefundStatus.CREATED,
      },
      select: {
        id: true,
        testId: true,
        paymentId: true,
        amount: true,
        currency: true,
        destinationEnc: true,
        idempotencyKey: true,
        providerReference: true,
        test: {
          select: {
            status: true,
            rewardAmount: true,
            currency: true,
          },
        },
        payment: {
          select: {
            id: true,
            status: true,
            provider: true,
            amount: true,
            currency: true,
            confirmedAt: true,
            providerReference: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: Math.min(Math.max(Math.trunc(limit) || 50, 1), 100),
    });

    return refunds.map((refund) => {
      const issues: string[] = [];

      if (refund.test.status !== TestStatus.REFUND_PENDING) {
        issues.push('TEST_STATUS_INVALID');
      }

      if (refund.amount <= 0n || refund.amount !== refund.test.rewardAmount) {
        issues.push('REFUND_AMOUNT_INVALID');
      }

      if (refund.currency !== refund.test.currency) {
        issues.push('REFUND_CURRENCY_MISMATCH');
      }

      if (!refund.payment) {
        issues.push('PAYMENT_MISSING');
      } else {
        if (refund.payment.provider !== PaymentProvider.PAWAPAY) {
          issues.push('PAYMENT_PROVIDER_INVALID');
        }

        if (refund.payment.status !== PaymentStatus.SUCCEEDED || !refund.payment.confirmedAt) {
          issues.push('PAYMENT_NOT_CONFIRMED');
        }

        if (refund.payment.currency !== refund.currency || refund.payment.amount < refund.amount) {
          issues.push('PAYMENT_AMOUNT_INVALID');
        }

        if (!refund.payment.providerReference) {
          issues.push('DEPOSIT_REFERENCE_MISSING');
        }
      }

      if (!refund.destinationEnc) {
        issues.push('DESTINATION_MISSING');
      }

      if (!refund.idempotencyKey) {
        issues.push('IDEMPOTENCY_KEY_MISSING');
      }

      if (refund.providerReference) {
        issues.push('PROVIDER_REFERENCE_ALREADY_PRESENT');
      }

      return {
        refundId: refund.id,
        testId: refund.testId,
        amount: refund.amount.toString(),
        currency: refund.currency,
        eligibleForFurtherReview: issues.length === 0,
        issues,
      };
    });
  }
}
