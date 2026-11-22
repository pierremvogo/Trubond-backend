import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';
import { TestPhoneSecurity } from './test-phone-security.service';
import { TestExpirationService } from './test-expiration.service';
import { TestExpirationSchedulerService } from './test-expiration-scheduler.service';

@Module({
  imports: [AuthModule],

  controllers: [TestsController],

  providers: [
    TestsService,
    TestPhoneSecurity,
    TestExpirationService,
    TestExpirationSchedulerService,
  ],

  exports: [TestsService, TestPhoneSecurity, TestExpirationService],
})
export class TestsModule {}
