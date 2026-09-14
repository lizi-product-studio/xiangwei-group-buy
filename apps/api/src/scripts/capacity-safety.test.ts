import { describe, expect, it } from "vitest";
import { assertCapacityIdentity, assertCapacityTarget, serverCapacityIdentity } from "./capacity-safety.js";

const server = {
  CAPACITY_PROFILE: serverCapacityIdentity.profile,
  INTEGRATION_DATABASE_URL: "mysql://readiness_runner:synthetic-password@readiness-mysql:3306/readiness_capacity_20260908",
  INTEGRATION_REDIS_URL: "redis://readiness-redis:6379/5",
};
describe("capacity target protection", () => {
  it("preserves the closed local default and requires an explicit server profile", () => {
    expect(assertCapacityTarget({INTEGRATION_DATABASE_URL: "mysql://local:password@127.0.0.1:13306/community_capacity_20260908", INTEGRATION_REDIS_URL: "redis://127.0.0.1:16379/5"}).server).toBe(false);
    expect(assertCapacityTarget(server).server).toBe(true);
    expect(() => assertCapacityTarget({...server, CAPACITY_PROFILE: undefined})).toThrow();
    expect(() => assertCapacityTarget({...server, CAPACITY_PROFILE: "custom"})).toThrow();
  });
  it.each([
    "mysql://readiness_runner:pass@192.144.136.205:3306/readiness_capacity_20260908",
    "mysql://readiness_runner:pass@180.76.100.156:3306/readiness_capacity_20260908",
    "mysql://root:pass@readiness-mysql:3306/readiness_capacity_20260908",
    "mysql://readiness_runner@readiness-mysql:3306/readiness_capacity_20260908",
    "mysql://readiness_runner:pass@readiness-mysql:3307/readiness_capacity_20260908",
    "mysql://readiness_runner:pass@readiness-mysql:3306/community",
    "https://readiness_runner:pass@readiness-mysql:3306/readiness_capacity_20260908",
    server.INTEGRATION_DATABASE_URL + "?database=production",
    server.INTEGRATION_DATABASE_URL + "#anything",
  ])("rejects unsafe MySQL URL %s", INTEGRATION_DATABASE_URL => {
    expect(() => assertCapacityTarget({...server, INTEGRATION_DATABASE_URL})).toThrow();
  });
  it.each([
    "redis://192.144.136.205:6379/5", "redis://readiness-redis:6379/0",
    "redis://readiness-redis:16379/5", "https://readiness-redis:6379/5",
    "redis://user:pass@readiness-redis:6379/5", "redis://readiness-redis:6379/5?db=0",
  ])("rejects unsafe Redis URL %s", INTEGRATION_REDIS_URL => {
    expect(() => assertCapacityTarget({...server, INTEGRATION_REDIS_URL})).toThrow();
  });
  it("fails closed on missing or mismatched database identity", () => {
    const row = {database_name: "readiness_capacity_20260908", database_user: "readiness_runner", task_id: serverCapacityIdentity.task, target: serverCapacityIdentity.target, profile: serverCapacityIdentity.profile, synthetic_only: 1};
    expect(() => assertCapacityIdentity([row])).not.toThrow();
    for (const key of Object.keys(row)) expect(() => assertCapacityIdentity([{...row, [key]: "wrong"}])).toThrow();
    expect(() => assertCapacityIdentity([])).toThrow();
    expect(() => assertCapacityIdentity([row, row])).toThrow();
  });
});
