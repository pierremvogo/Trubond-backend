-- Appliquer une seule fois, sur la base PostgreSQL du backend TrueBond.
-- Une ligne par remboursement : aucune remise à zéro automatique.
CREATE TABLE IF NOT EXISTS "PawapayManualRefundAttempt" (
  "refundId" UUID PRIMARY KEY,
  "depositId" UUID NOT NULL,
  "amount" BIGINT NOT NULL CHECK ("amount" > 0),
  "currency" VARCHAR(3) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "outcome" VARCHAR(32) NOT NULL DEFAULT 'UNCERTAIN'
);