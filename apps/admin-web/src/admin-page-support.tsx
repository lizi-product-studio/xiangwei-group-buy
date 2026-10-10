import { Input, Select, Space, Tag, Typography } from "antd";
import { appendAdminRequestId, adminErrorText } from "./api.ts";
import { formatValidationDetails } from "./campaign-form.ts";
import { displayLabel } from "./labels.ts";
import { centsToYuan, validateYuanInput } from "./money-input.ts";

const statusColor = (value: string) => {
  if (
    ["ACTIVE", "OPEN", "SUCCEEDED", "ARRIVED", "COMPLETED", "PICKED_UP", "REFUNDED", "RESOLVED", "CONFIRMED", "MANUAL_COMPLETED"].includes(value)
  ) return "green";
  if (
    ["FAILED", "RETRYABLE_FAILURE", "MANUAL_HOLD", "SUBMISSION_UNKNOWN", "BLOCKED", "EXCEPTION"].includes(value)
  ) return "red";
  if (
    ["PENDING_PAYMENT", "PENDING_REVIEW", "REGISTERED", "ACCEPTED", "CANCELLING", "PENDING_OPERATOR_CONFIRMATION", "APPROVED_WAITING_FINANCE", "REFUND_CONFIRMED", "MANUAL_REQUIRED", "EXPIRED_PENDING"].includes(value)
  ) return "gold";
  if (["CANCELLED", "REJECTED", "CLOSED", "INACTIVE", "SUSPENDED", "DISABLED"].includes(value))
    return "default";
  return "blue";
};
export const Status = ({ value }: { value: string }) => (
  <Tag className="status-tag" color={statusColor(value)}>
    <span className="status-tag__dot" aria-hidden="true" />
    {displayLabel(value)}
  </Tag>
);
export const money = (cents: number) => `¥${centsToYuan(cents)}`;
export const mutationErrorText = (error: unknown): string => {
  const value = error as Error & {
    details?: unknown;
  };
  const details = value.details;
  const validationMessage = formatValidationDetails(details);
  if (validationMessage) return appendAdminRequestId(error, validationMessage);
  const impact = details as {
    campaignCount?: number;
    unfinishedOrderCount?: number;
    deliveryPlanCount?: number;
    activeManagerCount?: number;
  } | null;
  if (
    impact &&
    (impact.campaignCount !== undefined ||
      impact.unfinishedOrderCount !== undefined ||
      impact.deliveryPlanCount !== undefined ||
      impact.activeManagerCount !== undefined)
  ) {
    const parts = [
      impact.campaignCount !== undefined
        ? `${impact.campaignCount} 个进行中团期`
        : null,
      impact.unfinishedOrderCount !== undefined
        ? `${impact.unfinishedOrderCount} 个未完成订单`
        : null,
      impact.deliveryPlanCount !== undefined
        ? `${impact.deliveryPlanCount} 个进行中配送计划`
        : null,
      impact.activeManagerCount !== undefined
        ? `${impact.activeManagerCount} 个有效点位负责人授权`
        : null,
    ].filter((part): part is string => Boolean(part));
    return `${adminErrorText(error)}（影响：${parts.join("，")}）`;
  }
  const transportError =
    value && typeof value === "object" && ("statusCode" in value || "code" in value);
  if (
    error instanceof Error &&
    error.message &&
    /[\u3400-\u9fff]/u.test(error.message) &&
    !transportError
  ) {
    return appendAdminRequestId(error, error.message);
  }
  return adminErrorText(error);
};
export const refreshAfterMutation = async (
  reload: () => Promise<void>,
  message: { success: (content: string) => unknown; warning: (content: string) => unknown },
  successText: string,
) => {
  try {
    await reload();
    message.success(successText);
  } catch {
    message.warning("已保存，列表刷新失败，请刷新");
  }
};
export const priceRule = {
  validator: (_: unknown, value: unknown) => {
    const error = validateYuanInput(value);
    return error ? Promise.reject(new Error(error)) : Promise.resolve();
  },
};

export function PageTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="section-header">
      <div>
        <Typography.Title level={2}>{title}</Typography.Title>
        <Typography.Paragraph type="secondary">{subtitle}</Typography.Paragraph>
      </div>
      {action}
    </header>
  );
}
export function ListFilters({label,query,onQuery,status,onStatus,statuses}: {label:string;query:string;onQuery:(value:string)=>void;status:string;onStatus:(value:string)=>void;statuses:Array<{value:string;label:string}>}) {
  return <Space wrap style={{marginBottom:16}}>
    <Input allowClear aria-label={`${label}关键词`} placeholder={`${label}关键词`} value={query} onChange={event=>onQuery(event.target.value)} style={{width:260}} />
    <Select aria-label={`${label}状态`} value={status} onChange={onStatus} style={{width:170}} options={[{value:"ALL",label:"全部状态"},...statuses]} />
  </Space>;
}
export const matchesKeyword = (query:string,...values:unknown[]) => !query.trim() || values.some(value => String(value ?? "").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
