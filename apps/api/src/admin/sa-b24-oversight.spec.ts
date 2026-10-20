import "reflect-metadata";
import { SuperAdminGuard, ADMIN_TIER_KEY } from "../common/super-admin.guard";
import { AdminAiController } from "./admin-ai.controller";
import { AdminOversightService } from "./admin-oversight.service";
import { AuditService } from "../audit/audit.service";
import { ActionEngineService } from "../ai/actions/action-engine.service";
import { AnswerStoreService, normalizeQuestion } from "../ai/answer-store.service";
import { ConversationMiningService } from "../ai/conversation-mining.service";
import { EmbeddingsService } from "../ai/embeddings.service";
import { LlmFactory } from "../ai/llm/llm.factory";
import { AiPausedError } from "../ai/llm/llm-guard";
import { aiPauseReason, isAiDisabledForOrg, killSwitches } from "../common/platform-settings";

/**
 * SA-B24 (Smart AI Phase 6, plan T3: AI Oversight) — guarantees:
 *  - The board's aggregates EQUAL the fixture rows: proposals
 *    by status/action, executed/failed in window with the
 *    failure `error` strings verbatim, legacy M47 rows counted
 *    separately, usage by feature/org reconciling to the
 *    AIUsageRecord fixtures, stored-answer fields honestly
 *    named, learned pending by source, orgs active vs silent,
 *    and a drill whose rows carry ONLY their own org's counts.
 *    An empty platform is zeros; a bad window is a 400.
 *  - The surface is SUPER-only (tenant OWNER refused, SUPPORT
 *    refused, SUPER admitted — the SA-B22/B23 guard pattern).
 *  - Every kill-switch flip demands a non-empty reason BEFORE
 *    anything happens (400, zero writes, zero audit); a valid
 *    flip preserves the killSwitches row's sibling fields,
 *    stamps flip provenance, and writes its audit row with
 *    the reason verbatim — in BOTH directions.
 *  - Enforcement: while paused, an LLM completion through
 *    LlmFactory refuses with the typed AiPausedError and the
 *    inner provider is never reached; the Action Engine still
 *    FILES and APPROVES proposals but executes nothing (the
 *    row stays approved, never failed); conversation mining
 *    skips with the recorded reason `ai_globally_paused`;
 *    embeddings resolve to the same reason; the deterministic
 *    stored-answer serve keeps answering; lifting the pause
 *    restores execution.
 */

// ---------------- in-memory prisma stub ----------------
// (B23's makeTable shape, extended with the operators and
// select projections this batch's queries use.)

function matchesWhere(row: any, where: any = {}): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("gte" in (v as any)) return row[k] != null && new Date(row[k]).getTime() >= new Date((v as any).gte).getTime();
      if ("lte" in (v as any)) return row[k] != null && new Date(row[k]).getTime() <= new Date((v as any).lte).getTime();
      if ("not" in (v as any)) return row[k] !== (v as any).not;
      if ("in" in (v as any)) return ((v as any).in as any[]).includes(row[k]);
      if ("contains" in (v as any)) return String(row[k] ?? "").toLowerCase().includes(String((v as any).contains).toLowerCase());
      return false;
    }
    return row[k] === v;
  });
}

function project(row: any, select: any) {
  if (!select) return row;
  const out: any = {};
  for (const [k, on] of Object.entries(select)) if (on) out[k] = row[k];
  return out;
}

