
-- Ajout du champ d'archivage des tests.
-- Migration additive : aucune donnée existante supprimée.

ALTER TABLE "public"."tests"
ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(6);
