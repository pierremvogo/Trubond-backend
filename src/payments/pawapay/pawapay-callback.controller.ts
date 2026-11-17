import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { PawapayDepositsService } from './pawapay-deposits.service';

@Controller('payments/pawapay')
export class PawapayCallbackController {
  private readonly logger = new Logger(PawapayCallbackController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deposits: PawapayDepositsService,
  ) {}

  @Post('callback')
  @HttpCode(HttpStatus.OK)
  async handleCallback(@Body() body: unknown) {
    // Le callback n'est jamais une preuve de paiement.
    // Il sert uniquement à identifier un dépôt à vérifier.

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { received: true };
    }

    const payload = body as Record<string, unknown>;
    const depositId = payload.depositId;

    if (
      typeof depositId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(depositId)
    ) {
      this.logger.warn('Callback pawaPay sans depositId UUID valide');

      return { received: true };
    }

    // Rechercher uniquement un dépôt déjà connu de TRUEBOND.
    const payment = await this.prisma.payment.findFirst({
      where: {
        provider: 'PAWAPAY',
        providerReference: depositId,
      },
      select: {
        id: true,
      },
    });

    if (!payment) {
      this.logger.warn(`Callback pawaPay : dépôt inconnu ${depositId}`);

      return { received: true };
    }

    try {
      // Vérification distante via l'API pawaPay.
      const result = await this.deposits.reconcileDeposit(payment.id);

      if (result.confirmed && result.providerStatus === 'COMPLETED') {
        await this.deposits.finalizeConfirmedDeposit(payment.id);
      }

      // PROCESSING, FAILED ou NOT_FOUND :
      // aucune finalisation financière.
    } catch (error) {
      this.logger.error(
        `Échec de vérification du dépôt ${depositId}`,
        error instanceof Error ? error.stack : String(error),
      );

      // Une erreur temporaire doit permettre une nouvelle
      // tentative de livraison du callback.
      throw error;
    }

    return { received: true };
  }
}
