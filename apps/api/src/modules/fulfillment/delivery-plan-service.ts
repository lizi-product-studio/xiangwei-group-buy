import type { BookVehicleInput } from "@hometown/api-contracts";
import { BusinessError } from "@hometown/domain";
import type { CommerceStore } from "../core/store.js";
import type { DeliveryPlan } from "../core/types.js";

export class DeliveryPlanService {
  public constructor(private readonly store: CommerceStore) {}
  public async list(): Promise<DeliveryPlan[]> {
    return this.store.listDeliveryPlans();
  }
  public async bookVehicle(
    id: string,
    input: BookVehicleInput,
  ): Promise<DeliveryPlan> {
    return this.store.transaction(async (store) => {
      const plan = await store.getDeliveryPlan(id);
      if (!plan)
        throw new BusinessError("RESOURCE_NOT_FOUND", "配送计划不存在", 404);
      if (!["SITE_CONFIRMED", "VEHICLE_BOOKED"].includes(plan.status))
        throw new BusinessError(
          "DELIVERY_SITE_NOT_CONFIRMED",
          "固定自提点尚未确认或车辆已发出",
          409,
        );
      Object.assign(plan, {
        vehicleOrderNo: input.vehicleOrderNo,
        logisticsPlatform: input.logisticsPlatform,
        driverName: input.driverName,
        driverPhone: input.driverPhone,
        vehiclePlate: input.vehiclePlate,
        estimatedArrivalAt: input.estimatedArrivalAt,
        status: "VEHICLE_BOOKED" as const,
        bookedAt: new Date().toISOString(),
      });
      plan.updatedAt = plan.bookedAt!;
      await store.saveDeliveryPlan(plan);
      return plan;
    });
  }
}
