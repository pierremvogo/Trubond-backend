import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  readonly client: Stripe;

  constructor(config: ConfigService) {
    const secretKey = config.getOrThrow<string>('STRIPE_SECRET_KEY');

    this.client = new Stripe(secretKey);
  }
}
