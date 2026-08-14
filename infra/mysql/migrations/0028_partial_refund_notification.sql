-- Extend the existing durable outbox; historical notification rows are unchanged.
ALTER TABLE order_notifications
  MODIFY COLUMN type ENUM('SITE_CONFIRMED','VEHICLE_DISPATCHED','ARRIVED','PARTIAL_REFUND') NOT NULL;
