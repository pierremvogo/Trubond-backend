import { Module } from '@nestjs/common';

import { TestsModule } from '../tests/tests.module';

import { InvitationsService } from './invitations.service';
import { InvitationTokenService } from './invitation-token.service';
import { InvitationCryptoService } from './invitation-crypto.service';

@Module({
  imports: [TestsModule],

  providers: [InvitationsService, InvitationTokenService, InvitationCryptoService],

  exports: [InvitationsService, InvitationTokenService, InvitationCryptoService],
})
export class InvitationsModule {}
