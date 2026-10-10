import { createServer, type Server } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, extname, join } from "node:path";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { MemoryStore } from "../modules/core/store.js";
import { createAdminCredential } from "../modules/auth/admin-auth.js";

/** Local TLS/static-artifact harness. Loads the exact deployment header values;
 * Nginx syntax and deployed header inheritance are separately checked on the test host. */
export async function secureBrowserFixture() {
  const directory = await mkdtemp(join(tmpdir(), "hometown-browser-security-"));
  const key = join(directory, "test.key"); const cert = join(directory, "test.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
  const store = new MemoryStore(false); const now = new Date().toISOString();
  const password = "synthetic TLS browser password";
  for (const [username, role] of [["tls.admin", "SUPER_ADMIN"], ["tls.finance", "FINANCE"]] as const) {
    await store.saveUser({ id: username, wechatOpenId: null, status: "ACTIVE", createdAt: now });
    await store.saveInternalStaff({ userId: username, staffNo: username, displayName: username, phone: "13800138000", role, status: "ACTIVE", createdBy: null, activatedAt: now, suspendedAt: null, suspensionReason: null, authorizationVersion: 1, createdAt: now, updatedAt: now });
    await store.saveAdminCredential(await createAdminCredential(username, username, password, [role]));
  }
  const app = await buildApp({ store, config: loadConfig({ NODE_ENV: "test", REQUIRE_HTTPS: "true", STAFF_CHALLENGE_BITS: "18", PRODUCT_IMAGE_DIR: join(directory, "images") }) });
  for (const [id, phone, consumerNumber] of [["tls.consumer.one", "13800138010", 1], ["tls.consumer.two", "13900139010", 2]] as const) {
    await store.saveUser({ id, wechatOpenId: `synthetic-${id}`, phoneNumber: phone, phoneVerifiedAt: now, consumerNumber, status: "ACTIVE", createdAt: now });
  }
  const fixtureHeaders = { "x-demo-user-id": "synthetic-fixture", "x-demo-role": "SUPER_ADMIN", "x-forwarded-proto": "https" };
  const upload = await app.inject({ method: "POST", url: "/api/v1/admin/product-images", headers: { ...fixtureHeaders, "content-type": "image/png" }, payload: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4EGQERAwQCgArtgXRlFwMYgAAAABJRU5ErkJggg==", "base64") });
  if (upload.statusCode !== 201) throw new Error("Synthetic image fixture failed");
  const product = await app.inject({ method: "POST", url: "/api/v1/admin/catalog/skus", headers: fixtureHeaders, payload: { title: "合成图片验收商品", category: "蔬菜", origin: "合成测试", imageUrl: upload.json().data.imageUrl, skuName: "一份", retailPriceCents: 100, defaultSellableQuantity: 1, status: "ACTIVE" } });
  if (product.statusCode !== 201) throw new Error("Synthetic catalog fixture failed");
  const nginx = await readFile(resolve("infra/nginx.host-api.conf"), "utf8");
  const headers: Record<string, string> = {};
  for (const name of ["Content-Security-Policy", "X-Frame-Options", "Strict-Transport-Security", "Referrer-Policy", "Permissions-Policy"]) {
    const values = [...nginx.matchAll(new RegExp(`add_header ${name} (?:"([^"]+)"|([^;]+)) always;`, "g"))].map(match => match[1] ?? match[2]!);
    if (!values.length || new Set(values).size !== 1) throw new Error(`Missing/inconsistent deployment header ${name}`);
    headers[name] = values[0]!;
  }
  const root = resolve("apps/admin-web/dist");
  await readFile(join(root, "index.html"));
  const mime: Record<string, string> = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
  const server: Server = createServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
    void (async () => {
      if (request.url?.startsWith("/api/")) {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const value = await app.inject({ method: request.method as "GET" | "POST", url: request.url, headers: { ...request.headers, "x-forwarded-proto": "https" }, ...(chunks.length ? { payload: Buffer.concat(chunks) } : {}) });
        response.writeHead(value.statusCode, { ...value.headers, ...headers }); response.end(value.rawPayload); return;
      }
      const pathname = new URL(request.url ?? "/", "https://localhost").pathname;
      const path = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!path.startsWith(`${root}/`)) { response.writeHead(404); response.end(); return; }
      const body = await readFile(path);
      response.writeHead(200, { ...headers, "content-type": mime[extname(path)] ?? "application/octet-stream" }); response.end(body);
    })().catch(() => { response.writeHead(404); response.end(); });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("TLS server unavailable");
  const port = address.port;
  return { password, admin: `https://localhost:${port}`, sibling: `https://127.0.0.1:${port}`, store,
    close: async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await app.close(); await rm(directory, { recursive: true, force: true }); },
  };
}
