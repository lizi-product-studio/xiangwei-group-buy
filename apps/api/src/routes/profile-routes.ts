import type { FastifyInstance, FastifyRequest } from "fastify";
import { consumerProfileSchema, phoneRebindSchema } from "@hometown/api-contracts";
import { BusinessError } from "@hometown/domain";
import { requireActor } from "../modules/auth/auth.js";
import type { AuthService } from "../modules/auth/wechat-auth.js";
import type { CommerceStore } from "../modules/core/store.js";
import type { ProductImages } from "../modules/media/product-images.js";
import type { User } from "../modules/core/types.js";

function publicProfile(user: User) {
  return {
    id: user.id,
    displayName: user.displayName ?? "微信用户",
    avatarUrl: user.avatarUrl ?? null,
    phoneNumber: user.phoneNumber && /^1[3-9]\d{9}$/.test(user.phoneNumber)
      ? `${user.phoneNumber.slice(0, 3)}****${user.phoneNumber.slice(-4)}`
      : null,
    profileVersion: user.profileVersion ?? 0,
  };
}

export function registerProfileRoutes(app: FastifyInstance, dependencies: { store: CommerceStore; images: ProductImages; authService: AuthService | null }): void {
  const { store, images, authService } = dependencies;
  app.get("/api/v1/me/profile", async (request) => {
    const actor = requireActor(request, ["USER"]);
    const user = await store.getUser(actor.userId);
    if (!user || user.status !== "ACTIVE") throw new BusinessError("AUTH_REQUIRED", "请先登录", 401);
    return { data: publicProfile(user) };
  });
  const updateProfile = async (request: FastifyRequest) => {
    const actor = requireActor(request, ["USER"]);
    const input = consumerProfileSchema.parse(request.body);
    if (input.avatarUrl && !input.avatarUrl.startsWith("/api/v1/profile-images/"))
      throw new BusinessError("VALIDATION_ERROR", "头像地址无效", 400);
    if (input.avatarUrl) await images.validateReference(input.avatarUrl);
    const value = await store.transaction(async (transactionStore) => {
      const user = await transactionStore.getUser(actor.userId);
      if (!user || user.status !== "ACTIVE") throw new BusinessError("AUTH_REQUIRED", "请先登录", 401);
      const version = user.profileVersion ?? 0;
      if (version !== input.expectedVersion)
        throw new BusinessError("CONCURRENT_MODIFICATION", "个人资料已更新，请刷新后重试", 409);
      const after: User = {
        ...user,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        profileUpdatedAt: new Date().toISOString(),
        profileVersion: version + 1,
      };
      await transactionStore.saveUser(after);
      return after;
    });
    return { data: publicProfile(value) };
  };
  // Mini Program request support differs between base-library versions; POST
  // is the consumer client contract while PATCH remains for API compatibility.
  app.post("/api/v1/me/profile", updateProfile);
  app.patch("/api/v1/me/profile", updateProfile);
  app.post("/api/v1/me/phone/rebind", async (request) => {
    const actor = requireActor(request, ["USER"]);
    if (!authService) throw new BusinessError("FORBIDDEN", "当前环境未启用微信登录", 403);
    const input = phoneRebindSchema.parse(request.body);
    const value = await authService.rebindPhone(actor.userId, input.phoneCode, input.expectedVersion, request.id);
    return { data: publicProfile(value) };
  });
}
