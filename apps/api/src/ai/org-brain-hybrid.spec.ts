import { OrgBrainService } from "./org-brain.service";
import { EmbeddingsService } from "./embeddings.service";
import { tokenize } from "../inbox/business-brain";
import type { EmbeddingRowInput, EmbeddingRowMeta, VectorSearchHit, VectorSearchOptions, VectorStore } from "./vector-store";

/**
 * SA-B2 (P2) — hybrid retrieval in OrgBrainService:
 *  - A paraphrase with ZERO keyword overlap surfaces via the
 *    vector path alone (via: "vector"), labelled retrievalMode
 *    "hybrid".
 *  - A document with no embedding rows still surfaces via the
 *    keyword fill; vector hits order first, keyword fills after,
 *    capped at matchLimit (the recorded merge rule).
 *  - L3 on the vector path: an internal-visibility chunk never
 *    reaches a customer context (the store filters in its query
 *    AND OrgBrain re-checks the live document row).
 *  - L1 on the vector path: org B's vectors never surface for
 *    org A.
 *  - Fallback: embeddings unavailable ⇒ retrievalMode "keyword"
 *    and results IDENTICAL to the SA-B1 keyword-only service.
 *
 * Test doubles: the fake embeddings map synonyms to canonical
 * tokens before bagging (a stand-in for real semantics — the
 * merge mechanics are what is under test, not embedding
 * quality), and the in-memory store implements the VectorStore
 * port with the same filters PgVectorStore puts in SQL.
 */

const DIM = 256;
const SYNONYMS: Record<string, string> = { warranty: "guarantee", coverage: "guarantee", long: "year", last: "year" };

function fakeVector(text: string): number[] {
  const v = new Array(DIM).fill(0);
  for (const raw of tokenize(text)) {
    const tok = SYNONYMS[raw] ?? raw;
    let h = 0;
    for (const ch of tok) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % DIM] += 1;
  }
  return v;
}

