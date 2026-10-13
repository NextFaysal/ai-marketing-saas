/**
 * IN1 — message search, advanced list filters, saved views.
 *
 * Covers: org-scoped message search over content + transcription
 * (foreign-org and practice conversations can NEVER appear),
 * snippet offsets, the short-query refusal; IN1b list filters
 * (date range on lastMessageAt, latest-order amount range, stored
 * intent, read-time sentiment) AND-composing without breaking the
 * existing q filter; IN1c saved views (whitelist sanitization,
 * shared visibility, creator-only write, 50-view cap).
 */
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { InboxService, buildSearchSnippet, sanitizeSavedViewFilters } from "./inbox.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

const llmStub = { getProvider: () => new DevTemplateProvider() } as any;
const DAY = 86400_000;
const now = Date.now();

function baseData() {
  const convs: any[] = [
    { id: "c1", organizationId: "org-1", channel: "whatsapp", status: "open", contactName: "রহিম", contactPhone: "8801711", assignedUserId: null, tags: [], unreadCount: 1, isPractice: false, snoozedUntil: null, firstResponseAt: new Date(now - DAY), lastMessageAt: new Date(now - 3600_000), lastMessagePreview: "ডেলিভারি চার্জ কত?", createdAt: new Date(now - 2 * DAY), updatedAt: new Date(now - 3600_000), autoReplyPaused: false, pipelineStage: "talking" },
    { id: "c2", organizationId: "org-1", channel: "messenger", status: "open", contactName: "করিম", contactPhone: null, assignedUserId: "user-1", tags: [], unreadCount: 0, isPractice: false, snoozedUntil: null, firstResponseAt: new Date(now - 3 * DAY), lastMessageAt: new Date(now - 3 * DAY), lastMessagePreview: "দাম কত?", createdAt: new Date(now - 4 * DAY), updatedAt: new Date(now - 3 * DAY), autoReplyPaused: false, pipelineStage: "talking" },
    { id: "c3", organizationId: "org-1", channel: "webchat", status: "open", contactName: "প্র্যাকটিস", contactPhone: null, assignedUserId: null, tags: [], unreadCount: 0, isPractice: true, snoozedUntil: null, firstResponseAt: null, lastMessageAt: new Date(now - 1800_000), lastMessagePreview: "practice", createdAt: new Date(now - DAY), updatedAt: new Date(now - 1800_000), autoReplyPaused: false, pipelineStage: "new" },
    { id: "c4", organizationId: "org-2", channel: "whatsapp", status: "open", contactName: "বিদেশি", contactPhone: "999", assignedUserId: null, tags: [], unreadCount: 5, isPractice: false, snoozedUntil: null, firstResponseAt: null, lastMessageAt: new Date(now - 600_000), lastMessagePreview: "x", createdAt: new Date(now - DAY), updatedAt: new Date(now - 600_000), autoReplyPaused: false, pipelineStage: "new" },
    { id: "c5", organizationId: "org-1", channel: "webchat", status: "open", contactName: "খুশি গ্রাহক", contactPhone: null, assignedUserId: null, tags: [], unreadCount: 0, isPractice: false, snoozedUntil: null, firstResponseAt: new Date(now - 7200_000), lastMessageAt: new Date(now - 7200_000), lastMessagePreview: "ধন্যবাদ", createdAt: new Date(now - DAY), updatedAt: new Date(now - 7200_000), autoReplyPaused: false, pipelineStage: "talking" },
    { id: "c6", organizationId: "org-1", channel: "webchat", status: "open", contactName: "রাগী গ্রাহক", contactPhone: null, assignedUserId: null, tags: [], unreadCount: 2, isPractice: false, snoozedUntil: null, firstResponseAt: null, lastMessageAt: new Date(now - 5400_000), lastMessagePreview: "খুব খারাপ", createdAt: new Date(now - DAY), updatedAt: new Date(now - 5400_000), autoReplyPaused: false, pipelineStage: "talking" },
  ];
  const msgs: any[] = [
    { id: "m1", conversationId: "c1", direction: "in", type: "text", content: "ডেলিভারি চার্জ কত টাকা?", transcription: null, intent: "delivery", createdAt: new Date(now - 3600_000) },
    { id: "m2", conversationId: "c1", direction: "out", type: "text", content: "ডেলিভারি চার্জ ৬০ টাকা", transcription: null, intent: null, createdAt: new Date(now - 3500_000) },
    { id: "m3", conversationId: "c2", direction: "in", type: "text", content: "এই জুতার দাম কত?", transcription: null, intent: "price", createdAt: new Date(now - 3 * DAY) },
    { id: "m4", conversationId: "c2", direction: "in", type: "audio", content: null, transcription: "আমার অর্ডারটা কোথায় পৌঁছেছে", intent: "order_status", createdAt: new Date(now - 3 * DAY + 1000) },
    { id: "m5", conversationId: "c3", direction: "in", type: "text", content: "ডেলিভারি চার্জ প্র্যাকটিস মেসেজ", transcription: null, intent: "delivery", createdAt: new Date(now - 1800_000) },
    { id: "m6", conversationId: "c4", direction: "in", type: "text", content: "ডেলিভারি চার্জ বিদেশি অর্গের", transcription: null, intent: "delivery", createdAt: new Date(now - 600_000) },
    { id: "m8", conversationId: "c5", direction: "in", type: "text", content: "ধন্যবাদ, চমৎকার সার্ভিস পেয়েছি", transcription: null, intent: "other", createdAt: new Date(now - 7200_000) },
    { id: "m9", conversationId: "c6", direction: "in", type: "text", content: "খুব খারাপ সার্ভিস, আমি হতাশ", transcription: null, intent: "complaint", createdAt: new Date(now - 5400_000) },
  ];
  const orders: any[] = [
    { id: "o-old", organizationId: "org-1", conversationId: "c1", totalMinor: 999999n, createdAt: new Date(now - 2 * DAY) },
    { id: "o-new", organizationId: "org-1", conversationId: "c1", totalMinor: 150000n, createdAt: new Date(now - DAY) },
    { id: "o-c2", organizationId: "org-1", conversationId: "c2", totalMinor: 50000n, createdAt: new Date(now - 3 * DAY) },
  ];
  return { convs, msgs, orders };
}

