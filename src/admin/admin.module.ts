import { Module } from '@nestjs/common';
import { AdminFinanceController } from './admin-finance.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminFinanceService } from './admin-finance.service';

@Module({
  controllers: [AdminFinanceController],
  providers: [AdminAuthService, AdminAuthGuard, AdminFinanceService],
})
export class AdminModule {}
