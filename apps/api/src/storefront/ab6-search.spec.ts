import { StorefrontService } from "./storefront.service";
import { buildTsQuerySql, expandSynonymQueries, normalizeSearchTerm } from "./search-fts";
import {
  refreshOrgSearchVectors,
  refreshProductSearchVector,
  searchVectorExpression,
} from "../products/search-vector";
import { rankBoughtTogetherForSeeds } from "./ec27-discovery";

/* Fake prisma harness (ec27-discovery.spec.ts style, extended
 * with update/delete for the synonym CRUD). */
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
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("Record to update not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx < 0) throw new Error("Record to delete not found");
      return rows.splice(idx, 1)[0];
    },
  };
}

function makePrisma() {
  return {
    organization: makeTable(),
    storefrontSetting: makeTable(),
    businessProfile: makeTable(),
    category: makeTable(),
    brand: makeTable(),
    product: makeTable(),
    productVariant: makeTable(),
    productImage: makeTable(),
    order: makeTable(),
    orderItem: makeTable(),
    courierShipment: makeTable(),
    shopPage: makeTable(),
    blogPost: makeTable(),
    searchSynonym: makeTable(),
    searchQueryLog: makeTable(),
  } as any;
}

const T_OLD = new Date("2026-09-01T00:00:00Z");
const T_NEW = new Date("2026-10-01T00:00:00Z");

function seedShop(prisma: any) {
  prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One", brandName: null, logoUrl: null, primaryColor: null, customDomain: null });
  prisma.storefrontSetting.rows.push({ id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: "ShopOne", locale: "bn" });
  prisma.category.rows.push({ id: "cat-saree", organizationId: "org-1", name: "শাড়ি", slug: "saree" });
  const base = {
    organizationId: "org-1", description: null, descriptionEn: null, nameEn: null,
    category: null, categoryId: null, brandId: null, sku: null, status: "ACTIVE",
    compareAtMinor: null, currency: "BDT", stockQuantity: 5, lowStockThreshold: null,
    imageUrl: null, preorderEnabled: false, updatedAt: T_OLD,
  };
  prisma.product.rows.push(
    { ...base, id: "p-saree", name: "লাল শাড়ি", nameEn: "Red Saree", slug: "saree", sku: "SAR-1", priceMinor: 150000n, description: "সুতি শাড়ি", categoryId: "cat-saree", createdAt: T_OLD },
    // Matches "শাড়ি" only through its description — never a name hit.
    { ...base, id: "p-jama", name: "ছেলেদের জামা", nameEn: "Boys Shirt", slug: "jama", sku: "JAM-1", priceMinor: 80000n, description: "শাড়ি প্রিন্টের জামা", createdAt: T_NEW },
    { ...base, id: "p-panjabi", name: "পাঞ্জাবি", slug: "panjabi", sku: "PAN-1", priceMinor: 120000n, description: "ঈদের পাঞ্জাবি", createdAt: T_NEW },
    { ...base, id: "p-arch", name: "পুরনো শাড়ি", slug: "old-saree", sku: "OLD-1", priceMinor: 10000n, status: "ARCHIVED", createdAt: T_OLD },
  );
}

/**
 * Mini FTS matcher standing in for PostgreSQL: reads the phrase
 * values out of the Prisma.Sql the service built, token-matches
 * them against a per-product search text assembled from
 * name/nameEn/description/sku/category(+row name), and ranks
 * name hits first (then newest), like ts_rank would favour the
 * weight-A name text.
 */
