CREATE TABLE notification_preferences (
  user_id CHAR(36) PRIMARY KEY,
  types JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_notification_preference_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE order_notifications (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  type ENUM('SITE_CONFIRMED','VEHICLE_DISPATCHED','ARRIVED') NOT NULL,
  title VARCHAR(120) NOT NULL,
  content VARCHAR(500) NOT NULL,
  status ENUM('IN_APP_AVAILABLE','MANUAL_REQUIRED','MANUAL_COMPLETED') NOT NULL,
  read_at DATETIME(3) NULL,
  manual_completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_order_notification_user_created (user_id, created_at),
  INDEX idx_order_notification_manual (status, created_at),
  CONSTRAINT fk_order_notification_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_order_notification_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB;
