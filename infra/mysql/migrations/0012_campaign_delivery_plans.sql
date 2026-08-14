-- A collection location is decided per campaign after the group closes. It is not a reusable pickup-point network.
CREATE TABLE campaign_delivery_plans (
  id CHAR(36) PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  service_area_id CHAR(36) NOT NULL,
  status ENUM('PENDING_SITE','SITE_CONFIRMED','VEHICLE_BOOKED','IN_TRANSIT','ARRIVED') NOT NULL,
  site_name VARCHAR(120) NULL,
  address VARCHAR(255) NULL,
  arrival_start_at DATETIME(3) NULL,
  arrival_end_at DATETIME(3) NULL,
  contact_name VARCHAR(80) NULL,
  contact_phone VARCHAR(32) NULL,
  vehicle_order_no VARCHAR(100) NULL,
  driver_name VARCHAR(80) NULL,
  driver_phone VARCHAR(32) NULL,
  vehicle_plate VARCHAR(32) NULL,
  remark VARCHAR(500) NULL,
  confirmed_at DATETIME(3) NULL,
  booked_at DATETIME(3) NULL,
  dispatched_at DATETIME(3) NULL,
  arrived_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_delivery_plan_campaign (campaign_id),
  INDEX idx_delivery_plan_area_status (service_area_id, status),
  CONSTRAINT fk_delivery_plan_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_delivery_plan_area FOREIGN KEY (service_area_id) REFERENCES service_areas(id),
  CONSTRAINT chk_delivery_plan_site CHECK ((site_name IS NULL AND address IS NULL) OR (site_name IS NOT NULL AND address IS NOT NULL))
) ENGINE=InnoDB;

-- Give every existing campaign a placeholder plan. The migration keeps historical pickup records intact.
INSERT INTO campaign_delivery_plans (id,campaign_id,service_area_id,status,remark,created_at,updated_at)
SELECT UUID(), c.id, c.service_area_id, 'PENDING_SITE', '历史团期：到货地点待补录', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM campaigns c;

ALTER TABLE orders
  DROP FOREIGN KEY fk_orders_pickup,
  MODIFY pickup_point_id CHAR(36) NULL,
  ADD COLUMN service_area_id CHAR(36) NULL AFTER campaign_id,
  ADD COLUMN delivery_plan_id CHAR(36) NULL AFTER service_area_id;

UPDATE orders o
JOIN campaigns c ON c.id=o.campaign_id
JOIN campaign_delivery_plans p ON p.campaign_id=c.id
SET o.service_area_id=c.service_area_id, o.delivery_plan_id=p.id;

ALTER TABLE orders
  MODIFY service_area_id CHAR(36) NOT NULL,
  MODIFY delivery_plan_id CHAR(36) NOT NULL,
  ADD INDEX idx_orders_delivery_plan_status (delivery_plan_id,status),
  ADD CONSTRAINT fk_orders_service_area FOREIGN KEY (service_area_id) REFERENCES service_areas(id),
  ADD CONSTRAINT fk_orders_delivery_plan FOREIGN KEY (delivery_plan_id) REFERENCES campaign_delivery_plans(id);

ALTER TABLE pickup_records
  DROP FOREIGN KEY fk_pickup_record_point,
  MODIFY pickup_point_id CHAR(36) NULL,
  ADD COLUMN delivery_plan_id CHAR(36) NULL AFTER pickup_point_id,
  ADD CONSTRAINT fk_pickup_record_delivery_plan FOREIGN KEY (delivery_plan_id) REFERENCES campaign_delivery_plans(id);
