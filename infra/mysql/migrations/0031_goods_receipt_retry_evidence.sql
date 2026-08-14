-- Additive receipt-fact evidence for deterministic retry comparison.
-- Historical receipt rows remain readable with nullable evidence fields.
ALTER TABLE goods_receipt_items
  ADD COLUMN exception_reason VARCHAR(40) NULL AFTER inspection_note,
  ADD COLUMN evidence_url VARCHAR(2048) NULL AFTER exception_reason;
