import { describe, expect, it } from "vitest";
import { assertEntityStoreDatabaseIdentity } from "./entity-store-target.js";

const production = { serverUuid: "11111111-1111-4111-8111-111111111111", schemaName: "hometown_food" };

describe("Entity Store migration target binding", () => {
  it("accepts the configured MySQL server UUID and schema", () => {
    expect(() => assertEntityStoreDatabaseIdentity(
      { serverUuid: production.serverUuid.toUpperCase(), schemaName: production.schemaName },
      production,
    )).not.toThrow();
  });

  it("fails closed when the connected server UUID differs", () => {
    expect(() => assertEntityStoreDatabaseIdentity(
      { serverUuid: "test-server-uuid", schemaName: production.schemaName },
      production,
    )).toThrow(/server UUID/);
  });

  it("fails closed when the connected schema differs", () => {
    expect(() => assertEntityStoreDatabaseIdentity(
      { serverUuid: production.serverUuid, schemaName: "test_schema" },
      production,
    )).toThrow(/schema/);
  });
});
