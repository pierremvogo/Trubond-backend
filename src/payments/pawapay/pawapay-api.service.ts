import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PawapayDepositStatusResponse {
  status: 'FOUND' | 'NOT_FOUND';
  data?: {
    depositId: string;
    status: string;
    amount: string;
    currency: string;
  };
}

@Injectable()
export class PawapayApiService {
  private readonly baseUrl = 'https://api.sandbox.pawapay.io';

  constructor(private readonly config: ConfigService) {}

  private getToken(): string {
    const environment = this.config.get<string>('PAWAPAY_ENV');
    const token = this.config.get<string>('PAWAPAY_API_TOKEN');

    if (environment !== 'sandbox') {
      throw new InternalServerErrorException('Seul pawaPay Sandbox est autorisé.');
    }

    if (!token) {
      throw new InternalServerErrorException('PAWAPAY_API_TOKEN est manquant.');
    }

    return token;
  }

  async get<T>(path: string): Promise<T> {
    if (!path.startsWith('/v2/')) {
      throw new InternalServerErrorException('Chemin API pawaPay invalide.');
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.getToken()}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(`Erreur API pawaPay : HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  }

  async post<TResponse>(path: string, payload: unknown): Promise<TResponse> {
    if (!path.startsWith('/v2/')) {
      throw new InternalServerErrorException('Chemin API pawaPay invalide.');
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.getToken()}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(`Erreur API pawaPay : HTTP ${response.status}`);
    }

    return (await response.json()) as TResponse;
  }

  async getDeposit(depositId: string): Promise<PawapayDepositStatusResponse> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(depositId)) {
      throw new InternalServerErrorException('Identifiant de dépôt pawaPay invalide.');
    }

    return this.get<PawapayDepositStatusResponse>(`/v2/deposits/${depositId}`);
  }
}
