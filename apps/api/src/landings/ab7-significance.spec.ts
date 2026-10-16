import { LandingsService } from "./landings.service";
import { conversionRate, normalCdf, twoProportionZTest } from "./significance";

/**
 * AB7 (AX20) — A/B significance specs.
 *
 * Pure-helper known values first (verified independently:
 * 50/1000 vs 30/1000 → pooled p = 0.04, SE ≈ 0.008764,
 * z ≈ 2.2822, two-sided p ≈ 0.0225), then the stats-level
 * rules (control = most views, insufficient-data, winner).
 */

describe("twoProportionZTest — known values", () => {
  it("50/1000 vs 30/1000 → z ≈ 2.282, p ≈ 0.0225", () => {
    const { z, pValue } = twoProportionZTest(50, 1000, 30, 1000);
    expect(z).toBeCloseTo(2.2822, 3);
    expect(pValue).toBeCloseTo(0.0225, 3);
    expect(pValue).toBeLessThan(0.05);
  });

  it("is symmetric in magnitude: swapping groups flips the sign of z, not p", () => {
    const a = twoProportionZTest(50, 1000, 30, 1000);
    const b = twoProportionZTest(30, 1000, 50, 1000);
    expect(b.z).toBeCloseTo(-a.z, 10);
    expect(b.pValue).toBeCloseTo(a.pValue, 10);
  });

  it("a smaller gap is not significant: 40/1000 vs 30/1000 → p > 0.05", () => {
    const { z, pValue } = twoProportionZTest(40, 1000, 30, 1000);
    expect(z).toBeCloseTo(1.2167, 3);
    expect(pValue).toBeCloseTo(0.2237, 3);
    expect(pValue).toBeGreaterThan(0.05);
  });

  it("equal rates → z 0, p 1", () => {
    const { z, pValue } = twoProportionZTest(25, 500, 50, 1000);
    expect(z).toBe(0);
    expect(pValue).toBe(1);
  });

  it("zero views on either side → z 0, p 1 (nothing to test)", () => {
    expect(twoProportionZTest(0, 0, 5, 100)).toEqual({ z: 0, pValue: 1 });
    expect(twoProportionZTest(5, 100, 0, 0)).toEqual({ z: 0, pValue: 1 });
    expect(twoProportionZTest(0, 0, 0, 0)).toEqual({ z: 0, pValue: 1 });
  });

  it("zero variance (both rates 0, or both 1) → z 0, p 1", () => {
    expect(twoProportionZTest(0, 100, 0, 200)).toEqual({ z: 0, pValue: 1 });
    expect(twoProportionZTest(100, 100, 200, 200)).toEqual({ z: 0, pValue: 1 });
  });

  it("normalCdf sanity: Φ(0) = 0.5, Φ(1.96) ≈ 0.975", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe("conversionRate", () => {
  it("is a 4-decimal fraction; zero views => 0", () => {
    expect(conversionRate(1, 3)).toBe(0.3333);
    expect(conversionRate(50, 1000)).toBe(0.05);
    expect(conversionRate(0, 0)).toBe(0);
    expect(conversionRate(7, 0)).toBe(0);
  });
});

// ---------- stats-level rules ----------

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function makeTable() {
  const rows: any[] = [];
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "asc") f = [...f].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return f;
    },
  };
}

const T0 = new Date("2026-10-01T00:00:00Z");
const T1 = new Date("2026-10-02T00:00:00Z");
const T2 = new Date("2026-10-03T00:00:00Z");

function setupStats(variants: Array<{ id: string; views: number; orders: number; createdAt: Date }>) {
  const prisma: any = {
    landingPage: makeTable(), landingVariant: makeTable(), landingEvent: makeTable(), order: makeTable(),
  };
  prisma.landingPage.rows.push({ id: "land-1", organizationId: "org-1", slug: "offer", status: "published" });
  for (const v of variants) {
    prisma.landingVariant.rows.push({
      id: v.id, landingId: "land-1", name: v.id, isControl: false, weight: 50, createdAt: v.createdAt, updatedAt: v.createdAt,
    });
    for (let i = 0; i < v.views; i++) {
      prisma.landingEvent.rows.push({ id: `e-${v.id}-${i}`, landingId: "land-1", variantId: v.id, kind: "view" });
    }
    for (let i = 0; i < v.orders; i++) {
      prisma.order.rows.push({
        id: `o-${v.id}-${i}`, organizationId: "org-1", totalMinor: 1000n, landingPageId: "land-1", landingVariantId: v.id,
      });
    }
  }
  const svc = new LandingsService(prisma as any);
  return { svc };
}

