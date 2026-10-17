import { PgVectorStore } from "./pgvector-store";

/**
 * SA-B2 (P2) — PgVectorStore guarantees, proven at the SQL layer
 * with a capturing fake Prisma (the REAL round-trip against
 * pgvector runs in the fresh-PG gate — see the acceptance doc):
 *  - L1: organizationId is a bound parameter of every statement,
 *    and delete operations are org-scoped in their WHERE clause.
 *  - L3: a customer-audience search carries visibility='public'
 *    INSIDE the SQL; an internal search does not need it.
 *  - Rows of other providers/models/dimensions are excluded in
 *    SQL (incomparable vectors never reach the ORDER BY).
 *  - Cosine distance `<=>` drives ordering; similarity = 1 − d.
 */

function capturingPrisma(searchRows: any[] = []) {
  const calls: { kind: string; sql?: any; args?: any }[] = [];
  const prisma: any = {
    knowledgeEmbedding: {
      findMany: async (args: any) => { calls.push({ kind: "findMany", args }); return []; },
      deleteMany: async (args: any) => { calls.push({ kind: "deleteMany", args }); return { count: 3 }; },
    },
    $executeRaw: async (sql: any) => { calls.push({ kind: "executeRaw", sql }); return 2; },
    $queryRaw: async (sql: any) => { calls.push({ kind: "queryRaw", sql }); return searchRows; },
  };
  return { prisma, calls };
}

const ORG = "org-sql";

describe("PgVectorStore (SA-B2)", () => {
  it("search: org + provider + model + dimension filters are bound parameters in the SQL", async () => {
    const { prisma, calls } = capturingPrisma([
      { id: "e1", sourceType: "knowledge_chunk", sourceId: "doc1", chunkIndex: 0, content: "text", visibility: "public", similarity: "0.91" },
    ]);
    const store = new PgVectorStore(prisma as any);
    const hits = await store.search(ORG, [0.1, 0.2, 0.3], { provider: "openai", model: "text-embedding-3-small", limit: 5, audience: "internal" });
    const q = calls.find((c) => c.kind === "queryRaw")!;
    expect(q.sql.text).toContain('"organizationId" = $');
    expect(q.sql.text).toContain('"provider" = $');
    expect(q.sql.text).toContain('"model" = $');
    expect(q.sql.text).toContain('"dimension" = $');
    expect(q.sql.text).toContain('<=>');
    expect(q.sql.values).toContain(ORG);
    expect(q.sql.values).toContain("openai");
    expect(q.sql.values).toContain("text-embedding-3-small");
    expect(q.sql.values).toContain(3); // dimension of the query vector
    expect(q.sql.values).toContain("[0.1,0.2,0.3]"); // the vector literal, cast ::vector in SQL
    expect(q.sql.text).toContain("::vector");
    expect(hits).toEqual([
      { id: "e1", sourceType: "knowledge_chunk", sourceId: "doc1", chunkIndex: 0, content: "text", visibility: "public", similarity: 0.91 },
    ]);
  });

  it("search: customer audience adds visibility='public' in SQL; internal does not", async () => {
    const { prisma, calls } = capturingPrisma();
    const store = new PgVectorStore(prisma as any);
    await store.search(ORG, [1, 0], { provider: "openai", model: "m", limit: 3, audience: "customer" });
    expect(calls[0].sql.text).toContain(`"visibility" = 'public'`);
    calls.length = 0;
    await store.search(ORG, [1, 0], { provider: "openai", model: "m", limit: 3, audience: "internal" });
    expect(calls[0].sql.text).not.toContain(`"visibility" = 'public'`);
  });

  it("search: sourceTypes filter is applied in SQL when given", async () => {
    const { prisma, calls } = capturingPrisma();
    const store = new PgVectorStore(prisma as any);
    await store.search(ORG, [1, 0], { provider: "openai", model: "m", limit: 3, audience: "internal", sourceTypes: ["knowledge_chunk"] });
    expect(calls[0].sql.text).toContain('"sourceType" IN');
    expect(calls[0].sql.values).toContain("knowledge_chunk");
  });

  it("insertRows: one INSERT with ::vector casts and every value bound", async () => {
    const { prisma, calls } = capturingPrisma();
    const store = new PgVectorStore(prisma as any);
    const n = await store.insertRows([
      { organizationId: ORG, sourceType: "knowledge_chunk", sourceId: "d1", chunkIndex: 0, content: "a", contentHash: "h1", provider: "openai", model: "m", dimension: 2, embedding: [0.5, 0.5], visibility: "public" },
      { organizationId: ORG, sourceType: "knowledge_chunk", sourceId: "d1", chunkIndex: 1, content: "b", contentHash: "h2", provider: "openai", model: "m", dimension: 2, embedding: [0.1, 0.9], visibility: "internal" },
    ]);
    expect(n).toBe(2);
    const ins = calls.find((c) => c.kind === "executeRaw")!;
    expect(ins.sql.text).toContain('INSERT INTO "KnowledgeEmbedding"');
    expect(ins.sql.text).toContain("::vector");
    expect(ins.sql.values).toContain(ORG);
    expect(ins.sql.values).toContain("[0.5,0.5]");
    expect(ins.sql.values).toContain("[0.1,0.9]");
    expect(ins.sql.values).toContain("h2");
  });

  it("insertRows: a non-finite vector component throws instead of writing malformed SQL", async () => {
    const { prisma, calls } = capturingPrisma();
    const store = new PgVectorStore(prisma as any);
    await expect(
      store.insertRows([
        { organizationId: ORG, sourceType: "knowledge_chunk", sourceId: "d1", chunkIndex: 0, content: "a", contentHash: "h", provider: "p", model: "m", dimension: 2, embedding: [Number.NaN, 1], visibility: "public" },
      ]),
    ).rejects.toThrow(/non-finite/);
    expect(calls.find((c) => c.kind === "executeRaw")).toBeUndefined();
  });

  it("deletes are org-scoped (ids and whole source)", async () => {
    const { prisma, calls } = capturingPrisma();
    const store = new PgVectorStore(prisma as any);
    await store.deleteByIds(ORG, ["e1", "e2"]);
    expect(calls[0].args.where).toEqual({ organizationId: ORG, id: { in: ["e1", "e2"] } });
    await store.deleteBySource(ORG, "knowledge_chunk", "d1");
    expect(calls[1].args.where).toEqual({ organizationId: ORG, sourceType: "knowledge_chunk", sourceId: "d1" });
    expect(await store.deleteByIds(ORG, [])).toBe(0);
    expect(calls).toHaveLength(2); // the empty delete never hit the DB
  });

  it("listBySource reads metadata org-scoped and never selects the vector column", async () => {
    const { prisma, calls } = capturingPrisma();
    const store = new PgVectorStore(prisma as any);
    await store.listBySource(ORG, "product", "p1");
    expect(calls[0].args.where).toEqual({ organizationId: ORG, sourceType: "product", sourceId: "p1" });
    expect(Object.keys(calls[0].args.select)).not.toContain("embedding");
  });
});
