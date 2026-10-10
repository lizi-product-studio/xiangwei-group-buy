import { createHash } from "node:crypto";
import { test as base, request as requestFactory, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

type Options = NonNullable<Parameters<APIRequestContext["fetch"]>[1]>;
type Account = { context: APIRequestContext; origin: string; csrf: string; password: string };
const accounts = new WeakMap<APIRequestContext, Account>();
const responses = new WeakMap<APIResponse, Account>();
const contexts = new Set<APIRequestContext>();
const solve = (challenge: string, bits: number): string => {
  for (let nonce = 0; nonce < 100_000_000; nonce++) {
    const digest = createHash("sha256").update(`${challenge}:${nonce}`).digest();
    if (Array.from({ length: bits }, (_, bit) => digest[Math.floor(bit / 8)]! & (128 >> bit % 8)).every(value => value === 0)) return String(nonce);
  }
  throw new Error("Challenge exhausted");
};
async function proof(account: Account, purpose: string, username = "") {
  const response = await account.context.post(`${account.origin}/api/v1/auth/admin/challenge`, { headers: { origin: account.origin, "x-csrf-token": account.csrf }, data: { purpose, username } });
  if (!response.ok()) throw new Error(`Challenge failed ${response.status()}: ${await response.text()}`);
  const value = (await response.json()).data;
  return { challenge: value.challenge, nonce: solve(value.challenge, value.bits) };
}

/** Isolated cookie jars keep fixture identities separate and never turn a
 * subsequent demo fixture request into the last logged-in employee. */
export async function staffFetch(request: APIRequestContext, url: string, options: Options): Promise<APIResponse> {
  const path = new URL(url).pathname;
  if (!path.startsWith("/api/v1/auth/admin/")) return request.fetch(url, options);
  const body = options.data as Record<string, string>;
  let account = accounts.get(request);
  if (path.endsWith("/login") || !account) {
    const context = await requestFactory.newContext(); contexts.add(context);
    account = { context, origin: new URL(url).origin, csrf: "", password: body.password ?? "" };
    accounts.set(request, account);
  }
  const purpose = path.endsWith("/login") ? "login" : "password";
  const response = await account.context.fetch(url, { ...options, headers: { ...options.headers, origin: account.origin, "x-csrf-token": account.csrf }, data: { ...body, ...await proof(account, purpose, body.username) } });
  if (response.ok()) {
    const value = (await response.json()).data;
    if (value.csrfToken) {
      account.csrf = value.csrfToken;
      account.password = body.newPassword ?? body.password ?? account.password;
      // Fixture consumers need a recently authenticated cookie for sensitive
      // setup/API assertions; this uses the same public password/proof route.
      const reauth = await account.context.post(`${account.origin}/api/v1/auth/admin/reauthenticate`, { headers: { origin: account.origin, "x-csrf-token": account.csrf }, data: { password: account.password, ...await proof(account, "reauth") } });
      if (!reauth.ok()) throw new Error(`Fixture reauthentication failed: ${await reauth.text()}`);
      account.csrf = (await reauth.json()).data.csrfToken;
    }
  }
  responses.set(response, account);
  return response;
}
export async function staffHeaders(response: APIResponse): Promise<Record<string, string>> {
  const account = responses.get(response);
  if (!account) throw new Error("No cookie identity for fixture response");
  const state = await account.context.storageState();
  return { origin: account.origin, "x-csrf-token": account.csrf, cookie: state.cookies.map(value => `${value.name}=${value.value}`).join("; "), "content-type": "application/json" };
}
export async function loginBrowser(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("账号").fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: /登\s*录/ }).click();
}

export const test = base.extend({
  page: async ({ page }, use) => {
    let password = "";
    page.on("request", request => {
      if (request.method() !== "POST") return;
      const path = new URL(request.url()).pathname;
      if (path === "/api/v1/auth/admin/login") password = request.postDataJSON()?.password ?? password;
      if (path === "/api/v1/auth/admin/complete-password-change" || path === "/api/v1/admin/me/change-password") password = request.postDataJSON()?.newPassword ?? password;
    });
    await page.addLocatorHandler(page.getByRole("dialog", { name: "验证登录密码" }), async () => {
      if (!password) throw new Error("Test did not establish a password identity");
      const dialog = page.getByRole("dialog", { name: "验证登录密码" });
      await dialog.getByLabel("当前登录密码").fill(password);
      await dialog.getByRole("button", { name: "验证并继续" }).click();
      await dialog.waitFor({ state: "hidden" });
    });
    await use(page);
  },
});
test.afterEach(async () => { for (const context of contexts) await context.dispose(); contexts.clear(); });
