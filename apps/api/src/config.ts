import { z } from 'zod';
import { BusinessError } from '@hometown/domain';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.stringbool().default(false),
  RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(10000).default(300),
  REQUIRE_HTTPS: z.stringbool().default(false),
  AUTH_PROVIDER: z.enum(['demo', 'wechat']).default('demo'),
  PRIVACY_NOTICE_VERSION: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/).default('2026-08-12'),
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
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().min(900).max(2_592_000).default(604_800),
  PAYMENT_PROVIDER: z.enum(['mock', 'wechat-platform']).default('mock'),
  /** Mode B is deliberately opt-in until warehouse stock and direct-payment checks are complete. */
  PLATFORM_PROCUREMENT_ENABLED: z.stringbool().default(false),
  DEFAULT_BUSINESS_MODEL_VERSION: z.enum(['LEGACY_MARKETPLACE', 'PLATFORM_PROCUREMENT']).default('LEGACY_MARKETPLACE'),
  WECHAT_PAY_SP_MCHID: z.string().regex(/^\d{8,10}$/).optional(),
  /** Direct merchant number used only by the platform-procurement payment route. */
  WECHAT_PAY_PLATFORM_MCHID: z.string().regex(/^\d{8,10}$/).optional(),
  /** Platform-direct requests are signed with the platform entity's own certificate. */
  WECHAT_PAY_PLATFORM_CERT_SERIAL: z.string().min(8).optional(),
  WECHAT_PAY_PLATFORM_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  WECHAT_PAY_CERT_SERIAL: z.string().min(8).optional(),
  WECHAT_PAY_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  WECHAT_PAY_PUBLIC_KEY_ID: z.string().min(8).optional(),
  WECHAT_PAY_PUBLIC_KEY_PATH: z.string().min(1).optional(),
  WECHAT_PAY_API_V3_KEY: z.string().length(32).optional(),
  WECHAT_PAY_NOTIFY_URL: z.string().url().optional(),
  WECHAT_PAY_REFUND_NOTIFY_URL: z.string().url().optional(),
  WECHAT_PAY_PLATFORM_NAME: z.string().min(2).max(120).optional(),
  DATA_STORE: z.enum(['memory', 'mysql']).default('memory'),
  DATABASE_URL: z.string().url().optional(),
  QUEUE_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  REDIS_URL: z.string().url().optional(),
  PICKUP_CODE_SECRET: z.string().min(16).default('development-only-pickup-secret'),
});

export type AppConfig = z.infer<typeof configSchema>;

function assertTemplateData(value: string, name: string): void {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || !Object.entries(parsed).every(([key, text]) => key.length > 0 && typeof text === 'string')) throw new Error('invalid shape');
  } catch {
    throw new BusinessError('VALIDATION_ERROR', `${name} 必须是非空字符串字段组成的 JSON 对象`, 500);
  }
}

