import { OrgBrainService } from "./org-brain.service";
import { EmbeddingsService } from "./embeddings.service";
import { PgVectorStore } from "./pgvector-store";
import type { EmbeddingRowInput, EmbeddingRowMeta, VectorSearchHit, VectorSearchOptions, VectorStore } from "./vector-store";
import { tokenize } from "../inbox/business-brain";

/**
 * SA-B7 (Smart AI Phase 1, R1): the Brain's product semantic
 * matches + the PgVectorStore audience tightening.
 *
 * SA-B2/B4 indexed the catalog's qualitative text under
 * sourceType "product", but no consumer ever searched it.
 * SA-B7 wires the search into OrgBrainService.getContext:
 *  1) a semantic product question surfaces the product, named
 *     from its LIVE row, with the indexed chunk as content;
 *  2) a product whose live row is archived/gone NEVER surfaces
 *     (a stale index row cannot resurrect it — L4);
 *  3) another org's product never surfaces (L1);
 *  4) the live price/stock values never enter through the
 *     match (they are not in the index by the SA-B2 rule, and
 *     the match content is the chunk, nothing else);
 *  5) without embeddings the surface is empty and the context
 *     is exactly the pre-SA-B7 one;
 *  6) PgVectorStore applies the public-only SQL filter to the
 *     "own_customer" audience too (customer-class since SA-B5;
 *     previously only the literal "customer" was filtered in
 *     SQL and own_customer relied on post-filtering alone).
 */

const DIM = 256;
function fakeVector(text: string): number[] {
  const v = new Array(DIM).fill(0);
  for (const tok of tokenize(text)) {
    let h = 0;
    for (const ch of tok) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % DIM] += 1;
  }
  return v;
}

class FakeEmbeddings extends EmbeddingsService {
  constructor() { super(undefined); }
  override async embedOne(_org: string, text: string): Promise<any> {
    return { ok: true, vectors: [fakeVector(text)], provider: "test", model: "fake-embed-1", dimension: DIM, inputTokens: 1, tokensEstimated: true };
  }
}

