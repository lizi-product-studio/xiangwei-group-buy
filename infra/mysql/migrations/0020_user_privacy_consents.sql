-- Immutable privacy-notice acceptance evidence. The composite key preserves
-- the first server-side timestamp when a client retries the same acceptance.
CREATE TABLE user_privacy_consents (
  user_id CHAR(36) NOT NULL,
  document_version VARCHAR(64) NOT NULL,
  consented_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, document_version),
  INDEX idx_user_privacy_consents_version_time (document_version, consented_at),
  CONSTRAINT fk_user_privacy_consents_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- Each contact submission retains the precise version it was made under.
-- The timestamp remains sourced from the immutable consent evidence table.
ALTER TABLE service_area_interests
  ADD COLUMN privacy_version VARCHAR(64) NULL AFTER contact_phone;
