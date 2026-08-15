-- Community quality reports are independent post-pickup facts.  They must not
-- reuse fulfilment exceptions because a quality report never changes what was
-- fulfilled or picked up.
CREATE TABLE community_quality_cases (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  client_request_id VARCHAR(64) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  status ENUM('REGISTERED','ACCEPTED','REJECTED','REFUNDING','RESOLVED') NOT NULL DEFAULT 'REGISTERED',
  registered_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_community_quality_case_request (order_id, client_request_id),
  INDEX idx_community_quality_case_order (order_id, registered_at),
  INDEX idx_community_quality_case_user (user_id, registered_at),
  CONSTRAINT fk_community_quality_case_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_community_quality_case_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE community_quality_case_items (
  id CHAR(36) PRIMARY KEY,
  community_quality_case_id CHAR(36) NOT NULL,
  sales_order_item_id CHAR(36) NOT NULL,
  platform_sku_id CHAR(36) NOT NULL,
  picked_up_quantity_snapshot INT UNSIGNED NOT NULL,
  disputed_quantity INT UNSIGNED NOT NULL,
  reason ENUM('PICKUP_SHORTAGE','PICKUP_DAMAGE','QUALITY_CLAIM') NOT NULL,
  description VARCHAR(500) NOT NULL,
  UNIQUE KEY uk_community_quality_case_sales_line (community_quality_case_id, sales_order_item_id),
  INDEX idx_community_quality_case_item_sales_line (sales_order_item_id),
  CONSTRAINT fk_community_quality_case_item_case FOREIGN KEY (community_quality_case_id) REFERENCES community_quality_cases(id),
  CONSTRAINT fk_community_quality_case_item_sales_line FOREIGN KEY (sales_order_item_id) REFERENCES sales_order_items(id),
  CONSTRAINT fk_community_quality_case_item_sku FOREIGN KEY (platform_sku_id) REFERENCES platform_skus(id),
  CONSTRAINT chk_community_quality_case_item_quantity CHECK (disputed_quantity > 0 AND disputed_quantity <= picked_up_quantity_snapshot)
) ENGINE=InnoDB;
