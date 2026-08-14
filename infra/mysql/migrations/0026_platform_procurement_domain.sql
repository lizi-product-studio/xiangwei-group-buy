-- Mode B is additive and intentionally does not touch legacy marketplace rows.
-- Existing merchant_orders, refunds, settlements and ledger entries remain their
-- own historical accounting model. New platform-sales records never reference
-- a merchant order or a sub-merchant payment account.

ALTER TABLE campaigns
  ADD COLUMN business_model_version ENUM('LEGACY_MARKETPLACE','PLATFORM_PROCUREMENT') NOT NULL DEFAULT 'LEGACY_MARKETPLACE' AFTER failure_action,
  ADD COLUMN warehouse_id CHAR(36) NULL AFTER business_model_version,
  ADD INDEX idx_campaigns_business_model_status (business_model_version, status, cutoff_at);

ALTER TABLE orders
  ADD COLUMN business_model_version ENUM('LEGACY_MARKETPLACE','PLATFORM_PROCUREMENT') NOT NULL DEFAULT 'LEGACY_MARKETPLACE' AFTER delivery_plan_id,
  ADD COLUMN payment_route ENUM('LEGACY_COMBINE','PLATFORM_DIRECT') NOT NULL DEFAULT 'LEGACY_COMBINE' AFTER business_model_version,
  ADD INDEX idx_orders_business_model_status (business_model_version, status, created_at);

ALTER TABLE payments
  ADD COLUMN payment_route ENUM('LEGACY_COMBINE','PLATFORM_DIRECT') NOT NULL DEFAULT 'LEGACY_COMBINE' AFTER provider,
  ADD INDEX idx_payments_route_status (payment_route, status, created_at);

ALTER TABLE pickup_points
  ADD COLUMN operation_mode ENUM('SELF_OPERATED','PARTNER_OPERATED','TEMPORARY_SELF_OPERATED','LEASED_SITE') NOT NULL DEFAULT 'SELF_OPERATED' AFTER capacity_per_day,
  ADD COLUMN responsibility_owner VARCHAR(120) NULL AFTER operation_mode,
  ADD COLUMN site_lead_name VARCHAR(80) NULL AFTER responsibility_owner,
  ADD COLUMN site_lead_phone VARCHAR(32) NULL AFTER site_lead_name;

