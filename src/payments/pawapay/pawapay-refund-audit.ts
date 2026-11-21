import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  try {
    const refunds = await prisma.refund.findMany({
      where: {
        provider: 'PAWAPAY',
        status: 'CREATED',
      },
      select: {
        id: true,
        testId: true,
        amount: true,
        currency: true,
        idempotencyKey: true,
        providerReference: true,
        test: {
          select: {
            status: true,
            rewardAmount: true,
          },
        },
        payment: {
          select: {
            provider: true,
            status: true,
            confirmedAt: true,
            providerReference: true,
            amount: true,
            currency: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    let eligible = 0;
    let blocked = 0;

    for (const refund of refunds) {
      const valid =
        refund.test.status === 'REFUND_PENDING' &&
        refund.amount > 0n &&
        refund.amount === refund.test.rewardAmount &&
        refund.payment?.provider === 'PAWAPAY' &&
        refund.payment?.status === 'SUCCEEDED' &&
        refund.payment.confirmedAt !== null &&
        Boolean(refund.payment.providerReference) &&
        refund.payment.amount >= refund.amount &&
        refund.payment.currency === refund.currency &&
        Boolean(refund.idempotencyKey) &&
        !refund.providerReference;

      if (valid) {
        eligible++;
      } else {
        blocked++;
      }

      console.log(
        JSON.stringify({
          refundId: refund.id,
          testId: refund.testId,
          amount: refund.amount.toString(),
          currency: refund.currency,
          preliminaryCheck: valid ? 'PASSED' : 'BLOCKED',
        }),
      );
    }

    console.log(
      JSON.stringify({
        inspected: refunds.length,
        eligibleForFurtherReview: eligible,
        blocked,
        mode: 'READ_ONLY',
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
