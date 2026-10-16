import { describe, expect, it } from "vitest";
import {
  BANNER_PALETTES,
  BANNER_TEMPLATES,
  getPaletteById,
  calculateDiscountPercent,
  formatBannerDimensions,
} from "./banner-presets";

describe("Banner Presets & Dimensions", () => {
  it("should have all 6 core e-commerce palettes defined", () => {
    expect(BANNER_PALETTES.length).toBe(6);
    const ids = BANNER_PALETTES.map((p) => p.id);
    expect(ids).toContain("navy");
    expect(ids).toContain("crimson");
    expect(ids).toContain("emerald");
    expect(ids).toContain("violet");
    expect(ids).toContain("gold");
    expect(ids).toContain("obsidian");
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

  it("should return exact pixel dimensions for 1:1 and 9:16 aspect ratios", () => {
    const square = formatBannerDimensions("1:1");
    expect(square.width).toBe(1080);
    expect(square.height).toBe(1080);

    const story = formatBannerDimensions("9:16");
    expect(story.width).toBe(1080);
    expect(story.height).toBe(1920);
  });

  it("should have all 4 high-converting marketing template styles", () => {
    expect(BANNER_TEMPLATES.length).toBe(4);
    const styles = BANNER_TEMPLATES.map((t) => t.id);
    expect(styles).toContain("minimal");
    expect(styles).toContain("flash_sale");
    expect(styles).toContain("cod_trust");
    expect(styles).toContain("festive");
  });
});
