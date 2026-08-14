import { describe, expect, it } from 'vitest';
import {
  createServiceAreaInterestSchema,
  pickupVerifierAssignmentSchema,
  transferReinspectionSchema,
  warehouseExceptionSchema,
  wechatLoginSchema,
} from './index.js';

describe('public API contracts', () => {
  it('accepts only an explicit mainland mobile number for a service-area interest', () => {
    expect(createServiceAreaInterestSchema.safeParse({
      regionText: '莲池区', contactName: '测试用户', contactPhone: '13800000000', privacyAccepted: true, privacyVersion: '2026-08-12',
    }).success).toBe(true);
    expect(createServiceAreaInterestSchema.safeParse({
      regionText: '莲池区', contactName: '测试用户', contactPhone: '123456', privacyAccepted: true, privacyVersion: '2026-08-12',
    }).success).toBe(false);
  });

  it('requires an explicit, versioned privacy acceptance for WeChat login', () => {
    expect(wechatLoginSchema.safeParse({ code: 'wechat-code-123', privacyAccepted: true, privacyVersion: '2026-08-12' }).success).toBe(true);
    expect(wechatLoginSchema.safeParse({ code: 'wechat-code-123', privacyAccepted: false, privacyVersion: '2026-08-12' }).success).toBe(false);
    expect(wechatLoginSchema.safeParse({ code: 'wechat-code-123', privacyAccepted: true }).success).toBe(false);
  });

  it('requires both identifiers for a verifier point assignment', () => {
    expect(pickupVerifierAssignmentSchema.safeParse({ userId: 'verifier-1', pickupPointId: 'point-1' }).success).toBe(true);
    expect(pickupVerifierAssignmentSchema.safeParse({ userId: 'verifier-1' }).success).toBe(false);
  });

  it('does not accept a client supplied expected quantity for warehouse discrepancies', () => {
    const parsed = warehouseExceptionSchema.parse({ items: [{ platformSkuId: 'sku-1', expectedQuantity: 999, shortQuantity: 1, damagedQuantity: 0, reason: 'WAREHOUSE_SHORTAGE', description: '盘点后确认仓内短少一件', evidenceUrl: null }] });
    expect(parsed.items[0]).not.toHaveProperty('expectedQuantity');
    expect(warehouseExceptionSchema.safeParse({ items: [{ platformSkuId: 'sku-1', shortQuantity: 0, damagedQuantity: 0, reason: 'WAREHOUSE_SHORTAGE', description: '没有登记任何异常数量', evidenceUrl: null }] }).success).toBe(false);
  });

  it('requires evidence and a positive accepted quantity for wrong-point transfer reinspection', () => {
    expect(transferReinspectionSchema.safeParse({ evidenceNote: '正确点位重新验收并登记', items: [{ platformSkuId: 'sku-1', acceptedQuantity: 1 }] }).success).toBe(true);
    expect(transferReinspectionSchema.safeParse({ evidenceNote: 'too short', items: [{ platformSkuId: 'sku-1', acceptedQuantity: 0 }] }).success).toBe(false);
  });
});
