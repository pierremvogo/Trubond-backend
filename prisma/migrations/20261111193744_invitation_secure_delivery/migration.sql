
-- TRUEBOND : livraison sécurisée des invitations
-- Ne modifie aucune donnée financière.

-- 1. Stockage temporaire du token chiffré.
ALTER TABLE "invitations"
ADD COLUMN "token_encrypted" TEXT;

-- 2. Suivi des livraisons d'invitation.
CREATE TABLE "invitation_deliveries" (
    "id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(6),
    "provider_ref" VARCHAR(255),
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invitation_deliveries_pkey"
    PRIMARY KEY ("id")
);

-- 3. Index pour le traitement des livraisons.
CREATE INDEX "invitation_deliveries_status_available_at_idx"
ON "invitation_deliveries" ("status", "available_at");

CREATE INDEX "invitation_deliveries_invitation_id_created_at_idx"
ON "invitation_deliveries" ("invitation_id", "created_at");

-- 4. Relation avec les invitations existantes.
ALTER TABLE "invitation_deliveries"
ADD CONSTRAINT "invitation_deliveries_invitation_id_fkey"
FOREIGN KEY ("invitation_id")
REFERENCES "invitations" ("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

-- 5. Une seule invitation active par test.
CREATE UNIQUE INDEX "invitations_one_active_per_test"
ON "invitations" ("test_id")
WHERE "status" IN (
    'CREATED',
    'QUEUED',
    'SENT',
    'DELIVERED',
    'OPENED'
);
