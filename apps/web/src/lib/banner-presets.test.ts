import { describe, expect, it } from "vitest";
import {
  BANNER_PALETTES,
  BANNER_TEMPLATES,
  getPaletteById,
  calculateDiscountPercent,
  generateDiscountBadge,
  formatBannerDimensions,
} from "./banner-presets";

describe("Banner Presets & Dimensions", () => {
  it("should have all core and festival e-commerce palettes defined", () => {
    expect(BANNER_PALETTES.length).toBeGreaterThanOrEqual(6);
    const ids = BANNER_PALETTES.map((p) => p.id);
    expect(ids).toContain("navy");
    expect(ids).toContain("crimson");
    expect(ids).toContain("emerald");
    expect(ids).toContain("gold");
    expect(ids).toContain("eid_emerald_gold");
    expect(ids).toContain("boishakh_red");
    expect(ids).toContain("cyber_neon");
  });

  it("should return fallback palette when unknown id is passed", () => {
    const pal = getPaletteById("unknown_palette_123");
    expect(pal).toBeDefined();
    expect(pal.id).toBe("navy");
  });

  it("should correctly calculate discount percentage", () => {
    // 1000 original, 700 current => 30% discount
    const disc = calculateDiscountPercent(700, 1000);
    expect(disc).toBe(30);

    // No compareAt or same price => null
    expect(calculateDiscountPercent(1000, 1000)).toBeNull();
    expect(calculateDiscountPercent(1200, 1000)).toBeNull();
    expect(calculateDiscountPercent(1000, null)).toBeNull();
  });

  it("should generate discount badge with Bengali text", () => {
    const badge = generateDiscountBadge(1500, 2000);
    expect(badge).not.toBeNull();
    expect(badge?.percent).toBe(25);
    expect(badge?.text).toBe("ফ্ল্যাট 25% ছাড়");
  });

  it("should return exact pixel dimensions for 1:1, 9:16, 16:9, and 4:5 aspect ratios", () => {
    const square = formatBannerDimensions("1:1");
    expect(square.width).toBe(1080);
    expect(square.height).toBe(1080);

    const story = formatBannerDimensions("9:16");
    expect(story.width).toBe(1080);
    expect(story.height).toBe(1920);

    const landscape = formatBannerDimensions("16:9");
    expect(landscape.width).toBe(1920);
    expect(landscape.height).toBe(1080);

    const portrait = formatBannerDimensions("4:5");
    expect(portrait.width).toBe(1080);
    expect(portrait.height).toBe(1350);
  });

  it("should have all 8 marketing and festival template styles", () => {
    expect(BANNER_TEMPLATES.length).toBe(8);
    const styles = BANNER_TEMPLATES.map((t) => t.id);
    expect(styles).toContain("minimal");
    expect(styles).toContain("flash_sale");
    expect(styles).toContain("cod_trust");
    expect(styles).toContain("festive");
    expect(styles).toContain("eid_special");
    expect(styles).toContain("pohela_boishakh");
    expect(styles).toContain("black_friday");
    expect(styles).toContain("winter_clearance");
  });
});
