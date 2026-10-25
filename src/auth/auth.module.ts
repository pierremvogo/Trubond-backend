import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessTokenGuard } from './auth.guard';
import { SessionService } from './session.service';

// Socket.IO - OTP de développement
import { DevOtpChannelService } from './otp/dev-otp-channel.service';
import { DevOtpController } from './otp/dev-otp.controller';
import { OtpGateway } from './otp/otp.gateway';
import { SocketOtpProvider } from './otp/socket-otp.provider';

@Module({
  imports: [],

  controllers: [AuthController, DevOtpController],

  providers: [
    // Authentification
    AuthService,
    SessionService,
    AccessTokenGuard,

    // OTP via Socket.IO
    DevOtpChannelService,
    OtpGateway,
    SocketOtpProvider,
  ],

  exports: [AuthService, SessionService, AccessTokenGuard],
})
export class AuthModule {}
