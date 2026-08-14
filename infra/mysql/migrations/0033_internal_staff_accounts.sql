-- Internal operations staff is deliberately isolated from consumer identities.
-- Existing admin credentials and legacy verifier assignments remain untouched.
CREATE TABLE internal_staff (
  user_id CHAR(36) PRIMARY KEY,
  staff_no VARCHAR(32) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  role ENUM('SUPER_ADMIN','OPERATOR','CUSTOMER_SERVICE','FINANCE','PICKUP_MANAGER') NOT NULL,
  status ENUM('PENDING_ACTIVATION','ACTIVE','SUSPENDED') NOT NULL DEFAULT 'PENDING_ACTIVATION',
  created_by CHAR(36) NULL,
  activated_at DATETIME(3) NULL,
  suspended_at DATETIME(3) NULL,
  suspension_reason VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_internal_staff_no (staff_no),
  UNIQUE KEY uk_internal_staff_phone (phone),
  INDEX idx_internal_staff_directory (status, role, display_name),
  CONSTRAINT fk_internal_staff_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- Current point scope is a separate fact from the append-only legacy verifier
-- grant/revoke events. Staff changes are audit logged by the application.
CREATE TABLE staff_pickup_point_assignments (
  staff_user_id CHAR(36) NOT NULL,
  pickup_point_id CHAR(36) NOT NULL,
  assigned_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (staff_user_id, pickup_point_id),
  INDEX idx_staff_pickup_point_lookup (pickup_point_id, staff_user_id),
  CONSTRAINT fk_staff_point_staff FOREIGN KEY (staff_user_id) REFERENCES internal_staff(user_id),
  CONSTRAINT fk_staff_point_pickup_point FOREIGN KEY (pickup_point_id) REFERENCES pickup_points(id)
) ENGINE=InnoDB;

-- A generated credential is shown only in the create/reset response. Its hash
-- remains unusable for an operations session until the employee changes it.
ALTER TABLE admin_credentials
  ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash;
