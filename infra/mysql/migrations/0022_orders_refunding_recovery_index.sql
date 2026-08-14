-- Keeps the periodic recovery sweep bounded when a campaign closure needs refunds.
CREATE INDEX idx_orders_refunding_recovery ON orders (status, updated_at, id);
