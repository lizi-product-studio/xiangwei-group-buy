import { describe, expect, it } from "vitest";
import { carouselReadinessText, nextBannerSortOrder } from "./homepage-banners-page.tsx";

describe("homepage carousel editing guidance", () => {
  it("makes the single-image state explicit", () => {
    expect(carouselReadinessText(1)).toBe("当前仅启用 1 张，不会自动轮播");
    expect(carouselReadinessText(2)).toBe("当前已启用 2 张，可自动轮播");
  });

  it("places a newly added slide after the existing slides", () => {
    expect(nextBannerSortOrder([])).toBe(0);
    expect(nextBannerSortOrder([{ sortOrder: 0 }, { sortOrder: 20 }])).toBe(30);
  });
});
