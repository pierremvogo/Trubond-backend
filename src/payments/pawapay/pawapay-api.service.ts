import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

// ======================================================
// DEPOSITS
// ======================================================

export interface PawapayDepositStatusResponse {
  status: 'FOUND' | 'NOT_FOUND';

  data?: {
    depositId: string;
    status: string;
    amount: string;
    currency: string;
  };
}

// ======================================================
// REFUNDS
// ======================================================

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

  rejectionReason?: {
    rejectionCode: string;
    rejectionMessage: string;
  };
}

export interface PawapayRefundStatusResponse {
  status: 'FOUND' | 'NOT_FOUND';

  data?: {
    refundId: string;
    status: string;
    amount: string;
    currency: string;
    depositId?: string;

    failureReason?: {
      failureCode: string;
      failureMessage: string;
    };
  };
}

// ======================================================
// PAYOUTS
// ======================================================

export type PawapayPayoutProvider = 'MTN_MOMO_CMR' | 'ORANGE_CMR';

export interface PawapayPayoutRequest {
  payoutId: string;
  amount: string;
  currency: 'XAF';

  recipient: {
    type: 'MMO';

    accountDetails: {
      phoneNumber: string;
      provider: PawapayPayoutProvider;
    };
  };

  clientReferenceId?: string;
  customerMessage?: string;
}

export interface PawapayPayoutInitiationResponse {
  payoutId: string;

  status: 'ACCEPTED' | 'REJECTED' | 'DUPLICATE_IGNORED';

  rejectionReason?: {
    rejectionCode: string;
    rejectionMessage: string;
  };

  failureReason?: {
    failureCode: string;
    failureMessage: string;
  };
}

export interface PawapayPayoutStatusResponse {
  status: 'FOUND' | 'NOT_FOUND';

  data?: {
    payoutId: string;
    status: string;
    amount: string;
    currency: string;

    recipient?: {
      type: 'MMO';

      accountDetails: {
        phoneNumber: string;
        provider: string;
      };
    };

    providerTransactionId?: string;

    failureReason?: {
      failureCode: string;
      failureMessage: string;
    };
  };
}

// ======================================================
// ACTIVE CONFIGURATION
// ======================================================

interface PawapayOperationConfiguration {
  minAmount: string;
  maxAmount: string;
  decimalsInAmount: string;
  status: string;
}

interface PawapayActiveConfiguration {
  countries: Array<{
    country: string;
    prefix?: string;

    providers: Array<{
      provider: string;

      currencies: Array<{
        currency: string;

        operationTypes: {
          DEPOSIT?: PawapayOperationConfiguration;
          REFUND?: PawapayOperationConfiguration;
          PAYOUT?: PawapayOperationConfiguration;
        };
      }>;
    }>;
  }>;
}

// ======================================================
// PERMIS FINANCIERS
// ======================================================

const manualPermits = new WeakSet<object>();

const automatedPermits = new WeakSet<object>();

const payoutPermits = new WeakMap<object, string>();

export type PawapayManualPermit = Readonly<{
  readonly kind: 'PAWAPAY_MANUAL_ONCE';
}>;

export type PawapayPayoutPermit = Readonly<{
  readonly kind: 'PAWAPAY_PAYOUT_ONCE';
}>;

// ======================================================
// SERVICE API PAWAPAY
// ======================================================

@Injectable()
export class PawapayApiService {
  private readonly baseUrl = 'https://api.sandbox.pawapay.io';

  constructor(private readonly config: ConfigService) {}

  // ====================================================
  // CONFIGURATION ET VALIDATION
  // ====================================================

  private getToken(): string {
    const environment = this.config.get<string>('PAWAPAY_ENV');

    const token = this.config.get<string>('PAWAPAY_API_TOKEN');

    if (environment?.trim().toUpperCase() !== 'SANDBOX') {
      throw new InternalServerErrorException('Seul pawaPay Sandbox est autorisé.');
    }

    if (!token) {
      throw new InternalServerErrorException('PAWAPAY_API_TOKEN est manquant.');
    }

    return token;
  }

  private validateUuid(value: string): void {
    if (
      typeof value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ) {
      throw new InternalServerErrorException('Identifiant pawaPay invalide.');
    }
  }

  private validatePayoutProvider(provider: string): asserts provider is PawapayPayoutProvider {
    if (provider !== 'MTN_MOMO_CMR' && provider !== 'ORANGE_CMR') {
      throw new InternalServerErrorException('Opérateur de décaissement non pris en charge.');
    }
  }

  private validatePayoutAmount(amount: string): void {
    if (typeof amount !== 'string' || !/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
      throw new InternalServerErrorException('Montant du décaissement invalide.');
    }
  }

  // ====================================================
  // REQUETES HTTP
  // ====================================================

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

    const url = new URL(path, this.baseUrl);

    // Les remboursements et décaissements doivent
    // passer par leurs méthodes métier dédiées.

