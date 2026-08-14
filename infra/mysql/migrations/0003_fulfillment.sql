CREATE TABLE dispatch_batches (
  id CHAR(36) PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  service_area_id CHAR(36) NOT NULL,
  status ENUM('DRAFT','IN_TRANSIT','ARRIVED','CLOSED') NOT NULL,
  created_at DATETIME(3) NOT NULL,
  dispatched_at DATETIME(3) NULL,
  arrived_at DATETIME(3) NULL,
  UNIQUE KEY uk_batch_campaign (campaign_id),
  INDEX idx_batch_area_status (service_area_id,status),
  CONSTRAINT fk_batch_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_batch_area FOREIGN KEY (service_area_id) REFERENCES service_areas(id)
) ENGINE=InnoDB;

CREATE TABLE pickup_codes (
  order_id CHAR(36) PRIMARY KEY,
  code_hash CHAR(64) NOT NULL,
  status ENUM('ACTIVE','USED') NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_pickup_code_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB;

CREATE TABLE pickup_records (
  order_id CHAR(36) PRIMARY KEY,
  pickup_point_id CHAR(36) NOT NULL,
  verifier_id CHAR(36) NOT NULL,
  verified_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_pickup_record_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_pickup_record_point FOREIGN KEY (pickup_point_id) REFERENCES pickup_points(id)
) ENGINE=InnoDB;
