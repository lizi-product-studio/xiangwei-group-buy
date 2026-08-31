import { z } from "zod";
import { BusinessError } from "@hometown/domain";

const configSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  TRUST_PROXY: z.stringbool().default(false),
  RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(10000).default(300),
  REQUIRE_HTTPS: z.stringbool().default(false),
  AUTH_PROVIDER: z.enum(["demo", "wechat"]).default("demo"),
  PRIVACY_NOTICE_VERSION: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
    .default("2026-08-12"),
  AUTH_SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(900)
    .max(2_592_000)
    .default(604_800),
  WECHAT_APP_ID: z.string().min(6).optional(),
  WECHAT_APP_SECRET: z.string().min(8).optional(),
  WECHAT_SUBSCRIBE_SITE_TEMPLATE_ID: z.string().min(1).optional(),
  WECHAT_SUBSCRIBE_SITE_TEMPLATE_DATA: z.string().min(2).optional(),
  WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_ID: z.string().min(1).optional(),
  WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_DATA: z.string().min(2).optional(),
  WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_ID: z.string().min(1).optional(),
  WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_DATA: z.string().min(2).optional(),
  WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_ID: z.string().min(1).optional(),
  WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_DATA: z.string().min(2).optional(),
  PAYMENT_PROVIDER: z.enum(["mock", "wechat"]).default("mock"),
  WECHAT_PAY_MCHID: z
    .string()
    .regex(/^\d{8,10}$/)
    .optional(),
  WECHAT_PAY_CERT_SERIAL: z.string().min(8).optional(),
  WECHAT_PAY_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  WECHAT_PAY_PUBLIC_KEY_ID: z.string().min(8).optional(),
  WECHAT_PAY_PUBLIC_KEY_PATH: z.string().min(1).optional(),
  WECHAT_PAY_API_V3_KEY: z.string().length(32).optional(),
  WECHAT_PAY_NOTIFY_URL: z.string().url().optional(),
  WECHAT_PAY_REFUND_NOTIFY_URL: z.string().url().optional(),
  WECHAT_PAY_MERCHANT_NAME: z.string().min(2).max(120).optional(),
  DATA_STORE: z.enum(["memory", "mysql"]).default("memory"),
  DATABASE_URL: z.string().url().optional(),
  QUEUE_DRIVER: z.enum(["memory", "redis"]).default("memory"),
  REDIS_URL: z.string().url().optional(),
  PICKUP_CODE_SECRET: z
    .string()
    .min(16)
    .default("development-only-pickup-secret"),
});

export type AppConfig = z.infer<typeof configSchema>;

function assertTemplateData(value: string, name: string): void {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !parsed ||
      Array.isArray(parsed) ||
      typeof parsed !== "object" ||
      !Object.entries(parsed).every(
        ([key, text]) => key.length > 0 && typeof text === "string",
      )
    )
      throw new Error("invalid");
  } catch {
    throw new BusinessError(
      "VALIDATION_ERROR",
      `${name} 必须是非空字符串字段组成的 JSON 对象`,
      500,
    );
  }
}
function assertProductionHttpsUrl(value: string, name: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BusinessError(
      "VALIDATION_ERROR",
      `${name} 必须是有效 HTTPS 地址`,
      500,
    );
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".example.com") ||
    host.endsWith(".example.org") ||
    host.endsWith(".example.net") ||
    host.endsWith(".invalid")
  )
    throw new BusinessError(
      "VALIDATION_ERROR",
      `${name} 必须使用真实备案 HTTPS 域名`,
      500,
    );
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const config = configSchema.parse(environment);
  if (config.DATA_STORE === "mysql" && !config.DATABASE_URL)
    throw new BusinessError(
      "VALIDATION_ERROR",
      "MySQL 数据源必须配置 DATABASE_URL",
      500,
    );
  if (config.QUEUE_DRIVER === "redis" && !config.REDIS_URL)
    throw new BusinessError(
      "VALIDATION_ERROR",
      "Redis 队列必须配置 REDIS_URL",
      500,
    );
  if (
    config.AUTH_PROVIDER === "wechat" &&
    (!config.WECHAT_APP_ID || !config.WECHAT_APP_SECRET)
  )
    throw new BusinessError(
      "VALIDATION_ERROR",
      "微信登录必须配置应用凭据",
      500,
    );
  if (config.PAYMENT_PROVIDER === "wechat") {
    const required = [
      config.WECHAT_APP_ID,
      config.WECHAT_PAY_MCHID,
      config.WECHAT_PAY_CERT_SERIAL,
      config.WECHAT_PAY_PRIVATE_KEY_PATH,
      config.WECHAT_PAY_PUBLIC_KEY_ID,
      config.WECHAT_PAY_PUBLIC_KEY_PATH,
      config.WECHAT_PAY_API_V3_KEY,
      config.WECHAT_PAY_NOTIFY_URL,
      config.WECHAT_PAY_REFUND_NOTIFY_URL,
      config.WECHAT_PAY_MERCHANT_NAME,
    ];
    if (required.some((value) => !value))
      throw new BusinessError("VALIDATION_ERROR", "微信支付配置不完整", 500);
    if (config.NODE_ENV === "production") {
      assertProductionHttpsUrl(
        config.WECHAT_PAY_NOTIFY_URL!,
        "WECHAT_PAY_NOTIFY_URL",
      );
      assertProductionHttpsUrl(
        config.WECHAT_PAY_REFUND_NOTIFY_URL!,
        "WECHAT_PAY_REFUND_NOTIFY_URL",
      );
    }
  }
  if (config.NODE_ENV === "production") {
    if (config.DATA_STORE !== "mysql" || config.QUEUE_DRIVER !== "redis")
      throw new BusinessError(
        "VALIDATION_ERROR",
        "生产环境必须使用 MySQL 与 Redis",
        500,
      );
    if (!config.REQUIRE_HTTPS)
      throw new BusinessError(
        "VALIDATION_ERROR",
        "生产环境必须启用 HTTPS 网关校验",
        500,
      );
    if (config.PICKUP_CODE_SECRET === "development-only-pickup-secret")
      throw new BusinessError(
        "VALIDATION_ERROR",
        "生产环境必须配置独立取货码密钥",
        500,
      );
    if (
      config.AUTH_PROVIDER !== "wechat" ||
      config.PAYMENT_PROVIDER !== "wechat"
    )
      throw new BusinessError(
        "PRODUCTION_MOCK_FORBIDDEN",
        "生产环境必须使用真实微信登录与支付",
        500,
      );
    const templates = [
      config.WECHAT_SUBSCRIBE_SITE_TEMPLATE_ID,
      config.WECHAT_SUBSCRIBE_SITE_TEMPLATE_DATA,
      config.WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_ID,
      config.WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_DATA,
      config.WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_ID,
      config.WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_DATA,
      config.WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_ID,
      config.WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_DATA,
    ];
    if (templates.some((value) => !value))
      throw new BusinessError(
        "VALIDATION_ERROR",
        "生产环境必须配置四类微信订阅消息模板及字段映射",
        500,
      );
    assertTemplateData(
      config.WECHAT_SUBSCRIBE_SITE_TEMPLATE_DATA!,
      "WECHAT_SUBSCRIBE_SITE_TEMPLATE_DATA",
    );
    assertTemplateData(
      config.WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_DATA!,
      "WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_DATA",
    );
    assertTemplateData(
      config.WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_DATA!,
      "WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_DATA",
    );
    assertTemplateData(
      config.WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_DATA!,
      "WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_DATA",
    );
  }
  return config;
}
