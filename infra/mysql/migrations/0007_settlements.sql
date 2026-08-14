CREATE TABLE settlements (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  payment_id CHAR(36) NOT NULL,
  merchant_order_id CHAR(36) NOT NULL,
  out_order_no VARCHAR(64) NOT NULL,
  provider_order_id VARCHAR(64) NULL,
  status ENUM('CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED') NOT NULL,
  commission_cents BIGINT UNSIGNED NOT NULL,
  merchant_receivable_cents BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_settlements_payment_merchant_order (payment_id, merchant_order_id),
  UNIQUE KEY uk_settlements_out_order_no (out_order_no),
  INDEX idx_settlements_status_updated (status, updated_at),
  CONSTRAINT fk_settlements_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_settlements_payment FOREIGN KEY (payment_id) REFERENCES payments(id),
  CONSTRAINT fk_settlements_merchant_order FOREIGN KEY (merchant_order_id) REFERENCES merchant_orders(id)
) ENGINE=InnoDB;
