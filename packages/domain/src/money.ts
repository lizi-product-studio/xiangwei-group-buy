import { BusinessError } from './errors.js';

export type MoneyCents = number & { readonly __brand: 'MoneyCents' };

export function moneyCents(value: number): MoneyCents {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BusinessError('VALIDATION_ERROR', '金额必须是非负安全整数（单位：分）');
  }
  return value as MoneyCents;
}

function bigintToMoney(value: bigint): MoneyCents {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new BusinessError('VALIDATION_ERROR', '金额计算结果超出安全范围');
  }
  return moneyCents(numeric);
}

export function multiplyMoney(unitPrice: MoneyCents, quantity: number): MoneyCents {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new BusinessError('VALIDATION_ERROR', '商品数量必须是正整数');
  }
  return bigintToMoney(BigInt(unitPrice) * BigInt(quantity));
}

export function sumMoney(values: readonly MoneyCents[]): MoneyCents {
  return bigintToMoney(values.reduce((sum, value) => sum + BigInt(value), 0n));
}

export function allocateMoney(total: MoneyCents, weights: readonly number[]): MoneyCents[] {
  if (weights.length === 0 || weights.some((weight) => !Number.isSafeInteger(weight) || weight < 0)) {
    throw new BusinessError('VALIDATION_ERROR', '分摊权重必须是非负整数且不能为空');
  }

  const totalWeight = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
  if (totalWeight === 0n) {
    throw new BusinessError('VALIDATION_ERROR', '分摊权重之和必须大于零');
  }

  const raw = weights.map((weight, index) => {
    const numerator = BigInt(total) * BigInt(weight);
    return {
      index,
      value: numerator / totalWeight,
      remainder: numerator % totalWeight,
    };
  });
  let remaining = BigInt(total) - raw.reduce((sum, item) => sum + item.value, 0n);

  const byRemainder = [...raw].sort(
    (left, right) => Number(right.remainder - left.remainder) || left.index - right.index,
  );
  for (const item of byRemainder) {
    if (remaining === 0n) break;
    item.value += 1n;
    remaining -= 1n;
  }

  return raw.sort((left, right) => left.index - right.index).map((item) => bigintToMoney(item.value));
}

