import "reflect-metadata";
import { InboxService } from "./inbox.service";
import { SocialCommentsService } from "./social-comments.service";
import { aiScheduleBlocks, isAiActive, parseAiSchedule } from "./ai-schedule";

/**
 * CX12d — Channel-wise AI schedule.
 *
 * Pure helper matrix (days / timezone / overnight / parser),
 * settings plumbing (400 on invalid, normalized persist, corrupt
 * stored value reads as {}), the maybeAutoReply gate (escalation
 * still fires off-hours; no send, no CX3 defer), the order-bot
 * ingest gate, the comments gates (ingest + due sweep drop
 * semantics) and precedence vs perChannelModes / CX3 delay.
 *
 * Fake prisma only — no live DB, no live AI reply anywhere.
 */
type Row = Record<string, any>;

function eqVal(a: any, b: any): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return a === b;
}
function match(row: Row, where: any = {}): boolean {
  return Object.entries(where ?? {}).every(([k, raw]) => {
    const v = raw as any;
    if (k === "organizationId_externalCommentId" && v && typeof v === "object") {
      return row.organizationId === v.organizationId && row.externalCommentId === v.externalCommentId;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("notIn" in v) return !(v.notIn as any[]).includes(row[k]);
      if ("not" in v) {
        if (v.not === null) return row[k] !== null && row[k] !== undefined;
        return !eqVal(row[k], v.not);
      }
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("gt" in v && !(new Date(row[k]).getTime() > new Date(v.gt).getTime())) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("equals" in v) return eqVal(row[k], v.equals);
      return true;
    }
    return eqVal(row[k], v);
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
    findMany: jest.fn(async ({ where, take, orderBy, skip }: any = {}) => {
      let rows = sortRows(store.filter((r) => match(r, where)), orderBy);
      if (skip) rows = rows.slice(skip);
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: any = {}) => {
      const rows = sortRows(store.filter((r) => match(r, where)), orderBy);
      return rows[0] ?? null;
    }),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => { const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data }; store.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => { const row = store.find((r) => r.id === where.id || match(r, where)); if (!row) throw new Error("nf"); Object.assign(row, data); return row; }),
    updateMany: jest.fn(async ({ where, data }: any) => { let n = 0; for (const r of store) if (match(r, where)) { Object.assign(r, data); n++; } return { count: n }; }),
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const row = store.find((r) => match(r, where));
      if (row) { Object.assign(row, update); return row; }
      const created = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      store.push(created); return created;
    }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
  };
}

const ORG = "org-1";
const CLS = (intent: string, confidence = 95, sentiment: string | null = null) => ({ intent, confidence, sentiment } as any);
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
/** Windows whose union covers every minute of every day. */
const ALWAYS_ACTIVE = { enabled: true, windows: [
  { days: ALL_DAYS, start: "00:00", end: "23:59" },
  { days: ALL_DAYS, start: "23:00", end: "01:00" },
] };
/** Enabled with no windows = AI off at all times (deterministic block). */
const ALWAYS_BLOCKED = { enabled: true, windows: [] as any[] };

// ---------- Pure helper ----------

