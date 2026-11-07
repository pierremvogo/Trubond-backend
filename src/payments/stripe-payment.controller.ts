import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccessTokenGuard, CurrentAuth, AuthContext } from '../auth/auth.guard';
import { StripePaymentsService } from './stripe-payment.service';

@ApiTags('Payments')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('tests')
export class StripePaymentController {
  constructor(private readonly payments: StripePaymentsService) {}

  @Post(':id/payment-intent')
  @ApiOperation({
    summary: 'Initialiser le paiement Stripe d’un test',
  })
  createPaymentIntent(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.createPaymentIntent(auth.userId, id);
  }
}
