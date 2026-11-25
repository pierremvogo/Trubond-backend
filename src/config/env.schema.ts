import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    HOST: z.string().min(1).default('0.0.0.0'),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    CORS_ORIGINS: z.string().default('http://localhost:3000'),

    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
        message: 'DATABASE_URL doit être une URL PostgreSQL',
      }),

    REDIS_URL: z
      .string()
      .url()
      .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
        message: 'REDIS_URL doit être une URL Redis',
      }),

    STRIPE_SECRET_KEY: z.string().startsWith('sk_test_', {
      message: 'STRIPE_SECRET_KEY doit être une clé Stripe Sandbox sk_test_',
    }),

    STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_', {
      message: 'STRIPE_WEBHOOK_SECRET doit commencer par whsec_',
    }),

    // ==================================================
    // WHATSAPP
    // ==================================================

    WHATSAPP_ENABLED: z.enum(['true', 'false']).default('false'),

    WHATSAPP_ACCESS_TOKEN: z.string().optional(),

    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

    WHATSAPP_GRAPH_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .optional(),

    WHATSAPP_TEMPLATE_NAME: z.string().optional(),

    WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('fr'),

    TRUEBOND_INVITATION_BASE_URL: z.string().url().optional(),

    // ==================================================
    // PAWAPAY PAYOUTS
    // ==================================================

    PAWAPAY_ENV: z.string().optional(),

    OTP_DELIVERY_PROVIDER: z.string().optional(),

    ENABLE_PAWAPAY_PAYOUT_PREPARATION: z.enum(['YES', 'NO']).default('NO'),

    ENABLE_PAWAPAY_PAYOUT_SENDING: z.enum(['YES', 'NO']).default('NO'),

    PAWAPAY_PAYOUT_AUTOMATION: z.enum(['YES', 'NO']).default('NO'),

    PAWAPAY_PAYOUT_AUTOMATION_START_AT: z.string().optional(),

    PAWAPAY_PAYOUT_STALE_MINUTES: z.coerce.number().int().min(5).max(10080).default(30),
  })

  .superRefine((env, ctx) => {
    // ==================================================
    // VALIDATION WHATSAPP
    // ==================================================

    if (env.WHATSAPP_ENABLED === 'true') {
      const required = [
        'WHATSAPP_ACCESS_TOKEN',
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_GRAPH_VERSION',
        'WHATSAPP_TEMPLATE_NAME',
        'TRUEBOND_INVITATION_BASE_URL',
      ] as const;

      for (const key of required) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} est obligatoire lorsque WhatsApp est activé`,
          });
        }
      }
    }

    // ==================================================
    // VALIDATION PAWAPAY PAYOUTS
    // ==================================================

    const payoutEnabled =
      env.ENABLE_PAWAPAY_PAYOUT_PREPARATION === 'YES' ||
      env.ENABLE_PAWAPAY_PAYOUT_SENDING === 'YES' ||
      env.PAWAPAY_PAYOUT_AUTOMATION === 'YES';

    if (payoutEnabled) {
      if (env.PAWAPAY_ENV?.trim().toUpperCase() !== 'SANDBOX') {
        ctx.addIssue({
          code: 'custom',
          path: ['PAWAPAY_ENV'],
          message: 'Les décaissements sont autorisés uniquement en Sandbox',
        });
      }

      if (env.NODE_ENV === 'production') {
        ctx.addIssue({
          code: 'custom',
          path: ['NODE_ENV'],
          message: 'Les décaissements de développement sont interdits en production',
        });
      }

      if (env.OTP_DELIVERY_PROVIDER !== 'socket') {
        ctx.addIssue({
          code: 'custom',
          path: ['OTP_DELIVERY_PROVIDER'],
          message: 'Le parcours Sandbox actuel nécessite le fournisseur OTP socket',
        });
      }
    }

    if (env.ENABLE_PAWAPAY_PAYOUT_SENDING === 'YES' && env.PAWAPAY_PAYOUT_AUTOMATION !== 'YES') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAWAPAY_PAYOUT_AUTOMATION'],
        message: 'La réconciliation doit être activée avant les envois',
      });
    }

    if (env.PAWAPAY_PAYOUT_AUTOMATION === 'YES') {
      const raw = env.PAWAPAY_PAYOUT_AUTOMATION_START_AT;

      const validFormat = !!raw && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw);

      const date = raw ? new Date(raw) : null;

      const normalized = raw?.replace(
        /(?:\.(\d{1,3}))?Z$/,
        (_, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`,
      );

      if (
        !validFormat ||
        !date ||
        Number.isNaN(date.getTime()) ||
        date.toISOString() !== normalized
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['PAWAPAY_PAYOUT_AUTOMATION_START_AT'],
          message: 'Une date UTC valide est obligatoire pour automatiser les versements',
        });
      }
    }
  });

export type Environment = z.infer<typeof envSchema>;
