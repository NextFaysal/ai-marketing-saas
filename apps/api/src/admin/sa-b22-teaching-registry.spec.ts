import "reflect-metadata";
import { SuperAdminGuard, ADMIN_TIER_KEY } from "../common/super-admin.guard";
import { AdminAiController } from "./admin-ai.controller";
import { PlatformTeachingService } from "./platform-teaching.service";
import { LearningSourcesService } from "./learning-sources.service";
import { OrgBrainService, PLATFORM_GUIDANCE_HEADING } from "../ai/org-brain.service";
import { buildReplyQualityBlock, resolveReplyLanguage } from "../ai/reply-quality";
import { extractGuardNumbers } from "../inbox/business-brain";

/**
 * SA-B22 (Smart AI Phase 6, T1 + plan T2) — guarantees:
 *  - The Admin Training Console API is SUPER-only: the class
 *    carries the SUPER tier, a tenant OWNER is refused by the
 *    guard (not a platform admin at all), and a SUPPORT admin
 *    is refused on the tier.
 *  - Teaching CRUD stamps the acting admin, audits every
 *    mutation, and a disabled item is absent from every Brain
 *    context.
 *  - The guidance channel wall: teaching ships ONLY in
 *    OrgBrainContext.platformGuidance (assembled last, under
 *    the verbatim yield heading) — a number-bearing teaching
 *    item never enters facts/factsText/knowledge, so the
 *    number guard's allowed set never contains its numbers
 *    and it cannot ground a customer answer.
 *  - Precedence structure: the composed reply-quality block
 *    renders platform guidance AFTER the shop's own style
 *    guidance; the same guidance serves every org while org
 *    facts stay isolated (L1).
 *  - Registry truth: every counter equals the fixture rows;
 *    not-built sources report not_built with null counters,
 *    never a fabricated count.
 */

// ---------------- guard fixtures ----------------

const USERS: Record<string, any> = {
  "tenant-owner": { id: "tenant-owner", isSuperAdmin: false, status: "ACTIVE", tokenVersion: 0 },
  "support-1": { id: "support-1", isSuperAdmin: true, status: "ACTIVE", adminTier: "SUPPORT", totpEnabled: true, tokenVersion: 0 },
  "super-1": { id: "super-1", isSuperAdmin: true, status: "ACTIVE", adminTier: "SUPER", totpEnabled: true, tokenVersion: 0 },
};

function guardPrisma() {
  return {
    user: { findUnique: async ({ where }: any) => USERS[where.id] ?? null },
    systemSetting: { findUnique: async () => null },
  } as any;
}

const ctxFor = (req: any) =>
  ({ switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null }) as any;

describe("SA-B22 authorisation (SUPER only)", () => {
  it("the controller class carries the SUPER tier", () => {
    expect(Reflect.getMetadata(ADMIN_TIER_KEY, AdminAiController)).toEqual(["SUPER"]);
  });

  it("a tenant OWNER is refused (not a platform admin)", async () => {
    const guard = new SuperAdminGuard(guardPrisma(), { getAllAndOverride: () => ["SUPER"] } as any);
    await expect(
      guard.canActivate(ctxFor({ user: { userId: "tenant-owner", tv: 0 }, headers: {}, method: "GET", url: "/admin/ai/teaching" })),
    ).rejects.toMatchObject({ code: "common.platformAdminRequired" });
  });

  it("a SUPPORT admin is refused on the SUPER tier", async () => {
    const guard = new SuperAdminGuard(guardPrisma(), { getAllAndOverride: () => ["SUPER"] } as any);
    await expect(
      guard.canActivate(ctxFor({ user: { userId: "support-1", tv: 0 }, headers: {}, method: "GET", url: "/admin/ai/teaching" })),
    ).rejects.toThrow(/SUPER/);
  });

  it("a SUPER admin is admitted", async () => {
    const guard = new SuperAdminGuard(guardPrisma(), { getAllAndOverride: () => ["SUPER"] } as any);
    const req: any = { user: { userId: "super-1", tv: 0 }, headers: {}, method: "GET", url: "/admin/ai/teaching" };
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.adminTier).toBe("SUPER");
  });
});

// ---------------- teaching service fixtures ----------------

function teachingTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findMany: async ({ orderBy }: any = {}) => {
      let out = [...rows];
      if (Array.isArray(orderBy)) out.sort((a, b) => (a.sortOrder - b.sortOrder) || (+new Date(a.createdAt) - +new Date(b.createdAt)));
      return out;
    },
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    create: async ({ data }: any) => {
      const row = { id: `t-${++seq}`, createdAt: new Date(1000 + seq), updatedAt: new Date(1000 + seq), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      return rows.splice(i, 1)[0];
    },
  };
}

describe("SA-B22 PlatformTeachingService", () => {
  it("create stamps the acting admin and audits; bad kind/language refused", async () => {
    const table = teachingTable();
    const logs: any[] = [];
    const svc = new PlatformTeachingService({ platformTeaching: table } as any, { log: async (e: any) => { logs.push(e); } } as any);
    const actor = { id: "super-1" };
    const row = await svc.create(actor, { title: "ভদ্র ভাষা", content: "সবসময় ভদ্রভাবে উত্তর দাও।", kind: "style" }, "1.2.3.4");
    expect(row.createdById).toBe("super-1");
    expect(row.enabled).toBe(true);
    expect(row.language).toBe("bn");
    expect(logs.find((l) => l.action === "admin.ai_teaching_create")?.entityId).toBe(row.id);
    await expect(svc.create(actor, { title: "x", content: "y", kind: "facts" })).rejects.toThrow(/kind/);
    await expect(svc.create(actor, { title: "x", content: "y", language: "fr" })).rejects.toThrow(/language/);
  });

  it("update + disable + delete flow, with not-found honesty", async () => {
    const table = teachingTable();
    const logs: any[] = [];
    const svc = new PlatformTeachingService({ platformTeaching: table } as any, { log: async (e: any) => { logs.push(e); } } as any);
    const actor = { id: "super-1" };
    const row = await svc.create(actor, { title: "T", content: "C", sortOrder: 2 });
    const updated = await svc.update(actor, row.id, { sortOrder: 1 });
    expect(updated.sortOrder).toBe(1);
    expect(updated.updatedById).toBe("super-1");
    const disabled = await svc.setEnabled(actor, row.id, false);
    expect(disabled.enabled).toBe(false);
    expect(logs.some((l) => l.action === "admin.ai_teaching_disable")).toBe(true);
    await expect(svc.setEnabled(actor, "missing", true)).rejects.toMatchObject({ code: "admin.teachingItemNotFound" });
    const out = await svc.remove(actor, row.id);
    expect(out.deleted).toBe(true);
    expect(table.rows.length).toBe(0);
  });
});

// ---------------- Brain wiring fixtures ----------------

const A = "org-a";
const B = "org-b";

function brainPrisma(teachingRows: any[]) {
  const profiles: Record<string, any> = {
    [A]: {
      organizationId: A, industry: "Fashion", description: "A shop", brandVoice: null,
      goals: "GOAL_SENTINEL_A", aiInstructions: "Be polite", aiReplyLanguage: "bn",
      deliveryChargeInsideMinor: BigInt(6000), codAvailable: true, bkashNumber: "01711111111",
      contactPhone: "01711111111",
    },
    [B]: {
      organizationId: B, industry: "Electronics", description: "B shop", brandVoice: null,
      goals: "GOAL_SENTINEL_B", aiInstructions: null, aiReplyLanguage: null,
    },
  };
  return {
    businessProfile: { findUnique: async ({ where }: any) => profiles[where.organizationId] ?? null },
    organization: { findUnique: async ({ where }: any) => ({ id: where.id, name: where.id === A ? "Shop A" : "Shop B" }) },
    businessPolicy: { findMany: async () => [], findFirst: async () => null },
    knowledgeDocument: { findMany: async () => [] },
    platformTeaching: {
      findMany: async ({ where, orderBy, take }: any) => {
        let out = teachingRows.filter((r) => (where?.enabled === undefined ? true : r.enabled === where.enabled));
        if (Array.isArray(orderBy)) out = [...out].sort((x, y) => (x.sortOrder - y.sortOrder) || (+new Date(x.createdAt) - +new Date(y.createdAt)));
        return take ? out.slice(0, take) : out;
      },
    },
  } as any;
}

