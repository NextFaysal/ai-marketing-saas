import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const DAY_MS = 86_400_000;
const FEED_KINDS = ["proposal", "learned", "answer", "content"] as const;
type FeedKind = (typeof FEED_KINDS)[number];

type ActivityEvent = {
  id: string;
  kind: FeedKind;
  event: string;
  at: string;
  title: string;
  detail: string | null;
  sourceId: string;
  meta: Record<string, unknown>;
};

/**
 * SA-B25 (Smart AI Phase 6, plan T4): the tenant AI Activity
 * service — the unified activity feed + usage overview behind
 * the tenant "AI নিয়ন্ত্রণ" Control Center's Activity view.
 *
 * HONESTY RULES (the SA-B24 line, held):
 *  - Every feed event is expanded from a REAL persisted row
 *    and a REAL stamp on that row (createdAt / decidedAt /
 *    executedAt / reviewedAt, or updatedAt for the two
 *    terminal transitions — failed proposals and invalidated
 *    answers — where failed/invalidated is terminal, so
 *    updatedAt IS the moment it happened). No event is ever
 *    synthesised from a counter or a status alone.
 *  - Stored-answer HITS are counters only: AiStoredAnswer has
 *    no per-hit log (SA-B24 established this), so a hit NEVER
 *    becomes a feed row. hitCount rides as meta on the
 *    `captured` event, named as the cumulative counter it is.
 *  - Verbatim pass-throughs stay verbatim: a failed proposal's
 *    `error` and an invalidated answer's `invalidReason` are
 *    the event `detail`, exactly as recorded.
 *  - LearnedItem.reviewedVia is null on pre-SA-B23 rows; the
 *    feed carries that null through — a decision's venue is
 *    never invented for rows decided before it was stamped.
 *  - Usage aggregates ONLY AIUsageRecord rows in the window;
 *    the daily series lists days that actually have calls —
 *    no zero-filled days are fabricated to complete a chart.
 *  - Every query is organizationId-scoped; another org's rows
 *    can never enter this org's feed or usage.
 */
@Injectable()
export class AiActivityService {
  constructor(private readonly prisma: PrismaService) {}

  private db(): any {
    return this.prisma as any;
  }

  private parseDays(raw: string | number | null | undefined, allowed: number[], fallback: number): number {
    const days = raw === undefined || raw === null || raw === "" ? fallback : Number(raw);
    if (!allowed.includes(days)) {
      throw new BadRequestException(`days must be one of ${allowed.join(", ")}`);
    }
    return days;
  }

  private parseKind(raw: string | null | undefined): FeedKind | null {
    if (raw === undefined || raw === null || raw === "") return null;
    if (!(FEED_KINDS as readonly string[]).includes(raw)) {
      throw new BadRequestException(`kind must be one of ${FEED_KINDS.join(", ")}`);
    }
    return raw as FeedKind;
  }

  // ---------------- the unified feed ----------------