    if (
      url.origin !== new URL(this.baseUrl).origin ||
      url.pathname.includes('%') ||
      url.pathname === '/v2/refunds' ||
      url.pathname.startsWith('/v2/refunds/') ||
      url.pathname === '/v2/payouts' ||
      url.pathname.startsWith('/v2/payouts/')
    ) {
      throw new InternalServerErrorException('POST financier direct interdit');
    }

    return this.performPost<TResponse>(path, payload);
  }

  private async performPost<TResponse>(path: string, payload: unknown): Promise<TResponse> {
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

  // ====================================================
  // DEPOSITS
  // ====================================================

  async getDeposit(depositId: string): Promise<PawapayDepositStatusResponse> {
    this.validateUuid(depositId);

    return this.get<PawapayDepositStatusResponse>(`/v2/deposits/${depositId}`);
  }

  // ====================================================
  // REFUNDS : PERMIS MANUEL
  // ====================================================

  createManualPermitForRecordedAttempt(recorded: boolean): PawapayManualPermit {
    if (
      !recorded ||
      this.config.get<string>('PAWAPAY_ENV')?.trim().toUpperCase() !== 'SANDBOX' ||
      this.config.get<string>('OUTBOX_WORKER_MODE') !== 'INSPECT_LOOP' ||
      this.config.get<string>('ENABLE_PAWAPAY_REFUND_SENDING') !== 'NO'
    ) {
      throw new InternalServerErrorException('Autorisation manuelle pawaPay refusée.');
    }

    const permit = Object.freeze({
      kind: 'PAWAPAY_MANUAL_ONCE' as const,
    });

    manualPermits.add(permit);

    return permit;
  }

  // ====================================================
  // REFUNDS : PERMIS AUTOMATIQUE
  // ====================================================

  createAutomatedPermitForClaimedRefund(claimed: boolean): object {
    if (
      !claimed ||
      this.config.get<string>('PAWAPAY_ENV')?.trim().toUpperCase() !== 'SANDBOX' ||
      this.config.get<string>('OUTBOX_WORKER_MODE') !== 'INSPECT_LOOP' ||
      this.config.get<string>('ENABLE_PAWAPAY_REFUND_SENDING') !== 'NO' ||
      this.config.get<string>('PAWAPAY_REFUND_AUTOMATION') !== 'YES'
    ) {
      throw new InternalServerErrorException('Permis automatique refusé');
    }

    const permit = Object.freeze({
      kind: 'PAWAPAY_AUTOMATED_CLAIM',
    });

    automatedPermits.add(permit);

    return permit;
  }

  // ====================================================
  // REFUNDS : INITIATION
  // ====================================================

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

    const manual = !!manualPermit && manualPermits.has(manualPermit);

    const automated = !!manualPermit && automatedPermits.has(manualPermit);

    // Consommation synchrone du permis.
    // Aucun await avant cette opération.

    if (manualPermit) {
      manualPermits.delete(manualPermit);
      automatedPermits.delete(manualPermit);
    }

    if (!manual && !automated) {
      throw new InternalServerErrorException('Envoi pawaPay interdit : permis requis');
    }

    if (
      automated &&
      (this.config.get<string>('PAWAPAY_REFUND_AUTOMATION') !== 'YES' ||
        this.config.get<string>('ENABLE_PAWAPAY_REFUND_SENDING') !== 'NO')
    ) {
      throw new InternalServerErrorException('Automatisation désactivée');
    }

    return this.performPost<PawapayRefundInitiationResponse>('/v2/refunds', request);
  }

  // ====================================================
  // REFUNDS : CONSULTATION
  // ====================================================

  async getRefund(refundId: string): Promise<PawapayRefundStatusResponse> {
    this.validateUuid(refundId);

    return this.get<PawapayRefundStatusResponse>(`/v2/refunds/${refundId}`);
  }

  // ====================================================
  // PAYOUTS : SECURITE DE L'ENVOI
  // ====================================================

  private assertPayoutSendingEnabled(): void {
    if (
      this.config.get<string>('PAWAPAY_ENV')?.trim().toUpperCase() !== 'SANDBOX' ||
      this.config.get<string>('NODE_ENV') === 'production' ||
      this.config.get<string>('OTP_DELIVERY_PROVIDER') !== 'socket' ||
      this.config.get<string>('OUTBOX_WORKER_MODE') !== 'INSPECT_LOOP' ||
      this.config.get<string>('ENABLE_PAWAPAY_PAYOUT_PREPARATION') !== 'YES' ||
      this.config.get<string>('ENABLE_PAWAPAY_PAYOUT_SENDING') !== 'YES' ||
      this.config.get<string>('PAWAPAY_PAYOUT_AUTOMATION') !== 'YES'
    ) {
      throw new InternalServerErrorException('Envoi automatique des décaissements interdit.');
    }

    // Vérification supplémentaire de la date
    // d'activation de l'automatisation.

    const raw = this.config.get<string>('PAWAPAY_PAYOUT_AUTOMATION_START_AT');

    if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw)) {
      throw new InternalServerErrorException('Date UTC d’activation obligatoire.');
    }

    const cutoff = new Date(raw);

    const normalized = raw.replace(
      /(?:\.(\d{1,3}))?Z$/,
      (_, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`,
    );

    if (
      Number.isNaN(cutoff.getTime()) ||
      cutoff.toISOString() !== normalized ||
      cutoff.getTime() > Date.now()
    ) {
      throw new InternalServerErrorException('Automatisation des décaissements non active.');
    }
  }

  // ====================================================
  // PAYOUTS : ACTIVE CONFIGURATION
  // ====================================================

  async assertPayoutAvailability(provider: PawapayPayoutProvider, amount: string): Promise<void> {
    this.assertPayoutSendingEnabled();

    this.validatePayoutProvider(provider);

    this.validatePayoutAmount(amount);

    const configuration = await this.get<PawapayActiveConfiguration>('/v2/active-conf');

    const operation = configuration.countries
      ?.find((country) => country.country === 'CMR')
      ?.providers?.find((item) => item.provider === provider)
      ?.currencies?.find((item) => item.currency === 'XAF')?.operationTypes?.PAYOUT;

    if (
      !operation ||
      operation.status !== 'OPERATIONAL' ||
      operation.decimalsInAmount !== 'NONE' ||
      typeof operation.minAmount !== 'string' ||
      typeof operation.maxAmount !== 'string' ||
      !/^\d+$/.test(operation.minAmount) ||
      !/^\d+$/.test(operation.maxAmount)
    ) {
      throw new InternalServerErrorException('Décaissement indisponible chez cet opérateur.');
    }

    const value = BigInt(amount);

    const minimum = BigInt(operation.minAmount);

    const maximum = BigInt(operation.maxAmount);

    if (minimum <= 0n || maximum < minimum || value < minimum || value > maximum) {
      throw new InternalServerErrorException('Montant hors des limites autorisées par pawaPay.');
    }
  }

  // ====================================================
  // PAYOUTS : VALIDATION DE LA REQUETE
  // ====================================================

  private validatePayoutRequest(request: PawapayPayoutRequest): void {
    this.validateUuid(request.payoutId);

    this.validatePayoutAmount(request.amount);

    if (request.currency !== 'XAF') {
      throw new InternalServerErrorException('Seuls les décaissements XAF sont autorisés.');
    }

    if (
      !request.recipient ||
      request.recipient.type !== 'MMO' ||
      !request.recipient.accountDetails
    ) {
      throw new InternalServerErrorException('Destination Mobile Money invalide.');
    }

    const account = request.recipient.accountDetails;

    this.validatePayoutProvider(account.provider);

    // Format international sans le signe "+".

    if (typeof account.phoneNumber !== 'string' || !/^2376\d{8}$/.test(account.phoneNumber)) {
      throw new InternalServerErrorException('Numéro Mobile Money camerounais invalide.');
    }
  }

  // ====================================================
  // PAYOUTS : PERMIS UNIQUE
  // ====================================================

  createPermitForReservedPayout(request: PawapayPayoutRequest): PawapayPayoutPermit {
    this.assertPayoutSendingEnabled();

    this.validatePayoutRequest(request);

    // Cette méthode doit être appelée exclusivement
    // après validation de la réservation SQL durable
    // par PawapayPayoutsService.

    const permit = Object.freeze({
      kind: 'PAWAPAY_PAYOUT_ONCE' as const,
    });

    // Le permis est associé à la requête exacte :
    // identifiant, montant, devise et destination.

    payoutPermits.set(permit, JSON.stringify(request));

    return permit;
  }

  // ====================================================
  // PAYOUTS : INITIATION
  // ====================================================

  async initiatePayout(
    request: PawapayPayoutRequest,
    permit: PawapayPayoutPermit,
  ): Promise<PawapayPayoutInitiationResponse> {
    const authorizedRequest = payoutPermits.get(permit);

    // Consommation immédiate du permis.
    // Aucun await avant cette opération.

    payoutPermits.delete(permit);

    if (!authorizedRequest || authorizedRequest !== JSON.stringify(request)) {
      throw new InternalServerErrorException(
        'Permis de décaissement absent, consommé ou incompatible.',
      );
    }

    // Nouvelle vérification des protections
    // juste avant l'appel financier.

    this.assertPayoutSendingEnabled();

    this.validatePayoutRequest(request);

    // Aucun mécanisme de retry automatique.
    //
    // Une erreur réseau ne signifie pas que pawaPay
    // n'a pas reçu la requête.
    //
    // Le versement doit rester PENDING jusqu'à
    // réconciliation ou intervention humaine.

    return this.performPost<PawapayPayoutInitiationResponse>('/v2/payouts', request);
  }

  // ====================================================
  // PAYOUTS : CONSULTATION
  // ====================================================

  async getPayout(payoutId: string): Promise<PawapayPayoutStatusResponse> {
    this.validateUuid(payoutId);

    return this.get<PawapayPayoutStatusResponse>(`/v2/payouts/${payoutId}`);
  }
}
