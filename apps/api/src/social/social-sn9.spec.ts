import {
  SocialCoachService,
  buildCoachSummary,
  computeCoachDigest,
} from "./social-coach.service";
import { SocialInsightsService } from "./social-insights.service";

/**
 * SN9 — the weekly performance coach (Batch N3). Proven with:
 *   - the deterministic compute against a fixed fixture: window
 *     totals/counts, top posts, hashtag movers and the delta are
 *     EXACTLY the fixture's arithmetic (engagementScore = the
 *     SU7 sum).
 *   - thin data: < 3 scored posts → dataSufficient false and the
 *     summary says the data is thin instead of advising.
 *   - narration discipline: a real-LLM narration with an
 *     invented number is DISCARDED (source "deterministic"); a
 *     grounded narration is kept (source "llm") with ONE usage
 *     row; no real LLM → deterministic, never labelled AI.
 *   - the weekly run: digest row + OWNER/ADMIN notifications on
 *     the first run; a second run in the same week is a no-op
 *     (idempotent on org + weekStart); ZERO posts are created.
 */

const ORG = "org-1";
const NOW = new Date("2026-10-15T12:00:00.000Z"); // Thursday

function post(id: string, daysAgo: number, caption: string, insights: any) {
  return {
    id, organizationId: ORG, socialAccountId: "acc-1", status: "published",
    caption, insights,
    publishedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    mediaRefs: [],
  };
}

// Current window (0–7 days ago): p1 15, p2 5, p3 21, p4 unscored.
// Previous window (7–14 days ago): p5 5, p6 2.
const FIXTURE = [
  post("p1", 1, "ঈদ অফার এসেছে #offer #sale", { platform: "facebook", reactions: 10, comments: 2, shares: 3 }),
  post("p2", 2, "নতুন কালেকশন #sale", { platform: "facebook", reactions: 5, comments: 0, shares: 0 }),
  post("p3", 3, "কাস্টমার রিভিউ #offer", { platform: "facebook", reactions: 20, comments: 1, shares: 0 }),
  post("p4", 4, "insights ছাড়া পোস্ট", null),
  post("p5", 9, "আগের সপ্তাহ #offer", { platform: "facebook", reactions: 4, comments: 0, shares: 1 }),
  post("p6", 11, "আগের #sale #new", { platform: "facebook", reactions: 2 }),
  post("p7", 20, "অনেক আগের পোস্ট", { platform: "facebook", reactions: 100 }),
];

describe("SN9 — deterministic compute (fixture-exact)", () => {
  const data = computeCoachDigest(FIXTURE, { now: NOW });

  it("window totals and counts match the fixture arithmetic", () => {
    expect(data.current).toEqual({ posts: 4, scoredPosts: 3, engagement: 41 });
    expect(data.previous).toEqual({ posts: 2, scoredPosts: 2, engagement: 7 });
    expect(data.engagementDeltaPct).toBe(486);
    expect(data.dataSufficient).toBe(true);
  });

  it("top posts are the three highest scored, in order", () => {
    expect(data.topPosts.map((t) => [t.id, t.engagement])).toEqual([
      ["p3", 21], ["p1", 15], ["p2", 5],
    ]);
    expect(data.topPosts[0].captionExcerpt).toContain("কাস্টমার রিভিউ");
  });

  it("hashtag movers carry current + previous averages (null = new)", () => {
    expect(data.hashtagMovers).toEqual([
      { tag: "#offer", currentAvg: 18, previousAvg: 5, posts: 2 },
      { tag: "#sale", currentAvg: 10, previousAvg: 2, posts: 2 },
    ]);
  });

  it("the deterministic summary states only compute numbers", () => {
    const summary = buildCoachSummary(data);
    expect(summary).toContain("৪১");
    expect(summary).not.toContain("100");
  });

  it("thin data: < 3 scored posts → dataSufficient false and an honest summary", () => {
    const thin = computeCoachDigest([FIXTURE[0], FIXTURE[3]], { now: NOW });
    expect(thin.dataSufficient).toBe(false);
    expect(thin.current.scoredPosts).toBe(1);
    expect(buildCoachSummary(thin)).toContain("যথেষ্ট performance data জমেনি");
  });

  it("no previous scored posts → delta is null, never invented", () => {
    const only = computeCoachDigest(FIXTURE.slice(0, 4), { now: NOW });
    expect(only.previous.scoredPosts).toBe(0);
    expect(only.engagementDeltaPct).toBeNull();
  });
});

// ---------- service-level (digest run / narration / endpoint) ----------

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v && typeof v === "object") {
      if (Array.isArray((v as any).in)) return (v as any).in.includes(row[k]);
      if ((v as any).not !== undefined) return row[k] !== (v as any).not;
      if ((v as any).gte) return new Date(row[k]).getTime() >= new Date((v as any).gte).getTime();
      return true;
    }
    return row[k] === v;
  });
}

function makeTable(idPrefix: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    async create({ data }: any) {
      const row = { id: data.id ?? `${idPrefix}-${++seq}`, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    async findFirst({ where, orderBy }: any = {}) {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.weekStart === "desc") out = [...out].sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)));
      if (orderBy?.publishedAt === "desc") out = [...out].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
      return out[0] ?? null;
    },
    // MB5: SocialCoachService now reads org locale rungs through
    // resolveOwnerLanguageForOrg, which uses findUnique — the
    // fake models the full Prisma surface it consumes.
    async findUnique({ where }: any = {}) {
      return rows.find((r) => matches(r, where ?? {})) ?? null;
    },
    async findMany({ where, orderBy, take }: any = {}) {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.publishedAt === "desc") out = [...out].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
      if (take) out = out.slice(0, take);
      return out;
    },
    async count({ where }: any = {}) { return rows.filter((r) => matches(r, where ?? {})).length; },
  };
}

