import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { InboxService } from "./inbox.service";
import { AiInstructionsService } from "./ai-instructions.service";
import { detectReplyLanguage, parseNextActionProposal, parseUnansweredDraft } from "./in7-ai";

/**
 * IN7 — AI next steps.
 *
 * - IN7a handover summary: take-over / reassign writes an AI
 *   one-paragraph summary as a SYSTEM-labeled internal note;
 *   the number-guard discards invented-number summaries (honest
 *   "not created" note instead); failure never fails the
 *   handover; dev provider + kill switch behave honestly.
 * - IN7b/c next-action: structured proposal from a closed
 *   allowlist; the endpoint sends NOTHING and writes NOTHING —
 *   proposals land only when a human applies them elsewhere.
 * - IN7d language match: deterministic script-ratio detector;
 *   the owner's replyLanguage override always wins.
 * - IN7e unanswered draft: display-only proposal; knowledge /
 *   draft / publish state provably untouched.
 * - AI discipline: kill switch 403 + per-feature daily cap 429
 *   for handover_summary / next_action / unanswered_draft, and
 *   an AIUsageRecord per LLM call.
 *
 * Fake prisma only — no live DB, no live send anywhere.
 */
type Row = Record<string, any>;

function match(row: Row, where: any = {}): boolean {
  return Object.entries(where ?? {}).every(([k, raw]) => {
    const v = raw as any;
    if (k === "OR") return (v as any[]).some((sub) => match(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => match(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("has" in v) return Array.isArray(row[k]) && row[k].includes(v.has);
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      return true;
    }
    return row[k] === v;
  });
}
function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
  let out = [...rows];
  for (const e of [...entries].reverse()) {
    const [key, dir] = Object.entries(e)[0] as [string, string];
    out = out.sort((a, b) => {
      const av = a[key] instanceof Date ? new Date(a[key]).getTime() : a[key];
      const bv = b[key] instanceof Date ? new Date(b[key]).getTime() : b[key];
      const cmp = (av ?? 0) < (bv ?? 0) ? -1 : (av ?? 0) > (bv ?? 0) ? 1 : 0;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  return out;
}
function table(store: Row[]) {
  return {
    rows: store,
    findMany: jest.fn(async ({ where, take, orderBy }: any = {}) => {
      const rows = sortRows(store.filter((r) => match(r, where)), orderBy);
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: any = {}) => sortRows(store.filter((r) => match(r, where)), orderBy)[0] ?? null),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => { const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), ...data }; store.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => { const row = store.find((r) => r.id === where.id || match(r, where)); if (!row) throw new Error("nf"); Object.assign(row, data); return row; }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
  };
}

const ORG = "org-1";

function setup(opts: { llmText?: string | ((msgs: any[]) => string); realLlm?: boolean; killOrg?: boolean; usageSeed?: Row[]; replyLanguage?: string | null } = {}) {
  const conversations: Row[] = [];
  const messages: Row[] = [];
  const notes: Row[] = [];
  const usage: Row[] = [...(opts.usageSeed ?? [])];
  const profile: Row = { id: "prof-1", organizationId: ORG, aiInstructions: "ভদ্রভাবে উত্তর দিন।", aiInstructionsDraft: null, aiReplyLanguage: opts.replyLanguage ?? null };
  const db = {
    channelConversation: table(conversations),
    channelMessage: table(messages),
    conversationNote: table(notes),
    messageDraft: table([] as Row[]),
    product: table([{ id: "p1", organizationId: ORG, status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", stockQuantity: 12 }] as Row[]),
    order: table([] as Row[]),
    businessPolicy: table([] as Row[]),
    businessProfile: table([profile]),
    knowledgeDocument: table([] as Row[]),
    aiUnansweredQuestion: table([] as Row[]),
    aiInstructionVersion: table([] as Row[]),
    aIUsageRecord: table(usage),
    agentNotification: table([] as Row[]),
    organization: table([{ id: ORG, name: "টেস্ট শপ" }] as Row[]),
    subscription: table([] as Row[]), // no row -> FREE plan (aiDaily 20)
    systemSetting: table(opts.killOrg ? [{ id: "set-1", key: "killSwitches", value: { aiDisabledOrgIds: [ORG], broadcastsPaused: false } }] as Row[] : [] as Row[]),
    membership: table([
      { id: "m1", organizationId: ORG, userId: "owner", role: "OWNER" },
      { id: "m2", organizationId: ORG, userId: "agent-1", role: "SUPPORT_AGENT" },
      { id: "m3", organizationId: ORG, userId: "agent-2", role: "SUPPORT_AGENT" },
    ] as Row[]),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const prompts: any[] = [];
  const provider = {
    name: "fake-llm",
    isRealLlm: opts.realLlm ?? true,
    complete: jest.fn(async (msgs: any[]) => {
      prompts.push(msgs);
      const text = typeof opts.llmText === "function" ? opts.llmText(msgs) : (opts.llmText ?? "");
      return { text, inputTokens: 10, outputTokens: 5, tokensEstimated: false };
    }),
  };
  const llm = { getProvider: () => provider };
  const service = new InboxService(db as any, audit as any, llm as any);
  const desk = new AiInstructionsService(db as any, audit as any, service as any, llm as any);
  return { service, desk, db, audit, provider, prompts, conversations, messages, notes, usage, profile };
}

function conv(over: Row = {}): Row {
  return {
    id: `c-${Math.random().toString(36).slice(2, 8)}`, organizationId: ORG, channel: "whatsapp", status: "open",
    assignedUserId: null, autoReplyPaused: false, customerId: null, contactName: "রহিম", tags: [], pipelineStage: "new",
    unreadCount: 0, createdAt: new Date(), updatedAt: new Date(), lastMessageAt: new Date(), ...over,
  };
}
function thread(c: Row, s: ReturnType<typeof setup>) {
  s.messages.push(
    { id: "mm1", conversationId: c.id, direction: "in", type: "text", content: "আমি Cotton Panjabi কিনতে চাই", status: "received", createdAt: new Date(Date.now() - 120000) },
    { id: "mm2", conversationId: c.id, direction: "out", type: "text", content: "দাম ১৫০০ টাকা, স্টক আছে।", status: "sent", createdAt: new Date(Date.now() - 60000) },
    { id: "mm3", conversationId: c.id, direction: "in", type: "text", content: "ঠিক আছে, অর্ডার করব", status: "received", createdAt: new Date(Date.now() - 30000) },
  );
}

describe("IN7d detector (pure)", () => {
  it("Bengali script -> bn, English -> en, real mix -> mixed, no letters -> null", () => {
    expect(detectReplyLanguage("আপনার দোকান কোথায়?")).toBe("bn");
    expect(detectReplyLanguage("What is the price?")).toBe("en");
    expect(detectReplyLanguage("দাম কত ভাই, price please")).toBe("mixed");
    expect(detectReplyLanguage("১২৩৪ !!!")).toBeNull();
    expect(detectReplyLanguage("")).toBeNull();
  });
});

describe("IN7d compose: auto language, override wins", () => {
  it("no override: a Bengali customer message adds the Bengali instruction to the LLM prompt", async () => {
    const s = setup({ llmText: "Cotton Panjabi-এর দাম ১৫০০ টাকা।" });
    const c = conv(); s.conversations.push(c);
    const out = await (s.service as any).composeLlmGroundedReply(ORG, c, "price", "Cotton Panjabi এর দাম কত? আর কি কি সাইজ আছে?");
    expect(out?.content).toContain("১৫০০");
    const system = s.prompts[0][0].content as string;
    expect(system).toContain("Always reply in Bengali (the customer's last message is mainly in Bengali)");
  });

  it("owner override (en) wins over a Bengali customer message — detected line absent", async () => {
    const s = setup({ llmText: "The price is 1500 taka.", replyLanguage: "en" });
    const c = conv(); s.conversations.push(c);
    const out = await (s.service as any).composeLlmGroundedReply(ORG, c, "price", "Cotton Panjabi এর দাম কত? আর কি কি সাইজ আছে?");
    expect(out).toBeTruthy();
    const system = s.prompts[0][0].content as string;
    expect(system).toContain("Always reply in English.");
    expect(system).not.toContain("mainly in Bengali");
  });
});

describe("IN7a handover summary", () => {
  it("take-over writes a system-labeled summary note + usage; takeover itself succeeds", async () => {
    const s = setup({ llmText: "গ্রাহক Cotton Panjabi কিনতে চান; দাম ১৫০০ টাকা জানানো হয়েছে, তিনি অর্ডার করতে রাজি।" });
    const c = conv(); s.conversations.push(c); thread(c, s);
    const updated: any = await s.service.takeOverConversation(ORG, "agent-1", c.id);
    expect(updated.assignedUserId).toBe("agent-1");
    expect(updated.handoverSummary).toEqual({ attempted: true, created: true });
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0].content).toContain("🤖 AI হ্যান্ডওভার সারসংক্ষেপ (সিস্টেম নোট)");
    expect(s.notes[0].content).toContain("Cotton Panjabi");
    expect(s.usage.filter((u) => u.feature === "handover_summary")).toHaveLength(1);
  });

  it("number-guard: an invented number discards the summary — honest note, takeover still succeeds", async () => {
    const s = setup({ llmText: "গ্রাহকের অর্ডার নম্বর ৫৫৫ কনফার্ম হয়েছে।" });
    const c = conv(); s.conversations.push(c); thread(c, s);
    const updated: any = await s.service.takeOverConversation(ORG, "agent-1", c.id);
    expect(updated.assignedUserId).toBe("agent-1");
    expect(updated.handoverSummary.created).toBe(false);
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0].content).toContain("সারসংক্ষেপ তৈরি হয়নি");
    expect(s.notes[0].content).toContain("সংখ্যা যাচাই হয়নি");
    expect(s.notes[0].content).not.toContain("৫৫৫");
    expect(s.audit.calls.some((a) => a.action === "inbox.handover_summary.guard_rejected")).toBe(true);
    // The LLM call still consumed quota — usage recorded.
    expect(s.usage.filter((u) => u.feature === "handover_summary")).toHaveLength(1);
  });

  it("reassign via updateConversation triggers the summary; a non-assign update does not", async () => {
    const s = setup({ llmText: "গ্রাহক Cotton Panjabi কিনতে চান; দাম ১৫০০ টাকা জানানো হয়েছে।" });
    const c = conv({ assignedUserId: "agent-1" }); s.conversations.push(c); thread(c, s);
    const reassigned: any = await s.service.updateConversation(ORG, "owner", c.id, { assignedUserId: "agent-2" });
    expect(reassigned.assignedUserId).toBe("agent-2");
    expect(reassigned.handoverSummary).toEqual({ attempted: true, created: true });
    expect(s.notes).toHaveLength(1);
    const other: any = await s.service.updateConversation(ORG, "owner", c.id, { status: "pending" });
    expect(other.handoverSummary).toBeUndefined();
    expect(s.notes).toHaveLength(1); // unchanged
  });

  it("dev provider: honest 'not created' note, no usage row, takeover succeeds", async () => {
    const s = setup({ realLlm: false });
    const c = conv(); s.conversations.push(c); thread(c, s);
    const updated: any = await s.service.takeOverConversation(ORG, "agent-1", c.id);
    expect(updated.assignedUserId).toBe("agent-1");
    expect(updated.handoverSummary.created).toBe(false);
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0].content).toContain("সারসংক্ষেপ তৈরি হয়নি");
    expect(s.usage).toHaveLength(0);
  });

  it("kill switch: takeover succeeds, summary not attempted, no note, no usage", async () => {
    const s = setup({ killOrg: true, llmText: "যেকোনো সারসংক্ষেপ" });
    const c = conv(); s.conversations.push(c); thread(c, s);
    const updated: any = await s.service.takeOverConversation(ORG, "agent-1", c.id);
    expect(updated.assignedUserId).toBe("agent-1");
    expect(updated.handoverSummary.attempted).toBe(false);
    expect(s.notes).toHaveLength(0);
    expect(s.usage).toHaveLength(0);
    expect(s.provider.complete).not.toHaveBeenCalled();
  });
});

describe("IN7b/c next-action proposal", () => {
  it("returns a structured proposal and sends/writes NOTHING", async () => {
    const s = setup({ llmText: JSON.stringify({ action: "create_order", reason: "গ্রাহক অর্ডার করতে রাজি হয়েছেন।", tags: ["নতুন অর্ডার"], pipelineStage: "ordered" }) });
    const c = conv(); s.conversations.push(c); thread(c, s);
    const msgCount = s.messages.length;
    const out = await s.service.suggestNextAction(ORG, "agent-1", c.id);
    expect(out.proposal).toEqual({
      action: "create_order", label: "অর্ডার তৈরি করুন",
      reason: "গ্রাহক অর্ডার করতে রাজি হয়েছেন।", tags: ["নতুন অর্ডার"], pipelineStage: "ordered",
    });
    // Nothing sent, nothing mutated, nothing persisted but usage.
    expect(s.messages).toHaveLength(msgCount);
    expect(c.tags).toEqual([]);
    expect(c.pipelineStage).toBe("new");
    expect(s.notes).toHaveLength(0);
    expect(s.usage.filter((u) => u.feature === "next_action")).toHaveLength(1);
  });

  it("an off-allowlist action invalidates the whole proposal", async () => {
    const s = setup({ llmText: JSON.stringify({ action: "send_money", reason: "x", tags: [], pipelineStage: null }) });
    const c = conv(); s.conversations.push(c); thread(c, s);
    const out = await s.service.suggestNextAction(ORG, "agent-1", c.id);
    expect(out.proposal).toBeNull();
    expect(parseNextActionProposal("not json")).toBeNull();
  });

  it("dev provider: proposal null with an honest reason, no usage", async () => {
    const s = setup({ realLlm: false });
    const c = conv(); s.conversations.push(c); thread(c, s);
    const out = await s.service.suggestNextAction(ORG, "agent-1", c.id);
    expect(out.proposal).toBeNull();
    expect(out.reason).toContain("প্রস্তাব তৈরি হয়নি");
    expect(s.usage).toHaveLength(0);
  });

  it("kill switch -> 403 and daily cap -> 429 for next_action", async () => {
    const killed = setup({ killOrg: true });
    const c1 = conv(); killed.conversations.push(c1); thread(c1, killed);
    await expect(killed.service.suggestNextAction(ORG, "agent-1", c1.id)).rejects.toBeInstanceOf(HttpException);
    await expect(killed.service.suggestNextAction(ORG, "agent-1", c1.id)).rejects.toMatchObject({ status: 403 });

    const seed = Array.from({ length: 20 }, () => ({ organizationId: ORG, feature: "next_action", createdAt: new Date() }));
    const capped = setup({ usageSeed: seed, llmText: "{}" });
    const c2 = conv(); capped.conversations.push(c2); thread(c2, capped);
    await expect(capped.service.suggestNextAction(ORG, "agent-1", c2.id)).rejects.toMatchObject({ status: 429 });
    expect(capped.provider.complete).not.toHaveBeenCalled();
  });
});

describe("IN7e unanswered draft proposal", () => {
  function withQuestion(s: ReturnType<typeof setup>) {
    (s.db.aiUnansweredQuestion.rows as Row[]).push({
      id: "uq-1", organizationId: ORG, conversationId: null, channel: "whatsapp",
      questionText: "আপনাদের কি হোম ডেলিভারি আছে?", normalizedQuestion: "আপনাদের কি হোম ডেলিভারি আছে?",
      reason: "knowledge_gap", status: "open", count: 1, createdAt: new Date(), lastSeenAt: new Date(),
    });
  }

  it("returns a display-only draft; knowledge, draft text and versions provably untouched", async () => {
    const s = setup({ llmText: JSON.stringify({ kind: "knowledge", title: "হোম ডেলিভারি", content: "হোম ডেলিভারি সুবিধা সম্পর্কে দলকে নিশ্চিত করে এখানে লিখতে হবে।", reason: "এই তথ্যটি জ্ঞানভান্ডারে নেই।" }) });
    withQuestion(s);
    const out = await s.desk.draftUnansweredProposal(ORG, "owner", "uq-1");
    expect(out.proposal?.kind).toBe("knowledge");
    expect(out.proposal?.title).toBe("হোম ডেলিভারি");
    expect(s.db.knowledgeDocument.rows).toHaveLength(0);
    expect(s.profile.aiInstructionsDraft ?? null).toBeNull();
    expect(s.profile.aiInstructions).toBe("ভদ্রভাবে উত্তর দিন।");
    expect(s.db.aiInstructionVersion.rows).toHaveLength(0);
    expect(s.usage.filter((u) => u.feature === "unanswered_draft")).toHaveLength(1);
    expect(parseUnansweredDraft("{\"kind\":\"other\",\"content\":\"x\"}")).toBeNull();
  });

  it("cross-org question id -> 404", async () => {
    const s = setup({ llmText: "{}" });
    (s.db.aiUnansweredQuestion.rows as Row[]).push({ id: "uq-x", organizationId: "org-2", questionText: "q", status: "open", count: 1, createdAt: new Date() });
    await expect(s.desk.draftUnansweredProposal(ORG, "owner", "uq-x")).rejects.toMatchObject({ status: 404 });
  });

  it("kill switch -> 403 and daily cap -> 429 for unanswered_draft", async () => {
    const killed = setup({ killOrg: true, llmText: "{}" });
    withQuestion(killed);
    await expect(killed.desk.draftUnansweredProposal(ORG, "owner", "uq-1")).rejects.toMatchObject({ status: 403 });

    const seed = Array.from({ length: 20 }, () => ({ organizationId: ORG, feature: "unanswered_draft", createdAt: new Date() }));
    const capped = setup({ usageSeed: seed, llmText: "{}" });
    withQuestion(capped);
    await expect(capped.desk.draftUnansweredProposal(ORG, "owner", "uq-1")).rejects.toMatchObject({ status: 429 });
    expect(capped.provider.complete).not.toHaveBeenCalled();
  });
});
