/**
 * Inbox Next-Gen P2 — smart folders, bulk actions, product cards.
 *
 * Covers: the folder where-clauses + server-side counts (SLA
 * breach definition, VIP threshold reuse incl. the unset case),
 * the bulk endpoint (per-item results, tenant isolation, cap,
 * same-path semantics + one batch audit entry), the product card
 * composer/parser round-trip, sendProductCard's honest outcomes
 * (image+caption on webchat, text fallback without an image,
 * platform rejection NOT masked on Messenger), and the webchat
 * visitor projection's product marker.
 */
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.MEDIA_LOCAL_DIR = mkdtempSync(join(tmpdir(), "nextgen-p2-"));

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { InboxService } from "./inbox.service";
import { WebchatService } from "./webchat.service";
import { composeProductCardText, parseProductCard } from "./product-card";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

const llmStub = { getProvider: () => new DevTemplateProvider() } as any;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

function makeAudit() {
  const calls: any[] = [];
  return { calls, log: async (input: any) => { calls.push(input); } };
}

const HOUR = 3600_000;
function baseConvs() {
  const now = Date.now();
  return [
    // SLA breach: open, no first response, 3h old (threshold 60m)
    { id: "c-breach", organizationId: "org-1", channel: "webchat", status: "open", firstResponseAt: null, assignedUserId: null, tags: [], createdAt: new Date(now - 3 * HOUR), pipelineStage: "new", autoReplyPaused: false, integrationId: null, externalContactId: "v-1", csatSentAt: null, unreadCount: 2 },
    // Not a breach: responded already
    { id: "c-answered", organizationId: "org-1", channel: "webchat", status: "open", firstResponseAt: new Date(now - 2 * HOUR), assignedUserId: "user-1", tags: ["vip"], createdAt: new Date(now - 3 * HOUR), pipelineStage: "talking", autoReplyPaused: false, integrationId: null, externalContactId: "v-2", csatSentAt: null, unreadCount: 0 },
    // Not a breach: too young
    { id: "c-young", organizationId: "org-1", channel: "whatsapp", status: "open", firstResponseAt: null, assignedUserId: null, tags: [], createdAt: new Date(now - 10 * 60_000), pipelineStage: "new", autoReplyPaused: false, integrationId: null, externalContactId: "8801", csatSentAt: null, unreadCount: 1 },
    // Closed never breaches
    { id: "c-closed", organizationId: "org-1", channel: "webchat", status: "closed", firstResponseAt: null, assignedUserId: "user-2", tags: [], createdAt: new Date(now - 5 * HOUR), pipelineStage: "delivered", autoReplyPaused: false, integrationId: null, externalContactId: "v-3", csatSentAt: null, unreadCount: 0 },
    // Pending without a first response still breaches (definition)
    { id: "c-pending-breach", organizationId: "org-1", channel: "webchat", status: "pending", firstResponseAt: null, assignedUserId: null, tags: [], createdAt: new Date(now - 2 * HOUR), pipelineStage: "new", autoReplyPaused: false, integrationId: null, externalContactId: "v-4", csatSentAt: null, unreadCount: 0 },
    // Another org's conversation (isolation)
    { id: "c-foreign", organizationId: "org-2", channel: "webchat", status: "open", firstResponseAt: null, assignedUserId: null, tags: [], createdAt: new Date(now - 9 * HOUR), pipelineStage: "new", autoReplyPaused: false, integrationId: null, externalContactId: "v-9", csatSentAt: null, unreadCount: 3 },
  ];
}

function matchesWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries<any>(where)) {
    if (k === "AND") { if (!v.every((w: any) => matchesWhere(row, w))) return false; continue; }
    if (k === "OR") { if (!v.some((w: any) => matchesWhere(row, w))) return false; continue; }
    if (v === null) { if (row[k] != null) return false; continue; }
    if (typeof v === "object" && !(v instanceof Date)) {
      if (v.in !== undefined && !v.in.includes(row[k])) return false;
      if (v.not !== undefined && row[k] === v.not) return false;
      if (v.lt !== undefined && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if (v.gt !== undefined && !(row[k] > v.gt)) return false;
      if (v.has !== undefined && !(row[k] ?? []).includes(v.has)) return false;
      if (v.contains !== undefined && !String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase())) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function fakePrisma(opts: { threshold?: number | null; orders?: any[]; products?: any[] } = {}) {
  const convRows: any[] = baseConvs();
  const msgRows: any[] = [];
  const audit = makeAudit();
  let seq = 0;
  const setting = { organizationId: "org-1", slaFirstResponseMinutes: 60, escalationThresholdMinor: opts.threshold === undefined ? 100_000 : opts.threshold };
  const orders = opts.orders ?? [
    { organizationId: "org-1", conversationId: "c-answered", totalMinor: 50000n, createdAt: new Date(Date.now() - 2 * HOUR) },
    { organizationId: "org-1", conversationId: "c-answered", totalMinor: 150000n, createdAt: new Date(Date.now() - 3 * HOUR) }, // older: NOT latest
    { organizationId: "org-1", conversationId: "c-breach", totalMinor: 200000n, createdAt: new Date(Date.now() - 1 * HOUR) },
    { organizationId: "org-1", conversationId: null, totalMinor: 999999n, createdAt: new Date() },
    { organizationId: "org-2", conversationId: "c-foreign", totalMinor: 500000n, createdAt: new Date() },
  ];
  const products = opts.products ?? [
    { id: "p-1", organizationId: "org-1", name: "কটন পাঞ্জাবি", priceMinor: 150000n, currency: "BDT", stockQuantity: 7, imageUrl: "https://cdn.example.com/panjabi.png" },
    { id: "p-noimg", organizationId: "org-1", name: "হাতে বোনা শাল", priceMinor: 80000n, currency: "BDT", stockQuantity: 0, imageUrl: null },
  ];
  const prisma: any = {
    channelConversation: {
      findMany: async ({ where }: any) => convRows.filter((c) => matchesWhere(c, where)),
      count: async ({ where }: any) => convRows.filter((c) => matchesWhere(c, where)).length,
      aggregate: async ({ where }: any) => ({ _sum: { unreadCount: convRows.filter((c) => matchesWhere(c, where)).reduce((s, c) => s + (c.unreadCount ?? 0), 0) } }),
      findFirst: async ({ where }: any) => convRows.find((c) => c.id === where.id && c.organizationId === where.organizationId) ?? null,
      update: async ({ where, data }: any) => { const row = convRows.find((c) => c.id === where.id); Object.assign(row, data); return row; },
    },
    channelMessage: {
      create: async ({ data }: any) => { const row = { id: `msg-${++seq}`, createdAt: new Date(), ...data }; msgRows.push(row); return row; },
      update: async ({ where, data }: any) => { const row = msgRows.find((m) => m.id === where.id); Object.assign(row, data); return row; },
      findFirst: async () => null,
    },
    inboxSetting: { findUnique: async ({ where }: any) => (where.organizationId === "org-1" ? setting : null) },
    order: { findMany: async ({ where }: any) => orders.filter((o) => o.organizationId === where.organizationId && (where.conversationId?.not === null ? o.conversationId != null : true)) },
    product: { findFirst: async ({ where }: any) => products.find((p) => p.id === where.id && p.organizationId === where.organizationId) ?? null },
    membership: {
      findFirst: async ({ where }: any) => (["user-1", "user-2"].includes(where.userId) && where.organizationId === "org-1" ? { userId: where.userId } : null),
      findMany: async () => [],
    },
    integration: { findFirst: async () => null, findUnique: async () => null },
  };
  return { prisma, convRows, msgRows, audit };
}

function svc(fake: ReturnType<typeof fakePrisma>) {
  return new InboxService(fake.prisma as any, fake.audit as any, llmStub);
}

describe("smart folders: list filter", () => {
  it("folder=sla returns only unanswered, old enough, non-closed conversations of the org", async () => {
    const fake = fakePrisma();
    const rows = await svc(fake).listConversations("org-1", { folder: "sla" }, "user-1");
    expect(rows.map((r: any) => r.id).sort()).toEqual(["c-breach", "c-pending-breach"]);
  });

  it("folder=vip uses the LATEST linked order against the escalation threshold", async () => {
    const fake = fakePrisma();
    const rows = await svc(fake).listConversations("org-1", { folder: "vip" }, "user-1");
    // c-answered's latest order is 50000 (< 100000) even though an
    // older one was 150000; c-breach's latest is 200000 (>= threshold).
    expect(rows.map((r: any) => r.id)).toEqual(["c-breach"]);
  });

  it("folder=vip is empty when the threshold is unset — never a guessed folder", async () => {
    const fake = fakePrisma({ threshold: null });
    const rows = await svc(fake).listConversations("org-1", { folder: "vip" }, "user-1");
    expect(rows).toEqual([]);
  });

  it("folder composes with other filters (AND semantics)", async () => {
    const fake = fakePrisma();
    const rows = await svc(fake).listConversations("org-1", { folder: "sla", channel: "whatsapp" }, "user-1");
    expect(rows).toEqual([]); // the whatsapp conversation is too young to breach
  });

  it("folder=mine mirrors assignee=me", async () => {
    const fake = fakePrisma();
    const rows = await svc(fake).listConversations("org-1", { folder: "mine" }, "user-1");
    expect(rows.map((r: any) => r.id)).toEqual(["c-answered"]);
  });
});

describe("smart folders: server-side counts", () => {
  it("counts every folder from real fields, scoped to the org", async () => {
    const fake = fakePrisma();
    const counts = await svc(fake).conversationFolderCounts("org-1", "user-1");
    expect(counts.all).toBe(5);
    expect(counts.mine).toBe(1);
    expect(counts.unassigned).toBe(3);
    expect(counts.slaBreach).toBe(2);
    expect(counts.vip).toBe(1);
    expect(counts.vipThresholdMinor).toBe("100000");
    expect(counts.slaFirstResponseMinutes).toBe(60);
    // UX1 Q2: unreadTotal is the org-wide sum of stored unreadCount
    // (c-breach 2 + c-young 1 = 3); the other org's 3 never leaks in.
    expect(counts.unreadTotal).toBe(3);
  });

  it("vip count is 0 and threshold null when unset", async () => {
    const fake = fakePrisma({ threshold: null });
    const counts = await svc(fake).conversationFolderCounts("org-1", "user-1");
    expect(counts.vip).toBe(0);
    expect(counts.vipThresholdMinor).toBeNull();
  });
});

describe("bulk actions", () => {
  it("close: applies single-update semantics per item and writes ONE batch audit entry", async () => {
    const fake = fakePrisma();
    const out = await svc(fake).bulkUpdateConversations("org-1", "user-1", { ids: ["c-breach", "c-young"], action: "close" });
    expect(out).toMatchObject({ succeeded: 2, failed: 0 });
    expect(fake.convRows.find((c) => c.id === "c-breach")?.status).toBe("closed");
    expect(fake.convRows.find((c) => c.id === "c-breach")?.resolvedAt).toBeInstanceOf(Date);
    expect(fake.audit.calls).toHaveLength(1);
    expect(fake.audit.calls[0]).toMatchObject({ action: "inbox.conversations.bulk", metadata: { bulkAction: "close", requested: 2, succeeded: 2, failed: 0 } });
  });

  it("a foreign id reports not-found and never leaks or fails the batch", async () => {
    const fake = fakePrisma();
    const out = await svc(fake).bulkUpdateConversations("org-1", "user-1", { ids: ["c-foreign", "c-young"], action: "mark-read" });
    expect(out.succeeded).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.results.find((r) => r.id === "c-foreign")).toMatchObject({ ok: false });
    expect(out.results.find((r) => r.id === "c-foreign")?.error).toContain("conversation পাওয়া যায়নি");
    expect(fake.convRows.find((c) => c.id === "c-foreign")?.unreadCount).toBe(3); // untouched
    expect(fake.convRows.find((c) => c.id === "c-young")?.unreadCount).toBe(0);
  });

  it("assign validates membership through updateConversation; tag-add merges with existing tags", async () => {
    const fake = fakePrisma();
    const bad = await svc(fake).bulkUpdateConversations("org-1", "user-1", { ids: ["c-breach"], action: "assign", assignedUserId: "ghost" });
    expect(bad.results[0]).toMatchObject({ ok: false });
    expect(bad.results[0].error).toContain("সদস্য নন");
    const good = await svc(fake).bulkUpdateConversations("org-1", "user-1", { ids: ["c-breach"], action: "assign", assignedUserId: "user-2" });
    expect(good.results[0].ok).toBe(true);
    expect(fake.convRows.find((c) => c.id === "c-breach")?.assignedUserId).toBe("user-2");
    const tagged = await svc(fake).bulkUpdateConversations("org-1", "user-1", { ids: ["c-answered"], action: "tag-add", tag: "follow-up" });
    expect(tagged.results[0].ok).toBe(true);
    expect(fake.convRows.find((c) => c.id === "c-answered")?.tags).toEqual(["vip", "follow-up"]);
  });

  it("caps the batch at 25 and rejects empty/invalid requests", async () => {
    const fake = fakePrisma();
    const s = svc(fake);
    await expect(s.bulkUpdateConversations("org-1", "user-1", { ids: Array.from({ length: 26 }, (_, i) => `x-${i}`), action: "close" })).rejects.toMatchObject({ code: "inbox.bulkActionsCanBeAppliedTo" });
    await expect(s.bulkUpdateConversations("org-1", "user-1", { ids: [], action: "close" })).rejects.toMatchObject({ code: "inbox.selectAtLeastOneConversation" });
    await expect(s.bulkUpdateConversations("org-1", "user-1", { ids: ["c-breach"], action: "explode" })).rejects.toMatchObject({ code: "inbox.invalidBulkActionCloseAssignTag" });
    await expect(s.bulkUpdateConversations("org-1", "user-1", { ids: ["c-breach"], action: "tag-add" })).rejects.toMatchObject({ code: "inbox.tagIsRequiredForTheTag" });
  });
});

describe("product card text (compose + parse round-trip)", () => {
  it("composes name, real formatted price, stock and the order line", () => {
    const text = composeProductCardText({ name: "কটন পাঞ্জাবি", priceMinor: 150000n, currency: "BDT", stockQuantity: 7 });
    expect(text.split("\n")[0]).toBe("🛍️ কটন পাঞ্জাবি");
    expect(text).toContain("দাম: BDT 1500.00");
    expect(text).toContain("স্টক: 7টি আছে");
    expect(text).toContain("অর্ডার করতে চাইলে");
  });

  it("parse recognises only composed outbound image cards", () => {
    const text = composeProductCardText({ name: "শাল", priceMinor: 80000n, currency: "BDT", stockQuantity: 0 });
    expect(parseProductCard({ type: "image", direction: "out", content: text })).toEqual({ name: "শাল", priceText: "BDT 800.00" });
    expect(parseProductCard({ type: "text", direction: "out", content: text })).toBeNull();
    expect(parseProductCard({ type: "image", direction: "in", content: text })).toBeNull();
    expect(parseProductCard({ type: "image", direction: "out", content: "এমনি একটা ছবি" })).toBeNull();
    expect(parseProductCard({ type: "image", direction: "out", content: null })).toBeNull();
  });
});

describe("sendProductCard", () => {
  const fetchOk = (bytes: Buffer, type = "image/png") => (async () => ({
    ok: true, status: 200,
    headers: { get: (h: string) => (h === "content-type" ? type : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  })) as any;

  it("webchat with a fetchable image: image+caption through the P1 media path", async () => {
    const fake = fakePrisma();
    (globalThis as any).fetch = fetchOk(PNG);
    const out = await svc(fake).sendProductCard("org-1", "user-1", "c-breach", { productId: "p-1" });
    expect(out.sentAs).toBe("image+caption");
    expect(out.message.type).toBe("image");
    expect(out.message.status).toBe("sent");
    expect(out.message.content).toContain("🛍️ কটন পাঞ্জাবি");
    expect(out.message.content).toContain("দাম: BDT 1500.00");
    expect(out.message.mediaStorageKey).toBeTruthy();
  });

  it("no image on the product: honest text fallback carrying the same card text", async () => {
    const fake = fakePrisma();
    const out = await svc(fake).sendProductCard("org-1", "user-1", "c-breach", { productId: "p-noimg" });
    expect(out.sentAs).toBe("text");
    expect(out.message.type).toBe("text");
    expect(out.message.status).toBe("sent");
    expect(out.message.content).toContain("হাতে বোনা শাল");
    expect(out.message.content).toContain("স্টক: আপাতত শেষ");
  });

  it("unfetchable image URL also falls back to text (nothing was sent yet)", async () => {
    const fake = fakePrisma();
    (globalThis as any).fetch = async () => ({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });
    const out = await svc(fake).sendProductCard("org-1", "user-1", "c-breach", { productId: "p-1" });
    expect(out.sentAs).toBe("text");
  });

  it("messenger without an integration: platform rejection is NOT masked by a text fallback", async () => {
    const fake = fakePrisma();
    fake.convRows.push({ id: "c-msg", organizationId: "org-1", channel: "messenger", status: "open", firstResponseAt: null, assignedUserId: null, tags: [], createdAt: new Date(), pipelineStage: "new", autoReplyPaused: false, integrationId: null, externalContactId: "psid-1", csatSentAt: null, unreadCount: 0 });
    (globalThis as any).fetch = fetchOk(PNG);
    await expect(svc(fake).sendProductCard("org-1", "user-1", "c-msg", { productId: "p-1" })).rejects.toMatchObject({ code: "inbox.mediaWasNotSent" });
    // the image row exists and is marked failed; NO text row was created
    expect(fake.msgRows).toHaveLength(1);
    expect(fake.msgRows[0]).toMatchObject({ type: "image", status: "failed" });
  });

  it("unknown product is a 404 scoped to the org", async () => {
    const fake = fakePrisma();
    await expect(svc(fake).sendProductCard("org-1", "user-1", "c-breach", { productId: "nope" })).rejects.toMatchObject({ code: "inbox.productNotFoundInThisOrganization" });
    await expect(svc(fake).sendProductCard("org-2", "user-1", "c-foreign", { productId: "p-1" })).rejects.toMatchObject({ code: "inbox.productNotFoundInThisOrganization" });
  });
});

describe("webchat visitor projection", () => {
  it("exposes the product marker only for composed card messages", async () => {
    const cardText = composeProductCardText({ name: "কটন পাঞ্জাবি", priceMinor: 150000n, currency: "BDT", stockQuantity: 3 });
    const rows = [
      { id: "m-1", conversationId: "conv-w", direction: "out", type: "image", content: cardText, createdAt: new Date(), mediaStorageKey: "k1", mediaContentType: "image/png" },
      { id: "m-2", conversationId: "conv-w", direction: "out", type: "image", content: "এমনি ছবি", createdAt: new Date(), mediaStorageKey: "k2", mediaContentType: "image/png" },
      { id: "m-3", conversationId: "conv-w", direction: "in", type: "text", content: "দাম কত?", createdAt: new Date(), mediaStorageKey: null },
    ];
    const prisma: any = {
      widgetSite: { findFirst: async () => ({ id: "site-1", organizationId: "org-1", enabled: true, widgetKey: "wc_test" }) },
      liveChatSession: { findFirst: async () => ({ id: "sess-1", conversationId: "conv-w", widgetSiteId: "site-1" }) },
      channelMessage: { findMany: async () => rows },
    };
    const webchat = new WebchatService(prisma, makeAudit() as any, {} as any, undefined);
    const out = await webchat.listMessages("wc_test", "visitor-token");
    expect(out[0].product).toEqual({ name: "কটন পাঞ্জাবি", priceText: "BDT 1500.00" });
    expect(out[0].mediaUrl).toContain("/public/chat/wc_test/messages/m-1/media");
    expect(out[1].product).toBeNull();
    expect(out[2].product).toBeNull();
  });
});