function makeCoach(llm: any) {
  const db: any = {
    socialPost: makeTable("post"),
    socialCoachDigest: makeTable("digest"),
    membership: makeTable("member"),
    agentNotification: makeTable("notif"),
    aIUsageRecord: makeTable("usage"),
    organization: makeTable("org"),
    socialAccount: makeTable("account"),
    socialFollowerSnapshot: makeTable("snap"),
  };
  db.organization.rows.push({ id: ORG, name: "Qosprey", timezone: "Asia/Dhaka" });
  for (const p of FIXTURE) db.socialPost.rows.push({ ...p });
  db.membership.rows.push(
    { id: "m1", organizationId: ORG, userId: "owner-1", role: "OWNER", status: "active" },
    { id: "m2", organizationId: ORG, userId: "admin-1", role: "ADMIN", status: "active" },
    { id: "m3", organizationId: ORG, userId: "agent-1", role: "SUPPORT_AGENT", status: "active" },
    { id: "m4", organizationId: ORG, userId: "gone-1", role: "ADMIN", status: "suspended" },
  );
  const audit: any = { log: async () => undefined, entries: [] as any[] };
  audit.log = async (e: any) => { audit.entries.push(e); };
  // contentTypes / getInsightsSummary read only prisma — the
  // social/publish collaborators are not exercised here.
  const insights = new SocialInsightsService(db, audit, undefined as any, undefined as any);
  const coach = new SocialCoachService(db, audit, llm, insights);
  return { db, audit, coach };
}

const noLlm = { getProvider: async () => ({ name: "none", isRealLlm: false, complete: async () => { throw new Error("must not be called"); } }) };

describe("SN9 — weekly digest run", () => {
  it("creates the digest + OWNER/ADMIN notifications once; the same-week rerun is a no-op; no posts are created", async () => {
    const { db, coach } = makeCoach(noLlm);
    const postsBefore = db.socialPost.rows.length;
    const first = await coach.runWeeklyDigest(ORG);
    expect(first.created).toBe(true);
    expect(first.digest.narrationSource).toBe("deterministic");
    expect(db.socialCoachDigest.rows).toHaveLength(1);
    // weekStart = Monday of the current week in Asia/Dhaka.
    expect(db.socialCoachDigest.rows[0].weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const notifs = db.agentNotification.rows;
    expect(notifs.map((n: any) => n.userId).sort()).toEqual(["admin-1", "owner-1"]);
    expect(notifs[0].type).toBe("social_coach_weekly");
    expect(db.socialPost.rows).toHaveLength(postsBefore);

    const second = await coach.runWeeklyDigest(ORG);
    expect(second.created).toBe(false);
    expect(second.digest.id).toBe(first.digest.id);
    expect(db.socialCoachDigest.rows).toHaveLength(1);
    expect(db.agentNotification.rows).toHaveLength(2);
  });

  it("a real LLM narration with an invented number is discarded (guard)", async () => {
    const liar = {
      getProvider: async () => ({
        name: "gemini", isRealLlm: true,
        complete: async () => ({ text: "দারুণ সপ্তাহ! engagement বেড়ে হয়েছে ৯৯৯৯ — আরও ৫০টি পোস্ট করুন।", model: "m", inputTokens: 10, outputTokens: 8, tokensEstimated: false }),
      }),
    };
    const { db, coach } = makeCoach(liar);
    const out = await coach.runWeeklyDigest(ORG);
    expect(out.created).toBe(true);
    expect(out.digest.narrationSource).toBe("deterministic");
    expect(out.digest.summary).not.toContain("৯৯৯৯");
    // The provider call DID happen (usage row) — only its words
    // were discarded.
    expect(db.aIUsageRecord.rows.filter((r: any) => r.feature === "social_coach")).toHaveLength(1);
  });

  it("a grounded real-LLM narration is kept and labelled llm", async () => {
    const honest = {
      getProvider: async () => ({
        name: "gemini", isRealLlm: true,
        complete: async () => ({ text: "গত ৭ দিনে ৪টি পোস্ট publish হয়েছে এবং মোট engagement ৪১। সেরা পোস্টটির engagement ২১।", model: "m", inputTokens: 10, outputTokens: 8, tokensEstimated: false }),
      }),
    };
    const { db, coach } = makeCoach(honest);
    const out = await coach.runWeeklyDigest(ORG);
    expect(out.digest.narrationSource).toBe("llm");
    expect(out.digest.summary).toContain("৪১");
    expect(db.aIUsageRecord.rows.filter((r: any) => r.feature === "social_coach")).toHaveLength(1);
  });

  it("getCoach returns the latest digest + a deterministic preview; the preview never calls the LLM", async () => {
    let llmCalls = 0;
    const counting = {
      getProvider: async () => ({
        name: "gemini", isRealLlm: true,
        complete: async () => { llmCalls += 1; return { text: "x", model: "m", inputTokens: 1, outputTokens: 1, tokensEstimated: false }; },
      }),
    };
    const { coach } = makeCoach(counting);
    const before = await coach.getCoach(ORG);
    expect(before.latest).toBeNull();
    expect(before.preview.summary).toContain("৪১");
    expect(llmCalls).toBe(0);
    await coach.runWeeklyDigest(ORG);
    const after = await coach.getCoach(ORG);
    expect(after.latest).not.toBeNull();
    expect(after.latest!.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
