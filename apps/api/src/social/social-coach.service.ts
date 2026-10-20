import { HttpException, Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LlmFactory, providerForOrg } from "../ai/llm/llm.factory";
import {
  SocialInsightsService,
  aggregateHashtagPerformance,
  dayInTimeZone,
  engagementScore,
  shiftDay,
} from "./social-insights.service";
import { ungroundedNumbers } from "./social-ai.service";
import { ApiException, forbidden } from "../i18n/api-exception";

/**
 * SN9 — the weekly performance coach.
 *
 * Two layers, kept strictly apart:
 *   1. COMPUTE (deterministic, this file's pure functions):
 *      last 7 days vs the previous 7 days over the org's OWN
 *      published posts — totals + counts via the SU7
 *      engagementScore, top-3 posts, hashtag movers via the SU7
 *      hashtag aggregation, best content type + best time from
 *      the SU7 insights service. EVERY number the coach ever
 *      states comes from here; nothing is estimated or invented.
 *   2. NARRATION (optional): when the org has a REAL LLM
 *      configured, the provider phrases a short Bengali summary
 *      from the compute payload ONLY, under the SU4 number
 *      guard — a narration containing any number the compute
 *      did not produce is discarded wholesale and the
 *      deterministic summary is used instead. Without a real
 *      LLM the deterministic summary IS the output and is
 *      labelled as a summary (সারসংক্ষেপ), never as AI.
 *
 * Delivery is the `social_coach_weekly` automation job (per-org
 * template, default OFF): it stores ONE SocialCoachDigest per
 * (org, weekStart) — the unique constraint makes a re-run a
 * no-op — and notifies the org's OWNER/ADMIN members. The job
 * never creates, schedules or publishes a post.
 */

export interface CoachWindowStat {
  posts: number;
  scoredPosts: number;
  engagement: number;
}

export interface CoachDigestData {
  current: CoachWindowStat;
  previous: CoachWindowStat;
  /** Percent change of total engagement; null when the
   * previous window has no scored posts to compare against. */
  engagementDeltaPct: number | null;
  topPosts: { id: string; captionExcerpt: string; engagement: number; publishedAt: string; socialAccountId: string }[];
  hashtagMovers: { tag: string; currentAvg: number; previousAvg: number | null; posts: number }[];
  bestContentType: { kind: string; avgEngagement: number; posts: number } | null;
  bestTime: { dayOfWeek: number; hour: number; avgEngagement: number; posts: number } | null;
  /** Fewer than 3 scored posts in the current window — the
   * coach says the data is thin instead of advising. */
  dataSufficient: boolean;
}

const DAY_MS = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

function windowStat(rows: any[]): CoachWindowStat {
  let scoredPosts = 0;
  let engagement = 0;
  for (const row of rows) {
    const score = engagementScore(row?.insights);
    if (score !== null) {
      scoredPosts += 1;
      engagement += score;
    }
  }
  return { posts: rows.length, scoredPosts, engagement };
}

/**
 * The deterministic coach compute — pure and exported for
 * specs. Windows are absolute: current = [now−7d, now),
 * previous = [now−14d, now−7d), by publishedAt.
 */
export function computeCoachDigest(
  posts: any[],
  opts: {
    now?: Date;
    bestContentType?: CoachDigestData["bestContentType"];
    bestTime?: CoachDigestData["bestTime"];
  } = {},
): CoachDigestData {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const inWindow = (from: number, to: number) => (p: any) => {
    const t = p?.publishedAt ? new Date(p.publishedAt).getTime() : NaN;
    return Number.isFinite(t) && t >= from && t < to;
  };
  const currentRows = (posts ?? []).filter(inWindow(nowMs - 7 * DAY_MS, nowMs));
  const previousRows = (posts ?? []).filter(inWindow(nowMs - 14 * DAY_MS, nowMs - 7 * DAY_MS));
  const current = windowStat(currentRows);
  const previous = windowStat(previousRows);

  const engagementDeltaPct = previous.scoredPosts > 0 && previous.engagement > 0
    ? Math.round(((current.engagement - previous.engagement) / previous.engagement) * 100)
    : null;

  const topPosts = currentRows
    .map((p) => ({ p, score: engagementScore(p?.insights) }))
    .filter((x): x is { p: any; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ p, score }) => ({
      id: String(p.id ?? ""),
      captionExcerpt: String(p.caption ?? "").slice(0, 80),
      engagement: score,
      publishedAt: p.publishedAt ? new Date(p.publishedAt).toISOString() : "",
      socialAccountId: String(p.socialAccountId ?? ""),
    }));

  const currentTags = new Map(aggregateHashtagPerformance(currentRows).map((t) => [t.tag, t]));
  const previousTags = new Map(aggregateHashtagPerformance(previousRows).map((t) => [t.tag, t]));
  const hashtagMovers = [...currentTags.values()]
    .map((t) => ({
      tag: t.tag,
      currentAvg: t.avgEngagement,
      previousAvg: previousTags.has(t.tag) ? previousTags.get(t.tag)!.avgEngagement : null,
      posts: t.posts,
    }))
    .sort((a, b) => b.currentAvg - a.currentAvg)
    .slice(0, 5);

  return {
    current,
    previous,
    engagementDeltaPct,
    topPosts,
    hashtagMovers,
    bestContentType: opts.bestContentType ?? null,
    bestTime: opts.bestTime ?? null,
    dataSufficient: current.scoredPosts >= 3,
  };
}

