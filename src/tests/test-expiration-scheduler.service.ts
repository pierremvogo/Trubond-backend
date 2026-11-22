import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TestExpirationService } from './test-expiration.service';

@Injectable()
export class TestExpirationSchedulerService {
  private readonly logger = new Logger(TestExpirationSchedulerService.name);
  constructor(private readonly expiration: TestExpirationService) {}

  @Cron('* * * * *', {
    name: 'truebond-test-expiration',
    timeZone: 'UTC',
    waitForCompletion: true,
  })
  async execute(): Promise<void> {
    if (
      process.env.PAWAPAY_ENV?.trim().toUpperCase() !== 'SANDBOX' ||
      process.env.OUTBOX_WORKER_MODE !== 'INSPECT_LOOP' ||
      process.env.ENABLE_TEST_EXPIRATION_SCHEDULER !== 'YES'
    )
      return;

    // Protection supplémentaire : ne jamais créer de remboursement par accident.
    if (process.env.ENABLE_TEST_EXPIRATION_PROCESSING !== 'YES') {
      this.logger.log('Scheduler expiration actif (diagnostic uniquement, aucun traitement)');
      return;
    }

    try {
      const result = await this.expiration.processExpiredInvitations(50);
      this.logger.log(`Expirations : ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error(
        'Cycle expiration interrompu',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
