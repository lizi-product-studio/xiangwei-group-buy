-- A claim token fences out a worker that finishes after another worker has
-- reclaimed an expired notification-delivery lease.
ALTER TABLE order_notifications
  ADD COLUMN delivery_claim_token CHAR(36) NULL AFTER delivery_lease_until;
