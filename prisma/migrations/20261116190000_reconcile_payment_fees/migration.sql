ALTER TABLE "payments"
ADD COLUMN IF NOT EXISTS "provider_fee_amount" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "payments"
ADD COLUMN IF NOT EXISTS "service_fee_amount" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "payments"
ADD COLUMN IF NOT EXISTS "provider_fee_actual_amount" BIGINT;
