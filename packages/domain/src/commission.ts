import { BusinessError } from './errors.js';
import { moneyCents, type MoneyCents } from './money.js';

export type CommissionScope = 'PLATFORM' | 'MERCHANT' | 'CAMPAIGN' | 'PRODUCT';

export interface CommissionRule {
  id: string;
  scope: CommissionScope;
  scopeId: string | null;
  rateBps: number;
  enabled: boolean;
}

const SCOPE_PRIORITY: Record<CommissionScope, number> = {
  PLATFORM: 0,
  MERCHANT: 100,
  CAMPAIGN: 200,
  PRODUCT: 300,
};

export function validateRateBps(rateBps: number): void {
  if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    throw new BusinessError('VALIDATION_ERROR', '佣金比例必须是 0 到 10000 的整数基点');
  }
}

export function calculateCommission(basis: MoneyCents, rateBps: number): MoneyCents {
  validateRateBps(rateBps);
  const roundedHalfUp = (BigInt(basis) * BigInt(rateBps) + 5_000n) / 10_000n;
  return moneyCents(Number(roundedHalfUp));
}

export function selectCommissionRule(
  rules: readonly CommissionRule[],
  context: { merchantId: string; campaignId: string; productId: string },
): CommissionRule | null {
  const matches = rules.filter((rule) => {
    if (!rule.enabled) return false;
    if (rule.scope === 'PLATFORM') return true;
    if (rule.scope === 'MERCHANT') return rule.scopeId === context.merchantId;
    if (rule.scope === 'CAMPAIGN') return rule.scopeId === context.campaignId;
    return rule.scopeId === context.productId;
  });

  return matches.sort((left, right) => SCOPE_PRIORITY[right.scope] - SCOPE_PRIORITY[left.scope])[0] ?? null;
}

