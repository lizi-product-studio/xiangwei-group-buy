-- A business event may be retried, but each order must be contacted only once for it.
ALTER TABLE order_notifications
  ADD COLUMN event_key VARCHAR(160) NULL AFTER id;

UPDATE order_notifications
SET event_key = CONCAT('legacy:', id)
WHERE event_key IS NULL;

ALTER TABLE order_notifications
  MODIFY COLUMN event_key VARCHAR(160) NOT NULL,
  MODIFY COLUMN status ENUM('PENDING_DELIVERY','WECHAT_SENT','IN_APP_AVAILABLE','MANUAL_REQUIRED','MANUAL_COMPLETED') NOT NULL,
  ADD CONSTRAINT uq_order_notification_event UNIQUE (order_id, event_key);
