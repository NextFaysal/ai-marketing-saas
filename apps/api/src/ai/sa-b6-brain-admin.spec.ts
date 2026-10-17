import "reflect-metadata";
import { BrainAdminService } from "./brain-admin.service";
import { BrainAdminController } from "./brain-admin.controller";
import { LearningService } from "./learning.service";
import { ROLES_KEY } from "../common/decorators";

/**
 * SA-B6 (Smart AI Phase 0, P9) — guarantees for the Learn
 * Dashboard's management surface:
 *  - brain-overview numbers equal the fixture rows exactly,
 *    per org (org B's rows never move org A's numbers);
 *  - the embeddings label is honest (available -> hybrid,
 *    unavailable -> keyword with the typed reason);
 *  - Answer Store management: disable/enable round-trip works
 *    and is audited; an INVALIDATED entry can never be
 *    re-enabled (400 with the recorded reason); another org's
 *    answer id is a 404 on read/write/delete;
 *  - customer-memory forget deletes exactly that org's row and
 *    is audited; another org's memory id is a 404;
 *  - controller role metadata matches the recorded discipline
 *    (writes OWNER/ADMIN/MARKETING_MANAGER, deletes OWNER/ADMIN,
 *    reads role-free for members).
 * All doubles below are TEST doubles; production code contains
 * no fabricated data paths.
 */

