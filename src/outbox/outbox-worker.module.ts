import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { TestExpirationModule } from '../tests/test-expiration.module';
import { OutboxModule } from './outbox.module';

@Module({
  imports: [PrismaModule, OutboxModule, TestExpirationModule, PaymentsModule],
})
export class OutboxWorkerModule {}
