import { describe, it, expect } from "vitest";
import {
  FUNNEL_PRESETS,
  slugifyFunnelTitle,
  calculateSavingsPercent,
  buildFunnelSections,
  createInitialFunnelDraft,
} from "./funnel-builder";

describe("Funnel Builder presets & helpers", () => {
  it("provides all 4 core high-converting presets with BD e-commerce fields", () => {
    const keys = Object.keys(FUNNEL_PRESETS);
    expect(keys).toContain("flash_sale");
    expect(keys).toContain("cod_guarantee");
    expect(keys).toContain("premium_story");
    expect(keys).toContain("festival_bundle");

    for (const key of keys) {
      const p = FUNNEL_PRESETS[key as keyof typeof FUNNEL_PRESETS];
      expect(p.name).toBeTruthy();
      expect(p.primaryCtaText).toContain("অর্ডার");
      expect(p.benefits.length).toBeGreaterThanOrEqual(2);
      expect(p.trust.codText).toContain("ক্যাশ অন ডেলিভারি");
    }
  });

  it("slugifies titles cleanly into URL-safe strings", () => {
    const slug1 = slugifyFunnelTitle("Organic Black Honey 500g");
    expect(slug1).toMatch(/^organic-black-honey-500g-[a-z0-9]{4}$/);

    const slug2 = slugifyFunnelTitle("প্রিমিয়াম পাঞ্জাবি");
    // Non-ascii falls back to deal-xxxx
    expect(slug2).toMatch(/^deal-[a-z0-9]{4}$/);
  });

  it("calculates discount savings percentage accurately", () => {
    expect(calculateSavingsPercent(120000, 160000)).toBe(25); // 1200 vs 1600 -> 25% off
    expect(calculateSavingsPercent(150000, 150000)).toBe(0);
    expect(calculateSavingsPercent(180000, 150000)).toBe(0);
    expect(calculateSavingsPercent(100000, undefined)).toBe(0);
  });

  it("creates initial funnel draft with matching preset and valid defaults", () => {
    const draft = createInitialFunnelDraft(
      {
        id: "prod-123",
        name: "Wireless Earbuds Pro",
        priceMinor: 145000,
        compareAtMinor: 220000,
        imageUrl: "https://example.com/earbuds.png",
      },
      "flash_sale"
    );

    expect(draft.productId).toBe("prod-123");
    expect(draft.productName).toBe("Wireless Earbuds Pro");
    expect(draft.priceMinor).toBe(145000);
    expect(draft.compareAtMinor).toBe(220000);
    expect(draft.headline).toContain("Wireless Earbuds Pro");
    expect(draft.benefits.length).toBe(4);
    expect(draft.trust.codText).toBeTruthy();
    expect(draft.urgencyStock).toBe(7);
  });

  it("builds sections that strictly adhere to landing section validators", () => {
    const draft = createInitialFunnelDraft(
      {
        id: "prod-abc",
        name: "Smart Watch",
        priceMinor: 250000,
      },
      "cod_guarantee"
    );

    const sections = buildFunnelSections(draft);
    expect(sections.length).toBe(6);

    const types = sections.map((s) => s.type);
    expect(types).toEqual(["hero", "offer", "benefits", "trust", "reviews", "faq"]);

    // Check benefits items count is bounded <= 8
    const benefitsSec = sections.find((s) => s.type === "benefits");
    expect((benefitsSec?.data as any).items.length).toBeLessThanOrEqual(8);

    // Check faq items count is bounded <= 10
    const faqSec = sections.find((s) => s.type === "faq");
    expect((faqSec?.data as any).items.length).toBeLessThanOrEqual(10);

    // Check trust section contains strings
    const trustSec = sections.find((s) => s.type === "trust");
    expect((trustSec?.data as any).codText).toBeTruthy();
    expect((trustSec?.data as any).deliveryText).toBeTruthy();
    expect((trustSec?.data as any).returnText).toBeTruthy();
  });
});
