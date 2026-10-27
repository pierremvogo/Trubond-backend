import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

type PrefKey = 'push' | 'sms' | 'results' | 'rewards' | 'reminders' | 'news';

type Prefs = Record<PrefKey, boolean>;

@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly defaults: Prefs = {
    push: true,
    sms: false,
    results: true,
    rewards: true,
    reminders: true,
    news: false,
  };

  private readonly categories = ['RESULTS', 'REWARDS', 'REMINDERS', 'NEWS'] as const;

  private async load(userId: string): Promise<Prefs> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });

    const prefs: Prefs = { ...this.defaults };

    for (const row of rows) {
      if (row.purpose === 'CHANNEL') {
        if (row.channel === NotificationChannel.PUSH) {
          prefs.push = row.enabled;
        }

        if (row.channel === NotificationChannel.SMS) {
          prefs.sms = row.enabled;
        }
      }
    }

    // Les catégories sont communes aux deux canaux
    // dans l'interface actuelle.
    // On utilise PUSH comme référence canonique.
    for (const category of this.categories) {
      const row = rows.find(
        (item) => item.channel === NotificationChannel.PUSH && item.purpose === category,
      );

      if (row) {
        const key = category.toLowerCase() as 'results' | 'rewards' | 'reminders' | 'news';

        prefs[key] = row.enabled;
      }
    }

    return prefs;
  }

  async findMine(userId: string): Promise<Prefs> {
    return this.load(userId);
  }

  async updateMine(userId: string, dto: UpdateNotificationPreferencesDto): Promise<Prefs> {
    const updates: Array<{
      channel: NotificationChannel;
      purpose: string;
      enabled: boolean;
    }> = [];

    if (dto.push !== undefined) {
      updates.push({
        channel: NotificationChannel.PUSH,
        purpose: 'CHANNEL',
        enabled: dto.push,
      });
    }

    if (dto.sms !== undefined) {
      updates.push({
        channel: NotificationChannel.SMS,
        purpose: 'CHANNEL',
        enabled: dto.sms,
      });
    }

    for (const category of this.categories) {
      const key = category.toLowerCase() as 'results' | 'rewards' | 'reminders' | 'news';

      const enabled = dto[key];

      if (enabled === undefined) continue;

      // Même catégorie pour PUSH et SMS.
      for (const channel of [NotificationChannel.PUSH, NotificationChannel.SMS]) {
        updates.push({
          channel,
          purpose: category,
          enabled,
        });
      }
    }

    await this.prisma.$transaction(
      updates.map((item) =>
        this.prisma.notificationPreference.upsert({
          where: {
            userId_channel_purpose: {
              userId,
              channel: item.channel,
              purpose: item.purpose,
            },
          },
          create: {
            userId,
            channel: item.channel,
            purpose: item.purpose,
            enabled: item.enabled,
          },
          update: {
            enabled: item.enabled,
          },
        }),
      ),
    );

    return this.load(userId);
  }
}
