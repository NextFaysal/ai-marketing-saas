import { describe, expect, it } from "vitest";
import { layerSourceViews, sourceCountView, type AudienceSourceEntry } from "./funnel-sources";

const entry = (key: string, contactCount: number | null, available = contactCount !== null && contactCount > 0): AudienceSourceEntry => ({
  key,
  source: key,
  label: `label for ${key}`,
  available,
  ...(available ? {} : { reason: "এই Source-এ Email/Phone-সহ কোনো Contact পাওয়া যায়নি" }),
  contactCount,
});

describe("sourceCountView (DX3 🚩 mini-fix wizard counts)", () => {
  it("renders a real count in bn-BD digits", () => {
    const v = sourceCountView([entry("product_viewers", 1250)], "product_viewers");
    expect(v.state).toBe("ok");
    expect(v.count).toBe(1250);
    expect(v.text).toBe("Product Viewers: ১,২৫০ জন");
  });

  it("renders a real zero as the honest empty state — not as a missing count", () => {
    const v = sourceCountView([entry("buyers", 0, false)], "buyers");
    expect(v.state).toBe("empty");
    expect(v.count).toBe(0);
    expect(v.text).toContain("০ জন");
    expect(v.text).toContain("এখনো কেউ নেই");
  });

  it("renders a null count (source not gatherable) as unknown, never as ০", () => {
    const v = sourceCountView([entry("cart_abandoners", null, false)], "cart_abandoners");
    expect(v.state).toBe("unknown");
    expect(v.count).toBeNull();
    expect(v.text).toContain("সংখ্যা পাওয়া যায়নি");
  });

  it("treats a missing catalog entry the same as unknown", () => {
    const v = sourceCountView([entry("buyers", 5)], "product_viewers");
    expect(v.state).toBe("unknown");
    expect(v.count).toBeNull();
  });

  it("maps each funnel layer to exactly the sources the API builds it from", () => {
    const sources = [entry("product_viewers", 10), entry("cart_abandoners", 0, false), entry("buyers", 3), entry("customers", 99)];
    const re = layerSourceViews(sources, "retargeting");
    expect(re.map((v) => v.key)).toEqual(["product_viewers", "cart_abandoners"]);
    expect(re[1].state).toBe("empty");
    const rn = layerSourceViews(sources, "retention");
    expect(rn.map((v) => v.key)).toEqual(["buyers"]);
    expect(rn[0].text).toBe("আগের Buyers: ৩ জন");
  });
});
