import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { OtpGateway } from './otp.gateway';

@Injectable()
export class SocketOtpProvider {
  constructor(private readonly gateway: OtpGateway) {}

  async sendOtp(
    channelToken: string,
    challengeId: string,
    code: string,
  ): Promise<{ providerRef: string }> {
    if (process.env.NODE_ENV === 'production' || process.env.OTP_DELIVERY_PROVIDER !== 'socket') {
      throw new ServiceUnavailableException('Livraison OTP Socket.IO désactivée');
    }

    await this.gateway.sendOtp(channelToken, code, challengeId);

    return {
      providerRef: `socket:${challengeId}`,
    };
  }
}
