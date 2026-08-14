CREATE TABLE service_area_interests (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  region_text VARCHAR(160) NOT NULL,
  contact_name VARCHAR(80) NOT NULL,
  contact_phone VARCHAR(32) NOT NULL,
  status ENUM('NEW','CONTACTED','CLOSED') NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_interest_status_created (status, created_at),
  CONSTRAINT fk_interest_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE after_sales (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  reason VARCHAR(80) NOT NULL,
  description VARCHAR(1000) NOT NULL,
  status ENUM('SUBMITTED','PROCESSING','RESOLVED','REJECTED') NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_after_sale_status_created (status, created_at),
  INDEX idx_after_sale_user_created (user_id, created_at),
  CONSTRAINT fk_after_sale_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_after_sale_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB;
