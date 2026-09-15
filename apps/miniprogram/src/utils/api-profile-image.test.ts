import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRIVACY_NOTICE_VERSION } from "../config/legal";

describe("consumer profile image upload", () => {
  const storage = new Map<string, unknown>();

  beforeEach(() => {
    storage.clear();
    vi.resetModules();
  });

  it("uploads the chosen image as raw bytes with its real media type", async () => {
    storage.set("accessToken", "profile-token");
    storage.set("hometown-privacy-notice-version", PRIVACY_NOTICE_VERSION);
    const body = new Uint8Array([137, 80, 78, 71]).buffer;
    const request = vi.fn((options: {
      data: ArrayBuffer;
      header: Record<string, string>;
      success: (response: unknown) => void;
    }) => options.success({ statusCode: 201, data: { data: { imageUrl: "/api/v1/profile-images/avatar.webp" } } }));
    vi.stubGlobal("getApp", () => ({
      globalData: { apiBaseUrl: "https://api.example.test", authMode: "wechat", accessToken: "profile-token", subscriptionTemplates: [] },
    }));
    vi.stubGlobal("wx", {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      getFileSystemManager: () => ({ readFile: (options: { success: (result: { data: ArrayBuffer }) => void }) => options.success({ data: body }) }),
      request,
    });

    const { api } = await import("./api");
    await expect(api.uploadProfileImage("wxfile://tmp/avatar.png")).resolves.toEqual({ imageUrl: "/api/v1/profile-images/avatar.webp" });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      data: body,
      header: expect.objectContaining({ "content-type": "image/png", authorization: "Bearer profile-token" }),
    }));
  });

  it("rejects unsupported local image types before sending data", async () => {
    storage.set("accessToken", "profile-token");
    storage.set("hometown-privacy-notice-version", PRIVACY_NOTICE_VERSION);
    const request = vi.fn();
    vi.stubGlobal("getApp", () => ({
      globalData: { apiBaseUrl: "https://api.example.test", authMode: "wechat", accessToken: "profile-token", subscriptionTemplates: [] },
    }));
    vi.stubGlobal("wx", {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      getFileSystemManager: vi.fn(),
      request,
    });

    const { api } = await import("./api");
    await expect(api.uploadProfileImage("wxfile://tmp/avatar.gif")).rejects.toThrow("JPG、PNG 或 WebP");
    expect(request).not.toHaveBeenCalled();
  });

  it("downloads a saved avatar only through an authenticated request", async () => {
    storage.set("accessToken", "profile-token");
    storage.set("hometown-privacy-notice-version", PRIVACY_NOTICE_VERSION);
    const downloadFile = vi.fn((options: { header: Record<string, string>; success: (response: unknown) => void }) =>
      options.success({ statusCode: 200, tempFilePath: "wxfile://tmp/private-avatar.webp" }));
    vi.stubGlobal("getApp", () => ({
      globalData: { apiBaseUrl: "https://api.example.test", authMode: "wechat", accessToken: "profile-token", subscriptionTemplates: [] },
    }));
    vi.stubGlobal("wx", {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      downloadFile,
    });

    const { api } = await import("./api");
    await expect(api.downloadMyProfileImage("/api/v1/profile-images/avatar.webp")).resolves.toBe("wxfile://tmp/private-avatar.webp");
    expect(downloadFile).toHaveBeenCalledWith(expect.objectContaining({
      header: { authorization: "Bearer profile-token" },
    }));
  });
});
