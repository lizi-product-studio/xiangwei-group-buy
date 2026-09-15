export const AUTH_INTENT_STORAGE_KEY = "hometown-auth-intent";
export const AUTH_CANCEL_SUPPRESSION_STORAGE_KEY = "hometown-auth-cancel-return";
export const AUTH_INTENT_TTL_MS = 30 * 60 * 1000;

export type AuthIntentSource =
  | "profile"
  | "orders"
  | "order-detail"
  | "checkout"
  | "pickup-code"
  | "messages"
  | "after-sale"
  | "service-area-interest"
  | "session-expired";

export type AuthWriteAction =
  | "submit-order"
  | "submit-after-sale"
  | "submit-service-area-interest";

export interface AuthIntent {
  /** Correlates one protected-entry attempt across the login page and return. */
  intentId: string;
  source: AuthIntentSource;
  returnUrl: string;
  writeAction?: AuthWriteAction;
  createdAt: number;
}

type CancelReturnSuppression = Pick<AuthIntent, "intentId" | "source" | "returnUrl">;

function createIntentId(now: number): string {
  // We do not need a security token here; this is an opaque client correlation
  // id. Include time and a random suffix so two taps in the same millisecond
  // cannot overwrite one another indistinguishably.
  const suffix = Math.random().toString(36).slice(2, 10);
  return `auth-${now.toString(36)}-${suffix}`;
}

const TAB_PATHS = new Set([
  "/pages/home/index",
  "/pages/category/index",
  "/pages/cart/index",
  "/pages/profile/index",
]);
const AUTH_SOURCES = new Set<AuthIntentSource>([
  "profile", "orders", "order-detail", "checkout", "pickup-code",
  "messages", "after-sale", "service-area-interest", "session-expired",
]);
const AUTH_WRITE_ACTIONS = new Set<AuthWriteAction>([
  "submit-order", "submit-after-sale", "submit-service-area-interest",
]);
const REGISTERED_PAGE_PATHS = new Set([
  "/pages/home/index",
  "/pages/category/index",
  "/pages/campaign/detail",
  "/pages/checkout/index",
  "/pages/cart/index",
  "/pages/pickup-select/index",
  "/pages/orders/index",
  "/pages/order-detail/index",
  "/pages/pickup-code/index",
  "/pages/messages/index",
  "/pages/interest/index",
  "/pages/legal/index",
  "/pages/after-sale/index",
  "/pages/profile/index",
  "/pages/profile-edit/index",
  "/pages/login/index",
]);
const SOURCE_ROUTES: Record<AuthIntentSource, { path: string; required?: string }> = {
  profile: { path: "/pages/profile/index" },
  orders: { path: "/pages/orders/index" },
  "order-detail": { path: "/pages/order-detail/index", required: "id" },
  checkout: { path: "/pages/checkout/index", required: "campaignId" },
  "pickup-code": { path: "/pages/pickup-code/index", required: "orderId" },
  messages: { path: "/pages/messages/index" },
  "after-sale": { path: "/pages/after-sale/index", required: "orderId" },
  "service-area-interest": { path: "/pages/interest/index" },
  "session-expired": { path: "/pages/profile/index" },
};
const SOURCE_WRITE_ACTIONS: Record<AuthIntentSource, AuthWriteAction | undefined> = {
  profile: undefined,
  orders: undefined,
  "order-detail": undefined,
  checkout: "submit-order",
  "pickup-code": undefined,
  messages: undefined,
  "after-sale": "submit-after-sale",
  "service-area-interest": "submit-service-area-interest",
  "session-expired": undefined,
};

function isAuthIntentSource(value: unknown): value is AuthIntentSource {
  return typeof value === "string" && AUTH_SOURCES.has(value as AuthIntentSource);
}

export function isValidWriteAction(
  source: AuthIntentSource,
  writeAction: AuthWriteAction | undefined,
): boolean {
  if (writeAction !== undefined && !AUTH_WRITE_ACTIONS.has(writeAction)) return false;
  const expected = SOURCE_WRITE_ACTIONS[source];
  return writeAction === expected;
}

export function isRegisteredMiniProgramPage(path: string): boolean {
  return REGISTERED_PAGE_PATHS.has(path);
}

function parseReturnQuery(query: string): Array<{ key: string; value: string }> | null {
  if (!query) return [];
  const entries: Array<{ key: string; value: string }> = [];
  for (const pair of query.split("&")) {
    if (!pair) return null;
    const separator = pair.indexOf("=");
    // A return query is an exact, single-value allowlist. Reject a key
    // without `=` and any additional unescaped `=` rather than truncating a
    // malformed value into a seemingly valid intent.
    if (separator <= 0 || pair.indexOf("=", separator + 1) >= 0) return null;
    const rawKey = pair.slice(0, separator);
    const rawValue = pair.slice(separator + 1);
    if (!rawValue) return null;
    try {
      entries.push({ key: decodeURIComponent(rawKey), value: decodeURIComponent(rawValue) });
    } catch {
      return null;
    }
  }
  return entries;
}

export function isValidAuthReturnUrl(source: AuthIntentSource, returnUrl: string): boolean {
  if (!isAuthIntentSource(source) || !isSafeMiniProgramPath(returnUrl) || returnUrl.endsWith("?")) return false;
  const [path = "", query = ""] = returnUrl.split("?", 2);
  const rule = SOURCE_ROUTES[source];
  if (!rule || !isRegisteredMiniProgramPage(path) || path === "/pages/login/index" || path !== rule.path) return false;
  const queryEntries = parseReturnQuery(query);
  if (!queryEntries) return false;
  if (!rule.required) return queryEntries.length === 0;
  const matches = queryEntries.filter((entry) => entry.key === rule.required);
  return queryEntries.length === 1 && matches.length === 1 && Boolean(matches[0]?.value);
}

