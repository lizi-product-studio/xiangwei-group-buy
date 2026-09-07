/** Resolve public API media against the API origin, not the mini-program path. */
export function resolveProductImageUrl(value: unknown, apiBaseUrl: string): string {
  if (typeof value !== 'string') return '';
  const path = value.trim();
  if (/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(path)) return path;
  if (!/^\/api\/[^\s]*$/.test(path)) return '';
  const origin = apiBaseUrl.match(/^https?:\/\/[^/\s]+/)?.[0];
  return origin ? `${origin}${path}` : '';
}
