import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PaymentMethodType,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  TestActorType,
  TestStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { PaymentFeeService } from '../payment-fee.service';
import { CreatePawapayDepositDto } from './dto/create-pawapay-deposit.dto';
import { decrypt, encrypt } from 'src/auth/auth.crypto';
import { PawapayApiService } from './pawapay-api.service';

@Injectable()
export class PawapayDepositsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentFees: PaymentFeeService,
    private readonly pawapayApi: PawapayApiService,
  ) {}

  async quoteDeposit(userId: string, testId: string) {
    const test = await this.prisma.test.findFirst({
      where: {
        id: testId,
        initiatorId: userId,
      },
      select: {
        id: true,
        status: true,
        currency: true,
        totalAmount: true,
        serviceFeeAmount: true,
        initiator: {
          select: { countryCode: true },
        },
      },
    });

    if (!test) {
      throw new NotFoundException('Test introuvable');
    }

    if (test.status !== TestStatus.DRAFT && test.status !== TestStatus.PAYMENT_PENDING) {
      throw new ConflictException('Ce test ne peut plus être payé');
    }

    if (test.currency !== 'XAF' || test.initiator.countryCode !== 'CM') {
      throw new ConflictException('pawaPay est actuellement limité au Cameroun en XAF');
    }

    const quote = await this.paymentFees.quoteCollection(
      'CM',
      'XAF',
      PaymentProvider.PAWAPAY,
      test.totalAmount,
    );

    return {
      testId: test.id,
      currency: quote.currency,
      rewardAmount: (test.totalAmount - test.serviceFeeAmount).toString(),
      serviceFeeAmount: test.serviceFeeAmount.toString(),
      providerFeeAmount: quote.providerFeeAmount.toString(),
      totalAmount: quote.totalAmount.toString(),
      feeScheduleId: quote.feeScheduleId,
    };
  }

  async reserveDeposit(userId: string, testId: string, dto: CreatePawapayDepositDto) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${testId}::text)
          )
        `;

        const test = await tx.test.findFirst({
          where: {
            id: testId,
            initiatorId: userId,
          },
          select: {
            id: true,
            status: true,
            currency: true,
            totalAmount: true,
            serviceFeeAmount: true,
            initiator: {
              select: { countryCode: true },
            },
          },
        });

        if (!test) {
          throw new NotFoundException('Test introuvable');
        }

        if (test.status !== TestStatus.DRAFT) {
          throw new ConflictException('Ce test ne peut pas démarrer un nouveau paiement');
        }

        if (test.currency !== 'XAF' || test.initiator.countryCode !== 'CM') {
          throw new ConflictException('pawaPay est limité au Cameroun en XAF');
        }

        const activePayment = await tx.payment.findFirst({
          where: {
            testId,
            status: {
              in: [
                PaymentStatus.CREATED,
                PaymentStatus.PENDING,
                PaymentStatus.SUCCEEDED,
                PaymentStatus.REQUIRES_REVIEW,
              ],
            },
          },
        });

        if (activePayment) {
          throw new ConflictException('Un paiement est déjà actif pour ce test');
        }

        const now = new Date();

        const schedule = await tx.feeSchedule.findFirst({
          where: {
            countryCode: 'CM',
            currency: 'XAF',
            provider: PaymentProvider.PAWAPAY,
            operationType: 'COLLECTION',
            active: true,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
          orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
        });

        if (!schedule) {
          throw new ConflictException('Aucun tarif de collecte pawaPay actif');
        }

        const rate = BigInt(schedule.rateBps);
        const fixed = schedule.fixedAmount;

        if (fixed < 0n || rate < 0n || rate >= 10000n) {
          throw new ConflictException('Configuration des frais invalide');
        }

        const denominator = 10000n - rate;

        const amount = ((test.totalAmount + fixed) * 10000n + denominator - 1n) / denominator;

        const providerFeeAmount = amount - test.totalAmount;

        const maxAmount = dto.correspondent === 'ORANGE_CMR' ? 500000n : 1000000n;

        if (amount < 1n || amount > maxAmount) {
          throw new ConflictException('Montant hors limites pour cet opérateur');
        }

        const depositId = randomUUID();

        const payment = await tx.payment.create({
          data: {
            testId,
            provider: PaymentProvider.PAWAPAY,
            methodType: PaymentMethodType.MOBILE_MONEY,
            status: PaymentStatus.CREATED,
            amount,
            currency: 'XAF',
            idempotencyKey: depositId,
            providerReference: depositId,
            feeScheduleId: schedule.id,
            providerFeeAmount,
            serviceFeeAmount: test.serviceFeeAmount,
          },
        });

        await tx.pawapayDepositRequest.create({
          data: {
            paymentId: payment.id,
            correspondent: dto.correspondent,
            phoneNumberEnc: encrypt(dto.phoneNumber),
          },
        });

        await tx.test.update({
          where: { id: testId },
          data: {
            status: TestStatus.PAYMENT_PENDING,
            version: { increment: 1 },
          },
        });

        await tx.testEvent.create({
          data: {
            testId,
            fromStatus: TestStatus.DRAFT,
            toStatus: TestStatus.PAYMENT_PENDING,
            actorType: TestActorType.USER,
            actorId: userId,
            source: 'pawapay.deposit.reserved',
            reason: 'Dépôt Mobile Money réservé',
          },
        });

        return {
          testId,
          paymentId: payment.id,
          depositId,
          correspondent: dto.correspondent,
          amount: amount.toString(),
          currency: 'XAF',
          providerFeeAmount: providerFeeAmount.toString(),
          serviceFeeAmount: test.serviceFeeAmount.toString(),
          status: payment.status,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  async getDepositStatus(userId: string, testId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        testId,
        provider: PaymentProvider.PAWAPAY,
        test: {
          initiatorId: userId,
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        providerReference: true,
        status: true,
        amount: true,
        currency: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Paiement pawaPay introuvable');
    }

    return {
      paymentId: payment.id,
      depositId: payment.providerReference,
      status: payment.status,
      amount: payment.amount.toString(),
      currency: payment.currency,
    };
  }

  async getRemoteDepositStatus(userId: string, testId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        testId,
        provider: PaymentProvider.PAWAPAY,
        test: {
          initiatorId: userId,
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        providerReference: true,
        amount: true,
        currency: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Paiement pawaPay introuvable');
    }

    if (!payment.providerReference) {
      throw new ConflictException('Identifiant de dépôt pawaPay manquant');
    }

    const response = await this.pawapayApi.getDeposit(payment.providerReference);
    if (response.status === 'NOT_FOUND') {
      return {
        paymentId: payment.id,
        depositId: payment.providerReference,
        amount: payment.amount.toString(),
        currency: payment.currency,
        providerStatus: 'NOT_FOUND',
        confirmed: false,
      };
    }

    if (response.status !== 'FOUND' || !response.data) {
      throw new ConflictException('Réponse de consultation pawaPay invalide');
    }
    const remote = response.data;

    if (
      remote.depositId !== payment.providerReference ||
      remote.currency !== payment.currency ||
      !/^\d+(?:\.\d+)?$/.test(remote.amount)
    ) {
      throw new ConflictException('Les informations du dépôt pawaPay ne correspondent pas');
    }

    const [integerPart, decimalPart = ''] = remote.amount.split('.');

    if (!integerPart || !/^0*$/.test(decimalPart) || BigInt(integerPart) !== payment.amount) {
      throw new ConflictException('Le montant du dépôt pawaPay ne correspond pas');
    }
    const allowedStatuses = ['PROCESSING', 'COMPLETED', 'FAILED'] as const;

    if (
      typeof remote.status !== 'string' ||
      !allowedStatuses.some((status) => status === remote.status)
    ) {
      throw new ConflictException('Statut de dépôt pawaPay inconnu ou invalide');
    }

    return {
      paymentId: payment.id,
      depositId: payment.providerReference,
      amount: payment.amount.toString(),
      currency: payment.currency,
      providerStatus: remote.status,
      confirmed: remote.status === 'COMPLETED',
    };
  }

  async claimDepositInitiation(userId: string, testId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        testId,
        provider: PaymentProvider.PAWAPAY,
        status: PaymentStatus.CREATED,
        test: {
          initiatorId: userId,
          status: TestStatus.PAYMENT_PENDING,
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        providerReference: true,
        amount: true,
        currency: true,
        pawapayDepositRequest: {
          select: {
            correspondent: true,
            phoneNumberEnc: true,
          },
        },
      },
    });

    if (!payment || !payment.providerReference || !payment.pawapayDepositRequest) {
      throw new ConflictException('Aucun dépôt pawaPay disponible pour initiation');
    }

    const attemptToken = randomUUID();

    const claimed = await this.prisma.pawapayDepositRequest.updateMany({
      where: {
        paymentId: payment.id,
        initiationStatus: 'RESERVED',
      },
      data: {
        initiationStatus: 'SENDING',
        attemptCount: { increment: 1 },
        attemptToken,
        lastAttemptAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    if (claimed.count !== 1) {
      throw new ConflictException('Ce dépôt est déjà initié ou en cours de traitement');
    }

    return {
      paymentId: payment.id,
      depositId: payment.providerReference,
      amount: payment.amount.toString(),
      currency: payment.currency,
      correspondent: payment.pawapayDepositRequest.correspondent,
      phoneNumberEnc: payment.pawapayDepositRequest.phoneNumberEnc,
      attemptToken,
    };
  }

  async initiateDeposit(userId: string, testId: string) {
    const claim = await this.claimDepositInitiation(userId, testId);

    const saveResult = async (status: 'ACCEPTED' | 'UNCERTAIN', errorCode: string | null) => {
      const result = await this.prisma.pawapayDepositRequest.updateMany({
        where: {
          paymentId: claim.paymentId,
          attemptToken: claim.attemptToken,
          initiationStatus: 'SENDING',
        },
        data: {
          initiationStatus: status,
          acceptedAt: status === 'ACCEPTED' ? new Date() : null,
          leaseExpiresAt: null,
          lastErrorCode: errorCode,
        },
      });

      if (result.count !== 1) {
        throw new ConflictException('État d’initiation modifié : réconciliation nécessaire');
      }
    };

    try {
      const response = await this.pawapayApi.post<{
        status: string;
        depositId?: string;
      }>('/v2/deposits', {
        depositId: claim.depositId,
        amount: claim.amount,
        currency: claim.currency,
        payer: {
          type: 'MMO',
          accountDetails: {
            phoneNumber: decrypt(claim.phoneNumberEnc),
            provider: claim.correspondent,
          },
        },
      });

      if (
        response.status !== 'ACCEPTED' ||
        (response.depositId !== undefined && response.depositId !== claim.depositId)
      ) {
        await saveResult('UNCERTAIN', 'UNEXPECTED_RESPONSE');

        return {
          depositId: claim.depositId,
          status: 'UNCERTAIN',
          confirmed: false,
        };
      }

      await saveResult('ACCEPTED', null);

      return {
        depositId: claim.depositId,
        status: 'ACCEPTED',
        confirmed: false,
      };
    } catch {
      // Un timeout ne signifie pas que pawaPay
      // n'a pas reçu la demande.
      await saveResult('UNCERTAIN', 'INITIATION_ERROR');

      return {
        depositId: claim.depositId,
        status: 'UNCERTAIN',
        confirmed: false,
      };
    }
  }

  async recoverStuckInitiations(limit = 50) {
    const now = new Date();

    // Réserver uniquement les lignes dont le bail SENDING a expiré.
    // Aucun nouveau POST vers pawaPay.
    const stuck = await this.prisma.pawapayDepositRequest.findMany({
      where: {
        initiationStatus: 'SENDING',
        leaseExpiresAt: { lte: now },
      },
      select: {
        paymentId: true,
        attemptToken: true,
      },
      orderBy: { leaseExpiresAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    let recovered = 0;

    for (const item of stuck) {
      const result = await this.prisma.pawapayDepositRequest.updateMany({
        where: {
          paymentId: item.paymentId,
          initiationStatus: 'SENDING',
          attemptToken: item.attemptToken,
          leaseExpiresAt: { lte: now },
        },
        data: {
          initiationStatus: 'UNCERTAIN',
          leaseExpiresAt: null,
          lastErrorCode: 'INITIATION_LEASE_EXPIRED',
        },
      });

      recovered += result.count;
    }

    return { recovered };
  }

  async findDepositsToReconcile(limit = 50) {
    const requests = await this.prisma.pawapayDepositRequest.findMany({
      where: {
        initiationStatus: {
          in: ['UNCERTAIN', 'ACCEPTED'],
        },
      },
      select: {
        paymentId: true,
        initiationStatus: true,
        payment: {
          select: {
            providerReference: true,
            status: true,
          },
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    return requests
      .filter(
        (request) =>
          request.payment.providerReference !== null &&
          request.payment.status !== 'SUCCEEDED' &&
          request.payment.status !== 'FAILED' &&
          request.payment.status !== 'CANCELLED',
      )
      .map((request) => ({
        paymentId: request.paymentId,
        depositId: request.payment.providerReference!,
        initiationStatus: request.initiationStatus,
      }));
  }

  async reconcileDeposit(paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        provider: PaymentProvider.PAWAPAY,
      },
      select: {
        id: true,
        providerReference: true,
        amount: true,
        currency: true,
        pawapayDepositRequest: {
          select: {
            initiationStatus: true,
          },
        },
      },
    });

    if (!payment?.providerReference || !payment.pawapayDepositRequest) {
      throw new NotFoundException('Dépôt pawaPay introuvable');
    }

    if (!['UNCERTAIN', 'ACCEPTED'].includes(payment.pawapayDepositRequest.initiationStatus)) {
      throw new ConflictException('Ce dépôt ne nécessite pas de réconciliation');
    }

    const response = await this.pawapayApi.getDeposit(payment.providerReference);

    if (response.status === 'NOT_FOUND') {
      return {
        paymentId,
        depositId: payment.providerReference,
        providerStatus: 'NOT_FOUND',
        confirmed: false,
      };
    }

    if (response.status !== 'FOUND' || !response.data) {
      throw new ConflictException('Réponse pawaPay invalide');
    }

    const remote = response.data;

    if (
      remote.depositId !== payment.providerReference ||
      remote.currency !== payment.currency ||
      !/^\d+(?:\.\d+)?$/.test(remote.amount)
    ) {
      throw new ConflictException('Identifiant, devise ou montant pawaPay invalide');
    }

    const [integerPart, decimalPart = ''] = remote.amount.split('.');

    if (!/^0*$/.test(decimalPart) || BigInt(integerPart!) !== payment.amount) {
      throw new ConflictException('Montant pawaPay incohérent');
    }

    if (!['PROCESSING', 'COMPLETED', 'FAILED'].includes(remote.status)) {
      throw new ConflictException('Statut pawaPay inconnu');
    }

    return {
      paymentId,
      depositId: payment.providerReference,
      providerStatus: remote.status,
      confirmed: remote.status === 'COMPLETED',
    };
  }

  private async ensureLedgerAccounts(tx: Prisma.TransactionClient, testId: string) {
    const definitions = [
      {
        code: 'PSP_CLEARING',
        name: 'Fonds en transit pawaPay',
        type: 'ASSET',
        normalSide: 'DEBIT',
        ownerType: 'PLATFORM',
        ownerId: 'PLATFORM',
      },
      {
        code: 'ESCROW',
        name: 'Fonds réservés pour le test',
        type: 'LIABILITY',
        normalSide: 'CREDIT',
        ownerType: 'TEST',
        ownerId: testId,
      },
      {
        code: 'PLATFORM_FEE_REVENUE',
        name: 'Revenus des frais de service',
        type: 'REVENUE',
        normalSide: 'CREDIT',
        ownerType: 'PLATFORM',
        ownerId: 'PLATFORM',
      },
      {
        code: 'PSP_FEE_EXPENSE',
        name: 'Frais de paiement pawaPay',
        type: 'EXPENSE',
        normalSide: 'DEBIT',
        ownerType: 'PLATFORM',
        ownerId: 'PLATFORM',
      },
      {
        code: 'PSP_FEE_RESERVE',
        name: 'Réserve des frais pawaPay estimés',
        type: 'LIABILITY',
        normalSide: 'CREDIT',
        ownerType: 'PLATFORM',
        ownerId: 'PLATFORM',
      },
    ] as const;

    const accounts = await Promise.all(
      definitions.map(async (account) => {
        const record = await tx.ledgerAccount.upsert({
          where: {
            code_currency_ownerType_ownerId: {
              code: account.code,
              currency: 'XAF',
              ownerType: account.ownerType,
              ownerId: account.ownerId,
            },
          },
          create: {
            ...account,
            currency: 'XAF',
          },
          update: {},
        });

        if (
          !record.isActive ||
          record.type !== account.type ||
          record.normalSide !== account.normalSide
        ) {
          throw new ConflictException(`Configuration comptable invalide : ${account.code}`);
        }

        return record;
      }),
    );

    const [clearing, escrow, revenue, pspExpense, pspFeeReserve] = accounts;

    if (!clearing || !escrow || !revenue || !pspExpense || !pspFeeReserve) {
      throw new ConflictException('Comptes comptables incomplets');
    }

    return {
      clearing,
      escrow,
      revenue,
      pspExpense,
      pspFeeReserve,
    };
  }

  private calculateFundingAmounts(payment: {
    amount: bigint;
    providerFeeAmount: bigint;
    serviceFeeAmount: bigint;
    test: {
      rewardAmount: bigint;
      serviceFeeAmount: bigint;
      totalAmount: bigint;
    };
  }) {
    const { rewardAmount, serviceFeeAmount, totalAmount } = payment.test;

    if (
      rewardAmount <= 0n ||
      serviceFeeAmount < 0n ||
      payment.providerFeeAmount < 0n ||
      payment.amount <= 0n
    ) {
      throw new ConflictException('Montants de financement invalides');
    }

    if (
      rewardAmount + serviceFeeAmount !== totalAmount ||
      payment.serviceFeeAmount !== serviceFeeAmount ||
      payment.amount !== totalAmount + payment.providerFeeAmount
    ) {
      throw new ConflictException('Incohérence entre paiement, frais et montant du test');
    }

    return {
      collectedAmount: payment.amount,
      escrowAmount: rewardAmount,
      serviceFeeAmount,
      estimatedProviderFee: payment.providerFeeAmount,
    };
  }

  async finalizeConfirmedDeposit(paymentId: string) {
    // Une réponse ACCEPTED ne confirme pas le paiement.
    // La confirmation doit venir de pawaPay.
    const remote = await this.reconcileDeposit(paymentId);

    if (!remote.confirmed || remote.providerStatus !== 'COMPLETED') {
      throw new ConflictException('Le dépôt pawaPay n’est pas confirmé');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.payment.findFirst({
          where: {
            id: paymentId,
            provider: PaymentProvider.PAWAPAY,
          },
          include: {
            test: true,
          },
        });

        if (!payment || payment.currency !== 'XAF') {
          throw new ConflictException('Paiement pawaPay invalide');
        }

        // Verrouiller les opérations financières du test.
        await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${payment.testId}::text, 0)
        )
      `;

        // Relire le paiement après acquisition du verrou.
        const current = await tx.payment.findUniqueOrThrow({
          where: {
            id: paymentId,
          },
          include: {
            test: true,
          },
        });

        if (current.provider !== PaymentProvider.PAWAPAY || current.currency !== 'XAF') {
          throw new ConflictException('Paiement pawaPay invalide');
        }

        const ledgerKey = `pawapay-funding-${paymentId}`;

        const existingLedger = await tx.ledgerTransaction.findUnique({
          where: {
            idempotencyKey: ledgerKey,
          },
        });

        // Idempotence : un dépôt déjà finalisé ne doit
        // jamais produire une seconde écriture.
        if (current.status === PaymentStatus.SUCCEEDED) {
          if (!existingLedger || current.test.status === TestStatus.PAYMENT_PENDING) {
            throw new ConflictException('Financement partiellement enregistré');
          }

          return {
            paymentId,
            status: 'SUCCEEDED',
            alreadyProcessed: true,
          };
        }

        if (current.status !== PaymentStatus.CREATED && current.status !== PaymentStatus.PENDING) {
          throw new ConflictException('Statut du paiement incompatible');
        }

        if (current.test.status !== TestStatus.PAYMENT_PENDING || existingLedger) {
          throw new ConflictException('Test déjà financé ou état comptable incohérent');
        }

        // Contrôler les montants avant comptabilisation.
        const amounts = this.calculateFundingAmounts(current);

        if (
          amounts.collectedAmount <= 0n ||
          amounts.escrowAmount < 0n ||
          amounts.serviceFeeAmount < 0n ||
          amounts.estimatedProviderFee < 0n
        ) {
          throw new ConflictException('Montants financiers invalides');
        }

        const accounts = await this.ensureLedgerAccounts(tx, current.testId);

        const feeReserve = amounts.estimatedProviderFee;

        // Tableau explicitement typé :
        // corrige l'erreur "side: string".
        const entries: Array<{
          accountId: string;
          side: 'DEBIT' | 'CREDIT';
          amount: bigint;
        }> = [];

        // Débit : montant total collecté.
        entries.push({
          accountId: accounts.clearing.id,
          side: 'DEBIT',
          amount: amounts.collectedAmount,
        });

        // Crédit : récompense bloquée dans l'escrow.
        if (amounts.escrowAmount > 0n) {
          entries.push({
            accountId: accounts.escrow.id,
            side: 'CREDIT',
            amount: amounts.escrowAmount,
          });
        }

        // Crédit : frais de service TRUEBOND.
        if (amounts.serviceFeeAmount > 0n) {
          entries.push({
            accountId: accounts.revenue.id,
            side: 'CREDIT',
            amount: amounts.serviceFeeAmount,
          });
        }

        // Crédit : réserve provisoire des frais PSP.
        if (feeReserve > 0n) {
          entries.push({
            accountId: accounts.pspFeeReserve.id,
            side: 'CREDIT',
            amount: feeReserve,
          });
        }

        // Vérifier l'équilibre débit / crédit.
        const totalDebit = entries
          .filter((entry) => entry.side === 'DEBIT')
          .reduce((sum, entry) => sum + entry.amount, 0n);

        const totalCredit = entries
          .filter((entry) => entry.side === 'CREDIT')
          .reduce((sum, entry) => sum + entry.amount, 0n);

        if (totalDebit !== totalCredit) {
          throw new ConflictException('Écritures comptables déséquilibrées');
        }

        if (entries.length < 2) {
          throw new ConflictException('Nombre insuffisant d’écritures comptables');
        }

        // Enregistrer la transaction comptable.
        await tx.ledgerTransaction.create({
          data: {
            idempotencyKey: ledgerKey,
            type: 'PAYMENT_CAPTURE',
            currency: 'XAF',
            paymentId,
            testId: current.testId,
            description: 'Encaissement pawaPay confirmé',
            entries: {
              create: entries.map((entry) => ({
                accountId: entry.accountId,
                side: entry.side,
                amount: entry.amount,
                currency: 'XAF',
              })),
            },
          },
        });

        // Confirmer le paiement.
        await tx.payment.update({
          where: {
            id: paymentId,
          },
          data: {
            status: PaymentStatus.SUCCEEDED,
            confirmedAt: new Date(),
          },
        });

        // Passer le test à FUNDED.
        await tx.test.update({
          where: {
            id: current.testId,
          },
          data: {
            status: TestStatus.FUNDED,
            version: {
              increment: 1,
            },
          },
        });

        // Enregistrer l'historique.
        await tx.testEvent.create({
          data: {
            testId: current.testId,
            fromStatus: TestStatus.PAYMENT_PENDING,
            toStatus: TestStatus.FUNDED,
            actorType: TestActorType.SYSTEM,
            source: 'PAWAPAY',
            reason: 'Dépôt pawaPay confirmé',
            correlationId: paymentId,
          },
        });

        // Préparer la publication de l'événement.
        await tx.outboxEvent.create({
          data: {
            eventType: 'test.funded',
            aggregateType: 'Test',
            aggregateId: current.testId,
            dedupeKey: `test-funded-${current.testId}`,
            payload: {
              testId: current.testId,
              paymentId,
              provider: 'PAWAPAY',
            },
          },
        });

        return {
          paymentId,
          status: 'SUCCEEDED',
          alreadyProcessed: false,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15000,
      },
    );
  }
}
