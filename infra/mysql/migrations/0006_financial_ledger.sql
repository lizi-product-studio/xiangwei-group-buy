-- Append-only double-entry ledger. No UPDATE or DELETE paths are exposed by the application store.
CREATE TABLE ledger_transactions (
  id CHAR(36) PRIMARY KEY,
  reference_type VARCHAR(32) NOT NULL,
  reference_id CHAR(36) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_ledger_reference_event (reference_type, reference_id, event_type),
  INDEX idx_ledger_created (created_at, id)
) ENGINE=InnoDB;

CREATE TABLE ledger_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id CHAR(36) NOT NULL,
  account_code VARCHAR(64) NOT NULL,
  owner_id CHAR(36) NULL,
  direction ENUM('DEBIT', 'CREDIT') NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_ledger_entries_account (account_code, owner_id, created_at, id),
  CONSTRAINT fk_ledger_entries_transaction FOREIGN KEY (transaction_id) REFERENCES ledger_transactions(id),
  CONSTRAINT chk_ledger_entry_positive CHECK (amount_cents > 0)
) ENGINE=InnoDB;
