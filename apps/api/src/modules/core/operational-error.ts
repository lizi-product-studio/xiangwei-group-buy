const sensitiveKeyPattern = /authorization|token|secret|password|openid|phone(?:number)?|pickup(?:code|request)|clientpayload|providercontext|payload|apiv3key|privatekey/i;

/** Keep operational queues/logs useful without retaining provider secrets or payloads. */
export function operationalErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = raw
    .replace(/bearer\s+[^\s,}]+/gi, "Bearer [REDACTED]")
    .replace(/https?:\/\/[^\s,}]+/gi, "[URL]")
    .replace(/(["']?[^\s:=,{}"']+["']?)\s*[:=]\s*(["'][^"']*["']|[^\s,}]+)/g, (full, key: string, value: string) =>
      sensitiveKeyPattern.test(key) ? `${key}=[REDACTED]` : `${key}=${value}`,
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return redacted || "operation failed";
}

export function operationalErrorDiagnostics(error: unknown): {
  name: string;
  message: string;
  stack: string | undefined;
} {
  const name = error instanceof Error && error.name
    ? error.name.replace(/[^a-zA-Z0-9_$.-]/g, "_").slice(0, 80)
    : "Error";
  const stack = error instanceof Error && error.stack
    ? error.stack
        .split("\n")
        .slice(0, 8)
        .map((line) => operationalErrorText(new Error(line)))
        .join("\n")
        .slice(0, 1600)
    : undefined;
  return { name, message: operationalErrorText(error), stack };
}