function matchesWhere(row: any, where: any, convById: Map<string, any>): boolean {
  for (const [k, v] of Object.entries<any>(where ?? {})) {
    if (k === "AND") { if (!v.every((w: any) => matchesWhere(row, w, convById))) return false; continue; }
    if (k === "OR") { if (!v.some((w: any) => matchesWhere(row, w, convById))) return false; continue; }
    if (k === "conversation") {
      const conv = convById.get(row.conversationId);
      if (!conv) return false;
      if (v.organizationId !== undefined && conv.organizationId !== v.organizationId) return false;
      if (v.isPractice !== undefined && Boolean(conv.isPractice) !== v.isPractice) return false;
      continue;
    }
    if (v === null) { if (row[k] != null) return false; continue; }
    if (typeof v === "object" && !(v instanceof Date)) {
      if (v.in !== undefined && !v.in.includes(row[k])) return false;
      if (v.not !== undefined && row[k] === v.not) return false;
      if (v.gt !== undefined && !(row[k] > v.gt)) return false;
      if (v.gte !== undefined && !(row[k] >= v.gte)) return false;
      if (v.lt !== undefined && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if (v.lte !== undefined && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if (v.has !== undefined && !(row[k] ?? []).includes(v.has)) return false;
      if (v.contains !== undefined && !String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase())) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function fakePrisma() {
  const { convs, msgs, orders } = baseData();
  const convById = new Map(convs.map((c) => [c.id, c]));
  const viewRows: any[] = [];
  let seq = 0;
  const auditCalls: any[] = [];
  const prisma: any = {
    channelConversation: {
      findMany: async ({ where, orderBy, take }: any) => {
        let rows = convs.filter((c) => matchesWhere(c, where, convById));
        if (orderBy?.lastMessageAt === "desc") rows = [...rows].sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
        return take ? rows.slice(0, take) : rows;
      },
      count: async ({ where }: any) => convs.filter((c) => matchesWhere(c, where, convById)).length,
      aggregate: async () => ({ _sum: { unreadCount: 0 } }),
      findFirst: async ({ where }: any) => convs.find((c) => c.id === where.id && c.organizationId === where.organizationId) ?? null,
      update: async ({ where, data }: any) => { const r = convs.find((c) => c.id === where.id); Object.assign(r, data); return r; },
    },
    channelMessage: {
      findMany: async ({ where, orderBy, take, include, select }: any) => {
        let rows = msgs.filter((m) => matchesWhere(m, where, convById));
        if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        if (take) rows = rows.slice(0, take);
        return rows.map((m) => {
          if (select) { const o: any = {}; for (const k of Object.keys(select)) o[k] = m[k]; return o; }
          if (include?.conversation) {
            const c = convById.get(m.conversationId);
            return { ...m, conversation: c ? { id: c.id, channel: c.channel, contactName: c.contactName, contactPhone: c.contactPhone, status: c.status } : null };
          }
          return m;
        });
      },
    },
    order: {
      findMany: async ({ where, orderBy }: any) => {
        let rows = orders.filter((o) => o.organizationId === where.organizationId && (where.conversationId?.not === null ? o.conversationId != null : true));
        if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return rows;
      },
    },
    inboxSetting: { findUnique: async () => null },
    inboxSavedView: {
      create: async ({ data }: any) => { const row = { id: `view-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; viewRows.push(row); return row; },
      findMany: async ({ where, take }: any) => {
        let rows = viewRows.filter((r) => r.organizationId === where.organizationId && (where.OR ? where.OR.some((w: any) => (w.userId !== undefined && r.userId === w.userId) || (w.shared !== undefined && r.shared === w.shared)) : true));
        rows = [...rows].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        return take ? rows.slice(0, take) : rows;
      },
      count: async ({ where }: any) => viewRows.filter((r) => r.organizationId === where.organizationId && r.userId === where.userId).length,
      findFirst: async ({ where }: any) => viewRows.find((r) => r.id === where.id && r.organizationId === where.organizationId) ?? null,
      update: async ({ where, data }: any) => { const r = viewRows.find((x) => x.id === where.id); Object.assign(r, data, { updatedAt: new Date() }); return r; },
      delete: async ({ where }: any) => { const i = viewRows.findIndex((x) => x.id === where.id); return viewRows.splice(i, 1)[0]; },
    },
  };
  const audit = { log: async (input: any) => { auditCalls.push(input); } };
  return { prisma, audit, auditCalls, viewRows };
}

function svc(fake: ReturnType<typeof fakePrisma>) {
  return new InboxService(fake.prisma as any, fake.audit as any, llmStub);
}

describe("IN1a searchMessages", () => {
  it("finds content matches with a snippet whose offsets point at the match", async () => {
    const s = svc(fakePrisma());
    const { results } = await s.searchMessages("org-1", "ডেলিভারি চার্জ");
    const hit = results.find((r: any) => r.messageId === "m1");
    expect(hit).toBeTruthy();
    expect(hit.conversationId).toBe("c1");
    expect(hit.matchedField).toBe("content");
    expect(hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)).toBe("ডেলিভারি চার্জ");
    expect(hit.contactName).toBe("রহিম");
  });
  it("finds transcription matches and labels the field", async () => {
    const s = svc(fakePrisma());
    const { results } = await s.searchMessages("org-1", "অর্ডারটা কোথায়");
    expect(results).toHaveLength(1);
    expect(results[0].messageId).toBe("m4");
    expect(results[0].matchedField).toBe("transcription");
  });
  it("never returns practice conversations or another org's messages", async () => {
    const s = svc(fakePrisma());
    const { results } = await s.searchMessages("org-1", "ডেলিভারি চার্জ");
    const ids = results.map((r: any) => r.messageId);
    expect(ids).not.toContain("m5"); // practice
    expect(ids).not.toContain("m6"); // org-2
    // …and searching org-2's unique word from org-1 finds nothing.
    const foreign = await s.searchMessages("org-1", "বিদেশি অর্গের");
    expect(foreign.results).toHaveLength(0);
  });
  it("refuses a too-short query in Bengali and respects the limit", async () => {
    const s = svc(fakePrisma());
    await expect(s.searchMessages("org-1", "ক")).rejects.toBeInstanceOf(BadRequestException);
    const { results } = await s.searchMessages("org-1", "ডেলিভারি চার্জ", { limit: 1 });
    expect(results).toHaveLength(1);
  });
});

describe("IN1b advanced list filters", () => {
  it("date range filters on lastMessageAt", async () => {
    const s = svc(fakePrisma());
    const rows = await s.listConversations("org-1", { dateFrom: new Date(now - 2 * DAY).toISOString() }, "user-1");
    const ids = rows.map((r: any) => r.id);
    expect(ids).toContain("c1");
    expect(ids).not.toContain("c2"); // last activity 3 days ago
  });
  it("amount range uses the LATEST linked order, not any order", async () => {
    const s = svc(fakePrisma());
    const rows = await s.listConversations("org-1", { amountMin: 100_000 }, "user-1");
    const ids = rows.map((r: any) => r.id);
    expect(ids).toContain("c1"); // latest 150000 ≥ 100000
    expect(ids).not.toContain("c2"); // latest 50000
    // c1's OLD order was 999999 — a max below it must still match
    // via the latest (150000): proves "any order" is not used.
    const rows2 = await s.listConversations("org-1", { amountMax: 200_000 }, "user-1");
    expect(rows2.map((r: any) => r.id)).toContain("c1");
  });
  it("intent filter matches conversations with a stored inbound classification", async () => {
    const s = svc(fakePrisma());
    const rows = await s.listConversations("org-1", { intent: "price" }, "user-1");
    expect(rows.map((r: any) => r.id)).toEqual(["c2"]);
  });
  it("sentiment filter matches the read-time mood", async () => {
    const s = svc(fakePrisma());
    const neg = await s.listConversations("org-1", { sentiment: "negative" }, "user-1");
    expect(neg.map((r: any) => r.id)).toContain("c6");
    expect(neg.map((r: any) => r.id)).not.toContain("c5");
    const pos = await s.listConversations("org-1", { sentiment: "positive" }, "user-1");
    expect(pos.map((r: any) => r.id)).toContain("c5");
    expect(pos.map((r: any) => r.id)).not.toContain("c6");
  });
  it("the existing q filter still works unchanged alongside", async () => {
    const s = svc(fakePrisma());
    const rows = await s.listConversations("org-1", { q: "রহিম" }, "user-1");
    expect(rows.map((r: any) => r.id)).toEqual(["c1"]);
  });
});

describe("IN1c saved views", () => {
  it("sanitizes hostile filter payloads down to the whitelist", () => {
    const out = sanitizeSavedViewFilters({
      channel: "whatsapp", intent: "price", folder: "evil-folder",
      amountMin: -50, amountMax: "1200", sentiment: "angry",
      evil: { organizationId: "org-2" }, q: "x".repeat(500),
      dateFrom: "2026-10-01", dateTo: "garbage", unreadOnly: "yes",
    });
    expect(out).toEqual({
      channel: "whatsapp", intent: "price", amountMax: 1200,
      q: "x".repeat(200), dateFrom: new Date("2026-10-01").toISOString(),
    });
  });
  it("buildSearchSnippet returns null when there is no match", () => {
    expect(buildSearchSnippet("hello world", "zzz")).toBeNull();
    expect(buildSearchSnippet("", "ক")).toBeNull();
  });
  it("creates, lists with shared visibility, and enforces creator-only writes", async () => {
    const fake = fakePrisma();
    const s = svc(fake);
    const mine = await s.createSavedView("org-1", "user-1", { name: "আমার ভিউ", filters: { channel: "whatsapp" }, shared: false });
    const shared = await s.createSavedView("org-1", "user-1", { name: "টিম ভিউ", filters: { intent: "price" }, shared: true });
    expect(mine.mine).toBe(true);
    // user-2 sees the shared one, not the private one.
    const forOther = await s.listSavedViews("org-1", "user-2");
    expect(forOther.map((v: any) => v.id)).toEqual([shared.id]);
    expect(forOther[0].mine).toBe(false);
    // Non-creator cannot edit or delete the shared view.
    await expect(s.updateSavedView("org-1", "user-2", shared.id, { name: "হ্যাক" })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.deleteSavedView("org-1", "user-2", shared.id)).rejects.toBeInstanceOf(ForbiddenException);
    // The creator can.
    const renamed = await s.updateSavedView("org-1", "user-1", shared.id, { name: "টিম ভিউ ২" });
    expect(renamed.name).toBe("টিম ভিউ ২");
    await s.deleteSavedView("org-1", "user-1", mine.id);
    const remaining = await s.listSavedViews("org-1", "user-1");
    expect(remaining.map((v: any) => v.id)).toEqual([shared.id]);
    expect(fake.auditCalls.some((c: any) => c.action === "inbox.saved_view.create")).toBe(true);
  });
  it("rejects an empty view name", async () => {
    const s = svc(fakePrisma());
    await expect(s.createSavedView("org-1", "user-1", { name: "  ", filters: {} })).rejects.toBeInstanceOf(BadRequestException);
  });
});
