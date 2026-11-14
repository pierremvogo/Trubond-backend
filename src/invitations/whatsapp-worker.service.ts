import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { WhatsappDeliveryService } from './whatsapp-delivery.service';

@Injectable()
export class WhatsappWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappWorkerService.name);

  private readonly intervalMs = 5000;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopping = false;

  constructor(private readonly deliveryService: WhatsappDeliveryService) {}

  onModuleInit(): void {
    if (process.env.WHATSAPP_ENABLED !== 'true') {
      this.logger.log('Worker WhatsApp désactivé');
      return;
    }

    this.logger.log('Worker WhatsApp démarré dans le backend NestJS');

    this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.stopping) {
      return;
    }

    this.timer = setTimeout(() => {
      void this.runCycle();
    }, delay);

    this.timer.unref?.();
  }

  private async runCycle(): Promise<void> {
    if (this.stopping || this.running) {
      return;
    }

    this.running = true;

    try {
      const recovered = await this.deliveryService.recoverStaleDeliveries();

      if (recovered > 0) {
        this.logger.warn(`${recovered} livraison(s) WhatsApp interrompue(s)`);
      }

      await this.deliveryService.processNext();
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : 'Erreur du worker WhatsApp');
    } finally {
      this.running = false;

      if (!this.stopping) {
        this.schedule(this.intervalMs);
      }
    }
  }

  onModuleDestroy(): void {
    this.stopping = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.logger.log('Arrêt du worker WhatsApp');
  }
}
