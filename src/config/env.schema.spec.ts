import { envSchema } from './env.schema';

describe('envSchema', () => {
  const validEnvironment = {
    DATABASE_URL: 'postgresql://user:password@localhost:5432/truebond',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('applies safe development defaults', () => {
    expect(envSchema.parse(validEnvironment)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      HOST: '0.0.0.0',
      LOG_LEVEL: 'info',
    });
  });

  it('rejects invalid database URLs', () => {
    expect(() => envSchema.parse({ ...validEnvironment, DATABASE_URL: 'mysql://localhost/db' }))
      .toThrow();
  });

  it('rejects invalid ports', () => {
    expect(() => envSchema.parse({ ...validEnvironment, PORT: '70000' })).toThrow();
  });
});
