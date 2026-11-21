import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { InvitationTokenService } from '../invitations/invitation-token.service';
import { RewardClaimsService } from './reward-claims.service';

@Module({
  imports: [PrismaModule],
  providers: [RewardClaimsService, InvitationTokenService],
  exports: [RewardClaimsService],
})
export class RewardClaimsModule {}
