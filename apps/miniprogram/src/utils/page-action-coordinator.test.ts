import { describe, expect, it } from "vitest";
import { PageActionCoordinator, isOwnedAuthExpiry } from "./page-action-coordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("page action coordinator", () => {
  it("invalidates identity, repeated, and lifecycle actions", () => {
    const coordinator = new PageActionCoordinator();
    const first = coordinator.begin(1);
    expect(coordinator.isCurrent(first, 1)).toBe(true);
    const second = coordinator.begin(2);
    expect(coordinator.isCurrent(first, 1)).toBe(false);
    expect(coordinator.isCurrent(second, 2)).toBe(true);
    coordinator.invalidate();
    expect(coordinator.isCurrent(second, 2)).toBe(false);
  });
  it("classifies only the action's own cleared-session expiry", () => {
    const c = new PageActionCoordinator();
    const action = c.begin(4);
    expect(isOwnedAuthExpiry({ requestEpoch: 4, sessionWasCleared: true }, action, 5)).toBe(true);
    expect(isOwnedAuthExpiry({ requestEpoch: 3, sessionWasCleared: true }, action, 5)).toBe(false);
    expect(isOwnedAuthExpiry({ requestEpoch: 4, sessionWasCleared: false }, action, 5)).toBe(false);
    expect(isOwnedAuthExpiry({ requestEpoch: 4, sessionWasCleared: true }, action, 6)).toBe(false);
  });
  it("stops every deferred multi-stage chain after epoch, repeat, or hide", async () => {
    const c = new PageActionCoordinator();
    const create = deferred<string>();
    const action = c.begin(1);
    let payCalls = 0;
    create.promise.then(() => {
      if (!c.isCurrent(action, 1)) return;
      payCalls += 1;
    });
    c.begin(2); // identity switch invalidates A before create resolves
    create.resolve("order-A");
    await create.promise;
    expect(payCalls).toBe(0);

    const subscribe = deferred<string>();
    const messageAction = c.begin(2);
    let saveCalls = 0;
    subscribe.promise.then(() => {
      if (c.isCurrent(messageAction, 2)) saveCalls += 1;
    });
    c.invalidate(); // hide/unload boundary
    subscribe.resolve("accepted");
    await subscribe.promise;
    expect(saveCalls).toBe(0);
  });

  it("does not pay or clear the new account after checkout create resolves late", async () => {
    const c = new PageActionCoordinator();
    let epoch = 11;
    const loggedIn = true;
    const action = c.begin(epoch);
    const create = deferred<{ id: string }>();
    const pay = deferred<void>();
    const calls: string[] = [];
    let cart = "account-B-cart";
    let draft = "account-B-draft";
    const current = () => c.isCurrent(action, epoch) && loggedIn;
    const flow = (async () => {
      const order = await create.promise;
      if (!current()) return;
      calls.push(`pay:${order.id}`);
      await pay.promise;
      if (!current()) return;
      cart = "cleared";
      draft = "cleared";
    })();

    // Account A leaves while createOrder is still in flight. Account B has
    // already established a new epoch before A's response is released.
    epoch = 12;
    create.resolve({ id: "order-A" });
    await create.promise;
    await flow;
    expect(calls).toEqual([]);
    expect(cart).toBe("account-B-cart");
    expect(draft).toBe("account-B-draft");
  });

  it("stops a payment-stage continuation after the identity changes", async () => {
    const c = new PageActionCoordinator();
    let epoch = 21;
    const loggedIn = true;
    const action = c.begin(epoch);
    const payment = deferred<void>();
    const calls: string[] = [];
    let toastCount = 0;
    const current = () => c.isCurrent(action, epoch) && loggedIn;
    const flow = (async () => {
      calls.push("initiate");
      await payment.promise;
      if (!current()) return;
      calls.push("mockPay");
      if (!current()) return;
      toastCount += 1;
    })();

    // A's payment request resolves after B is active; no second provider call
    // or success feedback may be attributed to B.
    epoch = 22;
    payment.resolve();
    await flow;
    expect(calls).toEqual(["initiate"]);
    expect(toastCount).toBe(0);
  });

  it("does not save notification preferences after a late subscription result", async () => {
    const c = new PageActionCoordinator();
    let epoch = 31;
    const loggedIn = true;
    const action = c.begin(epoch);
    const subscription = deferred<Record<string, string>>();
    let saveCalls = 0;
    const current = () => c.isCurrent(action, epoch) && loggedIn;
    const flow = (async () => {
      const result = await subscription.promise;
      if (!current()) return;
      if (result.notice === "accept") saveCalls += 1;
    })();
    epoch = 32;
    subscription.resolve({ notice: "accept" });
    await flow;
    expect(saveCalls).toBe(0);
  });

  it("fences after-sale and service-area interest writes after hide/unload", async () => {
    for (const operation of ["after-sale", "service-area-interest"]) {
      const c = new PageActionCoordinator();
      const action = c.begin(41);
      const request = deferred<void>();
      let apiCalls = 0;
      let modalCalls = 0;
      const flow = (async () => {
        if (!c.isCurrent(action, 41)) return;
        apiCalls += 1;
        await request.promise;
        if (!c.isCurrent(action, 41)) return;
        modalCalls += 1;
      })();
      c.invalidate();
      request.resolve();
      await flow;
      expect(apiCalls, operation).toBe(1);
      expect(modalCalls, operation).toBe(0);
    }
  });

  it("keeps a newer action's loading state when an older finally runs", async () => {
    const c = new PageActionCoordinator();
    const oldAction = c.begin(51);
    const newAction = c.begin(51);
    let newActionLoading = true;
    const oldRequest = deferred<void>();
    const oldFlow = oldRequest.promise.finally(() => {
      if (c.isCurrent(oldAction, 51)) newActionLoading = false;
    });
    oldRequest.resolve();
    await oldFlow;
    expect(c.isCurrent(newAction, 51)).toBe(true);
    expect(newActionLoading).toBe(true);
  });
});
