import { describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../config.js";
import { MemoryStore } from "../core/store.js";

const admin = { "x-demo-user-id": "admin", "x-demo-role": "SUPER_ADMIN" };
const createdAt = "2026-08-31T00:00:00.000Z";

describe("consumer service-area coverage", () => {
  it("does not add a default region or pickup point on application startup", async () => {
    const app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }) });
    try {
      const [areas, points, publicAreas] = await Promise.all([
        app.inject({ method: "GET", url: "/api/v1/admin/service-areas", headers: admin }),
        app.inject({ method: "GET", url: "/api/v1/admin/pickup-points", headers: admin }),
        app.inject({ method: "GET", url: "/api/v1/service-areas" }),
      ]);
      expect(areas.json().data).toEqual([]);
      expect(points.json().data).toEqual([]);
      expect(publicAreas.json().data).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("only exposes order-enabled regions with an active pickup point", async () => {
    const store = new MemoryStore(false);
    await store.saveServiceArea({ id: "covered", regionCode: "110101", name: "已覆盖", status: "ENABLED", orderEnabled: true, createdAt });
    await store.saveServiceArea({ id: "no-point", regionCode: "110102", name: "无点位", status: "ENABLED", orderEnabled: true, createdAt });
    await store.saveServiceArea({ id: "paused", regionCode: "110103", name: "已暂停", status: "ENABLED", orderEnabled: false, createdAt });
    await store.savePickupPoint({ id: "point-covered", serviceAreaId: "covered", name: "真实点位", address: "北京市东城区", businessHours: "09:00-18:00", pickupInstructions: "凭码领取", latitude: 39.9, longitude: 116.4, contactName: "负责人", contactPhone: "13800138000", status: "ACTIVE", capacityPerDay: null, createdAt });
    await store.savePickupPoint({ id: "point-inactive", serviceAreaId: "no-point", name: "停用点位", address: "北京市西城区", businessHours: "09:00-18:00", pickupInstructions: "凭码领取", latitude: 39.9, longitude: 116.3, contactName: "负责人", contactPhone: "13900139000", status: "INACTIVE", capacityPerDay: null, createdAt });
    const app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store });
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/service-areas" });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([
        expect.objectContaining({ id: "covered", name: "已覆盖" }),
      ]);
    } finally {
      await app.close();
    }
  });
});