  async getFeed(
    organizationId: string,
    opts: { kind?: string | null; days?: string | number | null; limit?: number | null; offset?: number | null } = {},
  ) {
    const days = this.parseDays(opts.days, [7, 30, 90], 30);
    const kind = this.parseKind(opts.kind);
    const limit = Math.min(Math.max(Number.isFinite(opts.limit as number) ? (opts.limit as number) : 50, 1), 100);
    const offset = Math.min(Math.max(Number.isFinite(opts.offset as number) ? (opts.offset as number) : 0, 0), 5000);
    const since = new Date(Date.now() - days * DAY_MS);
    const take = offset + limit;
    const db = this.db();

    const events: ActivityEvent[] = [];
    let total = 0;
    const push = (e: Omit<ActivityEvent, "id">) => {
      events.push({ ...e, id: `${e.kind}:${e.event}:${e.sourceId}` });
    };
    const stamp = (v: any) => new Date(v).toISOString();

    // ---- proposals (AIActionProposal) ----
    if (!kind || kind === "proposal") {
      const filedWhere = { organizationId, createdAt: { gte: since } };
      const decidedWhere = { organizationId, decidedAt: { not: null, gte: since } };
      const executedWhere = { organizationId, executedAt: { not: null, gte: since } };
      const failedWhere = { organizationId, status: "failed", updatedAt: { gte: since } };
      const [filed, decided, executed, failed, filedCount, decidedCount, executedCount, failedCount] = await Promise.all([
        db.aIActionProposal.findMany({ where: filedWhere, orderBy: { createdAt: "desc" }, take }),
        db.aIActionProposal.findMany({ where: decidedWhere, orderBy: { decidedAt: "desc" }, take }),
        db.aIActionProposal.findMany({ where: executedWhere, orderBy: { executedAt: "desc" }, take }),
        db.aIActionProposal.findMany({ where: failedWhere, orderBy: { updatedAt: "desc" }, take }),
        db.aIActionProposal.count({ where: filedWhere }),
        db.aIActionProposal.count({ where: decidedWhere }),
        db.aIActionProposal.count({ where: executedWhere }),
        db.aIActionProposal.count({ where: failedWhere }),
      ]);
      total += filedCount + decidedCount + executedCount + failedCount;
      for (const r of filed as any[]) {
        push({
          kind: "proposal", event: "filed", at: stamp(r.createdAt), title: r.title, detail: null, sourceId: r.id,
          meta: {
            actionId: r.actionId ?? null,
            surface: r.surface ?? null,
            proposedBy: r.proposedBy ?? null,
            status: r.status,
            via: (r.sourceRef as any)?.via ?? null,
          },
        });
      }
      for (const r of decided as any[]) {
        push({
          kind: "proposal", event: "decided", at: stamp(r.decidedAt), title: r.title, detail: null, sourceId: r.id,
          meta: {
            decision: r.status === "rejected" ? "rejected" : "approved",
            proposalOnly: (r.result as any)?.outcome === "proposal_only",
            decidedById: r.decidedById ?? null,
          },
        });
      }
      for (const r of executed as any[]) {
        push({
          kind: "proposal", event: "executed", at: stamp(r.executedAt), title: r.title, detail: null, sourceId: r.id,
          meta: { actionId: r.actionId ?? null },
        });
      }
      for (const r of failed as any[]) {
        push({
          kind: "proposal", event: "failed", at: stamp(r.updatedAt), title: r.title, detail: r.error ?? null, sourceId: r.id,
          meta: { actionId: r.actionId ?? null },
        });
      }
    }

    // ---- learned items (LearnedItem) ----
    if (!kind || kind === "learned") {
      const suggestedWhere = { organizationId, createdAt: { gte: since } };
      const decidedWhere = { organizationId, status: { in: ["approved", "rejected"] }, reviewedAt: { not: null, gte: since } };
      const [suggested, decided, suggestedCount, decidedCount] = await Promise.all([
        db.learnedItem.findMany({ where: suggestedWhere, orderBy: { createdAt: "desc" }, take }),
        db.learnedItem.findMany({ where: decidedWhere, orderBy: { reviewedAt: "desc" }, take }),
        db.learnedItem.count({ where: suggestedWhere }),
        db.learnedItem.count({ where: decidedWhere }),
      ]);
      total += suggestedCount + decidedCount;
      for (const r of suggested as any[]) {
        push({
          kind: "learned", event: "suggested", at: stamp(r.createdAt), title: r.title, detail: null, sourceId: r.id,
          meta: { itemKind: r.kind, sourceType: r.sourceType },
        });
      }
      for (const r of decided as any[]) {
        push({
          kind: "learned", event: "decided", at: stamp(r.reviewedAt), title: r.title, detail: null, sourceId: r.id,
          meta: {
            decision: r.status,
            reviewedVia: r.reviewedVia ?? null,
            appliedRef: r.appliedRef ?? null,
          },
        });
      }
    }

    // ---- stored answers (AiStoredAnswer) ----
    if (!kind || kind === "answer") {
      const capturedWhere = { organizationId, createdAt: { gte: since } };
      const invalidatedWhere = { organizationId, status: "invalidated", updatedAt: { gte: since } };
      const [captured, invalidated, capturedCount, invalidatedCount] = await Promise.all([
        db.aiStoredAnswer.findMany({ where: capturedWhere, orderBy: { createdAt: "desc" }, take }),
        db.aiStoredAnswer.findMany({ where: invalidatedWhere, orderBy: { updatedAt: "desc" }, take }),
        db.aiStoredAnswer.count({ where: capturedWhere }),
        db.aiStoredAnswer.count({ where: invalidatedWhere }),
      ]);
      total += capturedCount + invalidatedCount;
      for (const r of captured as any[]) {
        push({
          kind: "answer", event: "captured", at: stamp(r.createdAt), title: r.questionText, detail: null, sourceId: r.id,
          meta: { channel: r.channel, origin: r.origin, hitCount: r.hitCount },
        });
      }
      for (const r of invalidated as any[]) {
        push({
          kind: "answer", event: "invalidated", at: stamp(r.updatedAt), title: r.questionText, detail: r.invalidReason ?? null, sourceId: r.id,
          meta: { channel: r.channel, origin: r.origin },
        });
      }
    }

    // ---- AI content drafts (SocialPost, SA-B19-stamped) ----
    if (!kind || kind === "content") {
      const where = { organizationId, autoDraftKind: "ai_content", createdAt: { gte: since } };
      const [drafts, draftCount] = await Promise.all([
        db.socialPost.findMany({ where, orderBy: { createdAt: "desc" }, take }),
        db.socialPost.count({ where }),
      ]);
      total += draftCount;
      for (const r of drafts as any[]) {
        push({
          kind: "content", event: "draft_created", at: stamp(r.createdAt), title: String(r.caption ?? "").slice(0, 120), detail: null, sourceId: r.id,
          meta: { autoDraftRef: r.autoDraftRef ?? null, status: r.status },
        });
      }
    }

    events.sort((a, b) => (a.at !== b.at ? b.at.localeCompare(a.at) : b.id.localeCompare(a.id)));

    return {
      items: events.slice(offset, offset + limit),
      total,
      limit,
      offset,
      days,
      kind,
    };
  }

