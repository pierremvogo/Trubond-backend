import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class InvitationCryptoService {
  private getKey(): Buffer {
    const value = process.env.INVITATION_ENC_KEY;

    if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
      throw new Error('INVITATION_ENC_KEY doit contenir 64 caractères hexadécimaux');
    }

    return Buffer.from(value, 'hex');
  }

  encrypt(token: string): string {
    const iv = randomBytes(12);

    const cipher = createCipheriv('aes-256-gcm', this.getKey(), iv);

    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);

    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  decrypt(value: string): string {
    const buffer = Buffer.from(value, 'base64');

    if (buffer.length < 29) {
      throw new Error('Token invitation chiffré invalide');
    }

    const iv = buffer.subarray(0, 12);
    const authTag = buffer.subarray(12, 28);
    const encrypted = buffer.subarray(28);

    const decipher = createDecipheriv('aes-256-gcm', this.getKey(), iv);

    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}