function assertProductionHttpsUrl(value: string, name: string): void {
  let url: { protocol: string; hostname: string };
  try { url = new URL(value); } catch { throw new BusinessError('VALIDATION_ERROR', `${name} 必须是有效 HTTPS 地址`, 500); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.example.com') || host.endsWith('.example.org') || host.endsWith('.example.net') || host === 'example.invalid' || host.endsWith('.example.invalid') || host.endsWith('.invalid')) {
    throw new BusinessError('VALIDATION_ERROR', `${name} 必须使用真实备案 HTTPS 域名`, 500);
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = configSchema.parse(environment);
  if (config.DEFAULT_BUSINESS_MODEL_VERSION === 'PLATFORM_PROCUREMENT' && !config.PLATFORM_PROCUREMENT_ENABLED) {
    throw new BusinessError('VALIDATION_ERROR', '模式 B 默认开关要求 PLATFORM_PROCUREMENT_ENABLED=true', 500);
  }
  if (config.DATA_STORE === 'mysql' && !config.DATABASE_URL) {
    throw new BusinessError('VALIDATION_ERROR', 'MySQL 数据源必须配置 DATABASE_URL', 500);
  }
  if (config.AUTH_PROVIDER === 'wechat' && (!config.WECHAT_APP_ID || !config.WECHAT_APP_SECRET)) {
    throw new BusinessError('VALIDATION_ERROR', '微信登录必须配置 WECHAT_APP_ID 和 WECHAT_APP_SECRET', 500);
  }
  if (config.PAYMENT_PROVIDER === 'wechat-platform') {
    const required = [config.WECHAT_APP_ID,config.WECHAT_PAY_SP_MCHID,config.WECHAT_PAY_CERT_SERIAL,config.WECHAT_PAY_PRIVATE_KEY_PATH,config.WECHAT_PAY_PUBLIC_KEY_ID,config.WECHAT_PAY_PUBLIC_KEY_PATH,config.WECHAT_PAY_API_V3_KEY,config.WECHAT_PAY_NOTIFY_URL,config.WECHAT_PAY_REFUND_NOTIFY_URL,config.WECHAT_PAY_PLATFORM_NAME];
    if (required.some((value) => !value)) throw new BusinessError('VALIDATION_ERROR', '微信平台收付通配置不完整', 500);
    if (config.NODE_ENV === 'production') assertProductionHttpsUrl(config.WECHAT_PAY_NOTIFY_URL!, 'WECHAT_PAY_NOTIFY_URL');
    if (config.NODE_ENV === 'production') assertProductionHttpsUrl(config.WECHAT_PAY_REFUND_NOTIFY_URL!, 'WECHAT_PAY_REFUND_NOTIFY_URL');
  }
  if (config.PLATFORM_PROCUREMENT_ENABLED && config.PAYMENT_PROVIDER === 'wechat-platform' && (!config.WECHAT_PAY_PLATFORM_MCHID || !config.WECHAT_PAY_PLATFORM_CERT_SERIAL || !config.WECHAT_PAY_PLATFORM_PRIVATE_KEY_PATH)) {
    throw new BusinessError('VALIDATION_ERROR', '平台采购模式的微信直连支付必须配置平台主体商户号、证书序列号和私钥路径', 500);
  }
  if (config.NODE_ENV === 'production' && config.DATA_STORE !== 'mysql') {
    throw new BusinessError('VALIDATION_ERROR', '生产环境必须使用 MySQL 数据源', 500);
  }
  if (config.NODE_ENV === 'production' && !config.REQUIRE_HTTPS) {
    throw new BusinessError('VALIDATION_ERROR', '生产环境必须由 TLS 网关设置 REQUIRE_HTTPS=true', 500);
  }
  if (config.QUEUE_DRIVER === 'redis' && !config.REDIS_URL) {
    throw new BusinessError('VALIDATION_ERROR', 'Redis 队列必须配置 REDIS_URL', 500);
  }
  if (config.NODE_ENV === 'production' && config.QUEUE_DRIVER !== 'redis') {
    throw new BusinessError('VALIDATION_ERROR', '生产环境必须使用 Redis 持久任务队列', 500);
  }
  if (config.NODE_ENV === 'production' && config.PICKUP_CODE_SECRET === 'development-only-pickup-secret') {
    throw new BusinessError('VALIDATION_ERROR', '生产环境必须配置独立的取货码密钥', 500);
  }
  if (config.NODE_ENV === 'production' && (config.AUTH_PROVIDER === 'demo' || config.PAYMENT_PROVIDER === 'mock')) {
    throw new BusinessError(
      'PRODUCTION_MOCK_FORBIDDEN',
      '生产环境禁止使用演示登录或模拟支付',
      500,
    );
  }
  if (config.NODE_ENV === 'production') {
    const required = [
      config.WECHAT_SUBSCRIBE_SITE_TEMPLATE_ID, config.WECHAT_SUBSCRIBE_SITE_TEMPLATE_DATA,
      config.WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_ID, config.WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_DATA,
      config.WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_ID, config.WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_DATA,
      config.WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_ID, config.WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_DATA,
    ];
    if (required.some((value) => !value)) throw new BusinessError('VALIDATION_ERROR', '生产环境必须配置四类微信订阅消息模板及其字段映射', 500);
    assertTemplateData(config.WECHAT_SUBSCRIBE_SITE_TEMPLATE_DATA!, 'WECHAT_SUBSCRIBE_SITE_TEMPLATE_DATA');
    assertTemplateData(config.WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_DATA!, 'WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_DATA');
    assertTemplateData(config.WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_DATA!, 'WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_DATA');
    assertTemplateData(config.WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_DATA!, 'WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_DATA');
  }
  return config;
}
