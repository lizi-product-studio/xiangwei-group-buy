-- A provider-side payment initiation is an external side effect. Persist the
-- lease before the request and fence completion with a token so duplicate taps
-- and overlapping workers cannot create multiple payment requests.
ALTER TABLE payments
  ADD COLUMN initiation_lease_until DATETIME(3) NULL AFTER provider_context,
  ADD COLUMN initiation_claim_token CHAR(36) NULL AFTER initiation_lease_until,
  ADD INDEX idx_payments_initiation_lease (initiation_lease_until);
