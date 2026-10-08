-- Additive B-tier entity persistence. The legacy aggregate remains the immutable
-- migration input and rollback source until separately approved for cleanup.
CREATE TABLE IF NOT EXISTS community_entity_records (
  collection VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_key VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  lookup_a VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NULL,
  lookup_b VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NULL,
  lookup_c VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NULL,
  lookup_d VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NULL,
  lookup_e VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NULL,
  lookup_f VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NULL,
  record_status VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NULL,
  queue_at DATETIME(3) NULL,
  paid_at DATETIME(3) NULL,
  due_at DATETIME(3) NULL,
  retry_at DATETIME(3) NULL,
  lease_until DATETIME(3) NULL,
  provider_started_at DATETIME(3) NULL,
  unique_key VARCHAR(700) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NULL,
  search_text TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NULL,
  document JSON NOT NULL,
  PRIMARY KEY (collection, entity_key),
  KEY ix_community_entity_lookup_a (collection, lookup_a(191)),
  KEY ix_community_entity_lookup_b (collection, lookup_b(191)),
  KEY ix_community_entity_lookup_c (collection, lookup_c(191)),
  KEY ix_community_entity_lookup_d (collection, lookup_d(191)),
  KEY ix_community_entity_lookup_e (collection, lookup_e(191)),
  KEY ix_community_entity_lookup_f (collection, lookup_f(191)),
  KEY ix_community_entity_status_created (collection, record_status, created_at, entity_key),
  KEY ix_community_entity_created (collection, created_at, entity_key),
  KEY ix_community_entity_lookup_a_created (collection, lookup_a(128), created_at, entity_key),
  KEY ix_community_entity_lookup_b_created (collection, lookup_b(128), created_at, entity_key),
  KEY ix_community_entity_lookup_c_status_created (collection, lookup_c(128), record_status, created_at, entity_key),
  KEY ix_community_entity_lookup_a_status (collection, lookup_a(128), record_status),
  KEY ix_community_entity_lookup_b_status (collection, lookup_b(128), record_status),
  KEY ix_community_entity_due (collection, record_status, due_at, created_at),
  KEY ix_community_entity_paid (collection, paid_at, created_at),
  KEY ix_community_entity_queue (collection, record_status, queue_at, entity_key),
  KEY ix_community_entity_lookup_ab (collection, lookup_a(128), lookup_b(128)),
  KEY ix_community_entity_retry (collection, record_status, retry_at, lease_until, provider_started_at, created_at),
  UNIQUE KEY ux_community_entity_business (collection, unique_key),
  FULLTEXT KEY ft_community_entity_search (search_text) WITH PARSER ngram
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS community_entity_relations (
  source_collection VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_key VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  source_key_sha256 BINARY(32) NOT NULL,
  relation_name VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_key VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
  target_key_sha256 BINARY(32) NOT NULL,
  PRIMARY KEY (source_collection, source_key_sha256, relation_name, target_key_sha256),
  KEY ix_community_entity_relation_target (relation_name, target_key_sha256, source_collection, source_key_sha256)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS community_entity_sequences (
  sequence_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  next_value BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (sequence_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS community_entity_store_state (
  id TINYINT UNSIGNED NOT NULL,
  mode ENUM('LEGACY', 'PREPARED', 'ENTITY') NOT NULL DEFAULT 'LEGACY',
  source_schema_version INT UNSIGNED NULL,
  source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  migrated_at DATETIME(3) NULL,
  first_entity_write_at DATETIME(3) NULL,
  entity_write_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT chk_community_entity_store_state_singleton CHECK (id = 1)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS community_entity_migration_journal (
  collection VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  state ENUM('PENDING','RUNNING','COMPLETE','FAILED') NOT NULL,
  last_source_ordinal BIGINT UNSIGNED NOT NULL DEFAULT 0,
  processed_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  verified_count BIGINT UNSIGNED NULL,
  source_amount_cents DECIMAL(30,0) NULL,
  entity_amount_cents DECIMAL(30,0) NULL,
  source_debit_cents DECIMAL(30,0) NULL,
  entity_debit_cents DECIMAL(30,0) NULL,
  source_credit_cents DECIMAL(30,0) NULL,
  entity_credit_cents DECIMAL(30,0) NULL,
  reference_mismatches BIGINT UNSIGNED NULL,
  last_error VARCHAR(1000) NULL,
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (collection)
) ENGINE=InnoDB;

INSERT INTO community_entity_store_state(id, mode)
VALUES (1, 'LEGACY')
ON DUPLICATE KEY UPDATE id = VALUES(id);

CREATE TABLE IF NOT EXISTS community_legacy_snapshots (
  id TINYINT UNSIGNED NOT NULL,
  schema_version INT UNSIGNED NOT NULL,
  payload JSON NOT NULL,
  payload_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  captured_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_community_legacy_snapshots_singleton CHECK (id = 1)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS community_entity_reverse_exports (
  id TINYINT UNSIGNED NOT NULL,
  source_entity_write_count BIGINT UNSIGNED NOT NULL,
  payload JSON NOT NULL,
  payload_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  exported_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_community_entity_reverse_exports_singleton CHECK (id = 1)
) ENGINE=InnoDB;
