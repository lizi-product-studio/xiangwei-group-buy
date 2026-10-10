import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
export async function secureBrowserFixture(): Promise<{ admin: string; sibling: string; password: string; close: () => Promise<void> }> {
  const require = createRequire(resolve("apps/api/package.json"));
  const child = spawn(process.execPath, ["--import", require.resolve("tsx"), resolve("apps/api/src/scripts/security-browser-server.ts")], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", value => { stderr += String(value); });
  const value = await new Promise<{ admin: string; sibling: string; password: string }>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`TLS fixture startup timeout: ${stderr}`)); }, 20000);
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`TLS fixture exit ${code}: ${stderr}`)); });
    let output = "";
    child.stdout.on("data", chunk => {
      output += String(chunk);
      if (output.includes("\n")) { clearTimeout(timer); try { resolve(JSON.parse(output.split("\n")[0]!)); } catch (error) { child.kill(); reject(error); } }
    });
  });
  return { ...value, close: () => new Promise<void>(resolve => { child.once("exit", () => resolve()); child.stdin.end("close\n"); }) };
}
