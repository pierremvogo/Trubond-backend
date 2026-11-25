import { Injectable, Logger } from '@nestjs/common';

import { Cron } from '@nestjs/schedule';

import { PaymentProvider, PayoutStatus, RewardClaimStatus, TestStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { PawapayPayoutsService } from './pawapay-payouts.service';

import { PawapayPayoutFinalizationService } from './pawapay-payout-finalization.service';

import { PawapayApiService } from './pawapay-api.service';

// ======================================================
// CONFIGURATION DU SCHEDULER
// ======================================================

const DEFAULT_STALE_MINUTES = 30;

const MAX_PENDING_PER_CYCLE = 50;

const MAX_CREATED_PER_CYCLE = 10;

const MAX_ALERTS_PER_CYCLE = 25;

// ======================================================
// SERVICE DE PLANIFICATION DES VERSEMENTS
// ======================================================

@Injectable()
export class PawapayPayoutsSchedulerService {
  private readonly logger = new Logger(PawapayPayoutsSchedulerService.name);

  private running = false;

  // Curseurs permettant de parcourir les opérations
  // sans bloquer les suivantes lorsqu'une ancienne
  // opération nécessite une intervention humaine.

  private pendingCursor: string | null = null;

  private createdCursor: string | null = null;

  constructor(
    private readonly prisma: PrismaService,

    private readonly payouts: PawapayPayoutsService,

    private readonly finalization: PawapayPayoutFinalizationService,

    private readonly api: PawapayApiService,
  ) {}

  // ====================================================
  // SECURITE SANDBOX
  // ====================================================

  private isSandbox(): boolean {
    return (
      process.env.PAWAPAY_ENV?.trim().toUpperCase() === 'SANDBOX' &&
      process.env.NODE_ENV !== 'production' &&
      process.env.OTP_DELIVERY_PROVIDER === 'socket'
    );
  }

  // ====================================================
  // ACTIVATION DE L'AUTOMATISATION
  // ====================================================

  private isAutomationEnabled(): boolean {
    return this.isSandbox() && process.env.PAWAPAY_PAYOUT_AUTOMATION === 'YES';
  }

  // ====================================================
  // ACTIVATION DES NOUVEAUX ENVOIS
  // ====================================================

  private isSendingEnabled(): boolean {
    return (
      this.isAutomationEnabled() &&
      process.env.OUTBOX_WORKER_MODE === 'INSPECT_LOOP' &&
      process.env.ENABLE_PAWAPAY_PAYOUT_PREPARATION === 'YES' &&
      process.env.ENABLE_PAWAPAY_PAYOUT_SENDING === 'YES'
    );
  }

  // ====================================================
  // DATE DE DEMARRAGE DE L'AUTOMATISATION
  // ====================================================

  private getCutoff(): Date | null {
    const raw = process.env.PAWAPAY_PAYOUT_AUTOMATION_START_AT;

    if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw)) {
      this.logger.error('PAAPAY_PAYOUT_AUTOMATION_START_AT : ' + 'date UTC explicite obligatoire');

      return null;
    }

    const cutoff = new Date(raw);

    if (Number.isNaN(cutoff.getTime())) {
      this.logger.error('Date de démarrage des versements invalide');

      return null;
    }

    const normalized = raw.replace(
      /(?:\.(\d{1,3}))?Z$/,
      (_, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`,
    );

    if (cutoff.toISOString() !== normalized) {
      this.logger.error('Date UTC de démarrage incohérente');

      return null;
    }

    return cutoff;
  }

  // ====================================================
  // DELAI D'ALERTE DES VERSEMENTS ANCIENS
  // ====================================================

  private getStaleMinutes(): number {
    const raw = process.env.PAWAPAY_PAYOUT_STALE_MINUTES;

    if (!raw) {
      return DEFAULT_STALE_MINUTES;
    }

    const value = Number(raw);

    if (!Number.isSafeInteger(value) || value < 5 || value > 10080) {
      return DEFAULT_STALE_MINUTES;
    }

    return value;
  }

  // ====================================================
  // SURVEILLANCE DES VERSEMENTS ANCIENS
  // ====================================================

  private async monitorStalePayouts(): Promise<void> {
    const staleBefore = new Date(Date.now() - this.getStaleMinutes() * 60_000);

    const stalePending = await this.prisma.payout.findMany({
      where: {
        provider: PaymentProvider.PAWAPAY,

        status: PayoutStatus.PENDING,

        updatedAt: {
          lte: staleBefore,
        },
      },

      select: {
        id: true,
        failureCode: true,
      },

      orderBy: {
        updatedAt: 'asc',
      },

      take: MAX_ALERTS_PER_CYCLE,
    });

    if (stalePending.length > 0) {
      this.logger.warn(
        `PAYOUT_STALE_ALERT : ` +
          `${stalePending.length} versement(s) ` +
          `PENDING ancien(s). ` +
          `IDs : ${stalePending.map((row) => row.id).join(', ')}. ` +
          `Aucun renvoi automatique autorisé.`,
      );
    }

    // Surveillance des opérations déjà signalées
    // comme nécessitant une intervention humaine.

    const reviewRequired = await this.prisma.payout.findMany({
      where: {
        provider: PaymentProvider.PAWAPAY,

        status: PayoutStatus.PENDING,

        failureCode: {
          not: null,
        },
      },

      select: {
        id: true,
      },

      orderBy: {
        updatedAt: 'asc',
      },

      take: MAX_ALERTS_PER_CYCLE,
    });

    if (reviewRequired.length > 0) {
      this.logger.warn(
        `PAYOUT_REVIEW_ALERT : ` +
          `${reviewRequired.length} versement(s) ` +
          `nécessitant une vérification humaine. ` +
          `IDs : ${reviewRequired.map((row) => row.id).join(', ')}.`,
      );
    }
  }

  // ====================================================
  // SIGNALER UNE ANOMALIE DE RECONCILIATION
  // ====================================================

  private async flagForReview(payoutId: string, failureCode: string): Promise<void> {
    try {
      // Ne pas modifier updatedAt inutilement
      // lorsque la même anomalie est déjà enregistrée.

      await this.prisma.payout.updateMany({
        where: {
          id: payoutId,

          provider: PaymentProvider.PAWAPAY,

          status: PayoutStatus.PENDING,

          providerReference: payoutId,

          OR: [
            {
              failureCode: null,
            },
            {
              failureCode: {
                not: failureCode,
              },
            },
          ],
        },

        data: {
          failureCode,
        },
      });
    } catch {
      this.logger.error(`Impossible d'enregistrer l'anomalie : ${payoutId}`);
    }

    this.logger.warn(`PAYOUT_REVIEW_REQUIRED : ` + `${payoutId} — ${failureCode}`);

    // Aucun changement vers FAILED.
    // Aucun remboursement automatique.
    // Aucun retour vers CREATED.
  }

  // ====================================================
  // RECONCILIATION DES VERSEMENTS PENDING
  // ====================================================

  private async reconcilePendingPayouts(cutoff: Date): Promise<void> {
    const pending = await this.prisma.payout.findMany({
      where: {
        provider: PaymentProvider.PAWAPAY,

        status: PayoutStatus.PENDING,

        createdAt: {
          gte: cutoff,
        },

        providerReference: {
          not: null,
        },

        ...(this.pendingCursor
          ? {
              id: {
                gt: this.pendingCursor,
              },
            }
          : {}),
      },

      select: {
        id: true,
        providerReference: true,
      },

      orderBy: {
        id: 'asc',
      },

      take: MAX_PENDING_PER_CYCLE,
    });

    let inspected = 0;

    let finalized = 0;

    let waiting = 0;

    let reviewRequired = 0;

    let errors = 0;

    for (const row of pending) {
      if (!this.isAutomationEnabled()) {
        break;
      }

      this.pendingCursor = row.id;

      inspected++;

      try {
        // L'identifiant distant doit correspondre
        // exactement à l'identifiant local.

        if (row.providerReference !== row.id) {
          reviewRequired++;

          this.logger.warn(`Référence de versement incohérente : ${row.id}`);

          continue;
        }

        // Consultation directe de pawaPay.
        //
        // Aucun POST pendant la réconciliation.

        const remote = await this.api.getPayout(row.id);

        // ==============================================
        // VERSEMENT NON RETROUVE
        // ==============================================

        if (remote.status === 'NOT_FOUND') {
          reviewRequired++;

          await this.flagForReview(row.id, 'PAYOUT_REMOTE_NOT_FOUND');

          // NOT_FOUND ne constitue pas une preuve
          // suffisante pour autoriser un nouvel envoi.

          continue;
        }

        // ==============================================
        // REPONSE DISTANTE INVALIDE
        // ==============================================

        if (remote.status !== 'FOUND' || !remote.data || remote.data.payoutId !== row.id) {
          reviewRequired++;

          await this.flagForReview(row.id, 'INVALID_REMOTE_PAYOUT_RESPONSE');

          continue;
        }

        const remoteStatus = remote.data.status;

        // ==============================================
        // VERSEMENT CONFIRME
        // ==============================================

        if (remoteStatus === 'COMPLETED') {
          // Le service de finalisation effectue
          // sa propre vérification distante.
          //
          // Puis il valide les écritures comptables
          // dans une transaction SQL atomique.

          const result = await this.finalization.finalizeConfirmedPayout(row.id);

          finalized++;

          this.logger.log(`Versement ${row.id} : ${result}`);

          continue;
        }

        // ==============================================
        // VERSEMENT EN ECHEC OU REJETE
        // ==============================================

        if (remoteStatus === 'FAILED' || remoteStatus === 'REJECTED') {
          reviewRequired++;

          await this.flagForReview(
            row.id,

            remoteStatus === 'FAILED' ? 'PAYOUT_REMOTE_FAILED' : 'PAYOUT_REMOTE_REJECTED',
          );

          // Le versement reste PENDING.
          //
          // Le séquestre reste intact.
          //
          // Une intervention humaine est requise.

          continue;
        }

        // ==============================================
        // VERSEMENT EN COURS
        // ==============================================

        if (
          remoteStatus === 'ACCEPTED' ||
          remoteStatus === 'PROCESSING' ||
          remoteStatus === 'SUBMITTED' ||
          remoteStatus === 'ENQUEUED' ||
          remoteStatus === 'PENDING'
        ) {
          waiting++;

          this.logger.log(`Versement ${row.id} toujours en attente`);

          continue;
        }

        // ==============================================
        // STATUT DISTANT INCONNU
        // ==============================================

        reviewRequired++;

        await this.flagForReview(row.id, 'UNKNOWN_REMOTE_PAYOUT_STATUS');
      } catch {
        errors++;

        // Ne pas journaliser la réponse brute
        // du prestataire ni les données personnelles.

        this.logger.error(`Échec de réconciliation : ${row.id}`);
      }
    }

    // Fin du parcours : reprise au début
    // lors d'un prochain cycle.

    if (inspected === pending.length && pending.length < MAX_PENDING_PER_CYCLE) {
      this.pendingCursor = null;
    }

    this.logger.log(
      `PAYOUT_RECONCILIATION : ` +
        `inspectés=${inspected}, ` +
        `finalisés=${finalized}, ` +
        `en_attente=${waiting}, ` +
        `à_vérifier=${reviewRequired}, ` +
        `erreurs=${errors}`,
    );
  }

  // ====================================================
  // ENVOI DES NOUVEAUX VERSEMENTS CREATED
  // ====================================================

  private async sendCreatedPayouts(cutoff: Date): Promise<void> {
    if (!this.isSendingEnabled()) {
      return;
    }

    const now = new Date();

    const created = await this.prisma.payout.findMany({
      where: {
        provider: PaymentProvider.PAWAPAY,

        status: PayoutStatus.CREATED,

        attempt: 1,

        currency: 'XAF',

        providerReference: null,

        confirmedAt: null,

        createdAt: {
          gte: cutoff,
        },

        ...(this.createdCursor
          ? {
              id: {
                gt: this.createdCursor,
              },
            }
          : {}),

        // Première vérification de l'éligibilité.
        //
        // Les vérifications financières complètes
        // seront répétées sous verrou SQL dans
        // PawapayPayoutsService.

        test: {
          is: {
            status: TestStatus.SUCCESS,

            attempt: {
              is: {
                isCorrect: true,
              },
            },
          },
        },
      },

      select: {
        id: true,
        testId: true,
      },

      orderBy: {
        id: 'asc',
      },

      take: MAX_CREATED_PER_CYCLE,
    });

    let inspected = 0;

    let accepted = 0;

    let duplicates = 0;

    let reviewRequired = 0;

    let skipped = 0;

    let errors = 0;

    for (const row of created) {
      // Vérification avant chaque opération.

      if (!this.isSendingEnabled()) {
        this.logger.warn('Nouveaux envois de versements désactivés');

        break;
      }

      this.createdCursor = row.id;

      inspected++;

      try {
        // Préfiltrage de la réclamation.
        //
        // Cette lecture ne constitue pas une
        // autorisation d'envoi.
        //
        // Le service métier vérifiera de nouveau
        // la réclamation dans la transaction.

        const claim = await this.prisma.rewardClaim.findUnique({
          where: {
            testId: row.testId,
          },

          select: {
            status: true,
            authorizedAt: true,
            expiresAt: true,
          },
        });

        if (
          !claim ||
          claim.status !== RewardClaimStatus.AUTHORIZED ||
          !claim.authorizedAt ||
          claim.authorizedAt < cutoff ||
          claim.authorizedAt > now ||
          claim.expiresAt <= new Date()
        ) {
          skipped++;

          this.logger.warn(`Versement non éligible : ${row.id}`);

          continue;
        }

        // ==============================================
        // ENVOI VIA LE SERVICE METIER
        // ==============================================

        // Le service métier effectue :
        //
        // 1. Vérification active-conf.
        // 2. Contrôle du financement.
        // 3. Contrôle du séquestre.
        // 4. Réservation durable en base.
        // 5. Création du permis unique.
        // 6. POST pawaPay.
        //
        // Aucun POST direct depuis le scheduler.

        const result = await this.payouts.sendCreatedPayout(row.id);

        if (result === 'ACCEPTED') {
          accepted++;

          this.logger.log(`Versement accepté : ${row.id}`);

          continue;
        }

        if (result === 'DUPLICATE_IGNORED') {
          duplicates++;

          this.logger.warn(`Versement déjà connu : ${row.id}`);

          continue;
        }

        if (result === 'REQUIRES_REVIEW') {
          reviewRequired++;

          this.logger.warn(`Versement à vérifier : ${row.id}`);

          continue;
        }

        skipped++;

        this.logger.log(`Versement ignoré : ${row.id}`);
      } catch {
        errors++;

        // Si la réservation n'a pas été effectuée,
        // le versement reste CREATED.
        //
        // Si la réservation a été effectuée,
        // il reste PENDING.
        //
        // Aucun changement d'état forcé ici.

        this.logger.error(`Échec du traitement du versement : ${row.id}`);
      }
    }

    if (inspected === created.length && created.length < MAX_CREATED_PER_CYCLE) {
      this.createdCursor = null;
    }

    this.logger.log(
      `PAYOUT_SENDING : ` +
        `inspectés=${inspected}, ` +
        `acceptés=${accepted}, ` +
        `doublons=${duplicates}, ` +
        `à_vérifier=${reviewRequired}, ` +
        `ignorés=${skipped}, ` +
        `erreurs=${errors}`,
    );
  }

  // ====================================================
  // EXECUTION AUTOMATIQUE
  // ====================================================

  @Cron('*/5 * * * *', {
    name: 'pawapay-sandbox-payouts',

    timeZone: 'UTC',

    waitForCompletion: true,
  })
  async execute(): Promise<void> {
    // Protection contre les exécutions simultanées
    // dans une même instance NestJS.

    if (this.running || !this.isSandbox()) {
      return;
    }

    this.running = true;

    try {
      // ==============================================
      // 1. SURVEILLANCE
      // ==============================================

      // La surveillance reste disponible même
      // lorsque l'automatisation est désactivée.
      //
      // Elle ne déclenche aucun appel pawaPay.

      try {
        await this.monitorStalePayouts();
      } catch {
        this.logger.error('Échec de la surveillance des versements');
      }

      // ==============================================
      // 2. VERIFICATION DE L'AUTOMATISATION
      // ==============================================

      if (!this.isAutomationEnabled()) {
        return;
      }

      const cutoff = this.getCutoff();

      if (!cutoff || Date.now() < cutoff.getTime()) {
        return;
      }

      // ==============================================
      // 3. RECONCILIATION PRIORITAIRE
      // ==============================================

      // Les opérations déjà réservées sont
      // traitées avant les nouveaux envois.
      //
      // Cette étape reste possible lorsque
      // ENABLE_PAWAPAY_PAYOUT_SENDING=NO.

      try {
        await this.reconcilePendingPayouts(cutoff);
      } catch {
        this.logger.error('Cycle de réconciliation interrompu');

        // Par prudence, aucun nouvel envoi
        // si la phase de réconciliation elle-même
        // a échoué.

        return;
      }

      // ==============================================
      // 4. NOUVEAUX ENVOIS
      // ==============================================

      if (!this.isSendingEnabled()) {
        return;
      }

      await this.sendCreatedPayouts(cutoff);
    } catch {
      this.logger.error('Cycle automatique des versements pawaPay interrompu');
    } finally {
      // Libération systématique du verrou local.

      this.running = false;
    }
  }
}
