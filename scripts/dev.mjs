import { spawn } from "node:child_process";
import process from "node:process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const children = [];
const apiPort = process.env.DEV_API_PORT ?? process.env.PORT ?? "3100";
const adminPort = process.env.DEV_ADMIN_PORT ?? "5173";

function start(name, args, extraEnv = {}) {
  const child = spawn(pnpm, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  child.on("error", (error) => {
    globalThis.console.error(`[${name}] ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    if (code !== 0 && signal === null)
      globalThis.console.error(`[${name}] 已退出（${code ?? "未知"}）`);
  });
  children.push(child);
  return child;
}

start("api", ["dev:api"], {
  // `pnpm dev` is a dependency-free memory preview. Use `pnpm dev:api` when
  // intentionally running the configured MySQL/Redis environment instead.
  DATA_STORE: "memory",
  QUEUE_DRIVER: "memory",
  AUTH_PROVIDER: "demo",
  PAYMENT_PROVIDER: "mock",
  PORT: apiPort,
});
start(
  "admin",
  [
    "--filter",
    "@hometown/admin-web",
    "exec",
    "vite",
    "--host",
    "127.0.0.1",
    "--port",
    adminPort,
  ],
  {
  VITE_API_TARGET: `http://127.0.0.1:${apiPort}`,
  },
);

function shutdown(signal) {
  for (const child of children) child.kill(signal);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
