import { AnswerStoreService, normalizeQuestion } from "./answer-store.service";
import { InboxService } from "../inbox/inbox.service";
import { SocialCommentsService } from "../inbox/social-comments.service";
import { OrgBrainService } from "./org-brain.service";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * SA-B13 (Smart AI Phase 2, W4): the per-org Answer Store
 * switch — BusinessProfile.answerStoreEnabled (default TRUE)
 * enforced at the ONE point every channel flows through
 * (AnswerStoreService):
 *
 *  A) Service gate: while OFF, lookup misses for everyone
 *     (reason "answer_store_disabled", stored rows untouched);
 *     the automatic captures (autopilot_grounded, staff_edited)
 *     store nothing; a staff_approved store (a deliberate human
 *     act in the Learn Dashboard) may still LAND but cannot
 *     SERVE while off; invalidate() and the PII screen (borrowed
 *     by other services) keep working. Field TRUE or ABSENT =
 *     the SA-B3 behaviour, unchanged.
 *  B) Inbox: with the toggle on, the SA-B3 loop runs (LLM
 *     composes → capture → store serves with zero LLM calls);
 *     flipped off mid-flight, the same question takes the LLM
 *     path, hitCount does not move, and neither the autopilot
 *     capture nor a staff-edited capture writes anything;
 *     flipped back on, the store serves again.
 *  C) Comments (SA-B8 channel): same story on the comment
 *     channel — seeded entry serves while on; off → the LLM
 *     composes, no answer_store_hit usage row, no new capture.
 *  D) The toggle rides the existing business-profile PATCH:
 *     false persists, reads back through profileJson, true
 *     restores, and an unrelated PATCH never clobbers it.
 */

type Row = Record<string, any>;
const ORG = "org-1";
const PAST = new Date("2026-01-01T00:00:00Z");

function match(row: Row, where: any = {}): boolean {
  return Object.entries(where ?? {}).every(([k, raw]) => {
    const v = raw as any;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date(v.gte).getTime();
      if ("lt" in v) return new Date(row[k]).getTime() < new Date(v.lt).getTime();
      return true;
    }
    return row[k] === v;
  });
}
function applyData(row: Row, data: any) {
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v !== null && typeof v === "object" && "increment" in (v as any)) row[k] = (row[k] ?? 0) + (v as any).increment;
    else row[k] = v;
  }
}
function table(store: Row[], name: string) {
  return {
    findMany: jest.fn(async ({ where, take, orderBy }: any = {}) => {
      let rows = store.filter((r) => match(r, where));
      if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (orderBy?.createdAt === "asc") rows = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: any = {}) => {
      let rows = store.filter((r) => match(r, where));
      if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return rows[0] ?? null;
    }),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `${name}-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => r.id === where.id || match(r, where));
      if (!row) throw new Error("nf");
      applyData(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let n = 0;
      for (const r of store) if (match(r, where)) { applyData(r, data); n++; }
      return { count: n };
    }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
  };
}
function answerTable(answers: Row[]) {
  return {
    ...table(answers, "ans"),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const key = where.organizationId_normalizedQuestion_channel;
      const existing = answers.find(
        (r) => r.organizationId === key.organizationId && r.normalizedQuestion === key.normalizedQuestion && r.channel === key.channel,
      );
      if (existing) {
        applyData(existing, update);
        existing.updatedAt = new Date();
        return existing;
      }
      const row = { id: `ans-${answers.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      answers.push(row);
      return row;
    }),
  };
}
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
const until = async (cond: () => boolean) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setImmediate(r)); };

const DELIVERY_Q = "ডেলিভারি চার্জ কত?";
const DELIVERY_A = "ঢাকার ভিতরে ডেলিভারি চার্জ ৬০ টাকা, বাইরে ১২০ টাকা।";

// ----------------------------------------------------------------
// A) Service gate
// ----------------------------------------------------------------