// ---------- compact in-memory fake prisma ----------
function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    const val = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      if ("contains" in (cond as any)) {
        const needle = String((cond as any).contains);
        const hay = String(val ?? "");
        const ok = (cond as any).mode === "insensitive" ? hay.toLowerCase().includes(needle.toLowerCase()) : hay.includes(needle);
        if (!ok) return false;
        continue;
      }
      return false;
    }
    if (val !== cond) return false;
  }
  return true;
}
function applyOrder(rows: any[], orderBy: any): any[] {
  const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean);
  const out = [...rows];
  for (let i = specs.length - 1; i >= 0; i--) {
    const [field, dirRaw] = Object.entries(specs[i])[0] as [string, any];
    const dir = typeof dirRaw === "string" ? dirRaw : dirRaw?.sort ?? "asc";
    out.sort((a, b) => {
      const av = a[field] instanceof Date ? a[field].getTime() : a[field] ?? 0;
      const bv = b[field] instanceof Date ? b[field].getTime() : b[field] ?? 0;
      return dir === "desc" ? (bv > av ? 1 : bv < av ? -1 : 0) : av > bv ? 1 : av < bv ? -1 : 0;
    });
  }
  return out;
}
function makeTable(rows: any[]) {
  return {
    count: async (args: any = {}) => rows.filter((r) => matchesWhere(r, args.where)).length,
    findMany: async (args: any = {}) => {
      let out = rows.filter((r) => matchesWhere(r, args.where));
      if (args.distinct) {
        const seen = new Set<string>();
        out = out.filter((r) => {
          const k = (args.distinct as string[]).map((f) => String(r[f])).join("|");
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      }
      if (args.orderBy) out = applyOrder(out, args.orderBy);
      if (args.skip) out = out.slice(args.skip);
      if (args.take) out = out.slice(0, args.take);
      if (args.select) {
        out = out.map((r) => {
          const picked: any = {};
          for (const f of Object.keys(args.select)) picked[f] = r[f];
          return picked;
        });
      }
      return out;
    },
    findFirst: async (args: any = {}) => {
      let out = rows.filter((r) => matchesWhere(r, args.where));
      if (args.orderBy) out = applyOrder(out, args.orderBy);
      return out[0] ?? null;
    },
    findUnique: async (args: any = {}) => rows.find((r) => matchesWhere(r, args.where)) ?? null,
    update: async (args: any = {}) => {
      const row = rows.find((r) => r.id === args.where.id);
      if (!row) throw new Error("record not found");
      Object.assign(row, args.data);
      return row;
    },
    delete: async (args: any = {}) => {
      const idx = rows.findIndex((r) => r.id === args.where.id);
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
    aggregate: async (args: any = {}) => {
      const field = Object.keys(args._sum ?? {})[0];
      const sum = rows.filter((r) => matchesWhere(r, args.where)).reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
      return { _sum: { [field]: sum } };
    },
  };
}

const ORG_A = "org-a";
const ORG_B = "org-b";

function fixtures() {
  const t = (day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T00:00:00Z`);
  return {
    businessProfile: [
      { id: "bp-a", organizationId: ORG_A, conversationLearningEnabled: false, websiteLearningEnabled: true, websiteUrl: "https://shop-a.example.com" },
      { id: "bp-b", organizationId: ORG_B, conversationLearningEnabled: true, websiteLearningEnabled: true, websiteUrl: null },
    ],
    businessPolicy: [
      { id: "pol-1", organizationId: ORG_A },
      { id: "pol-2", organizationId: ORG_A },
      { id: "pol-3", organizationId: ORG_B },
    ],
    knowledgeDocument: [
      { id: "doc-1", organizationId: ORG_A, kind: "faq", visibility: "public" },
      { id: "doc-2", organizationId: ORG_A, kind: "note", visibility: "internal" },
      { id: "doc-3", organizationId: ORG_A, kind: "website", visibility: "public" },
      { id: "doc-4", organizationId: ORG_B, kind: "faq", visibility: "public" },
    ],
    knowledgeEmbedding: [
      { id: "emb-1", organizationId: ORG_A, sourceType: "knowledge_chunk", sourceId: "doc-1" },
      { id: "emb-2", organizationId: ORG_A, sourceType: "knowledge_chunk", sourceId: "doc-1" },
      { id: "emb-3", organizationId: ORG_A, sourceType: "product", sourceId: "prod-1" },
      { id: "emb-4", organizationId: ORG_A, sourceType: "product", sourceId: "prod-2" },
      { id: "emb-5", organizationId: ORG_A, sourceType: "product", sourceId: "prod-1" },
      { id: "emb-6", organizationId: ORG_B, sourceType: "product", sourceId: "prod-9" },
    ],
    aiStoredAnswer: [
      { id: "ans-1", organizationId: ORG_A, questionText: "ডেলিভারি চার্জ কত?", normalizedQuestion: "ডেলিভারি চার্জ কত", answerText: "ঢাকার ভিতরে ৬০ টাকা।", channel: "inbox", language: "bn", origin: "autopilot_grounded", status: "active", invalidReason: null, hitCount: 5, lastHitAt: t(10), containsLiveFacts: true, groundedAt: t(1), updatedAt: t(10), createdAt: t(1) },
      { id: "ans-2", organizationId: ORG_A, questionText: "দাম কত?", normalizedQuestion: "দাম কত", answerText: "৫০০ টাকা।", channel: "inbox", language: "bn", origin: "staff_edited", status: "invalidated", invalidReason: "product_changed", hitCount: 3, lastHitAt: t(5), containsLiveFacts: true, groundedAt: t(1), updatedAt: t(6), createdAt: t(1) },
      { id: "ans-3", organizationId: ORG_A, questionText: "খোলা থাকে কখন?", normalizedQuestion: "খোলা থাকে কখন", answerText: "সকাল ৯টা থেকে রাত ৯টা।", channel: "inbox", language: "bn", origin: "staff_approved", status: "disabled", invalidReason: null, hitCount: 2, lastHitAt: t(4), containsLiveFacts: false, groundedAt: t(1), updatedAt: t(4), createdAt: t(1) },
      { id: "ans-b", organizationId: ORG_B, questionText: "B shop question", normalizedQuestion: "b shop question", answerText: "B answer", channel: "inbox", language: "en", origin: "autopilot_grounded", status: "active", invalidReason: null, hitCount: 9, lastHitAt: t(9), containsLiveFacts: false, groundedAt: t(1), updatedAt: t(9), createdAt: t(1) },
    ],
    learnedItem: [
      { id: "li-1", organizationId: ORG_A, status: "suggested" },
      { id: "li-2", organizationId: ORG_A, status: "suggested" },
      { id: "li-3", organizationId: ORG_A, status: "approved" },
      { id: "li-4", organizationId: ORG_B, status: "suggested" },
    ],
    aiUnansweredQuestion: [
      { id: "uq-1", organizationId: ORG_A, status: "open" },
      { id: "uq-2", organizationId: ORG_A, status: "resolved" },
      { id: "uq-3", organizationId: ORG_B, status: "open" },
    ],
    customerMemory: [
      { id: "mem-1", organizationId: ORG_A, customerKey: "whatsapp:111", displayName: "Rahim", languagePref: "bn", orderCount: 2, lastOrderAt: t(8), lastInteractionAt: t(11), updatedAt: t(11), createdAt: t(2) },
      { id: "mem-2", organizationId: ORG_A, customerKey: "messenger:222", displayName: null, languagePref: "en", orderCount: 0, lastOrderAt: null, lastInteractionAt: t(9), updatedAt: t(9), createdAt: t(3) },
      { id: "mem-b", organizationId: ORG_B, customerKey: "whatsapp:999", displayName: "B Customer", languagePref: "bn", orderCount: 7, lastOrderAt: t(7), lastInteractionAt: t(12), updatedAt: t(12), createdAt: t(2) },
    ],
    aiBrandVoiceProfile: [
      { id: "vp-a", organizationId: ORG_A, status: "active", traits: {}, pendingTraits: { formality: "friendly" } },
    ],
    performanceSnapshot: [
      { id: "ps-1", organizationId: ORG_A, periodStart: t(3), periodEnd: t(10), computedAt: t(10), metrics: {} },
      { id: "ps-2", organizationId: ORG_A, periodStart: t(10), periodEnd: t(17), computedAt: t(17), metrics: {} },
      { id: "ps-b", organizationId: ORG_B, periodStart: t(10), periodEnd: t(17), computedAt: t(16), metrics: {} },
    ],
    learningState: [
      { id: "ls-1", organizationId: ORG_A, source: "website", lastRunAt: t(12), lastStatus: "ok", lastDetail: { pages: 3 } },
      { id: "ls-2", organizationId: ORG_A, source: "conversation", lastRunAt: t(12), lastStatus: "skipped", lastDetail: { reason: "conversation_learning_disabled" } },
    ],
  };
}

function makeService(embOk: boolean) {
  const fx = fixtures();
  const prisma: any = {};
  for (const [name, rows] of Object.entries(fx)) prisma[name] = makeTable(rows as any[]);
  const audit = { log: jest.fn(async () => undefined) };
  const embeddings: any = {
    resolveConfig: jest.fn(async () =>
      embOk
        ? { ok: true, config: { provider: "openai", apiKey: "k", model: "text-embedding-3-small" } }
        : { ok: false, reason: "provider_has_no_embeddings_api" },
    ),
  };
  const learning = new LearningService(prisma as any);
  const service = new BrainAdminService(prisma as any, embeddings, learning as any, audit as any);
  return { service, audit, prisma, fx };
}

describe("SA-B6 BrainAdminService — overview", () => {
  it("overview numbers equal the org-A fixtures exactly (org B never counted)", async () => {
    const { service } = makeService(true);
    const ov: any = await service.getOverview(ORG_A);
    expect(ov.knowledge).toEqual({ total: 3, public: 2, internal: 1, websitePages: 1 });
    expect(ov.embeddings.indexedChunks).toBe(6 - 1); // 5 rows belong to org A
    expect(ov.embeddings.indexedProducts).toBe(2); // prod-1 + prod-2 distinct
    // SA-B13 evolution: the answers block gained storeEnabled
    // (the per-org Answer Store switch; the fixture profile
    // predates the field, and absent = enabled by default).
    expect(ov.answers).toEqual({ active: 1, invalidated: 1, disabled: 1, total: 3, totalHits: 10, storeEnabled: true });
    expect(ov.learning.pendingSuggestions).toBe(2);
    expect(ov.unanswered.open).toBe(1);
    expect(ov.customerMemories.count).toBe(2);
    expect(ov.brandVoice).toEqual({ status: "active", hasPendingSuggestion: true });
    expect(ov.performance.periodEnd).toEqual(new Date("2026-10-17T00:00:00Z"));
    expect(ov.learning.toggles).toEqual({ conversationLearningEnabled: false, websiteLearningEnabled: true, websiteUrl: "https://shop-a.example.com" });
    expect(ov.learning.sources.website.lastStatus).toBe("ok");
    expect(ov.learning.sources.conversation.reason).toBe("conversation_learning_disabled");
    expect(ov.learning.sources.performance).toBeNull();
  });

  it("coverage is the honest setup checklist over the fixtures", async () => {
    const { service } = makeService(true);
    const ov: any = await service.getOverview(ORG_A);
    // profile ✓ policies ✓ knowledge ✓ products ✓ website ✓
    // answers ✓ (an active row exists) brandVoice ✓ (active)
    // customerMemory ✓ => 8/8.
    expect(ov.coverage.percent).toBe(100);
    expect(ov.coverage.gaps).toEqual([]);
    const ovB: any = await service.getOverview(ORG_B);
    expect(ovB.brandVoice.status).toBe("none");
    expect(ovB.coverage.gaps).toContain("brandVoice");
    expect(ovB.coverage.gaps).toContain("website");
    expect(ovB.coverage.percent).toBeLessThan(100);
  });

  it("embeddings label: available -> hybrid; unavailable -> keyword + typed reason", async () => {
    const okSvc = makeService(true);
    const ovOk: any = await okSvc.service.getOverview(ORG_A);
    expect(ovOk.embeddings.available).toBe(true);
    expect(ovOk.embeddings.retrievalMode).toBe("hybrid");
    expect(ovOk.embeddings.model).toBe("text-embedding-3-small");

    const noSvc = makeService(false);
    const ovNo: any = await noSvc.service.getOverview(ORG_A);
    expect(ovNo.embeddings.available).toBe(false);
    expect(ovNo.embeddings.retrievalMode).toBe("keyword");
    expect(ovNo.embeddings.reason).toBe("provider_has_no_embeddings_api");
  });
});

describe("SA-B6 BrainAdminService — answer store management", () => {
  it("list is org-scoped, searchable and returns the preview shape", async () => {
    const { service } = makeService(true);
    const all: any = await service.listStoredAnswers(ORG_A, {});
    expect(all.total).toBe(3);
    expect(all.items.map((i: any) => i.id)).not.toContain("ans-b");
    expect(all.items[0]).toHaveProperty("answerPreview");
    expect(all.items[0]).toHaveProperty("invalidReason");
    const found: any = await service.listStoredAnswers(ORG_A, { search: "ডেলিভারি" });
    expect(found.total).toBe(1);
    expect(found.items[0].id).toBe("ans-1");
    const inv: any = await service.listStoredAnswers(ORG_A, { status: "invalidated" });
    expect(inv.total).toBe(1);
    expect(inv.items[0].invalidReason).toBe("product_changed");
  });

  it("disable -> enable round-trip works and both transitions are audited", async () => {
    const { service, audit } = makeService(true);
    const disabled: any = await service.setStoredAnswerStatus(ORG_A, "user-1", "ans-1", "disabled");
    expect(disabled.status).toBe("disabled");
    const enabled: any = await service.setStoredAnswerStatus(ORG_A, "user-1", "ans-1", "active");
    expect(enabled.status).toBe("active");
    const actions = (audit.log as jest.Mock).mock.calls.map((c: any[]) => c[0].action);
    expect(actions).toEqual(["answer_store.disable", "answer_store.enable"]);
  });

  it("re-activating an INVALIDATED entry is a 400 carrying the recorded reason; the row is untouched", async () => {
    const { service, fx } = makeService(true);
    await expect(service.setStoredAnswerStatus(ORG_A, "user-1", "ans-2", "active")).rejects.toMatchObject({
      status: 400,
      response: { message: expect.stringContaining("product_changed") },
    });
    expect(fx.aiStoredAnswer.find((r: any) => r.id === "ans-2")!.status).toBe("invalidated");
    await expect(service.setStoredAnswerStatus(ORG_A, "user-1", "ans-2", "disabled")).rejects.toBeTruthy();
    await expect(service.setStoredAnswerStatus(ORG_A, "user-1", "ans-1", "invalidated")).rejects.toBeTruthy();
  });

  it("another org's answer id is a 404 on status change and delete; delete works for the owner org and is audited", async () => {
    const { service, audit, fx } = makeService(true);
    await expect(service.setStoredAnswerStatus(ORG_A, "user-1", "ans-b", "disabled")).rejects.toMatchObject({ status: 404 });
    await expect(service.deleteStoredAnswer(ORG_A, "user-1", "ans-b")).rejects.toMatchObject({ status: 404 });
    const out: any = await service.deleteStoredAnswer(ORG_A, "user-1", "ans-3");
    expect(out.deleted).toBe(true);
    expect(fx.aiStoredAnswer.some((r: any) => r.id === "ans-3")).toBe(false);
    expect((audit.log as jest.Mock).mock.calls.at(-1)?.[0].action).toBe("answer_store.delete");
  });
});

describe("SA-B6 BrainAdminService — customer memories", () => {
  it("list is org-scoped, latest interaction first", async () => {
    const { service } = makeService(true);
    const res: any = await service.listCustomerMemories(ORG_A, {});
    expect(res.total).toBe(2);
    expect(res.items.map((i: any) => i.id)).toEqual(["mem-1", "mem-2"]);
    expect(res.items[0]).toMatchObject({ customerKey: "whatsapp:111", displayName: "Rahim", orderCount: 2 });
  });

  it("forget deletes exactly that org's row, is audited, and another org's id is a 404", async () => {
    const { service, audit, fx } = makeService(true);
    await expect(service.deleteCustomerMemory(ORG_A, "user-1", "mem-b")).rejects.toMatchObject({ status: 404 });
    const out: any = await service.deleteCustomerMemory(ORG_A, "user-1", "mem-1");
    expect(out.deleted).toBe(true);
    expect(fx.customerMemory.some((r: any) => r.id === "mem-1")).toBe(false);
    expect(fx.customerMemory.some((r: any) => r.id === "mem-b")).toBe(true);
    expect((audit.log as jest.Mock).mock.calls.at(-1)?.[0]).toMatchObject({ action: "customer_memory.forget", entityType: "CustomerMemory" });
  });
});

describe("SA-B6 BrainAdminController — role discipline (metadata)", () => {
  const rolesOf = (fn: any) => Reflect.getMetadata(ROLES_KEY, fn) as string[] | undefined;
  it("reads carry no @Roles restriction (any org member)", () => {
    expect(rolesOf(BrainAdminController.prototype.overview)).toBeUndefined();
    expect(rolesOf(BrainAdminController.prototype.listAnswers)).toBeUndefined();
    expect(rolesOf(BrainAdminController.prototype.listMemories)).toBeUndefined();
  });
  it("status writes are OWNER/ADMIN/MARKETING_MANAGER; deletes are OWNER/ADMIN only", () => {
    expect(rolesOf(BrainAdminController.prototype.setAnswerStatus)).toEqual(["OWNER", "ADMIN", "MARKETING_MANAGER"]);
    expect(rolesOf(BrainAdminController.prototype.deleteAnswer)).toEqual(["OWNER", "ADMIN"]);
    expect(rolesOf(BrainAdminController.prototype.forgetMemory)).toEqual(["OWNER", "ADMIN"]);
  });
});