const TEACHING = [
  { id: "t-1", title: "ছাড়ের নিয়ম", content: "সব দোকানে ৫০% ছাড় চলছে", language: "bn", kind: "policy", enabled: true, sortOrder: 0, createdAt: new Date(1) },
  { id: "t-2", title: "Greeting", content: "Greet every customer warmly.", language: "en", kind: "style", enabled: true, sortOrder: 1, createdAt: new Date(2) },
  { id: "t-3", title: "Hidden", content: "DISABLED_TEACHING_SENTINEL", language: "en", kind: "guidance", enabled: false, sortOrder: 2, createdAt: new Date(3) },
];

describe("SA-B22 Brain guidance channel", () => {
  it("guidance present for customer + internal, under the verbatim yield heading, disabled absent", async () => {
    const svc = new OrgBrainService(brainPrisma(TEACHING));
    for (const audience of ["customer", "internal"] as const) {
      const ctx = await svc.getContext(A, { audience });
      expect(ctx.platformGuidance).toContain(PLATFORM_GUIDANCE_HEADING);
      expect(ctx.platformGuidance).toContain("Greet every customer warmly.");
      expect(ctx.platformGuidance).not.toContain("DISABLED_TEACHING_SENTINEL");
    }
  });

  it("the wall: number-bearing teaching never enters the fact channels", async () => {
    const svc = new OrgBrainService(brainPrisma(TEACHING));
    const ctx = await svc.getContext(A, { audience: "customer" });
    const factSide = JSON.stringify({
      facts: ctx.facts, factsText: ctx.factsText, knowledgeMatches: ctx.knowledgeMatches,
      documents: ctx.documents, deliveryFacts: ctx.deliveryFacts, paymentFacts: ctx.paymentFacts,
    });
    expect(factSide).not.toContain("ছাড়ের নিয়ম");
    expect(factSide).not.toContain("৫০");
    // The number guard's allowed set is built from the fact pack
    // (extractGuardNumbers over factsText, the Answer Store /
    // SA-B3 discipline): the teaching "50" is not in it, so a
    // customer answer quoting ৫০% would be judged invented.
    const allowed = new Set(extractGuardNumbers(ctx.factsText));
    expect(allowed.has("50")).toBe(false);
    expect(ctx.platformGuidance).toContain("৫০%");
  });

  it("platform-global yet org-isolated: same guidance for A and B, A's internal facts never in B", async () => {
    const svc = new OrgBrainService(brainPrisma(TEACHING));
    const ctxA = await svc.getContext(A, { audience: "internal" });
    const ctxB = await svc.getContext(B, { audience: "internal" });
    expect(ctxA.platformGuidance).toBe(ctxB.platformGuidance);
    expect(JSON.stringify(ctxB)).not.toContain("GOAL_SENTINEL_A");
    expect(JSON.stringify(ctxA)).not.toContain("GOAL_SENTINEL_B");
  });

  it("no enabled teaching -> platformGuidance is null (pre-B22 composition)", async () => {
    const svc = new OrgBrainService(brainPrisma(TEACHING.map((t) => ({ ...t, enabled: false }))));
    const ctx = await svc.getContext(A, { audience: "customer" });
    expect(ctx.platformGuidance).toBeNull();
  });

  it("assembly order: platformGuidance is the last section of the context", async () => {
    const svc = new OrgBrainService(brainPrisma(TEACHING));
    const ctx = await svc.getContext(A, { audience: "internal" });
    const keys = Object.keys(ctx);
    expect(keys[keys.length - 1]).toBe("platformGuidance");
    expect(keys.indexOf("platformGuidance")).toBeGreaterThan(keys.indexOf("styleInstructions"));
    expect(keys.indexOf("platformGuidance")).toBeGreaterThan(keys.indexOf("factsText"));
  });

  it("the composed reply block renders guidance AFTER the shop's own style guidance", async () => {
    const svc = new OrgBrainService(brainPrisma(TEACHING));
    const ctx = await svc.getContext(A, { audience: "customer" });
    const block = buildReplyQualityBlock({
      language: resolveReplyLanguage({ orgReplyLanguage: "bn" }),
      styleInstructions: "SHOP_STYLE_SENTINEL",
      platformGuidance: ctx.platformGuidance,
      channel: "inbox",
    }).join("\n");
    expect(block).toContain(PLATFORM_GUIDANCE_HEADING);
    expect(block.indexOf("SHOP_STYLE_SENTINEL")).toBeLessThan(block.indexOf(PLATFORM_GUIDANCE_HEADING));
    const plain = buildReplyQualityBlock({ language: resolveReplyLanguage({ orgReplyLanguage: "bn" }), styleInstructions: "SHOP_STYLE_SENTINEL", channel: "inbox" }).join("\n");
    expect(plain).not.toContain(PLATFORM_GUIDANCE_HEADING);
  });
});

