import { NotFoundException } from "@nestjs/common";
import {
  buildFeedItems,
  serializeDarazCsv,
  serializeFeedCsv,
  serializeFeedXml,
  stripHtmlToText,
  DARAZ_FEED_TEMPLATE_WARNING,
  type FeedProductInput,
} from "./feed-generator";
import { FeedsService } from "./feeds.service";

/** EC14 — feed generator + serializers + token serving. */

const OPTS = {
  webBase: "https://shop.example.com",
  orgSlug: "shop-one",
  shopEnabled: true,
  brand: "Shop One",
  defaultGoogleCategory: null,
  includeOutOfStock: false,
};

function product(partial: Partial<FeedProductInput> & { id: string }): FeedProductInput {
  return {
    name: "লেদার ওয়ালেট",
    slug: "leather-wallet",
    description: "<p>আসল চামড়ার <b>ওয়ালেট</b></p>",
    seoDescription: null,
    sku: "WAL-1",
    priceMinor: 100000n,
    compareAtMinor: null,
    currency: "BDT",
    stockQuantity: 5,
    imageUrl: "https://cdn.example.com/wallet.jpg",
    images: [],
    barcode: null,
    categoryName: "ওয়ালেট",
    variants: [],
    ...partial,
  };
}

describe("EC14 buildFeedItems", () => {
  it("maps a product to a feed item: shop link, stripped description, formatted prices", () => {
    const { items, skipped } = buildFeedItems([product({ id: "p-1" })], OPTS);
    expect(skipped).toHaveLength(0);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("WAL-1");
    expect(items[0].link).toBe("https://shop.example.com/shop/shop-one/products/leather-wallet");
    expect(items[0].description).toBe("আসল চামড়ার ওয়ালেট");
    expect(items[0].priceMinor).toBe(100000n);
    expect(items[0].salePriceMinor).toBeNull();
    expect(items[0].inStock).toBe(true);
  });

  it("on sale: price carries the compare-at (regular) price, sale_price the selling price", () => {
    const { items } = buildFeedItems(
      [product({ id: "p-1", priceMinor: 80000n, compareAtMinor: 100000n })],
      OPTS,
    );
    expect(items[0].priceMinor).toBe(100000n);
    expect(items[0].salePriceMinor).toBe(80000n);
  });

  it("out-of-stock products are excluded unless the feed opts in", () => {
    const p = product({ id: "p-1", stockQuantity: 0 });
    const excluded = buildFeedItems([p], OPTS);
    expect(excluded.items).toHaveLength(0);
    expect(excluded.skipped[0].reason).toBe("out_of_stock");
    const included = buildFeedItems([p], { ...OPTS, includeOutOfStock: true });
    expect(included.items).toHaveLength(1);
    expect(included.items[0].inStock).toBe(false);
    // untracked stock (null) counts as in stock
    expect(buildFeedItems([product({ id: "p-2", stockQuantity: null })], OPTS).items).toHaveLength(1);
  });

  it("products without slug, image or description are skipped with reasons — never placeholder-filled", () => {
    const { items, skipped } = buildFeedItems(
      [
        product({ id: "p-1", slug: null }),
        product({ id: "p-2", imageUrl: null, images: [] }),
        product({ id: "p-3", description: "  ", seoDescription: null }),
      ],
      OPTS,
    );
    expect(items).toHaveLength(0);
    expect(skipped.map((s) => s.reason)).toEqual(["slug_missing", "image_missing", "description_missing"]);
  });

  it("variants become rows with item_group_id, variant sku and price", () => {
    const { items } = buildFeedItems(
      [
        product({
          id: "p-1",
          variants: [
            { id: "v-1", name: "কালো", sku: "WAL-1-BLK", priceMinor: 110000n, stockQuantity: 2 },
            { id: "v-2", name: "বাদামি", sku: "WAL-1-BRN", priceMinor: 120000n, stockQuantity: 0 },
          ],
        }),
      ],
      { ...OPTS, includeOutOfStock: true },
    );
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("WAL-1-BLK");
    expect(items[0].itemGroupId).toBe("WAL-1");
    expect(items[0].priceMinor).toBe(110000n);
    expect(items[0].title).toContain("কালো");
    expect(items[1].inStock).toBe(false);
  });

  it("falls back to the single checkout URL when the shop is disabled", () => {
    const { items } = buildFeedItems([product({ id: "p-1" })], { ...OPTS, shopEnabled: false });
    expect(items[0].link).toBe("https://shop.example.com/checkout/leather-wallet");
  });

  it("stripHtmlToText removes tags, scripts and entities", () => {
    expect(stripHtmlToText("<p>A &amp; B</p><script>x()</script>")).toBe("A & B");
  });
});

