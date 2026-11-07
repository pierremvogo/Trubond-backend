import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';

import { FastifyRequest } from 'fastify';
import Stripe from 'stripe';

import { ConfigService } from '@nestjs/config';
import { StripeService } from './stripe.service';
import { StripeWebhookService } from './strpe-webhook.service';

@Controller('payments/stripe')
export class StripeWebhookController {
  constructor(
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
    private readonly webhookService: StripeWebhookService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!signature || !request.rawBody) {
      throw new BadRequestException('Signature ou corps brut manquant');
    }

    let event: Stripe.Event;

    try {
      event = this.stripe.client.webhooks.constructEvent(
        request.rawBody,
        signature,
        this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'),
      );
    } catch {
      throw new BadRequestException('Signature Stripe invalide');
    }

    await this.webhookService.process(event);

    return { received: true };
  }
}
