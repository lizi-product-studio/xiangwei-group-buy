import { describe, expect, it } from "vitest";
import { PageLoadCoordinator, isCurrentPageLoad } from "./page-load-guard";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("page load guard", () => {
  it("drops late identity, generation, and lifecycle responses", () => {
    const coordinator = new PageLoadCoordinator();
    const a = coordinator.begin(1);
    expect(coordinator.isCurrent(a, 1)).toBe(true);
    const b = coordinator.begin(2);
    expect(coordinator.isCurrent(a, 1)).toBe(false);
    expect(coordinator.isCurrent(b, 2)).toBe(true);
    coordinator.hide();
    expect(coordinator.isCurrent(b, 2)).toBe(false);
    expect(coordinator.isLive(b)).toBe(false);
    coordinator.show();
    expect(coordinator.isCurrent(b, 2)).toBe(false);
    const c = coordinator.begin(2);
    coordinator.unload();
    expect(coordinator.isCurrent(c, 2)).toBe(false);
    expect(coordinator.isLive(c)).toBe(false);
  });

  it("keeps lifecycle ownership after an epoch changes for a live page", () => {
    const coordinator = new PageLoadCoordinator();
    const guard = coordinator.begin(1);
    expect(coordinator.isCurrent(guard, 1)).toBe(true);
    expect(coordinator.isLive(guard)).toBe(true);
    expect(coordinator.isCurrent(guard, 2)).toBe(false);
    expect(coordinator.isLive(guard)).toBe(true);
  });

  it("requires all three dimensions to match", () => {
    const guard = { epoch: 3, generation: 4, isActive: true };
    expect(isCurrentPageLoad(guard, { epoch: 3, generation: 4, active: true })).toBe(true);
    expect(isCurrentPageLoad(guard, { epoch: 2, generation: 4, active: true })).toBe(false);
    expect(isCurrentPageLoad(guard, { epoch: 3, generation: 5, active: true })).toBe(false);
    expect(isCurrentPageLoad(guard, { epoch: 3, generation: 4, active: false })).toBe(false);
  });

  it("drops a late success, error, and finally after logout", async () => {
    const coordinator = new PageLoadCoordinator();
    const pending = deferred<string>();
    const state = { data: "guest", error: "", loading: false };
    const guard = coordinator.begin(1);
    state.loading = true;
    coordinator.hide();
    pending.resolve("account A");
    await pending.promise.then(
      (value) => {
        if (coordinator.isCurrent(guard, 1)) state.data = value;
      },
      (error: unknown) => {
        if (coordinator.isCurrent(guard, 1)) state.error = String(error);
      },
    ).finally(() => {
      if (coordinator.isCurrent(guard, 1)) state.loading = false;
    });
    expect(state).toEqual({ data: "guest", error: "", loading: true });
  });

  it("lets the newest identity and generation win regardless of completion order", async () => {
    const coordinator = new PageLoadCoordinator();
    const first = deferred<string>();
    const second = deferred<string>();
    const state = { data: "guest", error: "", loading: false };
    const firstGuard = coordinator.begin(1);
    const secondGuard = coordinator.begin(2);
    const apply = (guard: ReturnType<PageLoadCoordinator["begin"]>, value: string) => {
      if (coordinator.isCurrent(guard, guard.epoch)) state.data = value;
    };
    const firstResult = first.promise.then((value) => apply(firstGuard, value));
    const secondResult = second.promise.then((value) => apply(secondGuard, value));
    second.resolve("account B");
    await secondResult;
    first.resolve("account A");
    await firstResult;
    expect(state.data).toBe("account B");
  });

  it("does not allow a stale error/finally or cache write to affect a newer load", async () => {
    const coordinator = new PageLoadCoordinator();
    const oldLoad = deferred<string>();
    const newLoad = deferred<string>();
    const state = { data: "guest", error: "", loading: true, cache: "" };
    const oldGuard = coordinator.begin(7);
    const newGuard = coordinator.begin(7);
    const apply = (guard: ReturnType<PageLoadCoordinator["begin"]>, value: string) => {
      if (coordinator.isCurrent(guard, 7)) {
        state.data = value;
        state.cache = value;
      }
    };
    const oldResult = oldLoad.promise.then(
      (value) => apply(oldGuard, value),
      (error: unknown) => {
        if (coordinator.isCurrent(oldGuard, 7)) state.error = String(error);
      },
    ).finally(() => {
      if (coordinator.isCurrent(oldGuard, 7)) state.loading = false;
    });
    const newResult = newLoad.promise.then((value) => apply(newGuard, value));
    newLoad.resolve("new");
    await newResult;
    oldLoad.reject(new Error("old response"));
    await oldResult;
    expect(state).toEqual({ data: "new", error: "", loading: true, cache: "new" });
  });

  it("invalidates late work when a page unloads, including after a show", async () => {
    const coordinator = new PageLoadCoordinator();
    const pending = deferred<string>();
    const state = { data: "before" };
    const guard = coordinator.begin(3);
    coordinator.unload();
    coordinator.show();
    pending.resolve("late");
    await pending.promise.then((value) => {
      if (coordinator.isCurrent(guard, 3)) state.data = value;
    });
    expect(state.data).toBe("before");
  });
});
