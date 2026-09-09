import { AsyncLocalStorage } from "node:async_hooks";
import mysql, {
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";
import { MemoryStore, type CommerceStore } from "./store.js";

type StateRow = RowDataPacket & { payload: string | Record<string, unknown> };
type StoreMethod = (...args: unknown[]) => unknown;

/**
 * MySQL-backed aggregate store.
 *
 * The community product is persisted as one versioned aggregate document and
 * guarded by an InnoDB row lock. This keeps every payment, allocation, pickup,
 * refund, ledger and outbox transition atomic across API instances while the
 * product is still operated as one community programme. The clean baseline can
 * later split hot aggregates without retaining any obsolete business model.
 */
export class MysqlStore extends MemoryStore implements CommerceStore {
  private readonly context = new AsyncLocalStorage<PoolConnection>();
  private constructor(private readonly pool: Pool) {
    super(false);
    return new Proxy(this, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof property !== "string" || typeof value !== "function")
          return value;
        if (
          ["transaction", "health", "databaseNow", "close"].includes(property)
        )
          return (value as StoreMethod).bind(target);
        return (...args: unknown[]) => target.invoke(property, args);
      },
    });
  }
  public static create(databaseUrl: string): MysqlStore {
    return new MysqlStore(
      mysql.createPool({
        uri: databaseUrl,
        connectionLimit: 20,
        timezone: "Z",
        decimalNumbers: false,
      }),
    );
  }
  private async load(connection: PoolConnection): Promise<void> {
    const [rows] = await connection.query<StateRow[]>(
      "SELECT payload FROM community_product_state WHERE id=1 FOR UPDATE",
    );
    if (!rows[0]) {
      await connection.query(
        "INSERT INTO community_product_state(id,schema_version,payload,updated_at) VALUES(1,2,JSON_OBJECT(),UTC_TIMESTAMP(3))",
      );
      this.importState("{}");
      return;
    }
    const payload = rows[0].payload;
    this.importState(
      typeof payload === "string" ? payload : JSON.stringify(payload),
    );
  }
  private async persist(connection: PoolConnection, payload: string): Promise<void> {
    await connection.query(
      "UPDATE community_product_state SET payload=?,updated_at=UTC_TIMESTAMP(3) WHERE id=1",
      [payload],
    );
  }
  private async invoke(property: string, args: unknown[]): Promise<unknown> {
    if (this.context.getStore())
      return Reflect.apply(
        (MemoryStore.prototype as unknown as Record<string, StoreMethod>)[
          property
        ]!,
        this,
        args,
      );
    return this.transaction(async () =>
      Reflect.apply(
        (MemoryStore.prototype as unknown as Record<string, StoreMethod>)[
          property
        ]!,
        this,
        args,
      ),
    );
  }
  public override async transaction<T>(
    work: (store: CommerceStore) => Promise<T>,
  ): Promise<T> {
    if (this.context.getStore()) return work(this);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.load(connection);
      const stateBeforeWork = this.exportState();
      const result = await this.context.run(connection, () =>
        super.transaction(() => work(this)),
      );
      const stateAfterWork = this.exportState();
      if (stateAfterWork !== stateBeforeWork)
        await this.persist(connection, stateAfterWork);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  public override async health(): Promise<"ok"> {
    await this.pool.query("SELECT 1");
    return "ok";
  }
  public override async databaseNow(): Promise<string> {
    const connection = this.context.getStore() ?? this.pool;
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT UTC_TIMESTAMP(3) AS now",
    );
    return new Date(rows[0]!.now as Date | string).toISOString();
  }
  public override async close(): Promise<void> {
    await this.pool.end();
  }
}
