import type { FastifyInstance } from "fastify";
import { homepageBannerSchema, identifierSchema } from "@hometown/api-contracts";
import { BusinessError } from "@hometown/domain";
import { randomUUID } from "node:crypto";
import { requireActor } from "../modules/auth/auth.js";
import type { CommerceStore } from "../modules/core/store.js";
import type { HomepageBanner } from "../modules/core/types.js";
import type { ProductImages } from "../modules/media/product-images.js";
import { z } from "zod";

function assertImageUrl(images: ProductImages, imageUrl: string): Promise<void> {
  if (!imageUrl.startsWith("/api/v1/product-images/"))
    throw new BusinessError("VALIDATION_ERROR", "请先上传轮播图片", 400);
  return images.validateReference(imageUrl);
}

async function validateTarget(store: CommerceStore, input: { scope: string; serviceAreaId: string | null; targetType: string; targetValue: string | null }): Promise<void> {
  if (input.scope === "SERVICE_AREA") {
    const [areas, points] = await Promise.all([store.listServiceAreas(), store.listPickupPoints()]);
    if (!areas.some((value) => value.id === input.serviceAreaId && value.status === "ENABLED" && value.orderEnabled)
      || !points.some((value) => value.serviceAreaId === input.serviceAreaId && value.status === "ACTIVE"))
      throw new BusinessError("RESOURCE_NOT_FOUND", "服务区域未开放接单或没有可用自提点", 404);
  }
  if (input.targetType === "CAMPAIGN" && !(input.targetValue && await store.getCampaign(input.targetValue)))
    throw new BusinessError("RESOURCE_NOT_FOUND", "跳转团期不存在", 404);
  if (input.targetType === "CATEGORY") {
    const category = input.targetValue ? await store.getProductCategory(input.targetValue) : null;
    if (!category || category.status !== "ACTIVE")
      throw new BusinessError("RESOURCE_NOT_FOUND", "跳转分类不存在或已停用", 404);
  }
}

export function registerMerchandisingRoutes(app: FastifyInstance, dependencies: { store: CommerceStore; images: ProductImages }): void {
  const { store, images } = dependencies;
  app.get("/api/v1/homepage-banners", async (request) => {
    const query = request.query as { serviceAreaId?: string };
    const serviceAreaId = query.serviceAreaId ? identifierSchema.parse(query.serviceAreaId) : null;
    const now = Date.parse(await store.databaseNow());
    const values = await store.readSnapshot(async (snapshot) => snapshot.listHomepageBanners());
    const [areas, points] = await Promise.all([store.listServiceAreas(), store.listPickupPoints()]);
    const publicAreaIds = new Set(areas
      .filter((area) => area.status === "ENABLED" && area.orderEnabled && points.some((point) => point.serviceAreaId === area.id && point.status === "ACTIVE"))
      .map((area) => area.id));
    const visible = values.filter((value) =>
        (value.scope === "ALL" || value.serviceAreaId === serviceAreaId) &&
        (value.scope === "ALL" || (value.serviceAreaId !== null && publicAreaIds.has(value.serviceAreaId))) &&
        (value.startsAt === null || Date.parse(value.startsAt) <= now) &&
        (value.endsAt === null || Date.parse(value.endsAt) >= now));
    const resolved = await Promise.all(visible.map(async ({ id, title, subtitle, imageUrl, targetType, targetValue }) => {
      const category = targetType === "CATEGORY" && targetValue ? await store.getProductCategory(targetValue) : null;
      if (targetType === "CATEGORY" && (!category || category.status !== "ACTIVE")) return null;
      return {
        id,
        title,
        subtitle,
        imageUrl,
        targetType,
        targetValue: targetType === "CATEGORY" ? category?.name ?? null : targetValue,
      };
    }));
    const data = resolved.filter((value) => value !== null);
    return { data };
  });
  app.get("/api/v1/admin/homepage-banners", async (request) => {
    requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    return { data: await store.listHomepageBanners(true) };
  });
  app.post("/api/v1/admin/homepage-banners", async (request, reply) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const input = homepageBannerSchema.parse(request.body);
    await assertImageUrl(images, input.imageUrl);
    const result = await store.transaction(async (transactionStore) => {
      const existing = input.id ? await transactionStore.getHomepageBanner(input.id) : null;
      if (input.id && !existing) throw new BusinessError("RESOURCE_NOT_FOUND", "轮播不存在", 404);
      if (existing && input.version !== existing.version)
        throw new BusinessError("CONCURRENT_MODIFICATION", "轮播已被修改，请刷新后重试", 409);
      await validateTarget(transactionStore, input);
      const now = new Date().toISOString();
      const value: HomepageBanner = {
        id: input.id ?? randomUUID(),
        title: input.title,
        subtitle: input.subtitle,
        imageUrl: input.imageUrl,
        targetType: input.targetType,
        targetValue: input.targetValue,
        scope: input.scope,
        serviceAreaId: input.serviceAreaId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        sortOrder: input.sortOrder,
        status: input.status,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await transactionStore.saveHomepageBanner(value);
      await transactionStore.saveAuditLog({
        id: randomUUID(),
        actorId: actor.userId,
        action: existing ? "HOMEPAGE_BANNER_UPDATED" : "HOMEPAGE_BANNER_CREATED",
        resourceType: "HOMEPAGE_BANNER",
        resourceId: value.id,
        requestId: request.id,
        beforeData: existing,
        afterData: value,
        createdAt: now,
      });
      return { existing, value };
    });
    return reply.status(result.existing ? 200 : 201).send({ data: result.value });
  });
  app.delete("/api/v1/admin/homepage-banners/:id", async (request) => {
    const actor = requireActor(request, ["OPERATOR", "SUPER_ADMIN"]);
    const id = identifierSchema.parse((request.params as { id: string }).id);
    const input = z.object({ version: z.int().min(1) }).parse(request.body);
    const before = await store.getHomepageBanner(id);
    if (!before) throw new BusinessError("RESOURCE_NOT_FOUND", "轮播不存在", 404);
    const deleted = await store.transaction(async (transactionStore) => {
      const ok = await transactionStore.deleteHomepageBanner(id, input.version);
      if (!ok) throw new BusinessError("CONCURRENT_MODIFICATION", "轮播已被修改，请刷新后重试", 409);
      await transactionStore.saveAuditLog({
        id: randomUUID(),
        actorId: actor.userId,
        action: "HOMEPAGE_BANNER_DELETED",
        resourceType: "HOMEPAGE_BANNER",
        resourceId: id,
        requestId: request.id,
        beforeData: before,
        afterData: null,
        createdAt: new Date().toISOString(),
      });
      return ok;
    });
    return { data: { deleted } };
  });
}
