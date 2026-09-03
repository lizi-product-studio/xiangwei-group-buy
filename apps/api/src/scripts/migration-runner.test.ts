import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyMigration, type MigrationConnection } from "./migration-runner.js";

function connectionStub() {
  const calls: string[] = [];
  const connection: MigrationConnection = {
    beginTransaction: vi.fn(async () => calls.push("begin")),
    commit: vi.fn(async () => calls.push("commit")),
    rollback: vi.fn(async () => calls.push("rollback")),
    query: vi.fn(async () => calls.push("migration")),
    execute: vi.fn(async (sql) => {
      calls.push(sql.includes("'FAILED'") ? "record-failed" : "record-applied");
    }),
  };
  return { connection, calls };
}

describe("migration runner", () => {
  it("keeps the password lifecycle SQL free of nested transaction control", async () => {
    const sql = await readFile(
      resolve(process.cwd(), "../../infra/mysql/migrations/0003_admin_password_lifecycle.sql"),
      "utf8",
    );
    expect(sql).not.toMatch(/\b(?:START\s+TRANSACTION|COMMIT|ROLLBACK)\b/i);
  });

  it("commits the migration and APPLIED record together", async () => {
    const { connection, calls } = connectionStub();
    await applyMigration(connection, "0003.sql", "checksum", "UPDATE state");
    expect(calls).toEqual(["begin", "migration", "record-applied", "commit"]);
  });

  it("rolls back first and persists FAILED in a fresh transaction", async () => {
    const { connection, calls } = connectionStub();
    vi.mocked(connection.query).mockImplementationOnce(async () => {
      calls.push("migration");
      throw new Error("injected migration failure");
    });
    await expect(
      applyMigration(connection, "0003.sql", "checksum", "UPDATE state"),
    ).rejects.toThrow("injected migration failure");
    expect(calls).toEqual([
      "begin",
      "migration",
      "rollback",
      "begin",
      "record-failed",
      "commit",
    ]);
  });

  it("surfaces both failures when the FAILED record cannot be persisted", async () => {
    const { connection } = connectionStub();
    vi.mocked(connection.query).mockRejectedValueOnce(new Error("migration failed"));
    vi.mocked(connection.execute).mockRejectedValueOnce(new Error("failed record unavailable"));
    await expect(
      applyMigration(connection, "0003.sql", "checksum", "UPDATE state"),
    ).rejects.toThrow("FAILED 状态无法持久化");
  });
});
