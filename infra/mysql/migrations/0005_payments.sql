-- Payment state is separate from order state. Provider callbacks are retained for idempotency and audit.
ALTER TABLE merchants
  ADD COLUMN wechat_sub_mchid VARCHAR(10) NULL AFTER default_commission_bps,
  ADD UNIQUE KEY uk_merchants_wechat_sub_mchid (wechat_sub_mchid);

CREATE TABLE payments (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  provider ENUM('mock', 'wechat-platform') NOT NULL,
  provider_payment_id VARCHAR(64) NULL,
  status ENUM('CREATED', 'SUCCEEDED', 'REFUNDING', 'REFUNDED', 'FAILED') NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  client_payload JSON NULL,
  provider_context JSON NULL,
  succeeded_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_payments_order (order_id),
  UNIQUE KEY uk_payments_provider_id (provider, provider_payment_id),
  INDEX idx_payments_status_created (status, created_at),
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB;

CREATE TABLE refunds (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  payment_id CHAR(36) NOT NULL,
  merchant_order_id CHAR(36) NOT NULL,
  provider_refund_no VARCHAR(64) NOT NULL,
  provider_refund_id VARCHAR(64) NULL,
  status ENUM('CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED') NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_refunds_payment_merchant_order (payment_id, merchant_order_id),
  UNIQUE KEY uk_refunds_provider_no (provider_refund_no),
  INDEX idx_refunds_status_created (status, created_at),
  CONSTRAINT fk_refunds_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES payments(id),
  CONSTRAINT fk_refunds_merchant_order FOREIGN KEY (merchant_order_id) REFERENCES merchant_orders(id)
) ENGINE=InnoDB;

CREATE TABLE payment_callbacks (
  provider ENUM('mock', 'wechat-platform') NOT NULL,
  event_id VARCHAR(64) NOT NULL,
  callback_type VARCHAR(64) NOT NULL,
  body_sha256 CHAR(64) NOT NULL,
  processed_at DATETIME(3) NOT NULL,
  PRIMARY KEY (provider, event_id)
) ENGINE=InnoDB;
