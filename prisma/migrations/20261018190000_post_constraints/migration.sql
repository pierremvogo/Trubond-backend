-- =============================================================================
-- post_constraints_corrige.sql
-- Contraintes PostgreSQL complémentaires à schema.prisma.
-- À installer APRÈS la migration init, dans une migration Prisma distincte.
-- Hypothèse : les enums PostgreSQL Prisma existent déjà.
--
-- Utilisation :
--   1. Vérifier que la migration init est appliquée.
--   2. Remplacer le fichier de la migration post_constraints NON APPLIQUÉE.
--   3. npx prisma migrate dev
--
-- Les noms de tables/colonnes suivent les @@map / @map du schéma.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. CHECK : montants positifs et cohérence des totaux
-- -----------------------------------------------------------------------------

ALTER TABLE tests
  ADD CONSTRAINT chk_tests_amounts_positive
    CHECK (reward_amount > 0 AND service_fee_amount >= 0 AND total_amount > 0),
  ADD CONSTRAINT chk_tests_total_matches
    CHECK (total_amount = reward_amount + service_fee_amount),
  ADD CONSTRAINT chk_tests_version_nonnegative CHECK (version >= 0);

ALTER TABLE payments
  ADD CONSTRAINT chk_payments_amount_positive CHECK (amount > 0);

ALTER TABLE payouts
  ADD CONSTRAINT chk_payouts_amounts
    CHECK (amount_gross > 0 AND amount_net > 0 AND provider_fee_amount >= 0
           AND amount_net + provider_fee_amount = amount_gross);

ALTER TABLE refunds
  ADD CONSTRAINT chk_refunds_amount_positive CHECK (amount > 0);

ALTER TABLE ledger_entries
  ADD CONSTRAINT chk_ledger_entries_amount_positive CHECK (amount > 0);

ALTER TABLE fee_schedules
  ADD CONSTRAINT chk_fee_schedules_values
    CHECK (fixed_amount >= 0 AND rate_bps >= 0 AND rate_bps <= 10000);

ALTER TABLE countries
  ADD CONSTRAINT chk_countries_min_reward CHECK (min_reward_amount >= 0);

ALTER TABLE feature_flags
  ADD CONSTRAINT chk_feature_flags_rollout CHECK (rollout_percent BETWEEN 0 AND 100);


-- -----------------------------------------------------------------------------
-- 2. INDEX UNIQUES PARTIELS : un seul flux « actif » par test
-- -----------------------------------------------------------------------------

-- Un seul paiement réussi par test (évite le double séquestre).
CREATE UNIQUE INDEX uq_payments_one_succeeded_per_test
  ON payments (test_id)
  WHERE status = 'SUCCEEDED';

-- Un seul payout actif par test. Un payout FAILED ou CANCELLED
-- n'occupe plus la place : une nouvelle tentative est possible.
CREATE UNIQUE INDEX uq_payouts_one_active_per_test
  ON payouts (test_id)
  WHERE status IN ('CREATED', 'PENDING', 'SUCCEEDED', 'REQUIRES_REVIEW');

-- Un seul remboursement actif par test.
CREATE UNIQUE INDEX uq_refunds_one_active_per_test
  ON refunds (test_id)
  WHERE status IN ('CREATED', 'PENDING', 'SUCCEEDED', 'REQUIRES_REVIEW');

-- Une seule facture émise par test et par destinataire.
CREATE UNIQUE INDEX uq_invoices_one_issued_per_recipient
  ON invoices (test_id, recipient_type, recipient_ref)
  WHERE status = 'ISSUED' AND test_id IS NOT NULL;

-- Une seule invitation vivante par test et par canal.
CREATE UNIQUE INDEX uq_invitations_one_live_per_channel
  ON invitations (test_id, channel)
  WHERE status IN ('CREATED', 'QUEUED', 'SENT', 'DELIVERED', 'OPENED');

-- Un seul facteur de session actif par famille de tokens (rotation).
CREATE UNIQUE INDEX uq_sessions_one_live_per_family
  ON sessions (family_id)
  WHERE revoked_at IS NULL;


-- -----------------------------------------------------------------------------
-- 3. EXCLUSION MUTUELLE : verrouillage du test au niveau de la BD.
-- Les triggers couvrent INSERT ET UPDATE et sérialisent les accès concurrents.
-- Un payout confirmé et un refund confirmé restent incompatibles.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_payout_refund_mutual_exclusion()
RETURNS trigger AS $$
DECLARE
  v_outcome TEXT;
