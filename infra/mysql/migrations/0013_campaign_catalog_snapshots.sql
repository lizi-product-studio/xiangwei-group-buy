-- A campaign must keep its catalogue, price and commission truth after the product library changes.
ALTER TABLE campaign_skus
  ADD COLUMN catalog_snapshot JSON NULL AFTER sold_quantity;

UPDATE campaign_skus cs
JOIN product_skus s ON s.id = cs.sku_id
JOIN products p ON p.id = s.product_id
JOIN merchants m ON m.id = p.merchant_id
SET cs.catalog_snapshot = JSON_OBJECT(
  'productId', p.id,
  'merchantId', p.merchant_id,
  'title', p.title,
  'category', p.category,
  'skuName', s.name,
  'origin', p.origin,
  'imageUrl', p.image_url,
  'unitPriceCents', s.price_cents,
  'commissionRateBps', m.default_commission_bps
)
WHERE cs.catalog_snapshot IS NULL;

ALTER TABLE campaign_skus
  MODIFY COLUMN catalog_snapshot JSON NOT NULL;