function serviceSetup(answerStoreEnabled: boolean | undefined) {
  const answers: Row[] = [];
  const profiles: Row[] = [{
    id: "prof-1", organizationId: ORG, deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n,
    deliveryDaysInside: null, deliveryDaysOutside: null, codAvailable: true, bkashNumber: "01712345678",
    ...(answerStoreEnabled === undefined ? {} : { answerStoreEnabled }),
    createdAt: PAST, updatedAt: PAST,
  }];
  const db: any = {
    aiStoredAnswer: answerTable(answers),
    knowledgeDocument: table([], "doc"),
    businessPolicy: table([], "pol"),
    businessProfile: table(profiles, "prof"),
    product: table([], "prod"),
    $queryRaw: jest.fn(async () => []),
    $executeRaw: jest.fn(async () => 1),
  };
  const service = new AnswerStoreService(db as any, undefined);
  return { service, answers, profiles };
}

describe("SA-B13 A: AnswerStoreService gate", () => {
  it("ON (explicit true): capture stores and the exact lookup serves — SA-B3 behaviour", async () => {
    const { service } = serviceSetup(true);
    const stored = await service.store(ORG, {
      question: DELIVERY_Q, answer: DELIVERY_A, channel: "inbox", language: "bn",
      sourceRefs: { profileAreas: ["delivery"] }, origin: "autopilot_grounded",
    });
    expect(stored.stored).toBe(true);
    const hit = await service.lookup(ORG, DELIVERY_Q, { channel: "inbox", language: "bn" });
    expect(hit.hit).toBe(true);
    if (hit.hit) expect(hit.answer).toBe(DELIVERY_A);
  });

  it("field ABSENT reads as enabled (schema default TRUE) — captures store, lookups serve", async () => {
    const { service } = serviceSetup(undefined);
    const stored = await service.store(ORG, {
      question: DELIVERY_Q, answer: DELIVERY_A, channel: "inbox", language: "bn",
      sourceRefs: { profileAreas: ["delivery"] }, origin: "staff_edited",
    });
    expect(stored.stored).toBe(true);
    const hit = await service.lookup(ORG, DELIVERY_Q, { channel: "inbox", language: "bn" });
    expect(hit.hit).toBe(true);
  });

  it("OFF: automatic captures store NOTHING (autopilot_grounded + staff_edited refused with the named reason)", async () => {
    const { service, answers } = serviceSetup(false);
    for (const origin of ["autopilot_grounded", "staff_edited"] as const) {
      const res = await service.store(ORG, {
        question: DELIVERY_Q, answer: DELIVERY_A, channel: "inbox", language: "bn",
        sourceRefs: { profileAreas: ["delivery"] }, origin,
      });
      expect(res).toEqual({ stored: false, reason: "answer_store_disabled" });
    }
    expect(answers).toHaveLength(0);
  });

  it("OFF: lookup misses with the named reason and the stored row is untouched; staff_approved may LAND but cannot SERVE; invalidate + PII screen still work", async () => {
    const { service, answers, profiles } = serviceSetup(true);
    const seeded = await service.store(ORG, {
      question: DELIVERY_Q, answer: DELIVERY_A, channel: "inbox", language: "bn",
      sourceRefs: { profileAreas: ["delivery"] }, origin: "staff_approved",
    });
    expect(seeded.stored).toBe(true);
    const entryId = (seeded as any).entryId as string;

    profiles[0].answerStoreEnabled = false; // the owner flips the switch
    const miss = await service.lookup(ORG, DELIVERY_Q, { channel: "inbox", language: "bn" });
    expect(miss).toEqual({ hit: false, reason: "answer_store_disabled" });
    expect(answers[0].hitCount).toBe(0); // untouched: no hit was recorded

    // A deliberate human approval still lands while off…
    const approved = await service.store(ORG, {
      question: "ক্যাশ অন ডেলিভারি আছে কি?", answer: "হ্যাঁ, ক্যাশ অন ডেলিভারি আছে।", channel: "inbox", language: "bn",
      sourceRefs: { profileAreas: ["payment"] }, origin: "staff_approved",
    });
    expect(approved.stored).toBe(true);
    // …but nothing serves while the switch is off.
    const stillMiss = await service.lookup(ORG, "ক্যাশ অন ডেলিভারি আছে কি?", { channel: "inbox", language: "bn" });
    expect(stillMiss.hit).toBe(false);

    // Management + the borrowed PII screen are NOT gated.
    await service.invalidate(ORG, entryId, "owner review");
    expect(answers.find((a) => a.id === entryId)?.status).toBe("invalidated");
    await expect(service.screenAnswerPii(ORG, "আমার নম্বর 01898765432, কল দিন")).resolves.toBe("pii_phone_in_answer");
    await expect(service.screenAnswerPii(ORG, "ধন্যবাদ, ভালো থাকবেন।")).resolves.toBeNull();
  });
});

