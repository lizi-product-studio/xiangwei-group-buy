import { describe, expect, it } from "vitest";
import { operationalErrorDiagnostics, operationalErrorText } from "./operational-error.js";

describe("operational error redaction", () => {
  it("keeps a short provider diagnosis while removing sensitive fields", () => {
    const value = operationalErrorText(new Error(
      'provider timeout token=secret phoneNumber=13800138000 pickupCode=123456 https://provider.test/refund payload={"amount":100}',
    ));
    expect(value).toContain("provider timeout");
    expect(value).not.toContain("secret");
    expect(value).not.toContain("13800138000");
    expect(value).not.toContain("123456");
    expect(value).not.toContain("provider.test");
    expect(value).not.toContain('"amount":100');
  });

  it("preserves safe diagnosis text for queue triage", () => {
    expect(operationalErrorText(new Error("provider timeout"))).toBe("provider timeout");
  });

  it("keeps a bounded sanitized error name and stack for code diagnosis", () => {
    const error = new Error("provider timeout token=secret phoneNumber=13800138000");
    error.name = "ProviderError";
    const value = operationalErrorDiagnostics(error);
    expect(value.name).toBe("ProviderError");
    expect(value.message).toContain("provider timeout");
    expect(value.stack).toContain("ProviderError");
    expect(value.stack).not.toContain("secret");
    expect(value.stack).not.toContain("13800138000");
  });
});