function installFts(prisma: any) {
  const catName = (p: any) => {
    const row = prisma.category.rows.find((c: any) => c.id === p.categoryId);
    return row?.name ?? "";
  };
  prisma.$queryRaw = async (q: any) => {
    const values: any[] = q?.values ?? [];
    const phrases = [...new Set(values.filter((v) => typeof v === "string" && v !== "org-1"))] as string[];
    const toks = (s: unknown) => new Set(String(s ?? "").toLowerCase().split(/\s+/).filter(Boolean));
    const scored: Array<{ id: string; nameHit: boolean; createdAt: Date }> = [];
    for (const p of prisma.product.rows.filter((x: any) => x.status === "ACTIVE")) {
      const nameToks = toks(`${p.name ?? ""} ${p.nameEn ?? ""}`);
      const fullToks = toks([p.name, p.nameEn, p.description, p.descriptionEn, p.sku, p.category, catName(p)].join(" "));
      let matched = false;
      let nameHit = false;
      for (const phrase of phrases) {
        const pt = String(phrase).toLowerCase().split(/\s+/).filter(Boolean);
        if (pt.length && pt.every((t) => fullToks.has(t))) {
          matched = true;
          if (pt.every((t) => nameToks.has(t))) nameHit = true;
        }
      }
      if (matched) scored.push({ id: p.id, nameHit, createdAt: p.createdAt });
    }
    scored.sort((a, b) => Number(b.nameHit) - Number(a.nameHit) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return scored.map((s) => ({ id: s.id }));
  };
}

function makeSvc() {
  const prisma = makePrisma();
  seedShop(prisma);
  return { prisma, svc: new StorefrontService(prisma) };
}

// ---------- 1. search-fts pure ----------

describe("AB6 search-fts pure helpers", () => {
  it("normalizeSearchTerm trims, lowercases and collapses whitespace", () => {
    expect(normalizeSearchTerm("  Hello \t  World \n")).toBe("hello world");
    expect(normalizeSearchTerm("শাড়ি")).toBe("শাড়ি");
    expect(normalizeSearchTerm("")).toBe("");
    expect(normalizeSearchTerm(null)).toBe("");
  });

  it("whole-query synonym match appends the expansions", () => {
    expect(
      expandSynonymQueries("Saree", [{ term: "saree", expansions: ["শাড়ি", "Silk  Saree"] }]),
    ).toEqual(["saree", "শাড়ি", "silk saree"]);
  });

  it("token synonym match appends the expansions", () => {
    expect(
      expandSynonymQueries("red saree dress", [{ term: "saree", expansions: ["শাড়ি"] }]),
    ).toEqual(["red saree dress", "শাড়ি"]);
  });

  it("no synonym match returns only the normalized query", () => {
    expect(expandSynonymQueries("hello", [{ term: "saree", expansions: ["শাড়ি"] }])).toEqual(["hello"]);
    expect(expandSynonymQueries("   ", [{ term: "saree", expansions: ["শাড়ি"] }])).toEqual([]);
  });

  it("dedupes expansions (incl. the query itself) and caps at 11 phrases", () => {
    expect(
      expandSynonymQueries("saree", [{ term: "saree", expansions: ["saree", "শাড়ি", "শাড়ি"] }]),
    ).toEqual(["saree", "শাড়ি"]);
    const many = expandSynonymQueries("x", [
      { term: "x", expansions: Array.from({ length: 25 }, (_, i) => `exp-${i}`) },
    ]);
    expect(many).toHaveLength(11);
    expect(many[0]).toBe("x");
  });

  it("buildTsQuerySql binds phrases as parameters (never interpolates user text)", () => {
    const single: any = buildTsQuerySql(["alpha"]);
    expect(single.sql).toContain("plainto_tsquery('simple', ?)");
    expect(single.values).toEqual(["alpha"]);

    const multi: any = buildTsQuerySql(["alpha", "beta gamma"]);
    expect(multi.sql).toContain("plainto_tsquery('simple', ?)::text");
    expect(multi.sql).toContain("' | '");
    expect(multi.sql).toContain("::tsquery");
    expect(multi.sql).not.toContain("alpha");
    expect(multi.sql).not.toContain("beta");
    expect(multi.values).toEqual(["alpha", "beta gamma"]);
  });
});

// ---------- 2. search-vector ----------

describe("AB6 search-vector expression + refresh", () => {
  it("the expression mirrors the migration: fields, subqueries and weights", () => {
    const sql = (searchVectorExpression() as any).sql as string;
    expect(sql).toContain("to_tsvector('simple'");
    expect(sql).toContain('"name"');
    expect(sql).toContain('"nameEn"');
    expect(sql).toContain('"description"');
    expect(sql).toContain('"descriptionEn"');
    expect(sql).toContain('"sku"');
    expect(sql).toContain("string_agg");
    expect(sql).toContain('"ProductVariant"');
    expect(sql).toContain('"Category"');
    expect(sql).toContain('"Brand"');
    expect(sql).toContain("'A'");
    expect(sql).toContain("'B'");
    expect(sql).toContain("'C'");
  });

  it("refreshProductSearchVector issues an UPDATE with the product id bound", async () => {
    const captured: any[] = [];
    const fake = {
      $executeRaw: async (...args: any[]) => { captured.push(args); return 1; },
    };
    await refreshProductSearchVector(fake, "p-42");
    expect(captured).toHaveLength(1);
    const q = captured[0][0];
    expect(q.sql).toContain('UPDATE "Product" p SET "searchVector" =');
    expect(q.sql).toContain('WHERE p."id" = ?');
    expect(q.values).toContain("p-42");
  });

  it("refreshOrgSearchVectors scopes by organizationId and returns the count", async () => {
    const captured: any[] = [];
    const fake = {
      $executeRaw: async (...args: any[]) => { captured.push(args); return 4; },
    };
    await expect(refreshOrgSearchVectors(fake, "org-9")).resolves.toBe(4);
    expect(captured[0][0].sql).toContain('WHERE p."organizationId" = ?');
    expect(captured[0][0].values).toContain("org-9");
  });
});

// ---------- 3. shopHome FTS path ----------

describe("AB6 shopHome FTS search", () => {
  it("returns FTS hits in rank order (name hit first) and logs viaFallback=false", async () => {
    const { prisma, svc } = makeSvc();
    installFts(prisma);
    const home: any = await svc.shopHome("shop-one", { q: "শাড়ি" });
    expect(home.products.map((p: any) => p.id)).toEqual(["p-saree", "p-jama"]);
    const logs = prisma.searchQueryLog.rows;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ term: "শাড়ি", resultsCount: 2, viaFallback: false });
  });

  it("synonym expansion reaches the FTS query (saree → শাড়ি-only product)", async () => {
    const { prisma, svc } = makeSvc();
    installFts(prisma);
    prisma.searchSynonym.rows.push({ id: "syn-1", organizationId: "org-1", term: "saree", expansions: ["শাড়ি"], createdAt: new Date(), updatedAt: new Date() });
    const home: any = await svc.shopHome("shop-one", { q: "saree" });
    const ids = home.products.map((p: any) => p.id);
    // p-jama can only match through the expanded শাড়ি phrase.
    expect(ids).toContain("p-jama");
    expect(ids).toContain("p-saree");
    expect(prisma.searchQueryLog.rows[0]).toMatchObject({ term: "saree", viaFallback: false });
  });

  it("FTS zero results fall back to the substring scan and log viaFallback=true", async () => {
    const { prisma, svc } = makeSvc();
    prisma.$queryRaw = async () => [];
    const home: any = await svc.shopHome("shop-one", { q: "জামা" });
    expect(home.products.map((p: any) => p.id)).toEqual(["p-jama"]);
    expect(prisma.searchQueryLog.rows).toHaveLength(1);
    expect(prisma.searchQueryLog.rows[0]).toMatchObject({ term: "জামা", resultsCount: 1, viaFallback: true });
  });

  it("FTS unavailable (no $queryRaw) also falls back and logs", async () => {
    const { prisma, svc } = makeSvc();
    const home: any = await svc.shopHome("shop-one", { q: "পাঞ্জাবি" });
    expect(home.products.map((p: any) => p.id)).toEqual(["p-panjabi"]);
    expect(prisma.searchQueryLog.rows[0]).toMatchObject({ viaFallback: true, resultsCount: 1 });
  });

  it("a throwing search-log create never breaks the search", async () => {
    const { prisma, svc } = makeSvc();
    installFts(prisma);
    prisma.searchQueryLog.create = async () => { throw new Error("log table down"); };
    const home: any = await svc.shopHome("shop-one", { q: "শাড়ি" });
    expect(home.products.map((p: any) => p.id)).toEqual(["p-saree", "p-jama"]);
  });

  it("ids mode returns the requested order and excludes archived products", async () => {
    const { svc } = makeSvc();
    const home: any = await svc.shopHome("shop-one", { ids: "p-panjabi, p-saree, p-arch, p-saree" });
    expect(home.products.map((p: any) => p.id)).toEqual(["p-panjabi", "p-saree"]);
  });

  it("pages.blog is true only with a published blog post", async () => {
    const { prisma, svc } = makeSvc();
    const draftOnly: any = await svc.shopHome("shop-one", {});
    expect(draftOnly.pages.blog).toBe(false);
    prisma.blogPost.rows.push({ id: "bp-1", organizationId: "org-1", slug: "hello", title: "হ্যালো", status: "draft", createdAt: new Date(), updatedAt: new Date() });
    const withDraft: any = await svc.shopHome("shop-one", {});
    expect(withDraft.pages.blog).toBe(false);
    prisma.blogPost.rows.push({ id: "bp-2", organizationId: "org-1", slug: "live", title: "লাইভ", status: "published", createdAt: new Date(), updatedAt: new Date() });
    const withPublished: any = await svc.shopHome("shop-one", {});
    expect(withPublished.pages.blog).toBe(true);
  });
});

