import "reflect-metadata";
import { AdminTranslationsCoverageService } from "./admin-translations.service";

/**
 * MB5 (ML15) — translation coverage aggregation. Fake prisma
 * implementing Prisma's groupBy contract (by + _count._all)
 * over in-memory rows; the service is exercised directly.
 */

type Row = Record<string, any>;

function groupBy(rows: Row[]) {
  return async ({ by }: any) => {
    const map = new Map<string, Row>();
    for (const r of rows) {
      const key = JSON.stringify(by.map((b: string) => r[b] ?? null));
      const existing = map.get(key);
      if (existing) existing._count._all += 1;
      else {
        const entry: Row = { _count: { _all: 1 } };
        for (const b of by) entry[b] = r[b] ?? null;
        map.set(key, entry);
      }
    }
    return [...map.values()];
  };
}

function makePrisma(seed: {
  orgs?: Row[]; products?: Row[]; categories?: Row[]; blogPosts?: Row[]; translations?: Row[];
}) {
  return {
    organization: {
      findMany: async () => (seed.orgs ?? []).map((o) => ({ id: o.id, name: o.name })),
    },
    product: { groupBy: groupBy(seed.products ?? []) },
    category: { groupBy: groupBy(seed.categories ?? []) },
    blogPost: { groupBy: groupBy(seed.blogPosts ?? []) },
    contentTranslation: { groupBy: groupBy(seed.translations ?? []) },
  } as any;
}

const rep = (row: Row, n: number): Row[] => Array.from({ length: n }, () => ({ ...row }));

describe("MB5 AdminTranslationsCoverageService", () => {
  it("empty platform → orgs with zeroed coverage; storefront denominator is the constant 3 per org", async () => {
    const svc = new AdminTranslationsCoverageService(makePrisma({ orgs: [{ id: "o1", name: "Org One" }] }));
    const out: any = await svc.coverage();
    expect(out.localeKind).toBe("content");
    expect(out.locales).toEqual(["bn", "en", "hi"]);
    expect(out.orgs).toHaveLength(1);
    expect(out.orgs[0].organizationName).toBe("Org One");
    // No entities at all: possible = storefront_string 3 only.
    expect(out.orgs[0].locales.bn.possible).toBe(3);
    expect(out.orgs[0].locales.bn.translated).toBe(0);
    expect(out.orgs[0].locales.bn.byEntity.storefront_string.possible).toBe(3);
    expect(out.totals.locales.hi.possible).toBe(3);
  });

  it("denominators: products ×2, categories ×2, blog posts ×1 (+ storefront 3); counts split approved/draft per locale", async () => {
    const svc = new AdminTranslationsCoverageService(makePrisma({
      orgs: [{ id: "o1", name: "Org One" }],
      products: rep({ organizationId: "o1" }, 4),
      categories: rep({ organizationId: "o1" }, 2),
      blogPosts: rep({ organizationId: "o1" }, 3),
      translations: [
        ...rep({ organizationId: "o1", entityType: "product", locale: "hi", status: "approved" }, 5),
        ...rep({ organizationId: "o1", entityType: "product", locale: "hi", status: "draft" }, 2),
        ...rep({ organizationId: "o1", entityType: "category", locale: "hi", status: "approved" }, 1),
        ...rep({ organizationId: "o1", entityType: "blog_post", locale: "en", status: "approved" }, 2),
        ...rep({ organizationId: "o1", entityType: "storefront_string", locale: "bn", status: "approved" }, 3),
      ],
    }));
    const out: any = await svc.coverage();
    const org = out.orgs[0];
    expect(org.entityCounts).toEqual({ product: 4, category: 2, blogPost: 3 });
    // possible per locale = 4×2 + 2×2 + 3 + 3×1 = 18
    expect(org.locales.hi.possible).toBe(18);
    expect(org.locales.hi.translated).toBe(8);
    expect(org.locales.hi.approved).toBe(6);
    expect(org.locales.hi.draft).toBe(2);
    expect(org.locales.hi.byEntity.product).toMatchObject({ possible: 8, translated: 7, approved: 5, draft: 2 });
    expect(org.locales.hi.byEntity.category).toMatchObject({ possible: 4, translated: 1, approved: 1 });
    expect(org.locales.en.byEntity.blog_post).toMatchObject({ possible: 3, translated: 2, approved: 2 });
    expect(org.locales.bn.byEntity.storefront_string).toMatchObject({ possible: 3, translated: 3, approved: 3 });
    // Totals equal the single org's figures.
    expect(out.totals.locales.hi).toMatchObject({ possible: 18, translated: 8, approved: 6, draft: 2 });
  });

  it("org isolation: rows never bleed across orgs; an org with no content still lists with denominators", async () => {
    const svc = new AdminTranslationsCoverageService(makePrisma({
      orgs: [{ id: "o1", name: "One" }, { id: "o2", name: "Two" }],
      products: [...rep({ organizationId: "o1" }, 1), ...rep({ organizationId: "o2" }, 10)],
      translations: rep({ organizationId: "o2", entityType: "product", locale: "en", status: "approved" }, 20),
    }));
    const out: any = await svc.coverage();
    const [o1, o2] = out.orgs;
    expect(o1.locales.en).toMatchObject({ possible: 5, translated: 0, approved: 0 });
    expect(o2.locales.en).toMatchObject({ possible: 23, translated: 20, approved: 20 });
    expect(out.totals.locales.en.translated).toBe(20);
  });

  it("unknown entity types / locales in stored rows are ignored, never crash the board", async () => {
    const svc = new AdminTranslationsCoverageService(makePrisma({
      orgs: [{ id: "o1", name: "One" }],
      translations: [
        { organizationId: "o1", entityType: "page", locale: "en", status: "approved" },
        { organizationId: "o1", entityType: "product", locale: "fr", status: "approved" },
      ],
    }));
    const out: any = await svc.coverage();
    expect(out.orgs[0].locales.en.translated).toBe(0);
    expect(out.totals.locales.en.translated).toBe(0);
  });
});
