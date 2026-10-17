import { EmbeddingsService } from "./embeddings.service";

/**
 * SA-B2 (P2) — EmbeddingsService guarantees:
 *  - Resolution follows the chat path: platform env config here
 *    (the org-config reader is resolveOrgLlmConfig's own tested
 *    surface); per-provider embedding model defaults apply and
 *    the chat model is never reused as an embedding model.
 *  - Providers that cannot embed return a TYPED unavailable —
 *    anthropic (no embeddings API) and the dev adapter (not a
 *    real model). No vector is ever fabricated.
 *  - The per-org AI kill switch blocks calls before any fetch.
 *  - Usage lands in AIUsageRecord with feature "embedding";
 *    Gemini's missing usage is recorded as a labelled estimate.
 */

const ORG = "org-emb";

function fakePrisma(killList: string[] = []) {
  const usage: any[] = [];
  const prisma: any = {
    systemSetting: {
      findUnique: async ({ where }: any) =>
        where.key === "killSwitches" ? { value: { aiDisabledOrgIds: killList } } : null,
    },
    orgLlmConfig: { findUnique: async () => null },
    aIUsageRecord: { create: async ({ data }: any) => { usage.push(data); return data; } },
  };
  return { prisma, usage };
}

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: async () => body } as any;
}

describe("EmbeddingsService (SA-B2)", () => {
  const ENV_KEYS = ["LLM_PROVIDER", "LLM_API_KEY", "LLM_MODEL", "LLM_EMBEDDING_MODEL"];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it("openai: embeds via the embeddings endpoint with the default embedding model (not the chat model)", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "sk-test";
    process.env.LLM_MODEL = "gpt-4o-mini"; // chat model — must NOT be used for embeddings
    const { prisma, usage } = fakePrisma();
    const svc = new EmbeddingsService(prisma as any);
    let seenUrl = ""; let seenBody: any = null; let seenAuth = "";
    svc.fetchFn = (async (url: any, init: any) => {
      seenUrl = String(url); seenBody = JSON.parse(init.body); seenAuth = init.headers.Authorization;
      return jsonResponse({
        data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
        usage: { prompt_tokens: 42 },
      });
    }) as any;
    const res = await svc.embed(ORG, ["hello", "world"]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(seenUrl).toBe("https://api.openai.com/v1/embeddings");
      expect(seenAuth).toBe("Bearer sk-test");
      expect(seenBody.model).toBe("text-embedding-3-small");
      expect(seenBody.input).toEqual(["hello", "world"]);
      // Response rows are re-ordered by index into input order.
      expect(res.vectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);
      expect(res.dimension).toBe(2);
      expect(res.inputTokens).toBe(42);
      expect(res.tokensEstimated).toBe(false);
    }
    expect(usage).toEqual([
      { organizationId: ORG, feature: "embedding", provider: "openai", model: "text-embedding-3-small", inputTokens: 42, outputTokens: 0, estimated: false },
    ]);
  });

  it("LLM_EMBEDDING_MODEL overrides the provider default", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "sk-test";
    process.env.LLM_EMBEDDING_MODEL = "text-embedding-3-large";
    const { prisma } = fakePrisma();
    const svc = new EmbeddingsService(prisma as any);
    let seenBody: any = null;
    svc.fetchFn = (async (_url: any, init: any) => {
      seenBody = JSON.parse(init.body);
      return jsonResponse({ data: [{ index: 0, embedding: [1] }], usage: { prompt_tokens: 1 } });
    }) as any;
    const res = await svc.embed(ORG, ["x"]);
    expect(res.ok).toBe(true);
    expect(seenBody.model).toBe("text-embedding-3-large");
  });

  it("gemini: batchEmbedContents with outputDimensionality 1536; usage recorded as a labelled estimate", async () => {
    process.env.LLM_PROVIDER = "gemini";
    process.env.LLM_API_KEY = "gm-test";
    const { prisma, usage } = fakePrisma();
    const svc = new EmbeddingsService(prisma as any);
    let seenUrl = ""; let seenBody: any = null;
    svc.fetchFn = (async (url: any, init: any) => {
      seenUrl = String(url); seenBody = JSON.parse(init.body);
      expect(init.headers["x-goog-api-key"]).toBe("gm-test");
      return jsonResponse({ embeddings: [{ values: [0.5, 0.6] }, { values: [0.7, 0.8] }] });
    }) as any;
    const res = await svc.embed(ORG, ["একটি বাক্য", "another"]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(seenUrl).toContain("/models/gemini-embedding-001:batchEmbedContents");
      expect(seenBody.requests).toHaveLength(2);
      expect(seenBody.requests[0].outputDimensionality).toBe(1536);
      expect(seenBody.requests[0].model).toBe("models/gemini-embedding-001");
      expect(res.vectors).toEqual([[0.5, 0.6], [0.7, 0.8]]);
      expect(res.tokensEstimated).toBe(true);
    }
    expect(usage[0].feature).toBe("embedding");
    expect(usage[0].estimated).toBe(true);
    expect(usage[0].inputTokens).toBeGreaterThan(0);
  });

  it("anthropic: typed unavailable — no fetch, no fabricated vector", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_API_KEY = "an-test";
    const { prisma, usage } = fakePrisma();
    const svc = new EmbeddingsService(prisma as any);
    let fetched = false;
    svc.fetchFn = (async () => { fetched = true; return jsonResponse({}); }) as any;
    const res = await svc.embed(ORG, ["hello"]);
    expect(res).toEqual({ ok: false, reason: "provider_has_no_embeddings_api" });
    expect(fetched).toBe(false);
    expect(usage).toEqual([]);
  });

  it("no real provider configured (dev/none): typed unavailable", async () => {
    const { prisma } = fakePrisma();
    const svc = new EmbeddingsService(prisma as any);
    const res = await svc.embed(ORG, ["hello"]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no_real_llm_provider");
  });

  it("kill switch: an org on aiDisabledOrgIds is refused before any provider work", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "sk-test";
    const { prisma } = fakePrisma([ORG]);
    const svc = new EmbeddingsService(prisma as any);
    let fetched = false;
    svc.fetchFn = (async () => { fetched = true; return jsonResponse({}); }) as any;
    const res = await svc.embed(ORG, ["hello"]);
    expect(res).toEqual({ ok: false, reason: "ai_disabled_for_org" });
    expect(fetched).toBe(false);
    // Another org is unaffected.
    const other = await svc.resolveConfig("org-other");
    expect(other.ok).toBe(true);
  });

  it("provider HTTP failure degrades to a typed result (never throws)", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "sk-test";
    const { prisma } = fakePrisma();
    const svc = new EmbeddingsService(prisma as any);
    svc.fetchFn = (async () => jsonResponse({ error: { message: "quota" } }, false, 429)) as any;
    const res = await svc.embed(ORG, ["hello"]);
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.reason).toBe("request_failed"); expect(res.detail).toContain("429"); }
  });
});
