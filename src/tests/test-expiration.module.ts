import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TestExpirationService } from './test-expiration.service';

@Module({
  imports: [PrismaModule],
  providers: [TestExpirationService],
  exports: [TestExpirationService],
})
export class TestExpirationModule {}
