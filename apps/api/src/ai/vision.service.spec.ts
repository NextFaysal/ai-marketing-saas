import { VisionService } from "./vision.service";
import { OpenAiProvider } from "./llm/openai.provider";
import { GeminiProvider } from "./llm/gemini.provider";
import { AnthropicProvider } from "./llm/anthropic.provider";
import { DevTemplateProvider } from "./llm/dev.provider";
import { LlmConfigError } from "./llm/llm.types";

/**
 * CX8 VisionService — provider HTTP is FAKED at each provider's
 * fetch seam (the providers.spec.ts pattern). No real vision read
 * is claimed anywhere in this suite.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "gte" in (v as any)) {
      return new Date(row[k]) >= (v as any).gte;
    }
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
  };
}

function fakePrisma() {
  return {
    aIUsageRecord: makeTable("usage"),
    systemSetting: makeTable("setting"),
    organization: makeTable("org"),
    subscription: makeTable("sub"),
  } as any;
}

const JPEG = { imageBytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), mimeType: "image/jpeg" };

function svcWith(prisma: any, provider: any) {
  return new VisionService(prisma, { getProvider: () => provider } as any);
}

describe("VisionService — provider routing (faked HTTP)", () => {
  it("OpenAI: sends an image_url data-URI part, returns text, writes usage with the caller's feature", async () => {
    const prisma = fakePrisma();
    let sentBody: any = null; let sentUrl = "";
    const fetchFn = async (url: string, init: any) => {
      sentUrl = url; sentBody = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ model: "gpt-4o-mini", choices: [{ message: { content: "{\"trackingCode\":\"TRK-9\"}" } }], usage: { prompt_tokens: 120, completion_tokens: 9 } }) } as any;
    };
    const svc = svcWith(prisma, new OpenAiProvider("sk-test", undefined, fetchFn as any));
    const out: any = await svc.analyzeImage("org-1", "user-1", { ...JPEG, prompt: "read the label", feature: "vision_label_scan" });
    expect(out.available).toBe(true);
    expect(out.text).toContain("TRK-9");
    expect(out.provider).toBe("openai");
    expect(sentUrl).toBe("https://api.openai.com/v1/chat/completions");
    const parts = sentBody.messages[0].content;
    expect(parts[0]).toEqual({ type: "text", text: "read the label" });
    expect(parts[1].type).toBe("image_url");
    expect(parts[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    const row = prisma.aIUsageRecord.rows[0];
    expect(row.feature).toBe("vision_label_scan");
    expect(row.provider).toBe("openai");
    expect(row.model).toBe("gpt-4o-mini");
    expect(row.inputTokens).toBe(120);
    expect(row.outputTokens).toBe(9);
    expect(row.estimated).toBe(false);
    expect(row.organizationId).toBe("org-1");
    expect(row.userId).toBe("user-1");
  });

  it("Gemini: sends an inlineData part to generateContent, writes usage under vision_product_match", async () => {
    const prisma = fakePrisma();
    let sentBody: any = null; let sentUrl = "";
    const fetchFn = async (url: string, init: any) => {
      sentUrl = url; sentBody = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "{\"category\":\"clothing\"}" }] } }], usageMetadata: { promptTokenCount: 88, candidatesTokenCount: 7 } }) } as any;
    };
    const svc = svcWith(prisma, new GeminiProvider("g-test", undefined, fetchFn as any));
    const out: any = await svc.analyzeImage("org-1", "user-1", { ...JPEG, prompt: "describe it", feature: "vision_product_match" });
    expect(out.available).toBe(true);
    expect(out.text).toContain("clothing");
    expect(sentUrl).toContain("/models/gemini-flash-latest:generateContent");
    const parts = sentBody.contents[0].parts;
    expect(parts[0]).toEqual({ text: "describe it" });
    expect(parts[1].inlineData.mimeType).toBe("image/jpeg");
    expect(typeof parts[1].inlineData.data).toBe("string");
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    expect(prisma.aIUsageRecord.rows[0].feature).toBe("vision_product_match");
    expect(prisma.aIUsageRecord.rows[0].provider).toBe("gemini");
    expect(prisma.aIUsageRecord.rows[0].inputTokens).toBe(88);
  });

  it("Anthropic: sends a base64 image block before the text block", async () => {
    const prisma = fakePrisma();
    let sentBody: any = null;
    const fetchFn = async (_url: string, init: any) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ model: "claude-x", content: [{ type: "text", text: "seen" }], usage: { input_tokens: 50, output_tokens: 4 } }) } as any;
    };
    const svc = svcWith(prisma, new AnthropicProvider("key", undefined, fetchFn as any));
    const out: any = await svc.analyzeImage("org-1", "user-1", { ...JPEG, prompt: "p", feature: "vision_label_scan" });
    expect(out.available).toBe(true);
    expect(out.text).toBe("seen");
    const content = sentBody.messages[0].content;
    expect(content[0].type).toBe("image");
    expect(content[0].source).toMatchObject({ type: "base64", media_type: "image/jpeg" });
    expect(content[1]).toEqual({ type: "text", text: "p" });
    expect(prisma.aIUsageRecord.rows[0].provider).toBe("anthropic");
  });
});

describe("VisionService — unavailable shapes (never throws, never fabricates)", () => {
  it("dev-template provider → available:false, no usage row", async () => {
    const prisma = fakePrisma();
    const svc = svcWith(prisma, new DevTemplateProvider());
    const out: any = await svc.analyzeImage("org-1", "user-1", { ...JPEG, prompt: "p", feature: "vision_label_scan" });
    expect(out.available).toBe(false);
    expect(out.reason).toContain("dev-template");
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
  });

  it("factory throwing a config error (real provider, no key) → available:false with the reason", async () => {
    const prisma = fakePrisma();
    const svc = new VisionService(prisma, { getProvider: () => { throw new LlmConfigError("LLM_API_KEY is required for the OpenAI provider"); } } as any);
    const out: any = await svc.analyzeImage("org-1", "user-1", { ...JPEG, prompt: "p", feature: "vision_product_match" });
    expect(out.available).toBe(false);
    expect(out.reason).toContain("LLM_API_KEY is required");
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
  });

  it("a real provider without completeVision → available:false naming the provider", async () => {
    const prisma = fakePrisma();
    const noVision = { name: "some-text-only", isRealLlm: true, complete: async () => ({ text: "", model: "m", inputTokens: 0, outputTokens: 0, tokensEstimated: false }) };
    const svc = svcWith(prisma, noVision);
    const out: any = await svc.analyzeImage("org-1", "user-1", { ...JPEG, prompt: "p", feature: "vision_label_scan" });
    expect(out.available).toBe(false);
    expect(out.reason).toContain("some-text-only");
  });

  it("unsupported mime type → available:false before any provider call", async () => {
    const prisma = fakePrisma();
    let calls = 0;
    const provider = { name: "openai", isRealLlm: true, complete: async () => ({}), completeVision: async () => { calls++; return { text: "x", model: "m", inputTokens: 1, outputTokens: 1, tokensEstimated: false }; } };
    const svc = svcWith(prisma, provider);
    const out: any = await svc.analyzeImage("org-1", "user-1", { imageBytes: Buffer.from([1]), mimeType: "image/gif", prompt: "p", feature: "vision_label_scan" });
    expect(out.available).toBe(false);
    expect(calls).toBe(0);
  });
});

describe("VisionService — enforcement BEFORE provider HTTP (creative-studio discipline)", () => {
  it("kill switch blocks with 403 and zero provider calls", async () => {
    const prisma = fakePrisma();
    prisma.systemSetting.rows.push({ key: "killSwitches", value: { aiDisabledOrgIds: ["org-1"] } });
    let calls = 0;
    const provider = { name: "openai", isRealLlm: true, complete: async () => ({}), completeVision: async () => { calls++; return { text: "x", model: "m", inputTokens: 1, outputTokens: 1, tokensEstimated: false }; } };
    const svc = svcWith(prisma, provider);
    let caught: any = null;
    try { await svc.analyzeImage("org-1", "user-1", { ...JPEG, prompt: "p", feature: "vision_label_scan" }); } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(caught.getStatus()).toBe(403);
    expect(calls).toBe(0);
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
  });

  it("daily cap for the SAME feature blocks with 429; a different feature's usage does not block", async () => {
    const prisma = fakePrisma();
    prisma.organization.rows.push({ id: "org-1", aiDailyLimitOverride: 1, broadcastCapOverride: null, seatLimit: null });
    prisma.aIUsageRecord.rows.push({ id: "u1", organizationId: "org-1", userId: "user-1", feature: "creative_studio", provider: "gemini", createdAt: new Date() });
    let calls = 0;
    const provider = { name: "gemini", isRealLlm: true, complete: async () => ({}), completeVision: async () => { calls++; return { text: "x", model: "m", inputTokens: 1, outputTokens: 1, tokensEstimated: false }; } };
    const svc = svcWith(prisma, provider);
    // creative_studio usage must NOT count against vision_label_scan
    const ok: any = await svc.analyzeImage("org-1", "user-1", { ...JPEG, prompt: "p", feature: "vision_label_scan" });
    expect(ok.available).toBe(true);
    expect(calls).toBe(1);
    // now the vision_label_scan cap (1) is used up — the next call blocks
    let caught: any = null;
    try { await svc.analyzeImage("org-1", "user-1", { ...JPEG, prompt: "p", feature: "vision_label_scan" }); } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(caught.getStatus()).toBe(429);
    expect(calls).toBe(1);
  });

  it("a provider HTTP failure propagates verbatim and writes NO usage", async () => {
    const prisma = fakePrisma();
    const fetchFn = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "bad key" } }) }) as any;
    const svc = svcWith(prisma, new OpenAiProvider("sk-test", undefined, fetchFn as any));
    await expect(svc.analyzeImage("org-1", "user-1", { ...JPEG, prompt: "p", feature: "vision_label_scan" }))
      .rejects.toThrow("OpenAI request failed (401): bad key");
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
  });
});
