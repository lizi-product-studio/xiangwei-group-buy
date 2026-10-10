-- Candidate only. Apply to the isolated schema first; production requires the
-- coordinator's pre-change SHOW GRANTS receipt and an approved change window.
GRANT SELECT, INSERT, UPDATE, DELETE ON `hometown_food`.community_product_state TO 'hometown'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `hometown_food`.community_entity_records TO 'hometown'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `hometown_food`.community_entity_relations TO 'hometown'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `hometown_food`.community_entity_sequences TO 'hometown'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `hometown_food`.community_entity_store_state TO 'hometown'@'%';

REVOKE ALL PRIVILEGES ON `hometown\_food`.* FROM 'hometown'@'%';
-- No CREATE, ALTER, INDEX, DROP, TRIGGER, EVENT, FILE, or GRANT OPTION.
