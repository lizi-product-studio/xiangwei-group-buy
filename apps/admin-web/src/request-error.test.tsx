import { describe, expect, it, vi } from "vitest";
import { AdminErrorNotice, adminErrorNotice, copyAdminRequestId } from "./request-error.tsx";

describe("admin request error notice", () => {
  it("renders a copy action only for a validated request id", () => {
    const safe = adminErrorNotice({ requestId: "123e4567-e89b-42d3-a456-426614174000" }, "请求失败");
    const unsafe = adminErrorNotice({ requestId: "provider-secret" }, "请求失败");
    expect(safe).toBeTruthy();
    expect(unsafe).toBe("请求失败");
    expect(AdminErrorNotice({ text: "请求失败", requestId: null })).toBe("请求失败");
  });

  it("copies only through the explicit browser clipboard action", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await copyAdminRequestId("123e4567-e89b-42d3-a456-426614174000");
    expect(writeText).toHaveBeenCalledWith("123e4567-e89b-42d3-a456-426614174000");
  });
});
