export type ClaimRow = {
  skuId: string;
  name: string;
  maxQuantity: number;
  quantity: number;
  selected: boolean;
  reasonIndex: number;
  description: string;
};

type ClaimableItem = {
  skuId: string;
  name: string;
  claimableQuantity: number;
};

export function buildClaimRows(items: ClaimableItem[]): ClaimRow[] {
  const merged = new Map<string, ClaimRow>();
  for (const item of items) {
    if (!Number.isInteger(item.claimableQuantity) || item.claimableQuantity < 1) continue;
    const current = merged.get(item.skuId);
    if (current) {
      current.maxQuantity += item.claimableQuantity;
      current.quantity += item.claimableQuantity;
      continue;
    }
    merged.set(item.skuId, {
      skuId: item.skuId,
      name: item.name,
      maxQuantity: item.claimableQuantity,
      quantity: item.claimableQuantity,
      selected: merged.size === 0,
      reasonIndex: 0,
      description: "",
    });
  }
  return [...merged.values()];
}

export function validateSelectedClaimRows(rows: ClaimRow[]):
  | { ok: true; selected: ClaimRow[] }
  | { ok: false; message: string } {
  const selected = rows.filter((row) => row.selected);
  if (!selected.length) return { ok: false, message: "请至少选择一个异常商品" };
  if (selected.length > 20) return { ok: false, message: "一次最多选择 20 个商品" };
  for (const row of selected) {
    if (!Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > row.maxQuantity) {
      return { ok: false, message: `${row.name}数量应为 1 到 ${row.maxQuantity}` };
    }
    if (row.description.trim().length < 5) {
      return { ok: false, message: `请补充${row.name}的问题说明` };
    }
  }
  return { ok: true, selected };
}
