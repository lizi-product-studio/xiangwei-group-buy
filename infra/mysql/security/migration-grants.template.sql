-- Replace both account placeholders with a short-lived, isolated-test-only
-- account and host before running. No account/password is created here.
GRANT SELECT, INSERT, UPDATE, DELETE ON hometown_sec_b_20261010.* TO '<MIGRATION_USER>'@'<MIGRATION_HOST>';
GRANT CREATE, INDEX, CREATE TEMPORARY TABLES ON hometown_sec_b_20261010.* TO '<MIGRATION_USER>'@'<MIGRATION_HOST>';

-- Deliberately does not grant permanent DROP, ALTER, GRANT OPTION, or DDL on
-- any schema other than the disposable test schema. The existing migrations
-- only create permanent tables/indexes and create/drop session temp tables.