BEGIN
  -- Toutes les écritures concurrentes concernant un même test prennent ce verrou.
  SELECT status::text INTO v_outcome FROM tests WHERE id = NEW.test_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test inexistant : %', NEW.test_id USING ERRCODE = '23503';
  END IF;

  -- Une opération confirmée ne doit jamais être requalifiée comme échouée.
  IF TG_OP = 'UPDATE' AND OLD.status::text = 'SUCCEEDED'
     AND (NEW.status::text <> 'SUCCEEDED' OR NEW.test_id <> OLD.test_id) THEN
    RAISE EXCEPTION 'Opération financière confirmée immuable (%)', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;

  -- Les opérations historiques FAILED/CANCELLED ne bloquent pas une nouvelle tentative.
  IF NEW.status::text IN ('CREATED','PENDING','SUCCEEDED','REQUIRES_REVIEW') THEN
    IF TG_TABLE_NAME = 'payouts' THEN
      IF v_outcome NOT IN ('SUCCESS','PAYOUT_PENDING') THEN
        RAISE EXCEPTION 'Payout non autorisé pour test % (statut %)', NEW.test_id, v_outcome
          USING ERRCODE = '23514';
      END IF;
      IF EXISTS (SELECT 1 FROM refunds WHERE test_id = NEW.test_id
                 AND status::text IN ('CREATED','PENDING','SUCCEEDED','REQUIRES_REVIEW')) THEN
        RAISE EXCEPTION 'Refund incompatible avec payout du test %', NEW.test_id
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF v_outcome NOT IN ('FAILURE','EXPIRED','REFUND_PENDING') THEN
        RAISE EXCEPTION 'Refund non autorisé pour test % (statut %)', NEW.test_id, v_outcome
          USING ERRCODE = '23514';
      END IF;
      IF EXISTS (SELECT 1 FROM payouts WHERE test_id = NEW.test_id
                 AND status::text IN ('CREATED','PENDING','SUCCEEDED','REQUIRES_REVIEW')) THEN
        RAISE EXCEPTION 'Payout incompatible avec refund du test %', NEW.test_id
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payouts_exclusion
  BEFORE INSERT OR UPDATE OF test_id, status ON payouts
  FOR EACH ROW EXECUTE FUNCTION fn_payout_refund_mutual_exclusion();
CREATE TRIGGER trg_refunds_exclusion
  BEFORE INSERT OR UPDATE OF test_id, status ON refunds
  FOR EACH ROW EXECUTE FUNCTION fn_payout_refund_mutual_exclusion();

-- Le service doit toujours confirmer l'état réel chez le PSP avant de marquer
-- FAILED/CANCELLED puis de créer une nouvelle tentative. Un timeout n'est pas un échec.

-- -----------------------------------------------------------------------------
-- 4. LEDGER : chaque transaction doit être équilibrée (débits = crédits)
--    Contrainte DIFFÉRÉE : vérifiée au COMMIT, une fois toutes les écritures
--    de la transaction insérées.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_ledger_transaction_balanced()
RETURNS trigger AS $$
DECLARE
  v_debit  NUMERIC;
  v_credit NUMERIC;
  v_ccy    INT;
  v_tx     UUID := COALESCE(NEW.transaction_id, OLD.transaction_id);
BEGIN
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE side = 'DEBIT'), 0),
    COALESCE(SUM(amount) FILTER (WHERE side = 'CREDIT'), 0),
    COUNT(DISTINCT currency)
  INTO v_debit, v_credit, v_ccy
  FROM ledger_entries
  WHERE transaction_id = v_tx;

  IF v_debit = 0 OR v_credit = 0 THEN
    RAISE EXCEPTION 'Transaction ledger % vide ou sans deux côtés', v_tx
      USING ERRCODE = '23514';
  END IF;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'Transaction ledger % déséquilibrée : débits=% crédits=%',
      v_tx, v_debit, v_credit USING ERRCODE = '23514';
  END IF;

  IF v_ccy > 1 THEN
    RAISE EXCEPTION 'Transaction ledger % mélange plusieurs devises', v_tx
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_ledger_transaction_balanced();

-- Contrôle aussi les transactions sans aucune écriture au COMMIT.
-- Le contrôle sur ledger_entries couvre celles créées après la transaction mère.
CREATE OR REPLACE FUNCTION fn_ledger_parent_balanced()
RETURNS trigger AS $$
DECLARE
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_count INTEGER;
BEGIN
  SELECT COUNT(*),
         COALESCE(SUM(amount) FILTER (WHERE side = 'DEBIT'), 0),
         COALESCE(SUM(amount) FILTER (WHERE side = 'CREDIT'), 0)
    INTO v_count, v_debit, v_credit
  FROM ledger_entries WHERE transaction_id = NEW.id;
  IF v_count < 2 OR v_debit <= 0 OR v_debit <> v_credit THEN
    RAISE EXCEPTION 'Ledger transaction % vide ou déséquilibrée', NEW.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_ledger_parent_balanced
  AFTER INSERT ON ledger_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_ledger_parent_balanced();

