import type { InternalStaff } from "./api.ts";

export function shortAuditId(value: string | null | undefined): string {
  if (!value) return "—";
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function formatAuditTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

export function resolveAuditActor(
  actorId: string,
  staff: readonly InternalStaff[],
): { name: string; secondary: string } {
  const actor = staff.find((item) => item.userId === actorId);
  if (!actor) return { name: "系统任务", secondary: shortAuditId(actorId) };
  return { name: actor.displayName, secondary: actor.staffNo };
}
