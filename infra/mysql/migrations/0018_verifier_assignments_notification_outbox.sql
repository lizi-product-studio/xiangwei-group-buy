-- Immutable grant/revoke history makes point-scoped verifier access auditable.
CREATE TABLE pickup_verifier_assignment_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  pickup_point_id CHAR(36) NOT NULL,
  action ENUM('GRANTED','REVOKED') NOT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_verifier_assignment_lookup (user_id, pickup_point_id, id DESC),
  CONSTRAINT fk_verifier_assignment_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_verifier_assignment_point FOREIGN KEY (pickup_point_id) REFERENCES pickup_points(id)
) ENGINE=InnoDB;

-- Existing notification rows are retained. New queue columns provide leasing,
-- bounded retry and failure evidence for an independent delivery worker.
ALTER TABLE order_notifications
  ADD COLUMN delivery_attempts INT UNSIGNED NOT NULL DEFAULT 0 AFTER manual_completed_at,
  ADD COLUMN next_attempt_at DATETIME(3) NULL AFTER delivery_attempts,
  ADD COLUMN delivery_lease_until DATETIME(3) NULL AFTER next_attempt_at,
  ADD COLUMN last_delivery_error VARCHAR(500) NULL AFTER delivery_lease_until,
  ADD COLUMN delivered_at DATETIME(3) NULL AFTER last_delivery_error,
  ADD INDEX idx_order_notification_pending_delivery (status, next_attempt_at, delivery_lease_until, created_at);

UPDATE order_notifications
SET next_attempt_at = created_at
WHERE status = 'PENDING_DELIVERY' AND next_attempt_at IS NULL;
