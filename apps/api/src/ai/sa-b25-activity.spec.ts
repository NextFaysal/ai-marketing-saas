import "reflect-metadata";
import { ROLES_KEY } from "../common/decorators";
import { AiActivityController } from "./ai-activity.controller";
import { AiActivityService } from "./ai-activity.service";

/**
 * SA-B25 (Smart AI Phase 6, plan T4: AI Activity API) — guarantees:
 *  - The feed is assembled ONLY from real rows + real stamps
 *    across all four kinds (proposal / learned / answer /
 *    content), merged newest-first with the exact per-source
 *    event counts as the total; a failed proposal's `error`
 *    and an invalidated answer's `invalidReason` arrive
 *    VERBATIM as the event detail.
 *  - Proposal lifecycles read honestly: a proposal_only
 *    approval files + decides with meta.proposalOnly === true
 *    and NO executed event; a rejection decides as rejected
 *    only; an executed proposal carries all three events.
 *  - LearnedItem.reviewedVia is carried exactly as stamped —
 *    "admin_console", "org", and null for a pre-SA-B23 row
 *    (null is pinned, never invented).
 *  - kind filtering and the days window are exact; a bad
 *    days or kind is a 400 from the SERVICE (validation lives
 *    there, not only in the controller).
 *  - Pagination slices are disjoint, correctly ordered, and
 *    `total` is the FULL event count, not the page size.
 *  - Org isolation: neither org's feed or usage contains the
 *    other org's sourceIds, sentinel titles or usage.
 *  - Usage reconciles EXACTLY with the AIUsageRecord fixtures
 *    (totals / features / daily hand-computed); estimatedCalls
 *    counts only estimated rows; a day with no calls does not
 *    appear (no zero-filled days).
 *  - Both controller GETs are member-level: no Roles metadata.
 */

// ---------------- in-memory prisma stub ----------------
// (SA-B24's makeTable shape, extended to the operators this
// service's queries use together: gte + not-null combined on
// one field, `in`, orderBy, take, count and select projection.)

function matchesWhere(row: any, where: any = {}): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      return Object.entries(v as any).every(([op, operand]: [string, any]) => {
        if (op === "gte") return row[k] != null && new Date(row[k]).getTime() >= new Date(operand).getTime();
        if (op === "lte") return row[k] != null && new Date(row[k]).getTime() <= new Date(operand).getTime();
        if (op === "not") return operand === null ? row[k] != null : row[k] !== operand;
        if (op === "in") return (operand as any[]).includes(row[k]);
        if (op === "contains") return String(row[k] ?? "").toLowerCase().includes(String(operand).toLowerCase());
        return false;
      });
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
  const table: any = {
    rows,
    count: async ({ where }: any = {}) => rows.filter((r) => matchesWhere(r, where)).length,
    findMany: async ({ where, orderBy, take, select }: any = {}) => {
      let out = rows.filter((r) => matchesWhere(r, where));
      if (orderBy) {
        const [field, dir] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy)[0] as any;
        const val = (x: any) => (x instanceof Date ? x.getTime() : x);
        out = [...out].sort((a, b) => {
          const cmp = val(a[field]) < val(b[field]) ? -1 : val(a[field]) > val(b[field]) ? 1 : 0;
          return dir === "desc" ? -cmp : cmp;
        });
      }
      if (take) out = out.slice(0, take);
      return out.map((r) => project(r, select));
    },
  };
  return table;
}

const ORG_A = "org-a";
const ORG_B = "org-b";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
/** Noon UTC, `d` days before today — a stable UTC date bucket
 * for the usage daily-series fixtures at any run time of day. */
const noonDaysAgo = (d: number) => {
  const dt = new Date();
  dt.setUTCHours(12, 0, 0, 0);
  dt.setUTCDate(dt.getUTCDate() - d);
  return dt;
};
const dateOf = (d: number) => noonDaysAgo(d).toISOString().slice(0, 10);

const LONG_CAPTION = `SENTINEL-A caption ${"y".repeat(150)}`;

