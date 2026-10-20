import { PerformanceLearningService } from "./performance-learning.service";
import { VoiceLearningService } from "./voice-learning.service";
import { CustomerMemoryService, customerKeyForConversation } from "./customer-memory.service";
import { LearningService } from "./learning.service";
import { OrgBrainService } from "./org-brain.service";
import { InboxService } from "../inbox/inbox.service";

/**
 * SA-B5 (Smart AI Phase 0, P7/P8) — guarantees:
 *  - P7: snapshot metrics equal hand-computed fixture values;
 *    recompute is idempotent; performance data is INTERNAL —
 *    the serialized customer context contains none of it,
 *    while the internal context carries period-labelled lines;
 *    performance findings land as SUGGESTED facts and approval
 *    can never make one public.
 *  - P8a: voice learning is behind the D4 opt-in (OFF = zero
 *    provider resolutions / zero LLM calls); PII is masked
 *    before the prompt; invented phrases/examples are dropped
 *    by the verbatim check; a suggested profile changes NO
 *    reply context until activated; the owner's brandVoice
 *    text takes precedence inside the style block.
 *  - P8b: customer memory holds commerce facts only; customer
 *    A's memory never appears in customer B's context, in a
 *    plain "customer" context, or in another org's context.
 *  - Inbox: the fact pack for an identified customer carries
 *    the memory facts and the prompt carries the style block;
 *    an unidentified conversation gets neither memory nor
 *    (without an active profile) style.
 * All doubles below are TEST doubles; production code contains
 * no fabricated data paths.
 */

// ---------- in-memory fake prisma (B4 pattern, full operators) ----------
function cmpVal(v: any): any {
  return v instanceof Date ? v.getTime() : v;
}
function condMatch(val: any, cond: any): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    for (const [op, operand] of Object.entries(cond)) {
      if (op === "gt" && !(cmpVal(val) > cmpVal(operand))) return false;
      if (op === "gte" && !(cmpVal(val) >= cmpVal(operand))) return false;
      if (op === "lt" && !(cmpVal(val) < cmpVal(operand))) return false;
      if (op === "lte" && !(cmpVal(val) <= cmpVal(operand))) return false;
      if (op === "in" && !(operand as any[]).some((x) => cmpVal(x) === cmpVal(val))) return false;
      if (op === "notIn" && (operand as any[]).some((x) => cmpVal(x) === cmpVal(val))) return false;
      if (op === "not") {
        if (operand !== null && typeof operand === "object") {
          if (condMatch(val, operand)) return false;
        } else if (cmpVal(val) === cmpVal(operand)) return false;
      }
    }
    return true;
  }
  return cmpVal(val) === cmpVal(cond);
}
function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!(cond as any[]).some((c) => matchesWhere(row, c))) return false;
      continue;
    }
    if (key === "AND") {
      if (!(cond as any[]).every((c) => matchesWhere(row, c))) return false;
      continue;
    }
    if (key.includes("_")) {
      // compound unique selector, e.g. organizationId_customerKey
      // (schema field names never contain "_", so this is never
      // a plain field condition). ALL parts must match.
      const c = cond as any;
      let ok = true;
      for (const part of key.split("_")) {
        if (cmpVal(row[part]) !== cmpVal(c?.[part])) ok = false;
      }
      if (!ok) return false;
      continue;
    }
    if (!condMatch(row[key], cond)) return false;
  }
  return true;
}
function applyOrder(rows: any[], orderBy: any): any[] {
  const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean);
  const out = [...rows];
  for (let i = specs.length - 1; i >= 0; i--) {
    const [field, dir] = Object.entries(specs[i])[0] as [string, string];
    out.sort((a, b) => {
      const av = cmpVal(a[field]) ?? 0;
      const bv = cmpVal(b[field]) ?? 0;
      return dir === "desc" ? (bv > av ? 1 : bv < av ? -1 : 0) : av > bv ? 1 : av < bv ? -1 : 0;
    });
  }
  return out;
}
const TABLE_NAMES = [
  "businessProfile", "organization", "businessPolicy", "knowledgeDocument",
  "performanceSnapshot", "aiBrandVoiceProfile", "customerMemory", "learnedItem",
  "learningState", "channelConversation", "channelMessage", "order", "orderItem",
  "dailyAdMetric", "adCampaign", "broadcast", "messageDelivery", "socialPost",
  "returnRequest", "orderReview", "product", "aIUsageRecord", "aiStoredAnswer",
  "orgLlmConfig", "auditLog",
] as const;
function makeFakePrisma() {
  let seq = 0;
  const nid = () => `fake-${++seq}`;
  const tables: Record<string, any[]> = {};
  for (const n of TABLE_NAMES) tables[n] = [];
  const defaults: Record<string, any> = {
    learnedItem: { status: "suggested" },
    aiBrandVoiceProfile: { status: "suggested" },
    customerMemory: { orderCount: 0, topics: [], notes: [] },
  };
  const model = (name: string) => ({
    findMany: async (args: any = {}) => {
      let rows = tables[name].filter((r) => matchesWhere(r, args.where));
      if (args.orderBy) rows = applyOrder(rows, args.orderBy);
      if (args.skip) rows = rows.slice(args.skip);
      if (args.take) rows = rows.slice(0, args.take);
      return rows;
    },
    findFirst: async (args: any = {}) => {
      let rows = tables[name].filter((r) => matchesWhere(r, args.where));
      if (args.orderBy) rows = applyOrder(rows, args.orderBy);
      return rows[0] ?? null;
    },
    findUnique: async (args: any = {}) => {
      const rows = tables[name].filter((r) => matchesWhere(r, args.where));
      return rows[0] ?? null;
    },
    count: async (args: any = {}) => tables[name].filter((r) => matchesWhere(r, args.where)).length,
    create: async (args: any) => {
      const row = { id: nid(), createdAt: new Date(), updatedAt: new Date(), ...(defaults[name] ?? {}), ...args.data };
      tables[name].push(row);
      return row;
    },
    update: async (args: any) => {
      const row = tables[name].find((r) => r.id === args.where.id);
      if (!row) throw new Error("record not found");
      Object.assign(row, args.data, { updatedAt: new Date() });
      return row;
    },
    upsert: async (args: any) => {
      const existing = tables[name].find((r) => matchesWhere(r, args.where));
      if (existing) {
        Object.assign(existing, args.update, { updatedAt: new Date() });
        return existing;
      }
      const row = { id: nid(), createdAt: new Date(), updatedAt: new Date(), ...(defaults[name] ?? {}), ...args.create };
      tables[name].push(row);
      return row;
    },
    delete: async (args: any) => {
      const idx = tables[name].findIndex((r) => r.id === args.where.id);
      if (idx < 0) throw new Error("record not found");
      return tables[name].splice(idx, 1)[0];
    },
  });
  const prisma: any = { $queryRaw: async () => [] };
  for (const n of TABLE_NAMES) prisma[n] = model(n);
  prisma.__tables = tables;
  return prisma;
}

