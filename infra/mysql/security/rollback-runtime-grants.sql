-- Reversible emergency path, isolated until the runtime candidate passes.
-- First retain the exact pre-change SHOW GRANTS output outside the repository.
-- This restores the previously observed schema-wide runtime grant.
GRANT ALL PRIVILEGES ON `hometown\_food`.* TO 'hometown'@'%';
