import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ApprovalStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async listPending() {
    return this.prisma.adminApproval.findMany({
      where: {
        status: ApprovalStatus.PENDING,
      },
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        amount: true,
        currency: true,
        reason: true,
        status: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: 100,
    });
  }

  async decide(approvalId: string, adminId: string, decision: 'APPROVE' | 'REJECT', note: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(approvalId)) {
      throw new BadRequestException('Identifiant de validation invalide');
    }

    if (typeof note !== 'string' || note.trim().length < 5 || note.length > 1000) {
      throw new BadRequestException('Justification requise (5 à 1000 caractères)');
    }

    const status = decision === 'APPROVE' ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;

    return this.prisma.$transaction(
      async (tx) => {
        const approval = await tx.adminApproval.findUnique({
          where: {
            id: approvalId,
          },
        });

        if (!approval) {
          throw new NotFoundException('Demande introuvable');
        }

        if (approval.status !== ApprovalStatus.PENDING) {
          throw new ConflictException('Cette demande a déjà été traitée');
        }

        const updated = await tx.adminApproval.updateMany({
          where: {
            id: approvalId,
            status: ApprovalStatus.PENDING,
          },
          data: {
            status,
            approverId: adminId,
            decisionNote: note.trim(),
            decidedAt: new Date(),
          },
        });

        if (updated.count !== 1) {
          throw new ConflictException('Validation concurrente détectée');
        }

        return tx.adminApproval.findUniqueOrThrow({
          where: {
            id: approvalId,
          },
          select: {
            id: true,
            action: true,
            targetType: true,
            targetId: true,
            status: true,
            approverId: true,
            decisionNote: true,
            decidedAt: true,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }
}
