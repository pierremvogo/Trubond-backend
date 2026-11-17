import { Body, Controller, Get, Param, Post, UseGuards, BadRequestException } from '@nestjs/common';

import { AdminAuthGuard, CurrentAdmin } from './admin-auth.guard';
import { AdminContext } from './admin-auth.service';
import { AdminFinanceService } from './admin-finance.service';

@Controller('admin/finance')
@UseGuards(AdminAuthGuard)
export class AdminFinanceController {
  constructor(private readonly finance: AdminFinanceService) {}

  @Get('pending')
  listPending() {
    return this.finance.listPending();
  }

  @Post(':id/decision')
  decide(@Param('id') id: string, @CurrentAdmin() admin: AdminContext, @Body() body: unknown) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('Corps de requête invalide');
    }

    const input = body as Record<string, unknown>;

    if (input.decision !== 'APPROVE' && input.decision !== 'REJECT') {
      throw new BadRequestException('Décision invalide');
    }

    if (typeof input.note !== 'string') {
      throw new BadRequestException('Justification obligatoire');
    }

    return this.finance.decide(id, admin.adminId, input.decision, input.note);
  }
}
