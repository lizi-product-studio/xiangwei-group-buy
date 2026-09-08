export const apiUnavailableMessage =
  "后台服务不可用，数据加载失败。请确认已在项目根目录执行 pnpm dev（或分别启动 pnpm dev:api 与 pnpm dev:admin）后点击“重试”。后台服务暂时无法连接，已保留填写内容。";

export const recoverableLoadErrorMessage =
  "数据加载失败，请点击“重试”再试。";

export function adminLoadErrorText(error: unknown): string {
  const value = error as { message?: unknown; statusCode?: unknown };
  const message = typeof value?.message === "string" ? value.message : "";
  const statusCode =
    typeof value?.statusCode === "number" ? value.statusCode : undefined;
  if (
    (statusCode !== undefined && statusCode >= 500) ||
    /请求失败（5\d\d）|failed to fetch|networkerror|网络|econnrefused|fetch failed/i.test(
      message,
    )
  )
    return apiUnavailableMessage;
  return recoverableLoadErrorMessage;
}

export type LogisticsViewState = "loading" | "error" | "empty" | "ready";

export function getLogisticsViewState(input: {
  loading: boolean;
  error: string | null;
  planCount: number;
}): LogisticsViewState {
  if (input.error) return "error";
  if (input.loading) return "loading";
  if (input.planCount === 0) return "empty";
  return "ready";
}

export function getDeliveryActionLabels(input: {
  status: string;
  canOperate: boolean;
  emergencyProxy: boolean;
  batchStatus?: string;
}): string[] {
  const labels: string[] = [];
  if (input.canOperate && input.status === "SITE_CONFIRMED")
    labels.push("登记运输信息");
  if (input.canOperate && input.status === "VEHICLE_BOOKED") {
    labels.push("编辑运输信息");
    if (!input.batchStatus || input.batchStatus === "DRAFT")
      labels.push(input.batchStatus === "DRAFT" ? "确认发车" : "创建批次并发车");
  }
  if (
    input.emergencyProxy &&
    ["IN_TRANSIT", "ARRIVED"].includes(input.status)
  )
    labels.push("紧急纠正运输信息");
  return labels;
}

export function dispatchBlockReason(input: {
  campaignStatus?: string;
  planStatus: string;
  batchStatus?: string;
}): string | null {
  if (!input.campaignStatus) return "团期信息尚未加载，请刷新后重试";
  if (input.batchStatus && input.batchStatus !== "DRAFT")
    return "该批次已发车或已完成，请刷新查看最新运输状态";
  if (input.planStatus !== "VEHICLE_BOOKED") return "请先完成运输信息登记";
  if (input.campaignStatus === "CANCELLED") return "团期已取消，不能发车";
  if (input.campaignStatus === "COMPLETED") return "团期已完成，不能再次发车";
  if (input.campaignStatus === "LOCKED" ||
      (input.campaignStatus === "FULFILLING" && input.batchStatus === "DRAFT")) return null;
  return "团期尚未成团锁单，请先到团期管理完成截单并确认成团，再安排发车";
}

/** Keep contextual business errors specific without exposing arbitrary backend text. */
export function dispatchFailureText(error: unknown, fallback: string): string {
  const value = error as { code?: string; message?: string };
  if (value.code === "DELIVERY_PLAN_NOT_READY") return "运输信息尚未完成，请重新登记后发车";
  if (value.code === "INVALID_STATE_TRANSITION") {
    if (value.message === "只有已成团锁单的团期可以创建发车批次")
      return "团期尚未成团锁单，请先完成截单并确认成团";
    if (value.message === "批次当前不能发车") return "批次已不处于待发车状态，请刷新查看最新运输状态";
  }
  return fallback;
}
