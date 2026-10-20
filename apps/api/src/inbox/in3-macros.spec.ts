import "reflect-metadata";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { InboxService, renderQuickReplyVariables, sanitizeMacroSteps } from "./inbox.service";

/**
 * IN3 — Macros, bulk reply, quick-reply variables.
 *
 * - sanitizeMacroSteps is STRICT: any invalid step is a 400 and
 *   nothing is stored (a dropped step would make a macro silently
 *   do less than its definition shows).
 * - Macro CRUD mirrors saved views: own + shared visible, only
 *   the creator writes, 50-per-user cap.
 * - runMacro executes each step through the real action path
 *   (sendReply / updateConversation / snoozeConversation); the
 *   first failure stops the run and is reported with its index,
 *   type and the verbatim error — later steps are "skipped".
 * - bulkReplyConversations: per-item honest results; a WhatsApp
 *   conversation whose 24h window is closed fails BEFORE any
 *   send attempt; foreign ids are plain "not found".
 * - IN3d variables render ONLY from real rows: missing order /
 *   shipment data renders empty, never invented.
 *
 * Fake prisma only — the only "sends" are to webchat
 * conversations, whose delivery is the stored row itself.
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
    if (k === "AND") return (v as any[]).every((sub) => match(row, sub));
    if (k === "OR") return (v as any[]).some((sub) => match(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("notIn" in v) return !(v.notIn as any[]).includes(row[k]);
      if ("not" in v) {
        if (v.not === null) return row[k] !== null && row[k] !== undefined;
        return !eqVal(row[k], v.not);
      }
      if ("has" in v) return Array.isArray(row[k]) && row[k].includes(v.has);
      if ("contains" in v) return typeof row[k] === "string" && row[k].toLowerCase().includes(String(v.contains).toLowerCase());
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
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => r.id === where.id || match(r, where));
      if (!row) throw new Error("nf");
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === "object" && "increment" in (v as any)) row[k] = (row[k] ?? 0) + (v as any).increment;
        else row[k] = v;
      }
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any = {}) => { let n = 0; for (const r of store) if (match(r, where)) { Object.assign(r, data); n++; } return { count: n }; }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
    aggregate: jest.fn(async ({ where }: any = {}) => ({ _sum: { unreadCount: store.filter((r) => match(r, where)).reduce((s, r) => s + (r.unreadCount ?? 0), 0) } })),
    delete: jest.fn(async ({ where }: any = {}) => { const i = store.findIndex((r) => r.id === where.id); return store.splice(i, 1)[0]; }),
    upsert: jest.fn(async ({ where, create, update }: any = {}) => { const row = store.find((r) => match(r, where)); if (row) { Object.assign(row, update); return row; } const n = { id: `up-${store.length + 1}`, ...create }; store.push(n); return n; }),
  };
}

const ORG = "org-1";
const now = Date.now();

function setup() {
  const settings: Row[] = [{ id: "s1", organizationId: ORG, autoReplyMode: "off", confidenceThreshold: 70, perIntent: {}, smartAssign: "off", slaFirstResponseMinutes: 60, perChannelModes: {}, escalationThresholdMinor: null, botDeliveryChargeMinor: 6000 }];
  const conversations: Row[] = [
    { id: "c-web", organizationId: ORG, channel: "webchat", status: "open", contactName: "রহিম উদ্দিন", contactPhone: "01711000000", externalContactId: "vis-1", assignedUserId: null, tags: [], unreadCount: 1, isPractice: false, snoozedUntil: null, autoReplyPaused: false, pipelineStage: "new", firstResponseAt: null, lastCustomerMessageAt: new Date(now - 3600_000), createdAt: new Date(now - 7200_000), updatedAt: new Date(now - 3600_000) },
    { id: "c-web2", organizationId: ORG, channel: "webchat", status: "open", contactName: "করিম", contactPhone: null, externalContactId: "vis-2", assignedUserId: null, tags: [], unreadCount: 0, isPractice: false, snoozedUntil: null, autoReplyPaused: false, pipelineStage: "new", firstResponseAt: null, lastCustomerMessageAt: new Date(now - 3600_000), createdAt: new Date(now - 7200_000), updatedAt: new Date(now - 3600_000) },
    { id: "c-wa-closed", organizationId: ORG, channel: "whatsapp", status: "open", contactName: "সালমা", contactPhone: "01811000000", externalContactId: "8801811000000", assignedUserId: null, tags: [], unreadCount: 0, isPractice: false, snoozedUntil: null, autoReplyPaused: false, pipelineStage: "new", firstResponseAt: null, lastCustomerMessageAt: new Date(now - 48 * 3600_000), createdAt: new Date(now - 50 * 3600_000), updatedAt: new Date(now - 48 * 3600_000) },
    { id: "c-wa-open", organizationId: ORG, channel: "whatsapp", status: "open", contactName: "জামাল", contactPhone: "01911000000", externalContactId: "8801911000000", assignedUserId: null, tags: [], unreadCount: 0, isPractice: false, snoozedUntil: null, autoReplyPaused: false, pipelineStage: "new", firstResponseAt: null, lastCustomerMessageAt: new Date(now - 3600_000), createdAt: new Date(now - 7200_000), updatedAt: new Date(now - 3600_000) },
    { id: "c-foreign", organizationId: "org-2", channel: "webchat", status: "open", contactName: "বিদেশি", contactPhone: null, externalContactId: "vis-9", assignedUserId: null, tags: [], unreadCount: 0, isPractice: false, snoozedUntil: null, autoReplyPaused: false, pipelineStage: "new", firstResponseAt: null, createdAt: new Date(now - 7200_000), updatedAt: new Date(now - 3600_000) },
  ];
  const quickReplies: Row[] = [
    { id: "qr-1", organizationId: ORG, title: "অর্ডার আপডেট", content: "আসসালামু আলাইকুম {{firstName}}, আপনার অর্ডার {{orderId}} পথে আছে। ট্র্যাকিং: {{trackingLink}} ডেলিভারি চার্জ: {{deliveryCharge}}", timesUsed: 0 },
  ];
  const orders: Row[] = [
    { id: "o-1", organizationId: ORG, conversationId: "c-web", customerId: null, externalNumber: "ORD-1001", totalMinor: 150000n, currency: "BDT", status: "processing", createdAt: new Date(now - 3600_000) },
  ];
  const shipments: Row[] = [
    { id: "sh-1", organizationId: ORG, orderId: "o-1", provider: "steadfast", trackingCode: "TRK-1", trackingToken: null, status: "in_transit", createdAt: new Date(now - 1800_000) },
  ];
  const db = {
    inboxSetting: table(settings),
    inboxMacro: table([] as Row[]),
    quickReply: table(quickReplies),
    whatsAppTemplate: table([{ id: "tpl-1", organizationId: ORG, name: "order_update", language: "bn", bodyText: "আপডেট" }] as Row[]),
    channelConversation: table(conversations),
    channelMessage: table([] as Row[]),
    conversationNote: table([] as Row[]),
    messageDraft: table([] as Row[]),
    botSession: table([] as Row[]),
    membership: table([
      { id: "m1", organizationId: ORG, userId: "owner", role: "OWNER", status: "ACTIVE" },
      { id: "m2", organizationId: ORG, userId: "agent-1", role: "SUPPORT_AGENT", status: "ACTIVE" },
      { id: "m3", organizationId: ORG, userId: "agent-2", role: "SUPPORT_AGENT", status: "ACTIVE" },
    ] as Row[]),
    order: table(orders),
    courierShipment: table(shipments),
    agentNotification: table([] as Row[]),
    agentState: table([] as Row[]),
    agentPresence: table([] as Row[]),
    organization: table([{ id: ORG, name: "টেস্ট শপ", timezone: "Asia/Dhaka" }] as Row[]),
    inboxTeam: table([] as Row[]),
    inboxTeamMember: table([] as Row[]),
    agentSchedule: table([] as Row[]),
    businessProfile: table([] as Row[]),
    businessPolicy: table([] as Row[]),
    product: table([] as Row[]),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const svc = new InboxService(db as any, audit as any, { getProvider: () => ({ isRealLlm: false, name: "dev-template" }) } as any);
  return { svc, db, audit, conversations, quickReplies, shipments };
}

describe("IN3 sanitizeMacroSteps (strict)", () => {
  it("normalizes a valid combination", () => {
    const steps = sanitizeMacroSteps([
      { type: "reply", quickReplyId: " qr-1 " },
      { type: "assign", assignedUserId: "me" },
      { type: "tag", tag: " vip " },
      { type: "pipeline", stage: "talking" },
      { type: "close", outcome: "sale" },
      { type: "snooze", minutes: 60 },
    ]);
    expect(steps).toEqual([
      { type: "reply", quickReplyId: "qr-1" },
      { type: "assign", assignedUserId: "me" },
      { type: "tag", tag: "vip" },
      { type: "pipeline", stage: "talking" },
      { type: "close", outcome: "sale" },
      { type: "snooze", minutes: 60 },
    ]);
  });
  it("rejects empty / unknown / malformed steps instead of dropping them", () => {
    expect(() => sanitizeMacroSteps([])).toThrow(expect.objectContaining({ code: "inbox.aMacroMustHaveAtLeast" }));
    expect(() => sanitizeMacroSteps([{ type: "explode" }])).toThrow(expect.objectContaining({ code: "inbox.unknownMacroStepStepsCanBe" }));
    expect(() => sanitizeMacroSteps([{ type: "reply" }])).toThrow(expect.objectContaining({ code: "inbox.forTheReplyStepChooseA" }));
    expect(() => sanitizeMacroSteps([{ type: "snooze", minutes: 2 }])).toThrow(expect.objectContaining({ code: "inbox.theSnoozeStepMustBeBetween" }));
    expect(() => sanitizeMacroSteps([{ type: "pipeline", stage: "shipped" }])).toThrow(expect.objectContaining({ code: "inbox.thePipelineStepSStageIs" }));
    expect(() => sanitizeMacroSteps(Array.from({ length: 11 }, () => ({ type: "close" })))).toThrow(expect.objectContaining({ code: "inbox.aMacroCanHaveAtMost" }));
    expect(() => sanitizeMacroSteps("nope")).toThrow(expect.objectContaining({ code: "inbox.aMacroMustHaveAtLeast" }));
  });
});

describe("IN3d renderQuickReplyVariables", () => {
  it("renders real values, empties missing ones, leaves unknown placeholders", () => {
    const out = renderQuickReplyVariables("হ্যালো {{firstName}} ({{contactName}}), অর্ডার {{orderId}}, লিংক: {{trackingLink}} চার্জ {{deliveryCharge}} {{unknown}}", {
      firstName: "রহিম", contactName: "রহিম উদ্দিন", phone: "", orderId: "", trackingLink: "", deliveryCharge: "BDT 60.00",
    });
    expect(out).toContain("হ্যালো রহিম (রহিম উদ্দিন)");
    expect(out).toContain("অর্ডার ,"); // no order -> empty, never invented
    expect(out).toContain("চার্জ BDT 60.00");
    expect(out).toContain("{{unknown}}");
  });
});

describe("IN3 macro CRUD + visibility", () => {
  it("creates with normalized steps; invalid steps store nothing", async () => {
    const { svc, db } = setup();
    const created = await svc.createMacro(ORG, "agent-1", { name: "অর্ডার ফলোআপ", steps: [{ type: "tag", tag: "followup" }], shared: false });
    expect(created.steps).toEqual([{ type: "tag", tag: "followup" }]);
    await expect(svc.createMacro(ORG, "agent-1", { name: "খারাপ", steps: [{ type: "nope" }] })).rejects.toMatchObject({ code: "inbox.unknownMacroStepStepsCanBe" });
    expect((db.inboxMacro as any).findMany).toBeDefined();
    const rows = await svc.listMacros(ORG, "agent-1");
    expect(rows).toHaveLength(1);
  });
  it("shared macros are visible to the team; private ones are not; only the creator writes", async () => {
    const { svc } = setup();
    const priv = await svc.createMacro(ORG, "agent-1", { name: "ব্যক্তিগত", steps: [{ type: "close" }] });
    const shared = await svc.createMacro(ORG, "agent-1", { name: "টিমের", steps: [{ type: "close" }], shared: true });
    const mine = await svc.listMacros(ORG, "agent-1");
    const theirs = await svc.listMacros(ORG, "agent-2");
    expect(mine.map((m: any) => m.id)).toEqual(expect.arrayContaining([priv.id, shared.id]));
    expect(theirs.map((m: any) => m.id)).toEqual([shared.id]);
    await expect(svc.updateMacro(ORG, "agent-2", shared.id, { name: "হাইজ্যাক" })).rejects.toMatchObject({ code: "inbox.onlyTheMacroSOwnerCan" });
    await expect(svc.deleteMacro(ORG, "agent-2", shared.id)).rejects.toMatchObject({ code: "inbox.onlyTheMacroSOwnerCan2" });
    await expect(svc.runMacro(ORG, "agent-2", priv.id, "c-web")).rejects.toMatchObject({ code: "inbox.macroNotFoundInThisOrganization" });
  });
  it("enforces the 50-per-user cap", async () => {
    const { svc } = setup();
    for (let i = 0; i < 50; i++) await svc.createMacro(ORG, "agent-1", { name: `m${i}`, steps: [{ type: "close" }] });
    await expect(svc.createMacro(ORG, "agent-1", { name: "একটি বেশি", steps: [{ type: "close" }] })).rejects.toMatchObject({ code: "inbox.yourMacroLimit50IsFull" });
  });
});

describe("IN3 runMacro", () => {
  it("runs reply → assign(me) → tag → pipeline → snooze through the real paths", async () => {
    const { svc, db, audit, conversations, quickReplies, shipments } = setup();
    const macro = await svc.createMacro(ORG, "agent-1", {
      name: "সম্পূর্ণ ফলোআপ",
      steps: [
        { type: "reply", quickReplyId: "qr-1" },
        { type: "assign", assignedUserId: "me" },
        { type: "tag", tag: "followup" },
        { type: "pipeline", stage: "talking" },
        { type: "snooze", minutes: 120 },
      ],
    });
    const result = await svc.runMacro(ORG, "agent-1", macro.id, "c-web");
    expect(result.success).toBe(true);
    expect(result.completed).toBe(5);
    expect(result.steps.every((s: any) => s.ok)).toBe(true);
    const conv = conversations.find((c) => c.id === "c-web")!;
    expect(conv.assignedUserId).toBe("agent-1");
    expect(conv.tags).toContain("followup");
    expect(conv.pipelineStage).toBe("talking");
    expect(new Date(conv.snoozedUntil).getTime()).toBeGreaterThan(now);
    // The reply is a real stored outbound row with IN3d variables
    // rendered from the real order/shipment/settings.
    const msgs = (db.channelMessage as any);
    const rows = await msgs.findMany({ where: { conversationId: "c-web", direction: "out" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");
    expect(rows[0].content).toContain("রহিম");
    expect(rows[0].content).toContain("ORD-1001");
    expect(rows[0].content).toContain("/t/");
    expect(rows[0].content).toContain("BDT 60.00");
    expect(shipments[0].trackingToken).toBeTruthy(); // minted lazily, like shareTracking
    expect(quickReplies[0].timesUsed).toBe(1); // counted only on a confirmed send
    expect(audit.calls.some((c: any) => c.action === "inbox.macro.run")).toBe(true);
  });

  it("stops at the first failed step and reports it — later steps are skipped, never done", async () => {
    const { svc, audit, conversations } = setup();
    const macro = await svc.createMacro(ORG, "agent-1", {
      name: "মাঝপথে ভাঙা",
      steps: [
        { type: "tag", tag: "tried" },
        { type: "reply", quickReplyId: "qr-deleted" },
        { type: "assign", assignedUserId: "agent-2" },
      ],
    });
    const result = await svc.runMacro(ORG, "agent-1", macro.id, "c-web");
    expect(result.success).toBe(false);
    expect(result.completed).toBe(1);
    expect(result.steps[1]).toMatchObject({ index: 1, type: "reply", ok: false });
    expect(result.steps[1].error).toContain("পাওয়া যায়নি");
    expect(result.steps[2]).toMatchObject({ index: 2, type: "assign", ok: false, skipped: true });
    const conv = conversations.find((c) => c.id === "c-web")!;
    expect(conv.tags).toContain("tried"); // the completed step stands — the result says exactly that
    expect(conv.assignedUserId).toBeNull(); // the skipped step did NOT happen
    const failAudit = audit.calls.find((c: any) => c.action === "inbox.macro.run_failed");
    expect(failAudit?.metadata).toMatchObject({ failedStepIndex: 1, failedStepType: "reply" });
  });

  it("a platform failure inside the reply step surfaces verbatim and marks the row failed", async () => {
    const { svc, db } = setup();
    const macro = await svc.createMacro(ORG, "agent-1", {
      name: "WA reply",
      steps: [{ type: "reply", quickReplyId: "qr-1" }],
    });
    // WhatsApp window is OPEN for c-wa-open, but there is no Meta
    // integration in this fake — delivery must fail honestly.
    const result = await svc.runMacro(ORG, "agent-1", macro.id, "c-wa-open");
    expect(result.success).toBe(false);
    expect(result.steps[0].ok).toBe(false);
    expect(result.steps[0].error).toContain("পাঠানো হয়নি");
    const rows = await (db.channelMessage as any).findMany({ where: { conversationId: "c-wa-open" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
  });
});

describe("IN3c bulkReplyConversations", () => {
  it("per-item honesty: webchat sent, WhatsApp window-closed failed pre-send, foreign/missing not found", async () => {
    const { svc, db, audit } = setup();
    const r = await svc.bulkReplyConversations(ORG, "agent-1", {
      ids: ["c-web", "c-wa-closed", "c-foreign", "c-missing"],
      quickReplyId: "qr-1",
    });
    expect(r.succeeded).toBe(1);
    expect(r.failed).toBe(3);
    const byId = new Map(r.results.map((x: any) => [x.id, x]));
    expect(byId.get("c-web")?.ok).toBe(true);
    expect(byId.get("c-wa-closed")?.ok).toBe(false);
    expect(byId.get("c-wa-closed")?.error).toContain("উইন্ডো বন্ধ");
    expect(byId.get("c-foreign")?.ok).toBe(false);
    expect(byId.get("c-missing")?.ok).toBe(false);
    // NOTHING was sent to the window-closed conversation.
    const waMsgs = await (db.channelMessage as any).findMany({ where: { conversationId: "c-wa-closed" } });
    expect(waMsgs).toHaveLength(0);
    // The one real send rendered this conversation's own variables.
    const webMsgs = await (db.channelMessage as any).findMany({ where: { conversationId: "c-web" } });
    expect(webMsgs[0].content).toContain("ORD-1001");
    expect(audit.calls.filter((c: any) => c.action === "inbox.conversations.bulk_reply")).toHaveLength(1);
  });

  it("renders order variables EMPTY for a conversation with no order (never invented)", async () => {
    const { svc, db } = setup();
    const r = await svc.bulkReplyConversations(ORG, "agent-1", { ids: ["c-web2"], quickReplyId: "qr-1" });
    expect(r.succeeded).toBe(1);
    const msgs = await (db.channelMessage as any).findMany({ where: { conversationId: "c-web2" } });
    expect(msgs[0].content).toContain("করিম");
    expect(msgs[0].content).not.toContain("{{orderId}}");
    expect(msgs[0].content).toContain("অর্ডার  পথে আছে"); // empty slot, no fabricated id
    expect(msgs[0].content).toContain("BDT 60.00"); // delivery charge is a real org setting
  });

  it("requires exactly one of quickReplyId / templateId and caps at 25", async () => {
    const { svc } = setup();
    await expect(svc.bulkReplyConversations(ORG, "agent-1", { ids: ["c-web"] })).rejects.toMatchObject({ code: "inbox.forABulkReplyChooseExactly" });
    await expect(svc.bulkReplyConversations(ORG, "agent-1", { ids: ["c-web"], quickReplyId: "qr-1", templateId: "tpl-1" })).rejects.toMatchObject({ code: "inbox.forABulkReplyChooseExactly" });
    await expect(svc.bulkReplyConversations(ORG, "agent-1", { ids: Array.from({ length: 26 }, (_, i) => `c-${i}`), quickReplyId: "qr-1" })).rejects.toMatchObject({ code: "inbox.bulkRepliesCanBeSentTo" });
    await expect(svc.bulkReplyConversations(ORG, "agent-1", { ids: ["c-web"], quickReplyId: "qr-nope" })).rejects.toMatchObject({ code: "inbox.quickReplyNotFoundInThis" });
  });

  it("template bulk to a non-WhatsApp conversation fails per-item (WhatsApp-only), never a fake success", async () => {
    const { svc } = setup();
    const r = await svc.bulkReplyConversations(ORG, "agent-1", { ids: ["c-web"], templateId: "tpl-1" });
    expect(r.succeeded).toBe(0);
    expect(r.results[0].error).toContain("শুধু WhatsApp-এর জন্য");
  });
});
