import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryStore } from "./modules/core/store.js";
import { NotificationService } from "./modules/notifications/notification-service.js";
import type {
  CommunityCancellationRequest,
  CommunityQualityCase,
  LedgerTransaction,
  Order,
} from "./modules/core/types.js";

const headers = (userId: string, role: string) => ({
  "x-demo-user-id": userId,
  "x-demo-role": role,
});
const superAdmin = headers("super", "SUPER_ADMIN");
const customerService = headers("cs", "CUSTOMER_SERVICE");
const operator = headers("operator", "OPERATOR");
const finance = headers("finance", "FINANCE");

describe("P1-C governance API contracts", () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let order: Order;

  beforeEach(async () => {
    store = new MemoryStore(false);
    const now = new Date().toISOString();
    for (const id of ["super", "cs", "operator", "finance", "user"])
      await store.saveUser({
        id,
        wechatOpenId: id === "user" ? "openid-user" : null,
        status: "ACTIVE",
        createdAt: now,
      });
    order = {
      id: "order-1",
      orderNo: "GB202608240001",
      userId: "user",
      campaignId: "campaign-1",
      serviceAreaId: "area-1",
      pickupPointId: "point-1",
      deliveryPlanId: "plan-1",
      status: "PICKED_UP",
      totalCents: 1600,
      items: [
        {
          orderLineId: "line-1",
          skuId: "sku-1",
          productId: "product-1",
          name: "当季番茄",
          quantity: 2,
          unitPriceCents: 800,
          amountCents: 1600,
          fulfilledQuantity: 2,
          pickedUpQuantity: 2,
          exceptionQuantity: 0,
          refundedQuantity: 0,
          refundedAmountCents: 0,
        },
      ],
      createdAt: now,
      expiresAt: now,
      paidAt: now,
      pickedUpAt: now,
    };
    await store.saveOrder(order);
    app = await buildApp({ config: loadConfig({ NODE_ENV: "test" }), store });
  });

  afterEach(async () => app.close());

  const quality = (id: string, status: CommunityQualityCase["status"] = "REGISTERED"): CommunityQualityCase => ({
    id,
    orderId: order.id,
    userId: order.userId,
    clientRequestId: `request-${id}`,
    payloadHash: `hash-${id}`,
    status,
    registeredAt: order.createdAt,
    acceptedBy: status === "REGISTERED" ? null : "cs",
    acceptedAt: status === "REGISTERED" ? null : order.createdAt,
    acceptanceNote: status === "REGISTERED" ? null : "资料已核验",
    decisionBy: null,
    decidedAt: null,
    decisionNote: null,
    refundApprovedBy: null,
    refundApprovedAt: null,
    financeExecutedBy: null,
    financeExecutedAt: null,
    refundExceptionId: null,
    items: [
      {
        id: `quality-item-${id}`,
        communityQualityCaseId: id,
        pickupReceiptId: "receipt-1",
        orderLineId: "line-1",
        catalogSkuId: "sku-1",
        pickedUpQuantitySnapshot: 2,
        disputedQuantity: 1,
        reason: "QUALITY_CLAIM",
        description: "商品出现明显压伤",
      },
    ],
  });

  it("separates quality acceptance from operator decision and returns a minimal order read model", async () => {
    const value = quality("quality-1");
    await store.saveCommunityQualityCase(value);

    const forbidden = await app.inject({
      method: "POST",
      url: `/api/v1/admin/quality-cases/${value.id}/accept`,
      headers: operator,
      payload: { note: "客服先核验" },
    });
    expect(forbidden.statusCode).toBe(403);
    const missingNote = await app.inject({
      method: "POST",
      url: `/api/v1/admin/quality-cases/${value.id}/accept`,
      headers: customerService,
      payload: { note: "" },
    });
    expect(missingNote.statusCode).toBe(400);
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/admin/quality-cases/${value.id}/accept`,
      headers: customerService,
      payload: { note: "客服已核验提货事实" },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().data).toMatchObject({
      status: "ACCEPTED",
      acceptanceNote: "客服已核验提货事实",
      decisionNote: null,
    });
    const decided = await app.inject({
      method: "POST",
      url: `/api/v1/admin/quality-cases/${value.id}/decision`,
      headers: operator,
      payload: { approved: false, note: "凭据不支持退款" },
    });
    expect(decided.statusCode, decided.body).toBe(200);
    expect(decided.json().data.status).toBe("REJECTED");
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/admin/quality-cases/${value.id}/decision`,
      headers: operator,
      payload: { approved: false, note: "凭据不支持退款" },
    });
    expect(replay.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/admin/quality-cases/${value.id}/decision`,
          headers: operator,
          payload: { approved: true, note: "不能覆写已拒绝决定" },
        })
      ).statusCode,
    ).toBe(409);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/admin/quality-cases",
      headers: customerService,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data[0]).toMatchObject({
      orderNo: order.orderNo,
      acceptanceNote: "客服已核验提货事实",
      items: [{ name: "当季番茄", quantity: 1, description: "商品出现明显压伤" }],
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/admin/quality-cases/${value.id}/refund`,
          headers: finance,
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
  });

  it("keeps cancellation review with operations and returns finance only its refund queue", async () => {
    const value: CommunityCancellationRequest = {
      id: "cancel-1",
      orderId: order.id,
      userId: order.userId,
      reason: "临时无法领取",
      status: "PENDING_REVIEW",
      requestedAt: order.createdAt,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      financeExecutedBy: null,
      financeExecutedAt: null,
      refundId: null,
    };
    await store.saveCommunityCancellationRequest(value);
    const customerServiceReview = await app.inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${order.id}/cancellation/review`,
      headers: customerService,
      payload: { approved: true, note: "不应由客服审核" },
    });
    expect(customerServiceReview.statusCode).toBe(403);
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${order.id}/cancellation/review`,
      headers: operator,
      payload: { approved: false, note: "已发车前置不满足" },
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json().data.status).toBe("REJECTED");
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/admin/community/orders/${order.id}/cancellation/review`,
      headers: operator,
      payload: { approved: false, note: "已发车前置不满足" },
    });
    expect(replay.statusCode).toBe(200);
    const financeList = await app.inject({
      method: "GET",
      url: "/api/v1/admin/community/cancellation-requests",
      headers: finance,
    });
    expect(financeList.statusCode).toBe(200);
    expect(financeList.json().data).toEqual([]);
  });

  it("makes manual notification completion auditable, idempotent and privacy-minimal", async () => {
    await store.createOrderNotificationIfAbsent({
      id: "notification-1",
      eventKey: "notice-1",
      userId: order.userId,
      orderId: order.id,
      type: "ARRIVED",
      title: "到货提醒",
      content: "sensitive notification body",
      status: "MANUAL_REQUIRED",
      readAt: null,
      manualCompletedAt: null,
      manualCompletedBy: null,
      manualCompletionNote: null,
      createdAt: order.createdAt,
      deliveryAttempts: 8,
      nextAttemptAt: null,
      deliveryLeaseUntil: null,
      deliveryClaimToken: null,
      providerSubmissionAttemptId: null,
      providerSubmissionStartedAt: null,
      providerResultRecordedAt: null,
      providerReceiptId: null,
      submissionUnknownReason: null,
      lastDeliveryError: "provider unavailable",
      deliveredAt: null,
    });
    const queue = await app.inject({
      method: "GET",
      url: "/api/v1/admin/notifications/manual",
      headers: customerService,
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().data[0]).toMatchObject({
      orderNo: order.orderNo,
      userDisplay: "用户 use***",
      deliveryAttempts: 8,
      lastDeliveryError: "provider unavailable",
    });
    expect(queue.body).not.toContain("sensitive notification body");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/admin/notifications/manual",
          headers: operator,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/notifications/notification-1/retry",
          headers: operator,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/notifications/notification-1/manual-complete",
          headers: operator,
          payload: {
            note: "运营不得代替客服完成联系",
            channel: "EXTERNAL_CRM",
            externalReference: "crm-operator-001",
            result: "RESOLVED",
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/notifications/notification-1/manual-complete",
          headers: customerService,
          payload: { note: "" },
        })
      ).statusCode,
    ).toBe(400);
    const unanswered = await app.inject({
      method: "POST",
      url: "/api/v1/admin/notifications/notification-1/manual-complete",
      headers: customerService,
      payload: {
        note: "已尝试联系但用户未回应",
        channel: "WECHAT_CUSTOMER_SERVICE",
        externalReference: "wx-session-unanswered-001",
        result: "NO_RESPONSE",
      },
    });
    expect(unanswered.statusCode).toBe(400);
    await expect(store.getOrderNotification("notification-1")).resolves.toMatchObject({
      status: "MANUAL_REQUIRED",
      manualCompletedAt: null,
    });
    const completed = await app.inject({
      method: "POST",
      url: "/api/v1/admin/notifications/notification-1/manual-complete",
      headers: customerService,
      payload: {
        note: "已通过既有合规渠道完成处理",
        channel: "WECHAT_CUSTOMER_SERVICE",
        externalReference: "wx-session-20260831-001",
        result: "USER_ACKNOWLEDGED",
      },
    });
    expect(completed.statusCode, completed.body).toBe(200);
    expect(completed.json().data).toMatchObject({
      status: "MANUAL_COMPLETED",
      manualCompletedBy: "cs",
      manualCompletionNote: "已通过既有合规渠道完成处理",
      manualCompletionChannel: "WECHAT_CUSTOMER_SERVICE",
      manualCompletionExternalReference: "wx-session-20260831-001",
      manualCompletionResult: "USER_ACKNOWLEDGED",
    });
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/admin/notifications/notification-1/manual-complete",
      headers: customerService,
      payload: {
        note: "不得覆盖首次人工事实",
        channel: "EXTERNAL_CRM",
        externalReference: "crm-replay-001",
        result: "RESOLVED",
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.manualCompletedBy).toBe("cs");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/admin/notifications/manual",
          headers: finance,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/admin/service-area-interests",
          headers: headers("manager", "PICKUP_MANAGER"),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await store.listAuditLogs(20)).filter(
        (entry) => entry.action === "ORDER_NOTIFICATION_MANUAL_COMPLETED",
      ),
    ).toHaveLength(1);
  });

  it("requeues only manually-required notifications once and fences stale workers", async () => {
    const createNotification = async (
      id: string,
      status:
        | "MANUAL_REQUIRED"
        | "IN_APP_AVAILABLE"
        | "WECHAT_SENT"
        | "MANUAL_COMPLETED"
        | "PENDING_DELIVERY"
        | "SUBMISSION_UNKNOWN",
    ) =>
      store.createOrderNotificationIfAbsent({
        id,
        eventKey: `retry-${id}`,
        userId: order.userId,
        orderId: order.id,
        type: "ARRIVED",
        title: "到货提醒",
        content: "仅测试",
        status,
        readAt: null,
        manualCompletedAt:
          status === "MANUAL_COMPLETED" ? order.createdAt : null,
        manualCompletedBy: null,
        manualCompletionNote: null,
        createdAt: order.createdAt,
        deliveryAttempts: status === "MANUAL_REQUIRED" ? 8 : 0,
        nextAttemptAt:
          status === "PENDING_DELIVERY"
            ? new Date(Date.now() + 60_000).toISOString()
            : null,
        deliveryLeaseUntil: null,
        deliveryClaimToken: status === "MANUAL_REQUIRED" ? "stale-worker" : null,
        providerSubmissionAttemptId:
          status === "SUBMISSION_UNKNOWN" ? "unknown-attempt" : null,
        providerSubmissionStartedAt:
          status === "SUBMISSION_UNKNOWN" ? order.createdAt : null,
        providerResultRecordedAt:
          status === "SUBMISSION_UNKNOWN" ? order.createdAt : null,
        providerReceiptId: null,
        submissionUnknownReason:
          status === "SUBMISSION_UNKNOWN" ? "provider timeout" : null,
        lastDeliveryError: status === "MANUAL_REQUIRED" ? "provider unavailable" : null,
        deliveredAt: status === "WECHAT_SENT" ? order.createdAt : null,
      });
    await createNotification("retry-manual", "MANUAL_REQUIRED");
    for (const status of [
      "IN_APP_AVAILABLE",
      "WECHAT_SENT",
      "MANUAL_COMPLETED",
      "PENDING_DELIVERY",
      "SUBMISSION_UNKNOWN",
    ] as const)
      await createNotification(`retry-${status}`, status);

    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/admin/notifications/missing/retry",
      headers: customerService,
    });
    expect(missing.statusCode).toBe(404);
    for (const status of [
      "IN_APP_AVAILABLE",
      "WECHAT_SENT",
      "MANUAL_COMPLETED",
      "PENDING_DELIVERY",
      "SUBMISSION_UNKNOWN",
    ] as const) {
      const rejected = await app.inject({
        method: "POST",
        url: `/api/v1/admin/notifications/retry-${status}/retry`,
        headers: customerService,
      });
      expect(rejected.statusCode, status).toBe(409);
      expect((await store.getOrderNotification(`retry-${status}`))?.status).toBe(
        status,
      );
    }

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/admin/notifications/retry-manual/retry",
        headers: customerService,
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/admin/notifications/retry-manual/retry",
        headers: customerService,
      }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const requeued = await store.getOrderNotification("retry-manual");
    expect(requeued).toMatchObject({
      status: "PENDING_DELIVERY",
      deliveryClaimToken: null,
    });
    // A pre-retry worker's claim is no longer valid and cannot restore a sent
    // state or deliver a second copy after the operator has requeued it.
    expect(
      await store.saveOrderNotificationIfClaimed(
        { ...requeued!, status: "WECHAT_SENT", deliveryClaimToken: null },
        "stale-worker",
      ),
    ).toBe(false);

    await store.saveDeliveryPlan({
      id: "plan-1",
      campaignId: order.campaignId,
      serviceAreaId: order.serviceAreaId,
      pickupPointId: order.pickupPointId,
      status: "SITE_CONFIRMED",
      siteName: "东门点位",
      address: "东门 1 号",
      arrivalStartAt: order.createdAt,
      arrivalEndAt: order.createdAt,
      contactName: "张店长",
      contactPhone: "13800000000",
      vehicleOrderNo: null,
      driverName: null,
      driverPhone: null,
      vehiclePlate: null,
      logisticsPlatform: null,
      estimatedArrivalAt: order.createdAt,
      remark: null,
      confirmedAt: order.createdAt,
      bookedAt: null,
      dispatchedAt: null,
      arrivedAt: null,
      createdAt: order.createdAt,
      updatedAt: order.createdAt,
    });
    const provider = { send: vi.fn().mockResolvedValue(undefined) };
    const service = new NotificationService(store, provider);
    await Promise.all([service.drainPending(), service.drainPending()]);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect((await store.getOrderNotification("retry-manual"))?.status).toBe(
      "WECHAT_SENT",
    );
    const unknownCompleted = await app.inject({
      method: "POST",
      url: "/api/v1/admin/notifications/retry-SUBMISSION_UNKNOWN/manual-complete",
      headers: customerService,
      payload: {
        note: "已在线下核验，请勿再次系统发送",
        channel: "EXTERNAL_CRM",
        externalReference: "crm-unknown-001",
        result: "REACHED",
      },
    });
    expect(unknownCompleted.statusCode, unknownCompleted.body).toBe(200);
    expect(unknownCompleted.json().data).toMatchObject({
      status: "MANUAL_COMPLETED",
      providerSubmissionAttemptId: "unknown-attempt",
      providerSubmissionStartedAt: order.createdAt,
    });
  });

  it("masks area-intent contacts, enforces a forward-only workflow and redacts audit snapshots", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/service-area-interests",
      headers: headers("user", "USER"),
      payload: {
        regionText: "朝阳区望京",
        contactName: "王小明",
        contactPhone: "13900000000",
        privacyAccepted: true,
        privacyVersion: "2026-09-07-phone-v1",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().data.id as string;
    const ownList = await app.inject({
      method: "GET",
      url: "/api/v1/service-area-interests",
      headers: headers("user", "USER"),
    });
    expect(ownList.statusCode).toBe(200);
    expect(ownList.json().data[0]).toMatchObject({
      id,
      maskedContactPhone: "139****0000",
      status: "NEW",
    });
    expect(ownList.body).not.toContain("13900000000");
    const corrected = await app.inject({
      method: "POST",
      url: `/api/v1/service-area-interests/${id}/correct`,
      headers: headers("user", "USER"),
      payload: {
        regionText: "朝阳区酒仙桥",
        contactName: "王小明",
        contactPhone: "13700000000",
        privacyAccepted: true,
        privacyVersion: "2026-09-07-phone-v1",
      },
    });
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(corrected.json().data).toMatchObject({
      regionText: "朝阳区酒仙桥",
      maskedContactPhone: "137****0000",
    });
    const crossUser = await app.inject({
      method: "POST",
      url: `/api/v1/service-area-interests/${id}/withdraw`,
      headers: headers("other-user", "USER"),
    });
    expect(crossUser.statusCode).toBe(404);
    const withdrawCandidate = await app.inject({
      method: "POST",
      url: "/api/v1/service-area-interests",
      headers: headers("user", "USER"),
      payload: {
        regionText: "海淀区学院路",
        contactName: "王小明",
        contactPhone: "13600000000",
        privacyAccepted: true,
        privacyVersion: "2026-09-07-phone-v1",
      },
    });
    const withdrawn = await app.inject({
      method: "POST",
      url: `/api/v1/service-area-interests/${withdrawCandidate.json().data.id}/withdraw`,
      headers: headers("user", "USER"),
    });
    expect(withdrawn.statusCode, withdrawn.body).toBe(200);
    expect(withdrawn.json().data.status).toBe("CLOSED");
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/admin/service-area-interests",
      headers: customerService,
    });
    expect(list.statusCode).toBe(200);
    expect(
      list.json().data.find((value: { id: string }) => value.id === id),
    ).toMatchObject({
      maskedContactPhone: "137****0000",
      status: "NEW",
      createdAt: expect.any(String),
    });
    expect(list.body).not.toContain("13700000000");
    await store.saveServiceAreaInterest({
      id: "legacy-without-consent",
      userId: "user",
      regionText: "不应进入运营队列",
      contactName: "旧数据",
      contactPhone: "13800000000",
      privacyVersion: null,
      privacyConsentedAt: null,
      status: "NEW",
      statusNote: null,
      statusChangedBy: null,
      statusChangedAt: null,
      createdAt: new Date().toISOString(),
    });
    const filtered = await app.inject({
      method: "GET",
      url: "/api/v1/admin/service-area-interests",
      headers: customerService,
    });
    expect(filtered.json().data).toHaveLength(2);
    const contacted = await app.inject({
      method: "POST",
      url: `/api/v1/admin/service-area-interests/${id}/status`,
      headers: customerService,
      payload: { status: "CONTACTED", note: "已按既有合规渠道处理" },
    });
    expect(contacted.statusCode, contacted.body).toBe(200);
    const editAfterHandling = await app.inject({
      method: "POST",
      url: `/api/v1/service-area-interests/${id}/correct`,
      headers: headers("user", "USER"),
      payload: {
        regionText: "朝阳区望京",
        contactName: "王小明",
        contactPhone: "13900000000",
        privacyAccepted: true,
        privacyVersion: "2026-09-07-phone-v1",
      },
    });
    expect(editAfterHandling.statusCode).toBe(409);
    const closed = await app.inject({
      method: "POST",
      url: `/api/v1/admin/service-area-interests/${id}/status`,
      headers: operator,
      payload: { status: "CLOSED", note: "已完成意向闭环" },
    });
    expect(closed.statusCode).toBe(200);
    const backtrack = await app.inject({
      method: "POST",
      url: `/api/v1/admin/service-area-interests/${id}/status`,
      headers: operator,
      payload: { status: "CONTACTED", note: "非法回退" },
    });
    expect(backtrack.statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/admin/service-area-interests",
          headers: finance,
        })
      ).statusCode,
    ).toBe(403);
    await store.saveAuditLog({
      id: randomUUID(),
      actorId: "super",
      action: "SENSITIVE_TEST",
      resourceType: "TEST",
      resourceId: "test",
      requestId: randomUUID(),
      beforeData: {
        contactPhone: "13900000000",
        driverPhone: "13800000000",
        token: "secret-token",
      },
      afterData: { nested: { openId: "openid-user", temporaryPassword: "secret" } },
      createdAt: new Date().toISOString(),
    });
    const audits = await app.inject({
      method: "GET",
      url: "/api/v1/admin/audit-logs",
      headers: superAdmin,
    });
    expect(audits.statusCode).toBe(200);
    expect(audits.body).not.toContain("13900000000");
    expect(audits.body).not.toContain("13800000000");
    expect(audits.body).not.toContain("secret-token");
    expect(audits.body).not.toContain("openid-user");
  });

  it("returns auditable ledger totals and rejects a point suspension with an active manager", async () => {
    const now = new Date().toISOString();
    const transaction: LedgerTransaction = {
      id: "ledger-1",
      referenceType: "ORDER",
      referenceId: order.id,
      eventType: "PAYMENT_SUCCEEDED",
      createdAt: now,
      lines: [
        { accountCode: "CASH", ownerId: null, direction: "DEBIT", amountCents: 1600 },
        { accountCode: "PAYABLE", ownerId: null, direction: "CREDIT", amountCents: 1600 },
      ],
    };
    await store.appendLedgerTransaction(transaction);
    const ledger = await app.inject({
      method: "GET",
      url: "/api/v1/admin/finance/ledger",
      headers: finance,
    });
    expect(ledger.statusCode).toBe(200);
    expect(ledger.json().data[0]).toMatchObject({
      debitCents: 1600,
      creditCents: 1600,
      isBalanced: true,
    });
    await store.saveServiceArea({
      id: "area-1",
      regionCode: "110101",
      name: "东城区",
      status: "ENABLED",
      orderEnabled: true,
      createdAt: now,
    });
    await store.savePickupPoint({
      id: "point-1",
      serviceAreaId: "area-1",
      name: "东门点位",
      address: "东门 1 号",
      businessHours: "09:00-20:00",
      pickupInstructions: "凭码领取",
      latitude: 39.9,
      longitude: 116.4,
      contactName: "张店长",
      contactPhone: "13800000000",
      status: "ACTIVE",
      capacityPerDay: null,
      createdAt: now,
    });
    await store.saveUser({
      id: "manager",
      wechatOpenId: null,
      status: "ACTIVE",
      createdAt: now,
    });
    await store.saveInternalStaff({
      userId: "manager",
      staffNo: "STF-MANAGER",
      displayName: "点位负责人",
      phone: "13800000000",
      role: "PICKUP_MANAGER",
      status: "ACTIVE",
      createdBy: "super",
      activatedAt: now,
      suspendedAt: null,
      suspensionReason: null,
      authorizationVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    await store.replaceStaffPickupPointAssignments("manager", [
      {
        staffUserId: "manager",
        pickupPointId: "point-1",
        assignedBy: "super",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const suspended = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/pickup-points/point-1",
      headers: superAdmin,
      payload: { status: "INACTIVE" },
    });
    expect(suspended.statusCode).toBe(409);
  });

  it("rolls back every P1-C configuration write when its audit fact cannot persist", async () => {
    const now = new Date().toISOString();
    await store.saveServiceArea({
      id: "area-config",
      regionCode: "110102",
      name: "西城区",
      status: "ENABLED",
      orderEnabled: true,
      createdAt: now,
    });
    await store.savePickupPoint({
      id: "point-config",
      serviceAreaId: "area-config",
      name: "原点位名",
      address: "西门 1 号",
      businessHours: "09:00-20:00",
      pickupInstructions: "凭码领取",
      latitude: 39.9,
      longitude: 116.4,
      contactName: "张店长",
      contactPhone: "13800000000",
      status: "ACTIVE",
      capacityPerDay: null,
      createdAt: now,
    });
    const failNextAudit = () =>
      vi.spyOn(store, "saveAuditLog").mockRejectedValueOnce(
        new Error("audit unavailable"),
      );

    failNextAudit();
    const sku = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/skus",
      headers: superAdmin,
      payload: {
        id: "sku-audit-rollback",
        title: "不应留下的商品",
        category: "蔬菜",
        origin: "本地",
        imageUrl: null,
        skuName: "一份",
        retailPriceCents: 100,
        defaultSellableQuantity: 1,
        status: "ACTIVE",
      },
    });
    expect(sku.statusCode).toBe(500);
    expect(await store.getCatalogSku("sku-audit-rollback")).toBeNull();

    failNextAudit();
    const point = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pickup-points",
      headers: superAdmin,
      payload: {
        serviceAreaId: "area-config",
        name: "不应留下的点位",
        address: "西门 2 号",
        businessHours: "09:00-20:00",
        pickupInstructions: "凭码领取",
        latitude: 39.91,
        longitude: 116.41,
        contactName: "李店长",
        contactPhone: "13900000000",
        capacityPerDay: 10,
      },
    });
    expect(point.statusCode).toBe(500);
    expect(
      (await store.listPickupPoints("area-config")).some(
        (value) => value.name === "不应留下的点位",
      ),
    ).toBe(false);

    failNextAudit();
    const pointPatch = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/pickup-points/point-config",
      headers: superAdmin,
      payload: { name: "不应留下的新名称" },
    });
    expect(pointPatch.statusCode).toBe(500);
    expect(
      (await store.listPickupPoints("area-config")).find(
        (value) => value.id === "point-config",
      )?.name,
    ).toBe("原点位名");

    failNextAudit();
    const areaPatch = await app.inject({
      method: "POST",
      url: "/api/v1/admin/service-areas/area-config/order-status",
      headers: superAdmin,
      payload: { orderEnabled: false },
    });
    expect(areaPatch.statusCode).toBe(500);
    expect(
      (await store.listServiceAreas()).find((value) => value.id === "area-config")
        ?.orderEnabled,
    ).toBe(true);
  });

  it("keeps historical order snapshots immutable and blocks point deactivation for an in-progress delivery", async () => {
    const now = new Date().toISOString();
    await store.saveCatalogSku({
      id: "sku-1",
      productId: "product-1",
      name: "原始规格",
      retailPriceCents: 800,
      defaultSellableQuantity: 20,
      status: "ACTIVE",
      product: {
        id: "product-1",
        title: "原始商品名",
        category: "蔬菜",
        origin: "本地农场",
        imageUrl: null,
        storageType: "NORMAL_TEMPERATURE",
        status: "ACTIVE",
      },
      createdAt: now,
      updatedAt: now,
    });
    const catalogUpdate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/skus",
      headers: superAdmin,
      payload: {
        id: "sku-1",
        productId: "product-1",
        title: "更新后的商品名",
        category: "蔬菜",
        origin: "更新产地",
        imageUrl: null,
        skuName: "更新规格",
        retailPriceCents: 900,
        defaultSellableQuantity: 30,
        status: "ACTIVE",
      },
    });
    expect(catalogUpdate.statusCode, catalogUpdate.body).toBe(200);
    const historicalOrder = await app.inject({
      method: "GET",
      url: `/api/v1/orders/${order.id}`,
      headers: headers(order.userId, "USER"),
    });
    expect(historicalOrder.statusCode, historicalOrder.body).toBe(200);
    expect(historicalOrder.json().data.items[0]).toMatchObject({
      name: "当季番茄",
      unitPriceCents: 800,
    });

    await store.saveServiceArea({
      id: "area-live",
      regionCode: "110103",
      name: "崇文区",
      status: "ENABLED",
      orderEnabled: true,
      createdAt: now,
    });
    await store.savePickupPoint({
      id: "point-live",
      serviceAreaId: "area-live",
      name: "在途点位",
      address: "南门 1 号",
      businessHours: "09:00-20:00",
      pickupInstructions: "凭码领取",
      latitude: 39.9,
      longitude: 116.4,
      contactName: "王店长",
      contactPhone: "13700000000",
      status: "ACTIVE",
      capacityPerDay: null,
      createdAt: now,
    });
    await store.saveDeliveryPlan({
      id: "plan-live",
      campaignId: "campaign-live",
      serviceAreaId: "area-live",
      pickupPointId: "point-live",
      status: "IN_TRANSIT",
      siteName: "在途点位",
      address: "南门 1 号",
      arrivalStartAt: now,
      arrivalEndAt: now,
      contactName: "王店长",
      contactPhone: "13700000000",
      vehicleOrderNo: "VEHICLE-LIVE",
      driverName: "司机",
      driverPhone: "13600000000",
      vehiclePlate: "京A00001",
      logisticsPlatform: "测试车队",
      estimatedArrivalAt: now,
      remark: null,
      confirmedAt: now,
      bookedAt: now,
      dispatchedAt: now,
      arrivedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const blocked = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/pickup-points/point-live",
      headers: superAdmin,
      payload: { status: "INACTIVE" },
    });
    expect(blocked.statusCode).toBe(409);
    expect(
      (await store.listPickupPoints("area-live")).find(
        (point) => point.id === "point-live",
      )?.status,
    ).toBe("ACTIVE");
  });

  it("requires a complete future postpone schedule, writes audit/outbox facts, and hides inactive items publicly", async () => {
    const now = Date.now();
    const cutoffAt = new Date(now + 60 * 60_000).toISOString();
    const dispatchAt = new Date(now + 2 * 60 * 60_000).toISOString();
    const arrivalStartAt = new Date(now + 3 * 60 * 60_000).toISOString();
    const arrivalEndAt = new Date(now + 4 * 60 * 60_000).toISOString();
    const createdAt = new Date(now).toISOString();
    await store.saveServiceArea({
      id: "area-1",
      regionCode: "110101",
      name: "东城区",
      status: "ENABLED",
      orderEnabled: true,
      createdAt,
    });
    await store.savePickupPoint({
      id: "point-1",
      serviceAreaId: "area-1",
      name: "东门点位",
      address: "东门 1 号",
      businessHours: "09:00-20:00",
      pickupInstructions: "凭码领取",
      latitude: 39.9,
      longitude: 116.4,
      contactName: "张店长",
      contactPhone: "13800000000",
      status: "ACTIVE",
      capacityPerDay: null,
      createdAt,
    });
    await store.saveCatalogSku({
      id: "sku-1",
      productId: "product-1",
      name: "每份两斤",
      retailPriceCents: 800,
      defaultSellableQuantity: 50,
      status: "INACTIVE",
      product: {
        id: "product-1",
        title: "当季番茄",
        category: "蔬菜",
        origin: "本地农场",
        imageUrl: null,
        storageType: "NORMAL_TEMPERATURE",
        status: "DRAFT",
      },
      createdAt,
      updatedAt: createdAt,
    });
    await store.saveCampaign({
      id: "campaign-1",
      title: "顺延团期",
      serviceAreaId: "area-1",
      cutoffAt,
      dispatchAt,
      estimatedArrivalStartAt: arrivalStartAt,
      estimatedArrivalEndAt: arrivalEndAt,
      minTotalQuantity: 100,
      failureAction: "POSTPONE",
      items: [
        {
          catalogSkuId: "sku-1",
          productId: "product-1",
          title: "当季番茄",
          category: "蔬菜",
          skuName: "每份两斤",
          origin: "本地农场",
          imageUrl: null,
          retailPriceCents: 800,
          sellableQuantity: 50,
          reservedQuantity: 0,
        },
      ],
      status: "POSTPONED",
      version: 2,
      createdAt,
    });
    await store.saveDeliveryPlan({
      id: "plan-1",
      campaignId: "campaign-1",
      serviceAreaId: "area-1",
      pickupPointId: "point-1",
      status: "SITE_CONFIRMED",
      siteName: "东门点位",
      address: "东门 1 号",
      arrivalStartAt,
      arrivalEndAt,
      contactName: "张店长",
      contactPhone: "13800000000",
      vehicleOrderNo: null,
      driverName: null,
      driverPhone: null,
      vehiclePlate: null,
      logisticsPlatform: null,
      estimatedArrivalAt: arrivalStartAt,
      remark: null,
      confirmedAt: createdAt,
      bookedAt: null,
      dispatchedAt: null,
      arrivedAt: null,
      createdAt,
      updatedAt: createdAt,
    });
    const missingArrival = await app.inject({
      method: "POST",
      url: "/api/v1/admin/campaigns/campaign-1/postpone",
      headers: superAdmin,
      payload: { cutoffAt, dispatchAt },
    });
    expect(missingArrival.statusCode).toBe(400);
    const notificationWrite = vi.spyOn(
      store,
      "createOrderNotificationIfAbsent",
    );
    notificationWrite.mockRejectedValueOnce(new Error("outbox unavailable"));
    const atomicFailure = await app.inject({
      method: "POST",
      url: "/api/v1/admin/campaigns/campaign-1/postpone",
      headers: superAdmin,
      payload: {
        cutoffAt,
        dispatchAt,
        estimatedArrivalStartAt: arrivalStartAt,
        estimatedArrivalEndAt: arrivalEndAt,
      },
    });
    expect(atomicFailure.statusCode).toBe(500);
    expect((await store.getCampaign("campaign-1"))?.status).toBe("POSTPONED");
    expect(
      (await store.listAuditLogs(20)).some(
        (entry) => entry.action === "CAMPAIGN_POSTPONED",
      ),
    ).toBe(false);
    const auditWrite = vi.spyOn(store, "saveAuditLog");
    auditWrite.mockRejectedValueOnce(new Error("audit unavailable"));
    const auditFailure = await app.inject({
      method: "POST",
      url: "/api/v1/admin/campaigns/campaign-1/postpone",
      headers: superAdmin,
      payload: {
        cutoffAt,
        dispatchAt,
        estimatedArrivalStartAt: arrivalStartAt,
        estimatedArrivalEndAt: arrivalEndAt,
      },
    });
    expect(auditFailure.statusCode).toBe(500);
    expect((await store.getCampaign("campaign-1"))?.status).toBe("POSTPONED");
    expect(
      (await store.listOrderNotificationsByUser(order.userId)).filter(
        (entry) => entry.type === "CAMPAIGN_POSTPONED",
      ),
    ).toHaveLength(0);
    expect(
      (await store.listAuditLogs(20)).some(
        (entry) => entry.action === "CAMPAIGN_POSTPONED",
      ),
    ).toBe(false);
    const postponed = await app.inject({
      method: "POST",
      url: "/api/v1/admin/campaigns/campaign-1/postpone",
      headers: superAdmin,
      payload: {
        cutoffAt,
        dispatchAt,
        estimatedArrivalStartAt: arrivalStartAt,
        estimatedArrivalEndAt: arrivalEndAt,
      },
    });
    expect(postponed.statusCode, postponed.body).toBe(200);
    expect(postponed.json().data.status).toBe("OPEN");
    expect(
      (await store.listAuditLogs(20)).some(
        (entry) => entry.action === "CAMPAIGN_POSTPONED",
      ),
    ).toBe(true);
    expect(
      (await store.listAuditLogs(20)).filter(
        (entry) => entry.action === "CAMPAIGN_POSTPONED",
      ),
    ).toHaveLength(1);
    expect(
      (await store.listOrderNotificationsByUser(order.userId)).some(
        (entry) => entry.type === "CAMPAIGN_POSTPONED",
      ),
    ).toBe(true);
    const publicCampaign = await app.inject({
      method: "GET",
      url: "/api/v1/campaigns/campaign-1",
    });
    expect(publicCampaign.statusCode).toBe(200);
    expect(publicCampaign.json().data.items).toEqual([]);
    const reopened = await store.getCampaign("campaign-1");
    expect(reopened?.postponementCount).toBe(1);
    reopened!.cutoffAt = new Date(Date.now() - 1000).toISOString();
    expect(await store.updateCampaign(reopened!, reopened!.version)).toBe(true);
    const secondMiss = await app.inject({
      method: "POST",
      url: "/api/v1/admin/campaigns/campaign-1/close",
      headers: superAdmin,
      payload: { reason: "第二次仍未达到成团量" },
    });
    expect(secondMiss.statusCode, secondMiss.body).toBe(200);
    expect(secondMiss.json().data.status).toBe("CANCELLED");
  });
});
