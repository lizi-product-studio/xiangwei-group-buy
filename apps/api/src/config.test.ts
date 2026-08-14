import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const productionBase = {
  NODE_ENV: 'production', DATA_STORE: 'mysql', DATABASE_URL: 'mysql://app:password@db.example.cn:3306/hometown',
  QUEUE_DRIVER: 'redis', REDIS_URL: 'redis://:password@redis.example.cn:6379', REQUIRE_HTTPS: 'true',
  AUTH_PROVIDER: 'wechat', WECHAT_APP_ID: 'wx123456', WECHAT_APP_SECRET: 'secret-value',
  PAYMENT_PROVIDER: 'wechat-platform', WECHAT_PAY_SP_MCHID: '12345678', WECHAT_PAY_CERT_SERIAL: 'cert-serial',
  WECHAT_PAY_PRIVATE_KEY_PATH: '/run/secrets/private', WECHAT_PAY_PUBLIC_KEY_ID: 'public-key-id', WECHAT_PAY_PUBLIC_KEY_PATH: '/run/secrets/public',
  WECHAT_PAY_API_V3_KEY: '12345678901234567890123456789012', WECHAT_PAY_PLATFORM_NAME: '平台主体', PICKUP_CODE_SECRET: 'more-than-sixteen-random-characters',
  WECHAT_SUBSCRIBE_SITE_TEMPLATE_ID: 'site', WECHAT_SUBSCRIBE_SITE_TEMPLATE_DATA: '{"thing1":"title"}',
  WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_ID: 'dispatch', WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_DATA: '{"thing1":"title"}',
  WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_ID: 'arrival', WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_DATA: '{"thing1":"title"}',
  WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_ID: 'partial-refund', WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_DATA: '{"thing1":"title"}',
};

describe('production configuration safety', () => {
  it('rejects placeholder payment callback hosts', () => {
    expect(() => loadConfig({ ...productionBase,
      WECHAT_PAY_NOTIFY_URL: 'https://api.example.com/api/v1/payments/wechat/notify',
      WECHAT_PAY_REFUND_NOTIFY_URL: 'https://api.example.com/api/v1/refunds/wechat/notify',
    })).toThrow(/真实备案 HTTPS 域名/);
    expect(() => loadConfig({ ...productionBase,
      WECHAT_PAY_NOTIFY_URL: 'https://replace-with-registered-https-host.example.invalid/api/v1/payments/wechat/notify',
      WECHAT_PAY_REFUND_NOTIFY_URL: 'https://replace-with-registered-https-host.example.invalid/api/v1/refunds/wechat/notify',
    })).toThrow(/真实备案 HTTPS 域名/);
  });

  it('accepts concrete HTTPS callback hosts', () => {
    expect(() => loadConfig({ ...productionBase,
      WECHAT_PAY_NOTIFY_URL: 'https://api.groupbuy.cn/api/v1/payments/wechat/notify',
      WECHAT_PAY_REFUND_NOTIFY_URL: 'https://api.groupbuy.cn/api/v1/refunds/wechat/notify',
    })).not.toThrow();
  });
});
