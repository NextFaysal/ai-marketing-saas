import { KnowledgeIndexingService } from "./knowledge-indexing.service";
import { EmbeddingsService } from "./embeddings.service";
import type { EmbeddingRowInput, EmbeddingRowMeta, VectorSearchHit, VectorSearchOptions, VectorStore } from "./vector-store";

/**
 * SA-B2 (P2) — indexing pipeline guarantees:
 *  - Hash-skip: re-indexing an unchanged document inserts 0
 *    rows and keeps the very same row ids.
 *  - A changed chunk re-embeds ONLY itself; its unchanged
 *    sibling chunk is neither re-embedded nor deleted.
 *  - When embeddings are unavailable, NOTHING is stored and the
 *    result is a typed "unavailable" (the source stays
 *    keyword-only) — never a fabricated vector.
 *  - The visibility snapshot follows the source; flipping a
 *    document public→internal (or back) refreshes the rows.
 *  - Product rows carry name/description text only — never a
 *    price — and a non-ACTIVE product's rows are removed.
 *  - backfillOrg counts honestly and collects per-source
 *    failures instead of swallowing them.
 * The fake embeddings + in-memory store below are TEST doubles
 * for the port (deterministic vectors derived from the text);
 * production code contains no vector fabrication of any kind.
 */

class FakeEmbeddings extends EmbeddingsService {
  unavailableReason: string | null = null;
  embedCalls = 0;
  constructor() { super(undefined); }
  override async resolveConfig(): Promise<any> {
    if (this.unavailableReason) return { ok: false, reason: this.unavailableReason };
    return { ok: true, config: { provider: "test", apiKey: "x", model: "fake-embed-1" } };
  }
  override async embed(_org: string, texts: string[]): Promise<any> {
    if (this.unavailableReason) return { ok: false, reason: this.unavailableReason };
    this.embedCalls++;
    if (texts.some((t) => t.includes("BOOM"))) throw new Error("provider exploded");
    return {
      ok: true, provider: "test", model: "fake-embed-1", dimension: 4, inputTokens: texts.length, tokensEstimated: true,
      vectors: texts.map((t) => [count(t, "a"), count(t, "b"), count(t, "c"), t.length % 10]),
    };
  }
}
const count = (t: string, ch: string) => t.split("").filter((c) => c === ch).length;

class InMemoryStore implements VectorStore {
  rows: (EmbeddingRowMeta & { embedding: number[] })[] = [];
  private seq = 0;
  async listBySource(org: string, st: string, sid: string): Promise<EmbeddingRowMeta[]> {
    return this.rows.filter((r) => r.organizationId === org && r.sourceType === st && r.sourceId === sid)
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map(({ embedding: _e, ...meta }) => meta);
  }
  async insertRows(rows: EmbeddingRowInput[]): Promise<number> {
    for (const r of rows) this.rows.push({ ...r, id: `row-${++this.seq}` });
    return rows.length;
  }
  async deleteByIds(org: string, ids: string[]): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.organizationId === org && ids.includes(r.id)));
    return before - this.rows.length;
  }
  async deleteBySource(org: string, st: string, sid: string): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.organizationId === org && r.sourceType === st && r.sourceId === sid));
    return before - this.rows.length;
  }
  async search(): Promise<VectorSearchHit[]> { return []; }
}

const ORG = "org-idx";
const A2000 = "a".repeat(2000);
const B2000 = "b".repeat(2000);
const C2000 = "c".repeat(2000);

function makeSvc(prisma: any = {}) {
  const emb = new FakeEmbeddings();
  const store = new InMemoryStore();
  const svc = new KnowledgeIndexingService(prisma as any, emb as any, store as any);
  return { svc, emb, store };
}