function makePrisma() {
  return {
    aIActionProposal: makeTable([
      // org A — executed lifecycle (copilot-filed)
      { id: "p-exec", organizationId: ORG_A, title: "SENTINEL-A executed proposal", actionId: "close_conversation", surface: "inbox", proposedBy: "ai", status: "executed", sourceRef: { via: "copilot" }, result: { outcome: "executed" }, error: null, decidedById: "user-1", createdAt: hoursAgo(50), decidedAt: hoursAgo(49), executedAt: hoursAgo(48), updatedAt: hoursAgo(48) },
      // org A — proposal_only approval: filed + decided, never executed
      { id: "p-proponly", organizationId: ORG_A, title: "SENTINEL-A proposal-only proposal", actionId: "pause_campaign", surface: "ads", proposedBy: "ai", status: "approved", sourceRef: { via: "copilot" }, result: { outcome: "proposal_only" }, error: null, decidedById: "user-2", createdAt: hoursAgo(40), decidedAt: hoursAgo(39), executedAt: null, updatedAt: hoursAgo(39) },
      // org A — rejected
      { id: "p-rejected", organizationId: ORG_A, title: "SENTINEL-A rejected proposal", actionId: "hide_comment", surface: "comment", proposedBy: "staff", status: "rejected", sourceRef: null, result: null, error: null, decidedById: "user-1", createdAt: hoursAgo(30), decidedAt: hoursAgo(29), executedAt: null, updatedAt: hoursAgo(29) },
      // org A — failed (terminal stamp = updatedAt; error verbatim)
      { id: "p-failed", organizationId: ORG_A, title: "SENTINEL-A failed proposal", actionId: "close_conversation", surface: "inbox", proposedBy: "ai", status: "failed", sourceRef: { via: "copilot" }, result: null, error: "SENTINEL-ERROR verification failed XYZ", decidedById: "user-1", createdAt: hoursAgo(20), decidedAt: hoursAgo(19), executedAt: null, updatedAt: hoursAgo(18) },
      // org A — filed 40 days ago: outside 30d, inside 90d
      { id: "p-old", organizationId: ORG_A, title: "SENTINEL-A old proposal", actionId: "hide_comment", surface: "comment", proposedBy: "staff", status: "proposed", sourceRef: null, result: null, error: null, decidedById: null, createdAt: daysAgo(40), decidedAt: null, executedAt: null, updatedAt: daysAgo(40) },
      // org B
      { id: "p-b", organizationId: ORG_B, title: "SENTINEL-B proposal", actionId: "close_conversation", surface: "inbox", proposedBy: "ai", status: "proposed", sourceRef: { via: "copilot" }, result: null, error: null, decidedById: null, createdAt: hoursAgo(2), decidedAt: null, executedAt: null, updatedAt: hoursAgo(2) },
    ]),
    learnedItem: makeTable([
      { id: "l-admin", organizationId: ORG_A, title: "SENTINEL-A learned admin", kind: "faq_pair", sourceType: "conversation", status: "approved", reviewedById: "super-1", reviewedAt: hoursAgo(10), reviewedVia: "admin_console", appliedRef: "answer:ans-1", createdAt: hoursAgo(12), updatedAt: hoursAgo(10) },
      { id: "l-staff", organizationId: ORG_A, title: "SENTINEL-A learned staff", kind: "fact", sourceType: "website", status: "rejected", reviewedById: "user-1", reviewedAt: hoursAgo(9), reviewedVia: "org", appliedRef: null, createdAt: hoursAgo(11), updatedAt: hoursAgo(9) },
      // pre-SA-B23 row: reviewedVia was never stamped — null stays null
      { id: "l-legacy", organizationId: ORG_A, title: "SENTINEL-A learned legacy", kind: "fact", sourceType: "product", status: "approved", reviewedById: "user-1", reviewedAt: hoursAgo(8), reviewedVia: null, appliedRef: "knowledge:doc-1", createdAt: hoursAgo(13), updatedAt: hoursAgo(8) },
      { id: "l-pending", organizationId: ORG_A, title: "SENTINEL-A learned pending", kind: "product_note", sourceType: "product", status: "suggested", reviewedById: null, reviewedAt: null, reviewedVia: null, appliedRef: null, createdAt: hoursAgo(7), updatedAt: hoursAgo(7) },
      { id: "l-b", organizationId: ORG_B, title: "SENTINEL-B learned", kind: "fact", sourceType: "website", status: "suggested", reviewedById: null, reviewedAt: null, reviewedVia: null, appliedRef: null, createdAt: hoursAgo(3), updatedAt: hoursAgo(3) },
    ]),
    aiStoredAnswer: makeTable([
      { id: "ans-1", organizationId: ORG_A, questionText: "SENTINEL-A question delivery?", channel: "inbox", origin: "staff_approved", status: "active", invalidReason: null, hitCount: 7, createdAt: hoursAgo(6), updatedAt: hoursAgo(6) },
      { id: "ans-2", organizationId: ORG_A, questionText: "SENTINEL-A invalidated question?", channel: "inbox", origin: "autopilot_grounded", status: "invalidated", invalidReason: "SENTINEL-REASON product_changed xyz", hitCount: 3, createdAt: hoursAgo(25), updatedAt: hoursAgo(5) },
      { id: "ans-b", organizationId: ORG_B, questionText: "SENTINEL-B question?", channel: "inbox", origin: "staff_approved", status: "active", invalidReason: null, hitCount: 1, createdAt: hoursAgo(1), updatedAt: hoursAgo(1) },
    ]),
    socialPost: makeTable([
      { id: "post-1", organizationId: ORG_A, caption: LONG_CAPTION, status: "draft", autoDraftKind: "ai_content", autoDraftRef: "product:prod-1", createdAt: hoursAgo(4) },
      // a manual post is NOT AI activity — never in the feed
      { id: "post-manual", organizationId: ORG_A, caption: "SENTINEL-A manual post", status: "draft", autoDraftKind: null, autoDraftRef: null, createdAt: hoursAgo(3) },
      { id: "post-b", organizationId: ORG_B, caption: "SENTINEL-B draft", status: "draft", autoDraftKind: "ai_content", autoDraftRef: "product:prod-9", createdAt: hoursAgo(1) },
    ]),
    aIUsageRecord: makeTable([
      { id: "u-a1", organizationId: ORG_A, feature: "copilot", provider: "openai", model: "m", inputTokens: 100, outputTokens: 50, estimated: false, createdAt: noonDaysAgo(0) },
      { id: "u-a2", organizationId: ORG_A, feature: "copilot", provider: "openai", model: "m", inputTokens: 200, outputTokens: 80, estimated: true, createdAt: noonDaysAgo(0) },
      { id: "u-a3", organizationId: ORG_A, feature: "chat", provider: "dev", model: null, inputTokens: 10, outputTokens: 5, estimated: true, createdAt: noonDaysAgo(2) },
      { id: "u-a4", organizationId: ORG_A, feature: "chat", provider: "openai", model: "m", inputTokens: 30, outputTokens: 15, estimated: false, createdAt: noonDaysAgo(5) },
      // 40 days old: outside the 30d usage window
      { id: "u-a-old", organizationId: ORG_A, feature: "report", provider: "openai", model: "m", inputTokens: 999, outputTokens: 999, estimated: false, createdAt: noonDaysAgo(40) },
      { id: "u-b1", organizationId: ORG_B, feature: "copilot", provider: "openai", model: "m", inputTokens: 1000, outputTokens: 500, estimated: false, createdAt: noonDaysAgo(0) },
    ]),
  } as any;
}

