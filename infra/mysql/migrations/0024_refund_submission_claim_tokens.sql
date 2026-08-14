-- Fence overlapping refund submitters after a crashed worker's lease expires.
-- A provider response may update the row only when it still owns this token.
ALTER TABLE refunds
  ADD COLUMN submission_claim_token CHAR(36) NULL AFTER submission_lease_until;

-- Rows created before submission leases existed have an unknown provider
-- outcome. Mark them as immediately recoverable so the worker queries first.
UPDATE refunds
  SET submission_lease_until = UTC_TIMESTAMP(3)
  WHERE status = 'PROCESSING' AND submission_lease_until IS NULL;
