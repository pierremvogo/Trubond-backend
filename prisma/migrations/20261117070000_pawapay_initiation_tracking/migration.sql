
CREATE TYPE "PawapayInitiationStatus" AS ENUM (
  'RESERVED',
  'SENDING',
  'ACCEPTED',
  'UNCERTAIN',
  'REJECTED'
);

ALTER TABLE "pawapay_deposit_requests"
  ADD COLUMN "initiation_status" "PawapayInitiationStatus"
    NOT NULL DEFAULT 'RESERVED',
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "attempt_token" UUID,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_attempt_at" TIMESTAMPTZ(6),
  ADD COLUMN "accepted_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_error_code" VARCHAR(100),
  ADD COLUMN "updated_at" TIMESTAMPTZ(6)
    NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "pawapay_deposit_requests_initiation_status_lease_expires_at_idx"
  ON "pawapay_deposit_requests"
  ("initiation_status", "lease_expires_at");

ALTER TABLE "pawapay_deposit_requests"
  ADD CONSTRAINT "pawapay_deposit_requests_attempt_count_check"
  CHECK ("attempt_count" >= 0);
UPDATE "pawapay_deposit_requests"
SET "initiation_status" = 'UNCERTAIN';