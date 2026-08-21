-- Community operating controls are additive.  A shortage may be counted by a
-- point manager, but allocation and pickup remain locked until an operator
-- confirms the deterministic draft.
ALTER TABLE order_notifications
  MODIFY COLUMN type ENUM('SITE_CONFIRMED','VEHICLE_DISPATCHED','ARRIVED','PARTIAL_REFUND','PICKUP_DEADLINE','PICKUP_EXPIRED') NOT NULL;

CREATE TABLE community_allocation_drafts (
  id CHAR(36) PRIMARY KEY,
  community_delivery_id CHAR(36) NOT NULL,
  exception_id CHAR(36) NOT NULL,
  campaign_id CHAR(36) NOT NULL,
  delivery_plan_id CHAR(36) NOT NULL,
  version INT UNSIGNED NOT NULL,
  sort_rule ENUM('paidAt_ASC_orderNo_ASC') NOT NULL,
  status ENUM('PENDING_OPERATOR_CONFIRMATION','CONFIRMED') NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  confirmed_by CHAR(36) NULL,
  confirmed_at DATETIME(3) NULL,
  UNIQUE KEY uk_community_allocation_delivery (community_delivery_id),
  CONSTRAINT fk_community_allocation_delivery FOREIGN KEY (community_delivery_id) REFERENCES community_delivery_confirmations(id),
  CONSTRAINT fk_community_allocation_exception FOREIGN KEY (exception_id) REFERENCES fulfillment_exceptions(id)
) ENGINE=InnoDB;

CREATE TABLE community_allocation_draft_items (
  id CHAR(36) PRIMARY KEY,
  allocation_draft_id CHAR(36) NOT NULL,
  sales_order_item_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  order_no VARCHAR(64) NOT NULL,
  platform_sku_id CHAR(36) NOT NULL,
  paid_at DATETIME(3) NOT NULL,
  fulfilled_quantity INT UNSIGNED NOT NULL,
  exception_quantity INT UNSIGNED NOT NULL,
  UNIQUE KEY uk_community_allocation_draft_sales_line (allocation_draft_id, sales_order_item_id),
  INDEX idx_community_allocation_draft_sort (allocation_draft_id, paid_at, order_no, sales_order_item_id),
  CONSTRAINT fk_community_allocation_draft_item FOREIGN KEY (allocation_draft_id) REFERENCES community_allocation_drafts(id),
  CONSTRAINT fk_community_allocation_draft_sales_line FOREIGN KEY (sales_order_item_id) REFERENCES sales_order_items(id)
) ENGINE=InnoDB;

CREATE TABLE community_pickup_windows (
  order_id CHAR(36) PRIMARY KEY,
  delivery_plan_id CHAR(36) NOT NULL,
  arrived_at DATETIME(3) NOT NULL,
  deadline_at DATETIME(3) NOT NULL,
  status ENUM('ACTIVE','EXPIRED_PENDING','EXTENDED','REFUND_PENDING','LOSS_RECORDED','CLOSED') NOT NULL,
  extension_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  extended_by CHAR(36) NULL,
  extended_at DATETIME(3) NULL,
  disposition_by CHAR(36) NULL,
  disposition_at DATETIME(3) NULL,
  disposition_note VARCHAR(500) NULL,
  refund_exception_id CHAR(36) NULL,
  loss_exception_id CHAR(36) NULL,
  INDEX idx_community_pickup_window_deadline (status, deadline_at),
  CONSTRAINT fk_community_pickup_window_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_community_pickup_window_plan FOREIGN KEY (delivery_plan_id) REFERENCES campaign_delivery_plans(id),
  CONSTRAINT fk_community_pickup_window_refund_exception FOREIGN KEY (refund_exception_id) REFERENCES fulfillment_exceptions(id),
  CONSTRAINT fk_community_pickup_window_loss_exception FOREIGN KEY (loss_exception_id) REFERENCES fulfillment_exceptions(id),
  CONSTRAINT chk_community_pickup_window_extension CHECK (extension_count <= 1)
) ENGINE=InnoDB;

CREATE TABLE community_cancellation_requests (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('DIRECT_REFUNDING','PENDING_REVIEW','REJECTED','APPROVED_WAITING_FINANCE','REFUNDING','REFUNDED') NOT NULL,
  requested_at DATETIME(3) NOT NULL,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME(3) NULL,
  review_note VARCHAR(500) NULL,
  finance_executed_by CHAR(36) NULL,
  finance_executed_at DATETIME(3) NULL,
  refund_id CHAR(36) NULL,
  UNIQUE KEY uk_community_cancel_order (order_id),
  INDEX idx_community_cancel_status (status, requested_at),
  CONSTRAINT fk_community_cancel_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_community_cancel_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

ALTER TABLE community_quality_cases
  ADD COLUMN accepted_by CHAR(36) NULL AFTER registered_at,
  ADD COLUMN accepted_at DATETIME(3) NULL AFTER accepted_by,
  ADD COLUMN decision_by CHAR(36) NULL AFTER accepted_at,
  ADD COLUMN decided_at DATETIME(3) NULL AFTER decision_by,
  ADD COLUMN decision_note VARCHAR(500) NULL AFTER decided_at,
  ADD COLUMN refund_approved_by CHAR(36) NULL AFTER decision_note,
  ADD COLUMN refund_approved_at DATETIME(3) NULL AFTER refund_approved_by,
  ADD COLUMN finance_executed_by CHAR(36) NULL AFTER refund_approved_at,
  ADD COLUMN finance_executed_at DATETIME(3) NULL AFTER finance_executed_by,
  ADD COLUMN refund_exception_id CHAR(36) NULL AFTER finance_executed_at;

-- The provider settlement request occurs outside the DB transaction.  The
-- claim token fences a late worker and the lease makes recovery query-first.
ALTER TABLE settlements
  ADD COLUMN submission_lease_until DATETIME(3) NULL AFTER updated_at,
  ADD COLUMN submission_claim_token CHAR(36) NULL AFTER submission_lease_until,
  ADD INDEX idx_settlement_submission_claim (status, submission_lease_until);

ALTER TABLE pickup_codes
  MODIFY COLUMN status ENUM('ACTIVE','USED','REVOKED') NOT NULL;
