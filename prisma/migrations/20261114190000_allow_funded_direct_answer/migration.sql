-- Autorise une réponse directe à un test financé.
-- Conserve toutes les autres transitions existantes.
-- Ne modifie ni les montants ni les protections financières.

CREATE OR REPLACE FUNCTION fn_test_status_transition()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'DRAFT'           AND NEW.status IN ('PAYMENT_PENDING', 'CANCELLED')) OR
    (OLD.status = 'PAYMENT_PENDING' AND NEW.status IN ('FUNDED', 'CANCELLED', 'EXPIRED')) OR
    (OLD.status = 'FUNDED'          AND NEW.status IN ('SENT', 'SUCCESS', 'FAILURE', 'REFUND_PENDING')) OR
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
