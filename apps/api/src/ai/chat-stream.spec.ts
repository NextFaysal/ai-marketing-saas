import { ChatService, buildToolCallsSummary, tagsFromMessages, titleFromContent } from "./chat.service";
import { DevTemplateProvider } from "./llm/dev.provider";

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "gte" in (v as any)) return new Date(row[k]) >= (v as any).gte;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "in" in (v as any)) return (v as any).in.includes(row[k]);
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `id-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); const [row] = rows.splice(i, 1); return row; },
    deleteMany: async ({ where }: any = {}) => { const hit = rows.filter((r) => matches(r, where ?? {})); for (const r of hit) rows.splice(rows.indexOf(r), 1); return { count: hit.length }; },
  };
}
function fakePrisma(opts: { killOrgIds?: string[] } = {}) {
  return {
    aIConversation: makeTable(), aIMessage: makeTable(), aIAction: makeTable(), aIUsageRecord: makeTable(),
    businessProfile: { findUnique: async () => null },
    systemSetting: {
      findUnique: async ({ where }: any) => where.key === "killSwitches" && opts.killOrgIds
        ? { key: "killSwitches", value: { aiDisabledOrgIds: opts.killOrgIds } }
        : null,
    },
  };
}
const toolsStub = {
  execute: async (_orgId: string, call: any) => {
    if (call.tool === "get_analytics_overview") {
      return { range: { from: "2026-10-03", to: "2026-10-09" }, orders: 42, revenue: "BDT 84000.00", adSpend: "BDT 12000.00", mer: 7, contributionProfit: "BDT 31000.00", contributionMarginPercent: 36.9, cogsCoveragePercent: 90 };
    }
    return {};
  },
} as any;

const PLAN_JSON = JSON.stringify({ calls: [{ tool: "get_analytics_overview", args: {} }] });
function streamingProvider() {
  return {
    name: "fake-real", isRealLlm: true,
    complete: async (_msgs: any, opts: any) => opts?.jsonMode
      ? { text: PLAN_JSON, model: "m", inputTokens: 3, outputTokens: 2, tokensEstimated: false }
      : { text: "unused", model: "m", inputTokens: 0, outputTokens: 0, tokensEstimated: false },
    completeStream: async function* () {
      yield { delta: "Hello " };
      yield { delta: "world" };
      yield { result: { text: "Hello world", model: "m", inputTokens: 10, outputTokens: 5, tokensEstimated: false } };
    },
  } as any;
}
async function collect(gen: AsyncGenerator<any>) {
  const events: any[] = [];
  for await (const e of gen) events.push(e);
  return events;
}
function makeChat(prisma: any, provider: any) {
  return new ChatService(prisma as any, { getProvider: () => provider } as any, toolsStub);
}

describe("ChatService.sendMessageStream (AP1)", () => {
  it("emits step → delta → done in order, persists once, records usage once, stores the A2 display payload", async () => {
    const prisma = fakePrisma();
    const chat = makeChat(prisma, streamingProvider());
    const conv = await chat.createConversation("org-1", "user-1");
    const events = await collect(chat.sendMessageStream("org-1", "user-1", conv.id, "How were sales?"));
    expect(events.map((e) => e.type)).toEqual(["step", "step", "delta", "delta", "done"]);
    expect(events[0]).toMatchObject({ phase: "planning" });
    expect(events[1]).toMatchObject({ phase: "tool", tool: "get_analytics_overview" });
    expect(events.filter((e) => e.type === "delta").map((e) => e.text).join("")).toBe("Hello world");
    const done = events[events.length - 1];
    const assistants = prisma.aIMessage.rows.filter((m: any) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(done.messageId).toBe(assistants[0].id);
    expect(assistants[0].content).toBe("Hello world");
    expect(assistants[0].toolCalls[0]).toMatchObject({ tool: "get_analytics_overview", status: "success" });
    expect(assistants[0].toolCalls[0].display).toMatchObject({ orders: 42 });
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    expect(prisma.aIUsageRecord.rows[0]).toMatchObject({ inputTokens: 13, outputTokens: 7, estimated: false });
    expect(Array.isArray(done.suggestions)).toBe(true);
    expect(done.usage).toEqual({ inputTokens: 13, outputTokens: 7, estimated: false });
    // Dev-mode badge parity on the stream path: done carries the provider identity.
    expect(done.provider).toBe("fake-real");
    expect(done.isRealLlm).toBe(true);
  });

  it("falls back to one complete() + a single delta when the provider has no completeStream", async () => {
    const prisma = fakePrisma();
    const provider = {
      name: "fake-real", isRealLlm: true,
      complete: async (_msgs: any, opts: any) => opts?.jsonMode
        ? { text: PLAN_JSON, model: "m", inputTokens: 3, outputTokens: 2, tokensEstimated: false }
        : { text: "One shot", model: "m", inputTokens: 4, outputTokens: 6, tokensEstimated: false },
    } as any;
    const chat = makeChat(prisma, provider);
    const conv = await chat.createConversation("org-1", "user-1");
    const events = await collect(chat.sendMessageStream("org-1", "user-1", conv.id, "How were sales?"));
    expect(events.filter((e) => e.type === "delta").map((e) => e.text)).toEqual(["One shot"]);
    expect(events[events.length - 1].type).toBe("done");
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    expect(prisma.aIMessage.rows.filter((m: any) => m.role === "assistant")).toHaveLength(1);
  });

  it("dev provider path streams the chunked template answer with estimated usage", async () => {
    const prisma = fakePrisma();
    const chat = makeChat(prisma, new DevTemplateProvider());
    const conv = await chat.createConversation("org-1", "user-1");
    const events = await collect(chat.sendMessageStream("org-1", "user-1", conv.id, "গত সপ্তাহে বিক্রি কেমন ছিল?"));
    const deltas = events.filter((e) => e.type === "delta").map((e) => e.text);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toContain("84000");
    expect(events[events.length - 1].type).toBe("done");
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    expect(prisma.aIUsageRecord.rows[0].estimated).toBe(true);
  });

  it("daily cap parity: the generator throws 429 before its first yield and saves nothing", async () => {
    const prisma = fakePrisma();
    const chat = makeChat(prisma, streamingProvider());
    const conv = await chat.createConversation("org-1", "user-1");
    for (let i = 0; i < 20; i++) await prisma.aIUsageRecord.create({ data: { organizationId: "org-1", userId: "user-1", feature: "chat" } });
    const gen = chat.sendMessageStream("org-1", "user-1", conv.id, "How were sales?");
    let err: any = null;
    try { await gen.next(); } catch (e) { err = e; }
    expect(err).toBeTruthy();
    expect(err.getStatus?.() ?? err.status).toBe(429);
    expect(prisma.aIMessage.rows).toHaveLength(0);
  });

  it("kill-switch parity: the generator throws 403 before its first yield", async () => {
    const prisma = fakePrisma({ killOrgIds: ["org-1"] });
    const chat = makeChat(prisma, streamingProvider());
    const conv = await chat.createConversation("org-1", "user-1");
    const gen = chat.sendMessageStream("org-1", "user-1", conv.id, "How were sales?");
    let err: any = null;
    try { await gen.next(); } catch (e) { err = e; }
    expect(err).toBeTruthy();
    expect(err.getStatus?.() ?? err.status).toBe(403);
    expect(prisma.aIMessage.rows).toHaveLength(0);
  });

  it("provider compose error becomes a terminal error event (verbatim) and persists no answer / no usage", async () => {
    const prisma = fakePrisma();
    const provider = streamingProvider();
    provider.completeStream = async function* () { throw new Error("OpenAI request failed (401): bad key"); };
    const chat = makeChat(prisma, provider);
    const conv = await chat.createConversation("org-1", "user-1");
    const events = await collect(chat.sendMessageStream("org-1", "user-1", conv.id, "How were sales?"));
    expect(events.map((e) => e.type)).toEqual(["step", "step", "error"]);
    expect(events[events.length - 1].message).toBe("OpenAI request failed (401): bad key");
    expect(prisma.aIMessage.rows.filter((m: any) => m.role === "assistant")).toHaveLength(0);
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
  });

  it("abort: a non-empty partial is persisted once with the __stopped marker and one estimated usage record", async () => {
    const prisma = fakePrisma();
    const chat = makeChat(prisma, streamingProvider());
    const conv = await chat.createConversation("org-1", "user-1");
    const gen = chat.sendMessageStream("org-1", "user-1", conv.id, "How were sales?");
    expect((await gen.next()).value).toMatchObject({ type: "step", phase: "planning" });
    expect((await gen.next()).value).toMatchObject({ type: "step", phase: "tool" });
    expect((await gen.next()).value).toEqual({ type: "delta", text: "Hello " });
    await gen.return(undefined as any);
    const assistants = prisma.aIMessage.rows.filter((m: any) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].content).toBe("Hello ");
    const summary = assistants[0].toolCalls;
    expect(summary[summary.length - 1]).toEqual({ tool: "__stopped", status: "stopped" });
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    expect(prisma.aIUsageRecord.rows[0].estimated).toBe(true);
  });

  it("abort with an empty partial persists nothing", async () => {
    const prisma = fakePrisma();
    const chat = makeChat(prisma, streamingProvider());
    const conv = await chat.createConversation("org-1", "user-1");
    const gen = chat.sendMessageStream("org-1", "user-1", conv.id, "How were sales?");
    await gen.next(); // planning step only — no delta yet
    await gen.return(undefined as any);
    expect(prisma.aIMessage.rows.filter((m: any) => m.role === "assistant")).toHaveLength(0);
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
  });
});

describe("AP1 A2/A3 helpers", () => {
  it("buildToolCallsSummary adds a capped display only on success", () => {
    const big = { items: Array.from({ length: 25 }, (_, i) => i), note: "x".repeat(500) };
    const [ok, bad] = buildToolCallsSummary([
      { tool: "t1", args: {}, status: "success", result: big },
      { tool: "t2", args: {}, status: "error" },
    ]);
    expect((ok.display as any).items).toHaveLength(10);
    expect((ok.display as any).note.length).toBeLessThanOrEqual(241);
    expect(bad).toEqual({ tool: "t2", args: {}, status: "error" });
    expect(JSON.stringify(ok.display).length).toBeLessThanOrEqual(3000);
  });

  it("titleFromContent cuts at a word boundary, strips punctuation, hard-cuts without spaces", () => {
    expect(titleFromContent("short title")).toBe("short title");
    expect(titleFromContent("a ".repeat(40))).toBe("a ".repeat(29) + "a");
    expect(titleFromContent("hello world! " + "y".repeat(60))).toBe("hello world");
    expect(titleFromContent("x".repeat(100))).toBe("x".repeat(60));
  });

  it("tagsFromMessages maps tools via the fixed map, skips __ markers, caps at 3", () => {
    const tags = tagsFromMessages([
      { toolCalls: [{ tool: "get_analytics_overview" }, { tool: "__stopped" }, { tool: "get_campaign_performance" }] },
      { toolCalls: [{ tool: "get_analytics_overview" }, { tool: "get_courier_performance" }, { tool: "get_anomalies" }, { tool: "compare_periods" }] },
    ]);
    expect(tags).toEqual(["বিক্রি", "বিজ্ঞাপন", "কুরিয়ার"]);
  });

  it("listConversations carries computed tags, and export hides the __stopped marker but notes the stop", async () => {
    const prisma = fakePrisma();
    const chat = makeChat(prisma, streamingProvider());
    const conv = await chat.createConversation("org-1", "user-1");
    const gen = chat.sendMessageStream("org-1", "user-1", conv.id, "How were sales?");
    await gen.next(); await gen.next();
    await gen.next(); // first delta
    await gen.return(undefined as any);
    const list = await chat.listConversations("org-1", "user-1");
    expect(list[0].tags).toEqual(["বিক্রি"]);
    const md: any = await chat.exportConversation("org-1", "user-1", conv.id, "markdown");
    expect(md.content).toContain("(থামানো হয়েছে)");
    expect(md.content).not.toContain("__stopped");
    const json: any = await chat.exportConversation("org-1", "user-1", conv.id, "json");
    const parsed = JSON.parse(json.content);
    const assistant = parsed.messages.find((m: any) => m.role === "assistant");
    expect(assistant.stopped).toBe(true);
    expect(assistant.toolCalls.some((t: any) => String(t.tool).startsWith("__"))).toBe(false);
  });
});
