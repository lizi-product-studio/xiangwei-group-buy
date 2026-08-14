import type { BookVehicleInput, CreateDeliveryPlanInput } from '@hometown/api-contracts';
import { BusinessError } from '@hometown/domain';
import type { CommerceStore } from '../core/store.js';
import type { DeliveryPlan } from '../core/types.js';
import type { NotificationService } from '../notifications/notification-service.js';

export class DeliveryPlanService {
  public constructor(private readonly store: CommerceStore, private readonly notifications?: NotificationService) {}

  public async list(): Promise<DeliveryPlan[]> { return this.store.listDeliveryPlans(); }

  public async get(id: string): Promise<DeliveryPlan> {
    const plan = await this.store.getDeliveryPlan(id);
    if (!plan) throw new BusinessError('RESOURCE_NOT_FOUND', '配送计划不存在', 404);
    return plan;
  }

  public async saveSite(input: CreateDeliveryPlanInput): Promise<DeliveryPlan> {
    return this.store.transaction(async (store) => {
      const plan = await store.getDeliveryPlanByCampaign(input.campaignId);
      if (!plan) throw new BusinessError('RESOURCE_NOT_FOUND', '团期配送计划不存在', 404);
      if (['IN_TRANSIT', 'ARRIVED'].includes(plan.status)) {
        throw new BusinessError('INVALID_STATE_TRANSITION', '车辆已发车后不能修改到货地点', 409);
      }
      if(!input.pickupPointId)throw new BusinessError('VALIDATION_ERROR','必须选择已启用的固定自提点',400);
      const pickupPoint=(await store.listPickupPoints(plan.serviceAreaId)).find((item)=>item.id===input.pickupPointId&&item.status==='ACTIVE');
      if(!pickupPoint)throw new BusinessError('VALIDATION_ERROR','自提点不在本团期服务区域内或已暂停',400);
      if(plan.pickupPointId&&plan.pickupPointId!==pickupPoint.id&&(await store.listOrdersByCampaign(plan.campaignId)).length)throw new BusinessError('RESOURCE_IN_USE','团期已有订单，不能更换固定自提点',409);
      if(input.siteName!==pickupPoint.name||input.address!==pickupPoint.address)throw new BusinessError('VALIDATION_ERROR','领取地点必须与所选固定自提点一致',400);
      const changed = plan.pickupPointId !== pickupPoint.id || plan.siteName !== input.siteName || plan.address !== input.address || plan.arrivalStartAt !== input.arrivalStartAt || plan.arrivalEndAt !== input.arrivalEndAt || plan.contactName !== input.contactName || plan.contactPhone !== input.contactPhone || plan.remark !== input.remark;
      if (!changed) return plan;
      plan.siteName = input.siteName;
      plan.address = input.address;
      plan.pickupPointId = pickupPoint.id;
      plan.arrivalStartAt = input.arrivalStartAt;
      plan.arrivalEndAt = input.arrivalEndAt;
      plan.contactName = input.contactName;
      plan.contactPhone = input.contactPhone;
      plan.remark = input.remark;
      plan.status = input.siteName && input.address ? 'SITE_CONFIRMED' : 'PENDING_SITE';
      plan.confirmedAt = plan.status === 'SITE_CONFIRMED' ? new Date().toISOString() : null;
      if (plan.status === 'PENDING_SITE' || changed) {
        plan.vehicleOrderNo = null;
        plan.driverName = null;
        plan.driverPhone = null;
        plan.vehiclePlate = null;
        plan.bookedAt = null;
      }
      plan.updatedAt = new Date().toISOString();
      await store.saveDeliveryPlan(plan);
      if (this.notifications && plan.status === 'SITE_CONFIRMED') {
        await this.notifications.enqueueCampaign(store, 'SITE_CONFIRMED', plan.campaignId, plan, `delivery-site:${plan.updatedAt}`);
      }
      return plan;
    });
  }

  public async bookVehicle(id: string, input: BookVehicleInput): Promise<DeliveryPlan> {
    return this.store.transaction(async (store) => {
      const plan = await store.getDeliveryPlan(id);
      if (!plan) throw new BusinessError('RESOURCE_NOT_FOUND', '配送计划不存在', 404);
      if (plan.status !== 'SITE_CONFIRMED' && plan.status !== 'VEHICLE_BOOKED') {
        throw new BusinessError('DELIVERY_SITE_NOT_CONFIRMED', '请先确认集中领取地点，再登记约车信息', 409);
      }
      plan.vehicleOrderNo = input.vehicleOrderNo;
      plan.driverName = input.driverName;
      plan.driverPhone = input.driverPhone;
      plan.vehiclePlate = input.vehiclePlate;
      plan.status = 'VEHICLE_BOOKED';
      plan.bookedAt = new Date().toISOString();
      plan.updatedAt = plan.bookedAt;
      await store.saveDeliveryPlan(plan);
      return plan;
    });
  }
}
