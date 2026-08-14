ALTER TABLE products
  ADD COLUMN category VARCHAR(40) NOT NULL DEFAULT '地方特产' AFTER title,
  ADD COLUMN image_url VARCHAR(2048) NULL AFTER origin;

UPDATE products
SET category = '米面粮油', image_url = '/assets/product-rice-noodles.jpg'
WHERE id = 'product-demo-001';

INSERT IGNORE INTO products (id, merchant_id, title, category, origin, image_url, storage_type, status, created_at, updated_at)
VALUES ('product-demo-002', 'merchant-demo-001', '高碑店豆腐丝', '熟食豆制品', '河北保定', '/assets/product-tofu-strips.jpg', 'NORMAL_TEMPERATURE', 'APPROVED', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));

INSERT IGNORE INTO product_skus (id, product_id, name, price_cents, stock, sold_quantity, status, version)
VALUES ('sku-demo-002', 'product-demo-002', '300g / 袋', 1980, 800, 36, 'ACTIVE', 1);