// ----------------------------------------------------------------
// B) Inbox integration (the SA-B3 harness, toggle in the middle)
// ----------------------------------------------------------------

function cosine(a: number[], b: number[]): number {
  const dot = a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
  const na = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  const nb = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
  return na && nb ? dot / (na * nb) : 0;
}
const EMBEDDINGS: Record<string, number[]> = {
  [normalizeQuestion("ডেলিভারি চার্জ কত?")]: [1, 0, 0],
};

function inboxSetup(llmProvider?: any) {
  const stores: Record<string, Row[]> = {};
  const names = [
    "inboxSetting", "channelConversation", "channelMessage", "messageDraft", "product", "order",
    "orderItem", "customer", "businessPolicy", "businessProfile", "knowledgeDocument", "organization",
    "membership", "agentNotification", "botSession", "integration", "conversationNote",
    "aiUnansweredQuestion", "aIUsageRecord", "quickReply", "inboxTeam", "inboxTeamMember",
  ];
  for (const n of names) stores[n] = [];
  const answers: Row[] = [];
  stores.aiStoredAnswer = answers;
  stores.inboxSetting.push({
    id: "s1", organizationId: ORG, autoReplyMode: "auto", confidenceThreshold: 70, perIntent: {},
    smartAssign: "off", slaFirstResponseMinutes: 60, perChannelModes: {}, escalationThresholdMinor: null,
  });
  stores.organization.push({ id: ORG, name: "টেস্ট শপ" });
  stores.businessProfile.push({
    id: "prof-1", organizationId: ORG, deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n,
    deliveryDaysInside: null, deliveryDaysOutside: null, codAvailable: true, bkashNumber: "01712345678",
    answerStoreEnabled: true,
    createdAt: PAST, updatedAt: PAST,
  });
  stores.membership.push({ id: "m1", organizationId: ORG, userId: "agent-1", role: "SUPPORT_AGENT", user: { id: "agent-1", name: "এজেন্ট", email: "a@x" } });

  const db: Record<string, any> = {};
  for (const n of names) db[n] = table(stores[n], n);
  db.aiStoredAnswer = answerTable(answers);
  db.$queryRaw = jest.fn(async (sql: any) => {
    const values = sql.values as any[];
    const vector = JSON.parse(values[0]) as number[];
    const [, organizationId, channel, provider, model, dimension] = values;
    return answers
      .filter(
        (r) =>
          r.organizationId === organizationId && r.status === "active" && r.channel === channel &&
          r.provider === provider && r.model === model && r.dimension === dimension && Array.isArray(r._vector),
      )
      .map((r) => ({ id: r.id, similarity: cosine(vector, r._vector) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
  });
  db.$executeRaw = jest.fn(async (sql: any) => {
    const text = (sql.strings as string[]).join(" ");
    const values = sql.values as any[];
    const hasVector = text.includes("::vector");
    const id = hasVector ? values[1] : values[0];
    const row = answers.find((r) => r.id === id);
    if (!row) return 0;
    row._vector = hasVector ? (JSON.parse(values[0]) as number[]) : null;
    return 1;
  });

  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const llm = { getProvider: () => { if (!llmProvider) throw new Error("no provider configured"); return llmProvider; } };
  const embeddings: any = {
    embedOne: jest.fn(async (_org: string, text: string) => {
      const v = EMBEDDINGS[text] ?? [0, 0, 1];
      return { ok: true, vectors: [v], provider: "fake", model: "fake-embed", dimension: v.length, inputTokens: 1, tokensEstimated: false };
    }),
  };
  const answerStore = new AnswerStoreService(db as any, embeddings);
  const service = new InboxService(
    db as any, audit as any, llm as any,
    undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    answerStore as any,
  );
  (service as any).composeGroundedReply = async () => null; // force the LLM tier (SA-B3 harness)
  return { service, db, audit, stores, answers, answerStore };
}

function conv(over: Row = {}): Row {
  return {
    id: `c-${Math.random().toString(36).slice(2, 8)}`, organizationId: ORG, channel: "webchat", status: "open",
    assignedUserId: null, priority: "normal", autoReplyPaused: false, customerId: null, contactName: "রহিম",
    createdAt: new Date(), lastMessageAt: new Date(), firstResponseAt: null, ...over,
  };
}
const CLS = (intent: string, confidence = 95, sentiment: string | null = null) => ({ intent, confidence, sentiment } as any);
const provider = (text: string) => ({
  name: "fake-llm", isRealLlm: true,
  complete: jest.fn(async () => ({ text, inputTokens: 10, outputTokens: 5, tokensEstimated: false })),
});

describe("SA-B13 B: inbox autopilot honours the toggle", () => {
  it("ON: capture + zero-LLM serve (SA-B3) → OFF: LLM path, hitCount frozen, captures write nothing → ON again: the store serves", async () => {
    const llm = provider("ঢাকার ভিতরে ডেলিভারি চার্জ ৬০ টাকা এবং বাইরে ১২০ টাকা।");
    const s = inboxSetup(llm);

    // ON — first ask: the LLM composes and the answer is captured.
    const c1 = conv(); s.stores.channelConversation.push(c1);
    await (s.service as any).maybeAutoReply(ORG, c1, CLS("delivery"), "ডেলিভারি চার্জ কত?");
    expect(llm.complete).toHaveBeenCalledTimes(1);
    await until(() => s.answers.length === 1);
    expect(s.answers[0]).toMatchObject({ origin: "autopilot_grounded", status: "active" });

    // ON — second ask: served from the store, zero LLM calls.
    llm.complete.mockClear();
    const c2 = conv(); s.stores.channelConversation.push(c2);
    await (s.service as any).maybeAutoReply(ORG, c2, CLS("delivery"), "ডেলিভারি চার্জ কত?");
    expect(llm.complete).not.toHaveBeenCalled();
    expect(s.answers[0].hitCount).toBe(1);

    // OFF — the very same question now takes the LLM path…
    s.stores.businessProfile[0].answerStoreEnabled = false;
    const groundedAtBefore = s.answers[0].groundedAt;
    llm.complete.mockClear();
    const c3 = conv(); s.stores.channelConversation.push(c3);
    await (s.service as any).maybeAutoReply(ORG, c3, CLS("delivery"), "ডেলিভারি চার্জ কত?");
    expect(llm.complete).toHaveBeenCalledTimes(1);
    const sent3 = s.stores.channelMessage.filter((m) => m.autoReply && m.status === "sent" && m.conversationId === c3.id);
    expect(sent3).toHaveLength(1);
    expect(JSON.parse(sent3[0].autoReplyEvidence).tier).toBe("llm");
    await flush();
    // …the hit counter did not move, and the capture wrote
    // nothing (a leaked capture of the same question would
    // upsert-replace the row and move groundedAt).
    expect(s.answers[0].hitCount).toBe(1);
    expect(s.answers).toHaveLength(1);
    expect(s.answers[0].groundedAt).toBe(groundedAtBefore);

    // OFF — a staff-edited autopilot draft send captures
    // nothing either (a different question, so a leaked capture
    // would appear as a second row).
    const c4 = conv(); s.stores.channelConversation.push(c4);
    s.stores.channelMessage.push({
      id: "in-4", conversationId: c4.id, direction: "in", type: "text", content: "ক্যাশ অন ডেলিভারি আছে কি?",
      intent: "payment", status: "received", createdAt: new Date(),
    });
    s.stores.messageDraft.push({
      id: "d-4", organizationId: ORG, conversationId: c4.id, content: "ক্যাশ অন ডেলিভারি আছে।",
      provider: "auto-reply", status: "suggested", createdByUserId: null, createdAt: new Date(),
    });
    await s.service.sendDraft(ORG, "agent-1", c4.id, "d-4", "হ্যাঁ, ক্যাশ অন ডেলিভারি সুবিধা আছে।");
    await flush();
    expect(s.answers).toHaveLength(1);

    // ON again — the stored answer serves once more, still zero LLM calls.
    s.stores.businessProfile[0].answerStoreEnabled = true;
    llm.complete.mockClear();
    const c5 = conv(); s.stores.channelConversation.push(c5);
    await (s.service as any).maybeAutoReply(ORG, c5, CLS("delivery"), "ডেলিভারি চার্জ কত?");
    expect(llm.complete).not.toHaveBeenCalled();
    expect(s.answers[0].hitCount).toBe(2);
  });
});

// ----------------------------------------------------------------
// C) Comment channel (the SA-B8 harness, trimmed)
// ----------------------------------------------------------------

// The comment service's fake needs the SA-B8 table semantics
// (compound-unique match + generic upsert — ingestComment
// upserts on organizationId_externalCommentId), so Part C uses
// its own copies; Parts A/B keep the SA-B3 helpers above.
function eqValC(a: any, b: any): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return a === b;
}
function matchC(row: Row, where: any = {}): boolean {
  return Object.entries(where ?? {}).every(([k, raw]) => {
    const v = raw as any;
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const keys = Object.keys(v);
      const isOperator = keys.some((kk) => ["in", "notIn", "not", "gte", "gt", "lte", "lt", "equals", "contains", "mode"].includes(kk));
      if (!isOperator) return keys.every((kk) => eqValC(row[kk], v[kk]));
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("notIn" in v) return !(v.notIn as any[]).includes(row[k]);
      if ("not" in v) {
        if (v.not === null) return row[k] !== null && row[k] !== undefined;
        return !eqValC(row[k], v.not);
      }
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("gt" in v && !(new Date(row[k]).getTime() > new Date(v.gt).getTime())) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("equals" in v) return eqValC(row[k], v.equals);
      if ("contains" in v) return String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase());
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return eqValC(row[k], v);
  });
}
function sortRowsC(rows: Row[], orderBy: any): Row[] {
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
function tableC(store: Row[]) {
  return {
    findMany: jest.fn(async ({ where, take, orderBy, skip }: any = {}) => {
      let rows = sortRowsC(store.filter((r) => matchC(r, where)), orderBy);
      if (skip) rows = rows.slice(skip);
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: any = {}) => {
      const rows = sortRowsC(store.filter((r) => matchC(r, where)), orderBy);
      return rows[0] ?? null;
    }),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => matchC(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => { const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data }; store.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => { const row = store.find((r) => r.id === where.id || matchC(r, where)); if (!row) throw new Error("nf"); applyData(row, data); row.updatedAt = new Date(); return row; }),
    updateMany: jest.fn(async ({ where, data }: any) => { let n = 0; for (const r of store) if (matchC(r, where)) { applyData(r, data); n++; } return { count: n }; }),
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const row = store.find((r) => matchC(r, where));
      if (row) { applyData(row, update); return row; }
      const created = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      store.push(created); return created;
    }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => matchC(r, where)).length),
  };
}

