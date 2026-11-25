import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// ======================================================
// MODULES INTERNES
// ======================================================

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

// ======================================================
// SERVICES DE SECURITE
// ======================================================

import { TestPhoneSecurity } from '../tests/test-phone-security.service';

import { InvitationTokenService } from '../invitations/invitation-token.service';

// ======================================================
// STRIPE
// ======================================================

import { StripeService } from './stripe.service';

import { StripePaymentController } from './stripe-payment.controller';

import { StripeWebhookController } from './stripe-webhook.controller';

import { StripeWebhookService } from './strpe-webhook.service';

import { StripePaymentsService } from './stripe-payment.service';

// ======================================================
// FRAIS DE PAIEMENT
// ======================================================

import { PaymentFeeService } from './payment-fee.service';

// ======================================================
// PAWAPAY : API
// ======================================================

import { PawapayApiService } from './pawapay/pawapay-api.service';

// ======================================================
// PAWAPAY : DEPOTS
// ======================================================

import { PawapayDepositsService } from './pawapay/pawapay-deposits.service';

import { PawapayDepositsController } from './pawapay/pawapay-deposits.controller';

// ======================================================
// PAWAPAY : REMBOURSEMENTS
// ======================================================

import { PawapayRefundsService } from './pawapay/pawapay-refunds.service';

import { PawapayRefundFinalizationService } from './pawapay/pawapay-refund-finalization.service';

import { PawapayRefundsSchedulerService } from './pawapay/pawapay-refunds-scheduler.service';

// ======================================================
// PAWAPAY : DECAISSEMENTS
// ======================================================

import { PawapayPayoutsService } from './pawapay/pawapay-payouts.service';

import { PawapayPayoutFinalizationService } from './pawapay/pawapay-payout-finalization.service';

import { PawapayPayoutsSchedulerService } from './pawapay/pawapay-payouts-scheduler.service';

// ======================================================
// PAWAPAY : CALLBACKS
// ======================================================

import { PawapayCallbackController } from './pawapay/pawapay-callback.controller';

// ======================================================
// MODULE DE PAIEMENT TRUEBOND
// ======================================================

@Module({
  // ====================================================
  // MODULES IMPORTES
  // ====================================================

  imports: [AuthModule, PrismaModule, ConfigModule],

  // ====================================================
  // CONTROLEURS
  // ====================================================

  controllers: [
    // Stripe
    StripePaymentController,
    StripeWebhookController,

    // pawaPay
    PawapayCallbackController,
    PawapayDepositsController,
  ],

  // ====================================================
  // SERVICES INTERNES
  // ====================================================

  providers: [
    // --------------------------------------------------
    // Stripe
    // --------------------------------------------------

    StripeService,
    StripePaymentsService,
    StripeWebhookService,

    // --------------------------------------------------
    // Frais de paiement
    // --------------------------------------------------

    PaymentFeeService,

    // --------------------------------------------------
    // Securite
    // --------------------------------------------------

    TestPhoneSecurity,
    InvitationTokenService,

    // --------------------------------------------------
    // pawaPay : API
    // --------------------------------------------------

    PawapayApiService,

    // --------------------------------------------------
    // pawaPay : depots
    // --------------------------------------------------

    PawapayDepositsService,

    // --------------------------------------------------
    // pawaPay : remboursements
    // --------------------------------------------------

    PawapayRefundsService,
    PawapayRefundFinalizationService,
    PawapayRefundsSchedulerService,

    // --------------------------------------------------
    // pawaPay : decaissements
    // --------------------------------------------------

    PawapayPayoutsService,
    PawapayPayoutFinalizationService,
    PawapayPayoutsSchedulerService,
  ],

  // ====================================================
  // SERVICES EXPORTES
  // ====================================================

  exports: [
    // Stripe
    StripePaymentsService,

    // pawaPay : API
    PawapayApiService,

    // pawaPay : depots
    PawapayDepositsService,

    // pawaPay : remboursements
    PawapayRefundsService,
    PawapayRefundFinalizationService,

    // pawaPay : decaissements
    PawapayPayoutsService,
    PawapayPayoutFinalizationService,
  ],
})
export class PaymentsModule {}