const A = "org-a";
const B = "org-b";
const NOW = new Date("2026-10-17T12:00:00.000Z");
const D = (iso: string) => new Date(iso);

function profileRow(org: string, over: any = {}): any {
  return {
    organizationId: org, industry: "Fashion", description: "A clothing shop", brandVoice: null,
    websiteUrl: null, goals: null, monthlyBudgetMinor: null, budgetCurrency: null,
    targetCustomers: null, businessModel: null, uniqueSellingPoints: null, tradeLicenseNo: null,
    billingEmails: null, deliveryChargeInsideMinor: BigInt(6000), deliveryChargeOutsideMinor: BigInt(12000),
    codAvailable: true, bkashNumber: "01700000000", contactPhone: "01700000000", contactEmail: "a@example.test",
    aiInstructions: null, aiReplyLanguage: null,
    conversationLearningEnabled: false, websiteLearningEnabled: true, ...over,
  };
}

// ================= P7: performance learning =================
function seedPerformance(prisma: any) {
  const t = prisma.__tables;
  t.organization.push({ id: A, name: "Shop A" }, { id: B, name: "Shop B" });
  t.businessProfile.push(profileRow(A), profileRow(B));
  // conversations: c1 sale (AI-resolved, csat 5), c2 no_sale_price
  // (staff touched -> not AI-resolved, csat 4), c3 support
  // (AI-resolved), c4 open (handled only), cOld outside windows.
  t.channelConversation.push(
    { id: "c1", organizationId: A, channel: "whatsapp", externalContactId: "x1", status: "closed", outcome: "sale", csatRating: 5, resolvedAt: D("2026-10-15T10:00:00Z"), lastMessageAt: D("2026-10-15T10:00:00Z"), updatedAt: D("2026-10-15T10:00:00Z"), isPractice: false },
    { id: "c2", organizationId: A, channel: "whatsapp", externalContactId: "x2", status: "closed", outcome: "no_sale_price", csatRating: 4, resolvedAt: D("2026-10-16T10:00:00Z"), lastMessageAt: D("2026-10-16T10:00:00Z"), updatedAt: D("2026-10-16T10:00:00Z"), isPractice: false },
    { id: "c3", organizationId: A, channel: "messenger", externalContactId: "x3", status: "closed", outcome: "support_resolved", csatRating: null, resolvedAt: D("2026-10-14T10:00:00Z"), lastMessageAt: D("2026-10-14T10:00:00Z"), updatedAt: D("2026-10-14T10:00:00Z"), isPractice: false },
    { id: "c4", organizationId: A, channel: "whatsapp", externalContactId: "x4", status: "open", outcome: null, csatRating: null, resolvedAt: null, lastMessageAt: D("2026-10-16T12:00:00Z"), updatedAt: D("2026-10-16T12:00:00Z"), isPractice: false },
    { id: "cOld", organizationId: A, channel: "whatsapp", externalContactId: "x5", status: "closed", outcome: "sale", csatRating: 1, resolvedAt: D("2026-09-01T10:00:00Z"), lastMessageAt: D("2026-09-01T10:00:00Z"), updatedAt: D("2026-09-01T10:00:00Z"), isPractice: false },
  );
  t.channelMessage.push(
    { id: "m1", conversationId: "c1", direction: "out", autoReply: true, sentByUserId: null, content: "ai reply", status: "sent", createdAt: D("2026-10-15T09:00:00Z") },
    { id: "m2", conversationId: "c2", direction: "out", autoReply: true, sentByUserId: null, content: "ai reply", status: "sent", createdAt: D("2026-10-16T09:00:00Z") },
    { id: "m3", conversationId: "c2", direction: "out", autoReply: false, sentByUserId: "u1", content: "staff reply", status: "sent", createdAt: D("2026-10-16T09:30:00Z") },
    { id: "m4", conversationId: "c3", direction: "out", autoReply: true, sentByUserId: null, content: "ai reply", status: "sent", createdAt: D("2026-10-14T09:00:00Z") },
  );
  t.order.push(
    { id: "o1", organizationId: A, conversationId: "c1", customerId: null, status: "completed", totalMinor: BigInt(100000), createdAt: D("2026-10-15T11:00:00Z"), isPractice: false },
    { id: "o2", organizationId: A, conversationId: null, customerId: null, status: "completed", totalMinor: BigInt(50000), createdAt: D("2026-10-15T12:00:00Z"), isPractice: false },
    { id: "o3", organizationId: A, conversationId: "c2", customerId: null, status: "cancelled", totalMinor: BigInt(70000), createdAt: D("2026-10-15T13:00:00Z"), isPractice: false },
    { id: "oOld", organizationId: A, conversationId: null, customerId: null, status: "completed", totalMinor: BigInt(99900), createdAt: D("2026-08-01T10:00:00Z"), isPractice: false },
  );
  t.orderItem.push(
    { id: "i1", orderId: "o1", productId: "p1", name: "Cotton Kurti SENTINELPROD", quantity: 2, totalMinor: BigInt(100000) },
    { id: "i2", orderId: "o2", productId: "p1", name: "Cotton Kurti SENTINELPROD", quantity: 1, totalMinor: BigInt(50000) },
    { id: "i3", orderId: "o3", productId: "p2", name: "Silk Sharee", quantity: 5, totalMinor: BigInt(70000) },
  );
  t.returnRequest.push(
    { id: "r1", organizationId: A, orderId: "o1", reason: "Size mismatch SENTINELREASON", createdAt: D("2026-10-16T08:00:00Z") },
    { id: "r2", organizationId: A, orderId: "o2", reason: "Size mismatch SENTINELREASON", createdAt: D("2026-10-16T09:00:00Z") },
    { id: "r3", organizationId: A, orderId: "o1", reason: "Changed mind", createdAt: D("2026-10-16T10:00:00Z") },
  );
  t.orderReview.push(
    { id: "v1", organizationId: A, orderId: "o1", rating: 5, receivedAt: D("2026-10-16T08:00:00Z"), createdAt: D("2026-10-16T08:00:00Z") },
    { id: "v2", organizationId: A, orderId: "o2", rating: 4, receivedAt: D("2026-10-16T09:00:00Z"), createdAt: D("2026-10-16T09:00:00Z") },
    { id: "v3", organizationId: A, orderId: "o1", rating: 4, receivedAt: D("2026-10-16T10:00:00Z"), createdAt: D("2026-10-16T10:00:00Z") },
    { id: "vOld", organizationId: A, orderId: "oOld", rating: 1, receivedAt: D("2026-08-02T10:00:00Z"), createdAt: D("2026-08-02T10:00:00Z") },
  );
  t.dailyAdMetric.push(
    { id: "am1", organizationId: A, adAccountId: "acc1", adCampaignId: null, campaignExternalId: "camp1", campaignName: "Eid Sale SENTINELCAMP", adSetExternalId: "", adExternalId: "", date: D("2026-10-15T00:00:00Z"), spendMinor: BigInt(10000), platformConversions: 10, platformConversionValueMinor: BigInt(50000), currency: "BDT" },
    { id: "am2", organizationId: A, adAccountId: "acc1", adCampaignId: null, campaignExternalId: "camp1", campaignName: "Eid Sale SENTINELCAMP", adSetExternalId: "", adExternalId: "", date: D("2026-10-16T00:00:00Z"), spendMinor: BigInt(10000), platformConversions: 5, platformConversionValueMinor: BigInt(30000), currency: "BDT" },
    { id: "am3", organizationId: A, adAccountId: "acc1", adCampaignId: null, campaignExternalId: "camp2", campaignName: "Regular", adSetExternalId: "", adExternalId: "", date: D("2026-10-15T00:00:00Z"), spendMinor: BigInt(5000), platformConversions: 1, platformConversionValueMinor: BigInt(5000), currency: "BDT" },
    // ad-level row — must be EXCLUDED from campaign sums.
    { id: "am4", organizationId: A, adAccountId: "acc1", adCampaignId: null, campaignExternalId: "camp1", campaignName: "Eid Sale SENTINELCAMP", adSetExternalId: "set1", adExternalId: "ad9", date: D("2026-10-15T00:00:00Z"), spendMinor: BigInt(999999), platformConversions: 99, platformConversionValueMinor: BigInt(999999), currency: "BDT" },
  );
  t.broadcast.push(
    { id: "b1", organizationId: A, name: "Promo SENTINELBC", channel: "sms", status: "sent", sentAt: D("2026-10-15T08:00:00Z"), totalRecipients: 100, sentCount: 95, failedCount: 5 },
  );
  t.messageDelivery.push(
    { id: "d1", organizationId: A, broadcastId: "b1", deliveryStatus: "delivered" },
    { id: "d2", organizationId: A, broadcastId: "b1", deliveryStatus: "read" },
    { id: "d3", organizationId: A, broadcastId: "b1", deliveryStatus: null },
  );
  t.socialPost.push(
    { id: "s1", organizationId: A, status: "published", publishedAt: D("2026-10-15T09:00:00Z"), caption: "New collection SENTINELPOST", insights: { reactions: 10, comments: 5, shares: 2, impressions: 1000 } },
    { id: "s2", organizationId: A, status: "published", publishedAt: D("2026-10-15T10:00:00Z"), caption: "No insights post", insights: null },
  );
}

