import { Module } from '@nestjs/common';

import { InvitationsModule } from '../invitations/invitations.module';
import { OutboxProcessor } from './outbox.processor';

@Module({
  imports: [InvitationsModule],

  providers: [OutboxProcessor],

  exports: [OutboxProcessor],
})
export class OutboxModule {}