function commentsSetup(providerFake: any) {
  const replySettings: Row[] = [{
    id: "rs1", organizationId: ORG, aiAutoReplyEnabled: true, sendPrivateDm: true, autoHideSpam: true,
    replyDelaySeconds: 0, tonePreference: "FRIENDLY_SALES", bannedKeywords: [], salesOrderUrl: null,
    nightOwlEnabled: false, urgentAlertTelegramEnabled: false, telegramChatId: null, telegramBotToken: null,
  }];
  const comments: Row[] = [];
  const products: Row[] = [
    { id: "p1", organizationId: ORG, name: "লেদার ওয়ালেট", priceMinor: 125000n, currency: "BDT", slug: "wallet", status: "ACTIVE", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") },
  ];
  const profile: Row = {
    id: "bp1", organizationId: ORG, industry: "fashion", description: "লেদার পণ্যের দোকান", brandVoice: null,
    deliveryChargeInsideMinor: 6000, deliveryChargeOutsideMinor: 12000, deliveryDaysInside: 2, deliveryDaysOutside: 3,
    codAvailable: true, bkashNumber: "01711111111", nagadNumber: null, advancePaymentPercent: null, paymentNote: null,
    contactPhone: "01822222222", contactEmail: null, address: null, city: "ঢাকা", websiteUrl: null, businessHours: null,
    returnWindowDays: null, aiInstructions: null, aiReplyLanguage: null,
    goals: null, monthlyBudgetMinor: null, targetCustomers: null, uniqueSellingPoints: null,
    answerStoreEnabled: true,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
  };
  const storedAnswers: Row[] = [];
  const usage: Row[] = [];
  const db: any = {
    socialReplySetting: tableC(replySettings),
    socialComment: tableC(comments),
    product: tableC(products),
    lead: tableC([] as Row[]),
    businessProfile: tableC([profile]),
    businessPolicy: tableC([] as Row[]),
    knowledgeDocument: tableC([] as Row[]),
    organization: tableC([{ id: ORG, name: "টেস্ট শপ" }] as Row[]),
    aiBrandVoiceProfile: tableC([] as Row[]),
    customerMemory: tableC([] as Row[]),
    aiStoredAnswer: tableC(storedAnswers),
    aIUsageRecord: tableC(usage),
    integration: tableC([] as Row[]),
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const llm = { forOrg: async () => providerFake, getProvider: () => providerFake };
  const brain = new OrgBrainService(db as any);
  const storeSvc = new AnswerStoreService(db as any, undefined);
  const service = new SocialCommentsService(db as any, audit as any, llm as any, brain as any, storeSvc as any);
  const graph = {
    replies: [] as { commentId: string; text: string }[],
    dms: [] as { commentId: string; text: string }[],
  };
  (service as any).graphClientFor = async () => ({
    replyToComment: async (commentId: string, text: string) => { graph.replies.push({ commentId, text }); return { commentId: `graph-reply-${graph.replies.length}` }; },
    privateReplyToComment: async (commentId: string, text: string) => { graph.dms.push({ commentId, text }); return { messageId: "graph-dm-1" }; },
    setCommentHidden: async () => ({ success: true }),
    deleteComment: async () => ({ success: true }),
  });
  return { service, profile, storedAnswers, usage, graph, storeSvc };
}
const cdto = (over: Row = {}): any => ({
  platform: "facebook", externalPostId: "post-1", externalCommentId: `cmt-${Math.random().toString(36).slice(2, 8)}`,
  postTitle: "লেদার ওয়ালেট অফার", authorName: "রাকিব হাসান", authorSocialId: "fb-rakib",
  commentText: "লেদার ওয়ালেট এর দাম কত?", ...over,
});

describe("SA-B13 C: comment channel honours the toggle", () => {
  it("ON: the stored comment answer serves with zero LLM calls → OFF: the LLM composes, no hit usage row, no capture → ON: serves again", async () => {
    const providerFake = {
      name: "fake-llm", isRealLlm: true,
      complete: jest.fn(async () => ({ text: "লেদার ওয়ালেটের বর্তমান দাম BDT 1250.00।", inputTokens: 11, outputTokens: 7, tokensEstimated: false })),
    };
    const s = commentsSetup(providerFake);
    const stored = await s.storeSvc.store(ORG, {
      question: "লেদার ওয়ালেট এর দাম কত?",
      answer: "লেদার ওয়ালেটের দাম BDT 1250.00 — ক্যাশ অন ডেলিভারিতে নিতে পারবেন।",
      channel: "comment", language: "bn",
      sourceRefs: { productIds: ["p1"] }, origin: "staff_approved",
    });
    expect(stored.stored).toBe(true);

    // ON — the store serves; the model is never called.
    const c1: any = await s.service.ingestComment(ORG, cdto({ externalCommentId: "t13-1" }));
    expect(providerFake.complete).not.toHaveBeenCalled();
    expect(s.graph.replies).toHaveLength(1);
    expect(c1.metadata?.graph?.groundedVia).toBe("answer_store");
    expect(s.usage.filter((u) => u.feature === "answer_store_hit")).toHaveLength(1);
    expect(s.storedAnswers[0].hitCount).toBe(1);

    // OFF — the same comment takes the LLM path…
    s.profile.answerStoreEnabled = false;
    providerFake.complete.mockClear();
    const c2: any = await s.service.ingestComment(ORG, cdto({ externalCommentId: "t13-2" }));
    expect(providerFake.complete).toHaveBeenCalled();
    expect(s.graph.replies).toHaveLength(2);
    expect(s.graph.replies[1].text).toContain("1250.00");
    expect(c2.metadata?.graph?.groundedVia).toBe("llm");
    await flush();
    // …no hit was recorded, and the guard-passed send captured nothing new.
    expect(s.usage.filter((u) => u.feature === "answer_store_hit")).toHaveLength(1);
    expect(s.storedAnswers).toHaveLength(1);
    expect(s.storedAnswers[0].hitCount).toBe(1);

    // ON again — the store serves once more.
    s.profile.answerStoreEnabled = true;
    providerFake.complete.mockClear();
    const c3: any = await s.service.ingestComment(ORG, cdto({ externalCommentId: "t13-3" }));
    expect(providerFake.complete).not.toHaveBeenCalled();
    expect(s.graph.replies).toHaveLength(3);
    expect(c3.metadata?.graph?.groundedVia).toBe("answer_store");
    expect(s.storedAnswers[0].hitCount).toBe(2);
  });
});

// ----------------------------------------------------------------
// D) Business-profile PATCH round-trip
// ----------------------------------------------------------------

describe("SA-B13 D: the toggle rides the business-profile PATCH", () => {
  function orgSetup() {
    const store: { profile: any } = { profile: null };
    const fake: any = {
      businessProfile: {
        findUnique: jest.fn(async () => store.profile),
        upsert: jest.fn(async ({ create, update }: any) => {
          // Prisma semantics: undefined values in an update are
          // ignored, never written as null/undefined.
          const clean = Object.fromEntries(Object.entries(update ?? {}).filter(([, v]) => v !== undefined));
          store.profile = store.profile ? { ...store.profile, ...clean } : { id: "p1", ...create };
          return store.profile;
        }),
      },
      businessPolicy: { findMany: jest.fn(async () => []) },
      knowledgeDocument: { count: jest.fn(async () => 0) },
      product: { count: jest.fn(async () => 0) },
    };
    const audit = { log: jest.fn(async () => undefined) };
    return { svc: new OrganizationsService(fake, audit as any), store };
  }

  it("false persists and reads back; true restores; an unrelated PATCH leaves the flag alone", async () => {
    const { svc, store } = orgSetup();
    await svc.updateBusinessProfile("org", "boss", { answerStoreEnabled: false } as any);
    expect(store.profile.answerStoreEnabled).toBe(false);
    const readBack: any = await svc.getBusinessProfile("org");
    expect(readBack.answerStoreEnabled).toBe(false);

    await svc.updateBusinessProfile("org", "boss", { description: "নতুন বিবরণ" } as any);
    expect(store.profile.answerStoreEnabled).toBe(false); // untouched by an unrelated PATCH

    await svc.updateBusinessProfile("org", "boss", { answerStoreEnabled: true } as any);
    expect(store.profile.answerStoreEnabled).toBe(true);
    const readBack2: any = await svc.getBusinessProfile("org");
    expect(readBack2.answerStoreEnabled).toBe(true);
  });
});
