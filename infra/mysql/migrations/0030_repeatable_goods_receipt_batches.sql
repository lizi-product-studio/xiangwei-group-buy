-- A purchase order can be delivered and inspected in more than one batch.
-- This changes only a uniqueness constraint; it neither rewrites nor deletes
-- historic receipts. Existing receipt rows remain valid first batches.
ALTER TABLE goods_receipts
  DROP INDEX uk_goods_receipt_purchase_order,
  ADD INDEX idx_goods_receipt_purchase_order_created (purchase_order_id, created_at, id);