describe("SA-B5 P7: performance snapshots", () => {
  const prisma = makeFakePrisma();
  seedPerformance(prisma);
  const learning = new LearningService(prisma as any);
  const perf = new PerformanceLearningService(prisma as any, learning as any);

  it("computes hand-verified aggregates for the 7-day window", async () => {
    const r = await perf.computeOrg(A, NOW);
    expect(r.status).toBe("ok");
    expect(r.snapshots).toBe(2);
    const snap = prisma.__tables.performanceSnapshot.find((s: any) => s.organizationId === A && s.metrics.windowDays === 7);
    expect(snap).toBeTruthy();
    const m = snap.metrics;
    expect(m.periodStart).toBe("2026-10-11T00:00:00.000Z");
    expect(m.periodEnd).toBe("2026-10-18T00:00:00.000Z");
    expect(m.inbox.conversationsHandled).toBe(4);
    expect(m.inbox.closed).toBe(3);
    expect(m.inbox.aiResolved).toBe(2);
    expect(m.inbox.aiResolvedShare).toBe(0.67);
    expect(m.inbox.outcomes).toEqual({ sale: 1, no_sale_price: 1, support_resolved: 1 });
    expect(m.inbox.ordersFromInbox).toBe(2);
    expect(m.inbox.ordersFromInboxValueMinor).toBe("100000");
    expect(m.inbox.csatAvg).toBe(4.5);
    expect(m.inbox.csatCount).toBe(2);
    expect(m.sales.orders).toBe(3);
    expect(m.sales.revenueMinor).toBe("150000");
    expect(m.sales.cancelled).toBe(1);
    expect(m.sales.topProducts[0]).toMatchObject({ name: "Cotton Kurti SENTINELPROD", qty: 3, revenueMinor: "150000" });
    expect(m.sales.returns.total).toBe(3);
    expect(m.sales.returns.topReasons[0]).toEqual({ reason: "Size mismatch SENTINELREASON", count: 2 });
    expect(m.sales.reviews).toMatchObject({ count: 3, avgRating: 4.33 });
    expect(m.sales.reviews.distribution).toEqual({ "4": 2, "5": 1 });
    expect(m.ads.spendMinor).toBe("25000");
    expect(m.ads.conversions).toBe(16);
    expect(m.ads.conversionValueMinor).toBe("85000");
    expect(m.ads.roas).toBe(3.4);
    expect(m.ads.topCampaigns[0]).toMatchObject({ name: "Eid Sale SENTINELCAMP", roas: 4 });
    expect(m.broadcasts.items[0]).toMatchObject({ sentCount: 95, failedCount: 5, delivered: 2, read: 1 });
    expect(m.social.published).toBe(2);
    expect(m.social.withInsights).toBe(1);
    expect(m.social.topPosts[0]).toMatchObject({ engagement: 17 });
  });

  it("is idempotent: recompute upserts the same rows and dedupes suggestions", async () => {
    const before = prisma.__tables.performanceSnapshot.filter((s: any) => s.organizationId === A).length;
    const suggestionsBefore = prisma.__tables.learnedItem.filter((i: any) => i.organizationId === A && i.sourceType === "performance").length;
    expect(suggestionsBefore).toBe(3);
    const r = await perf.computeOrg(A, NOW);
    expect(r.status).toBe("ok");
    expect(prisma.__tables.performanceSnapshot.filter((s: any) => s.organizationId === A).length).toBe(before);
    expect(prisma.__tables.learnedItem.filter((i: any) => i.organizationId === A && i.sourceType === "performance").length).toBe(3);
    const items = prisma.__tables.learnedItem.filter((i: any) => i.organizationId === A && i.sourceType === "performance");
    expect(items.every((i: any) => i.status === "suggested")).toBe(true);
  });

  it("skips an org with no source data honestly (no empty snapshots)", async () => {
    const r = await perf.computeOrg(B, NOW);
    expect(r).toMatchObject({ status: "skipped", reason: "no_source_data" });
    expect(prisma.__tables.performanceSnapshot.filter((s: any) => s.organizationId === B).length).toBe(0);
  });

  it("serves performance ONLY to the internal audience, period-labelled", async () => {
    const brain = new OrgBrainService(prisma as any);
    const internal = await brain.getContext(A, { audience: "internal" });
    expect(internal.performance).not.toBeNull();
    expect(internal.performanceFacts.join("\n")).toContain("কর্মক্ষমতা (2026-10-11 – 2026-10-18, গত 7 দিন)");
    const internalText = JSON.stringify(internal);
    expect(internalText).toContain("SENTINELCAMP");
    expect(internalText).toContain("SENTINELPROD");

    const customer = await brain.getContext(A, { audience: "customer" });
    expect(customer.performance).toBeNull();
    expect(customer.performanceFacts).toEqual([]);
    const serialized = JSON.stringify(customer);
    for (const sentinel of ["SENTINELCAMP", "SENTINELPROD", "SENTINELREASON", "SENTINELPOST", "কর্মক্ষমতা", "150000", "25000"]) {
      expect(serialized).not.toContain(sentinel);
    }
    const own = await brain.getContext(A, { audience: "own_customer", customerKey: "whatsapp:x1" });
    expect(own.performance).toBeNull();
    expect(JSON.stringify(own)).not.toContain("SENTINELCAMP");
  });

  it("approval of a performance fact is INTERNAL even when public is requested", async () => {
    const item = prisma.__tables.learnedItem.find((i: any) => i.organizationId === A && i.sourceType === "performance");
    const updated = await learning.approve(A, "owner-1", item.id, { visibility: "public" });
    expect(updated.status).toBe("approved");
    const doc = prisma.__tables.knowledgeDocument.find((d: any) => d.id === String(updated.appliedRef).replace("knowledge:", ""));
    expect(doc).toBeTruthy();
    expect(doc.visibility).toBe("internal");
  });
});