const WEEKDAY_BN = ["রবিবার", "সোমবার", "মঙ্গলবার", "বুধবার", "বৃহস্পতিবার", "শুক্রবার", "শনিবার"];

/** Bengali digits for display (the summary is owner-facing). */
const bn = (v: number | string): string => String(v).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

/**
 * The deterministic Bengali summary — built ONLY from compute
 * numbers. This is also the fallback whenever narration is
 * unavailable or fails the number guard.
 */
export function buildCoachSummary(data: CoachDigestData): string {
  const lines: string[] = [];
  if (!data.dataSufficient) {
    lines.push(
      `গত ৭ দিনে যথেষ্ট performance data জমেনি — publish হয়েছে ${bn(data.current.posts)}টি পোস্ট, যার মধ্যে মাত্র ${bn(data.current.scoredPosts)}টির engagement data পাওয়া গেছে। আরও কয়েকটি পোস্টের data এলে Coach নির্ভরযোগ্য সারসংক্ষেপ দিতে পারবে।`,
    );
    return lines.join(" ");
  }
  lines.push(`গত ৭ দিনে ${bn(data.current.posts)}টি পোস্ট publish হয়েছে; মোট engagement ${bn(data.current.engagement)}।`);
  if (data.engagementDeltaPct !== null) {
    lines.push(data.engagementDeltaPct >= 0
      ? `আগের ৭ দিনের তুলনায় engagement বেড়েছে ${bn(data.engagementDeltaPct)}%।`
      : `আগের ৭ দিনের তুলনায় engagement কমেছে ${bn(Math.abs(data.engagementDeltaPct))}%।`);
  }
  const top = data.topPosts[0];
  if (top) {
    lines.push(`সেরা পোস্ট${top.captionExcerpt ? ` "${top.captionExcerpt}"` : ""} — engagement ${bn(top.engagement)}।`);
  }
  if (data.bestContentType) {
    lines.push(`সবচেয়ে ভালো ফল দিচ্ছে ${data.bestContentType.kind} content — গড় engagement ${bn(data.bestContentType.avgEngagement)}।`);
  }
  if (data.bestTime) {
    lines.push(`সেরা সময়ের ইঙ্গিত: ${WEEKDAY_BN[data.bestTime.dayOfWeek] ?? ""} ${bn(`${data.bestTime.hour}:00`)} (গড় engagement ${bn(data.bestTime.avgEngagement)})।`);
  }
  const mover = data.hashtagMovers[0];
  if (mover) {
    lines.push(`উঠতি hashtag ${mover.tag} — এই সপ্তাহে গড় engagement ${bn(mover.currentAvg)}${mover.previousAvg === null ? " (আগের সপ্তাহে ছিল না)" : ""}।`);
  }
  return lines.join(" ");
}

/** Every number the narration is allowed to state: the compute
 * payload's numbers, in exact, rounded and 1-decimal forms. */
