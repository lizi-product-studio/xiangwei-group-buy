import { beforeEach, describe, expect, it, vi } from "vitest";

const listPickupPoints = vi.fn();

vi.mock("./api", () => ({ api: { listPickupPoints } }));

describe("pickup-point selection refresh", () => {
  const storage = new Map<string, unknown>();

  beforeEach(() => {
    vi.resetModules();
    listPickupPoints.mockReset();
    storage.clear();
    vi.stubGlobal("wx", {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
    });
  });

  it("replaces a cached pickup-point snapshot with the latest server data", async () => {
    storage.set("selectedPickupPoint", {
      id: "point-1",
      serviceAreaId: "area-1",
      name: "旧名称",
      address: "旧地址",
      status: "ACTIVE",
    });
    listPickupPoints.mockResolvedValueOnce([{
      id: "point-1",
      serviceAreaId: "area-1",
      name: "新名称",
      address: "新地址",
      status: "ACTIVE",
    }]);
    const { loadPickupPoints } = await import("./pickup-point");

    const result = await loadPickupPoints("area-1");

    expect(result.selected).toMatchObject({ name: "新名称", address: "新地址" });
    expect(storage.get("selectedPickupPoint")).toMatchObject({ name: "新名称", address: "新地址" });
  });

  it("clears a selection that no longer exists in the current service area", async () => {
    storage.set("selectedPickupPoint", { id: "removed-point", serviceAreaId: "area-1", name: "已删除点位", address: "旧地址" });
    listPickupPoints.mockResolvedValueOnce([]);
    const { loadPickupPoints } = await import("./pickup-point");

    const result = await loadPickupPoints("area-1");

    expect(result.selected).toBeNull();
    expect(storage.has("selectedPickupPoint")).toBe(false);
  });
});
