import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

import { StripeService } from './stripe.service';
import { StripePaymentController } from './stripe-payment.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './strpe-webhook.service';
import { StripePaymentsService } from './stripe-payment.service';
import { PaymentFeeService } from './payment-fee.service';
import { PawapayApiService } from './pawapay/pawapay-api.service';
import { PawapayDepositsService } from './pawapay/pawapay-deposits.service';
import { PawapayCallbackController } from './pawapay/pawapay-callback.controller';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [StripePaymentController, StripeWebhookController, PawapayCallbackController],
  providers: [
    StripeService,
    StripePaymentsService,
    StripeWebhookService,
    PaymentFeeService,
    PawapayApiService,
    PawapayDepositsService,
  ],
  exports: [StripePaymentsService, PawapayApiService, PawapayDepositsService],
})
export class PaymentsModule {}