function isSafeMiniProgramPath(path: string): boolean {
  return /^\/pages\/[A-Za-z0-9/_-]+(?:\?[^#]*)?$/.test(path);
}

export function normalizeReturnUrl(returnUrl: string | undefined): string {
  if (!returnUrl || !isSafeMiniProgramPath(returnUrl))
    return "/pages/profile/index";
  return returnUrl;
}

export function createAuthIntent(
  source: AuthIntentSource,
  returnUrl: string,
  writeAction?: AuthWriteAction,
  now = Date.now(),
): AuthIntent {
  return {
    intentId: createIntentId(now),
    source,
    returnUrl: normalizeReturnUrl(returnUrl),
    ...(writeAction ? { writeAction } : {}),
    createdAt: now,
  };
}

export function serializeAuthIntent(intent: AuthIntent): string {
  return JSON.stringify(intent);
}

export function parseAuthIntent(value: unknown): AuthIntent | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<AuthIntent>;
    if (
      typeof candidate.intentId !== "string" ||
      !candidate.intentId ||
      typeof candidate.source !== "string" ||
      !isAuthIntentSource(candidate.source) ||
      typeof candidate.returnUrl !== "string" ||
      typeof candidate.createdAt !== "number" ||
      !Number.isFinite(candidate.createdAt) ||
      (candidate.writeAction !== undefined &&
        (typeof candidate.writeAction !== "string" || !AUTH_WRITE_ACTIONS.has(candidate.writeAction as AuthWriteAction))) ||
      !isValidWriteAction(candidate.source, candidate.writeAction as AuthWriteAction | undefined) ||
      !isValidAuthReturnUrl(candidate.source, candidate.returnUrl)
    )
      return null;
    return {
      intentId: candidate.intentId,
      source: candidate.source as AuthIntentSource,
      returnUrl: candidate.returnUrl,
      ...(candidate.writeAction
        ? { writeAction: candidate.writeAction as AuthWriteAction }
        : {}),
      createdAt: candidate.createdAt,
    };
  } catch {
    return null;
  }
}

export function isTabReturnUrl(returnUrl: string): boolean {
  return TAB_PATHS.has(returnUrl.split("?", 1)[0] ?? returnUrl);
}

export function sourceText(source: AuthIntentSource): string {
  switch (source) {
    case "checkout":
      return "结算与支付";
    case "after-sale":
      return "售后申请";
    case "pickup-code":
      return "取货码";
    case "messages":
      return "订单消息";
    case "orders":
    case "order-detail":
      return "订单服务";
    case "service-area-interest":
      return "开通意向";
    case "session-expired":
      return "当前服务";
    default:
      return "个人服务";
  }
}

export function saveAuthIntent(intent: AuthIntent): void {
  if (!isAuthIntentSource(intent.source) ||
      !isValidAuthReturnUrl(intent.source, intent.returnUrl) ||
      !isValidWriteAction(intent.source, intent.writeAction)) {
    clearAuthIntent();
    clearCancelReturnSuppression();
    return;
  }
  wx.setStorageSync(AUTH_INTENT_STORAGE_KEY, serializeAuthIntent(intent));
  clearCancelReturnSuppression();
}

export function readAuthIntent(now = Date.now()): AuthIntent | null {
  const raw = wx.getStorageSync<string>(AUTH_INTENT_STORAGE_KEY);
  const intent = parseAuthIntent(raw);
  if (!intent || now - intent.createdAt < 0 || now - intent.createdAt >= AUTH_INTENT_TTL_MS) {
    clearAuthIntent();
    clearCancelReturnSuppression();
    return null;
  }
  return intent;
}

export function clearAuthIntent(): void {
  wx.removeStorageSync(AUTH_INTENT_STORAGE_KEY);
}

export function clearCancelReturnSuppression(): void {
  wx.removeStorageSync(AUTH_CANCEL_SUPPRESSION_STORAGE_KEY);
}

export function saveCancelReturnSuppression(intent: AuthIntent): void {
  if (!isAuthIntentSource(intent.source) ||
      !isValidAuthReturnUrl(intent.source, intent.returnUrl) ||
      !isValidWriteAction(intent.source, intent.writeAction)) {
    clearCancelReturnSuppression();
    return;
  }
  wx.setStorageSync(
    AUTH_CANCEL_SUPPRESSION_STORAGE_KEY,
    JSON.stringify({ intentId: intent.intentId, source: intent.source, returnUrl: intent.returnUrl }),
  );
}

export function consumeCancelReturnSuppression(
  expected: Pick<AuthIntent, "source" | "returnUrl">,
  now = Date.now(),
): boolean {
  const raw = wx.getStorageSync<string>(AUTH_CANCEL_SUPPRESSION_STORAGE_KEY);
  if (!raw) return false;
  let suppression: CancelReturnSuppression | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") suppression = parsed as CancelReturnSuppression;
  } catch { /* invalid suppression is cleared below */ }
  if (!suppression || !suppression.intentId || typeof suppression.source !== "string" || typeof suppression.returnUrl !== "string") {
    clearCancelReturnSuppression();
    return false;
  }
  const intent = readAuthIntent(now);
  if (!intent) {
    clearCancelReturnSuppression();
    return false;
  }
  const matches = Boolean(
    suppression.source === expected.source &&
      suppression.returnUrl === expected.returnUrl && intent && intent.intentId === suppression.intentId,
  );
  // Suppression is deliberately one-shot and never global: a different page
  // or a later user action must be able to enter login normally.
  if (matches) clearCancelReturnSuppression();
  return matches;
}
