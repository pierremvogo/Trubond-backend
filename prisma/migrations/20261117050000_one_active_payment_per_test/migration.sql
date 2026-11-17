CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_active_per_test
ON payments (test_id)
WHERE status IN (
  'CREATED',
  'PENDING',
  'SUCCEEDED',
  'REQUIRES_REVIEW'
);
