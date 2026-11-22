CREATE UNIQUE INDEX "refunds_one_active_or_completed_per_test"
ON public.refunds (test_id)
WHERE status IN (
    'CREATED',
    'PENDING',
    'SUCCEEDED',
    'REQUIRES_REVIEW'
);
