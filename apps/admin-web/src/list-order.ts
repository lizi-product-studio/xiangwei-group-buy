import type { Refund } from "./api.ts";

type Dated = { createdAt?: string };
type DateValue = string | null | undefined;

function byTime<T>(values: readonly T[], time: (value: T) => DateValue, direction: 1 | -1): T[] {
  return [...values].sort((a, b) => {
    const left = Date.parse(time(a) ?? "");
    const right = Date.parse(time(b) ?? "");
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
    if (!Number.isFinite(right)) return -1;
    return direction * (left - right);
  });
}

export function newestFirst<T extends Dated>(values: readonly T[], time: (value: T) => DateValue = value => value.createdAt): T[] {
  return byTime(values, time, -1);
}

export function earliestFirst<T>(values: readonly T[], time: (value: T) => DateValue): T[] {
  return byTime(values, time, 1);
}

export function refundHistory(refunds: { full: Refund[]; partial: Refund[] } | null) {
  return newestFirst([
    ...(refunds?.full ?? []).map(value => ({ ...value, refundType: "整单退款" })),
    ...(refunds?.partial ?? []).map(value => ({ ...value, refundType: "部分退款" })),
  ]);
}
