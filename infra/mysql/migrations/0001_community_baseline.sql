-- Clean baseline for the single community group-buy product.
-- There are intentionally no demo regions, pickup points, catalog items,
-- campaigns, orders or payment records in this migration.
CREATE TABLE community_product_state (
  id TINYINT UNSIGNED NOT NULL,
  schema_version INT UNSIGNED NOT NULL,
  payload JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_community_product_state_singleton CHECK (id = 1)
) ENGINE=InnoDB;

INSERT INTO community_product_state (id, schema_version, payload, updated_at)
VALUES (1, 1, JSON_OBJECT(), UTC_TIMESTAMP(3));
