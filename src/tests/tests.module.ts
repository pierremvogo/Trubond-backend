import { Module } from '@nestjs/common';

import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';
import { TestPhoneSecurity } from './test-phone-security.service';
import { SessionService } from 'src/auth/session.service';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [TestsController],
  providers: [TestsService, TestPhoneSecurity],
  exports: [TestsService],
})
export class TestsModule {}
