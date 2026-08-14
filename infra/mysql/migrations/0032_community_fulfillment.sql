-- Lightweight Mode B community fulfilment. This migration is intentionally
-- additive: marketplace and previous platform-procurement records stay intact.

ALTER TABLE campaigns
  MODIFY COLUMN business_model_version ENUM('LEGACY_MARKETPLACE','PLATFORM_PROCUREMENT','PLATFORM_COMMUNITY') NOT NULL DEFAULT 'LEGACY_MARKETPLACE';

ALTER TABLE orders
  MODIFY COLUMN business_model_version ENUM('LEGACY_MARKETPLACE','PLATFORM_PROCUREMENT','PLATFORM_COMMUNITY') NOT NULL DEFAULT 'LEGACY_MARKETPLACE';

ALTER TABLE platform_skus
  ADD COLUMN default_sellable_quantity INT UNSIGNED NOT NULL DEFAULT 0 AFTER retail_price_cents,
  ADD COLUMN reference_purchase_cost_cents BIGINT UNSIGNED NULL AFTER default_sellable_quantity,
  ADD COLUMN supplier_note VARCHAR(500) NULL AFTER reference_purchase_cost_cents;

ALTER TABLE campaign_delivery_plans
  ADD COLUMN logistics_platform VARCHAR(80) NULL AFTER vehicle_plate,
  ADD COLUMN estimated_arrival_at DATETIME(3) NULL AFTER logistics_platform;

CREATE TABLE community_campaign_items (
  campaign_id CHAR(36) NOT NULL,
  platform_sku_id CHAR(36) NOT NULL,
  sellable_quantity INT UNSIGNED NOT NULL,
  reserved_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  retail_price_cents BIGINT UNSIGNED NOT NULL,
  catalog_snapshot JSON NOT NULL,
  PRIMARY KEY (campaign_id, platform_sku_id),
  CONSTRAINT fk_community_campaign_item_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_community_campaign_item_sku FOREIGN KEY (platform_sku_id) REFERENCES platform_skus(id),
  CONSTRAINT chk_community_campaign_item_reserved CHECK (reserved_quantity <= sellable_quantity)
) ENGINE=InnoDB;

CREATE TABLE community_delivery_confirmations (
  id CHAR(36) PRIMARY KEY,
  dispatch_batch_id CHAR(36) NOT NULL,
  campaign_id CHAR(36) NOT NULL,
  delivery_plan_id CHAR(36) NOT NULL,
  status ENUM('COMPLETED','EXCEPTION') NOT NULL,
  confirmed_by CHAR(36) NOT NULL,
  received_by VARCHAR(120) NOT NULL,
  confirmation_note VARCHAR(500) NULL,
  confirmed_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_community_delivery_batch (dispatch_batch_id),
  INDEX idx_community_delivery_plan (delivery_plan_id, confirmed_at),
  CONSTRAINT fk_community_delivery_batch FOREIGN KEY (dispatch_batch_id) REFERENCES dispatch_batches(id),
  CONSTRAINT fk_community_delivery_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_community_delivery_plan FOREIGN KEY (delivery_plan_id) REFERENCES campaign_delivery_plans(id)
) ENGINE=InnoDB;

CREATE TABLE community_delivery_items (
  id CHAR(36) PRIMARY KEY,
  community_delivery_id CHAR(36) NOT NULL,
  platform_sku_id CHAR(36) NOT NULL,
  expected_quantity INT UNSIGNED NOT NULL,
  received_quantity INT UNSIGNED NOT NULL,
  rejected_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  short_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  damaged_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  exception_reason VARCHAR(64) NULL,
  evidence_note VARCHAR(500) NULL,
  evidence_url VARCHAR(2048) NULL,
  UNIQUE KEY uk_community_delivery_item_sku (community_delivery_id, platform_sku_id),
  CONSTRAINT fk_community_delivery_item_confirmation FOREIGN KEY (community_delivery_id) REFERENCES community_delivery_confirmations(id),
  CONSTRAINT fk_community_delivery_item_sku FOREIGN KEY (platform_sku_id) REFERENCES platform_skus(id),
  CONSTRAINT chk_community_delivery_item_total CHECK (received_quantity + rejected_quantity + short_quantity + damaged_quantity = expected_quantity)
) ENGINE=InnoDB;

ALTER TABLE sales_order_items
  ADD COLUMN picked_up_quantity INT UNSIGNED NOT NULL DEFAULT 0 AFTER fulfilled_quantity,
  ADD CONSTRAINT chk_sales_order_item_picked_up CHECK (picked_up_quantity <= fulfilled_quantity);

CREATE TABLE community_pickup_receipts (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  delivery_plan_id CHAR(36) NOT NULL,
  verifier_id CHAR(36) NOT NULL,
  request_key CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_community_pickup_receipt_request (order_id, request_key),
  INDEX idx_community_pickup_receipt_order (order_id, created_at),
  CONSTRAINT fk_community_pickup_receipt_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_community_pickup_receipt_plan FOREIGN KEY (delivery_plan_id) REFERENCES campaign_delivery_plans(id)
) ENGINE=InnoDB;

CREATE TABLE community_pickup_receipt_items (
  id CHAR(36) PRIMARY KEY,
  community_pickup_receipt_id CHAR(36) NOT NULL,
  platform_sku_id CHAR(36) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  UNIQUE KEY uk_community_pickup_receipt_item_sku (community_pickup_receipt_id, platform_sku_id),
  CONSTRAINT fk_community_pickup_receipt_item_receipt FOREIGN KEY (community_pickup_receipt_id) REFERENCES community_pickup_receipts(id),
  CONSTRAINT fk_community_pickup_receipt_item_sku FOREIGN KEY (platform_sku_id) REFERENCES platform_skus(id),
  CONSTRAINT chk_community_pickup_receipt_item_quantity CHECK (quantity > 0)
) ENGINE=InnoDB;