// ================= P8a: brand voice learning =================
const STAFF_1 = "আসসালামু আলাইকুম! 😊 কেমন আছেন? আমি সাহায্য করছি।";
const STAFF_2 = "ধন্যবাদ! আপনার অর্ডারটি কনফার্ম হয়েছে।";
const STAFF_3 = "জি অবশ্যই, কোনো সমস্যা হলে জানাবেন প্লিজ।";
const STAFF_4 = "আসসালামু আলাইকুম! ধন্যবাদ আমাদের সাথে থাকার জন্য! 😊";
const STAFF_5 = "সমস্যা হলে 01712345678 নম্বরে কল করুন।";
const VOICE_PAYLOAD_V1 = {
  traits: {
    formality: "friendly", emojiUse: "light", greetingStyle: "আসসালামু আলাইকুম!",
    languageMix: "mixed", avgSentence: "short",
    signaturePhrases: ["ধন্যবাদ!", "INVENTED_PHRASE_SENTINEL"],
  },
  examples: [STAFF_2, "INVENTED_EXAMPLE_SENTINEL সম্পূর্ণ বানানো উদাহরণ"],
};
const VOICE_PAYLOAD_V2 = {
  traits: {
    formality: "formal", emojiUse: "none", greetingStyle: "আসসালামু আলাইকুম!",
    languageMix: "bn", avgSentence: "medium", signaturePhrases: [],
  },
  examples: [STAFF_3],
};

