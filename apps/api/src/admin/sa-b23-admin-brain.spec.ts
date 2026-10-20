import "reflect-metadata";
import { SuperAdminGuard, ADMIN_TIER_KEY } from "../common/super-admin.guard";
import { AdminAiController } from "./admin-ai.controller";
import { AdminBrainService } from "./admin-brain.service";
import { AdminBrainFixService } from "./admin-brain-fix.service";
import { AuditService } from "../audit/audit.service";
import { BrainAdminService } from "../ai/brain-admin.service";
import { AnswerStoreService, normalizeQuestion } from "../ai/answer-store.service";
import { LearningService } from "../ai/learning.service";

/**
 * SA-B23 (Smart AI Phase 6, T1 console family) — guarantees:
 *  - The per-org Brain view/fix surface is SUPER-only (tenant
 *    OWNER refused by the guard, SUPPORT refused on the tier).
 *  - The VIEW returns the org's SA-B6 overview verbatim plus
 *    learned breakdown / autonomy overrides / digest presence
 *    flags — counts and status only — and writes EXACTLY ONE
 *    `admin.ai_brain_view` audit row per call.
 *  - Every FIX demands a non-empty reason BEFORE anything
 *    happens: empty reason = 400, zero mutation, zero
 *    fix-audit rows.
 *  - Fixes run through the tenant's own paths and land on the
 *    PATH org only: invalidation removes the answer from
 *    serving (lookup hit -> miss), a console learned-item
 *    decision stamps reviewedVia "admin_console" (a staff
 *    decision stamps "org" — the two are distinguishable on
 *    the row itself), forgetting removes only that org's row
 *    for that key, and the answer-store toggle bites through
 *    the store's own gate.
 *  - Each fix writes its org-scoped `admin.ai_brain_fix_*`
 *    audit row carrying the reason verbatim.
 */

// ---------------- in-memory prisma stub ----------------

