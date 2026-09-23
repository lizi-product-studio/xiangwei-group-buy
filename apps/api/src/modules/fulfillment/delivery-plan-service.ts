import type {
  BookVehicleInput,
  EmergencyVehicleCorrectionInput,
} from "@hometown/api-contracts";
import { BusinessError } from "@hometown/domain";
import type { CommerceStore } from "../core/store.js";
import type { DeliveryPlan } from "../core/types.js";

async function assertCampaignAllowsTransportMutation(
  store: CommerceStore,
  plan: DeliveryPlan,
): Promise<void> {
  const campaign = await store.getCampaignForUpdate(plan.campaignId);
  if (!campaign)
    throw new BusinessError("RESOURCE_NOT_FOUND", "团期不存在", 404);
  if (["CANCELLED", "COMPLETED"].includes(campaign.status))
    throw new BusinessError(
      "INVALID_STATE_TRANSITION",
      campaign.status === "CANCELLED"
        ? "团期已取消，不能修改运输信息"
        : "团期已完成，不能修改运输信息",
      409,
    );
}

export class DeliveryPlanService {
  public constructor(private readonly store: CommerceStore) {}
  public async list(): Promise<DeliveryPlan[]> {
    return this.store.listDeliveryPlans();
  }
  public async bookVehicle(
    id: string,
    input: BookVehicleInput,
    operationStore?: CommerceStore,
  ): Promise<DeliveryPlan> {
    const execute = async (store: CommerceStore) => {
      const plan = await store.getDeliveryPlan(id);
      if (!plan)
        throw new BusinessError("RESOURCE_NOT_FOUND", "配送计划不存在", 404);
      await assertCampaignAllowsTransportMutation(store, plan);
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
    };
    return operationStore
      ? execute(operationStore)
      : this.store.transaction(execute);
  }

  public async correctVehicleAfterDispatch(
    id: string,
    input: EmergencyVehicleCorrectionInput,
    operationStore?: CommerceStore,
  ): Promise<DeliveryPlan> {
    const execute = async (store: CommerceStore) => {
      const plan = await store.getDeliveryPlan(id);
      if (!plan)
        throw new BusinessError("RESOURCE_NOT_FOUND", "配送计划不存在", 404);
      await assertCampaignAllowsTransportMutation(store, plan);
      if (!["IN_TRANSIT", "ARRIVED"].includes(plan.status))
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "只有发车后的配送计划可以紧急纠正",
          409,
        );
      const now = new Date().toISOString();
      Object.assign(plan, {
        logisticsPlatform: input.logisticsPlatform,
        vehicleOrderNo: input.vehicleOrderNo,
        driverName: input.driverName,
        driverPhone: input.driverPhone,
        vehiclePlate: input.vehiclePlate,
        estimatedArrivalAt: input.estimatedArrivalAt,
        updatedAt: now,
      });
      await store.saveDeliveryPlan(plan);
      return plan;
    };
    return operationStore
      ? execute(operationStore)
      : this.store.transaction(execute);
  }
}
