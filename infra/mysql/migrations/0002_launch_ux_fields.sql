-- Forward-only marker for the launch UX aggregate shape.
-- Existing community state is retained. Deployments with pre-launch drafts must
-- complete the newly required pickup-point and arrival-window fields before
-- those campaigns can be opened.
UPDATE community_product_state
SET schema_version = 2,
    updated_at = UTC_TIMESTAMP(3)
WHERE id = 1 AND schema_version < 2;
