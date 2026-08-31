const YUAN_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

/**
 * Converts a user-entered yuan amount to the integer cents used by the API.
 * The conversion deliberately avoids floating-point arithmetic.
 */
export function yuanToCents(value: string): number {
  const normalized = value.trim();
  const match = YUAN_PATTERN.exec(normalized);
  if (!match) {
    throw new Error("请输入最多两位小数的元金额");
  }

  const yuan = BigInt(match[1]!);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const cents = yuan * 100n + BigInt(fraction || "0");
  if (cents <= 0n) {
    throw new Error("售价必须大于 0 元");
  }
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("售价超出系统可处理范围");
  }
  return Number(cents);
}

export function validateYuanInput(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return "请输入售价";
  try {
    yuanToCents(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "售价格式不正确";
  }
}

export function centsToYuan(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("分金额必须是安全的非负整数");
  }
  const yuan = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${yuan}.${fraction}`;
}