CREATE TABLE warehouses (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  address VARCHAR(255) NOT NULL,
  status ENUM('ACTIVE','SUSPENDED') NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE suppliers (
  id CHAR(36) PRIMARY KEY,
  legacy_merchant_id CHAR(36) NULL,
  name VARCHAR(120) NOT NULL,
  status ENUM('DRAFT','ACTIVE','SUSPENDED') NOT NULL,
  contact_name VARCHAR(80) NULL,
  contact_phone VARCHAR(32) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_suppliers_legacy_merchant (legacy_merchant_id),
  INDEX idx_suppliers_status_created (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE supplier_qualifications (
  id CHAR(36) PRIMARY KEY,
  supplier_id CHAR(36) NOT NULL,
  qualification_type VARCHAR(64) NOT NULL,
  qualification_no VARCHAR(120) NULL,
  expires_at DATETIME(3) NULL,
  status ENUM('PENDING','APPROVED','REJECTED','EXPIRED') NOT NULL,
  evidence_summary VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_supplier_qualification_status (supplier_id, status),
  CONSTRAINT fk_supplier_qualification_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
) ENGINE=InnoDB;

CREATE TABLE platform_products (
  id CHAR(36) PRIMARY KEY,
  legacy_product_id CHAR(36) NULL,
  title VARCHAR(160) NOT NULL,
  category VARCHAR(40) NOT NULL,
  origin VARCHAR(160) NOT NULL,
  image_url VARCHAR(2048) NULL,
  storage_type ENUM('NORMAL_TEMPERATURE') NOT NULL,
  status ENUM('DRAFT','ACTIVE','OFF_SHELF') NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_platform_products_legacy_product (legacy_product_id),
  INDEX idx_platform_products_status (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE platform_skus (
  id CHAR(36) PRIMARY KEY,
  product_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  retail_price_cents BIGINT UNSIGNED NOT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_platform_skus_product_status (product_id, status),
  CONSTRAINT fk_platform_skus_product FOREIGN KEY (product_id) REFERENCES platform_products(id)
) ENGINE=InnoDB;

CREATE TABLE supplier_sku_offers (
  id CHAR(36) PRIMARY KEY,
  supplier_id CHAR(36) NOT NULL,
  platform_sku_id CHAR(36) NOT NULL,
  purchase_price_cents BIGINT UNSIGNED NULL,
  minimum_purchase_quantity INT UNSIGNED NOT NULL DEFAULT 1,
  lead_time_days INT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('DRAFT','ACTIVE','SUSPENDED') NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_supplier_sku_offer (supplier_id, platform_sku_id),
  INDEX idx_supplier_offer_sku_status (platform_sku_id, status),
  CONSTRAINT fk_supplier_offer_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_supplier_offer_sku FOREIGN KEY (platform_sku_id) REFERENCES platform_skus(id),
  CONSTRAINT chk_supplier_offer_minimum CHECK (minimum_purchase_quantity > 0)
) ENGINE=InnoDB;

CREATE TABLE campaign_platform_skus (
  campaign_id CHAR(36) NOT NULL,
  platform_sku_id CHAR(36) NOT NULL,
  supplier_offer_id CHAR(36) NOT NULL,
  sellable_quantity INT UNSIGNED NOT NULL,
  reserved_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  retail_price_cents BIGINT UNSIGNED NOT NULL,
  purchase_price_cents BIGINT UNSIGNED NOT NULL,
  catalog_snapshot JSON NOT NULL,
  PRIMARY KEY (campaign_id, platform_sku_id),
  INDEX idx_campaign_platform_sku_offer (supplier_offer_id),
  CONSTRAINT fk_campaign_platform_skus_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_campaign_platform_skus_sku FOREIGN KEY (platform_sku_id) REFERENCES platform_skus(id),
  CONSTRAINT fk_campaign_platform_skus_offer FOREIGN KEY (supplier_offer_id) REFERENCES supplier_sku_offers(id),
  CONSTRAINT chk_campaign_platform_sku_quantity CHECK (reserved_quantity <= sellable_quantity)
) ENGINE=InnoDB;

CREATE TABLE sales_order_items (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  platform_sku_id CHAR(36) NOT NULL,
  product_snapshot JSON NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price_cents BIGINT UNSIGNED NOT NULL,
  purchase_unit_cents BIGINT UNSIGNED NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  INDEX idx_sales_order_items_order (order_id),
  CONSTRAINT fk_sales_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_sales_order_items_sku FOREIGN KEY (platform_sku_id) REFERENCES platform_skus(id),
  CONSTRAINT chk_sales_order_item_amount CHECK (amount_cents = unit_price_cents * quantity)
) ENGINE=InnoDB;

CREATE TABLE purchase_orders (
  id CHAR(36) PRIMARY KEY,
  purchase_no VARCHAR(64) NOT NULL,
  campaign_id CHAR(36) NOT NULL,
  supplier_id CHAR(36) NOT NULL,
  warehouse_id CHAR(36) NOT NULL,
  status ENUM('DRAFT','ORDERED','RECEIVING','RECEIVED','CANCELLED') NOT NULL,
  planned_arrival_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_purchase_order_campaign_supplier (campaign_id, supplier_id),
  UNIQUE KEY uk_purchase_order_no (purchase_no),
  INDEX idx_purchase_orders_status_arrival (status, planned_arrival_at),
  CONSTRAINT fk_purchase_order_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_purchase_order_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_purchase_order_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
) ENGINE=InnoDB;

CREATE TABLE purchase_order_items (
  id CHAR(36) PRIMARY KEY,
  purchase_order_id CHAR(36) NOT NULL,
  platform_sku_id CHAR(36) NOT NULL,
  supplier_offer_id CHAR(36) NOT NULL,
  planned_quantity INT UNSIGNED NOT NULL,
  purchase_unit_cents BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_purchase_order_item_sku (purchase_order_id, platform_sku_id),
  CONSTRAINT fk_purchase_order_item_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
  CONSTRAINT fk_purchase_order_item_sku FOREIGN KEY (platform_sku_id) REFERENCES platform_skus(id),
  CONSTRAINT fk_purchase_order_item_offer FOREIGN KEY (supplier_offer_id) REFERENCES supplier_sku_offers(id)
) ENGINE=InnoDB;

CREATE TABLE goods_receipts (
  id CHAR(36) PRIMARY KEY,
  receipt_no VARCHAR(64) NOT NULL,
  purchase_order_id CHAR(36) NOT NULL,
  warehouse_id CHAR(36) NOT NULL,
  status ENUM('DRAFT','COMPLETED','EXCEPTION') NOT NULL,
  received_by CHAR(36) NOT NULL,
  inspected_by CHAR(36) NOT NULL,
  received_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_goods_receipt_purchase_order (purchase_order_id),
  UNIQUE KEY uk_goods_receipt_no (receipt_no),
  CONSTRAINT fk_goods_receipt_purchase_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
  CONSTRAINT fk_goods_receipt_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
) ENGINE=InnoDB;

CREATE TABLE goods_receipt_items (
  id CHAR(36) PRIMARY KEY,
  goods_receipt_id CHAR(36) NOT NULL,
  purchase_order_item_id CHAR(36) NOT NULL,
  accepted_quantity INT UNSIGNED NOT NULL,
  rejected_quantity INT UNSIGNED NOT NULL,
  batch_no VARCHAR(100) NULL,
  production_date DATE NULL,
  expires_at DATE NULL,
  quality_result ENUM('ACCEPTED','PARTIALLY_ACCEPTED','REJECTED') NOT NULL,
  inspection_note VARCHAR(500) NULL,
  UNIQUE KEY uk_goods_receipt_item_purchase_item (goods_receipt_id, purchase_order_item_id),
  CONSTRAINT fk_goods_receipt_item_receipt FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipts(id),
  CONSTRAINT fk_goods_receipt_item_purchase_item FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id),
  CONSTRAINT chk_goods_receipt_item_total CHECK (accepted_quantity + rejected_quantity > 0)
) ENGINE=InnoDB;

CREATE TABLE inventory_lots (
  id CHAR(36) PRIMARY KEY,
  warehouse_id CHAR(36) NOT NULL,
  platform_sku_id CHAR(36) NOT NULL,
  supplier_id CHAR(36) NOT NULL,
  goods_receipt_item_id CHAR(36) NOT NULL,
  lot_no VARCHAR(100) NOT NULL,
  production_date DATE NULL,
  expires_at DATE NULL,
  qualified_quantity INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_inventory_lot_receipt_item (goods_receipt_item_id),
  INDEX idx_inventory_lot_available (warehouse_id, platform_sku_id, expires_at),
  CONSTRAINT fk_inventory_lot_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_inventory_lot_sku FOREIGN KEY (platform_sku_id) REFERENCES platform_skus(id),
  CONSTRAINT fk_inventory_lot_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_inventory_lot_receipt_item FOREIGN KEY (goods_receipt_item_id) REFERENCES goods_receipt_items(id)
) ENGINE=InnoDB;

CREATE TABLE inventory_movements (
  id CHAR(36) PRIMARY KEY,
  inventory_lot_id CHAR(36) NOT NULL,
  movement_type ENUM('RECEIPT','SORT_RESERVED','SORT_COMPLETED','OUTBOUND','HANDOVER','ADJUSTMENT','LOSS') NOT NULL,
  from_bucket ENUM('QUALIFIED','RESERVED','SORTED','OUTBOUND','HANDED_OVER','REJECTED') NULL,
  to_bucket ENUM('QUALIFIED','RESERVED','SORTED','OUTBOUND','HANDED_OVER','REJECTED') NULL,
  quantity INT UNSIGNED NOT NULL,
  reference_type VARCHAR(64) NOT NULL,
  reference_id CHAR(36) NOT NULL,
  actor_id CHAR(36) NOT NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_inventory_movement_lot_created (inventory_lot_id, created_at, id),
  INDEX idx_inventory_movement_reference (reference_type, reference_id),
  CONSTRAINT fk_inventory_movement_lot FOREIGN KEY (inventory_lot_id) REFERENCES inventory_lots(id),
  CONSTRAINT chk_inventory_movement_bucket CHECK (from_bucket IS NOT NULL OR to_bucket IS NOT NULL),
  CONSTRAINT chk_inventory_movement_quantity CHECK (quantity > 0)
) ENGINE=InnoDB;

CREATE TABLE supplier_payables (
  id CHAR(36) PRIMARY KEY,
  supplier_id CHAR(36) NOT NULL,
  purchase_order_item_id CHAR(36) NOT NULL,
  goods_receipt_item_id CHAR(36) NOT NULL,
  qualified_quantity INT UNSIGNED NOT NULL,
  purchase_unit_cents BIGINT UNSIGNED NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  status ENUM('PENDING','PAID','VOID') NOT NULL,
  payment_reference VARCHAR(200) NULL,
  paid_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_supplier_payable_receipt_item (goods_receipt_item_id),
  INDEX idx_supplier_payable_supplier_status (supplier_id, status, created_at),
  CONSTRAINT fk_supplier_payable_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_supplier_payable_purchase_item FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id),
  CONSTRAINT fk_supplier_payable_receipt_item FOREIGN KEY (goods_receipt_item_id) REFERENCES goods_receipt_items(id),
  CONSTRAINT chk_supplier_payable_amount CHECK (amount_cents = qualified_quantity * purchase_unit_cents)
) ENGINE=InnoDB;

CREATE TABLE sorting_tasks (
  id CHAR(36) PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  warehouse_id CHAR(36) NOT NULL,
  status ENUM('PENDING','COMPLETED','CANCELLED') NOT NULL,
  created_by CHAR(36) NOT NULL,
  completed_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  UNIQUE KEY uk_sorting_task_campaign (campaign_id),
  CONSTRAINT fk_sorting_task_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_sorting_task_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
) ENGINE=InnoDB;

CREATE TABLE sorting_task_items (
  id CHAR(36) PRIMARY KEY,
  sorting_task_id CHAR(36) NOT NULL,
  inventory_lot_id CHAR(36) NOT NULL,
  platform_sku_id CHAR(36) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_sorting_task_item_task (sorting_task_id),
  CONSTRAINT fk_sorting_task_item_task FOREIGN KEY (sorting_task_id) REFERENCES sorting_tasks(id),
  CONSTRAINT fk_sorting_task_item_lot FOREIGN KEY (inventory_lot_id) REFERENCES inventory_lots(id),
  CONSTRAINT fk_sorting_task_item_sku FOREIGN KEY (platform_sku_id) REFERENCES platform_skus(id)
) ENGINE=InnoDB;

CREATE TABLE outbound_orders (
  id CHAR(36) PRIMARY KEY,
  outbound_no VARCHAR(64) NOT NULL,
  campaign_id CHAR(36) NOT NULL,
  warehouse_id CHAR(36) NOT NULL,
  delivery_plan_id CHAR(36) NOT NULL,
  sorting_task_id CHAR(36) NOT NULL,
  status ENUM('CREATED','DISPATCHED','HANDED_OVER','EXCEPTION','CANCELLED') NOT NULL,
  carrier_reference VARCHAR(100) NULL,
  dispatched_by CHAR(36) NULL,
  dispatched_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_outbound_campaign (campaign_id),
  UNIQUE KEY uk_outbound_no (outbound_no),
  CONSTRAINT fk_outbound_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_outbound_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_outbound_plan FOREIGN KEY (delivery_plan_id) REFERENCES campaign_delivery_plans(id),
  CONSTRAINT fk_outbound_sorting_task FOREIGN KEY (sorting_task_id) REFERENCES sorting_tasks(id)
) ENGINE=InnoDB;

CREATE TABLE outbound_order_items (
  id CHAR(36) PRIMARY KEY,
  outbound_order_id CHAR(36) NOT NULL,
  inventory_lot_id CHAR(36) NOT NULL,
  platform_sku_id CHAR(36) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  UNIQUE KEY uk_outbound_item_lot (outbound_order_id, inventory_lot_id),
  CONSTRAINT fk_outbound_item_outbound FOREIGN KEY (outbound_order_id) REFERENCES outbound_orders(id),
  CONSTRAINT fk_outbound_item_lot FOREIGN KEY (inventory_lot_id) REFERENCES inventory_lots(id),
  CONSTRAINT fk_outbound_item_sku FOREIGN KEY (platform_sku_id) REFERENCES platform_skus(id)
) ENGINE=InnoDB;

CREATE TABLE pickup_handovers (
  id CHAR(36) PRIMARY KEY,
  outbound_order_id CHAR(36) NOT NULL,
  delivery_plan_id CHAR(36) NOT NULL,
  status ENUM('PENDING','COMPLETED','EXCEPTION') NOT NULL,
  handed_over_by CHAR(36) NOT NULL,
  received_by CHAR(36) NULL,
  exception_note VARCHAR(500) NULL,
  handed_over_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_pickup_handover_outbound (outbound_order_id),
  CONSTRAINT fk_pickup_handover_outbound FOREIGN KEY (outbound_order_id) REFERENCES outbound_orders(id),
  CONSTRAINT fk_pickup_handover_plan FOREIGN KEY (delivery_plan_id) REFERENCES campaign_delivery_plans(id)
) ENGINE=InnoDB;

CREATE TABLE pickup_handover_items (
  id CHAR(36) PRIMARY KEY,
  pickup_handover_id CHAR(36) NOT NULL,
  platform_sku_id CHAR(36) NOT NULL,
  expected_quantity INT UNSIGNED NOT NULL,
  received_quantity INT UNSIGNED NOT NULL,
  UNIQUE KEY uk_pickup_handover_item_sku (pickup_handover_id, platform_sku_id),
  CONSTRAINT fk_pickup_handover_item_handover FOREIGN KEY (pickup_handover_id) REFERENCES pickup_handovers(id),
  CONSTRAINT fk_pickup_handover_item_sku FOREIGN KEY (platform_sku_id) REFERENCES platform_skus(id)
) ENGINE=InnoDB;

CREATE TABLE platform_refunds (
  id CHAR(36) PRIMARY KEY,
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
  UNIQUE KEY uk_platform_refund_order (order_id),
  UNIQUE KEY uk_platform_refund_provider_no (provider_refund_no),
  INDEX idx_platform_refund_status_updated (status, updated_at),
  CONSTRAINT fk_platform_refund_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_platform_refund_payment FOREIGN KEY (payment_id) REFERENCES payments(id)
) ENGINE=InnoDB;

-- Build review-only candidates without copying any legacy financial semantics.
INSERT IGNORE INTO suppliers (id, legacy_merchant_id, name, status, created_at, updated_at)
SELECT m.id, m.id, m.name, 'DRAFT', m.created_at, UTC_TIMESTAMP(3)
FROM merchants m;

INSERT IGNORE INTO platform_products (id, legacy_product_id, title, category, origin, image_url, storage_type, status, created_at, updated_at)
SELECT p.id, p.id, p.title, COALESCE(p.category, '地方特产'), p.origin, p.image_url, 'NORMAL_TEMPERATURE', 'DRAFT', p.created_at, UTC_TIMESTAMP(3)
FROM products p;

INSERT IGNORE INTO platform_skus (id, product_id, name, retail_price_cents, status, created_at, updated_at)
SELECT s.id, s.product_id, s.name, s.price_cents, 'INACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM product_skus s;

INSERT IGNORE INTO supplier_sku_offers (id, supplier_id, platform_sku_id, purchase_price_cents, minimum_purchase_quantity, lead_time_days, status, created_at, updated_at)
SELECT UUID(), p.merchant_id, s.id, NULL, 1, 1, 'DRAFT', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM products p
JOIN product_skus s ON s.product_id=p.id;

INSERT IGNORE INTO warehouses (id, name, address, status, created_at, updated_at)
VALUES ('warehouse-platform-default', '平台中心仓（待核验）', '待补录中心仓地址', 'SUSPENDED', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));