// ---------------- registry fixtures ----------------

function registryPrisma(overrides: Record<string, any> = {}) {
  const learnedCounts: Record<string, number> = { "conversation,unanswered": 11, "ads,creative": 5, competitor: 2 };
  const base: any = {
    businessProfile: {
      count: async ({ where }: any) =>
        where.conversationLearningEnabled ? 3 : where.websiteLearningEnabled ? 9 : where.answerStoreEnabled ? 7 : 0,
    },
    performanceSnapshot: { count: async () => 4 },
    learnedItem: {
      count: async ({ where }: any) => learnedCounts[(where.sourceType.in as string[]).join(",")] ?? 0,
    },
    knowledgeEmbedding: { count: async () => 13 },
    customerMemory: { count: async () => 21 },
    knowledgeDocument: { count: async () => 6 },
    aiStoredAnswer: { count: async () => 8 },
    orderReview: { count: async () => 17 },
    returnRequest: { count: async () => 19 },
  };
  return { ...base, ...overrides } as any;
}

describe("SA-B22 Sources Registry truth", () => {
  it("all 14 plan sources, counters equal to the fixture rows", async () => {
    const svc = new LearningSourcesService(registryPrisma());
    const out = await svc.registry(new Date("2026-10-17T00:00:00Z"));
    expect(out.sources).toHaveLength(14);
    expect(out.sources.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    const byId = Object.fromEntries(out.sources.map((s) => [s.id, s]));
    expect(byId[1].gate).toBe("always_on");
    expect(byId[1].itemsLast30Days).toBeNull();
    expect(byId[2].itemsLast30Days).toBe(13);
    expect(byId[3].orgsEnabled).toBe(3);
    expect(byId[3].itemsLast30Days).toBe(21);
    expect(byId[4].orgsEnabled).toBe(3);
    expect(byId[4].itemsLast30Days).toBe(11);
    expect(byId[5].status).toBe("partial");
    expect(byId[5].itemsLast30Days).toBe(8);
    expect(byId[5].orgsEnabled).toBe(7);
    expect(byId[6].itemsLast30Days).toBe(4);
    expect(byId[7].itemsLast30Days).toBe(5);
    expect(byId[8].itemsLast30Days).toBe(2);
    expect(byId[9].orgsEnabled).toBe(9);
    expect(byId[9].itemsLast30Days).toBe(6);
    expect(byId[10].status).toBe("partial");
    expect(byId[10].itemsLast30Days).toBe(17);
    expect(byId[12].status).toBe("partial");
    expect(byId[12].itemsLast30Days).toBe(19);
    expect(byId[14].status).toBe("partial");
    expect(byId[14].itemsLast30Days).toBe(4);
    expect(out.totals).toEqual({ active: 8, partial: 4, notBuilt: 2 });
  });

  it("not-built sources report not_built with null counters, never a fake count", async () => {
    const svc = new LearningSourcesService(registryPrisma());
    const out = await svc.registry(new Date("2026-10-17T00:00:00Z"));
    for (const id of [11, 13]) {
      const row = out.sources.find((s) => s.id === id)!;
      expect(row.status).toBe("not_built");
      expect(row.producingService).toBeNull();
      expect(row.storage).toBeNull();
      expect(row.gate).toBeNull();
      expect(row.orgsEnabled).toBeNull();
      expect(row.itemsLast30Days).toBeNull();
      expect(row.note).toMatch(/Not built/);
    }
  });

  it("a broken counter delegate degrades to null for its rows only", async () => {
    const svc = new LearningSourcesService(
      registryPrisma({ learnedItem: { count: async () => { throw new Error("table missing"); } } }),
    );
    const out = await svc.registry(new Date("2026-10-17T00:00:00Z"));
    const byId = Object.fromEntries(out.sources.map((s) => [s.id, s]));
    expect(byId[4].itemsLast30Days).toBeNull();
    expect(byId[7].itemsLast30Days).toBeNull();
    expect(byId[9].itemsLast30Days).toBe(6);
  });
});