  // ---------------- usage overview ----------------

  async getUsage(
    organizationId: string,
    opts: { days?: string | number | null } = {},
  ) {
    const days = this.parseDays(opts.days, [7, 30], 30);
    const since = new Date(Date.now() - days * DAY_MS);
    const rows: any[] = await this.db().aIUsageRecord.findMany({
      where: { organizationId, createdAt: { gte: since } },
      select: { feature: true, createdAt: true, inputTokens: true, outputTokens: true, estimated: true },
    });

    const totals = { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCalls: 0 };
    const featureMap = new Map<string, { feature: string; calls: number; inputTokens: number; outputTokens: number; estimatedCalls: number }>();
    const dailyMap = new Map<string, { date: string; calls: number; inputTokens: number; outputTokens: number }>();
    for (const r of rows) {
      const input = Number(r.inputTokens ?? 0) || 0;
      const output = Number(r.outputTokens ?? 0) || 0;
      totals.calls += 1;
      totals.inputTokens += input;
      totals.outputTokens += output;
      if (r.estimated) totals.estimatedCalls += 1;

      const f = featureMap.get(r.feature) ?? { feature: r.feature, calls: 0, inputTokens: 0, outputTokens: 0, estimatedCalls: 0 };
      f.calls += 1;
      f.inputTokens += input;
      f.outputTokens += output;
      if (r.estimated) f.estimatedCalls += 1;
      featureMap.set(r.feature, f);

      const date = new Date(r.createdAt).toISOString().slice(0, 10);
      const d = dailyMap.get(date) ?? { date, calls: 0, inputTokens: 0, outputTokens: 0 };
      d.calls += 1;
      d.inputTokens += input;
      d.outputTokens += output;
      dailyMap.set(date, d);
    }

    return {
      days,
      since: since.toISOString(),
      totals,
      features: [...featureMap.values()].sort((a, b) => b.calls - a.calls || a.feature.localeCompare(b.feature)),
      daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
}
