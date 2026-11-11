import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { OutboxModule } from './outbox.module';

@Module({
  imports: [PrismaModule, OutboxModule],
})
export class OutboxWorkerModule {}
