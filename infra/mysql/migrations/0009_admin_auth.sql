-- Separate credentials for the operations console. Passwords are stored as scrypt hashes.
ALTER TABLE users MODIFY wechat_open_id VARCHAR(64) NULL;

CREATE TABLE admin_credentials (
  username VARCHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  password_salt CHAR(32) NOT NULL,
  password_hash CHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_admin_credentials_user (user_id),
  CONSTRAINT fk_admin_credentials_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;