// ---------- 4. synonym CRUD + analytics + reindex ----------

describe("AB6 synonym CRUD / analytics / reindex (service)", () => {
  it("createSynonym normalizes term + expansions and dedupes", async () => {
    const { svc } = makeSvc();
    const { synonym }: any = await svc.createSynonym("org-1", "actor-1", {
      term: "  Saree ",
      expansions: [" শাড়ি ", "শাড়ি", "Silk  Saree", ""],
    });
    expect(synonym.term).toBe("saree");
    expect(synonym.expansions).toEqual(["শাড়ি", "silk saree"]);
  });

  it("createSynonym refuses a term clash with the pinned Bengali 400", async () => {
    const { svc } = makeSvc();
    await svc.createSynonym("org-1", "actor-1", { term: "saree", expansions: ["শাড়ি"] });
    await expect(
      svc.createSynonym("org-1", "actor-1", { term: " SAREE", expansions: ["অন্য"] }),
    ).rejects.toThrow("এই শব্দের জন্য ইতিমধ্যে সমার্থক শব্দ আছে");
  });

  it("createSynonym refuses an empty term and >10 expansions", async () => {
    const { svc } = makeSvc();
    await expect(svc.createSynonym("org-1", "actor-1", { term: "   " })).rejects.toThrow();
    await expect(
      svc.createSynonym("org-1", "actor-1", {
        term: "x",
        expansions: Array.from({ length: 11 }, (_, i) => `e${i}`),
      }),
    ).rejects.toThrow();
  });

  it("updateSynonym replaces expansions, 404s cross-org/missing, clashes on rename", async () => {
    const { svc } = makeSvc();
    const a: any = await svc.createSynonym("org-1", "actor-1", { term: "saree", expansions: ["শাড়ি"] });
    await svc.createSynonym("org-1", "actor-1", { term: "jama", expansions: ["জামা"] });
    const updated: any = await svc.updateSynonym("org-1", "actor-1", a.synonym.id, { expansions: ["কাপড়"] });
    expect(updated.synonym.expansions).toEqual(["কাপড়"]);
    await expect(
      svc.updateSynonym("org-1", "actor-1", a.synonym.id, { term: "jama" }),
    ).rejects.toThrow("এই শব্দের জন্য ইতিমধ্যে সমার্থক শব্দ আছে");
    await expect(
      svc.updateSynonym("org-1", "actor-1", "missing-id", { expansions: [] }),
    ).rejects.toThrow("সমার্থক শব্দটি পাওয়া যায়নি");
    await expect(
      svc.deleteSynonym("org-2", "actor-1", a.synonym.id),
    ).rejects.toThrow("সমার্থক শব্দটি পাওয়া যায়নি");
    await expect(svc.deleteSynonym("org-1", "actor-1", a.synonym.id)).resolves.toEqual({ deleted: true });
  });

  it("listSynonyms returns rows sorted by term", async () => {
    const { svc } = makeSvc();
    await svc.createSynonym("org-1", "actor-1", { term: "saree", expansions: [] });
    await svc.createSynonym("org-1", "actor-1", { term: "jama", expansions: [] });
    const { synonyms }: any = await svc.listSynonyms("org-1");
    expect(synonyms.map((s: any) => s.term)).toEqual(["jama", "saree"]);
  });

  it("searchAnalytics aggregates top terms and zero-result terms", async () => {
    const { prisma, svc } = makeSvc();
    const now = new Date();
    const log = (term: string, resultsCount: number) =>
      prisma.searchQueryLog.rows.push({ id: `log-${term}-${Math.random()}`, organizationId: "org-1", term, resultsCount, viaFallback: false, createdAt: now });
    log("shari", 0); log("shari", 0); log("shari", 0);
    log("শাড়ি", 4); log("শাড়ি", 2);
    log("panjabi", 0);
    const out: any = await svc.searchAnalytics("org-1");
    expect(out.windowDays).toBe(30);
    expect(out.totalSearches).toBe(6);
    expect(out.topTerms).toEqual([
      { term: "shari", count: 3 },
      { term: "শাড়ি", count: 2 },
      { term: "panjabi", count: 1 },
    ]);
    expect(out.zeroResultTerms).toEqual([
      { term: "shari", count: 3 },
      { term: "panjabi", count: 1 },
    ]);
  });

  it("reindexSearch returns the affected count from $executeRaw", async () => {
    const { prisma, svc } = makeSvc();
    prisma.$executeRaw = async () => 7;
    await expect(svc.reindexSearch("org-1", "actor-1")).resolves.toEqual({ updated: 7 });
  });
});

