import { Injectable, BadRequestException } from '@nestjs/common';

import { hmac, encrypt } from '../auth/auth.crypto';

@Injectable()
export class TestPhoneSecurity {
  normalize(phone: string): string {
    const normalized = phone.replace(/[\s().-]/g, '');

    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      throw new BadRequestException('Numéro de téléphone invalide. Format E.164 requis.');
    }

    return normalized;
  }

  hmac(phoneE164: string): string {
    return hmac(this.normalize(phoneE164));
  }

  encrypt(phoneE164: string): string {
    return encrypt(this.normalize(phoneE164));
  }
}
