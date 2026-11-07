import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

import { StripeService } from './stripe.service';
import { StripePaymentController } from './stripe-payment.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './strpe-webhook.service';
import { StripePaymentsService } from './stripe-payment.service';
import { PaymentFeeService } from './payment-fee.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [StripePaymentController, StripeWebhookController],
  providers: [StripeService, StripePaymentsService, StripeWebhookService, PaymentFeeService],
  exports: [StripePaymentsService],
})
export class PaymentsModule {}
