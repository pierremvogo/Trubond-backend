CREATE TABLE "pawapay_deposit_requests" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "correspondent" VARCHAR(40) NOT NULL,
    "phone_number_enc" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pawapay_deposit_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pawapay_deposit_requests_payment_id_key"
ON "pawapay_deposit_requests"("payment_id");

ALTER TABLE "pawapay_deposit_requests"
ADD CONSTRAINT "pawapay_deposit_requests_payment_id_fkey"
FOREIGN KEY ("payment_id")
REFERENCES "payments"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