describe("EC14 serializers", () => {
  const { items } = buildFeedItems(
    [product({ id: "p-1", priceMinor: 80000n, compareAtMinor: 100000n, barcode: "8940001234567" })],
    OPTS,
  );
  const shop = { name: "Shop One", link: "https://shop.example.com/", description: "feed" };

  it("Meta XML uses spaced availability and carries sale_price below price", () => {
    const xml = serializeFeedXml(items, "meta", shop);
    expect(xml).toContain("<g:availability>in stock</g:availability>");
    expect(xml).toContain("<g:price>1000.00 BDT</g:price>");
    expect(xml).toContain("<g:sale_price>800.00 BDT</g:sale_price>");
    expect(xml).toContain("<g:gtin>8940001234567</g:gtin>");
    expect(xml).not.toContain("identifier_exists");
  });

  it("Google XML uses underscored availability; no GTIN ⇒ identifier_exists=no, never an invented GTIN", () => {
    const noBarcode = buildFeedItems([product({ id: "p-1" })], OPTS).items;
    const xml = serializeFeedXml(noBarcode, "google", shop);
    expect(xml).toContain("<g:availability>in_stock</g:availability>");
    expect(xml).toContain("<g:identifier_exists>no</g:identifier_exists>");
    expect(xml).not.toContain("<g:gtin>");
  });

  it("CSV uses the Google column set with escaped cells", () => {
    const csv = serializeFeedCsv(items);
    const [header, row] = csv.split("\n");
    expect(header.split(",")).toContain("google_product_category");
    expect(header.split(",")).toContain("identifier_exists");
    expect(row).toContain("WAL-1");
    expect(row).toContain("1000.00 BDT");
    expect(row).toContain("in_stock");
  });
});

// ---------- service ----------

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in (v as any)) {
        if (!((v as any).in as any[]).includes(row[k])) return false;
        continue;
      }
      if (!matchWhere(row, v)) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}

function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where, orderBy }: any = {}) => {
      const found = rows.filter((r) => matchWhere(r, where));
      if (orderBy && !Array.isArray(orderBy) && orderBy.createdAt === "asc") return found;
      return found;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
  };
}

function makePrisma() {
  return {
    productFeed: makeTable(),
    organization: makeTable(),
    storefrontSetting: makeTable(),
    product: makeTable(),
  } as any;
}

const auditStub: any = { log: jest.fn(async () => undefined) };

function seedFeedPrisma(prisma: any) {
  prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One" });
  prisma.storefrontSetting.rows.push({ id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: "Shop One" });
  prisma.product.rows.push(
    {
      id: "p-1", organizationId: "org-1", name: "লেদার ওয়ালেট", slug: "leather-wallet",
      description: "আসল চামড়া", seoDescription: null, sku: "WAL-1", status: "ACTIVE",
      priceMinor: 100000n, compareAtMinor: null, currency: "BDT", stockQuantity: 3,
      imageUrl: "https://cdn.example.com/w.jpg", images: [], barcode: null,
      category: "ওয়ালেট", categoryId: null, categoryRef: null, variants: [],
      createdAt: new Date(), updatedAt: new Date(),
    },
    {
      id: "p-2", organizationId: "org-1", name: "Draft Product", slug: "draft",
      description: "x", seoDescription: null, sku: "D-1", status: "DRAFT",
      priceMinor: 1000n, compareAtMinor: null, currency: "BDT", stockQuantity: 1,
      imageUrl: "https://cdn.example.com/d.jpg", images: [], barcode: null,
      category: null, categoryId: null, categoryRef: null, variants: [],
      createdAt: new Date(), updatedAt: new Date(),
    },
  );
}

