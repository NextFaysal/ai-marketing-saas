import { StorefrontService } from "./storefront.service";
import { isSoldOrder, rankBoughtTogether } from "./ec27-discovery";

/* Compact fake prisma (EC spec style). */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cond: any = v;
      if ("in" in cond) { if (!cond.in.includes(row[k])) return false; continue; }
      if ("gte" in cond) { if (new Date(row[k]).getTime() < new Date(cond.gte).getTime()) return false; continue; }
      if ("contains" in cond) {
        const hay = String(row[k] ?? "");
        const hit = cond.mode === "insensitive" ? hay.toLowerCase().includes(String(cond.contains).toLowerCase()) : hay.includes(String(cond.contains));
        if (!hit) return false;
        continue;
      }
      if (!matchWhere(row, cond)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}

function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where))[0] ?? null,
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let found = rows.filter((r) => matchWhere(r, where));
      if (orderBy?.createdAt) {
        found = [...found].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        if (orderBy.createdAt === "desc") found.reverse();
      }
      if (take !== undefined) found = found.slice(0, take);
      return found;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
  };
}

function makePrisma() {
  return {
    organization: makeTable(),
    storefrontSetting: makeTable(),
    businessProfile: makeTable(),
    category: makeTable(),
    product: makeTable(),
    productVariant: makeTable(),
    productImage: makeTable(),
    order: makeTable(),
    orderItem: makeTable(),
    courierShipment: makeTable(),
    customer: makeTable(),
    returnRequest: makeTable(),
  } as any;
}

const T0 = new Date("2026-10-01T00:00:00Z");
const RECENT = new Date(Date.now() - 10 * 24 * 3600 * 1000);

function seed(prisma: any) {
  prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One", brandName: null, logoUrl: null, primaryColor: null, customDomain: null });
  prisma.storefrontSetting.rows.push({ id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: "ShopOne", locale: "bn" });
  prisma.category.rows.push(
    { id: "cat-1", organizationId: "org-1", name: "চামড়ার পণ্য", slug: "leather" },
    { id: "cat-2", organizationId: "org-1", name: "ব্যাগ", slug: "bags" },
  );
  const base = { organizationId: "org-1", description: null, category: null, categoryId: null, sku: null, status: "ACTIVE", compareAtMinor: null, currency: "BDT", stockQuantity: 5, lowStockThreshold: null, imageUrl: null, preorderEnabled: false, createdAt: T0, updatedAt: T0 };
  prisma.product.rows.push(
    { ...base, id: "p-wallet", name: "Leather Wallet লেদার", slug: "wallet", sku: "WAL-1", priceMinor: 50000n, categoryId: "cat-1" },
    { ...base, id: "p-bag", name: "ক্যানভাস ব্যাগ Canvas Bag", slug: "bag", sku: "BAG-1", priceMinor: 90000n, categoryId: "cat-2" },
    { ...base, id: "p-belt", name: "চামড়ার বেল্ট", slug: "belt", sku: "BELT-9", priceMinor: 30000n, category: "চামড়ার পণ্য" },
    { ...base, id: "p-inactive", name: "Leather Wallet পুরনো", slug: "old-wallet", sku: "WAL-OLD", priceMinor: 10000n, status: "ARCHIVED" },
  );
}

function makeSvc() {
  const prisma = makePrisma();
  seed(prisma);
  return { prisma, svc: new StorefrontService(prisma) };
}

describe("EC27 shop search", () => {
  it("matches a Bengali name hit", async () => {
    const { svc } = makeSvc();
    const home: any = await svc.shopHome("shop-one", { q: "ক্যানভাস" });
    expect(home.products.map((p: any) => p.id)).toEqual(["p-bag"]);
    expect(home.pagination.total).toBe(1);
  });

  it("matches an English name hit (case-insensitive)", async () => {
    const { svc } = makeSvc();
    const home: any = await svc.shopHome("shop-one", { q: "canvas bag" });
    expect(home.products.map((p: any) => p.id)).toEqual(["p-bag"]);
  });

  it("matches by SKU and excludes inactive products", async () => {
    const { svc } = makeSvc();
    const home: any = await svc.shopHome("shop-one", { q: "WAL" });
    const ids = home.products.map((p: any) => p.id);
    expect(ids).toContain("p-wallet");
    expect(ids).not.toContain("p-inactive");
  });

  it("matches the structured Category row NAME (product linked only by categoryId)", async () => {
    const { svc } = makeSvc();
    const home: any = await svc.shopHome("shop-one", { q: "চামড়ার পণ্য" });
    const ids = home.products.map((p: any) => p.id).sort();
    // p-wallet via Category row name; p-belt via its legacy category string.
    expect(ids).toEqual(["p-belt", "p-wallet"]);
  });

  it("category filter narrows the search results", async () => {
    const { svc } = makeSvc();
    const home: any = await svc.shopHome("shop-one", { q: "লেদার", category: "bags" });
    // "লেদার" hits the wallet name only; the bags category filter excludes it.
    expect(home.products).toEqual([]);
    expect(home.pagination.total).toBe(0);
    const narrowed: any = await svc.shopHome("shop-one", { category: "cat-1" });
    // cat-1 by id for p-wallet; p-belt joins via its legacy category
    // string, which equals the Category row's name (the existing
    // matchesCategory legacy rule).
    expect(narrowed.products.map((p: any) => p.id).sort()).toEqual(["p-belt", "p-wallet"]);
  });

  it("no-match returns an honest empty page", async () => {
    const { svc } = makeSvc();
    const home: any = await svc.shopHome("shop-one", { q: "xyzzy-nothing" });
    expect(home.products).toEqual([]);
    expect(home.pagination).toMatchObject({ total: 0, totalPages: 1 });
  });
});

