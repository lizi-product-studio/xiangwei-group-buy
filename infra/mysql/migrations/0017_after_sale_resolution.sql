ALTER TABLE after_sales
  ADD COLUMN resolution_type ENUM('FULL_REFUND','REJECTED') NULL AFTER status,
  ADD COLUMN refund_amount_cents BIGINT UNSIGNED NULL AFTER resolution_type,
  ADD COLUMN refund_ids JSON NULL AFTER refund_amount_cents,
  ADD COLUMN resolved_by CHAR(36) NULL AFTER refund_ids,
  ADD COLUMN resolution_note VARCHAR(500) NULL AFTER resolved_by,
  ADD COLUMN resolved_at DATETIME(3) NULL AFTER resolution_note;

ALTER TABLE campaign_delivery_plans
  ADD COLUMN pickup_point_id CHAR(36) NULL AFTER service_area_id,
  ADD INDEX idx_delivery_plan_pickup (pickup_point_id),
  ADD CONSTRAINT fk_delivery_plan_pickup FOREIGN KEY (pickup_point_id) REFERENCES pickup_points(id);

UPDATE campaign_delivery_plans p
JOIN pickup_points pp ON pp.id=(SELECT p2.id FROM pickup_points p2 WHERE p2.service_area_id=p.service_area_id AND p2.status='ACTIVE' ORDER BY p2.created_at,p2.id LIMIT 1)
SET p.pickup_point_id=pp.id,
    p.site_name=COALESCE(p.site_name,pp.name),
    p.address=COALESCE(p.address,pp.address),
    p.status=IF(p.status='PENDING_SITE','SITE_CONFIRMED',p.status),
    p.confirmed_at=COALESCE(p.confirmed_at,UTC_TIMESTAMP(3));

UPDATE orders o JOIN campaign_delivery_plans p ON p.id=o.delivery_plan_id
SET o.pickup_point_id=p.pickup_point_id
WHERE o.pickup_point_id IS NULL AND p.pickup_point_id IS NOT NULL;

ALTER TABLE orders
  ADD COLUMN picked_up_at DATETIME(3) NULL AFTER paid_at;
