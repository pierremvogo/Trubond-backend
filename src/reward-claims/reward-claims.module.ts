import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';

import { TestPhoneSecurity } from '../tests/test-phone-security.service';
import { InvitationTokenService } from '../invitations/invitation-token.service';

import { RewardClaimsController } from './reward-claims.controller';
import { RewardClaimsService } from './reward-claims.service';

@Module({
  imports: [PrismaModule, AuthModule, PaymentsModule],

  controllers: [RewardClaimsController],

  providers: [RewardClaimsService, InvitationTokenService, TestPhoneSecurity],

  exports: [RewardClaimsService],
})
export class RewardClaimsModule {}