export function coachAllowedNumbers(data: CoachDigestData): Set<string> {
  const allowed = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      allowed.add(String(Number(v)));
      allowed.add(String(Math.round(v)));
      allowed.add(String(Number(v.toFixed(1))));
      allowed.add(String(Math.abs(Math.round(v))));
    }
  };
  const walk = (v: any) => {
    if (v === null || v === undefined) return;
    if (typeof v === "number") { add(v); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(data);
  return allowed;
}

@Injectable()
export class SocialCoachService {
  private readonly logger = new Logger(SocialCoachService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly llm: LlmFactory,
    // The module provides SocialInsightsService; when it is
    // absent the compute simply runs without the SU7 enrichment
    // (best content type / best time stay null) — never a
    // half-constructed substitute.
    @Optional() private readonly insights?: SocialInsightsService,
  ) {}

  /** Live compute for one org (SU7 enrichment included). */
  async compute(organizationId: string): Promise<CoachDigestData> {
    const rows = await (this.prisma as any).socialPost.findMany({
      where: { organizationId, status: "published", publishedAt: { not: null } },
      orderBy: { publishedAt: "desc" },
      take: 500,
    }).catch(() => []);
    const data = computeCoachDigest(Array.isArray(rows) ? rows : [], { now: new Date() });
    try {
      const ct = await this.insights!.contentTypes(organizationId);
      const scored = (ct?.types ?? []).filter(
        (t): t is typeof t & { engagementAvg: number } => typeof t.engagementAvg === "number",
      );
      if (scored.length > 0) {
        const best = [...scored].sort((a: any, b: any) => b.engagementAvg - a.engagementAvg)[0];
        data.bestContentType = { kind: best.type, avgEngagement: best.engagementAvg, posts: best.posts };
      }
    } catch { /* enrichment is best-effort; the core compute stands alone */ }
    try {
      const summary = await this.insights!.getInsightsSummary(organizationId);
      if (summary?.bestTime) {
        // SU7's shape: { weekday, hour, score, postsConsidered }.
        data.bestTime = {
          dayOfWeek: summary.bestTime.weekday,
          hour: summary.bestTime.hour,
          avgEngagement: summary.bestTime.score,
          posts: summary.bestTime.postsConsidered,
        };
      }
    } catch { /* same best-effort discipline */ }
    return data;
  }

  private async orgTimeZone(organizationId: string): Promise<string> {
    const org = await (this.prisma as any).organization?.findFirst?.({
      where: { id: organizationId },
    }).catch(() => null);
    return org?.timezone || "Asia/Dhaka";
  }

  /** Monday (org tz) of the current week as YYYY-MM-DD. */
  async weekStartFor(organizationId: string, now = new Date()): Promise<string> {
    const tz = await this.orgTimeZone(organizationId);
    const today = dayInTimeZone(now, tz);
    const [y, m, d] = today.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay();
    const diff = (weekday + 6) % 7; // Monday = 0
    return shiftDay(today, -diff);
  }

  private serializeDigest(row: any) {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    return {
      id: row.id,
      weekStart: row.weekStart,
      narrationSource: row.narrationSource ?? payload?.narration?.source ?? "deterministic",
      summary: typeof payload.summary === "string" ? payload.summary : "",
      data: payload.data ?? null,
      createdAt: row.createdAt ?? null,
    };
  }

  /** Latest stored digest + a live compute preview (the preview
   * NEVER calls the LLM — its summary is deterministic). */
  async getCoach(organizationId: string) {
    const latestRow = await (this.prisma as any).socialCoachDigest?.findFirst?.({
      where: { organizationId },
      orderBy: { weekStart: "desc" },
    }).catch(() => null);
    const previewData = await this.compute(organizationId);
    return {
      latest: latestRow ? this.serializeDigest(latestRow) : null,
      preview: { data: previewData, summary: buildCoachSummary(previewData) },
    };
  }

  /** The SU4/SN4 daily-cap discipline for the coach feature —
   * throws on kill switch / cap; the digest path catches and
   * falls back to the deterministic summary. */
  private async checkCoachLimit(organizationId: string) {
    const { killSwitches, effectiveLimits, isAiDisabledForOrg } = await import("../common/platform-settings");
    const ks = await killSwitches(this.prisma as any);
    if (isAiDisabledForOrg(ks, organizationId)) {
      throw forbidden(ks.aiGloballyPaused ? "social.aiFeaturesTemporarilyPausedPlatformWide" : "social.aiFeaturesTemporarilyDisabledForThisOrganization");
    }
    const baseline = Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 200);
    const { aiDaily: limit } = await effectiveLimits(this.prisma as any, organizationId, { aiDaily: baseline, broadcastCap: 1000 });
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await (this.prisma as any).aIUsageRecord.count({
      where: { organizationId, feature: "social_coach", createdAt: { gte: startOfDay } },
    });
    if (used >= limit) {
      throw new ApiException("social.dailyAiGenerationLimitReachedFor", { limit: limit }, 429);
    }
  }

  /**
   * Narration with the full discipline: cap first, real LLM
   * only, usage row after provider success, number guard after
   * parsing. ANY failure mode returns the deterministic summary
   * — narration is an enhancement, never a dependency.
   */
  private async narrate(
    organizationId: string,
    data: CoachDigestData,
  ): Promise<{ summary: string; source: "llm" | "deterministic"; provider: string | null }> {
    const deterministic = buildCoachSummary(data);
    try {
      await this.checkCoachLimit(organizationId);
      const provider = await providerForOrg(this.llm, organizationId);
      if (!provider?.isRealLlm) {
        return { summary: deterministic, source: "deterministic", provider: provider?.name ?? null };
      }
      const result = await provider.complete([
        {
          role: "system",
          content:
            "You write a SHORT Bengali weekly performance summary for a business owner. Use ONLY the numbers in the JSON data given — never invent a number, date, platform name or recommendation that the data does not support. Two or three sentences, plain Bengali (বাংলা হরফে).",
        },
        { role: "user", content: `Data (JSON):\n${JSON.stringify(data)}` },
      ], { maxTokens: 320 });
      await (this.prisma as any).aIUsageRecord.create({
        data: {
          organizationId,
          userId: "system",
          feature: "social_coach",
          provider: provider.name,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimated: result.tokensEstimated,
        },
      }).catch(() => undefined);
      const text = String(result.text ?? "").trim();
      if (!text) return { summary: deterministic, source: "deterministic", provider: provider.name };
      const bad = ungroundedNumbers(text, coachAllowedNumbers(data));
      if (bad.length > 0) {
        this.logger.warn(`social_coach narration discarded for org ${organizationId}: ungrounded numbers ${bad.join(", ")}`);
        return { summary: deterministic, source: "deterministic", provider: provider.name };
      }
      return { summary: text, source: "llm", provider: provider.name };
    } catch (e) {
      this.logger.warn(`social_coach narration unavailable for org ${organizationId}: ${e instanceof Error ? e.message : String(e)}`);
      return { summary: deterministic, source: "deterministic", provider: null };
    }
  }

  /** OWNER/ADMIN members get the digest notification — the
   * SU10 notifyFailed pattern, fully failure-isolated. */
  private async notifyOwners(organizationId: string, summary: string) {
    try {
      const members = await (this.prisma as any).membership.findMany({
        where: { organizationId, role: { in: ["OWNER", "ADMIN"] }, status: "active" },
      });
      for (const m of Array.isArray(members) ? members : []) {
        await (this.prisma as any).agentNotification.create({
          data: {
            organizationId,
            userId: m.userId,
            type: "social_coach_weekly",
            title: "সাপ্তাহিক Social Coach সারসংক্ষেপ",
            body: summary.slice(0, 500),
            conversationId: null,
          },
        }).catch(() => undefined);
      }
    } catch { /* a notification failure never fails the digest */ }
  }

  /**
   * The weekly digest run (the automation job's entry point).
   * Idempotent per (org, weekStart): an existing digest is
   * returned as-is — no new row, no new notifications. Creates
   * NO posts and publishes NOTHING.
   */
  async runWeeklyDigest(organizationId: string, actorId = "system") {
    const weekStart = await this.weekStartFor(organizationId);
    const existing = await (this.prisma as any).socialCoachDigest?.findFirst?.({
      where: { organizationId, weekStart },
    }).catch(() => null);
    if (existing) return { created: false, digest: this.serializeDigest(existing) };

    const data = await this.compute(organizationId);
    const narration = await this.narrate(organizationId, data);
    const payload = {
      data,
      summary: narration.summary,
      narration: { source: narration.source, provider: narration.provider },
    };
    let row: any;
    try {
      row = await (this.prisma as any).socialCoachDigest.create({
        data: { organizationId, weekStart, payload, narrationSource: narration.source },
      });
    } catch (e: any) {
      // Unique (org, weekStart) race — another run won; its
      // digest is the one of record.
      const winner = await (this.prisma as any).socialCoachDigest?.findFirst?.({
        where: { organizationId, weekStart },
      }).catch(() => null);
      if (winner) return { created: false, digest: this.serializeDigest(winner) };
      throw e;
    }
    await this.notifyOwners(organizationId, narration.summary);
    await this.audit.log({
      organizationId, userId: actorId, action: "social.coach_digest_created",
      entityType: "Organization", entityId: organizationId,
      metadata: { weekStart, narrationSource: narration.source },
    }).catch(() => undefined);
    return { created: true, digest: this.serializeDigest(row) };
  }
}