-- La devise de l'écriture doit correspondre à celle du compte et de la transaction.
CREATE OR REPLACE FUNCTION fn_ledger_entry_currency_match()
RETURNS trigger AS $$
DECLARE
  v_acc_ccy CHAR(3);
  v_tx_ccy  CHAR(3);
BEGIN
  SELECT currency INTO v_acc_ccy FROM ledger_accounts WHERE id = NEW.account_id;
  SELECT currency INTO v_tx_ccy  FROM ledger_transactions WHERE id = NEW.transaction_id;

  IF NEW.currency <> v_acc_ccy OR NEW.currency <> v_tx_ccy THEN
    RAISE EXCEPTION 'Devise incohérente (entry=%, compte=%, transaction=%)',
      NEW.currency, v_acc_ccy, v_tx_ccy USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_entries_currency
  BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_ledger_entry_currency_match();


-- -----------------------------------------------------------------------------
-- 5. IMMUABILITÉ : ledger, historique des tests, audit, tentatives
--    Ces tables sont append-only. Une correction passe par une écriture
--    de contre-passation (LedgerTransactionType.REVERSAL), jamais par un UPDATE.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_forbid_update_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La table % est en écriture seule (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fn_forbid_update_delete();

CREATE TRIGGER trg_ledger_transactions_immutable
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_forbid_update_delete();

CREATE TRIGGER trg_test_events_immutable
  BEFORE UPDATE OR DELETE ON test_events
  FOR EACH ROW EXECUTE FUNCTION fn_forbid_update_delete();

CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_forbid_update_delete();

CREATE TRIGGER trg_test_attempts_immutable
  BEFORE UPDATE OR DELETE ON test_attempts
  FOR EACH ROW EXECUTE FUNCTION fn_forbid_update_delete();


-- -----------------------------------------------------------------------------
-- 6. MACHINE À ÉTATS DU TEST : transitions autorisées uniquement
--    Protège contre un UPDATE direct qui contournerait le service.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_test_status_transition()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'DRAFT'           AND NEW.status IN ('PAYMENT_PENDING', 'CANCELLED')) OR
    (OLD.status = 'PAYMENT_PENDING' AND NEW.status IN ('FUNDED', 'CANCELLED', 'EXPIRED')) OR
    (OLD.status = 'FUNDED'          AND NEW.status IN ('SENT', 'REFUND_PENDING')) OR
    (OLD.status = 'SENT'            AND NEW.status IN ('SUCCESS', 'FAILURE', 'EXPIRED', 'DISPUTED')) OR
    (OLD.status = 'SUCCESS'         AND NEW.status IN ('PAYOUT_PENDING', 'DISPUTED')) OR
    (OLD.status = 'FAILURE'         AND NEW.status IN ('REFUND_PENDING', 'DISPUTED')) OR
    (OLD.status = 'EXPIRED'         AND NEW.status IN ('REFUND_PENDING', 'DISPUTED')) OR
    (OLD.status = 'PAYOUT_PENDING'  AND NEW.status IN ('COMPLETED', 'DISPUTED')) OR
    (OLD.status = 'REFUND_PENDING'  AND NEW.status IN ('REFUNDED', 'DISPUTED')) OR
    (OLD.status = 'DISPUTED'        AND NEW.status IN ('PAYOUT_PENDING', 'REFUND_PENDING'))
  ) THEN
    RAISE EXCEPTION 'Transition de statut interdite : % -> % (test %)',
      OLD.status, NEW.status, OLD.id USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tests_status_transition
  BEFORE UPDATE OF status ON tests
  FOR EACH ROW EXECUTE FUNCTION fn_test_status_transition();

-- Adapte la liste ci-dessus à ton diagramme d'états final.
-- États terminaux (aucune sortie) : COMPLETED, REFUNDED, CANCELLED.


-- -----------------------------------------------------------------------------
-- 7. DONNÉES DE RÉFÉRENCE (exemple Cameroun) - à adapter
-- -----------------------------------------------------------------------------

-- INSERT INTO countries (code, name, default_currency, min_reward_amount, enabled, updated_at)
-- VALUES ('CM', 'Cameroun', 'XAF', 20000, true, now());

