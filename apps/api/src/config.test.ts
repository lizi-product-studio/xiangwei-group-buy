import { subscriptionData } from './modules/notifications/subscription-templates.js';
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const productionBase = {
  NODE_ENV: "production",
  DATA_STORE: "mysql",
  DATABASE_URL: "mysql://app:password@db.example.cn:3306/hometown",
  QUEUE_DRIVER: "redis",
  REDIS_URL: "redis://:password@redis.example.cn:6379",
  REQUIRE_HTTPS: "true",
  AUTH_PROVIDER: "wechat",
  WECHAT_APP_ID: "wx123456",
  WECHAT_APP_SECRET: "secret-value",
  PAYMENT_PROVIDER: "wechat",
  WECHAT_PAY_MCHID: "12345678",
  WECHAT_PAY_CERT_SERIAL: "cert-serial",
  WECHAT_PAY_PRIVATE_KEY_PATH: "/run/secrets/private",
  WECHAT_PAY_PUBLIC_KEY_ID: "public-key-id",
  WECHAT_PAY_PUBLIC_KEY_PATH: "/run/secrets/public",
  WECHAT_PAY_API_V3_KEY: "12345678901234567890123456789012",
  WECHAT_PAY_MERCHANT_NAME: "社区团购主体",
  PICKUP_CODE_SECRET: "more-than-sixteen-random-characters",
  WECHAT_SUBSCRIBE_MINIPROGRAM_STATE: "formal",
  WECHAT_SUBSCRIBE_DEADLINE_TEMPLATE_ID: "deadline",
  WECHAT_SUBSCRIBE_DEADLINE_TEMPLATE_DATA: JSON.stringify(subscriptionData.DEADLINE),
  WECHAT_SUBSCRIBE_SITE_TEMPLATE_ID: "site",
  WECHAT_SUBSCRIBE_SITE_TEMPLATE_DATA: JSON.stringify(subscriptionData.SITE),
  WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_ID: "dispatch",
  WECHAT_SUBSCRIBE_DISPATCH_TEMPLATE_DATA: JSON.stringify(subscriptionData.DISPATCH),
  WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_ID: "arrival",
  WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_DATA: JSON.stringify(subscriptionData.ARRIVAL),
  WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_ID: "partial-refund",
  WECHAT_SUBSCRIBE_PARTIAL_REFUND_TEMPLATE_DATA: JSON.stringify(subscriptionData.PARTIAL_REFUND),
};

describe("production configuration safety", () => {
  it("requires the aggregate critical threshold to exceed the warning threshold", () => {
    expect(() => loadConfig({ NODE_ENV: "test", AGGREGATE_PAYLOAD_WARNING_BYTES: "4096", AGGREGATE_PAYLOAD_CRITICAL_BYTES: "4096" })).toThrow(/严重告警阈值/);
    expect(loadConfig({ NODE_ENV: "test" })).toMatchObject({ AGGREGATE_PAYLOAD_WARNING_BYTES: 2 * 1024 * 1024, AGGREGATE_PAYLOAD_CRITICAL_BYTES: 4 * 1024 * 1024 });
  });
  it("keeps browser and consumer lifetimes separate and refuses weak production challenges", () => {
    const valid = { ...productionBase, WECHAT_PAY_NOTIFY_URL: "https://api.groupbuy.cn/api/v1/payments/wechat/notify", WECHAT_PAY_REFUND_NOTIFY_URL: "https://api.groupbuy.cn/api/v1/refunds/wechat/notify" };
    expect(loadConfig(valid)).toMatchObject({ AUTH_SESSION_TTL_SECONDS: 604800, STAFF_SESSION_TTL_SECONDS: 28800, STAFF_CHALLENGE_BITS: 18 });
    expect(() => loadConfig({ ...valid, STAFF_CHALLENGE_BITS: "8" })).toThrow();
    expect(() => loadConfig({ ...valid, STAFF_SESSION_TTL_SECONDS: "604800" })).toThrow();
  });
  it("rejects placeholder payment callback hosts", () => {
    expect(() =>
      loadConfig({
        ...productionBase,
        WECHAT_PAY_NOTIFY_URL:
          "https://api.example.com/api/v1/payments/wechat/notify",
        WECHAT_PAY_REFUND_NOTIFY_URL:
          "https://api.example.com/api/v1/refunds/wechat/notify",
      }),
    ).toThrow(/真实备案 HTTPS 域名/);
    expect(() =>
      loadConfig({
        ...productionBase,
        WECHAT_PAY_NOTIFY_URL:
          "https://replace-with-registered-https-host.example.invalid/api/v1/payments/wechat/notify",
        WECHAT_PAY_REFUND_NOTIFY_URL:
          "https://replace-with-registered-https-host.example.invalid/api/v1/refunds/wechat/notify",
      }),
    ).toThrow(/真实备案 HTTPS 域名/);
  });

  it("rejects stale four-template mappings, duplicate IDs and implicit message landing", () => {
    const good = { ...productionBase, WECHAT_PAY_NOTIFY_URL: 'https://api.groupbuy.cn/api/v1/payments/wechat/notify', WECHAT_PAY_REFUND_NOTIFY_URL: 'https://api.groupbuy.cn/api/v1/refunds/wechat/notify' };
    expect(() => loadConfig({ ...good, WECHAT_SUBSCRIBE_DEADLINE_TEMPLATE_ID: undefined })).toThrow(/五类/);
    expect(() => loadConfig({ ...good, WECHAT_SUBSCRIBE_DEADLINE_TEMPLATE_ID: good.WECHAT_SUBSCRIBE_ARRIVAL_TEMPLATE_ID })).toThrow(/五类/);
    expect(() => loadConfig({ ...good, WECHAT_SUBSCRIBE_SITE_TEMPLATE_DATA: '{"thing1":"{{title}}"}' })).toThrow(/字段/);
    expect(() => loadConfig({ ...good, WECHAT_SUBSCRIBE_MINIPROGRAM_STATE: undefined })).toThrow(/trial/);
  });
  it("accepts concrete HTTPS callback hosts", () => {
    expect(() =>
      loadConfig({
        ...productionBase,
        WECHAT_PAY_NOTIFY_URL:
          "https://api.groupbuy.cn/api/v1/payments/wechat/notify",
        WECHAT_PAY_REFUND_NOTIFY_URL:
          "https://api.groupbuy.cn/api/v1/refunds/wechat/notify",
      }),
    ).not.toThrow();
  });
});
