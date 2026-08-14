-- Keeps the recurring seven-day settlement scan bounded as the order table grows.
CREATE INDEX idx_orders_settlement_eligible ON orders (status, picked_up_at, id);
