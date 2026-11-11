import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

@Injectable()
export class InvitationTokenService {
  generate(): { token: string; tokenHash: string } {
    // 32 octets aléatoires = 256 bits d'entropie.
    const token = randomBytes(32).toString('base64url');

    // Seule l'empreinte doit être conservée durablement
    // dans la table invitations.
    const tokenHash = this.hash(token);

    return {
      token,
      tokenHash,
    };
  }

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