-- INSERT INTO fee_schedules
--   (id, name, country_code, currency, operation_type, fixed_amount, rate_bps,
--    version, effective_from, active)
-- VALUES
--   (gen_random_uuid(), 'Frais de service test CM', 'CM', 'XAF', 'SERVICE', 2500, 0,
--    1, now(), true);


-- -----------------------------------------------------------------------------
-- 8. RÈGLES MÉTIER : récompense, frais conservés en cas d'échec.
-- NOTE : schema.prisma fourni ne contient PAS refund_reason / outcome.
-- On ne les utilise pas ici pour préserver la compatibilité.
-- Cas normal FAILURE/EXPIRED : remboursement EXACT de reward_amount.
-- Cas exceptionnel avant envoi : remboursement total possible uniquement avec
-- contrôle applicatif et autorisation administrative ; ce SQL n'autorise pas
-- automatiquement de remboursement des frais.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_refund_amount_rule()
RETURNS trigger AS $$
DECLARE
  v_reward BIGINT;
  v_currency CHAR(3);
  v_status TEXT;
BEGIN
  SELECT reward_amount, currency, status::text
    INTO v_reward, v_currency, v_status
  FROM tests WHERE id = NEW.test_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test inexistant : %', NEW.test_id USING ERRCODE = '23503';
  END IF;
  IF NEW.currency <> v_currency THEN
    RAISE EXCEPTION 'Devise refund incohérente pour test %', NEW.test_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.amount <> v_reward THEN
    RAISE EXCEPTION 'Refund normal : montant % différent de la récompense % (test %)',
      NEW.amount, v_reward, NEW.test_id USING ERRCODE = '23514';
  END IF;
  IF v_status NOT IN ('FAILURE','EXPIRED','REFUND_PENDING') THEN
    RAISE EXCEPTION 'Refund non autorisé au statut % (test %)', v_status, NEW.test_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_refunds_amount_rule
  BEFORE INSERT OR UPDATE OF amount, currency, test_id ON refunds
  FOR EACH ROW EXECUTE FUNCTION fn_refund_amount_rule();

CREATE OR REPLACE FUNCTION fn_payout_amount_rule()
RETURNS trigger AS $$
DECLARE
  v_reward BIGINT;
  v_currency CHAR(3);
  v_status TEXT;
BEGIN
  SELECT reward_amount, currency, status::text
    INTO v_reward, v_currency, v_status
  FROM tests WHERE id = NEW.test_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test inexistant : %', NEW.test_id USING ERRCODE = '23503';
  END IF;
  IF NEW.amount_gross <> v_reward OR NEW.currency <> v_currency THEN
    RAISE EXCEPTION 'Payout incohérent (montant/devise) pour test %', NEW.test_id
      USING ERRCODE = '23514';
  END IF;
  IF v_status NOT IN ('SUCCESS','PAYOUT_PENDING') THEN
    RAISE EXCEPTION 'Payout non autorisé au statut % (test %)', v_status, NEW.test_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payouts_amount_rule
  BEFORE INSERT OR UPDATE OF amount_gross, currency, test_id ON payouts
  FOR EACH ROW EXECUTE FUNCTION fn_payout_amount_rule();

-- -----------------------------------------------------------------------------
-- 9. GARDES SUPPLÉMENTAIRES
-- -----------------------------------------------------------------------------
ALTER TABLE ledger_transactions
  ADD CONSTRAINT chk_ledger_reversal_not_self
  CHECK (reverses_id IS NULL OR reverses_id <> id);

ALTER TABLE fee_schedules
  ADD CONSTRAINT chk_fee_schedule_period
  CHECK (effective_to IS NULL OR effective_to > effective_from);

ALTER TABLE test_attempts
  ADD CONSTRAINT chk_test_attempt_source_nonempty
  CHECK (length(btrim(source)) > 0);

ALTER TABLE admin_approvals
  ADD CONSTRAINT chk_admin_approver_not_requester
  CHECK (approver_id IS NULL OR approver_id <> requester_id);

-- IMPORTANT : LIMITES ASSUMÉES
-- 1) La reconnaissance des 2 500 XAF de frais n'est pas vérifiable uniquement
--    par ces CHECK : valider fee_schedule et poster SERVICE_FEE_RECOGNITION.
-- 2) Pour les remboursements exceptionnels (paiement erroné, panne, loi),
--    ajouter RefundReason au schéma Prisma et une migration dédiée.
-- 3) Les écritures comptables peuvent encore être ajoutées tardivement à une
--    transaction déjà équilibrée : un statut POSTED/finalizedAt et une politique
--    de clôture immuable nécessitent une évolution du modèle Prisma.
-- 4) Les transactions externes ne sont jamais atomiques avec PostgreSQL :
--    utiliser outbox, idempotence, confirmations PSP et réconciliation.
-- 5) Les CHECK ne vérifient pas l'existence réelle des fonds chez le prestataire.