describe("EC27 isSoldOrder (EC33 definition)", () => {
  it("dead states never sold; completed/delivered sold; processing needs a delivered shipment", () => {
    expect(isSoldOrder({ status: "cancelled" }, ["delivered"])).toBe(false);
    expect(isSoldOrder({ status: "refunded" }, [])).toBe(false);
    expect(isSoldOrder({ status: "completed" }, [])).toBe(true);
    expect(isSoldOrder({ status: "delivered" }, [])).toBe(true);
    expect(isSoldOrder({ status: "processing" }, [])).toBe(false);
    expect(isSoldOrder({ status: "processing" }, ["in_transit"])).toBe(false);
    expect(isSoldOrder({ status: "processing" }, ["partial_delivered"])).toBe(true);
  });
});

describe("EC27 rankBoughtTogether (pure)", () => {
  const active = new Set(["p-a", "p-b", "p-c", "p-d", "p-gift"]);
  const lines = [
    // order 1: target + a + b + a gift line of p-c
    { orderId: "o1", productId: "t", isGift: false },
    { orderId: "o1", productId: "p-a", isGift: false },
    { orderId: "o1", productId: "p-b", isGift: false },
    { orderId: "o1", productId: "p-c", isGift: true },
    // order 2: target + a + c + b
    { orderId: "o2", productId: "t", isGift: false },
    { orderId: "o2", productId: "p-a", isGift: false },
    { orderId: "o2", productId: "p-c", isGift: false },
    { orderId: "o2", productId: "p-b", isGift: false },
    // order 3: target + a (twice on separate lines — counts once) + c
    { orderId: "o3", productId: "t", isGift: false },
    { orderId: "o3", productId: "p-a", isGift: false },
    { orderId: "o3", productId: "p-a", isGift: false },
    { orderId: "o3", productId: "p-c", isGift: false },
    // order 4: target + d (only one co-occurrence — below threshold)
    { orderId: "o4", productId: "t", isGift: false },
    { orderId: "o4", productId: "p-d", isGift: false },
    // order 5: no target — irrelevant
    { orderId: "o5", productId: "p-b", isGift: false },
  ];

  it("produces the exact expected ranking with per-order dedupe", () => {
    expect(rankBoughtTogether(lines, "t", active)).toEqual([
      { productId: "p-a", count: 3 },
      { productId: "p-b", count: 2 },
      { productId: "p-c", count: 2 },
    ]);
  });

  it("gift exclusion: a product seen ONLY as a gift line never appears", () => {
    const giftOnly = [
      { orderId: "o1", productId: "t", isGift: false },
      { orderId: "o1", productId: "p-gift", isGift: true },
      { orderId: "o2", productId: "t", isGift: false },
      { orderId: "o2", productId: "p-gift", isGift: true },
    ];
    expect(rankBoughtTogether(giftOnly, "t", active)).toEqual([]);
  });

  it("threshold omission: a single co-occurrence yields an empty section", () => {
    const once = [
      { orderId: "o1", productId: "t", isGift: false },
      { orderId: "o1", productId: "p-a", isGift: false },
    ];
    expect(rankBoughtTogether(once, "t", active)).toEqual([]);
  });

  it("inactive co-products are excluded", () => {
    const ranked = rankBoughtTogether(lines, "t", new Set(["p-b", "p-c"]));
    expect(ranked.map((r) => r.productId)).toEqual(["p-b", "p-c"]);
  });
});

describe("EC27 productDetail boughtTogether (service, fixture orders)", () => {
  it("returns the ranked ACTIVE co-products in public card shape", async () => {
    const { prisma, svc } = makeSvc();
    const mkOrder = (id: string, status: string, daysAgo = 5) => ({
      id, organizationId: "org-1", status, isPractice: false,
      placedAt: new Date(Date.now() - daysAgo * 24 * 3600 * 1000), createdAt: T0,
    });
    prisma.order.rows.push(
      mkOrder("o1", "completed"), mkOrder("o2", "completed"), mkOrder("o3", "completed"),
      mkOrder("o4", "cancelled"), mkOrder("o5", "processing"), mkOrder("o6", "completed", 200),
    );
    const line = (orderId: string, productId: string, isGift = false) => ({
      id: `${orderId}-${productId}-${isGift ? "g" : "n"}`, orderId, productId, name: productId, sku: null,
      quantity: 1, priceMinor: 100n, totalMinor: 100n, isGift, isPreorder: false, bundleId: null,
    });
    prisma.orderItem.rows.push(
      line("o1", "p-wallet"), line("o1", "p-bag"), line("o1", "p-belt"),
      line("o2", "p-wallet"), line("o2", "p-bag"),
      line("o3", "p-wallet"), line("o3", "p-bag"), line("o3", "p-belt", true), // belt only as gift here
      line("o4", "p-wallet"), line("o4", "p-belt"), // cancelled — never counts
      line("o5", "p-wallet"), line("o5", "p-belt"), // not delivered-proven — never counts
      line("o6", "p-wallet"), line("o6", "p-belt"), // outside 180 days — never counts
    );
    const detail: any = await svc.productDetail("shop-one", "wallet");
    // bag: 3 sold co-occurrences. belt: only o1 counts (o3 gift,
    // o4/o5/o6 excluded) = 1 < 2 ⇒ omitted entirely.
    expect(detail.boughtTogether.map((p: any) => p.id)).toEqual(["p-bag"]);
    expect(detail.boughtTogether[0]).toMatchObject({ slug: "bag", priceMinor: "90000" });
  });
});
