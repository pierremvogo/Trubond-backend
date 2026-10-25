-- Apply only to a backed-up, disposable test DB first. Review existing data.
ALTER TABLE "users" ADD COLUMN "password_hash" TEXT;
ALTER TABLE "users" ADD COLUMN "phone_verified_at" TIMESTAMPTZ(6);
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET';
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETE';
