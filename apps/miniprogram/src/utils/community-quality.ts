export const COMMUNITY_QUALITY_TEXT_ONLY_HINT =
  "社区订单首发仅支持文字说明，暂不支持外链或附件。";

const COMMUNITY_QUALITY_STATUS: Record<
  NonNullable<OrderDto["communityQualityCases"]>[number]["status"],
  string
> = {
  REGISTERED: "待客服受理",
  ACCEPTED: "处理中",
  REJECTED: "未受理",
  REFUNDING: "退款处理中",
  RESOLVED: "已处理完成",
};

/** The API remains authoritative; this only prevents a clearly expired UI entry. */
export function canSubmitCommunityQualityCase(
  order: Pick<OrderDto, "status" | "qualityDeadlineAt">,
  now = Date.now(),
): boolean {
  return (
    ["READY_FOR_PICKUP", "PICKED_UP", "COMPLETED"].includes(order.status) &&
    !!order.qualityDeadlineAt &&
    Date.parse(order.qualityDeadlineAt) > now
  );
}

export function communityQualityCaseStatusText(
  status: NonNullable<OrderDto["communityQualityCases"]>[number]["status"],
): string {
  return COMMUNITY_QUALITY_STATUS[status];
}
