ALTER TABLE orders
  ADD COLUMN expires_at DATETIME(3) NULL AFTER paid_at,
  ADD INDEX idx_orders_status_expiry (status, expires_at);

UPDATE orders SET expires_at = DATE_ADD(created_at, INTERVAL 15 MINUTE) WHERE expires_at IS NULL;

ALTER TABLE orders MODIFY expires_at DATETIME(3) NOT NULL;
