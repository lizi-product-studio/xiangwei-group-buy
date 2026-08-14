-- Adds a durable client request key for mode-B customer fulfilment claims.
-- Legacy order, payment, refund and settlement rows are not rewritten.

ALTER TABLE fulfillment_exceptions
  ADD COLUMN client_request_id VARCHAR(64) NULL AFTER order_id,
  ADD UNIQUE KEY uk_fulfillment_exception_order_request (order_id, client_request_id);