describe("EC14 FeedsService", () => {
  it("create → serve by token → rotate kills the old URL; inactive + foreign + wrong-ext 404", async () => {
    const prisma = makePrisma();
    seedFeedPrisma(prisma);
    const svc = new FeedsService(prisma, auditStub);
    const { feed } = await svc.create("org-1", "u1", { channel: "google" } as any);
    expect(feed.format).toBe("xml");
    expect(feed.url).toContain(`/feeds/${feed.token}.xml`);

    const served = await svc.serveByToken(feed.token, "xml");
    expect(served.contentType).toContain("application/xml");
    expect(served.body).toContain("WAL-1");
    expect(served.body).not.toContain("Draft Product"); // only ACTIVE products
    const row = prisma.productFeed.rows.find((r: any) => r.id === feed.id);
    expect(row.lastGeneratedAt).toBeInstanceOf(Date);

    await expect(svc.serveByToken(feed.token, "csv")).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.serveByToken("no-such-token", "xml")).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.getOne("org-2", feed.id)).rejects.toBeInstanceOf(NotFoundException);

    const rotated = await svc.rotateToken("org-1", "u1", feed.id);
    expect(rotated.feed.token).not.toBe(feed.token);
    await expect(svc.serveByToken(feed.token, "xml")).rejects.toBeInstanceOf(NotFoundException);
    const served2 = await svc.serveByToken(rotated.feed.token, "xml");
    expect(served2.body).toContain("WAL-1");

    await svc.setActive("org-1", "u1", feed.id, false);
    await expect(svc.serveByToken(rotated.feed.token, "xml")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("preview shows the first items, counts and warnings (meta category)", async () => {
    const prisma = makePrisma();
    seedFeedPrisma(prisma);
    const svc = new FeedsService(prisma, auditStub);
    const { feed } = await svc.create("org-1", "u1", { channel: "meta" } as any);
    const prev: any = await svc.preview("org-1", feed.id);
    expect(prev.itemCount).toBe(1);
    expect(prev.items[0].id).toBe("WAL-1");
    expect(prev.warnings.join(" ")).toMatch(/google_product_category/);
  });

  it("tiktok channel defaults to a generic CSV", async () => {
    const prisma = makePrisma();
    seedFeedPrisma(prisma);
    const svc = new FeedsService(prisma, auditStub);
    const { feed } = await svc.create("org-1", "u1", { channel: "tiktok" } as any);
    expect(feed.format).toBe("csv");
    const served = await svc.serveByToken(feed.token, "csv");
    expect(served.contentType).toContain("text/csv");
    expect(served.body.split("\n")[0]).toContain("google_product_category");
  });
});

// ---------- OU3: Daraz feed export ----------

describe("OU3 Daraz CSV serializer", () => {
  it("generates rows from real catalog data with the required fields", () => {
    const { items, skipped } = buildFeedItems(
      [product({ id: "p-1", priceMinor: 80000n, compareAtMinor: 100000n, stockQuantity: 7 })],
      OPTS,
    );
    expect(skipped).toHaveLength(0);
    const csv = serializeDarazCsv(items);
    const [header, row] = csv.split("\n");
    expect(header).toBe(
      "seller_sku,name,description,price,special_price,currency,availability,quantity,image_url,additional_image_urls,product_url,brand,category",
    );
    const cells = row.split(",");
    expect(cells[0]).toBe("WAL-1"); // seller_sku from the real SKU
    expect(cells[3]).toBe("1000.00"); // regular price, plain decimal
    expect(cells[4]).toBe("800.00"); // special (sale) price
    expect(cells[5]).toBe("BDT");
    expect(cells[6]).toBe("in_stock");
    expect(cells[7]).toBe("7"); // real stock count
    expect(row).toContain("https://cdn.example.com/wallet.jpg");
    expect(row).toContain("https://shop.example.com/shop/shop-one/products/leather-wallet");
  });

  it("leaves quantity blank when the stock count is unknown — never invents one", () => {
    const { items } = buildFeedItems([product({ id: "p-1", stockQuantity: null })], OPTS);
    const row = serializeDarazCsv(items).split("\n")[1];
    const cells = row.split(",");
    expect(cells[7]).toBe("");
    expect(cells[4]).toBe(""); // no sale → no special_price
  });

  it("keeps the EC14 exclusion discipline: no slug / no image / no description ⇒ skipped, not exported", () => {
    const { items, skipped } = buildFeedItems(
      [
        product({ id: "p-1", slug: null }),
        product({ id: "p-2", imageUrl: null }),
        product({ id: "p-3", description: null, seoDescription: null }),
      ],
      OPTS,
    );
    expect(items).toHaveLength(0);
    expect(skipped).toHaveLength(3);
    expect(serializeDarazCsv(items).split("\n")).toHaveLength(1); // header only
  });
});

describe("OU3 FeedsService daraz channel", () => {
  it("defaults to CSV, serves Daraz columns from the real catalog, and refuses XML", async () => {
    const prisma = makePrisma();
    seedFeedPrisma(prisma);
    const svc = new FeedsService(prisma, auditStub);
    const { feed } = await svc.create("org-1", "u1", { channel: "daraz" } as any);
    expect(feed.format).toBe("csv");
    const served = await svc.serveByToken(feed.token, "csv");
    expect(served.contentType).toContain("text/csv");
    expect(served.body.split("\n")[0]).toContain("seller_sku");
    expect(served.body).toContain("WAL-1");
    expect(served.body).not.toContain("Draft Product");
    await expect(
      svc.create("org-1", "u1", { channel: "daraz", format: "xml" } as any),
    ).rejects.toThrow(/CSV/);
  });

  it("preview carries the honest unverified-template warning for daraz", async () => {
    const prisma = makePrisma();
    seedFeedPrisma(prisma);
    const svc = new FeedsService(prisma, auditStub);
    const { feed } = await svc.create("org-1", "u1", { channel: "daraz" } as any);
    const prev: any = await svc.preview("org-1", feed.id);
    expect(prev.itemCount).toBe(1);
    expect(prev.warnings).toContain(DARAZ_FEED_TEMPLATE_WARNING);
  });
});
