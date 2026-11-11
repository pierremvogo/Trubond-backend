import { Module } from '@nestjs/common';

import { OutboxProcessor } from './outbox.processor';

@Module({
  providers: [OutboxProcessor],
  exports: [OutboxProcessor],
})
export class OutboxModule {}
