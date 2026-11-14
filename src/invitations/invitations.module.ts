import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { TestsModule } from '../tests/tests.module';

import { InvitationsController } from './invitations.controller';
import { PublicInvitationsController } from './public-invitations.controller';
import { InvitationsService } from './invitations.service';
import { InvitationTokenService } from './invitation-token.service';
import { InvitationCryptoService } from './invitation-crypto.service';

@Module({
  imports: [AuthModule, TestsModule],
  controllers: [InvitationsController, PublicInvitationsController],
  providers: [InvitationsService, InvitationTokenService, InvitationCryptoService],
  exports: [InvitationsService, InvitationTokenService, InvitationCryptoService],
})
export class InvitationsModule {}
