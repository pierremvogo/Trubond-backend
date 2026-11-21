import { ConflictException } from '@nestjs/common';

export interface ExpectedPawapayRefund {
  refundId: string;
  amount: bigint;
  currency: string;
}

export interface ConfirmedPawapayRefund {
  refundId: string;
  status: 'COMPLETED';
  amount: string;
  currency: string;
}

export function validateCompletedPawapayRefund(
  remote: unknown,
  expected: ExpectedPawapayRefund,
): ConfirmedPawapayRefund {
  if (typeof remote !== 'object' || remote === null || Array.isArray(remote)) {
    throw new ConflictException('Réponse de remboursement pawaPay invalide');
  }

  const data = remote as Record<string, unknown>;

  if (data.refundId !== expected.refundId) {
    throw new ConflictException('Identifiant de remboursement pawaPay incohérent');
  }

  if (data.status !== 'COMPLETED') {
    throw new ConflictException('Le remboursement n’est pas confirmé par pawaPay');
  }

  if (data.currency !== expected.currency) {
    throw new ConflictException('Devise du remboursement pawaPay incohérente');
  }

  if (typeof data.amount !== 'string' || !/^\d+(?:\.\d+)?$/.test(data.amount)) {
    throw new ConflictException('Format du montant pawaPay invalide');
  }

  const [integerPart, decimalPart = ''] = data.amount.split('.');

  // TrueBond utilise des montants XAF entiers.
  if (!integerPart || !/^0*$/.test(decimalPart) || BigInt(integerPart) !== expected.amount) {
    throw new ConflictException('Montant du remboursement pawaPay incohérent');
  }

  return {
    refundId: expected.refundId,
    status: 'COMPLETED',
    amount: data.amount,
    currency: expected.currency,
  };
}