describe("CX12d ai-schedule pure helper", () => {
  const mon = (h: string) => new Date(`2026-10-12T${h}:00Z`); // a Monday, UTC

  it("no entry -> active; disabled entry -> active; blocks() false for both", () => {
    expect(isAiActive({}, "whatsapp", mon("12:00"), "UTC")).toBe(true);
    expect(isAiActive({ whatsapp: { enabled: false, windows: [] } }, "whatsapp", mon("12:00"), "UTC")).toBe(true);
    expect(aiScheduleBlocks({}, "whatsapp", mon("12:00"), "UTC")).toBe(false);
    expect(aiScheduleBlocks({ whatsapp: { enabled: false, windows: [] } }, "whatsapp", mon("12:00"), "UTC")).toBe(false);
  });

  it("enabled inside window -> active; outside -> inactive + blocks", () => {
    const map = { whatsapp: { enabled: true, windows: [{ days: [1], start: "09:00", end: "17:00" }] } };
    expect(isAiActive(map, "whatsapp", mon("10:00"), "UTC")).toBe(true);
    expect(isAiActive(map, "whatsapp", mon("09:00"), "UTC")).toBe(true); // start inclusive
    expect(isAiActive(map, "whatsapp", mon("17:00"), "UTC")).toBe(false); // end exclusive
    expect(isAiActive(map, "whatsapp", mon("08:00"), "UTC")).toBe(false);
    expect(aiScheduleBlocks(map, "whatsapp", mon("08:00"), "UTC")).toBe(true);
    // Tuesday is not a listed day
    expect(isAiActive(map, "whatsapp", new Date("2026-10-13T10:00:00Z"), "UTC")).toBe(false);
  });

  it("enabled with zero windows -> inactive at all times", () => {
    expect(isAiActive({ whatsapp: ALWAYS_BLOCKED }, "whatsapp", mon("12:00"), "UTC")).toBe(false);
    expect(aiScheduleBlocks({ whatsapp: ALWAYS_BLOCKED }, "whatsapp", mon("12:00"), "UTC")).toBe(true);
  });

  it("overnight 22:00-06:00 (all days): active 23:00 + 03:00, inactive 12:00", () => {
    const map = { whatsapp: { enabled: true, windows: [{ days: ALL_DAYS, start: "22:00", end: "06:00" }] } };
    expect(isAiActive(map, "whatsapp", mon("23:00"), "UTC")).toBe(true);
    expect(isAiActive(map, "whatsapp", new Date("2026-10-13T03:00:00Z"), "UTC")).toBe(true);
    expect(isAiActive(map, "whatsapp", mon("12:00"), "UTC")).toBe(false);
    expect(isAiActive(map, "whatsapp", mon("06:00"), "UTC")).toBe(false); // end exclusive
  });

  it("overnight starting Friday only: active Saturday 03:00, inactive Saturday 23:00", () => {
    const map = { whatsapp: { enabled: true, windows: [{ days: [5], start: "22:00", end: "06:00" }] } };
    expect(isAiActive(map, "whatsapp", new Date("2026-10-16T23:00:00Z"), "UTC")).toBe(true); // Fri 23:00
    expect(isAiActive(map, "whatsapp", new Date("2026-10-17T03:00:00Z"), "UTC")).toBe(true); // Sat 03:00 (Fri window)
    expect(isAiActive(map, "whatsapp", new Date("2026-10-17T23:00:00Z"), "UTC")).toBe(false); // Sat 23:00 (Sat not a start day)
    expect(isAiActive(map, "whatsapp", new Date("2026-10-16T12:00:00Z"), "UTC")).toBe(false); // Fri noon
  });

  it("timezone: 09:00-17:00 Asia/Dhaka — 03:30Z (=09:30 Dhaka) active, 02:00Z (=08:00 Dhaka) inactive", () => {
    const map = { whatsapp: { enabled: true, windows: [{ days: ALL_DAYS, start: "09:00", end: "17:00" }] } };
    expect(isAiActive(map, "whatsapp", new Date("2026-10-12T03:30:00Z"), "Asia/Dhaka")).toBe(true);
    expect(isAiActive(map, "whatsapp", new Date("2026-10-12T02:00:00Z"), "Asia/Dhaka")).toBe(false);
    // Same instants read in UTC give the opposite answers — the tz is really applied.
    expect(isAiActive(map, "whatsapp", new Date("2026-10-12T03:30:00Z"), "UTC")).toBe(false);
  });

  it("multiple windows union", () => {
    const map = { whatsapp: { enabled: true, windows: [
      { days: [1], start: "09:00", end: "12:00" },
      { days: [1], start: "14:00", end: "18:00" },
    ] } };
    expect(isAiActive(map, "whatsapp", mon("10:00"), "UTC")).toBe(true);
    expect(isAiActive(map, "whatsapp", mon("13:00"), "UTC")).toBe(false);
    expect(isAiActive(map, "whatsapp", mon("15:00"), "UTC")).toBe(true);
  });
});