function seedVoice(prisma: any) {
  const t = prisma.__tables;
  t.organization.push({ id: A, name: "Shop A" }, { id: "org-c", name: "Shop C" });
  t.businessProfile.push(
    profileRow(A, { conversationLearningEnabled: true }),
    profileRow("org-c", { conversationLearningEnabled: false }),
  );
  t.channelConversation.push(
    { id: "vc1", organizationId: A, channel: "whatsapp", externalContactId: "cust-v", status: "open", isPractice: false, lastMessageAt: D("2026-10-16T10:00:00Z"), updatedAt: D("2026-10-16T10:00:00Z") },
  );
  const staffMsg = (id: string, content: string, day: string) => ({
    id, conversationId: "vc1", direction: "out", autoReply: false, sentByUserId: "u1",
    content, status: "sent", createdAt: D(day),
  });
  t.channelMessage.push(
    staffMsg("vm1", STAFF_1, "2026-10-16T09:00:00Z"),
    staffMsg("vm2", STAFF_2, "2026-10-16T09:05:00Z"),
    staffMsg("vm3", STAFF_3, "2026-10-16T09:10:00Z"),
    staffMsg("vm4", STAFF_4, "2026-10-16T09:15:00Z"),
    staffMsg("vm5", STAFF_5, "2026-10-16T09:20:00Z"),
    { id: "vm6", conversationId: "vc1", direction: "out", autoReply: true, sentByUserId: null, content: "AI_SENTINEL_TEXT", status: "sent", createdAt: D("2026-10-16T09:25:00Z") },
    { id: "vm7", conversationId: "vc1", direction: "in", autoReply: false, sentByUserId: null, content: "customer question", status: "received", createdAt: D("2026-10-16T09:30:00Z") },
  );
}

