import { Button } from "antd";
import type { ReactNode } from "react";
import { adminErrorText } from "./api.ts";

const requestIdPattern = /请求编号：([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;

function requestIdFrom(error: unknown): string | null {
  const value = error as { requestId?: unknown };
  return typeof value?.requestId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)
    ? value.requestId
    : null;
}

export function requestIdFromText(text: string): string | null {
  return text.match(requestIdPattern)?.[1] ?? null;
}

export async function copyAdminRequestId(requestId: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  await navigator.clipboard.writeText(requestId);
}

export function AdminErrorNotice({ text, requestId }: { text: string; requestId?: string | null }): ReactNode {
  if (!requestId) return text;
  return (
    <span>
      <span>{text}</span>{" "}
      <Button
        type="link"
        size="small"
        onClick={() => void copyAdminRequestId(requestId)}
        aria-label="复制排查编号"
      >
        复制排查编号
      </Button>
    </span>
  );
}

export function adminErrorNotice(error: unknown, text = adminErrorText(error)): ReactNode {
  const requestId = requestIdFrom(error) ?? requestIdFromText(text);
  return requestId ? <AdminErrorNotice text={text} requestId={requestId} /> : text;
}

export function adminErrorNoticeFromText(text: string): ReactNode {
  const requestId = requestIdFromText(text);
  return requestId ? <AdminErrorNotice text={text} requestId={requestId} /> : text;
}
