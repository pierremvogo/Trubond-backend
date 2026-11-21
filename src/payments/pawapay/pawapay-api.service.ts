import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PawapayDepositStatusResponse {
  status: 'FOUND' | 'NOT_FOUND';
  data?: { depositId: string; status: string; amount: string; currency: string };
}
export interface PawapayRefundRequest {
  refundId: string;
  depositId: string;
  amount: string;
  currency: string;
  clientReferenceId?: string;
}
export interface PawapayRefundInitiationResponse {
  refundId: string;
  status: 'ACCEPTED' | 'REJECTED' | 'DUPLICATE_IGNORED';
  rejectionReason?: { rejectionCode: string; rejectionMessage: string };
}
export interface PawapayRefundStatusResponse {
  status: 'FOUND' | 'NOT_FOUND';
  data?: {
    refundId: string;
    status: string;
    amount: string;
    currency: string;
    depositId?: string;
    failureReason?: { failureCode: string; failureMessage: string };
  };
}

// Un jeton ne peut être créé que par le service API lui-même.
// Il est consommé synchroniquement par initiateRefund avant tout await.
const manualPermits = new WeakSet<object>();
const automatedPermits = new WeakSet<object>();
export type PawapayManualPermit = Readonly<{ readonly kind: 'PAWAPAY_MANUAL_ONCE' }>;

@Injectable()
export class PawapayApiService {
  private readonly baseUrl = 'https://api.sandbox.pawapay.io';
  constructor(private readonly config: ConfigService) {}

  private getToken(): string {
    const environment = this.config.get<string>('PAWAPAY_ENV');
    const token = this.config.get<string>('PAWAPAY_API_TOKEN');
    if (environment?.trim().toUpperCase() !== 'SANDBOX') {
      throw new InternalServerErrorException('Seul pawaPay Sandbox est autorisé.');
    }
    if (!token) throw new InternalServerErrorException('PAWAPAY_API_TOKEN est manquant.');
    return token;
  }

  private validateUuid(value: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new InternalServerErrorException('Identifiant pawaPay invalide.');
    }
  }

  async get<T>(path: string): Promise<T> {
    if (!path.startsWith('/v2/'))
      throw new InternalServerErrorException('Chemin API pawaPay invalide.');
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.getToken()}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new InternalServerErrorException(`Erreur API pawaPay : HTTP ${response.status}`);
    return (await response.json()) as T;
  }

  async post<TResponse>(path: string, payload: unknown): Promise<TResponse> {
    if (!path.startsWith('/v2/'))
      throw new InternalServerErrorException('Chemin API pawaPay invalide.');
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
    if (!response.ok)
      throw new InternalServerErrorException(`Erreur API pawaPay : HTTP ${response.status}`);
    return (await response.json()) as TResponse;
  }

  async getDeposit(depositId: string): Promise<PawapayDepositStatusResponse> {
    this.validateUuid(depositId);
    return this.get<PawapayDepositStatusResponse>(`/v2/deposits/${depositId}`);
  }

  // Ne crée un permis qu'après vérification d'un enregistrement durable
  // dans PawapayManualRefundAttempt par le service métier.
  createManualPermitForRecordedAttempt(recorded: boolean): PawapayManualPermit {
    if (
      !recorded ||
      this.config.get<string>('PAWAPAY_ENV')?.trim().toUpperCase() !== 'SANDBOX' ||
      this.config.get<string>('OUTBOX_WORKER_MODE') !== 'INSPECT_LOOP' ||
      this.config.get<string>('ENABLE_PAWAPAY_REFUND_SENDING') !== 'NO'
    ) {
      throw new InternalServerErrorException('Autorisation manuelle pawaPay refusée.');
    }
    const permit = Object.freeze({ kind: 'PAWAPAY_MANUAL_ONCE' as const });
    manualPermits.add(permit);
    return permit;
  }

  // Permis à usage unique pour un remboursement déjà réservé atomiquement en base.
  createAutomatedPermitForClaimedRefund(claimed: boolean): object {
    if (
      !claimed ||
      this.config.get<string>('PAWAPAY_ENV')?.trim().toUpperCase() !== 'SANDBOX' ||
      this.config.get<string>('OUTBOX_WORKER_MODE') !== 'INSPECT_LOOP' ||
      this.config.get<string>('ENABLE_PAWAPAY_REFUND_SENDING') !== 'NO' ||
      this.config.get<string>('PAWAPAY_REFUND_AUTOMATION') !== 'YES'
    ) {
      throw new InternalServerErrorException('Automatisation pawaPay non autorisée.');
    }
    const permit = Object.freeze({ kind: 'PAWAPAY_AUTOMATED_CLAIM' });
    automatedPermits.add(permit);
    return permit;
  }

  async initiateRefund(
    request: PawapayRefundRequest,
    manualPermit?: PawapayManualPermit | object,
  ): Promise<PawapayRefundInitiationResponse> {
    this.validateUuid(request.refundId);
    this.validateUuid(request.depositId);
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(request.amount) ||
      BigInt(request.amount.split('.')[0]!) <= 0n
    ) {
      throw new InternalServerErrorException('Montant du remboursement invalide.');
    }
    if (!/^[A-Z]{3}$/.test(request.currency)) {
      throw new InternalServerErrorException('Devise du remboursement invalide.');
    }

    const automatic = this.config.get<string>('ENABLE_PAWAPAY_REFUND_SENDING') === 'YES';
    const manual = !!manualPermit && manualPermits.has(manualPermit);
    const automated = !!manualPermit && automatedPermits.has(manualPermit);
    if (manualPermit) {
      manualPermits.delete(manualPermit);
      automatedPermits.delete(manualPermit);
    }
    if (!automatic && !manual && !automated) {
      throw new InternalServerErrorException('Envoi des remboursements pawaPay désactivé.');
    }
    return this.post<PawapayRefundInitiationResponse>('/v2/refunds', request);
  }

  async getRefund(refundId: string): Promise<PawapayRefundStatusResponse> {
    this.validateUuid(refundId);
    return this.get<PawapayRefundStatusResponse>(`/v2/refunds/${refundId}`);
  }
}
