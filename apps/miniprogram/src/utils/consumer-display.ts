const ORDER_STATUS: Record<string, { text: string; hint: string }> = {
  PENDING_PAYMENT: { text: "待付款", hint: "请在支付有效期内完成付款" },
  PAID_WAITING_CLOSE: { text: "等待截单", hint: "平台正在统一收单" },
  LOCKED: { text: "已截单", hint: "平台正在统一备货并安排配送" },
  ALLOCATING: { text: "待发车", hint: "平台正在确认本团配送安排" },
  IN_TRANSIT: { text: "运输中", hint: "货物正在配送至本团固定自提点" },
  READY_FOR_PICKUP: { text: "待领取", hint: "点位已完成交接，请凭取货码领取" },
  PICKED_UP: { text: "已领取", hint: "本次领取已经核销" },
  COMPLETED: { text: "已完成", hint: "订单已完成" },
  REFUNDING: { text: "退款中", hint: "平台正在原路处理退款" },
  REFUNDED: { text: "已退款", hint: "退款已经完成" },
  CANCELLED: { text: "已取消", hint: "订单已关闭" },
};

const PICKUP_WINDOW_STATUS: Record<string, string> = {
  ACTIVE: "请在截止前领取",
  EXTENDED: "已获一次延期，请在新截止前领取",
  EXPIRED_PENDING: "领取已逾期，运营正在确认后续处理",
  REFUND_PENDING: "逾期退款正在由财务处理",
  LOSS_RECORDED: "未领取商品已完成报损关闭",
  CLOSED: "领取窗口已关闭",
};

const CANCELLATION_STATUS: Record<string, string> = {
  DIRECT_REFUNDING: "取消退款处理中",
  PENDING_REVIEW: "取消申请待运营审核",
  APPROVED_WAITING_FINANCE: "取消申请已通过，待财务退款",
  REFUNDING: "退款处理中",
  REFUNDED: "取消退款已完成",
};

const REFUND_STATUS: Record<string, string> = {
  PENDING: "待退款",
  CREATED: "待提交",
  PROCESSING: "退款处理中",
  FAILED: "退款失败",
  SUCCEEDED: "已退款",
};

const pad = (value: number) => String(value).padStart(2, "0");

/** Fixed China-time rendering, independent of the phone's configured timezone. */
export function formatChinaDateTime(value: string, withSeconds = false): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "时间待确认";
  const china = new Date(timestamp + 8 * 60 * 60 * 1000);
  const base = `${pad(china.getUTCMonth() + 1)}月${pad(china.getUTCDate())}日 ${pad(china.getUTCHours())}:${pad(china.getUTCMinutes())}`;
  return withSeconds ? `${base}:${pad(china.getUTCSeconds())}` : base;
}

export function cutoffCountdown(cutoffAt: string, now = Date.now()): string {
  const remaining = Date.parse(cutoffAt) - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return "已截单";
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `剩 ${days ? `${days}天 ` : ""}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function estimatedArrivalText(
  campaign: Pick<CampaignDto, "estimatedArrivalStartAt" | "estimatedArrivalEndAt">,
): string | null {
  const start = campaign.estimatedArrivalStartAt;
  if (!start) return null;
  const end = campaign.estimatedArrivalEndAt;
  return end && end !== start
    ? `${formatChinaDateTime(start)}—${formatChinaDateTime(end)}`
    : formatChinaDateTime(start);
}

export function isCampaignPurchasable(
  campaign: Pick<
    CampaignDto,
    | "status"
    | "cutoffAt"
    | "estimatedArrivalStartAt"
    | "estimatedArrivalEndAt"
  >,
  now = Date.now(),
): boolean {
  const arrivalStart = Date.parse(campaign.estimatedArrivalStartAt ?? "");
  const arrivalEnd = Date.parse(campaign.estimatedArrivalEndAt ?? "");
  return campaign.status === "OPEN" && Date.parse(campaign.cutoffAt) > now &&
    ((Number.isFinite(arrivalStart) && Number.isFinite(arrivalEnd) && arrivalEnd >= arrivalStart) ||
      (!campaign.estimatedArrivalStartAt && !campaign.estimatedArrivalEndAt));
}

export function campaignPaidQuantity(
  campaign: Pick<CampaignDto, "paidQuantity">,
): number {
  return Math.max(0, campaign.paidQuantity ?? 0);
}

export function campaignProgressPercent(
  paidQuantity: number,
  minimumQuantity: number,
): number {
  if (minimumQuantity <= 0) return 100;
  return Math.min(100, Math.round((Math.max(0, paidQuantity) / minimumQuantity) * 100));
}

export function unformedRuleText(
  campaign: Pick<CampaignDto, "failureAction">,
): string {
  return campaign.failureAction === "POSTPONE"
    ? "未达到成团门槛时，运营会延期一次并通知新的截单时间；仍未成团将原路退款。"
    : "未达到成团门槛时，本团关闭并按原支付渠道全额退款。";
}

export function orderStatusCopy(status: string): { text: string; hint: string } {
  return ORDER_STATUS[status] ?? { text: "订单状态已更新", hint: "请刷新查看最新履约进度" };
}

export function pickupWindowStatusText(status: string): string {
  return PICKUP_WINDOW_STATUS[status] ?? "领取安排已更新，请查看截止时间";
}

export function cancellationStatusText(status: string, reviewNote?: string | null): string {
  if (status === "REJECTED") return `取消申请未通过：${reviewNote ?? "请联系客服了解原因"}`;
  return CANCELLATION_STATUS[status] ?? "取消申请状态已更新";
}

export function refundStatusText(status: string): string {
  return REFUND_STATUS[status] ?? "退款状态已更新";
}

export function pickupDeadlineText(deadlineAt?: string | null): string {
  return deadlineAt
    ? `领取截止：${formatChinaDateTime(deadlineAt, true)}（中国时间）`
    : "实际到货确认后，第3个自然日 23:59:59 截止领取（中国时间）";
}

export function qualityDeadlineText(deadlineAt: string): string {
  return `品质售后截止：${formatChinaDateTime(deadlineAt, true)}（本次领取后24小时）`;
}

export function shouldShowFloatingCart(cartItemCount: number): boolean {
  return Number.isFinite(cartItemCount) && cartItemCount > 0;
}

/** Display only: never determines allowed actions or financial state. */
export function orderStatusTone(status: string): string {
  if (["PICKED_UP", "COMPLETED", "READY_FOR_PICKUP"].includes(status)) return "success";
  if (["CANCELLED", "REFUNDED"].includes(status)) return "neutral";
  if (status === "REFUNDING") return "warning";
  if (status === "PENDING_PAYMENT") return "pending";
  return "progress";
}
