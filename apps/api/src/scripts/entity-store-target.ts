export interface EntityStoreDatabaseIdentity {
  serverUuid: string;
  schemaName: string;
}

export interface ExpectedEntityStoreDatabaseIdentity {
  serverUuid: string;
  schemaName: string;
}

export function assertEntityStoreDatabaseIdentity(
  actual: EntityStoreDatabaseIdentity,
  expected: ExpectedEntityStoreDatabaseIdentity,
): void {
  const actualUuid = actual.serverUuid.trim().toLowerCase();
  const expectedUuid = expected.serverUuid.trim().toLowerCase();
  const actualSchema = actual.schemaName.trim();
  const expectedSchema = expected.schemaName.trim();
  if (!actualUuid || !expectedUuid || actualUuid !== expectedUuid)
    throw new Error("Connected MySQL server UUID does not match ENTITY_STORE_EXPECTED_SERVER_UUID");
  if (!actualSchema || !expectedSchema || actualSchema !== expectedSchema)
    throw new Error("Connected MySQL schema does not match ENTITY_STORE_EXPECTED_SCHEMA");
}