function makeTable(initial: any[] = []) {
  const rows: any[] = [...initial];
  let seq = 0;
  const match = (row: any, where: any = {}): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        if ("contains" in (v as any)) {
          return String(row[k] ?? "").toLowerCase().includes(String((v as any).contains).toLowerCase());
        }
        return false;
      }
      return row[k] === v;
    });
  const applyData = (row: any, data: any) => {
    for (const [k, v] of Object.entries(data ?? {})) {
      if (v && typeof v === "object" && "increment" in (v as any)) row[k] = (row[k] ?? 0) + (v as any).increment;
      else row[k] = v;
    }
    if ("updatedAt" in row) row.updatedAt = new Date();
  };
  const sortBy = (out: any[], orderBy: any) => {
    if (!orderBy) return out;
    const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
    for (const spec of [...specs].reverse()) {
      const entry = Object.entries(spec as any)[0] as any;
      if (!entry) continue;
      const [field, dirRaw] = entry;
      const dir = typeof dirRaw === "object" ? (dirRaw as any).sort : dirRaw;
      out.sort((a, b) => {
        const av = a[field], bv = b[field];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return dir === "desc" ? -cmp : cmp;
      });
    }
    return out;
  };
  const table: any = {
    rows,
    count: async ({ where }: any = {}) => rows.filter((r) => match(r, where)).length,
    findMany: async ({ where, orderBy, take, skip, distinct }: any = {}) => {
      let out = rows.filter((r) => match(r, where));
      if (distinct) {
        const seen = new Set<string>();
        out = out.filter((r) => {
          const key = (distinct as string[]).map((d) => String(r[d])).join("|");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      out = sortBy(out, orderBy);
      if (skip) out = out.slice(skip);
      if (take) out = out.slice(0, take);
      return out;
    },
    findFirst: async ({ where, orderBy }: any = {}) => {
      const out = sortBy(rows.filter((r) => match(r, where)), orderBy);
      return out[0] ?? null;
    },
    findUnique: async ({ where }: any = {}) => rows.find((r) => match(r, where)) ?? null,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `gen-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => match(r, where));
      if (!row) throw new Error("record not found");
      applyData(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const hits = rows.filter((r) => match(r, where));
      hits.forEach((r) => applyData(r, data));
      return { count: hits.length };
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => match(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => match(r, where));
      if (row) {
        applyData(row, update);
        return row;
      }
      return table.create({ data: create });
    },
    aggregate: async ({ where, _sum }: any = {}) => {
      const hits = rows.filter((r) => match(r, where));
      const out: any = { _sum: {} };
      for (const field of Object.keys(_sum ?? {})) {
        out._sum[field] = hits.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
      }
      return out;
    },
  };
  return table;
}

// ---------------- fixtures ----------------

const ADMIN: any = { id: "super-1", isSuperAdmin: true, status: "ACTIVE", adminTier: "SUPER", totpEnabled: true, tokenVersion: 0 };
const ORG_A = "org-a";
const ORG_B = "org-b";
const ORG_C = "org-c"; // exists, but has no BusinessProfile row
const Q_A = "ডেলিভারি চার্জ কত?";
const Q_B = "ফেরতের নিয়ম কী?";

function buildWorld() {
  const now = new Date("2026-10-17T00:00:00Z");
  const prisma: any = {
    organization: makeTable([
      { id: ORG_A, name: "Shop A", slug: "shop-a", country: "BD", currency: "BDT", timezone: "Asia/Dhaka", verificationStatus: "verified", createdAt: now },
      { id: ORG_B, name: "Shop B", slug: "shop-b", country: "BD", currency: "BDT", timezone: "Asia/Dhaka", verificationStatus: "unverified", createdAt: now },
      { id: ORG_C, name: "Shop C", slug: "shop-c", country: "BD", currency: "BDT", timezone: "Asia/Dhaka", verificationStatus: "unverified", createdAt: now },
    ]),
    businessProfile: makeTable([
      { id: "prof-a", organizationId: ORG_A, answerStoreEnabled: true, conversationLearningEnabled: true, websiteLearningEnabled: true, websiteUrl: "https://a.example", updatedAt: now },
      { id: "prof-b", organizationId: ORG_B, answerStoreEnabled: true, conversationLearningEnabled: false, websiteLearningEnabled: true, websiteUrl: null, updatedAt: now },
    ]),
    businessPolicy: makeTable([{ id: "pol-a", organizationId: ORG_A }]),
    knowledgeDocument: makeTable([
      { id: "doc-a1", organizationId: ORG_A, kind: "faq", visibility: "public" },
      { id: "doc-a2", organizationId: ORG_A, kind: "website", visibility: "public" },
      { id: "doc-a3", organizationId: ORG_A, kind: "note", visibility: "internal" },
      { id: "doc-b1", organizationId: ORG_B, kind: "faq", visibility: "public" },
    ]),
    knowledgeEmbedding: makeTable([
      { id: "emb-1", organizationId: ORG_A, sourceType: "product", sourceId: "p1" },
      { id: "emb-2", organizationId: ORG_A, sourceType: "product", sourceId: "p2" },
      { id: "emb-3", organizationId: ORG_A, sourceType: "document", sourceId: "doc-a1" },
    ]),
    aiStoredAnswer: makeTable([
      { id: "ans-a1", organizationId: ORG_A, questionText: Q_A, normalizedQuestion: normalizeQuestion(Q_A), answerText: "ডেলিভারি চার্জ ৬০ টাকা।", channel: "inbox", language: "bn", origin: "staff_approved", status: "active", invalidReason: null, hitCount: 3, lastHitAt: null, containsLiveFacts: false, sourceRefs: null, groundedAt: now, createdAt: now, updatedAt: now },
      { id: "ans-a2", organizationId: ORG_A, questionText: "পুরনো প্রশ্ন", normalizedQuestion: "পুরনো প্রশ্ন", answerText: "...", channel: "inbox", language: "bn", origin: "autopilot", status: "invalidated", invalidReason: "source_doc_changed", hitCount: 1, lastHitAt: null, containsLiveFacts: false, sourceRefs: null, groundedAt: now, createdAt: now, updatedAt: now },
      { id: "ans-a3", organizationId: ORG_A, questionText: "বন্ধ প্রশ্ন", normalizedQuestion: "বন্ধ প্রশ্ন", answerText: "...", channel: "inbox", language: "bn", origin: "autopilot", status: "disabled", invalidReason: null, hitCount: 2, lastHitAt: null, containsLiveFacts: false, sourceRefs: null, groundedAt: now, createdAt: now, updatedAt: now },
      { id: "ans-b1", organizationId: ORG_B, questionText: Q_B, normalizedQuestion: normalizeQuestion(Q_B), answerText: "৭ দিনের মধ্যে ফেরত দেওয়া যায়।", channel: "inbox", language: "bn", origin: "staff_approved", status: "active", invalidReason: null, hitCount: 5, lastHitAt: null, containsLiveFacts: false, sourceRefs: null, groundedAt: now, createdAt: now, updatedAt: now },
    ]),
    learnedItem: makeTable([
      { id: "li-a1", organizationId: ORG_A, kind: "fact", title: "ওয়েবসাইট তথ্য", content: { text: "দোকান সকাল ৯টা থেকে রাত ৯টা খোলা থাকে" }, sourceType: "website", sourceRef: null, status: "suggested", reviewedById: null, reviewedAt: null, reviewedVia: null, appliedRef: null, dedupeKey: "dk-a1", createdAt: now, updatedAt: now },
      { id: "li-a2", organizationId: ORG_A, kind: "fact", title: "কথোপকথনের তথ্য", content: { text: "ক্যাশ অন ডেলিভারি সারা দেশে" }, sourceType: "conversation", sourceRef: null, status: "suggested", reviewedById: null, reviewedAt: null, reviewedVia: null, appliedRef: null, dedupeKey: "dk-a2", createdAt: now, updatedAt: now },
      { id: "li-a3", organizationId: ORG_A, kind: "fact", title: "আগের অনুমোদিত", content: { text: "..." }, sourceType: "product", sourceRef: null, status: "approved", reviewedById: "staff-a", reviewedAt: now, reviewedVia: "org", appliedRef: "knowledge:x", dedupeKey: "dk-a3", createdAt: now, updatedAt: now },
      { id: "li-a4", organizationId: ORG_A, kind: "product_note", title: "পণ্য নোট", content: { text: "এই পণ্য ভঙ্গুর, যত্নে প্যাক করুন", productId: "p1" }, sourceType: "product", sourceRef: null, status: "suggested", reviewedById: null, reviewedAt: null, reviewedVia: null, appliedRef: null, dedupeKey: "dk-a4", createdAt: now, updatedAt: now },
      { id: "li-b1", organizationId: ORG_B, kind: "fact", title: "B-এর প্রস্তাব", content: { text: "B sentinel" }, sourceType: "website", sourceRef: null, status: "suggested", reviewedById: null, reviewedAt: null, reviewedVia: null, appliedRef: null, dedupeKey: "dk-b1", createdAt: now, updatedAt: now },
    ]),
    aiUnansweredQuestion: makeTable([{ id: "uq-a1", organizationId: ORG_A, status: "open" }]),
    customerMemory: makeTable([
      { id: "cm-a1", organizationId: ORG_A, customerKey: "messenger:111", displayName: "Rahim", languagePref: "bn", orderCount: 2, lastOrderAt: now, lastInteractionAt: now, updatedAt: now },
      { id: "cm-a2", organizationId: ORG_A, customerKey: "messenger:222", displayName: "Karim", languagePref: "bn", orderCount: 1, lastOrderAt: now, lastInteractionAt: now, updatedAt: now },
      { id: "cm-b1", organizationId: ORG_B, customerKey: "messenger:111", displayName: "B Customer", languagePref: "bn", orderCount: 4, lastOrderAt: now, lastInteractionAt: now, updatedAt: now },
    ]),
    aiBrandVoiceProfile: makeTable([]),
    performanceSnapshot: makeTable([
      { id: "snap-a1", organizationId: ORG_A, periodStart: new Date("2026-10-10"), periodEnd: new Date("2026-10-16"), computedAt: now },
    ]),
    learningState: makeTable([
      { id: "ls-a1", organizationId: ORG_A, source: "website", lastRunAt: now, lastStatus: "ok", lastDetail: {} },
    ]),
    aiAutonomySetting: makeTable([
      { id: "aut-a1", organizationId: ORG_A, actionId: "close_conversation", level: 2, updatedById: "staff-a", updatedAt: now },
      { id: "aut-a2", organizationId: ORG_A, actionId: "hide_comment", level: 0, updatedById: "staff-a", updatedAt: now },
      { id: "aut-b1", organizationId: ORG_B, actionId: "block_sender", level: 2, updatedById: "staff-b", updatedAt: now },
    ]),
    dailyAdMetric: makeTable([
      { id: "adm-a1", organizationId: ORG_A },
      { id: "adm-a2", organizationId: ORG_A },
    ]),
    competitor: makeTable([{ id: "comp-a1", organizationId: ORG_A }]),
    auditLog: makeTable([]),
  };

  const audit = new AuditService(prisma as any);
  const answerStore = new AnswerStoreService(prisma as any, undefined);
  const learning = new LearningService(prisma as any, answerStore, { indexDocument: async () => ({ ok: true }) } as any, audit);
  const brainAdmin = new BrainAdminService(prisma as any, undefined, learning, audit);
  const brain = new AdminBrainService(prisma as any, audit, brainAdmin);
  const fixes = new AdminBrainFixService(prisma as any, audit, brain, brainAdmin, answerStore, learning);
  const controller = new AdminAiController({} as any, {} as any, brain, fixes, {} as any);
  const auditRows = (action?: string) =>
    (prisma.auditLog.rows as any[]).filter((r) => !action || r.action === action);
  return { prisma, audit, answerStore, learning, brainAdmin, brain, fixes, controller, auditRows };
}

// ---------------- authorisation ----------------

describe("SA-B23 authorisation (SUPER only)", () => {
  const USERS: Record<string, any> = {
    "tenant-owner": { id: "tenant-owner", isSuperAdmin: false, status: "ACTIVE", tokenVersion: 0 },
    "support-1": { id: "support-1", isSuperAdmin: true, status: "ACTIVE", adminTier: "SUPPORT", totpEnabled: true, tokenVersion: 0 },
    "super-1": { id: "super-1", isSuperAdmin: true, status: "ACTIVE", adminTier: "SUPER", totpEnabled: true, tokenVersion: 0 },
  };
  const guardPrisma = () =>
    ({
      user: { findUnique: async ({ where }: any) => USERS[where.id] ?? null },
      systemSetting: { findUnique: async () => null },
    }) as any;
  const ctxFor = (req: any) =>
    ({ switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null }) as any;

  it("the controller class carries the SUPER tier", () => {
    expect(Reflect.getMetadata(ADMIN_TIER_KEY, AdminAiController)).toEqual(["SUPER"]);
  });

  it("a tenant OWNER is refused (not a platform admin)", async () => {
    const guard = new SuperAdminGuard(guardPrisma(), { getAllAndOverride: () => ["SUPER"] } as any);
    await expect(
      guard.canActivate(ctxFor({ user: { userId: "tenant-owner", tv: 0 }, headers: {}, method: "GET", url: "/admin/ai/orgs/org-a/brain" })),
    ).rejects.toMatchObject({ code: "common.platformAdminRequired" });
  });

  it("a SUPPORT admin is refused on the SUPER tier", async () => {
    const guard = new SuperAdminGuard(guardPrisma(), { getAllAndOverride: () => ["SUPER"] } as any);
    await expect(
      guard.canActivate(ctxFor({ user: { userId: "support-1", tv: 0 }, headers: {}, method: "GET", url: "/admin/ai/orgs/org-a/brain" })),
    ).rejects.toThrow(/SUPER/);
  });

  it("a SUPER admin is admitted", async () => {
    const guard = new SuperAdminGuard(guardPrisma(), { getAllAndOverride: () => ["SUPER"] } as any);
    const req: any = { user: { userId: "super-1", tv: 0 }, headers: {}, method: "GET", url: "/admin/ai/orgs/org-a/brain" };
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.adminTier).toBe("SUPER");
  });
});

// ---------------- view ----------------

describe("SA-B23 admin Brain view", () => {
  it("returns identity + the SA-B6 overview + breakdowns for the path org only", async () => {
    const w = buildWorld();
    const view = await w.controller.viewOrgBrain({ adminUser: ADMIN, ip: "10.0.0.1" } as any, ORG_A);
    expect(view.organization).toMatchObject({ id: ORG_A, name: "Shop A", slug: "shop-a" });
    expect(view.overview.knowledge).toEqual({ total: 3, public: 2, internal: 1, websitePages: 1 });
    expect(view.overview.answers).toMatchObject({ active: 1, invalidated: 1, disabled: 1, total: 3, totalHits: 6, storeEnabled: true });
    expect(view.overview.embeddings).toMatchObject({ indexedChunks: 3, indexedProducts: 2 });
    expect(view.overview.customerMemories).toEqual({ count: 2 });
    expect(view.learned.byStatus).toEqual({ suggested: 3, approved: 1, rejected: 0 });
    expect(view.learned.bySourceType).toMatchObject({ website: 1, conversation: 1, product: 2, competitor: 0 });
    expect(view.autonomy.defaultLevel).toBe(1);
    expect(view.autonomy.configured.map((c: any) => c.actionId)).toEqual(["close_conversation", "hide_comment"]);
    expect(view.digests).toEqual({ performance: true, ads: true, competitor: true });
    // No org-B data anywhere in org A's view.
    expect(JSON.stringify(view)).not.toContain("shop-b");
    expect(JSON.stringify(view.autonomy)).not.toContain("block_sender");
  });

  it("org B's view carries org B's numbers and absent-digest flags", async () => {
    const w = buildWorld();
    const view = await w.brain.viewBrain(ADMIN, ORG_B);
    expect(view.overview.knowledge.total).toBe(1);
    expect(view.overview.customerMemories).toEqual({ count: 1 });
    expect(view.learned.byStatus).toEqual({ suggested: 1, approved: 0, rejected: 0 });
    expect(view.digests).toEqual({ performance: false, ads: false, competitor: false });
  });

  it("writes exactly one audit row per view, org-scoped, actor = the admin", async () => {
    const w = buildWorld();
    await w.brain.viewBrain(ADMIN, ORG_A, "10.0.0.9");
    await w.brain.viewBrain(ADMIN, ORG_A, "10.0.0.9");
    const rows = w.auditRows("admin.ai_brain_view");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ organizationId: ORG_A, userId: "super-1", entityType: "Organization", entityId: ORG_A, ipAddress: "10.0.0.9" });
    expect(w.auditRows()).toHaveLength(2); // the view writes nothing else
  });

  it("an unknown org is a 404 and writes no audit row", async () => {
    const w = buildWorld();
    await expect(w.brain.viewBrain(ADMIN, "org-nope")).rejects.toMatchObject({ code: "admin.organizationNotFound" });
    expect(w.auditRows()).toHaveLength(0);
  });
});

// ---------------- fix (a): invalidate a stored answer ----------------

describe("SA-B23 fix: invalidate stored answer", () => {
  it("removes the answer from serving and records the reason verbatim", async () => {
    const w = buildWorld();
    const before = await w.answerStore.lookup(ORG_A, Q_A);
    expect(before.hit).toBe(true);

    const reason = "দাম বদলেছে — এই উত্তর আর সঠিক নয়";
    const res = await w.fixes.invalidateAnswer(ADMIN, ORG_A, "ans-a1", reason);
    expect(res).toMatchObject({ id: "ans-a1", status: "invalidated", invalidReason: reason, decidedVia: "admin_console" });

    const after = await w.answerStore.lookup(ORG_A, Q_A);
    expect(after).toMatchObject({ hit: false, reason: "no_match" });

    const rows = w.auditRows("admin.ai_brain_fix_answer_invalidate");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organizationId: ORG_A, userId: "super-1", entityId: "ans-a1" });
    expect((rows[0].metadata as any).reason).toBe(reason);
    expect((rows[0].metadata as any).previousStatus).toBe("active");
    // Org B's answer is untouched and still serving.
    const rowB = await w.prisma.aiStoredAnswer.findFirst({ where: { id: "ans-b1", organizationId: ORG_B } });
    expect(rowB.status).toBe("active");
  });

  it("an answer id from another org is a 404 on this path and stays untouched", async () => {
    const w = buildWorld();
    await expect(w.fixes.invalidateAnswer(ADMIN, ORG_A, "ans-b1", "কারণ")).rejects.toMatchObject({ code: "admin.storedAnswerNotFound" });
    const rowB = await w.prisma.aiStoredAnswer.findFirst({ where: { id: "ans-b1", organizationId: ORG_B } });
    expect(rowB.status).toBe("active");
    expect(w.auditRows("admin.ai_brain_fix_answer_invalidate")).toHaveLength(0);
  });

  it("empty reason = 400 before any mutation or audit", async () => {
    const w = buildWorld();
    await expect(w.fixes.invalidateAnswer(ADMIN, ORG_A, "ans-a1", "   ")).rejects.toMatchObject({ code: "admin.aReasonIsRequiredForEvery" });
    const row = await w.prisma.aiStoredAnswer.findFirst({ where: { id: "ans-a1", organizationId: ORG_A } });
    expect(row.status).toBe("active");
    expect(w.auditRows()).toHaveLength(0);
    const still = await w.answerStore.lookup(ORG_A, Q_A);
    expect(still.hit).toBe(true);
  });
});

// ---------------- fix (b): learned-item review ----------------

describe("SA-B23 fix: learned-item review as admin", () => {
  it("approve lands through LearningService with admin_console provenance", async () => {
    const w = buildWorld();
    const reason = "তথ্য যাচাই করা হয়েছে, ঠিক আছে";
    const res = await w.fixes.reviewLearnedItem(ADMIN, ORG_A, "li-a1", "approve", reason);
    expect(res).toMatchObject({ id: "li-a1", status: "approved", reviewedById: "super-1", reviewedVia: "admin_console" });
    expect(res.appliedRef).toMatch(/^knowledge:/);
    // The approval actually applied: a knowledge doc exists for org A.
    const docs = await w.prisma.knowledgeDocument.findMany({ where: { organizationId: ORG_A, source: "learned:website" } });
    expect(docs).toHaveLength(1);
    // The tenant-side audit row names the console via too.
    const tenantRows = w.auditRows("learning.approve");
    expect(tenantRows).toHaveLength(1);
    expect((tenantRows[0].metadata as any).via).toBe("admin_console");
    // And the admin fix row carries the reason verbatim.
    const fixRows = w.auditRows("admin.ai_brain_fix_learned_approve");
    expect(fixRows).toHaveLength(1);
    expect((fixRows[0].metadata as any).reason).toBe(reason);
    // Org B's pending item is untouched.
    const liB = await w.prisma.learnedItem.findFirst({ where: { id: "li-b1", organizationId: ORG_B } });
    expect(liB.status).toBe("suggested");
  });

  it("reject stamps admin_console provenance and audits both rows", async () => {
    const w = buildWorld();
    const res = await w.fixes.reviewLearnedItem(ADMIN, ORG_A, "li-a2", "reject", "ভুল তথ্য");
    expect(res).toMatchObject({ status: "rejected", reviewedVia: "admin_console", reviewedById: "super-1" });
    expect(w.auditRows("learning.reject")).toHaveLength(1);
    expect((w.auditRows("learning.reject")[0].metadata as any).via).toBe("admin_console");
    expect(w.auditRows("admin.ai_brain_fix_learned_reject")).toHaveLength(1);
  });

  it("a staff decision stamps reviewedVia 'org' — distinguishable from the console", async () => {
    const w = buildWorld();
    const updated: any = await w.learning.approve(ORG_A, "staff-a", "li-a4", {});
    expect(updated.reviewedVia).toBe("org");
    expect(updated.reviewedById).toBe("staff-a");
  });

  it("empty reason = 400, the item stays suggested, no audit rows", async () => {
    const w = buildWorld();
    await expect(w.fixes.reviewLearnedItem(ADMIN, ORG_A, "li-a1", "approve", "")).rejects.toMatchObject({ code: "admin.aReasonIsRequiredForEvery" });
    const item = await w.prisma.learnedItem.findFirst({ where: { id: "li-a1", organizationId: ORG_A } });
    expect(item.status).toBe("suggested");
    expect(w.auditRows()).toHaveLength(0);
  });

  it("an invalid decision is a 400 before anything happens", async () => {
    const w = buildWorld();
    await expect(w.fixes.reviewLearnedItem(ADMIN, ORG_A, "li-a1", "maybe", "কারণ")).rejects.toMatchObject({ code: "admin.decisionMustBeApproveOrReject" });
    expect(w.auditRows()).toHaveLength(0);
  });
});

// ---------------- fix (c): forget customer memory by key ----------------

describe("SA-B23 fix: forget customer memory by key", () => {
  it("removes only the path org's row for that key", async () => {
    const w = buildWorld();
    const res = await w.fixes.forgetCustomerMemory(ADMIN, ORG_A, "messenger:111", "কাস্টমার ভুলে যেতে বলেছেন");
    expect(res).toMatchObject({ deleted: true, customerKey: "messenger:111", decidedVia: "admin_console" });
    expect(await w.prisma.customerMemory.findFirst({ where: { organizationId: ORG_A, customerKey: "messenger:111" } })).toBeNull();
    // The org's other customer survives; org B's row under the SAME key survives.
    expect(await w.prisma.customerMemory.findFirst({ where: { organizationId: ORG_A, customerKey: "messenger:222" } })).not.toBeNull();
    expect(await w.prisma.customerMemory.findFirst({ where: { organizationId: ORG_B, customerKey: "messenger:111" } })).not.toBeNull();
    // Both audit trails exist: the B6 forget row (actor = admin) and the admin fix row with the reason.
    expect(w.auditRows("customer_memory.forget")).toHaveLength(1);
    expect(w.auditRows("customer_memory.forget")[0]).toMatchObject({ organizationId: ORG_A, userId: "super-1" });
    const fixRows = w.auditRows("admin.ai_brain_fix_memory_forget");
    expect(fixRows).toHaveLength(1);
    expect((fixRows[0].metadata as any).reason).toBe("কাস্টমার ভুলে যেতে বলেছেন");
  });

  it("an unknown key is a 404; an empty reason is a 400 with the row intact", async () => {
    const w = buildWorld();
    await expect(w.fixes.forgetCustomerMemory(ADMIN, ORG_A, "messenger:999", "কারণ")).rejects.toMatchObject({ code: "admin.customerMemoryNotFound" });
    await expect(w.fixes.forgetCustomerMemory(ADMIN, ORG_A, "messenger:111", " ")).rejects.toMatchObject({ code: "admin.aReasonIsRequiredForEvery" });
    expect(await w.prisma.customerMemory.findFirst({ where: { organizationId: ORG_A, customerKey: "messenger:111" } })).not.toBeNull();
    expect(w.auditRows("admin.ai_brain_fix_memory_forget")).toHaveLength(0);
  });
});

// ---------------- fix (d): answer-store toggle override ----------------

describe("SA-B23 fix: answer-store toggle override", () => {
  it("flips the org's switch, and the store's own gate honours it", async () => {
    const w = buildWorld();
    const res = await w.fixes.setAnswerStoreEnabled(ADMIN, ORG_A, false, "ভুল উত্তর যাচ্ছে, সাময়িক বন্ধ");
    expect(res).toMatchObject({ organizationId: ORG_A, answerStoreEnabled: false, previousEnabled: true, decidedVia: "admin_console" });
    const profile = await w.prisma.businessProfile.findUnique({ where: { organizationId: ORG_A } });
    expect(profile.answerStoreEnabled).toBe(false);
    // The store itself now refuses to serve for org A…
    const gated = await w.answerStore.lookup(ORG_A, Q_A);
    expect(gated).toMatchObject({ hit: false, reason: "answer_store_disabled" });
    // …while org B's profile and serving are untouched.
    const profileB = await w.prisma.businessProfile.findUnique({ where: { organizationId: ORG_B } });
    expect(profileB.answerStoreEnabled).toBe(true);
    const servedB = await w.answerStore.lookup(ORG_B, Q_B);
    expect(servedB.hit).toBe(true);
    const rows = w.auditRows("admin.ai_brain_fix_answer_store_toggle");
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ reason: "ভুল উত্তর যাচ্ছে, সাময়িক বন্ধ", from: true, to: false });
  });

  it("creates the profile row for an org that has none (upsert, the tenant path's shape)", async () => {
    const w = buildWorld();
    const res = await w.fixes.setAnswerStoreEnabled(ADMIN, ORG_C, false, "নতুন দোকান, প্রস্তুত নয়");
    expect(res).toMatchObject({ organizationId: ORG_C, answerStoreEnabled: false, previousEnabled: true });
    const profile = await w.prisma.businessProfile.findUnique({ where: { organizationId: ORG_C } });
    expect(profile).toMatchObject({ organizationId: ORG_C, answerStoreEnabled: false });
  });

  it("empty reason = 400 and the switch does not move", async () => {
    const w = buildWorld();
    await expect(w.fixes.setAnswerStoreEnabled(ADMIN, ORG_A, false, "")).rejects.toMatchObject({ code: "admin.aReasonIsRequiredForEvery" });
    const profile = await w.prisma.businessProfile.findUnique({ where: { organizationId: ORG_A } });
    expect(profile.answerStoreEnabled).toBe(true);
    expect(w.auditRows()).toHaveLength(0);
  });
});
