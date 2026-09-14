import { describe, expect, it } from "vitest";
import { getEntryBranding } from "./entry-branding.ts";

describe("domain entry branding", () => {
  it("uses the approved pickup entry only on its exact hostname", () => {
    expect(getEntryBranding("saas.liziqi.icu")).toMatchObject({
      title: "乡味集 · 点位工作台",
      storyTitle: "乡味集 · 点位工作台",
      loginTitle: "点位负责人登录",
      loginBrand: "乡味集",
      description: "使用点位负责人账号登录，处理到货确认与提货核销。",
    });
  });

  it.each(["admin.liziqi.icu", "localhost", "saas.liziqi.icu.example.com", "other.liziqi.icu"])(
    "preserves the existing admin entry on %s",
    (hostname) => {
      expect(getEntryBranding(hostname)).toMatchObject({
        title: "乡味集 · 运营管理后台",
        storyTitle: "乡味集 · 运营管理后台",
        loginTitle: "乡味集 · 运营管理后台",
        loginBrand: "乡味集",
        workspaceDescription: "社区团购 · 运营管理",
      });
    },
  );
});
