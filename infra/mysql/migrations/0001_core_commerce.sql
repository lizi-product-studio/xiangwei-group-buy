-- Core MVP schema. All monetary columns use integer cents; timestamps are stored in UTC.
CREATE TABLE merchants (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  status ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED') NOT NULL,
  default_commission_bps INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT chk_merchant_commission CHECK (default_commission_bps <= 10000)
) ENGINE=InnoDB;

CREATE TABLE products (
  id CHAR(36) PRIMARY KEY,
  merchant_id CHAR(36) NOT NULL,
  title VARCHAR(160) NOT NULL,
  origin VARCHAR(160) NOT NULL,
  storage_type ENUM('NORMAL_TEMPERATURE') NOT NULL,
  status ENUM('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'OFF_SHELF') NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_products_merchant_status (merchant_id, status),
  CONSTRAINT fk_products_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
) ENGINE=InnoDB;

CREATE TABLE product_skus (
  id CHAR(36) PRIMARY KEY,
  product_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  price_cents BIGINT UNSIGNED NOT NULL,
  stock INT UNSIGNED NOT NULL,
  sold_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  INDEX idx_skus_product_status (product_id, status),
  CONSTRAINT fk_skus_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT chk_sku_stock CHECK (sold_quantity <= stock)
) ENGINE=InnoDB;

CREATE TABLE service_areas (
  id CHAR(36) PRIMARY KEY,
  region_code VARCHAR(12) NOT NULL,
  name VARCHAR(80) NOT NULL,
  status ENUM('ENABLED', 'DISABLED') NOT NULL,
  order_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_service_area_region (region_code)
) ENGINE=InnoDB;

CREATE TABLE pickup_points (
  id CHAR(36) PRIMARY KEY,
  service_area_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  address VARCHAR(255) NOT NULL,
  status ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED') NOT NULL,
  capacity_per_day INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_pickup_area_status (service_area_id, status, id),
  CONSTRAINT fk_pickup_area FOREIGN KEY (service_area_id) REFERENCES service_areas(id)
) ENGINE=InnoDB;

CREATE TABLE campaigns (
  id CHAR(36) PRIMARY KEY,
  service_area_id CHAR(36) NOT NULL,
  title VARCHAR(80) NOT NULL,
  cutoff_at DATETIME(3) NOT NULL,
  dispatch_at DATETIME(3) NOT NULL,
  min_total_quantity INT UNSIGNED NOT NULL DEFAULT 1,
  failure_action ENUM('CANCEL_AND_REFUND', 'POSTPONE') NOT NULL,
  status ENUM('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSING', 'LOCKED', 'FULFILLING', 'COMPLETED', 'POSTPONED', 'CANCELLED') NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_campaign_area_status_cutoff (service_area_id, status, cutoff_at),
  CONSTRAINT fk_campaign_area FOREIGN KEY (service_area_id) REFERENCES service_areas(id),
  CONSTRAINT chk_campaign_time CHECK (dispatch_at > cutoff_at)
) ENGINE=InnoDB;

CREATE TABLE campaign_skus (
  campaign_id CHAR(36) NOT NULL,
  sku_id CHAR(36) NOT NULL,
  stock INT UNSIGNED NOT NULL,
  sold_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, sku_id),
  CONSTRAINT fk_campaign_skus_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_campaign_skus_sku FOREIGN KEY (sku_id) REFERENCES product_skus(id),
  CONSTRAINT chk_campaign_sku_stock CHECK (sold_quantity <= stock)
) ENGINE=InnoDB;

CREATE TABLE campaign_pickup_points (
  campaign_id CHAR(36) NOT NULL,
  pickup_point_id CHAR(36) NOT NULL,
  PRIMARY KEY (campaign_id, pickup_point_id),
  CONSTRAINT fk_campaign_pickups_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_campaign_pickups_pickup FOREIGN KEY (pickup_point_id) REFERENCES pickup_points(id)
) ENGINE=InnoDB;

CREATE TABLE orders (
  id CHAR(36) PRIMARY KEY,
  order_no VARCHAR(40) NOT NULL,
  user_id CHAR(36) NOT NULL,
  campaign_id CHAR(36) NOT NULL,
  pickup_point_id CHAR(36) NOT NULL,
  status VARCHAR(32) NOT NULL,
  total_cents BIGINT UNSIGNED NOT NULL,
  commission_cents BIGINT UNSIGNED NOT NULL,
  paid_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_orders_order_no (order_no),
  INDEX idx_orders_user_created (user_id, created_at, id),
  INDEX idx_orders_campaign_status (campaign_id, status),
  CONSTRAINT fk_orders_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_orders_pickup FOREIGN KEY (pickup_point_id) REFERENCES pickup_points(id),
  CONSTRAINT chk_order_commission CHECK (commission_cents <= total_cents)
) ENGINE=InnoDB;

CREATE TABLE merchant_orders (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  merchant_id CHAR(36) NOT NULL,
  item_amount_cents BIGINT UNSIGNED NOT NULL,
  commission_cents BIGINT UNSIGNED NOT NULL,
  merchant_receivable_cents BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL,
  UNIQUE KEY uk_merchant_order (order_id, merchant_id),
  INDEX idx_merchant_orders_merchant_status (merchant_id, status),
  CONSTRAINT fk_merchant_orders_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_merchant_orders_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id),
  CONSTRAINT chk_merchant_order_balance CHECK (item_amount_cents = commission_cents + merchant_receivable_cents)
) ENGINE=InnoDB;

CREATE TABLE order_items (
  id CHAR(36) PRIMARY KEY,
  merchant_order_id CHAR(36) NOT NULL,
  sku_id CHAR(36) NOT NULL,
  product_snapshot JSON NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price_cents BIGINT UNSIGNED NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  commission_rate_bps INT UNSIGNED NOT NULL,
  commission_cents BIGINT UNSIGNED NOT NULL,
  INDEX idx_order_items_merchant_order (merchant_order_id),
  CONSTRAINT fk_order_items_merchant_order FOREIGN KEY (merchant_order_id) REFERENCES merchant_orders(id),
  CONSTRAINT fk_order_items_sku FOREIGN KEY (sku_id) REFERENCES product_skus(id),
  CONSTRAINT chk_order_item_amount CHECK (amount_cents = unit_price_cents * quantity),
  CONSTRAINT chk_order_item_commission CHECK (commission_rate_bps <= 10000 AND commission_cents <= amount_cents)
) ENGINE=InnoDB;

CREATE TABLE idempotency_keys (
  actor_id CHAR(36) NOT NULL,
  operation VARCHAR(80) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_status SMALLINT UNSIGNED NULL,
  response_body JSON NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (actor_id, operation, idempotency_key),
  INDEX idx_idempotency_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id CHAR(36) NOT NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id VARCHAR(80) NOT NULL,
  request_id VARCHAR(80) NOT NULL,
  before_data JSON NULL,
  after_data JSON NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_audit_resource (resource_type, resource_id, created_at),
  INDEX idx_audit_actor (actor_id, created_at)
) ENGINE=InnoDB;