describe("LandingsService.stats — AB7 significance", () => {
  it("control = most views (not the flag); control vsControl null; a significant higher rival wins", async () => {
    // Control by views: A (1000 views, 30 orders = 3%).
    // B: 1000 views, 50 orders = 5% → z ≈ 2.282, p ≈ 0.0225.
    const { svc } = setupStats([
      { id: "lv-a", views: 1000, orders: 30, createdAt: T0 },
      { id: "lv-b", views: 1000, orders: 50, createdAt: T1 },
    ]);
    const stats = await svc.stats("org-1", "land-1");
    const a: any = stats.variants.find((x: any) => x.variantId === "lv-a");
    const b: any = stats.variants.find((x: any) => x.variantId === "lv-b");
    // Tie on views => earliest created (A) is control.
    expect(a.vsControl).toBeNull();
    expect(a.conversionRate).toBe(0.03);
    expect(b.conversionRate).toBe(0.05);
    expect(b.vsControl.significant).toBe(true);
    expect(b.vsControl.pValue).toBeCloseTo(0.0225, 3);
    expect(b.vsControl.note).toBeUndefined();
    expect(stats.winnerId).toBe("lv-b");
  });

  it("control wins when a rival is significantly LOWER and control holds the top rate", async () => {
    const { svc } = setupStats([
      { id: "lv-a", views: 1000, orders: 50, createdAt: T0 },
      { id: "lv-b", views: 1000, orders: 30, createdAt: T1 },
    ]);
    const stats = await svc.stats("org-1", "land-1");
    const b: any = stats.variants.find((x: any) => x.variantId === "lv-b");
    expect(b.vsControl.significant).toBe(true); // 3% vs 5%, p ≈ 0.0225
    expect(b.vsControl.pValue).toBeCloseTo(0.0225, 3);
    expect(stats.winnerId).toBe("lv-a");
  });

  it("top-rate variant that is NOT distinguishable => winnerId null", async () => {
    // B has the higher rate but the gap is not significant.
    const { svc } = setupStats([
      { id: "lv-a", views: 1000, orders: 30, createdAt: T0 },
      { id: "lv-b", views: 1000, orders: 40, createdAt: T1 },
    ]);
    const stats = await svc.stats("org-1", "land-1");
    const b: any = stats.variants.find((x: any) => x.variantId === "lv-b");
    expect(b.vsControl.significant).toBe(false);
    expect(b.vsControl.pValue).toBeCloseTo(0.2237, 3);
    expect(stats.winnerId).toBeNull();
  });

  it("insufficient data: either side < 30 views => pValue null + note, never significant, no winner", async () => {
    const { svc } = setupStats([
      { id: "lv-a", views: 1000, orders: 30, createdAt: T0 },
      { id: "lv-b", views: 29, orders: 29, createdAt: T1 }, // 100% rate, too few views
    ]);
    const stats = await svc.stats("org-1", "land-1");
    const b: any = stats.variants.find((x: any) => x.variantId === "lv-b");
    expect(b.conversionRate).toBe(1);
    expect(b.vsControl).toEqual({ pValue: null, significant: false, note: "insufficient_data" });
    expect(stats.winnerId).toBeNull();
  });

  it("insufficient data also applies when the CONTROL side has < 30 views", async () => {
    const { svc } = setupStats([
      { id: "lv-a", views: 20, orders: 1, createdAt: T0 },
      { id: "lv-b", views: 25, orders: 5, createdAt: T1 },
    ]);
    const stats = await svc.stats("org-1", "land-1");
    // B has the most views (25) => B is control; A is untestable.
    const a: any = stats.variants.find((x: any) => x.variantId === "lv-a");
    const b: any = stats.variants.find((x: any) => x.variantId === "lv-b");
    expect(b.vsControl).toBeNull();
    expect(a.vsControl).toEqual({ pValue: null, significant: false, note: "insufficient_data" });
    expect(stats.winnerId).toBeNull();
  });

  it("a single variant is its own control: vsControl null, winnerId null", async () => {
    const { svc } = setupStats([{ id: "lv-a", views: 500, orders: 25, createdAt: T0 }]);
    const stats = await svc.stats("org-1", "land-1");
    expect(stats.variants[0].vsControl).toBeNull();
    expect(stats.variants[0].conversionRate).toBe(0.05);
    expect(stats.winnerId).toBeNull();
  });

  it("with three variants the highest-rate significant rival is the winner", async () => {
    const { svc } = setupStats([
      { id: "lv-a", views: 1000, orders: 30, createdAt: T0 },
      { id: "lv-b", views: 1000, orders: 50, createdAt: T1 },
      { id: "lv-c", views: 1000, orders: 70, createdAt: T2 },
    ]);
    const stats = await svc.stats("org-1", "land-1");
    expect(stats.winnerId).toBe("lv-c");
  });
});
