export const apiUnavailableMessage =
  "后台服务不可用，数据加载失败。请确认已在项目根目录执行 pnpm dev（或分别启动 pnpm dev:api 与 pnpm dev:admin），然后点击“重试”。";

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
    labels.push(
      input.batchStatus === "DRAFT" ? "确认发车" : "创建批次并发车",
    );
  }
  if (
    input.emergencyProxy &&
    ["IN_TRANSIT", "ARRIVED"].includes(input.status)
  )
    labels.push("紧急纠正运输信息");
  return labels;
}