describe("SA-B5 P8a: brand voice learning", () => {
  const prisma = makeFakePrisma();
  seedVoice(prisma);
  const learning = new LearningService(prisma as any);
  const audit: any = { log: async () => undefined };
  let resolverCalls = 0;
  let seenPrompt = "";
  let payload: any = VOICE_PAYLOAD_V1;
  const provider: any = {
    name: "fake-llm", isRealLlm: true,
    complete: async (messages: any[]) => {
      seenPrompt = String(messages?.[1]?.content ?? "");
      return { text: JSON.stringify(payload), model: "fake-model", inputTokens: 10, outputTokens: 20, tokensEstimated: false };
    },
  };
  const voice = new VoiceLearningService(prisma as any, learning as any, audit, {
    providerResolver: async () => {
      resolverCalls++;
      return provider;
    },
  });
  const brain = new OrgBrainService(prisma as any);

  it("opt-in OFF: zero provider resolutions, zero LLM calls, no profile", async () => {
    const before = resolverCalls;
    const r = await voice.learnOrg("org-c");
    expect(r).toMatchObject({ status: "skipped", reason: "conversation_learning_disabled" });
    expect(resolverCalls).toBe(before);
    expect(prisma.__tables.aiBrandVoiceProfile.filter((p: any) => p.organizationId === "org-c").length).toBe(0);
  });

  it("learns a SUGGESTED profile: PII masked pre-prompt, invented phrases/examples dropped", async () => {
    const r = await voice.learnOrg(A);
    expect(r.status).toBe("ok");
    expect(r.samples).toBe(5);
    // The customer's phone in STAFF_5 was masked before the prompt.
    expect(seenPrompt).not.toContain("01712345678");
    // AI replies are not staff voice samples.
    expect(seenPrompt).not.toContain("AI_SENTINEL_TEXT");
    const row = prisma.__tables.aiBrandVoiceProfile.find((p: any) => p.organizationId === A);
    expect(row).toBeTruthy();
    expect(row.status).toBe("suggested");
    expect(row.traits.formality).toBe("friendly");
    expect(row.traits.greetingStyle).toBe("আসসালামু আলাইকুম!");
    expect(row.traits.signaturePhrases).toEqual(["ধন্যবাদ!"]);
    expect(row.exampleSnippets).toEqual([STAFF_2]);
    const usage = prisma.__tables.aIUsageRecord.find((u: any) => u.feature === "brand_voice_learning");
    expect(usage).toBeTruthy();
  });

  it("a suggested profile changes NOTHING in any reply context", async () => {
    const customer = await brain.getContext(A, { audience: "customer" });
    expect(customer.styleInstructions).toBeNull();
    expect(customer.voiceProfile).toBeNull();
    const internal = await brain.getContext(A, { audience: "internal" });
    expect(internal.voiceProfile?.status).toBe("suggested");
    expect(internal.styleInstructions).toBeNull();
  });

  it("after activation the style block appears — as style, never as facts", async () => {
    await voice.activate(A, "owner-1");
    const customer = await brain.getContext(A, { audience: "customer" });
    expect(customer.styleInstructions).toContain("Tone: friendly");
    expect(customer.styleInstructions).toContain(STAFF_2);
    // The example snippet lives in the style block only; the
    // verified fact lines never carry it.
    expect(customer.factsText).not.toContain(STAFF_2);
    expect(customer.factsText).not.toContain("Tone: friendly");
  });

  it("owner brandVoice text leads the style block under a precedence label", async () => {
    const profile = prisma.__tables.businessProfile.find((p: any) => p.organizationId === A);
    profile.brandVoice = "OWNER_VOICE_SENTINEL: always brief and polite";
    const customer = await brain.getContext(A, { audience: "customer" });
    const style = String(customer.styleInstructions);
    expect(style).toContain("OWNER_VOICE_SENTINEL");
    expect(style).toContain("takes precedence");
    expect(style.indexOf("OWNER_VOICE_SENTINEL")).toBeLessThan(style.indexOf("Learned style"));
    profile.brandVoice = null;
  });

  it("a re-learn while ACTIVE waits in pending; activation promotes it", async () => {
    payload = VOICE_PAYLOAD_V2;
    const r = await voice.learnOrg(A);
    expect(r.status).toBe("ok");
    const row = prisma.__tables.aiBrandVoiceProfile.find((p: any) => p.organizationId === A);
    expect(row.traits.formality).toBe("friendly");
    expect(row.pendingTraits.formality).toBe("formal");
    let customer = await brain.getContext(A, { audience: "customer" });
    expect(customer.styleInstructions).toContain("Tone: friendly");
    await voice.activate(A, "owner-1");
    const row2 = prisma.__tables.aiBrandVoiceProfile.find((p: any) => p.organizationId === A);
    expect(row2.traits.formality).toBe("formal");
    expect(row2.pendingTraits).toBeNull();
    customer = await brain.getContext(A, { audience: "customer" });
    expect(customer.styleInstructions).toContain("Tone: formal");
    await expect(voice.dismissSuggestion(A, "owner-1")).rejects.toMatchObject({ code: "ai.nothingToDismissTheActiveProfile" });
  });
});

