import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { FeeOperationType, Prisma, TestActorType, TestStatus, UserStatus } from '@prisma/client';

import { randomBytes } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import { TestPhoneSecurity } from './test-phone-security.service';
import { CreateTestDto } from './dto/create-test.dto';

@Injectable()
export class TestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phoneSecurity: TestPhoneSecurity,
  ) {}

  private readonly selectFields = {
    id: true,
    publicCode: true,
    status: true,
    currency: true,
    rewardAmount: true,
    serviceFeeAmount: true,
    totalAmount: true,
    createdAt: true,
    sentAt: true,
    expiresAt: true,
    completedAt: true,
  } as const;

  private serialize(test: {
    id: string;
    publicCode: string;
    status: string;
    currency: string;
    rewardAmount: bigint;
    serviceFeeAmount: bigint;
    totalAmount: bigint;
    createdAt: Date;
    sentAt: Date | null;
    expiresAt: Date | null;
    completedAt: Date | null;
  }) {
    return {
      id: test.id,
      publicCode: test.publicCode,
      status: test.status,
      currency: test.currency,
      rewardAmount: test.rewardAmount.toString(),
      serviceFeeAmount: test.serviceFeeAmount.toString(),
      totalAmount: test.totalAmount.toString(),
      createdAt: test.createdAt.toISOString(),
      sentAt: test.sentAt?.toISOString() ?? null,
      expiresAt: test.expiresAt?.toISOString() ?? null,
      completedAt: test.completedAt?.toISOString() ?? null,
    };
  }

  async create(userId: string, dto: CreateTestDto) {
    const initiator = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        countryCode: true,
        phoneHmac: true,
        phoneVerifiedAt: true,
      },
    });

    if (!initiator || initiator.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Compte non autorisé');
    }

    const country = await this.prisma.country.findUnique({
      where: { code: initiator.countryCode },
    });

    if (!country || !country.enabled) {
      throw new BadRequestException('La création de tests est indisponible dans ce pays');
    }

    if (country.defaultCurrency !== 'XAF') {
      throw new BadRequestException('Ce formulaire accepte uniquement les récompenses XAF');
    }

    const reward = BigInt(dto.rewardXaf);

    if (reward < country.minRewardAmount) {
      throw new BadRequestException(`La récompense minimale est de ${country.minRewardAmount} XAF`);
    }

    const recipientPhone = this.phoneSecurity.normalize(dto.recipientPhone);

    const recipientPhoneHmac = this.phoneSecurity.hmac(recipientPhone);

    const recipientPhoneEnc = this.phoneSecurity.encrypt(recipientPhone);

    // Le numéro principal compte parmi les trois numéros.
    const verifiedPhones = await this.prisma.userPhone.findMany({
      where: {
        userId,
        verifiedAt: { not: null },
      },
      select: {
        phoneHmac: true,
      },
    });

    const expectedPhoneHmacs = new Set(verifiedPhones.map((phone) => phone.phoneHmac));

    if (initiator.phoneVerifiedAt) {
      expectedPhoneHmacs.add(initiator.phoneHmac);
    }

    if (expectedPhoneHmacs.size < 1 || expectedPhoneHmacs.size > 3) {
      throw new BadRequestException('Vous devez avoir entre 1 et 3 numéros vérifiés');
    }

    if (expectedPhoneHmacs.has(recipientPhoneHmac)) {
      throw new BadRequestException(
        'Vous ne pouvez pas vous envoyer un test sur un de vos numéros',
      );
    }

    const now = new Date();

    const feeSchedule = await this.prisma.feeSchedule.findFirst({
      where: {
        countryCode: initiator.countryCode,
        currency: 'XAF',
        operationType: FeeOperationType.SERVICE,
        provider: null,
        active: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });

    if (!feeSchedule) {
      throw new ConflictException('Aucun tarif de service actif pour ce pays');
    }

    const percentageFee = (reward * BigInt(feeSchedule.rateBps) + 9999n) / 10000n;

    const serviceFee = feeSchedule.fixedAmount + percentageFee;

    if (serviceFee < 0n) {
      throw new ConflictException('Configuration des frais invalide');
    }

    const total = reward + serviceFee;

    // Code public aléatoire, distinct de l'UUID interne.
    const publicCode = `TB-${randomBytes(12).toString('hex').toUpperCase()}`;

    const test = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.test.create({
          data: {
            publicCode,
            initiatorId: userId,
            recipientPhoneHmac,
            recipientPhoneEnc,
            status: TestStatus.DRAFT,
            currency: 'XAF',
            rewardAmount: reward,
            serviceFeeAmount: serviceFee,
            totalAmount: total,
            feeScheduleId: feeSchedule.id,

            expectedPhones: {
              create: [...expectedPhoneHmacs].map((phoneHmac) => ({ phoneHmac })),
            },

            events: {
              create: {
                fromStatus: null,
                toStatus: TestStatus.DRAFT,
                actorType: TestActorType.USER,
                actorId: userId,
                source: 'tests.create',
                reason: 'Test créé par l’initiateur',
              },
            },
          },
          select: this.selectFields,
        });

        return created;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return this.serialize(test);
  }

  async listMine(userId: string) {
    const tests = await this.prisma.test.findMany({
      where: { initiatorId: userId },
      select: this.selectFields,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return tests.map((test) => this.serialize(test));
  }

  async listReceived(userId: string) {
    const tests = await this.prisma.test.findMany({
      where: { recipientUserId: userId },
      select: this.selectFields,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return tests.map((test) => this.serialize(test));
  }

  async detail(userId: string, id: string) {
    const test = await this.prisma.test.findFirst({
      where: {
        id,
        OR: [{ initiatorId: userId }, { recipientUserId: userId }],
      },
      select: this.selectFields,
    });

    if (!test) {
      throw new NotFoundException('Test introuvable');
    }

    return this.serialize(test);
  }
}
