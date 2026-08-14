-- Mode-B discrepancy / partial-refund closure. This migration is additive: legacy
-- marketplace payments, refunds, settlements and records are never rewritten.

ALTER TABLE sales_order_items
  ADD COLUMN fulfilled_quantity INT UNSIGNED NOT NULL DEFAULT 0 AFTER quantity,
  ADD COLUMN exception_quantity INT UNSIGNED NOT NULL DEFAULT 0 AFTER fulfilled_quantity,
  ADD COLUMN refunded_quantity INT UNSIGNED NOT NULL DEFAULT 0 AFTER exception_quantity,
  ADD COLUMN refunded_amount_cents BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER amount_cents,
  ADD CONSTRAINT chk_sales_order_item_fulfilment_total CHECK (fulfilled_quantity + exception_quantity <= quantity),
  ADD CONSTRAINT chk_sales_order_item_refund_quantity CHECK (refunded_quantity <= exception_quantity),
  ADD CONSTRAINT chk_sales_order_item_refund_amount CHECK (refunded_amount_cents <= amount_cents);

-- Orders already handed over by 0026's all-or-nothing path remain fully fulfilled.
UPDATE sales_order_items soi
JOIN orders o ON o.id=soi.order_id
SET soi.fulfilled_quantity=soi.quantity
WHERE o.business_model_version='PLATFORM_PROCUREMENT'
  AND o.status IN ('READY_FOR_PICKUP','PICKED_UP','COMPLETED');

ALTER TABLE pickup_handover_items
  ADD COLUMN rejected_quantity INT UNSIGNED NOT NULL DEFAULT 0 AFTER received_quantity,
  ADD COLUMN short_quantity INT UNSIGNED NOT NULL DEFAULT 0 AFTER rejected_quantity,
  ADD COLUMN damaged_quantity INT UNSIGNED NOT NULL DEFAULT 0 AFTER short_quantity,
  ADD COLUMN exception_reason VARCHAR(40) NULL AFTER damaged_quantity,
  ADD COLUMN evidence_note VARCHAR(500) NULL AFTER exception_reason,
  ADD CONSTRAINT chk_pickup_handover_item_total CHECK (received_quantity + rejected_quantity + short_quantity + damaged_quantity = expected_quantity);

CREATE TABLE fulfillment_exceptions (
  id CHAR(36) PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  order_id CHAR(36) NULL,
  outbound_order_id CHAR(36) NULL,
  delivery_plan_id CHAR(36) NULL,
  source_stage ENUM('SUPPLIER_RECEIPT','WAREHOUSE','TRANSIT','PICKUP_HANDOVER','CUSTOMER_CLAIM') NOT NULL,
  status ENUM('REGISTERED','WAITING_REPLENISHMENT','TRANSFER_PENDING','REFUND_CONFIRMED','REFUND_PROCESSING','RESOLVED') NOT NULL,
  responsibility ENUM('SUPPLIER','WAREHOUSE','CARRIER','PICKUP_POINT','PLATFORM','PENDING') NOT NULL,
  registered_by CHAR(36) NOT NULL,
  confirmed_by CHAR(36) NULL,
  resolution_note VARCHAR(500) NULL,
  registered_at DATETIME(3) NOT NULL,
  confirmed_at DATETIME(3) NULL,
  UNIQUE KEY uk_fulfillment_exception_outbound (outbound_order_id),
  INDEX idx_fulfillment_exception_work (status, registered_at, id),
  INDEX idx_fulfillment_exception_campaign (campaign_id, registered_at),
  CONSTRAINT fk_fulfillment_exception_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_fulfillment_exception_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_fulfillment_exception_outbound FOREIGN KEY (outbound_order_id) REFERENCES outbound_orders(id),
  CONSTRAINT fk_fulfillment_exception_plan FOREIGN KEY (delivery_plan_id) REFERENCES campaign_delivery_plans(id)
) ENGINE=InnoDB;