// ================= P8b: customer memory =================
function seedMemory(prisma: any) {
  const t = prisma.__tables;
  t.organization.push({ id: A, name: "Shop A" }, { id: B, name: "Shop B" });
  t.businessProfile.push(profileRow(A), profileRow(B));
  t.product.push(
    { id: "p1", organizationId: A, name: "Cotton Kurti", status: "ACTIVE" },
    { id: "p2", organizationId: A, name: "Silk Sharee", status: "ACTIVE" },
  );
  t.channelConversation.push(
    { id: "mc1", organizationId: A, channel: "whatsapp", externalContactId: "8801711223344", contactName: "Rahim", customerId: "cust-1", status: "closed", outcome: "sale", csatRating: 5, isPractice: false, resolvedAt: D("2026-10-15T10:00:00Z"), lastMessageAt: D("2026-10-15T10:00:00Z"), updatedAt: D("2026-10-15T10:00:00Z") },
    { id: "mcPractice", organizationId: A, channel: "whatsapp", externalContactId: "practice-1", status: "closed", outcome: null, csatRating: null, isPractice: true, resolvedAt: D("2026-10-15T10:00:00Z"), lastMessageAt: D("2026-10-15T10:00:00Z"), updatedAt: D("2026-10-15T10:00:00Z") },
  );
  t.channelMessage.push(
    { id: "mm1", conversationId: "mc1", direction: "in", content: "আসসালামু আলাইকুম, Cotton Kurti টা আছে?", status: "received", createdAt: D("2026-10-15T09:00:00Z") },
    { id: "mm2", conversationId: "mc1", direction: "in", content: "দাম কত? আমার নম্বর 01999888777", status: "received", createdAt: D("2026-10-15T09:05:00Z") },
  );
  t.order.push(
    { id: "mo1", organizationId: A, conversationId: "mc1", customerId: "cust-1", status: "completed", totalMinor: BigInt(100000), createdAt: D("2026-10-15T11:00:00Z"), isPractice: false },
  );
  t.orderItem.push({ id: "mi1", orderId: "mo1", productId: "p2", name: "Silk Sharee", quantity: 1, totalMinor: BigInt(100000) });
  // Another customer's memory, and org B's row under the SAME
  // key string — isolation fixtures.
  t.customerMemory.push(
    { id: "memB", organizationId: A, customerKey: "whatsapp:8801999000111", displayName: "Other", languagePref: "en", topics: [{ productId: null, name: "B_SECRET_PRODUCT", via: "ordered" }], orderCount: 9, lastOrderAt: null, notes: [], lastInteractionAt: null, createdAt: new Date(), updatedAt: new Date() },
    { id: "memOrgB", organizationId: B, customerKey: "whatsapp:8801711223344", displayName: "Not Rahim", languagePref: "en", topics: [{ productId: null, name: "ORG_B_SECRET", via: "ordered" }], orderCount: 3, lastOrderAt: null, notes: [], lastInteractionAt: null, createdAt: new Date(), updatedAt: new Date() },
  );
}

describe("SA-B5 P8b: customer memory", () => {
  const prisma = makeFakePrisma();
  seedMemory(prisma);
  const memory = new CustomerMemoryService(prisma as any);
  const brain = new OrgBrainService(prisma as any);
  const KEY = "whatsapp:8801711223344";

  it("customerKey derives from channel + externalContactId; practice has none", () => {
    expect(customerKeyForConversation({ channel: "whatsapp", externalContactId: "8801", isPractice: false })).toBe("whatsapp:8801");
    expect(customerKeyForConversation({ channel: "whatsapp", externalContactId: "practice-1", isPractice: true })).toBeNull();
    expect(customerKeyForConversation({ channel: "webchat", externalContactId: "" })).toBeNull();
  });

  it("writer records commerce facts only — language, asked/bought topics, orders, outcome notes", async () => {
    const conv = prisma.__tables.channelConversation.find((c: any) => c.id === "mc1");
    const r = await memory.refreshForConversation(A, conv);
    expect(r).toMatchObject({ refreshed: true, customerKey: KEY });
    const row = prisma.__tables.customerMemory.find((m: any) => m.organizationId === A && m.customerKey === KEY);
    expect(row).toBeTruthy();
    expect(row.languagePref).toBe("bn");
    expect(row.orderCount).toBe(1);
    expect(row.topics).toEqual([
      { productId: "p2", name: "Silk Sharee", via: "ordered" },
      { productId: "p1", name: "Cotton Kurti", via: "asked" },
    ]);
    expect(row.notes.map((n: any) => n.kind).sort()).toEqual(["csat", "outcome"]);
    expect(row.notes.every((n: any) => n.conversationId === "mc1")).toBe(true);
    // The customer's own phone number (in their message text)
    // is never copied into the memory.
    expect(JSON.stringify(row)).not.toContain("01999888777");
    // Practice conversations never produce a memory.
    const practice = prisma.__tables.channelConversation.find((c: any) => c.id === "mcPractice");
    expect((await memory.refreshForConversation(A, practice)).refreshed).toBe(false);
  });

  it("reader: memory appears ONLY in that customer's own context", async () => {
    const own = await brain.getContext(A, { audience: "own_customer", customerKey: KEY });
    expect(own.customerMemory?.customerKey).toBe(KEY);
    const facts = own.customerMemoryFacts.join("\n");
    expect(facts).toContain("Silk Sharee");
    expect(facts).toContain("Cotton Kurti");
    expect(facts).not.toContain("B_SECRET_PRODUCT");

    // Plain customer audience: even WITH the key passed, the
    // memory table is never admitted.
    const plain = await brain.getContext(A, { audience: "customer", customerKey: KEY });
    expect(plain.customerMemory).toBeNull();
    expect(JSON.stringify(plain)).not.toContain("Silk Sharee");

    // Another customer's context: no trace of A's topics.
    const other = await brain.getContext(A, { audience: "own_customer", customerKey: "whatsapp:8801999000111" });
    expect(other.customerMemoryFacts.join("\n")).toContain("B_SECRET_PRODUCT");
    expect(other.customerMemoryFacts.join("\n")).not.toContain("Silk Sharee");

    // Internal needs the explicit key (staff viewing that
    // customer's thread); without it, no memory.
    const internalNoKey = await brain.getContext(A, { audience: "internal" });
    expect(internalNoKey.customerMemory).toBeNull();
    const internalKeyed = await brain.getContext(A, { audience: "internal", customerKey: KEY });
    expect(internalKeyed.customerMemory?.customerKey).toBe(KEY);

    // Cross-org: org B asking with A's key shape gets org B's
    // own row only — A's memory is unreachable.
    const orgB = await brain.getContext(B, { audience: "own_customer", customerKey: KEY });
    expect(JSON.stringify(orgB.customerMemoryFacts)).toContain("ORG_B_SECRET");
    expect(JSON.stringify(orgB)).not.toContain("Silk Sharee");
  });
});