function makeTable(initial: any[] = []) {
  const rows: any[] = [...initial];
  let seq = 0;
  const applyData = (row: any, data: any) => {
    for (const [k, v] of Object.entries(data ?? {})) {
      if (v && typeof v === "object" && "increment" in (v as any)) row[k] = (row[k] ?? 0) + (v as any).increment;
      else row[k] = v;
    }
    if ("updatedAt" in row) row.updatedAt = new Date();
  };
  const table: any = {
    rows,
    count: async ({ where }: any = {}) => rows.filter((r) => matchesWhere(r, where)).length,
    findMany: async ({ where, orderBy, take, select }: any = {}) => {
      let out = rows.filter((r) => matchesWhere(r, where));
      if (orderBy) {
        const [field, dir] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy)[0] as any;
        out = [...out].sort((a, b) => {
          const cmp = a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0;
          return dir === "desc" ? -cmp : cmp;
        });
      }
      if (take) out = out.slice(0, take);
      return out.map((r) => project(r, select));
    },
    findFirst: async ({ where, orderBy, select }: any = {}) => {
      const out = await table.findMany({ where, orderBy, select });
      return out[0] ?? null;
    },
    findUnique: async ({ where, select }: any = {}) => {
      const row = rows.find((r) => matchesWhere(r, where));
      return row ? project(row, select) : null;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `gen-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchesWhere(r, where));
      if (!row) throw new Error("record not found");
      applyData(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const hits = rows.filter((r) => matchesWhere(r, where));
      hits.forEach((r) => applyData(r, data));
      return { count: hits.length };
    },
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => matchesWhere(r, where));
      if (row) { applyData(row, update); return row; }
      return table.create({ data: create });
    },
  };
  return table;
}

const ORG_A = "org-a";
const ORG_B = "org-b";
const ADMIN = { id: "super-1" };
const NOW = new Date("2026-10-17T06:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function basePrisma(extra: Record<string, any> = {}) {
  return {
    systemSetting: makeTable([]),
    auditLog: makeTable([]),
    organization: makeTable([
      { id: ORG_A, name: "Alpha Shop", slug: "alpha" },
      { id: ORG_B, name: "Beta Shop", slug: "beta" },
      { id: "org-c", name: "Quiet Shop", slug: "quiet" },
    ]),
    aIActionProposal: makeTable([]),
    aIUsageRecord: makeTable([]),
    aiStoredAnswer: makeTable([]),
    learnedItem: makeTable([]),
    aiAutonomySetting: makeTable([]),
    aIAction: makeTable([]),
    businessProfile: makeTable([]),
    orgLlmConfig: makeTable([]),
    ...extra,
  } as any;
}

function seedKillSwitches(prisma: any, value: any) {
  prisma.systemSetting.rows.push({ key: "killSwitches", value, updatedById: "admin-0", updatedAt: hoursAgo(72) });
}

const auditRows = (prisma: any, action?: string) =>
  (prisma.auditLog.rows as any[]).filter((r) => !action || r.action === action);

// ---------------- authorisation ----------------

describe("SA-B24 authorisation (SUPER only)", () => {
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

  it("a tenant OWNER is refused on the oversight routes", async () => {
    const guard = new SuperAdminGuard(guardPrisma(), { getAllAndOverride: () => ["SUPER"] } as any);
    await expect(
      guard.canActivate(ctxFor({ user: { userId: "tenant-owner", tv: 0 }, headers: {}, method: "GET", url: "/admin/ai/oversight" })),
    ).rejects.toMatchObject({ code: "common.platformAdminRequired" });
  });

  it("a SUPPORT admin is refused on the SUPER tier", async () => {
    const guard = new SuperAdminGuard(guardPrisma(), { getAllAndOverride: () => ["SUPER"] } as any);
    await expect(
      guard.canActivate(ctxFor({ user: { userId: "support-1", tv: 0 }, headers: {}, method: "PUT", url: "/admin/ai/kill-switch/global" })),
    ).rejects.toThrow(/SUPER/);
  });

  it("a SUPER admin is admitted", async () => {
    const guard = new SuperAdminGuard(guardPrisma(), { getAllAndOverride: () => ["SUPER"] } as any);
    const req: any = { user: { userId: "super-1", tv: 0 }, headers: {}, method: "GET", url: "/admin/ai/oversight" };
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.adminUser.id).toBe("super-1");
  });
});

// ---------------- the board ----------------

describe("SA-B24 oversight board aggregates", () => {
  function boardPrisma() {
    const prisma = basePrisma();
    prisma.aIActionProposal.rows.push(
      // filed in window (7d), org A
      { id: "p1", organizationId: ORG_A, actionId: "close_conversation", status: "executed", type: "close_conversation", title: "t", preview: "p", payload: {}, createdAt: hoursAgo(5), updatedAt: hoursAgo(4), executedAt: hoursAgo(4), error: null },
      { id: "p2", organizationId: ORG_A, actionId: "close_conversation", status: "failed", type: "close_conversation", title: "t", preview: "p", payload: {}, createdAt: hoursAgo(6), updatedAt: hoursAgo(3), executedAt: null, error: "verification_mismatch" },
      { id: "p3", organizationId: ORG_A, actionId: "pause_campaign", status: "failed", type: "pause_campaign", title: "t", preview: "p", payload: {}, createdAt: hoursAgo(7), updatedAt: hoursAgo(2), executedAt: null, error: "Meta API error: (#200) Requires pages_messaging permission" },
      { id: "p4", organizationId: ORG_A, actionId: "pause_campaign", status: "proposed", type: "pause_campaign", title: "t", preview: "p", payload: {}, createdAt: hoursAgo(8), updatedAt: hoursAgo(8), executedAt: null, error: null },
      // org B
      { id: "p5", organizationId: ORG_B, actionId: "hide_comment", status: "executed", type: "hide_comment", title: "t", preview: "p", payload: {}, createdAt: hoursAgo(9), updatedAt: hoursAgo(9), executedAt: hoursAgo(9), error: null },
      { id: "p6", organizationId: ORG_B, actionId: "hide_comment", status: "rejected", type: "hide_comment", title: "t", preview: "p", payload: {}, createdAt: hoursAgo(10), updatedAt: hoursAgo(10), executedAt: null, error: null },
      // filed OUTSIDE the 7d window but executed INSIDE it
      { id: "p7", organizationId: ORG_B, actionId: "close_conversation", status: "executed", type: "close_conversation", title: "t", preview: "p", payload: {}, createdAt: daysAgo(12), updatedAt: hoursAgo(1), executedAt: hoursAgo(1), error: null },
      // legacy M47 row (no actionId) filed in window
      { id: "p8", organizationId: ORG_A, actionId: null, status: "proposed", type: "pause_campaign", title: "t", preview: "p", payload: {}, createdAt: hoursAgo(4), updatedAt: hoursAgo(4), executedAt: null, error: null },
    );
    prisma.aIUsageRecord.rows.push(
      { id: "u1", organizationId: ORG_A, feature: "copilot", provider: "openai", model: "m", inputTokens: 100, outputTokens: 50, estimated: false, createdAt: hoursAgo(2) },
      { id: "u2", organizationId: ORG_A, feature: "copilot", provider: "openai", model: "m", inputTokens: 200, outputTokens: 80, estimated: true, createdAt: hoursAgo(3) },
      { id: "u3", organizationId: ORG_A, feature: "chat", provider: "dev", model: null, inputTokens: 10, outputTokens: 5, estimated: true, createdAt: hoursAgo(4) },
      { id: "u4", organizationId: ORG_B, feature: "chat", provider: "openai", model: "m", inputTokens: 1000, outputTokens: 500, estimated: false, createdAt: hoursAgo(5) },
      // 10 days old: inside 30d, outside 7d
      { id: "u5", organizationId: ORG_B, feature: "report", provider: "openai", model: "m", inputTokens: 7, outputTokens: 3, estimated: false, createdAt: daysAgo(10) },
    );
    prisma.aiStoredAnswer.rows.push(
      { id: "a1", organizationId: ORG_A, status: "active", hitCount: 12, lastHitAt: hoursAgo(2), createdAt: daysAgo(20), updatedAt: hoursAgo(2), groundedAt: daysAgo(20) },
      { id: "a2", organizationId: ORG_A, status: "active", hitCount: 3, lastHitAt: daysAgo(15), createdAt: daysAgo(30), updatedAt: daysAgo(15), groundedAt: daysAgo(30) },
      { id: "a3", organizationId: ORG_B, status: "invalidated", hitCount: 5, lastHitAt: daysAgo(8), createdAt: daysAgo(9), updatedAt: hoursAgo(6), groundedAt: daysAgo(9), invalidReason: "product_changed" },
      { id: "a4", organizationId: ORG_B, status: "disabled", hitCount: 0, lastHitAt: null, createdAt: daysAgo(3), updatedAt: daysAgo(3), groundedAt: daysAgo(3) },
    );
    prisma.learnedItem.rows.push(
      { id: "l1", organizationId: ORG_A, status: "suggested", sourceType: "conversation", kind: "faq_pair", createdAt: hoursAgo(3), updatedAt: hoursAgo(3), reviewedAt: null, reviewedVia: null },
      { id: "l2", organizationId: ORG_A, status: "suggested", sourceType: "ads", kind: "fact", createdAt: hoursAgo(4), updatedAt: hoursAgo(4), reviewedAt: null, reviewedVia: null },
      { id: "l3", organizationId: ORG_B, status: "suggested", sourceType: "conversation", kind: "fact", createdAt: hoursAgo(5), updatedAt: hoursAgo(5), reviewedAt: null, reviewedVia: null },
      { id: "l4", organizationId: ORG_A, status: "approved", sourceType: "website", kind: "fact", createdAt: daysAgo(3), updatedAt: hoursAgo(6), reviewedAt: hoursAgo(6), reviewedVia: "admin_console" },
      { id: "l5", organizationId: ORG_B, status: "rejected", sourceType: "performance", kind: "fact", createdAt: daysAgo(2), updatedAt: hoursAgo(7), reviewedAt: hoursAgo(7), reviewedVia: "org" },
      // decided outside the window
      { id: "l6", organizationId: ORG_B, status: "approved", sourceType: "website", kind: "fact", createdAt: daysAgo(20), updatedAt: daysAgo(12), reviewedAt: daysAgo(12), reviewedVia: "org" },
    );
    seedKillSwitches(prisma, { aiDisabledOrgIds: [ORG_B], broadcastsPaused: true });
    return prisma;
  }

  it("aggregates equal the fixture rows (7d window)", async () => {
    const svc = new AdminOversightService(boardPrisma(), new AuditService(boardPrisma() as any) as any);
    const board = await svc.board(7);

    expect(board.windowDays).toBe(7);
    // proposals: 6 engine rows filed in window (p7 filed 12d ago, p8 legacy)
    expect(board.proposals.filedInWindow).toBe(6);
    expect(board.proposals.byStatus).toEqual({ executed: 2, failed: 2, proposed: 1, rejected: 1 });
    expect(board.proposals.byAction.close_conversation).toEqual({ filed: 2, executed: 1, failed: 1, pending: 0 });
    expect(board.proposals.byAction.pause_campaign).toEqual({ filed: 2, executed: 0, failed: 1, pending: 1 });
    expect(board.proposals.byAction.hide_comment).toEqual({ filed: 2, executed: 1, failed: 0, pending: 0 });
    // executed in window includes p7 (filed outside, executed inside)
    expect(board.proposals.executedInWindow).toBe(3);
    expect(board.proposals.failedInWindow).toBe(2);
    expect(board.proposals.failureReasons).toEqual([
      { reason: "Meta API error: (#200) Requires pages_messaging permission", count: 1 },
      { reason: "verification_mismatch", count: 1 },
    ]);
    expect(board.proposals.pendingNow).toBe(1);
    expect(board.proposals.legacyFiledInWindow).toBe(1);

    // usage: u1..u4 in window
    expect(board.usage.totals).toEqual({ calls: 4, inputTokens: 1310, outputTokens: 635, totalTokens: 1945, estimatedCalls: 2 });
    expect(board.usage.byFeature.map((f: any) => f.feature)).toEqual(["chat", "copilot"]);
    expect(board.usage.byFeature[1]).toEqual({ feature: "copilot", calls: 2, inputTokens: 300, outputTokens: 130, totalTokens: 430, estimatedCalls: 1 });
    expect(board.usage.topOrgsByUsage[0]).toEqual({ organizationId: ORG_B, calls: 1, totalTokens: 1500 });
    expect(board.usage.activeOrgs).toBe(2);

    // answers
    expect(board.answers).toEqual({
      active: 2, invalidated: 1, disabled: 1,
      totalHitsAllTime: 20, distinctAnswersHitInWindow: 1, invalidatedInWindow: 1,
    });

    // learning
    expect(board.learning.pendingNow).toBe(3);
    expect(board.learning.pendingBySource).toEqual({ conversation: 2, ads: 1 });
    expect(board.learning.orgsWithPending).toBe(2);
    expect(board.learning.decidedInWindow).toEqual({ approved: 1, rejected: 1, viaAdminConsole: 1 });

    // orgs: org-c is silent (no usage rows)
    expect(board.orgs).toEqual({ total: 3, activeInWindow: 2, silentInWindow: 1, withPendingProposals: 1, withPendingLearning: 2 });

    // drill: org A first (2 failures), org B second (usage) — and
    // each row carries ONLY its own org's counts.
    expect(board.drill).toHaveLength(2);
    expect(board.drill[0]).toEqual({ organizationId: ORG_A, name: "Alpha Shop", slug: "alpha", failedExecutions: 2, usageCalls: 3, usageTokens: 445, pendingProposals: 1 });
    expect(board.drill[1]).toEqual({ organizationId: ORG_B, name: "Beta Shop", slug: "beta", failedExecutions: 0, usageCalls: 1, usageTokens: 1500, pendingProposals: 0 });

    // kill-switch block reflects the seeded row
    expect(board.killSwitch).toEqual({
      globallyPaused: false, globalPause: null, broadcastsPaused: true,
      disabledOrgIds: [ORG_B], orgPauseMeta: {},
    });
  });

  it("the 30d window widens the usage lens but not the filed-proposals count semantics", async () => {
    const prisma = boardPrisma();
    const svc = new AdminOversightService(prisma, new AuditService(prisma as any) as any);
    const board = await svc.board("30");
    expect(board.usage.totals.calls).toBe(5);
    expect(board.usage.totals.totalTokens).toBe(1955);
    // p7 was filed 12d ago: inside the 30d filed lens now
    expect(board.proposals.filedInWindow).toBe(7);
    expect(board.proposals.byStatus.executed).toBe(3);
  });

  it("an empty platform is zeros, never an error", async () => {
    const prisma = basePrisma({ organization: makeTable([]) });
    const svc = new AdminOversightService(prisma, new AuditService(prisma as any) as any);
    const board = await svc.board(undefined);
    expect(board.proposals.filedInWindow).toBe(0);
    expect(board.proposals.failureReasons).toEqual([]);
    expect(board.usage.totals).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCalls: 0 });
    expect(board.answers.totalHitsAllTime).toBe(0);
    expect(board.learning.pendingNow).toBe(0);
    expect(board.orgs).toEqual({ total: 0, activeInWindow: 0, silentInWindow: 0, withPendingProposals: 0, withPendingLearning: 0 });
    expect(board.drill).toEqual([]);
  });

  it("a window other than 7/30 is a 400", async () => {
    const prisma = basePrisma();
    const svc = new AdminOversightService(prisma, new AuditService(prisma as any) as any);
    await expect(svc.board(14)).rejects.toMatchObject({ status: 400 });
  });
});

// ---------------- kill-switch flips ----------------

describe("SA-B24 kill-switch flips", () => {
  function flipPrisma() {
    const prisma = basePrisma();
    seedKillSwitches(prisma, { aiDisabledOrgIds: [ORG_B], broadcastsPaused: true });
    const audit = new AuditService(prisma as any);
    const svc = new AdminOversightService(prisma, audit as any);
    return { prisma, svc };
  }
  const storedValue = (prisma: any) => prisma.systemSetting.rows.find((r: any) => r.key === "killSwitches")?.value;

  it("an empty reason refuses the global flip BEFORE anything happens", async () => {
    const { prisma, svc } = flipPrisma();
    await expect(svc.setGlobalPause(ADMIN, true, "   ")).rejects.toMatchObject({ status: 400 });
    expect(storedValue(prisma)).toEqual({ aiDisabledOrgIds: [ORG_B], broadcastsPaused: true });
    expect(auditRows(prisma)).toHaveLength(0);
  });

  it("a non-boolean paused is a 400 with no write and no audit", async () => {
    const { prisma, svc } = flipPrisma();
    await expect(svc.setGlobalPause(ADMIN, "yes" as any, "reason")).rejects.toMatchObject({ status: 400 });
    expect(auditRows(prisma)).toHaveLength(0);
  });

  it("global pause: sibling fields preserved, provenance stamped, audit carries the reason verbatim", async () => {
    const { prisma, svc } = flipPrisma();
    const state = await svc.setGlobalPause(ADMIN, true, "LLM provider outage — pausing all AI", "10.0.0.9");
    expect(state.globallyPaused).toBe(true);
    expect(state.globalPause).toMatchObject({ paused: true, reason: "LLM provider outage — pausing all AI", byId: "super-1" });
    expect(state.broadcastsPaused).toBe(true);
    expect(state.disabledOrgs.map((o: any) => o.organizationId)).toEqual([ORG_B]);
    const stored = storedValue(prisma);
    expect(stored.aiGloballyPaused).toBe(true);
    expect(stored.aiDisabledOrgIds).toEqual([ORG_B]);
    expect(stored.broadcastsPaused).toBe(true);
    const rows = auditRows(prisma, "admin.ai_kill_switch_global_pause");
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("super-1");
    expect(rows[0].organizationId).toBeNull();
    expect(rows[0].metadata).toMatchObject({ reason: "LLM provider outage — pausing all AI", paused: true });
    expect(rows[0].ipAddress).toBe("10.0.0.9");
  });

  it("resume also requires a reason and is audited as a resume", async () => {
    const { prisma, svc } = flipPrisma();
    await svc.setGlobalPause(ADMIN, true, "incident start");
    await expect(svc.setGlobalPause(ADMIN, false, "")).rejects.toMatchObject({ status: 400 });
    const state = await svc.setGlobalPause(ADMIN, false, "provider recovered");
    expect(state.globallyPaused).toBe(false);
    expect(state.globalPause).toMatchObject({ paused: false, reason: "provider recovered" });
    const rows = auditRows(prisma, "admin.ai_kill_switch_global_resume");
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ reason: "provider recovered", paused: false });
  });

  it("org disable/enable: org-scoped audit, provenance for both flips, other orgs untouched", async () => {
    const { prisma, svc } = flipPrisma();
    let state = await svc.setOrgDisabled(ADMIN, ORG_A, true, "abuse investigation", "10.0.0.2");
    expect(state.disabledOrgs.map((o: any) => o.organizationId).sort()).toEqual([ORG_A, ORG_B]);
    const aRow = state.disabledOrgs.find((o: any) => o.organizationId === ORG_A);
    expect(aRow).toMatchObject({ name: "Alpha Shop", reason: "abuse investigation", byId: "super-1" });
    // org B was disabled pre-B24 (no T3 provenance): listed, with nulls — never invented metadata.
    const bRow = state.disabledOrgs.find((o: any) => o.organizationId === ORG_B);
    expect(bRow).toMatchObject({ name: "Beta Shop", reason: null, byId: null, at: null });
    let rows = auditRows(prisma, "admin.ai_kill_switch_org_disable");
    expect(rows).toHaveLength(1);
    expect(rows[0].organizationId).toBe(ORG_A);
    expect(rows[0].metadata).toMatchObject({ reason: "abuse investigation", disabled: true });

    state = await svc.setOrgDisabled(ADMIN, ORG_A, false, "investigation closed");
    expect(state.disabledOrgs.map((o: any) => o.organizationId)).toEqual([ORG_B]);
    rows = auditRows(prisma, "admin.ai_kill_switch_org_enable");
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ reason: "investigation closed", disabled: false });
    // the enable flip's provenance is retained in the stored meta map
    expect(storedValue(prisma).aiOrgPauseMeta[ORG_A]).toMatchObject({ disabled: false, reason: "investigation closed" });
  });

  it("org flip: empty reason = 400 before the org read; unknown org = 404 with no write/audit", async () => {
    const { prisma, svc } = flipPrisma();
    await expect(svc.setOrgDisabled(ADMIN, ORG_A, true, " ")).rejects.toMatchObject({ status: 400 });
    await expect(svc.setOrgDisabled(ADMIN, "org-nope", true, "reason")).rejects.toMatchObject({ status: 404 });
    expect(storedValue(prisma)).toEqual({ aiDisabledOrgIds: [ORG_B], broadcastsPaused: true });
    expect(auditRows(prisma)).toHaveLength(0);
  });
});

// ---------------- enforcement ----------------

describe("SA-B24 kill-switch enforcement", () => {
  it("the read path: killSwitches parses the extended row; the predicates rank global over org", async () => {
    const prisma = basePrisma();
    seedKillSwitches(prisma, {
      aiDisabledOrgIds: [ORG_B], broadcastsPaused: false, aiGloballyPaused: true,
      aiGlobalPause: { paused: true, reason: "r", byId: "super-1", at: "2026-10-17T00:00:00.000Z" },
      aiOrgPauseMeta: { [ORG_B]: { disabled: true, reason: "org reason", byId: "super-1", at: "2026-10-16T00:00:00.000Z" } },
    });
    const ks = await killSwitches(prisma as any);
    expect(ks.aiGloballyPaused).toBe(true);
    expect(ks.aiGlobalPause).toEqual({ paused: true, reason: "r", byId: "super-1", at: "2026-10-17T00:00:00.000Z" });
    expect(ks.aiOrgPauseMeta[ORG_B]).toEqual({ disabled: true, reason: "org reason", byId: "super-1", at: "2026-10-16T00:00:00.000Z" });
    expect(isAiDisabledForOrg(ks, ORG_A)).toBe(true); // global covers everyone
    expect(aiPauseReason(ks, ORG_B)).toBe("ai_globally_paused"); // global outranks org
    const orgOnly = { ...ks, aiGloballyPaused: false };
    expect(isAiDisabledForOrg(orgOnly, ORG_A)).toBe(false);
    expect(aiPauseReason(orgOnly, ORG_B)).toBe("ai_disabled_for_org");
    // partial fallback objects (older call sites' .catch shapes) never pause
    expect(isAiDisabledForOrg({ aiDisabledOrgIds: [] } as any, ORG_A)).toBe(false);
    expect(aiPauseReason(null, ORG_A)).toBeNull();
  });

  it("LlmFactory: while globally paused, complete() refuses typed and the inner provider is never reached; lifting restores", async () => {
    const prisma = basePrisma();
    seedKillSwitches(prisma, { aiDisabledOrgIds: [], broadcastsPaused: false, aiGloballyPaused: true });
    const factory = new LlmFactory(prisma as any);
    const provider = factory.getProvider();
    // The unwrapped dev provider RESOLVES every call — a rejection
    // here can only come from the guard, i.e. the provider was
    // never invoked.
    const err = await provider.complete([{ role: "user", content: "hi" }]).catch((e) => e);
    expect(err).toBeInstanceOf(AiPausedError);
    expect(err.code).toBe("AI_PAUSED");
    expect(err.status).toBe(403);
    expect(err.scope).toBe("global");
    // identity surface delegates through the wrap
    expect(provider.name).toBe(factory.getProvider().name);

    // lift the pause: the very next call resolves again
    prisma.systemSetting.rows[0].value = { aiDisabledOrgIds: [], broadcastsPaused: false, aiGloballyPaused: false };
    const ok = await provider.complete([{ role: "user", content: "hi" }]);
    expect(typeof ok.text).toBe("string");
  });

  it("LlmFactory.forOrg: a per-org disable refuses that org (scope org) and not another", async () => {
    const prisma = basePrisma();
    seedKillSwitches(prisma, { aiDisabledOrgIds: [ORG_B], broadcastsPaused: false });
    const factory = new LlmFactory(prisma as any);
    const providerB = await factory.forOrg(ORG_B);
    const err = await providerB.complete([{ role: "user", content: "hi" }]).catch((e) => e);
    expect(err).toBeInstanceOf(AiPausedError);
    expect(err.scope).toBe("org");
    const providerA = await factory.forOrg(ORG_A);
    const ok = await providerA.complete([{ role: "user", content: "hi" }]);
    expect(typeof ok.text).toBe("string");
  });

  function engineHarness() {
    const prisma = basePrisma();
    const audit = new AuditService(prisma as any);
    const executor = jest.fn(async () => ({ closed: true }));
    const executors = {
      builders: new Map([
        ["close_conversation", async () => ({ title: "Close conversation", preview: "Close conversation conv-1", payload: { conversationId: "conv-1" } })],
      ]),
      executors: new Map([["inbox.close_conversation", executor]]),
      verifiers: new Map([["inbox.close_conversation.verify", async () => ({ verified: true, detail: { status: "closed" } })]]),
    } as any;
    const engine = new ActionEngineService(prisma as any, audit as any, executors);
    return { prisma, engine, executor };
  }

  it("engine: while paused, proposals still FILE and APPROVE but nothing executes; the row is never failed; lifting restores execution", async () => {
    const { prisma, engine, executor } = engineHarness();
    seedKillSwitches(prisma, { aiDisabledOrgIds: [], broadcastsPaused: false, aiGloballyPaused: true });

    const proposed = await engine.propose(ORG_A, "close_conversation", { conversationId: "conv-1" }, { proposedBy: "ai" });
    expect(proposed.ok).toBe(true);
    const proposalId = (proposed as any).proposal.id;

    const approved = await engine.approve(ORG_A, "staff-1", proposalId);
    expect(approved.status).toBe("approved");
    expect(executor).not.toHaveBeenCalled();

    const refused = await engine.execute(ORG_A, "staff-1", proposalId);
    expect(refused).toMatchObject({ ok: false, reason: "ai_paused" });
    const rowAfter = prisma.aIActionProposal.rows.find((r: any) => r.id === proposalId);
    expect(rowAfter.status).toBe("approved");
    expect(executor).not.toHaveBeenCalled();

    // lift: execution proceeds through the real claim → executor → verifier path
    prisma.systemSetting.rows[0].value = { aiDisabledOrgIds: [], broadcastsPaused: false, aiGloballyPaused: false };
    const done = await engine.execute(ORG_A, "staff-1", proposalId);
    expect(done.ok).toBe(true);
    expect((done as any).proposal.status).toBe("executed");
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("mining sweep: while paused the org is skipped with the recorded reason and zero LLM calls", async () => {
    const prisma = basePrisma();
    prisma.businessProfile.rows.push({ id: "bp-a", organizationId: ORG_A, conversationLearningEnabled: true, websiteLearningEnabled: false, websiteUrl: null, answerStoreEnabled: true });
    seedKillSwitches(prisma, { aiDisabledOrgIds: [], broadcastsPaused: false, aiGloballyPaused: true });
    const mining = new ConversationMiningService(prisma as any);
    const out = await mining.mineOrg(ORG_A);
    expect(out).toMatchObject({ status: "skipped", reason: "ai_globally_paused", llmCalls: 0 });

    prisma.systemSetting.rows[0].value = { aiDisabledOrgIds: [ORG_A], broadcastsPaused: false };
    const out2 = await mining.mineOrg(ORG_A);
    expect(out2).toMatchObject({ status: "skipped", reason: "ai_disabled_for_org", llmCalls: 0 });
  });

  it("embeddings resolution: while paused it returns the recorded reason instead of a config", async () => {
    const prisma = basePrisma();
    seedKillSwitches(prisma, { aiDisabledOrgIds: [], broadcastsPaused: false, aiGloballyPaused: true });
    const embeddings = new EmbeddingsService(prisma as any);
    await expect(embeddings.resolveConfig(ORG_A)).resolves.toEqual({ ok: false, reason: "ai_globally_paused" });
  });

  it("deterministic serve: the Answer Store still answers while the global pause is on", async () => {
    const prisma = basePrisma();
    prisma.businessProfile.rows.push({ id: "bp-a", organizationId: ORG_A, answerStoreEnabled: true });
    prisma.aiStoredAnswer.rows.push({
      id: "ans-1", organizationId: ORG_A, normalizedQuestion: normalizeQuestion("ডেলিভারি চার্জ কত?"),
      questionText: "ডেলিভারি চার্জ কত?", answerText: "ঢাকার ভিতরে ৬০ টাকা।", channel: "inbox", language: "bn",
      sourceRefs: { docIds: [], products: [], policyIds: [], profileAreas: [] }, containsLiveFacts: false,
      status: "active", invalidReason: null, origin: "staff_approved", hitCount: 0, lastHitAt: null,
      groundedAt: hoursAgo(1), provider: null, model: null, dimension: null,
      createdAt: hoursAgo(2), updatedAt: hoursAgo(2),
    });
    seedKillSwitches(prisma, { aiDisabledOrgIds: [], broadcastsPaused: false, aiGloballyPaused: true });
    const store = new AnswerStoreService(prisma as any, undefined);
    const hit = await store.lookup(ORG_A, "ডেলিভারি চার্জ কত?", { channel: "inbox" });
    expect(hit.hit).toBe(true);
    expect((hit as any).answer).toContain("৬০");
  });
});