CREATE TABLE fulfillment_exception_items (
  id CHAR(36) PRIMARY KEY,
  exception_id CHAR(36) NOT NULL,
  platform_sku_id CHAR(36) NOT NULL,
  expected_quantity INT UNSIGNED NOT NULL,
  accepted_quantity INT UNSIGNED NOT NULL,
  rejected_quantity INT UNSIGNED NOT NULL,
  short_quantity INT UNSIGNED NOT NULL,
  damaged_quantity INT UNSIGNED NOT NULL,
  reason VARCHAR(40) NOT NULL,
  description VARCHAR(500) NOT NULL,
  evidence_url VARCHAR(2048) NULL,
  UNIQUE KEY uk_fulfillment_exception_item_sku (exception_id, platform_sku_id),
  CONSTRAINT fk_fulfillment_exception_item_parent FOREIGN KEY (exception_id) REFERENCES fulfillment_exceptions(id),
  CONSTRAINT fk_fulfillment_exception_item_sku FOREIGN KEY (platform_sku_id) REFERENCES platform_skus(id),
  CONSTRAINT chk_fulfillment_exception_item_total CHECK (accepted_quantity + rejected_quantity + short_quantity + damaged_quantity = expected_quantity)
) ENGINE=InnoDB;

CREATE TABLE fulfillment_allocations (
  id CHAR(36) PRIMARY KEY,
  exception_id CHAR(36) NOT NULL,
  exception_item_id CHAR(36) NOT NULL,
  sales_order_item_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  platform_sku_id CHAR(36) NOT NULL,
  fulfilled_quantity INT UNSIGNED NOT NULL,
  exception_quantity INT UNSIGNED NOT NULL,
  refunded_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  refunded_at DATETIME(3) NULL,
  UNIQUE KEY uk_fulfillment_allocation_item_line (exception_item_id, sales_order_item_id),
  INDEX idx_fulfillment_allocation_order (order_id, created_at),
  CONSTRAINT fk_fulfillment_allocation_exception FOREIGN KEY (exception_id) REFERENCES fulfillment_exceptions(id),
  CONSTRAINT fk_fulfillment_allocation_exception_item FOREIGN KEY (exception_item_id) REFERENCES fulfillment_exception_items(id),
  CONSTRAINT fk_fulfillment_allocation_sales_line FOREIGN KEY (sales_order_item_id) REFERENCES sales_order_items(id),
  CONSTRAINT fk_fulfillment_allocation_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_fulfillment_allocation_sku FOREIGN KEY (platform_sku_id) REFERENCES platform_skus(id),
  CONSTRAINT chk_fulfillment_allocation_refund CHECK (refunded_quantity <= exception_quantity)
) ENGINE=InnoDB;

CREATE TABLE platform_partial_refunds (
  id CHAR(36) PRIMARY KEY,
  exception_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  payment_id CHAR(36) NOT NULL,
  provider_refund_no VARCHAR(64) NOT NULL,
  provider_refund_id VARCHAR(64) NULL,
  status ENUM('CREATED','PROCESSING','SUCCEEDED','FAILED') NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  submission_lease_until DATETIME(3) NULL,
  submission_claim_token CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_platform_partial_refund_exception_order (exception_id, order_id),
  UNIQUE KEY uk_platform_partial_refund_provider_no (provider_refund_no),
  INDEX idx_platform_partial_refund_status_updated (status, updated_at, id),
  INDEX idx_platform_partial_refund_order (order_id, created_at),
  CONSTRAINT fk_platform_partial_refund_exception FOREIGN KEY (exception_id) REFERENCES fulfillment_exceptions(id),
  CONSTRAINT fk_platform_partial_refund_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_platform_partial_refund_payment FOREIGN KEY (payment_id) REFERENCES payments(id),
  CONSTRAINT chk_platform_partial_refund_amount CHECK (amount_cents > 0)
) ENGINE=InnoDB;

ALTER TABLE inventory_movements
  MODIFY COLUMN movement_type ENUM('RECEIPT','SORT_RESERVED','SORT_COMPLETED','OUTBOUND','HANDOVER','ADJUSTMENT','LOSS','QUARANTINE') NOT NULL,
  MODIFY COLUMN from_bucket ENUM('QUALIFIED','RESERVED','SORTED','OUTBOUND','HANDED_OVER','REJECTED','QUARANTINE') NULL,
  MODIFY COLUMN to_bucket ENUM('QUALIFIED','RESERVED','SORTED','OUTBOUND','HANDED_OVER','REJECTED','QUARANTINE') NULL;