describe("KnowledgeIndexingService (SA-B2)", () => {
  it("indexes a document: stored content is the bare chunk, title leads only the embedded text", async () => {
    const { svc, store } = makeSvc();
    const res = await svc.indexDocument({ id: "d1", organizationId: ORG, title: "Warranty", content: "One year replacement guarantee.", visibility: "public" });
    expect(res).toMatchObject({ status: "indexed", inserted: 1, deleted: 0, skippedChunks: 0 });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ sourceType: "knowledge_chunk", sourceId: "d1", chunkIndex: 0, content: "One year replacement guarantee.", visibility: "public", provider: "test", model: "fake-embed-1", dimension: 4 });
    expect(store.rows[0].contentHash).toHaveLength(64);
  });

  it("hash-skip: re-indexing an unchanged document inserts 0 rows and keeps the same row ids", async () => {
    const { svc, emb, store } = makeSvc();
    const doc = { id: "d1", organizationId: ORG, title: "Warranty", content: "One year replacement guarantee.", visibility: "public" };
    await svc.indexDocument(doc);
    const firstId = store.rows[0].id;
    const callsBefore = emb.embedCalls;
    const res = await svc.indexDocument(doc);
    expect(res).toMatchObject({ status: "indexed", inserted: 0, deleted: 0, skippedChunks: 1 });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].id).toBe(firstId);
    expect(emb.embedCalls).toBe(callsBefore); // no provider call at all
  });

  it("a changed chunk re-embeds only itself; the unchanged chunk keeps its row", async () => {
    const { svc, store } = makeSvc();
    const v1 = { id: "d2", organizationId: ORG, title: "T", content: `${A2000}\n\n${B2000}`, visibility: "public" };
    const r1 = await svc.indexDocument(v1);
    expect(r1).toMatchObject({ status: "indexed", inserted: 2 });
    const chunk0Id = store.rows.find((r) => r.chunkIndex === 0)!.id;
    const r2 = await svc.indexDocument({ ...v1, content: `${A2000}\n\n${C2000}` });
    expect(r2).toMatchObject({ status: "indexed", inserted: 1, deleted: 1, skippedChunks: 1 });
    expect(store.rows).toHaveLength(2);
    expect(store.rows.find((r) => r.chunkIndex === 0)!.id).toBe(chunk0Id);
    expect(store.rows.find((r) => r.chunkIndex === 1)!.content).toBe(C2000);
  });

  it("embeddings unavailable: nothing is stored, typed result, no throw", async () => {
    const { svc, emb, store } = makeSvc();
    emb.unavailableReason = "provider_has_no_embeddings_api";
    const res = await svc.indexDocument({ id: "d3", organizationId: ORG, title: "X", content: "some text", visibility: "public" });
    expect(res).toEqual({ status: "unavailable", reason: "provider_has_no_embeddings_api" });
    expect(store.rows).toHaveLength(0);
  });

  it("visibility flip refreshes the snapshot even when the text is unchanged", async () => {
    const { svc, store } = makeSvc();
    const doc = { id: "d4", organizationId: ORG, title: "Note", content: "internal margin note", visibility: "internal" };
    await svc.indexDocument(doc);
    expect(store.rows[0].visibility).toBe("internal");
    const res = await svc.indexDocument({ ...doc, visibility: "public" });
    expect(res.inserted).toBe(1); // re-embedded under the new snapshot
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].visibility).toBe("public");
  });

  it("empty content removes the source's rows", async () => {
    const { svc, store } = makeSvc();
    const doc = { id: "d5", organizationId: ORG, title: "X", content: "text", visibility: "public" };
    await svc.indexDocument(doc);
    expect(store.rows).toHaveLength(1);
    const res = await svc.indexDocument({ ...doc, content: "   " });
    expect(res).toMatchObject({ status: "indexed", chunks: 0, deleted: 1 });
    expect(store.rows).toHaveLength(0);
  });

  it("product: name/description text only (never price); archiving removes the rows", async () => {
    const { svc, store } = makeSvc();
    const product: any = { id: "p1", organizationId: ORG, name: "Cotton Panjabi", description: "Soft cotton panjabi for Eid.", category: "Clothing", status: "ACTIVE", priceMinor: 259900n, stockQuantity: 7 };
    const res = await svc.indexProduct(product);
    expect(res).toMatchObject({ status: "indexed", inserted: 1 });
    expect(store.rows[0].content).toContain("Cotton Panjabi");
    expect(store.rows[0].content).toContain("Soft cotton panjabi for Eid.");
    expect(store.rows[0].content).not.toContain("2599");
    expect(store.rows[0].visibility).toBe("public");
    const archived = await svc.indexProduct({ ...product, status: "ARCHIVED" });
    expect(archived.status).toBe("skipped");
    expect(store.rows).toHaveLength(0);
  });

  it("backfillOrg: indexes every doc + ACTIVE product, collects failures, never swallows them", async () => {
    const prisma: any = {
      knowledgeDocument: {
        findMany: async () => [
          { id: "ok-doc", organizationId: ORG, title: "A", content: "fine text", visibility: "public" },
          { id: "bad-doc", organizationId: ORG, title: "B", content: "BOOM text", visibility: "public" },
        ],
      },
      product: {
        findMany: async () => [{ id: "p1", organizationId: ORG, name: "Shirt", description: "A shirt", status: "ACTIVE" }],
      },
    };
    const { svc } = makeSvc(prisma);
    const res = await svc.backfillOrg(ORG);
    expect(res.status).toBe("done");
    expect(res.docsIndexed).toBe(1);
    expect(res.productsIndexed).toBe(1);
    expect(res.failures).toEqual([{ sourceType: "knowledge_chunk", sourceId: "bad-doc", reason: "provider exploded" }]);
    // Idempotent: a second sweep changes nothing.
    const again = await svc.backfillOrg(ORG);
    expect(again.docsIndexed).toBe(1); // still reports indexed (hash-skipped inside)
    expect(again.failures).toHaveLength(1);
  });

  it("backfillOrg: unavailable provider short-circuits with the typed reason", async () => {
    const { svc, emb } = makeSvc({ knowledgeDocument: { findMany: async () => [] } });
    emb.unavailableReason = "ai_disabled_for_org";
    const res = await svc.backfillOrg(ORG);
    expect(res).toMatchObject({ status: "unavailable", reason: "ai_disabled_for_org", docsIndexed: 0 });
  });

  it("removeDocument deletes only that org's rows for the source", async () => {
    const { svc, store } = makeSvc();
    await svc.indexDocument({ id: "d6", organizationId: ORG, title: "X", content: "text", visibility: "public" });
    await svc.indexDocument({ id: "d6", organizationId: "org-other", title: "X", content: "text", visibility: "public" });
    await svc.removeDocument(ORG, "d6");
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].organizationId).toBe("org-other");
  });
});
