-- V2 point-workbench pickup idempotency. Existing receipts remain readable because
-- the new columns are nullable; new community V2 receipts populate both fields.
ALTER TABLE community_pickup_receipts
  ADD COLUMN pickup_request_id CHAR(36) NULL AFTER request_key,
  ADD COLUMN payload_hash CHAR(64) NULL AFTER pickup_request_id,
  ADD UNIQUE KEY uk_community_pickup_receipt_request_id (order_id, pickup_request_id);