// ---------- 5. rankBoughtTogetherForSeeds pure ----------

describe("AB6 rankBoughtTogetherForSeeds (pure)", () => {
  const active = new Set(["s1", "s2", "p-a", "p-b", "p-c", "p-d", "p-e", "p-gift"]);
  const L = (orderId: string, productId: string, isGift = false) => ({ orderId, productId, isGift });
  const lines = [
    L("o1", "s1"), L("o1", "p-a"), L("o1", "p-b"), L("o1", "p-e"), L("o1", "p-gift", true),
    L("o2", "s2"), L("o2", "p-a"), L("o2", "p-b"), L("o2", "p-gift", true),
    L("o3", "s1"), L("o3", "p-a"), L("o3", "p-a"), L("o3", "p-c"),
    L("o4", "s2"), L("o4", "p-c"), L("o4", "p-d"),
    L("o5", "s1"), L("o5", "p-d"),
    L("o6", "p-a"), // no seed in this order — never counts
  ];

  it("unions orders across seeds, dedupes per order, excludes seeds + gifts, thresholds at 2", () => {
    expect(rankBoughtTogetherForSeeds(lines, ["s1", "s2"], active)).toEqual([
      { productId: "p-a", count: 3 },
      { productId: "p-b", count: 2 },
      { productId: "p-c", count: 2 },
      { productId: "p-d", count: 2 },
    ]);
  });

  it("honours the limit and empty seeds", () => {
    expect(rankBoughtTogetherForSeeds(lines, ["s1", "s2"], active, 2)).toEqual([
      { productId: "p-a", count: 3 },
      { productId: "p-b", count: 2 },
    ]);
    expect(rankBoughtTogetherForSeeds(lines, [], active)).toEqual([]);
  });
});