class InMemoryStore implements VectorStore {
  rows: (EmbeddingRowMeta & { embedding: number[] })[] = [];
  seed(row: EmbeddingRowMeta & { embedding: number[] }) { this.rows.push(row); }
  async listBySource(): Promise<EmbeddingRowMeta[]> { return []; }
  async insertRows(rows: EmbeddingRowInput[]): Promise<number> {
    for (const r of rows) this.rows.push({ ...r, id: `seed-${this.rows.length}` });
    return rows.length;
  }
  async deleteByIds(): Promise<number> { return 0; }
  async deleteBySource(): Promise<number> { return 0; }
  async search(org: string, qv: number[], opts: VectorSearchOptions): Promise<VectorSearchHit[]> {
    const qn = Math.sqrt(qv.reduce((s, n) => s + n * n, 0)) || 1;
    return this.rows
      .filter((r) => r.organizationId === org && r.provider === opts.provider && r.model === opts.model && r.dimension === qv.length)
      .filter((r) => !opts.sourceTypes || opts.sourceTypes.includes(r.sourceType))
      .filter((r) => opts.audience === "internal" || r.visibility === "public")
      .map((r) => {
        const dn = Math.sqrt(r.embedding.reduce((s, n) => s + n * n, 0)) || 1;
        const dot = r.embedding.reduce((s, n, i) => s + n * qv[i], 0);
        return { id: r.id, sourceType: r.sourceType, sourceId: r.sourceId, chunkIndex: r.chunkIndex, content: r.content, visibility: r.visibility, similarity: dot / (qn * dn) };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, opts.limit);
  }
}

const A = "org-a";
const B = "org-b";
const PRICE_SENTINEL_MINOR = 99999900n; // formats to 999,999.00 — must never surface via a match

const PRODUCTS = [
  { id: "prod-a1", organizationId: A, status: "ACTIVE", name: "Cotton Panjabi", priceMinor: PRICE_SENTINEL_MINOR, currency: "BDT", stockQuantity: 7 },
  { id: "prod-a2", organizationId: A, status: "ARCHIVED", name: "Old Cream", priceMinor: 100n, currency: "BDT", stockQuantity: 3 },
  { id: "prod-b1", organizationId: B, status: "ACTIVE", name: "B Shop Panjabi", priceMinor: 100n, currency: "BDT", stockQuantity: 3 },
];
const CHUNKS: Record<string, string> = {
  "prod-a1": "খাঁটি সুতির পাঞ্জাবি — সেনসিটিভ ত্বকের জন্য আরামদায়ক, গরমে ঘাম শোষণ করে, প্রতিদিনের ব্যবহারে টেকসই।",
  "prod-a2": "সেনসিটিভ ত্বকের জন্য আরামদায়ক পুরনো ক্রিম, ত্বকের যত্নে ব্যবহৃত হতো।",
  "prod-b1": "সেনসিটিভ ত্বকের জন্য আরামদায়ক পাঞ্জাবি, অন্য দোকানের পণ্য।",
};
const QUERY = "সেনসিটিভ ত্বকের জন্য আরামদায়ক কোনটা হবে?";

function fakePrisma() {
  return {
    businessProfile: { findUnique: async () => null },
    organization: { findUnique: async ({ where }: any) => ({ id: where.id, name: "Shop" }) },
    businessPolicy: { findMany: async () => [], findFirst: async () => null },
    knowledgeDocument: { findMany: async () => [] },
    product: {
      findMany: async ({ where }: any) => {
        let rows = PRODUCTS.filter((p) => p.organizationId === where.organizationId);
        if (where.id?.in) rows = rows.filter((p) => where.id.in.includes(p.id));
        return rows;
      },
    },
  } as any;
}

function seededStore(): InMemoryStore {
  const store = new InMemoryStore();
  for (const p of PRODUCTS) {
    store.seed({
      id: `emb-${p.id}`, organizationId: p.organizationId, sourceType: "product", sourceId: p.id, chunkIndex: 0,
      content: CHUNKS[p.id], contentHash: "h", provider: "test", model: "fake-embed-1", dimension: DIM,
      visibility: "public", embedding: fakeVector(CHUNKS[p.id]),
    });
  }
  return store;
}

describe("SA-B7 OrgBrainService product matches", () => {
  it("surfaces the semantically matched product, named from its live row", async () => {
    const brain = new OrgBrainService(fakePrisma(), new FakeEmbeddings(), seededStore());
    const ctx = await brain.getContext(A, { audience: "customer", query: QUERY });
    expect(ctx.productMatches).toHaveLength(1);
    expect(ctx.productMatches[0].productId).toBe("prod-a1");
    expect(ctx.productMatches[0].name).toBe("Cotton Panjabi");
    expect(ctx.productMatches[0].content).toContain("সেনসিটিভ");
    expect(ctx.productMatches[0].via).toBe("vector");
    expect(ctx.sources).toContainEqual(expect.objectContaining({ type: "product_knowledge", productId: "prod-a1" }));
  });

  it("never surfaces an archived product or another org's product", async () => {
    const brain = new OrgBrainService(fakePrisma(), new FakeEmbeddings(), seededStore());
    const ctx = await brain.getContext(A, { audience: "customer", query: QUERY });
    const ids = ctx.productMatches.map((m) => m.productId);
    expect(ids).not.toContain("prod-a2"); // ARCHIVED live row — stale chunk cannot resurrect it
    expect(ids).not.toContain("prod-b1"); // org B — the search is org-bound
    const ctxB = await brain.getContext(B, { audience: "customer", query: QUERY });
    expect(ctxB.productMatches.map((m) => m.productId)).toEqual(["prod-b1"]);
  });

  it("the live price/stock values never enter through a product match", async () => {
    const brain = new OrgBrainService(fakePrisma(), new FakeEmbeddings(), seededStore());
    const ctx = await brain.getContext(A, { audience: "customer", query: QUERY });
    const serialized = JSON.stringify(ctx.productMatches);
    expect(serialized).not.toContain("999999");
    expect(serialized).not.toContain("999,999");
  });

  it("own_customer (customer-class) gets product matches too", async () => {
    const brain = new OrgBrainService(fakePrisma(), new FakeEmbeddings(), seededStore());
    const ctx = await brain.getContext(A, { audience: "own_customer", query: QUERY, customerKey: "whatsapp:123" });
    expect(ctx.productMatches.map((m) => m.productId)).toEqual(["prod-a1"]);
  });

  it("without embeddings the surface is empty — pre-SA-B7 behaviour exactly", async () => {
    const brain = new OrgBrainService(fakePrisma());
    const ctx = await brain.getContext(A, { audience: "customer", query: QUERY });
    expect(ctx.productMatches).toEqual([]);
    expect(ctx.retrievalMode).toBe("keyword");
  });
});

describe("SA-B7 PgVectorStore audience filter", () => {
  function captureStore() {
    const sqls: any[] = [];
    const prisma: any = {
      $queryRaw: jest.fn(async (sql: any) => { sqls.push(sql); return []; }),
    };
    return { store: new PgVectorStore(prisma), sqls };
  }
  const sqlText = (sql: any) => (sql.strings as string[]).join(" ");

  it("own_customer carries the public-only filter in SQL, like customer", async () => {
    const { store, sqls } = captureStore();
    await store.search(A, [1, 0], { provider: "p", model: "m", limit: 3, audience: "own_customer" });
    expect(sqlText(sqls[0])).toContain(`"visibility" = 'public'`);
  });

  it("customer filtered, internal unfiltered (unchanged)", async () => {
    const { store, sqls } = captureStore();
    await store.search(A, [1, 0], { provider: "p", model: "m", limit: 3, audience: "customer" });
    expect(sqlText(sqls[0])).toContain(`"visibility" = 'public'`);
    await store.search(A, [1, 0], { provider: "p", model: "m", limit: 3, audience: "internal" });
    expect(sqlText(sqls[1])).not.toContain(`"visibility" = 'public'`);
  });
});
