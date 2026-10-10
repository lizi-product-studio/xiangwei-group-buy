import { createHash } from "node:crypto";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";

export function solveProof(challenge: string, bits: number): string {
  for (let nonce = 0; nonce < 100_000_000; nonce += 1) {
    const digest = createHash("sha256").update(`${challenge}:${nonce}`).digest();
    let valid = true;
    for (let bit = 0; bit < bits; bit += 1) if ((digest[Math.floor(bit / 8)]! & (128 >> (bit % 8))) !== 0) { valid = false; break; }
    if (valid) return String(nonce);
  }
  throw new Error("Proof budget exhausted");
}

/** Real HTTP cookies/proofs, without inserting or promoting sessions in storage. */
export class StaffHttpClient {
  private cookies = new Map<string, string>();
  private csrf = "";
  public constructor(private readonly app: FastifyInstance, public readonly origin = "http://localhost") {}
  public headers(): Record<string, string> {
    return { ...(this.origin.startsWith("https:") ? { "x-forwarded-proto": "https" } : {}), host: new URL(this.origin).host, origin: this.origin, cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "), "x-csrf-token": this.csrf };
  }
  public async send(options: InjectOptions): Promise<LightMyRequestResponse> {
    const response = await this.app.inject({ ...options, headers: { ...this.headers(), ...options.headers } });
    for (const cookie of response.cookies) {
      if (cookie.value) this.cookies.set(cookie.name, cookie.value); else this.cookies.delete(cookie.name);
    }
    if (response.statusCode === 200 && response.headers["content-type"]?.includes("application/json")) {
      const csrf = response.json().data?.csrfToken;
      if (csrf) this.csrf = csrf;
    }
    return response;
  }
  public async proof(purpose: "login" | "password" | "reauth", username = "") {
    const result = await this.send({ method: "POST", url: "/api/v1/auth/admin/challenge", payload: { purpose, username } });
    if (result.statusCode !== 200) throw new Error(`Challenge failed: ${result.body}`);
    const value = result.json().data as { challenge: string; bits: number };
    return { challenge: value.challenge, nonce: solveProof(value.challenge, value.bits) };
  }
  public async login(username: string, password: string) {
    return this.send({ method: "POST", url: "/api/v1/auth/admin/login", payload: { username, password, ...await this.proof("login", username) } });
  }
  public async complete(passwordChangeToken: string, newPassword: string) {
    return this.send({ method: "POST", url: "/api/v1/auth/admin/complete-password-change", payload: { passwordChangeToken, newPassword, ...await this.proof("password") } });
  }
  public async reauthenticate(password: string) {
    return this.send({ method: "POST", url: "/api/v1/auth/admin/reauthenticate", payload: { password, ...await this.proof("reauth") } });
  }
}
