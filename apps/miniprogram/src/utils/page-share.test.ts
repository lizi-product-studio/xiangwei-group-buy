import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: {}, customerAuth: { isDemoLoginAvailable: () => false }, customerErrorMessage: () => "" }));
vi.mock("./auth-intent", () => ({ readAuthIntent: () => null, sourceText: () => "个人服务" }));

type SharePage = {
  onLoad: (options: Record<string, string>) => void;
  onShareAppMessage: () => {title: string; path: string};
  onShareTimeline: () => {title: string; query: string};
  setData: (value: unknown) => void;
};

describe("public page sharing", () => {
  beforeEach(() => vi.resetModules());
  for (const name of ["home", "login"] as const) {
    it(`${name} enables both menus and excludes incoming private query values`, async () => {
      const showShareMenu = vi.fn();
      vi.stubGlobal("wx", { showShareMenu });
      let page!: SharePage;
      vi.stubGlobal("Page", (value: SharePage) => { page = value; });
      if (name === "home") await import("../pages/home/index");
      else await import("../pages/login/index");
      page.setData = vi.fn();
      page.onLoad({ source: "checkout", token: "private-token", phone: "private-phone", redirect: "/pages/orders/index" });
      expect(showShareMenu).toHaveBeenCalledExactlyOnceWith({menus: ["shareAppMessage", "shareTimeline"]});
      expect(page.onShareAppMessage()).toEqual({title: "乡味集｜好味道，一起分享", path: `/pages/${name}/index`});
      expect(page.onShareTimeline()).toEqual({title: "乡味集｜好味道，一起分享", query: ""});
      vi.stubGlobal("wx", {});
      expect(() => page.onLoad({})).not.toThrow();
    });
  }
});