describe("CX12d parseAiSchedule", () => {
  it("null/undefined -> {}; a valid map is normalized (days deduped + sorted)", () => {
    expect(parseAiSchedule(null)).toEqual({});
    expect(parseAiSchedule(undefined)).toEqual({});
    expect(parseAiSchedule({ whatsapp: { enabled: true, windows: [{ days: [3, 1, 1], start: "09:00", end: "17:00" }] } }))
      .toEqual({ whatsapp: { enabled: true, windows: [{ days: [1, 3], start: "09:00", end: "17:00" }] } });
  });

  it("end === start window is DROPPED (not an error, not 24h): enabled entry left with no windows -> inactive", () => {
    const map = parseAiSchedule({ whatsapp: { enabled: true, windows: [{ days: [1], start: "09:00", end: "09:00" }] } });
    expect(map.whatsapp.windows).toEqual([]);
    expect(isAiActive(map, "whatsapp", new Date("2026-10-12T10:00:00Z"), "UTC")).toBe(false);
  });

  it("day 7 -> throw; '9am' -> throw; non-object -> throw; bad shapes -> throw", () => {
    expect(() => parseAiSchedule({ whatsapp: { enabled: true, windows: [{ days: [7], start: "09:00", end: "17:00" }] } })).toThrow(/Invalid aiScheduleByChannel/);
    expect(() => parseAiSchedule({ whatsapp: { enabled: true, windows: [{ days: [1], start: "9am", end: "17:00" }] } })).toThrow(/Invalid aiScheduleByChannel/);
    expect(() => parseAiSchedule("nope")).toThrow(/Invalid aiScheduleByChannel/);
    expect(() => parseAiSchedule([{ enabled: true, windows: [] }])).toThrow(/Invalid aiScheduleByChannel/);
    expect(() => parseAiSchedule({ whatsapp: { enabled: "yes", windows: [] } })).toThrow(/Invalid aiScheduleByChannel/);
    expect(() => parseAiSchedule({ whatsapp: { enabled: true, windows: [{ days: [], start: "09:00", end: "17:00" }] } })).toThrow(/Invalid aiScheduleByChannel/);
    expect(() => parseAiSchedule({ whatsapp: { enabled: true, windows: Array.from({ length: 9 }, () => ({ days: [1], start: "09:00", end: "10:00" })) } })).toThrow(/Invalid aiScheduleByChannel/);
  });
});

// ---------- Inbox ----------

