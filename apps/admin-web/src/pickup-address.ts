const MAP_PLACEHOLDER = /（地图选点）$|^地图选点 /;

export function isPickupAddressPlaceholder(value: string): boolean {
  return MAP_PLACEHOLDER.test(value.trim());
}

export function resolvePickupAddress(input: {
  reverseAddress?: string;
  typed?: string;
}): string {
  const reverse = input.reverseAddress?.trim() ?? "";
  if (reverse.length >= 5) return reverse;
  const typed = input.typed?.trim() ?? "";
  if (typed.length >= 5 && !isPickupAddressPlaceholder(typed)) return typed;
  return "";
}

export function composePickupAddress(regionPrefix: string, detail: string): string {
  const prefix = regionPrefix.replace(/\s/g, "");
  const typed = detail.trim();
  if (!typed) return prefix;
  if (!prefix) return typed;
  if (typed.startsWith(prefix) || typed.includes(prefix)) return typed;
  return `${prefix}${typed}`;
}

export function pickupSearchQuery(regionPrefix: string, typed: string): string {
  const prefix = regionPrefix.replace(/\s/g, "");
  const query = typed.trim();
  if (!query) return prefix.slice(0, 80);
  if (!prefix || query.includes(prefix) || query.startsWith(prefix.slice(0, 2)))
    return query.slice(0, 80);
  return `${prefix}${query}`.slice(0, 80);
}
