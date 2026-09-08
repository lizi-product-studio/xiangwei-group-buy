import { AsyncLocalStorage } from "node:async_hooks";
import mysql, {
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";
import { MemoryStore, STORE_READ_METHODS as READ_METHODS, type CommerceStore } from "./store.js";

type StateRow = RowDataPacket & { payload: string | Record<string, unknown> };
type StoreMethod = (...args: unknown[]) => unknown;

class AggregateSnapshot extends MemoryStore {
  public constructor(private readonly connection: PoolConnection, raw: string) {
    super(false);
    this.importState(raw);
  }
  public serialize(): string {
    return this.exportState();
  }
  public override async databaseNow(): Promise<string> {
    const [rows] = await this.connection.query<RowDataPacket[]>(
      "SELECT UTC_TIMESTAMP(3) AS now",
    );
    return new Date(rows[0]!.now as Date | string).toISOString();
  }
}

type Scope = {
  connection: PoolConnection;
  snapshot: AggregateSnapshot;
  readonly: boolean;
  active: boolean;
};

/** One aggregate row lock per write; independent immutable read scopes. */
export class MysqlStore extends MemoryStore implements CommerceStore {
  private readonly context = new AsyncLocalStorage<Scope>();
  private readonly facade: MysqlStore;
  private constructor(private readonly pool: Pool) {
    super(false);
    this.facade = new Proxy(this, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof property !== "string" || typeof value !== "function")
          return value;
        if (["transaction", "readSnapshot", "health", "databaseNow", "close"].includes(property))
          return (value as StoreMethod).bind(target);
        return (...args: unknown[]) => target.invoke(property, args);
      },
    });
    return this.facade;
  }
  public static create(databaseUrl: string): MysqlStore {
    return new MysqlStore(
      mysql.createPool({
        uri: databaseUrl,
        connectionLimit: 20,
        timezone: "Z",
        decimalNumbers: false,
        jsonStrings: true,
      }),
    );
  }
  private async load(connection: PoolConnection, readonly: boolean): Promise<AggregateSnapshot> {
    const [rows] = await connection.query<StateRow[]>(
      "SELECT payload FROM community_product_state WHERE id=1" + (readonly ? "" : " FOR UPDATE"),
    );
    if (!rows[0] && !readonly) {
      await connection.query(
        "INSERT INTO community_product_state(id,schema_version,payload,updated_at) VALUES(1,2,JSON_OBJECT(),UTC_TIMESTAMP(3))",
      );
    }
    const payload = rows[0]?.payload ?? "{}";
    return new AggregateSnapshot(connection, typeof payload === "string" ? payload : JSON.stringify(payload));
  }
  private currentScope(): Scope | undefined {
    const scope = this.context.getStore();
    if (scope && !scope.active) throw new Error("Aggregate scope has already completed");
    return scope;
  }
  private async invoke(property: string, args: unknown[]): Promise<unknown> {
    const scope = this.currentScope();
    if (scope) {
      if (scope.readonly && !READ_METHODS.has(property))
        throw new Error(`Readonly aggregate snapshot rejects ${property}`);
      const method = (MemoryStore.prototype as unknown as Record<string, StoreMethod>)[property];
      if (typeof method !== "function") throw new Error(`Unknown store method: ${property}`);
      return Reflect.apply(method, scope.snapshot, args);
    }
    const work = () => this.invoke(property, args);
    return READ_METHODS.has(property) ? this.readSnapshot(work) : this.transaction(work);
  }
  public override async readSnapshot<T>(work: (store: CommerceStore) => Promise<T>): Promise<T> {
    if (this.currentScope()) return work(this.facade);
    const connection = await this.pool.getConnection();
    let scope: Scope | undefined;
    try {
      scope = { connection, snapshot: await this.load(connection, true), readonly: true, active: true };
      return await this.context.run(scope, () => work(this.facade));
    } finally {
      if (scope) scope.active = false;
      connection.release();
    }
  }
  public override async transaction<T>(work: (store: CommerceStore) => Promise<T>): Promise<T> {
    const existing = this.currentScope();
    if (existing) {
      if (existing.readonly) throw new Error("Readonly aggregate snapshot rejects transaction");
      return work(this.facade);
    }
    const connection = await this.pool.getConnection();
    let scope: Scope | undefined;
    try {
      await connection.beginTransaction();
      scope = { connection, snapshot: await this.load(connection, false), readonly: false, active: true };
      // MemoryStore.transaction retains internal-write actor revision checks.
      const result = await this.context.run(scope, () => scope!.snapshot.transaction(() => work(this.facade)));
      await connection.query(
        "UPDATE community_product_state SET payload=?,updated_at=UTC_TIMESTAMP(3) WHERE id=1",
        [scope.snapshot.serialize()],
      );
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      if (scope) scope.active = false;
      connection.release();
    }
  }
  public override async health(): Promise<"ok"> {
    await this.pool.query("SELECT 1");
    return "ok";
  }
  public override async databaseNow(): Promise<string> {
    const connection = this.currentScope()?.connection ?? this.pool;
    const [rows] = await connection.query<RowDataPacket[]>("SELECT UTC_TIMESTAMP(3) AS now");
    return new Date(rows[0]!.now as Date | string).toISOString();
  }
  public override async close(): Promise<void> {
    await this.pool.end();
  }
}
