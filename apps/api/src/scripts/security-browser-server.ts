import { secureBrowserFixture } from "./security-browser-fixture.js";
const fixture = await secureBrowserFixture();
process.stdout.write(JSON.stringify({ admin: fixture.admin, sibling: fixture.sibling, password: fixture.password }) + "\n");
process.stdin.once("data", () => { void fixture.close().then(() => process.exit(0)); });
process.on("SIGTERM", () => { void fixture.close().then(() => process.exit(0)); });
