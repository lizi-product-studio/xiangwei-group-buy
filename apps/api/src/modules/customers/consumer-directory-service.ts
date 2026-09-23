import { BusinessError } from "@hometown/domain";
import type { CommerceStore } from "../core/store.js";
import type { User } from "../core/types.js";

function validConsumerNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

/** Backfills consumers created by an older application under the aggregate write lock. */
export async function ensureConsumerPublicNumbers(
  store: CommerceStore,
): Promise<User[]> {
  const current = await store.listConsumerUsers();
  const seen = new Set<number>();
  for (const user of current) {
    if (!validConsumerNumber(user.consumerNumber)) continue;
    if (seen.has(user.consumerNumber))
      throw new BusinessError(
        "INTEGRITY_VIOLATION",
        "用户ID重复，已停止返回用户列表",
        500,
      );
    seen.add(user.consumerNumber);
  }
  if (current.every((user) => validConsumerNumber(user.consumerNumber)))
    return current;

  return store.transaction(async (transactionStore) => {
    const users = await transactionStore.listConsumerUsers();
    const numbers = new Set<number>();
    for (const user of users) {
      if (!validConsumerNumber(user.consumerNumber)) continue;
      if (numbers.has(user.consumerNumber))
        throw new BusinessError(
          "INTEGRITY_VIOLATION",
          "用户ID重复，已停止返回用户列表",
          500,
        );
      numbers.add(user.consumerNumber);
    }
    const missing = users
      .filter((user) => !validConsumerNumber(user.consumerNumber))
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
    for (const user of missing) {
      const consumerNumber =
        await transactionStore.allocateConsumerPublicNumber(user.id);
      await transactionStore.saveUser({ ...user, consumerNumber });
    }
    return transactionStore.listConsumerUsers();
  });
}

export function findConsumerByPublicNumber(
  users: readonly User[],
  number: number,
): User | null {
  return users.find((user) => user.consumerNumber === number) ?? null;
}
