import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginProtection, type ChallengeContext } from "./login-protection.js";
import { solveProof } from "./staff-http.test-helper.js";

const context: ChallengeContext = { origin: "https://admin.liziqi.icu", browser: "synthetic-context", subject: "synthetic-user", purpose: "login" };
describe("bounded password work admission", () => {
  afterEach(() => vi.useRealTimers());
  it("caps same-IP and total expensive work without creating a retry timer or account lock", async () => {
    const protection = new LoginProtection(8);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const work = vi.fn(() => gate);
    const run = (ip: string, pending = true) => {
      const challenge = protection.issue(context);
      return protection.run(context, challenge.challenge, solveProof(challenge.challenge, challenge.bits), ip, pending ? work : async () => "success");
    };
    const active = [run("ip1"), run("ip1"), run("ip2"), run("ip2")];
    expect(work).toHaveBeenCalledTimes(4);
    await expect(run("ip3")).rejects.toMatchObject({ code: "AUTH_BUSY", statusCode: 503 });
    release(); await Promise.all(active);
    await expect(run("ip1", false)).resolves.toBe("success");
    expect(work).toHaveBeenCalledTimes(4);
  });
  it("preserves internal work failures for diagnostics and releases admission immediately", async () => {
    const protection = new LoginProtection(8); const error = new Error("synthetic persistence failure");
    const first = protection.issue(context);
    await expect(protection.run(context, first.challenge, solveProof(first.challenge, 8), "ip", async () => { throw error; })).rejects.toBe(error);
    const next = protection.issue(context);
    await expect(protection.run(context, next.challenge, solveProof(next.challenge, 8), "ip", async () => "recovered")).resolves.toBe("recovered");
  });
  it("requires the production-strength work rather than trusting a claimed difficulty", async () => {
    const protection = new LoginProtection(18);
    const issued = protection.issue(context);
    expect(issued.bits).toBe(18);
    const work = vi.fn(async () => "ok");
    await expect(protection.run(context, issued.challenge, solveProof(issued.challenge, 18), "ip", work)).resolves.toBe("ok");
    await expect(protection.run(context, issued.challenge, "0", "ip", work)).rejects.toMatchObject({ code: "AUTH_CHALLENGE_INVALID" });
    expect(work).toHaveBeenCalledTimes(1);
  });
});