-- -----------------------------------------------------------------------------
-- 10. INVARIANTS ADDITIONNELS : tarification et champs financiers
-- -----------------------------------------------------------------------------

-- Contrôle le tarif figé et le minimum applicable avant de quitter DRAFT.
-- Le tarif est une configuration métier; pas de valeur XAF codée en dur.
CREATE OR REPLACE FUNCTION fn_test_financial_terms()
RETURNS trigger AS $$
DECLARE
  v_country CHAR(2);
  v_min BIGINT;
  v_fee BIGINT;
  v_rate INT;
  v_fee_currency CHAR(3);
  v_fee_country CHAR(2);
  v_fee_operation TEXT;
  v_effective_from TIMESTAMPTZ;
  v_effective_to TIMESTAMPTZ;
  v_expected_fee NUMERIC;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status::text NOT IN ('DRAFT','PAYMENT_PENDING') THEN
    IF (NEW.reward_amount, NEW.service_fee_amount, NEW.total_amount, NEW.currency,
        NEW.fee_schedule_id, NEW.initiator_id)
       IS DISTINCT FROM
       (OLD.reward_amount, OLD.service_fee_amount, OLD.total_amount, OLD.currency,
        OLD.fee_schedule_id, OLD.initiator_id) THEN
      RAISE EXCEPTION 'Montants et conditions financières figés après financement'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Les brouillons peuvent être incomplets côté configuration.
  IF NEW.status::text = 'DRAFT' THEN
    RETURN NEW;
  END IF;

  SELECT country_code INTO v_country FROM users WHERE id = NEW.initiator_id;
  SELECT min_reward_amount INTO v_min FROM countries WHERE code = v_country;
  IF v_min IS NULL OR NEW.reward_amount < v_min THEN
    RAISE EXCEPTION 'Récompense inférieure au minimum du pays ou pays non configuré'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.fee_schedule_id IS NULL THEN
    RAISE EXCEPTION 'Grille de frais obligatoire hors brouillon'
      USING ERRCODE = '23514';
  END IF;

  SELECT fixed_amount, rate_bps, currency, country_code, operation_type::text,
         effective_from, effective_to
    INTO v_fee, v_rate, v_fee_currency, v_fee_country, v_fee_operation,
         v_effective_from, v_effective_to
  FROM fee_schedules WHERE id = NEW.fee_schedule_id;
  IF NOT FOUND OR v_fee_operation <> 'SERVICE'
     OR v_fee_currency <> NEW.currency OR v_fee_country <> v_country THEN
    RAISE EXCEPTION 'Grille de frais incompatible avec le test'
      USING ERRCODE = '23514';
  END IF;
  -- Le tarif est contrôlé au passage hors DRAFT, puis figé.
  IF TG_OP = 'INSERT' OR OLD.status::text = 'DRAFT' THEN
    IF v_effective_from > now() OR (v_effective_to IS NOT NULL AND v_effective_to <= now()) THEN
      RAISE EXCEPTION 'Grille de frais hors période de validité'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  v_expected_fee := v_fee + ceil(NEW.reward_amount::numeric * v_rate / 10000);
  IF NEW.service_fee_amount <> v_expected_fee THEN
    RAISE EXCEPTION 'Frais appliqués % différents du tarif %', NEW.service_fee_amount, v_expected_fee
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tests_financial_terms
  BEFORE INSERT OR UPDATE OF status, reward_amount, service_fee_amount,
    total_amount, currency, fee_schedule_id, initiator_id
  ON tests FOR EACH ROW EXECUTE FUNCTION fn_test_financial_terms();

-- Interdit de changer les montants d'une opération déjà confirmée.
CREATE OR REPLACE FUNCTION fn_settled_transfer_immutable()
RETURNS trigger AS $$
BEGIN
  IF OLD.status::text = 'SUCCEEDED' AND
     (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'Transfert confirmé immuable (%)', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payouts_settled_immutable
  BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION fn_settled_transfer_immutable();
CREATE TRIGGER trg_refunds_settled_immutable
  BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION fn_settled_transfer_immutable();

-- Attention : les écritures tardives sur une transaction ledger existante
-- nécessitent encore une finalisation explicite dans le modèle Prisma.
-- Cette migration ne prétend pas résoudre ce point sans évolution de schéma.
