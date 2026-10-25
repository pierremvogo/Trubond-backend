import { Controller, Post, ServiceUnavailableException } from '@nestjs/common';
import { DevOtpChannelService } from './dev-otp-channel.service';

@Controller('auth/dev-otp')
export class DevOtpController {
  constructor(private readonly channels: DevOtpChannelService) {}

  @Post('channel')
  createChannel(): {
    channelToken: string;
    expiresInSeconds: number;
  } {
    if (process.env.NODE_ENV === 'production' || process.env.OTP_DELIVERY_PROVIDER !== 'socket') {
      throw new ServiceUnavailableException('Canal OTP de test indisponible');
    }
    return {
      channelToken: this.channels.create(),
      expiresInSeconds: 900,
    };
  }
}
