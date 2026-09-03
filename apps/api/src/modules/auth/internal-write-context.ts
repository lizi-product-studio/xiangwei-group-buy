import { AsyncLocalStorage } from "node:async_hooks";
import type { Actor } from "./auth.js";

const storage = new AsyncLocalStorage<Actor | null>();

export function runWithInternalWriteActor<T>(actor: Actor | null, work: () => T): T {
  return storage.run(actor?.authorizationVersion === undefined ? null : actor, work);
}

export function getCurrentInternalWriteActor(): Actor | null {
  return storage.getStore() ?? null;
}
