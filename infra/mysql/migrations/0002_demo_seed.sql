INSERT INTO merchants (id, name, status, default_commission_bps, created_at, updated_at)
VALUES ('merchant-demo-001', '家乡风味示例商户', 'ACTIVE', 800, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));

INSERT INTO products (id, merchant_id, title, origin, storage_type, status, created_at, updated_at)
VALUES ('product-demo-001', 'merchant-demo-001', '家乡风味手工米粉', '江西赣南', 'NORMAL_TEMPERATURE', 'APPROVED', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));

INSERT INTO product_skus (id, product_id, name, price_cents, stock, sold_quantity, status, version)
VALUES ('sku-demo-001', 'product-demo-001', '500g / 袋', 2980, 1000, 0, 'ACTIVE', 1);

INSERT INTO service_areas (id, region_code, name, status, order_enabled, created_at)
VALUES ('service-hz', '130606', '莲池区', 'ENABLED', TRUE, UTC_TIMESTAMP(3));

INSERT INTO pickup_points (id, service_area_id, name, address, status, capacity_per_day, created_at)
VALUES ('pickup-hz-001', 'service-hz', '莲池区裕华路自提点', '河北省保定市莲池区裕华西路（演示地址）', 'ACTIVE', 2000, UTC_TIMESTAMP(3));
