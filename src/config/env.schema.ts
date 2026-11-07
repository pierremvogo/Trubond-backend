import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  HOST: z.string().min(1).default('0.0.0.0'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

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
});

export type Environment = z.infer<typeof envSchema>;
