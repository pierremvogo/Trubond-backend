import { ConflictException, Injectable } from '@nestjs/common';

import {
  LedgerEntrySide,
  LedgerTransactionType,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  RefundStatus,
  TestActorType,
  TestStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PawapayRefundFinalizationService {
  constructor(private readonly prisma: PrismaService) {}

  async finalizeConfirmedRefund(
    refundId: string,
    confirmed: {
      refundId: string;
      depositId: string;
      amount: string;
      currency: string;
      status: string;
    },
  ): Promise<'FINALIZED' | 'ALREADY_FINALIZED'> {
    if (confirmed.status !== 'COMPLETED' || confirmed.refundId !== refundId) {
      throw new ConflictException('Confirmation pawaPay invalide');
    }

    return this.prisma.$transaction(
      async (tx) => {
        // Sérialise les finalisations du même test.
        const candidate = await tx.refund.findUnique({
          where: { id: refundId },
          select: { testId: true },
        });

        if (!candidate) {
          throw new ConflictException('Remboursement introuvable');
        }

        await tx.$queryRaw`
          SELECT id
          FROM tests
          WHERE id = ${candidate.testId}::uuid
          FOR UPDATE
        `;

        await tx.$queryRaw`
          SELECT id
          FROM refunds
          WHERE id = ${refundId}::uuid
          FOR UPDATE
        `;

        const refund = await tx.refund.findUnique({
          where: { id: refundId },
          include: {
            test: true,
            payment: true,
          },
        });

        if (!refund || !refund.payment) {
          throw new ConflictException('Données du remboursement manquantes');
        }

        const payment = refund.payment;

        const amountMatch =
          /^\d+(?:\.0+)?$/.test(confirmed.amount) &&
          BigInt(confirmed.amount.split('.')[0]!) === refund.amount;

        if (
          refund.provider !== PaymentProvider.PAWAPAY ||
          refund.providerReference !== confirmed.refundId ||
          payment.provider !== PaymentProvider.PAWAPAY ||
          payment.status !== PaymentStatus.SUCCEEDED ||
          !payment.confirmedAt ||
          payment.providerReference !== confirmed.depositId ||
          !amountMatch ||
          refund.currency !== confirmed.currency ||
          payment.currency !== refund.currency ||
          refund.amount !== refund.test.rewardAmount ||
          refund.amount <= 0n ||
          payment.amount < refund.amount
        ) {
          throw new ConflictException('Incohérence entre pawaPay et TrueBond');
        }

        const ledgerKey = `pawapay-refund-settlement-${refund.id}`;

        const existingLedger = await tx.ledgerTransaction.findUnique({
          where: {
            idempotencyKey: ledgerKey,
          },
          include: {
            entries: true,
          },
        });

        if (refund.status === RefundStatus.SUCCEEDED) {
          if (
            refund.test.status !== TestStatus.REFUNDED ||
            !refund.confirmedAt ||
            !existingLedger ||
            existingLedger.type !== LedgerTransactionType.REFUND_SETTLEMENT ||
            existingLedger.refundId !== refund.id ||
            existingLedger.entries.length !== 2
          ) {
            throw new ConflictException(
              'Remboursement déjà marqué réussi mais comptabilité incohérente',
            );
          }

          return 'ALREADY_FINALIZED';
        }

        if (
          refund.status !== RefundStatus.PENDING ||
          refund.test.status !== TestStatus.REFUND_PENDING ||
          existingLedger
        ) {
          throw new ConflictException('État incompatible avec la finalisation');
        }

        const accounts = await tx.ledgerAccount.findMany({
          where: {
            currency: refund.currency,
            isActive: true,
            OR: [
              {
                code: 'ESCROW',
                ownerType: 'TEST',
                ownerId: refund.testId,
              },
              {
                code: 'PSP_CLEARING',
                ownerType: 'PLATFORM',
                ownerId: 'PLATFORM',
              },
            ],
          },
        });

        const escrow = accounts.find(
          (account) =>
            account.code === 'ESCROW' &&
            account.ownerType === 'TEST' &&
            account.ownerId === refund.testId &&
            account.normalSide === LedgerEntrySide.CREDIT,
        );

        const clearing = accounts.find(
          (account) =>
            account.code === 'PSP_CLEARING' &&
            account.ownerType === 'PLATFORM' &&
            account.ownerId === 'PLATFORM' &&
            account.normalSide === LedgerEntrySide.DEBIT,
        );

        if (!escrow || !clearing) {
          throw new ConflictException('Comptes comptables requis introuvables');
        }

        // Vérification du solde disponible en séquestre.
        const escrowEntries = await tx.ledgerEntry.findMany({
          where: {
            accountId: escrow.id,
            currency: refund.currency,
          },
          select: {
            side: true,
            amount: true,
          },
        });

        const escrowBalance = escrowEntries.reduce(
          (balance, entry) =>
            balance + (entry.side === LedgerEntrySide.CREDIT ? entry.amount : -entry.amount),
          0n,
        );

        if (escrowBalance < refund.amount) {
          throw new ConflictException('Solde séquestre insuffisant');
        }

        await tx.ledgerTransaction.create({
          data: {
            idempotencyKey: ledgerKey,
            type: LedgerTransactionType.REFUND_SETTLEMENT,
            currency: refund.currency,
            description: 'Remboursement de la récompense après expiration de l’invitation',
            testId: refund.testId,
            paymentId: payment.id,
            refundId: refund.id,
            entries: {
              create: [
                {
                  accountId: escrow.id,
                  side: LedgerEntrySide.DEBIT,
                  amount: refund.amount,
                  currency: refund.currency,
                  memo: 'Libération du séquestre',
                },
                {
                  accountId: clearing.id,
                  side: LedgerEntrySide.CREDIT,
                  amount: refund.amount,
                  currency: refund.currency,
                  memo: 'Remboursement pawaPay confirmé',
                },
              ],
            },
          },
        });

        const updatedRefund = await tx.refund.updateMany({
          where: {
            id: refund.id,
            status: RefundStatus.PENDING,
            providerReference: confirmed.refundId,
          },
          data: {
            status: RefundStatus.SUCCEEDED,
            confirmedAt: new Date(),
          },
        });

        if (updatedRefund.count !== 1) {
          throw new ConflictException('Transition du remboursement refusée');
        }

        const updatedTest = await tx.test.updateMany({
          where: {
            id: refund.testId,
            status: TestStatus.REFUND_PENDING,
          },
          data: {
            status: TestStatus.REFUNDED,
            version: { increment: 1 },
          },
        });

        if (updatedTest.count !== 1) {
          throw new ConflictException('Transition du test refusée');
        }

        await tx.testEvent.create({
          data: {
            testId: refund.testId,
            fromStatus: TestStatus.REFUND_PENDING,
            toStatus: TestStatus.REFUNDED,
            actorType: TestActorType.WORKER,
            reason: 'Remboursement de la récompense confirmé par pawaPay',
            source: 'PAWAPAY_REFUND_RECONCILIATION',
            correlationId: refund.id,
          },
        });

        return 'FINALIZED';
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000,
      },
    );
  }
}