// ---------- 6. cartRecommendations (service) ----------

describe("AB6 cartRecommendations (service)", () => {
  function seedRecs(prisma: any) {
    const base = {
      organizationId: "org-1", description: null, descriptionEn: null, nameEn: null,
      category: null, categoryId: null, brandId: null, sku: null, status: "ACTIVE",
      compareAtMinor: null, currency: "BDT", lowStockThreshold: null, imageUrl: null,
      preorderEnabled: false, createdAt: T_OLD, updatedAt: T_OLD,
    };
    prisma.product.rows.push(
      { ...base, id: "seed-a", name: "Seed A", slug: "seed-a", priceMinor: 10000n, stockQuantity: 10 },
      { ...base, id: "seed-b", name: "Seed B", slug: "seed-b", priceMinor: 10000n, stockQuantity: 10 },
      { ...base, id: "rec-1", name: "Rec One", slug: "rec-1", priceMinor: 20000n, stockQuantity: 10 },
      { ...base, id: "rec-2", name: "Rec Two", slug: "rec-2", priceMinor: 20000n, stockQuantity: 0 },
      { ...base, id: "rec-3", name: "Rec Three", slug: "rec-3", priceMinor: 20000n, stockQuantity: null },
      { ...base, id: "seed-arch", name: "Old Seed", slug: "seed-arch", priceMinor: 10000n, stockQuantity: 10, status: "ARCHIVED" },
    );
    const recent = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    const mkOrder = (id: string) => ({ id, organizationId: "org-1", status: "completed", isPractice: false, placedAt: recent, createdAt: recent });
    prisma.order.rows.push(mkOrder("o1"), mkOrder("o2"), mkOrder("o3"));
    const line = (orderId: string, productId: string) => ({
      id: `${orderId}-${productId}`, orderId, productId, name: productId, sku: null,
      quantity: 1, priceMinor: 100n, totalMinor: 100n, isGift: false,
    });
    prisma.orderItem.rows.push(
      line("o1", "seed-a"), line("o1", "rec-1"), line("o1", "rec-2"), line("o1", "rec-3"),
      line("o2", "seed-a"), line("o2", "rec-1"), line("o2", "rec-2"), line("o2", "rec-3"),
      line("o3", "seed-b"), line("o3", "rec-1"),
    );
  }

  function makeRecSvc() {
    const prisma = makePrisma();
    seedShop(prisma);
    seedRecs(prisma);
    return { prisma, svc: new StorefrontService(prisma) };
  }

  it("ranks co-bought products for the cart seeds and drops out-of-stock ones", async () => {
    const { svc } = makeRecSvc();
    const out: any = await svc.cartRecommendations("shop-one", "seed-a");
    // rec-1/rec-2/rec-3 each co-occur twice; rec-2 is out of stock.
    expect(out.products.map((p: any) => p.id)).toEqual(["rec-1", "rec-3"]);
    expect(out.products.length).toBeLessThanOrEqual(8);
  });

  it("multi-seed carts union the seed orders", async () => {
    const { svc } = makeRecSvc();
    const out: any = await svc.cartRecommendations("shop-one", "seed-a, seed-b");
    expect(out.products.map((p: any) => p.id)).toEqual(["rec-1", "rec-3"]);
    expect(out.products[0].id).toBe("rec-1");
  });

  it("empty or non-active seeds yield an honest empty list", async () => {
    const { svc } = makeRecSvc();
    await expect(svc.cartRecommendations("shop-one", "")).resolves.toEqual({ products: [] });
    await expect(svc.cartRecommendations("shop-one", "nope-1, nope-2")).resolves.toEqual({ products: [] });
    await expect(svc.cartRecommendations("shop-one", "seed-arch")).resolves.toEqual({ products: [] });
  });
});