function inboxSetup() {
  const settings: Row[] = [{ id: "s1", organizationId: ORG, autoReplyMode: "auto", confidenceThreshold: 70, perIntent: {}, smartAssign: "off", slaFirstResponseMinutes: 60, perChannelModes: {}, escalationThresholdMinor: null, aiReplyDelaySeconds: 0, aiReplyDelayByChannel: {}, aiScheduleByChannel: {}, botEnabled: false, botDeliveryChargeMinor: 6000 }];
  const conversations: Row[] = [];
  const messages: Row[] = [];
  const botSessions: Row[] = [];
  const db = {
    inboxSetting: table(settings),
    channelConversation: table(conversations),
    channelMessage: table(messages),
    messageDraft: table([] as Row[]),
    product: table([
      { id: "p1", organizationId: ORG, name: "কটন শাড়ি", priceMinor: 120000n, currency: "BDT", stockQuantity: 5, status: "ACTIVE", createdAt: new Date("2026-01-01") },
      { id: "p2", organizationId: ORG, name: "লেদার ব্যাগ", priceMinor: 250000n, currency: "BDT", stockQuantity: 2, status: "ACTIVE", createdAt: new Date("2026-01-02") },
    ] as Row[]),
    order: table([] as Row[]),
    businessPolicy: table([] as Row[]),
    businessProfile: table([] as Row[]),
    knowledgeDocument: table([] as Row[]),
    aiUnansweredQuestion: table([] as Row[]),
    aIUsageRecord: table([] as Row[]),
    botSession: table(botSessions),
    conversationNote: table([] as Row[]),
    organization: table([{ id: ORG, name: "টেস্ট শপ", timezone: "UTC" }] as Row[]),
    membership: table([{ id: "m1", organizationId: ORG, userId: "owner", role: "OWNER" }] as Row[]),
    agentNotification: table([] as Row[]),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const llm = { getProvider: () => { throw new Error("no provider configured"); } };
  const service = new InboxService(db as any, audit as any, llm as any);
  return { service, db, audit, settings, conversations, messages, botSessions };
}
function conv(over: Row = {}): Row {
  return { id: `c-${Math.random().toString(36).slice(2, 8)}`, organizationId: ORG, channel: "webchat", status: "open", assignedUserId: null, priority: "normal", sentimentFlag: null, autoReplyPaused: false, customerId: null, contactName: "রহিম", createdAt: new Date(), lastMessageAt: new Date(), firstResponseAt: new Date(), autoReplyDueAt: null, autoReplyBatchSince: null, ...over };
}

describe("CX12d inbox settings plumbing", () => {
  it("defaults to {}; a valid map persists normalized; getSettings round-trips it", async () => {
    const { service, settings } = inboxSetup();
    settings[0].aiScheduleByChannel = undefined;
    expect((await service.getSettings(ORG)).aiScheduleByChannel).toEqual({});
    const saved = await service.updateSettings(ORG, "owner", { aiScheduleByChannel: { webchat: { enabled: true, windows: [{ days: [2, 0, 0], start: "09:00", end: "09:00" }, { days: [1], start: "10:00", end: "12:00" }] } } as any });
    // end==start window dropped by normalization; days deduped/sorted
    expect(saved.aiScheduleByChannel).toEqual({ webchat: { enabled: true, windows: [{ days: [1], start: "10:00", end: "12:00" }] } });
    expect(settings[0].aiScheduleByChannel).toEqual(saved.aiScheduleByChannel);
  });

  it("an invalid map is rejected with 400 and nothing is persisted", async () => {
    const { service, settings } = inboxSetup();
    await expect(service.updateSettings(ORG, "owner", { aiScheduleByChannel: { webchat: { enabled: true, windows: [{ days: [9], start: "09:00", end: "10:00" }] } } as any })).rejects.toThrow(/aiScheduleByChannel/);
    await expect(service.updateSettings(ORG, "owner", { aiScheduleByChannel: { webchat: { enabled: true, windows: [{ days: [1], start: "9am", end: "10:00" }] } } as any })).rejects.toThrow(/aiScheduleByChannel/);
    expect(settings[0].aiScheduleByChannel).toEqual({});
  });

  it("a corrupt stored value reads as {} from getSettings (never crashes)", async () => {
    const { service, settings } = inboxSetup();
    settings[0].aiScheduleByChannel = { webchat: { enabled: "yes" } };
    expect((await service.getSettings(ORG)).aiScheduleByChannel).toEqual({});
  });
});

describe("CX12d maybeAutoReply schedule gate", () => {
  it("blocking schedule: a price question gets NO send and NO CX3 defer (dueAt stays null)", async () => {
    const { service, conversations, messages } = inboxSetup();
    await service.updateSettings(ORG, "owner", { aiReplyDelaySeconds: 45, aiScheduleByChannel: { webchat: ALWAYS_BLOCKED } as any });
    const c = conv(); conversations.push(c);
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি এর দাম কত?");
    expect(messages.filter((m) => m.autoReply)).toHaveLength(0);
    expect(c.autoReplyDueAt ?? null).toBeNull();
    expect(c.autoReplyBatchSince ?? null).toBeNull();
  });

  it("blocking schedule: a complaint STILL escalates (paused + audit) while blocked", async () => {
    const { service, conversations, messages, audit } = inboxSetup();
    await service.updateSettings(ORG, "owner", { aiScheduleByChannel: { webchat: ALWAYS_BLOCKED } as any });
    const c = conv(); conversations.push(c);
    await (service as any).maybeAutoReply(ORG, c, CLS("complaint", 90, "negative"), "খুবই বাজে সার্ভিস, রিফান্ড চাই");
    expect(c.autoReplyPaused).toBe(true);
    expect(audit.calls.some((a) => a.action === "inbox.autopilot.escalated")).toBe(true);
    expect(messages.filter((m) => m.autoReply)).toHaveLength(0);
  });

  it("no schedule -> unchanged behaviour: the price question is answered", async () => {
    const { service, conversations, messages } = inboxSetup();
    const c = conv(); conversations.push(c);
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি এর দাম কত?");
    const sent = messages.filter((m) => m.autoReply);
    expect(sent).toHaveLength(1);
    expect(sent[0].status).toBe("sent");
    expect(sent[0].content).toContain("কটন শাড়ি");
  });

  it("precedence: perChannelModes 'off' + ACTIVE schedule -> still no reply (mode off wins)", async () => {
    const { service, conversations, messages } = inboxSetup();
    await service.updateSettings(ORG, "owner", { perChannelModes: { webchat: "off" }, aiScheduleByChannel: { webchat: ALWAYS_ACTIVE } as any });
    const c = conv(); conversations.push(c);
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি এর দাম কত?");
    expect(messages.filter((m) => m.autoReply)).toHaveLength(0);
    expect(c.autoReplyDueAt ?? null).toBeNull();
  });

  it("precedence: delay > 0 + ACTIVE schedule -> the CX3 defer still happens (dueAt set, nothing sent)", async () => {
    const { service, conversations, messages } = inboxSetup();
    await service.updateSettings(ORG, "owner", { aiReplyDelaySeconds: 45, aiScheduleByChannel: { webchat: ALWAYS_ACTIVE } as any });
    const c = conv(); conversations.push(c);
    await (service as any).maybeAutoReply(ORG, c, CLS("price"), "কটন শাড়ি এর দাম কত?");
    expect(messages.filter((m) => m.autoReply)).toHaveLength(0);
    expect(c.autoReplyDueAt).toBeTruthy();
  });

  it("indicator: list + detail expose aiScheduleActive (false for the blocked channel, true otherwise)", async () => {
    const { service, conversations } = inboxSetup();
    await service.updateSettings(ORG, "owner", { aiScheduleByChannel: { webchat: ALWAYS_BLOCKED } as any });
    const blocked = conv(); conversations.push(blocked);
    const open = conv({ channel: "whatsapp" }); conversations.push(open);
    const list = await service.listConversations(ORG, {});
    expect(list.find((r: any) => r.id === blocked.id)?.aiScheduleActive).toBe(false);
    expect(list.find((r: any) => r.id === open.id)?.aiScheduleActive).toBe(true);
    const detail = await service.getConversation(ORG, blocked.id);
    expect((detail.conversation as any).aiScheduleActive).toBe(false);
  });
});

describe("CX12d order-bot ingest gate", () => {
  async function ingestOrderIntent(service: any, conversations: Row[], messages: Row[]) {
    const c = conv(); conversations.push(c);
    const m = { id: `m-${Math.random().toString(36).slice(2, 8)}`, conversationId: c.id, direction: "in", type: "text", content: "আমি অর্ডার করতে চাই", status: "received", autoReply: false, sentByUserId: null, createdAt: new Date() };
    messages.push(m);
    await (service as any).processInboundIntelligence(ORG, c, m, { content: m.content });
    return c;
  }

  it("botEnabled + blocking schedule: the bot does NOT engage (no session, no bot message)", async () => {
    const { service, conversations, messages, botSessions } = inboxSetup();
    await service.updateSettings(ORG, "owner", { botEnabled: true, aiScheduleByChannel: { webchat: ALWAYS_BLOCKED } as any });
    await ingestOrderIntent(service, conversations, messages);
    expect(botSessions).toHaveLength(0);
    expect(messages.filter((m) => m.direction === "out")).toHaveLength(0);
  });

  it("botEnabled + no schedule (control): the bot engages and asks for the product", async () => {
    const { service, conversations, messages, botSessions } = inboxSetup();
    await service.updateSettings(ORG, "owner", { botEnabled: true });
    await ingestOrderIntent(service, conversations, messages);
    expect(botSessions).toHaveLength(1);
    expect(botSessions[0].state).toBe("ask_product");
  });
});

// ---------- Comments ----------

function commentsSetup(replyDelaySeconds = 0) {
  const replySettings: Row[] = [{
    id: "rs1", organizationId: ORG, aiAutoReplyEnabled: true, sendPrivateDm: true, autoHideSpam: true,
    replyDelaySeconds, tonePreference: "FRIENDLY_SALES", bannedKeywords: [], salesOrderUrl: null,
    nightOwlEnabled: false, urgentAlertTelegramEnabled: false, telegramChatId: null, telegramBotToken: null,
  }];
  const comments: Row[] = [];
  const inboxSettings: Row[] = [{ id: "is1", organizationId: ORG, aiScheduleByChannel: {} }];
  const db = {
    socialReplySetting: table(replySettings),
    socialComment: table(comments),
    product: table([{ id: "p1", organizationId: ORG, name: "লেদার ওয়ালেট", priceMinor: 125000n, currency: "BDT", slug: "wallet", status: "ACTIVE" }] as Row[]),
    lead: table([] as Row[]),
    inboxSetting: table(inboxSettings),
    organization: table([{ id: ORG, name: "টেস্ট শপ", timezone: "UTC" }] as Row[]),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const service = new SocialCommentsService(db as any, audit as any);
  // IN8 seam: comment replies/hides are Graph-first now — stub
  // the Graph client as confirming so the schedule-gate semantics
  // stay the subject under test (Graph layer: in8-comments.spec).
  (service as any).graphClientFor = async () => ({
    replyToComment: async () => ({ commentId: "graph-reply-1" }),
    privateReplyToComment: async () => ({ messageId: "graph-dm-1" }),
    setCommentHidden: async () => ({ success: true }),
    deleteComment: async () => ({ success: true }),
  });
  return { service, db, audit, replySettings, comments, inboxSettings };
}
const cDto = (over: Row = {}): any => ({
  platform: "facebook", externalPostId: "post-1", externalCommentId: `cmt-${Math.random().toString(36).slice(2, 8)}`,
  postTitle: "লেদার ওয়ালেট অফার", authorName: "রাকিব হাসান", authorSocialId: "fb-rakib",
  commentText: "এটার দাম কত ভাই?", ...over,
});

describe("CX12d comments schedule gate", () => {
  it("ingest on facebook with a blocking schedule: stored PENDING, replyText null, aiReplyDueAt null", async () => {
    const { service, inboxSettings } = commentsSetup(25);
    inboxSettings[0].aiScheduleByChannel = { facebook: ALWAYS_BLOCKED };
    const c: any = await service.ingestComment(ORG, cDto());
    expect(c.status).toBe("PENDING");
    expect(c.replyText).toBeNull();
    expect(c.repliedAt).toBeNull();
    expect(c.isPrivateDmSent).toBe(false);
    expect(c.aiReplyDueAt ?? null).toBeNull();
  });

  it("spam comment is still HIDDEN while the schedule blocks (hide is not gated)", async () => {
    const { service, inboxSettings } = commentsSetup(0);
    inboxSettings[0].aiScheduleByChannel = { facebook: ALWAYS_BLOCKED };
    const c: any = await service.ingestComment(ORG, cDto({ commentText: "ঘরে বসে প্রতিদিন ইনকাম করতে টেলিগ্রাম চ্যানেলে জয়েন করুন" }));
    expect(c.status).toBe("HIDDEN");
    expect(c.replyText).toBeNull();
  });

  it("control: no schedule -> the reply is applied at ingest as before (delay 0)", async () => {
    const { service } = commentsSetup(0);
    const c: any = await service.ingestComment(ORG, cDto());
    expect(c.replyText).toBeTruthy();
    expect(c.repliedAt).toBeTruthy();
  });

  it("due comment whose fire time is blocked: stays PENDING with no reply after runDueCommentReplies (drop semantics)", async () => {
    const { service, inboxSettings } = commentsSetup(25);
    const c: any = await service.ingestComment(ORG, cDto());
    expect(c.aiReplyDueAt).toBeTruthy(); // scheduled while the schedule was open
    inboxSettings[0].aiScheduleByChannel = { facebook: ALWAYS_BLOCKED };
    c.aiReplyDueAt = new Date(Date.now() - 1000); // due
    const res = await service.runDueCommentReplies(ORG);
    expect(res.fired).toBe(0);
    expect(c.status).toBe("PENDING");
    expect(c.replyText).toBeNull();
    expect(c.aiReplyDueAt ?? null).toBeNull(); // claim cleared it: cancelled, not retried
  });
});
