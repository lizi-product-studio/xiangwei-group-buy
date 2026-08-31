import type { Dayjs } from "dayjs";

export type CampaignScheduleField =
  | "cutoffAt"
  | "dispatchAt"
  | "estimatedArrivalStartAt"
  | "estimatedArrivalEndAt";

export type CampaignScheduleValues = Partial<
  Record<CampaignScheduleField, Dayjs | undefined>
>;

/**
 * Keep the client-side schedule checks aligned with communityCampaignSchema.
 * Returning a message instead of throwing makes the helper usable by both
 * Ant Form validators and deterministic tests.
 */
export function campaignScheduleError(
  field: CampaignScheduleField,
  value: Dayjs | undefined,
  values: CampaignScheduleValues,
): string | null {
  if (!value) return null;
  if (field === "dispatchAt" && values.cutoffAt && !value.isAfter(values.cutoffAt))
    return "计划发车时间必须晚于截单时间";
  if (
    field === "estimatedArrivalStartAt" &&
    values.dispatchAt &&
    value.isBefore(values.dispatchAt)
  )
    return "预计到货开始时间不能早于计划发车时间";
  if (
    field === "estimatedArrivalEndAt" &&
    values.estimatedArrivalStartAt &&
    value.isBefore(values.estimatedArrivalStartAt)
  )
    return "预计到货结束时间不能早于开始时间";
  return null;
}

const validationFieldLabels: Record<string, string> = {
  title: "团期名称",
  serviceAreaId: "服务区域",
  pickupPointId: "固定自提点",
  cutoffAt: "截单时间",
  dispatchAt: "计划发车时间",
  estimatedArrivalStartAt: "预计到货开始",
  estimatedArrivalEndAt: "预计到货结束",
  minTotalQuantity: "最小成团件数",
  failureAction: "未成团处理",
  items: "商品明细",
  catalogSkuId: "商品",
  retailPriceCents: "团期售价",
  sellableQuantity: "可售量",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Convert Fastify/Zod validation issues into field-labelled operator copy. */
export function formatValidationDetails(details: unknown): string | null {
  if (!Array.isArray(details)) return null;
  const messages = details
    .map((detail): string | null => {
      if (!isRecord(detail) || typeof detail.message !== "string" || !detail.message)
        return null;
      const path = Array.isArray(detail.path)
        ? detail.path
            .filter(
              (part): part is string | number =>
                typeof part === "string" || typeof part === "number",
            )
            .map(String)
        : [];
      const field = path.length
        ? validationFieldLabels[path[0] ?? ""] ?? path.join(".")
        : "";
      return field ? `${field}：${detail.message}` : detail.message;
    })
    .filter((message): message is string => Boolean(message));
  const unique = [...new Set(messages)];
  return unique.length ? unique.join("；") : null;
}
