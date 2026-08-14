-- A submission lease makes a crash between claiming a refund and calling the
-- provider recoverable. Replays keep the same provider_refund_no.
ALTER TABLE refunds
  ADD COLUMN submission_lease_until DATETIME(3) NULL AFTER amount_cents,
  ADD INDEX idx_refunds_recovery (status, submission_lease_until, updated_at, id);
