
import { Module } from '@nestjs/common';

import { PrismaModule } from '../src/prisma/prisma.module';
import { OutboxModule } from '../src/outbox/outbox.module';

@Module({
  imports: [
    PrismaModule,
    OutboxModule,
  ],
})
export class InvitationTestModule {}