// ================= Inbox plumbing: pack + prompt =================
describe("SA-B5 inbox: fact pack carries memory, prompt carries style", () => {
  function makeInbox(voiceStatus: string) {
    const prisma = makeFakePrisma();
    const t = prisma.__tables;
    t.organization.push({ id: A, name: "Shop A" });
    t.businessProfile.push(profileRow(A));
    t.aiBrandVoiceProfile.push({
      id: "vp1", organizationId: A, status: voiceStatus,
      traits: { formality: "friendly", emojiUse: "light", greetingStyle: null, languageMix: "mixed", avgSentence: "short", signaturePhrases: ["VOICE_PHRASE_SENTINEL"] },
      exampleSnippets: [], pendingTraits: null, pendingExamples: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    t.customerMemory.push({
      id: "mem1", organizationId: A, customerKey: "whatsapp:8801711223344", displayName: "Rahim",
      languagePref: "bn", topics: [{ productId: null, name: "MEMORY_TOPIC_SENTINEL", via: "ordered" }],
      orderCount: 3, lastOrderAt: null, notes: [], lastInteractionAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    let systemPrompt = "";
    const provider: any = {
      name: "fake-llm", isRealLlm: true,
      complete: async (messages: any[]) => {
        systemPrompt = String(messages?.[0]?.content ?? "");
        return { text: "জি, বলুন — কী সাহায্য করতে পারি?", model: "fake-model", inputTokens: 5, outputTokens: 5, tokensEstimated: false };
      },
    };
    const llm: any = { getProvider: () => provider, forOrg: async () => provider };
    const audit: any = { log: async () => undefined };
    const brain = new OrgBrainService(prisma as any);
    const service = new InboxService(
      prisma as any, audit, llm,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined,
      brain as any, undefined,
    );
    return { service, prompt: () => systemPrompt };
  }

  it("identified customer: prompt has the style block and the memory fact; reply composes", async () => {
    const { service, prompt } = makeInbox("active");
    const conv: any = { id: "ic1", channel: "whatsapp", externalContactId: "8801711223344", isPractice: false, customerId: null };
    const composed = await (service as any).composeLlmGroundedReply(A, conv, "other", "hello");
    expect(composed?.content).toContain("বলুন");
    expect(prompt()).toContain("Style guidance from the shop's learned brand voice");
    expect(prompt()).toContain("VOICE_PHRASE_SENTINEL");
    expect(prompt()).toContain("MEMORY_TOPIC_SENTINEL");
  });

  it("unidentified conversation: no memory in the pack (org style still applies)", async () => {
    const { service, prompt } = makeInbox("active");
    const conv: any = { id: "ic2", channel: "webchat", externalContactId: null, isPractice: false, customerId: null };
    await (service as any).composeLlmGroundedReply(A, conv, "other", "hello");
    expect(prompt()).not.toContain("MEMORY_TOPIC_SENTINEL");
    expect(prompt()).toContain("VOICE_PHRASE_SENTINEL");
  });

  it("merely-suggested voice profile: the prompt composes exactly as before SA-B5", async () => {
    const { service, prompt } = makeInbox("suggested");
    const conv: any = { id: "ic3", channel: "whatsapp", externalContactId: "8801711223344", isPractice: false, customerId: null };
    await (service as any).composeLlmGroundedReply(A, conv, "other", "hello");
    expect(prompt()).not.toContain("Style guidance");
    expect(prompt()).not.toContain("VOICE_PHRASE_SENTINEL");
  });
});