const byId = (feed: any, id: string) => feed.items.find((i: any) => i.id === id);
const idsFor = (feed: any, sourceId: string) => feed.items.filter((i: any) => i.sourceId === sourceId).map((i: any) => i.id);

// Org A, 30d window: proposal 10 (3+2+2+3) + learned 7 (2+2+2+1)
// + answer 3 (1+2) + content 1 = 21 events, all stamps distinct.
const EXPECTED_ORDER_A = [
  "content:draft_created:post-1",
  "answer:invalidated:ans-2",
  "answer:captured:ans-1",
  "learned:suggested:l-pending",
  "learned:decided:l-legacy",
  "learned:decided:l-staff",
  "learned:decided:l-admin",
  "learned:suggested:l-staff",
  "learned:suggested:l-admin",
  "learned:suggested:l-legacy",
  "proposal:failed:p-failed",
  "proposal:decided:p-failed",
  "proposal:filed:p-failed",
  "answer:captured:ans-2",
  "proposal:decided:p-rejected",
  "proposal:filed:p-rejected",
  "proposal:decided:p-proponly",
  "proposal:filed:p-proponly",
  "proposal:executed:p-exec",
  "proposal:decided:p-exec",
  "proposal:filed:p-exec",
];

// ---------------- the feed ----------------

