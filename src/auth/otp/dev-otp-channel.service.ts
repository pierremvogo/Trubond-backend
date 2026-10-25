import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

type Channel = {
  expiresAt: number;
};

@Injectable()
export class DevOtpChannelService {
  private readonly channels = new Map<string, Channel>();

  private assertEnabled(): void {
    if (process.env.NODE_ENV === 'production' || process.env.OTP_DELIVERY_PROVIDER !== 'socket') {
      throw new ServiceUnavailableException('Canaux OTP de test désactivés');
    }
  }

  create(): string {
    this.assertEnabled();

    const token = randomBytes(32).toString('base64url');

    this.channels.set(token, {
      expiresAt: Date.now() + 15 * 60 * 1000,
    });

    return token;
  }

  isValid(token: string): boolean {
    if (process.env.NODE_ENV === 'production' || process.env.OTP_DELIVERY_PROVIDER !== 'socket') {
      return false;
    }

    const channel = this.channels.get(token);

    if (!channel) return false;

    if (channel.expiresAt <= Date.now()) {
      this.channels.delete(token);
      return false;
    }

    return true;
  }

  invalidate(token: string): void {
    this.channels.delete(token);
  }
}
