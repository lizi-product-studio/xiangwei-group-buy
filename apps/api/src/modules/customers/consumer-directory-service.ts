import { BusinessError } from "@hometown/domain";
import type { CommerceStore } from "../core/store.js";
import type { User } from "../core/types.js";

const REPAIR_PAGE_SIZE = 500;

function validConsumerNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

function assertNoDuplicateConsumerNumbers(duplicate: boolean): void {
  if (duplicate)
    throw new BusinessError(
      "INTEGRITY_VIOLATION",
      "用户ID重复，已停止返回用户列表",
      500,
    );
}

/**
 * Repairs historical consumers in bounded batches. The Entity Store query
 * returns at most 500 missing-number rows per round; ordinary login never
 * calls this collection-wide repair.
 */
export async function ensureConsumerPublicNumbers(store: CommerceStore): Promise<void> {
  let checkedForDuplicates = false;
  for (;;) {
    const missing = await store.listConsumerUsersMissingPublicNumbers(REPAIR_PAGE_SIZE);
    if (!missing.length) return;
    if (!checkedForDuplicates) {
      assertNoDuplicateConsumerNumbers(await store.hasDuplicateConsumerPublicNumbers());
      checkedForDuplicates = true;
    }
    await store.transaction(async (transactionStore) => {
      for (const candidate of missing) {
        const user = await transactionStore.getUser(candidate.id);
        if (!user || user.wechatOpenId === null) continue;
        if (user.consumerNumber !== undefined) {
          if (!validConsumerNumber(user.consumerNumber))
            throw new BusinessError("INTEGRITY_VIOLATION", "用户ID无效，已停止返回用户列表", 500);
          continue;
        }
        const consumerNumber = await transactionStore.allocateConsumerPublicNumber(user.id);
        await transactionStore.saveUser({ ...user, consumerNumber });
      }
    });
  }
}

/** Repair only the authenticated consumer when that legacy profile lacks a number. */
export async function ensureConsumerPublicNumber(store: CommerceStore, userId: string): Promise<User | null> {
  const current = await store.getUser(userId);
  if (!current || current.wechatOpenId === null) return current;
  if (current.consumerNumber !== undefined) {
    if (!validConsumerNumber(current.consumerNumber))
      throw new BusinessError("INTEGRITY_VIOLATION", "用户ID无效", 500);
    return current;
  }
  return store.transaction(async (transactionStore) => {
    const user = await transactionStore.getUser(userId);
    if (!user || user.wechatOpenId === null) return user;
    if (user.consumerNumber !== undefined) {
      if (!validConsumerNumber(user.consumerNumber))
        throw new BusinessError("INTEGRITY_VIOLATION", "用户ID无效", 500);
      return user;
    }
    const consumerNumber = await transactionStore.allocateConsumerPublicNumber(user.id);
    const repaired = { ...user, consumerNumber };
    await transactionStore.saveUser(repaired);
    return repaired;
  });
}