class FakeEmbeddings extends EmbeddingsService {
  available = true;
  constructor() { super(undefined); }
  override async embedOne(_org: string, text: string): Promise<any> {
    if (!this.available) return { ok: false, reason: "provider_has_no_embeddings_api" };
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
      .filter((r) => opts.audience !== "customer" || r.visibility === "public")
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

const DOCS = [
  { id: "a-warranty", organizationId: A, kind: "faq", visibility: "public", title: "Warranty policy", content: "We offer a one year replacement guarantee on every product.", createdAt: new Date(4) },
  { id: "a-delivery", organizationId: A, kind: "faq", visibility: "public", title: "Delivery info", content: "Delivery inside Dhaka takes two working days.", createdAt: new Date(3) },
  // No embedding rows seeded for this one: the keyword-only case.
  { id: "a-cod", organizationId: A, kind: "faq", visibility: "public", title: "Cash on delivery", content: "Cash on delivery available inside Dhaka.", createdAt: new Date(2) },
  { id: "a-internal", organizationId: A, kind: "note", visibility: "internal", title: "Warranty internal", content: "Warranty guarantee year supplier margin note.", createdAt: new Date(1) },
  { id: "b-warranty", organizationId: B, kind: "faq", visibility: "public", title: "Warranty policy", content: "B shop offers a one year replacement guarantee too.", createdAt: new Date(1) },
];

function fakePrisma() {
  const prisma: any = {
    businessProfile: { findUnique: async () => null },
    organization: { findUnique: async ({ where }: any) => ({ id: where.id, name: "Shop" }) },
    businessPolicy: { findMany: async () => [], findFirst: async () => null },
    knowledgeDocument: {
      findMany: async ({ where, take }: any) => {
        let rows = DOCS.filter((d) => d.organizationId === where.organizationId);
        if (where.id?.in) rows = rows.filter((d) => where.id.in.includes(d.id));
        return rows.slice(0, take ?? rows.length);
      },
    },
  };
  return prisma;
}

function seededStore(): InMemoryStore {
  const store = new InMemoryStore();
  for (const doc of DOCS) {
    if (doc.id === "a-cod") continue; // deliberately unindexed
    store.seed({
      id: `row-${doc.id}`, organizationId: doc.organizationId, sourceType: "knowledge_chunk", sourceId: doc.id,
      chunkIndex: 0, content: doc.content, contentHash: "x", provider: "test", model: "fake-embed-1", dimension: DIM,
      visibility: doc.visibility, embedding: fakeVector(`${doc.title}\n\n${doc.content}`),
    });
  }
  return store;
}

function makeHybrid() {
  const emb = new FakeEmbeddings();
  const svc = new OrgBrainService(fakePrisma() as any, emb as any, seededStore() as any);
  return { svc, emb };
}

describe("OrgBrainService hybrid retrieval (SA-B2)", () => {
  it("vector-only paraphrase hit surfaces (zero keyword overlap), labelled hybrid", async () => {
    const { svc } = makeHybrid();
    // "How long does the coverage last?" shares no content token
    // with the warranty document — keyword matching alone misses
    // it entirely (proven by the keyword-only control below).
    const ctx = await svc.getContext(A, { audience: "customer", query: "How long does the coverage last?", matchLimit: 5 });
    expect(ctx.retrievalMode).toBe("hybrid");
    expect(ctx.knowledgeMatches.map((m) => m.docId)).toEqual(["a-warranty"]);
    expect(ctx.knowledgeMatches[0].via).toBe("vector");
    expect(ctx.knowledgeMatches[0].score).toBeGreaterThan(0.35);

    const keywordOnly = new OrgBrainService(fakePrisma() as any);
    const control = await keywordOnly.getContext(A, { audience: "customer", query: "How long does the coverage last?", matchLimit: 5 });
    expect(control.retrievalMode).toBe("keyword");
    expect(control.knowledgeMatches).toEqual([]);
  });

  it("merge: vector hits first, keyword-only documents fill after, capped at matchLimit", async () => {
    const { svc } = makeHybrid();
    const ctx = await svc.getContext(A, { audience: "customer", query: "cash delivery", matchLimit: 5 });
    // a-delivery is semantically nearest (vector); a-cod has no
    // embedding rows at all and arrives via the keyword fill.
    expect(ctx.knowledgeMatches.map((m) => m.docId)).toEqual(["a-delivery", "a-cod"]);
    expect(ctx.knowledgeMatches[0].via).toBe("vector");
    expect(ctx.knowledgeMatches[1].via).toBe("keyword");
    const capped = await svc.getContext(A, { audience: "customer", query: "cash delivery", matchLimit: 1 });
    expect(capped.knowledgeMatches).toHaveLength(1);
    expect(capped.knowledgeMatches[0].docId).toBe("a-delivery");
  });

  it("audience: the internal chunk never reaches a customer context via the vector path; internal audience sees it", async () => {
    const { svc } = makeHybrid();
    const customer = await svc.getContext(A, { audience: "customer", query: "How long does the coverage last?", matchLimit: 5 });
    expect(customer.knowledgeMatches.map((m) => m.docId)).not.toContain("a-internal");
    expect(JSON.stringify(customer.knowledgeMatches)).not.toContain("supplier margin");
    const internal = await svc.getContext(A, { audience: "internal", query: "How long does the coverage last?", matchLimit: 5 });
    expect(internal.knowledgeMatches.map((m) => m.docId)).toContain("a-internal");
    const internalMatch = internal.knowledgeMatches.find((m) => m.docId === "a-internal")!;
    expect(internalMatch.visibility).toBe("internal");
  });

  it("isolation: org B's vectors never surface for org A (and vice versa)", async () => {
    const { svc } = makeHybrid();
    const ctxA = await svc.getContext(A, { audience: "internal", query: "How long does the coverage last?", matchLimit: 5 });
    expect(ctxA.knowledgeMatches.map((m) => m.docId)).not.toContain("b-warranty");
    const ctxB = await svc.getContext(B, { audience: "customer", query: "How long does the coverage last?", matchLimit: 5 });
    expect(ctxB.knowledgeMatches.map((m) => m.docId)).toEqual(["b-warranty"]);
  });

  it("fallback: embeddings unavailable → keyword mode with results identical to SA-B1", async () => {
    const { svc, emb } = makeHybrid();
    emb.available = false;
    const query = "cash on delivery";
    const hybrid = await svc.getContext(A, { audience: "customer", query, matchLimit: 5 });
    const keywordOnly = new OrgBrainService(fakePrisma() as any);
    const control = await keywordOnly.getContext(A, { audience: "customer", query, matchLimit: 5 });
    expect(hybrid.retrievalMode).toBe("keyword");
    expect(hybrid.knowledgeMatches.map((m) => ({ docId: m.docId, score: m.score, content: m.content })))
      .toEqual(control.knowledgeMatches.map((m) => ({ docId: m.docId, score: m.score, content: m.content })));
  });

  it("hybrid label holds even when the vector path finds nothing above the floor", async () => {
    const { svc } = makeHybrid();
    const ctx = await svc.getContext(A, { audience: "customer", query: "cash on delivery", matchLimit: 5 });
    expect(ctx.retrievalMode).toBe("hybrid");
    // An unrelated query: no keyword hits, no vector hits above
    // the similarity floor → empty, never a weak neighbour.
    const empty = await svc.getContext(A, { audience: "customer", query: "quantum flux capacitor", matchLimit: 5 });
    expect(empty.retrievalMode).toBe("hybrid");
    expect(empty.knowledgeMatches).toEqual([]);
  });
});
