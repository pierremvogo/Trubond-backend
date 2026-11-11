import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';
import { TestPhoneSecurity } from './test-phone-security.service';

@Module({
  imports: [AuthModule],
  controllers: [TestsController],
  providers: [TestsService, TestPhoneSecurity],
  exports: [TestsService, TestPhoneSecurity],
})
export class TestsModule {}
