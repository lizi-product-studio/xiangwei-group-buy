UPDATE service_areas
SET region_code = '130606', name = '莲池区', status = 'ENABLED', order_enabled = TRUE
WHERE id = 'service-hz';

UPDATE pickup_points
SET name = '莲池区裕华路自提点', address = '河北省保定市莲池区裕华西路（演示地址）'
WHERE id = 'pickup-hz-001';
