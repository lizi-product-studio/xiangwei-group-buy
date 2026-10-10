-- Isolated-test template only. The schema is pinned to the disposable Stage B
-- database. Replace the account placeholders with the test-only runtime user.
REVOKE ALL PRIVILEGES ON hometown_sec_b_20261010.* FROM '<RUNTIME_USER>'@'<RUNTIME_HOST>';
GRANT SELECT, INSERT, UPDATE, DELETE ON hometown_sec_b_20261010.community_product_state TO '<RUNTIME_USER>'@'<RUNTIME_HOST>';
GRANT SELECT, INSERT, UPDATE, DELETE ON hometown_sec_b_20261010.community_entity_records TO '<RUNTIME_USER>'@'<RUNTIME_HOST>';
GRANT SELECT, INSERT, UPDATE, DELETE ON hometown_sec_b_20261010.community_entity_relations TO '<RUNTIME_USER>'@'<RUNTIME_HOST>';
GRANT SELECT, INSERT, UPDATE, DELETE ON hometown_sec_b_20261010.community_entity_sequences TO '<RUNTIME_USER>'@'<RUNTIME_HOST>';
GRANT SELECT, INSERT, UPDATE, DELETE ON hometown_sec_b_20261010.community_entity_store_state TO '<RUNTIME_USER>'@'<RUNTIME_HOST>';

-- No CREATE, ALTER, INDEX, DROP, TRIGGER, EVENT, FILE, or GRANT OPTION.