describe("SA-B25 AiActivityService — feed assembly", () => {
  it("assembles all four kinds newest-first, total = the exact event count, stamps from the rows", async () => {
    const prisma = makePrisma();
    const svc = new AiActivityService(prisma);
    const feed = await svc.getFeed(ORG_A, {});

    expect(feed.total).toBe(21);
    expect(feed.days).toBe(30);
    expect(feed.kind).toBeNull();
    expect(feed.limit).toBe(50);
    expect(feed.offset).toBe(0);
    expect(feed.items.map((i: any) => i.id)).toEqual(EXPECTED_ORDER_A);

    const filed = byId(feed, "proposal:filed:p-exec");
    const execRow = prisma.aIActionProposal.rows.find((r: any) => r.id === "p-exec");
    expect(filed.at).toBe(execRow.createdAt.toISOString());
    expect(filed.title).toBe("SENTINEL-A executed proposal");
    expect(filed.detail).toBeNull();
    expect(filed.meta).toEqual({
      actionId: "close_conversation", surface: "inbox", proposedBy: "ai",
      status: "executed", via: "copilot",
    });

    const draft = byId(feed, "content:draft_created:post-1");
    expect(draft.title).toBe(LONG_CAPTION.slice(0, 120));
    expect(draft.title).toHaveLength(120);
    expect(draft.meta).toEqual({ autoDraftRef: "product:prod-1", status: "draft" });

    const captured = byId(feed, "answer:captured:ans-1");
    expect(captured.title).toBe("SENTINEL-A question delivery?");
    expect(captured.meta).toEqual({ channel: "inbox", origin: "staff_approved", hitCount: 7 });

    // the manual post never appears
    expect(byId(feed, "content:draft_created:post-manual")).toBeUndefined();
  });

  it("the failed proposal's error and the invalidated answer's reason arrive VERBATIM as detail", async () => {
    const svc = new AiActivityService(makePrisma());
    const feed = await svc.getFeed(ORG_A, {});
    expect(byId(feed, "proposal:failed:p-failed").detail).toBe("SENTINEL-ERROR verification failed XYZ");
    expect(byId(feed, "answer:invalidated:ans-2").detail).toBe("SENTINEL-REASON product_changed xyz");
    expect(byId(feed, "answer:invalidated:ans-2").meta).toEqual({ channel: "inbox", origin: "autopilot_grounded" });
  });

  it("proposal lifecycles: proposal_only has no executed event; rejected decides rejected only; executed has all three", async () => {
    const svc = new AiActivityService(makePrisma());
    const feed = await svc.getFeed(ORG_A, {});

    expect(idsFor(feed, "p-proponly").sort()).toEqual(["proposal:decided:p-proponly", "proposal:filed:p-proponly"]);
    const decidedOnly = byId(feed, "proposal:decided:p-proponly");
    expect(decidedOnly.meta.proposalOnly).toBe(true);
    expect(decidedOnly.meta.decision).toBe("approved");
    expect(decidedOnly.meta.decidedById).toBe("user-2");

    expect(idsFor(feed, "p-rejected").sort()).toEqual(["proposal:decided:p-rejected", "proposal:filed:p-rejected"]);
    expect(byId(feed, "proposal:decided:p-rejected").meta).toMatchObject({ decision: "rejected", proposalOnly: false });

    expect(idsFor(feed, "p-exec").sort()).toEqual([
      "proposal:decided:p-exec", "proposal:executed:p-exec", "proposal:filed:p-exec",
    ]);
    expect(byId(feed, "proposal:executed:p-exec").meta).toEqual({ actionId: "close_conversation" });
  });

  it("learned decisions carry reviewedVia exactly as stamped — admin_console, org, and null (pinned)", async () => {
    const svc = new AiActivityService(makePrisma());
    const feed = await svc.getFeed(ORG_A, {});
    expect(byId(feed, "learned:decided:l-admin").meta).toEqual({
      decision: "approved", reviewedVia: "admin_console", appliedRef: "answer:ans-1",
    });
    expect(byId(feed, "learned:decided:l-staff").meta).toEqual({
      decision: "rejected", reviewedVia: "org", appliedRef: null,
    });
    const legacy = byId(feed, "learned:decided:l-legacy");
    expect(legacy.meta.decision).toBe("approved");
    expect(legacy.meta.reviewedVia).toBeNull();
    expect(byId(feed, "learned:suggested:l-admin").meta).toEqual({ itemKind: "faq_pair", sourceType: "conversation" });
  });

  it("kind filter returns only that kind, with total = that kind's exact event count", async () => {
    const svc = new AiActivityService(makePrisma());
    const expected: Record<string, number> = { proposal: 10, learned: 7, answer: 3, content: 1 };
    for (const [kind, total] of Object.entries(expected)) {
      const feed = await svc.getFeed(ORG_A, { kind });
      expect(feed.kind).toBe(kind);
      expect(feed.total).toBe(total);
      expect(feed.items).toHaveLength(total);
      expect(feed.items.every((i: any) => i.kind === kind)).toBe(true);
    }
  });

  it("days window: the 40-day-old event is out at 30d and in at 90d; bad days / bad kind are 400s", async () => {
    const svc = new AiActivityService(makePrisma());
    const d30 = await svc.getFeed(ORG_A, { days: 30 });
    expect(byId(d30, "proposal:filed:p-old")).toBeUndefined();
    const d90 = await svc.getFeed(ORG_A, { days: 90 });
    expect(d90.total).toBe(22);
    expect(byId(d90, "proposal:filed:p-old")).toBeDefined();
    const d7 = await svc.getFeed(ORG_A, { days: "7" });
    expect(d7.days).toBe(7);
    // every other org-A fixture sits within ~50h, so the 7d
    // window keeps all 21 — only the 40-day-old row stays out
    expect(d7.total).toBe(21);
    expect(byId(d7, "proposal:filed:p-exec")).toBeDefined();

    await expect(svc.getFeed(ORG_A, { days: 14 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.getFeed(ORG_A, { kind: "bogus" })).rejects.toMatchObject({ status: 400 });
  });

  it("pagination: pages are disjoint ordered slices and total is the full count, not the page size", async () => {
    const svc = new AiActivityService(makePrisma());
    const page1 = await svc.getFeed(ORG_A, { limit: 5, offset: 0 });
    const page2 = await svc.getFeed(ORG_A, { limit: 5, offset: 5 });
    expect(page1.total).toBe(21);
    expect(page2.total).toBe(21);
    expect(page1.limit).toBe(5);
    expect(page2.offset).toBe(5);
    expect(page1.items.map((i: any) => i.id)).toEqual(EXPECTED_ORDER_A.slice(0, 5));
    expect(page2.items.map((i: any) => i.id)).toEqual(EXPECTED_ORDER_A.slice(5, 10));
    const overlap = page1.items.filter((i: any) => page2.items.some((j: any) => j.id === i.id));
    expect(overlap).toHaveLength(0);
  });

  it("org isolation: org B's feed holds none of org A's sourceIds or sentinel titles (and vice versa)", async () => {
    const svc = new AiActivityService(makePrisma());
    const feedB = await svc.getFeed(ORG_B, {});
    expect(feedB.total).toBe(4);
    expect(feedB.items.map((i: any) => i.sourceId).sort()).toEqual(["ans-b", "l-b", "p-b", "post-b"]);
    for (const item of feedB.items) {
      expect(item.title).not.toContain("SENTINEL-A");
      expect(["p-exec", "p-proponly", "p-rejected", "p-failed", "p-old", "l-admin", "l-staff", "l-legacy", "l-pending", "ans-1", "ans-2", "post-1"]).not.toContain(item.sourceId);
    }
    const feedA = await svc.getFeed(ORG_A, {});
    for (const item of feedA.items) {
      expect(item.title).not.toContain("SENTINEL-B");
    }
  });
});

// ---------------- usage ----------------

describe("SA-B25 AiActivityService — usage overview", () => {
  it("totals / features / daily reconcile EXACTLY with the fixtures (hand-computed)", async () => {
    const svc = new AiActivityService(makePrisma());
    const usage = await svc.getUsage(ORG_A, { days: 30 });

    expect(usage.days).toBe(30);
    expect(typeof usage.since).toBe("string");
    // u-a1..u-a4 in window (u-a-old is 40d out): 100+200+10+30 in,
    // 50+80+5+15 out; estimated = u-a2 + u-a3 only.
    expect(usage.totals).toEqual({ calls: 4, inputTokens: 340, outputTokens: 150, estimatedCalls: 2 });
    // both features have 2 calls — the tie breaks by feature asc
    expect(usage.features).toEqual([
      { feature: "chat", calls: 2, inputTokens: 40, outputTokens: 20, estimatedCalls: 1 },
      { feature: "copilot", calls: 2, inputTokens: 300, outputTokens: 130, estimatedCalls: 1 },
    ]);
    expect(usage.daily).toEqual([
      { date: dateOf(5), calls: 1, inputTokens: 30, outputTokens: 15 },
      { date: dateOf(2), calls: 1, inputTokens: 10, outputTokens: 5 },
      { date: dateOf(0), calls: 2, inputTokens: 300, outputTokens: 130 },
    ]);
    // days with no calls never appear — no zero-filled rows
    expect(usage.daily.map((d: any) => d.date)).not.toContain(dateOf(1));
    expect(usage.daily.map((d: any) => d.date)).not.toContain(dateOf(3));
    expect(usage.daily).toHaveLength(3);
  });

  it("usage is org-scoped and the window is 7/30 only", async () => {
    const svc = new AiActivityService(makePrisma());
    const usageB = await svc.getUsage(ORG_B, {});
    expect(usageB.totals).toEqual({ calls: 1, inputTokens: 1000, outputTokens: 500, estimatedCalls: 0 });
    expect(usageB.features).toEqual([
      { feature: "copilot", calls: 1, inputTokens: 1000, outputTokens: 500, estimatedCalls: 0 },
    ]);
    expect(usageB.daily).toEqual([{ date: dateOf(0), calls: 1, inputTokens: 1000, outputTokens: 500 }]);

    const usage7 = await svc.getUsage(ORG_A, { days: 7 });
    expect(usage7.totals.calls).toBe(4);
    await expect(svc.getUsage(ORG_A, { days: 90 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.getUsage(ORG_A, { days: 14 })).rejects.toMatchObject({ status: 400 });
  });
});

// ---------------- controller discipline ----------------

describe("SA-B25 AiActivityController — role discipline (metadata)", () => {
  const rolesOf = (fn: any) => Reflect.getMetadata(ROLES_KEY, fn) as string[] | undefined;
  it("both GET handlers carry no @Roles restriction (member-level reads)", () => {
    expect(rolesOf(AiActivityController.prototype.feed)).toBeUndefined();
    expect(rolesOf(AiActivityController.prototype.usage)).toBeUndefined();
  });
});
