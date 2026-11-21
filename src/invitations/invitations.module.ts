import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { TestsModule } from '../tests/tests.module';
import { TestPhoneSecurity } from '../tests/test-phone-security.service';

import { InvitationsController } from './invitations.controller';
import { PublicInvitationsController } from './public-invitations.controller';
import { InvitationsService } from './invitations.service';
import { InvitationTokenService } from './invitation-token.service';
import { InvitationCryptoService } from './invitation-crypto.service';
import { RewardClaimsModule } from 'src/reward-claims/reward-claims.module';

@Module({
  imports: [AuthModule, TestsModule, RewardClaimsModule],

  controllers: [InvitationsController, PublicInvitationsController],

  providers: [
    InvitationsService,
    InvitationTokenService,
    InvitationCryptoService,
    TestPhoneSecurity,
  ],

  exports: [InvitationsService, InvitationTokenService, InvitationCryptoService],
})
export class InvitationsModule {}
