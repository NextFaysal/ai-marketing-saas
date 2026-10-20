import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SocialService } from "./social.service";
import { computeBestTime, engagementScore } from "./social-insights.service";
import { computeNextBestTime, computeNextSlot } from "./social-queue-helpers";
import type { CreateSocialPostingSlotDto, UpdateEvergreenDto, UpdateSocialPostingSlotDto } from "./social.dto";
import { badRequest, conflict, notFound } from "../i18n/api-exception";

// SU2: re-exported so callers/tests can reach the pure helpers
// through the queue service module as well.
export { computeNextSlot, computeNextBestTime, addInterval } from "./social-queue-helpers";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * SU2 — Queue slots, Add-to-Queue, best-time scheduling and the
 * evergreen recycle sweep.
 *
 * Scheduling itself is NEVER duplicated here: addToQueue and
 * scheduleBestTime both delegate to SocialService.schedulePost,
 * so approval gates and SU1 pre-flight apply exactly once, in the
 * one place they already live.
 */
@Injectable()
export class SocialQueueService {
  private readonly logger = new Logger(SocialQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly social: SocialService,
  ) {}

  private serializeSlot(row: any) {
    if (!row) return row;
    return {
      id: row.id, socialAccountId: row.socialAccountId,
      weekday: row.weekday, time: row.time, enabled: row.enabled ?? true,
      createdById: row.createdById, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private async orgTimezone(organizationId: string): Promise<string> {
    const org = await (this.prisma as any).organization?.findFirst?.({
      where: { id: organizationId },
    }).catch(() => null);
    return org?.timezone || "Asia/Dhaka";
  }

  private async getPostRow(organizationId: string, postId: string) {
    const post = await (this.prisma as any).socialPost.findFirst({ where: { id: postId, organizationId } });
    if (!post) throw notFound("social.socialPostNotFoundInThis");
    return post;
  }

  private validateSlotFields(weekday: unknown, time: unknown): void {
    if (weekday !== undefined && (!Number.isInteger(weekday) || (weekday as number) < 0 || (weekday as number) > 6)) {
      throw badRequest("social.theDayOfTheWeekMust");
    }
    if (time !== undefined && (typeof time !== "string" || !TIME_RE.test(time))) {
      throw badRequest("social.slotHhMm1030");
    }
  }

  // ---------- slots CRUD ----------

  async listSlots(organizationId: string) {
    const rows = await (this.prisma as any).socialPostingSlot.findMany({
      where: { organizationId }, orderBy: { createdAt: "asc" },
    });
    return (Array.isArray(rows) ? rows : []).map((r: any) => this.serializeSlot(r));
  }

  async createSlot(organizationId: string, actorId: string, dto: CreateSocialPostingSlotDto) {
    this.validateSlotFields(dto.weekday, dto.time);
    const account = await (this.prisma as any).socialAccount.findFirst({
      where: { id: dto.socialAccountId, organizationId },
    });
    if (!account) throw notFound("social.socialAccountNotFoundInThis");
    const dup = await (this.prisma as any).socialPostingSlot.findFirst({
      where: {
        organizationId, socialAccountId: dto.socialAccountId,
        weekday: dto.weekday, time: dto.time,
      },
    });
    if (dup) throw conflict("social.aSlotAlreadyExistsForThis");
    const row = await (this.prisma as any).socialPostingSlot.create({
      data: {
        organizationId, socialAccountId: dto.socialAccountId,
        weekday: dto.weekday, time: dto.time,
        enabled: dto.enabled ?? true, createdById: actorId,
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.posting_slot_created",
      entityType: "SocialPostingSlot", entityId: row.id,
      metadata: { socialAccountId: dto.socialAccountId, weekday: dto.weekday, time: dto.time },
    });
    return this.serializeSlot(row);
  }

  private async getSlotRow(organizationId: string, slotId: string) {
    const row = await (this.prisma as any).socialPostingSlot.findFirst({ where: { id: slotId, organizationId } });
    if (!row) throw notFound("social.postingSlotNotFoundInThis");
    return row;
  }

  async updateSlot(organizationId: string, actorId: string, slotId: string, dto: UpdateSocialPostingSlotDto) {
    const row = await this.getSlotRow(organizationId, slotId);
    this.validateSlotFields(dto.weekday, dto.time);
    const weekday = dto.weekday ?? row.weekday;
    const time = dto.time ?? row.time;
    if (weekday !== row.weekday || time !== row.time) {
      const dup = await (this.prisma as any).socialPostingSlot.findFirst({
        where: { organizationId, socialAccountId: row.socialAccountId, weekday, time },
      });
      if (dup && dup.id !== row.id) {
        throw conflict("social.aSlotAlreadyExistsForThis");
      }
    }
    const data: Record<string, unknown> = {};
    if (dto.weekday !== undefined) data.weekday = dto.weekday;
    if (dto.time !== undefined) data.time = dto.time;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    const updated = await (this.prisma as any).socialPostingSlot.update({ where: { id: row.id }, data });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.posting_slot_updated",
      entityType: "SocialPostingSlot", entityId: row.id, metadata: { fields: Object.keys(data) },
    });
    return this.serializeSlot(updated);
  }

  async deleteSlot(organizationId: string, actorId: string, slotId: string) {
    const row = await this.getSlotRow(organizationId, slotId);
    await (this.prisma as any).socialPostingSlot.delete({ where: { id: row.id } });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.posting_slot_deleted",
      entityType: "SocialPostingSlot", entityId: row.id, metadata: {},
    });
    return { deleted: true, id: row.id };
  }

  // ---------- queue actions ----------

  /** SU2: put a post into the next free posting slot of its
   * account (approval + pre-flight run inside schedulePost). */
  async addToQueue(organizationId: string, actorId: string, postId: string) {
    const post = await this.getPostRow(organizationId, postId);
    if (!["draft", "scheduled", "failed"].includes(post.status)) {
      throw conflict("social.thePostCannotBeQueuedIn", { postStatus: post.status });
    }
    const timeZone = await this.orgTimezone(organizationId);
    const slotRows = await (this.prisma as any).socialPostingSlot.findMany({
      where: { organizationId, socialAccountId: post.socialAccountId, enabled: true },
    }).catch(() => []);
    const slots = Array.isArray(slotRows) ? slotRows : [];
    if (slots.length === 0) {
      throw badRequest("social.thereIsNoPostingSlotFor");
    }
    const scheduledRows = await (this.prisma as any).socialPost.findMany({
      where: { organizationId, socialAccountId: post.socialAccountId, status: "scheduled" },
    }).catch(() => []);
    const occupied = (Array.isArray(scheduledRows) ? scheduledRows : [])
      .map((p: any) => p.scheduledAt)
      .filter(Boolean)
      .map((d: any) => new Date(d));
    const next = computeNextSlot(slots, occupied, new Date(), timeZone);
    if (!next) {
      throw badRequest("social.noFreePostingSlotWasFound");
    }
    return this.social.schedulePost(organizationId, actorId, postId, { scheduledAt: next.toISOString() });
  }

  /** SU2: one-click schedule at the org's own best time (SP7
   * heuristic; below the evidence threshold this is an honest
   * Bengali 400 carrying the actual scored-post count). */
  async scheduleBestTime(organizationId: string, actorId: string, postId: string) {
    await this.getPostRow(organizationId, postId);
    const timeZone = await this.orgTimezone(organizationId);
    const rows = await (this.prisma as any).socialPost.findMany({
      where: { organizationId, status: "published" }, take: 500,
    }).catch(() => []);
    const posts = Array.isArray(rows) ? rows : [];
    const scored = posts.filter((p: any) => engagementScore(p?.insights) !== null && p?.publishedAt).length;
    const best = computeBestTime(
      posts.map((p: any) => ({ publishedAt: p.publishedAt, insights: p.insights })),
      timeZone,
    );
    if (!best) {
      const bn = String(scored).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
      throw badRequest("social.thereIsNotEnoughDataTo", { bn: bn });
    }
    const next = computeNextBestTime(best, new Date(), timeZone);
    return this.social.schedulePost(organizationId, actorId, postId, { scheduledAt: next.toISOString() });
  }

  // ---------- evergreen ----------

  /** SU2: set/clear a post's evergreen config (any status). */
  async setEvergreen(organizationId: string, actorId: string, postId: string, dto: UpdateEvergreenDto) {
    const post = await this.getPostRow(organizationId, postId);
    const data: Record<string, unknown> = { isEvergreen: dto.isEvergreen === true };
    if (dto.evergreenMinGapDays !== undefined) data.evergreenMinGapDays = dto.evergreenMinGapDays;
    if (dto.evergreenMaxCycles !== undefined) data.evergreenMaxCycles = dto.evergreenMaxCycles;
    await (this.prisma as any).socialPost.update({ where: { id: post.id }, data });
    await this.audit.log({
      organizationId, userId: actorId, action: "social.post_evergreen_updated",
      entityType: "SocialPost", entityId: post.id,
      metadata: { isEvergreen: data.isEvergreen, fields: Object.keys(data) },
    });
    // Serialized through SocialService's public read path.
    return this.social.getPost(organizationId, postId);
  }

  /**
   * SU2 — evergreen sweep for one org: each published evergreen
   * post whose minimum gap has passed (and whose cycle cap is not
   * reached) is CLAIMED with a status-conditioned updateMany
   * (cyclesUsed + lastRecycledAt) and only then cloned as a fresh
   * DRAFT — recycling never publishes anything by itself. A claim
   * that lands 0 rows means another run already recycled it.
   */
  async runEvergreenSweep(organizationId: string): Promise<{ scanned: number; recycled: number; skipped: number }> {
    const candidates = await (this.prisma as any).socialPost.findMany({
      where: { organizationId, status: "published", isEvergreen: true },
    }).catch(() => []);
    const rows = Array.isArray(candidates) ? candidates : [];
    const now = new Date();
    let recycled = 0;
    let skipped = 0;
    for (const candidate of rows) {
      try {
        const gap = candidate.evergreenMinGapDays;
        if (gap === null || gap === undefined || !candidate.publishedAt) { skipped++; continue; }
        const dueAt = new Date(new Date(candidate.publishedAt).getTime() + gap * 86_400_000);
        if (dueAt.getTime() > now.getTime()) { skipped++; continue; }
        const cyclesUsed = candidate.evergreenCyclesUsed ?? 0;
        if (candidate.evergreenMaxCycles !== null && candidate.evergreenMaxCycles !== undefined && cyclesUsed >= candidate.evergreenMaxCycles) {
          skipped++; continue;
        }
        const claim = await (this.prisma as any).socialPost.updateMany({
          where: { id: candidate.id, evergreenLastRecycledAt: null, evergreenCyclesUsed: cyclesUsed },
          data: { evergreenCyclesUsed: cyclesUsed + 1, evergreenLastRecycledAt: now },
        }).catch(() => null);
        if (!claim?.count) { skipped++; continue; }
        const firstCommentText = candidate.firstCommentText ?? null;
        await (this.prisma as any).socialPost.create({
          data: {
            organizationId, socialAccountId: candidate.socialAccountId,
            caption: candidate.caption, linkUrl: candidate.linkUrl ?? null,
            mediaRefs: Array.isArray(candidate.mediaRefs) ? candidate.mediaRefs : [],
            status: "draft", createdById: candidate.createdById,
            firstCommentText, firstCommentStatus: firstCommentText ? "pending" : null,
            isEvergreen: true,
            evergreenMinGapDays: gap, evergreenMaxCycles: candidate.evergreenMaxCycles ?? null,
            evergreenCyclesUsed: cyclesUsed + 1, evergreenLastRecycledAt: null,
            attempts: 0,
          },
        });
        recycled++;
        await this.audit.log({
          organizationId, userId: candidate.createdById, action: "social.evergreen_recycled",
          entityType: "SocialPost", entityId: candidate.id,
          metadata: { cyclesUsed: cyclesUsed + 1 },
        }).catch(() => undefined);
        await this.notifyEvergreenRecycled(candidate).catch(() => undefined);
      } catch (e) {
        skipped++;
        this.logger.warn(`evergreen recycle failed for post ${candidate?.id}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }
    return { scanned: rows.length, recycled, skipped };
  }

  /** Failure-isolated OWNER/ADMIN notification (publish
   * service's notifyFailed pattern). Never throws. */
  private async notifyEvergreenRecycled(post: any): Promise<void> {
    try {
      const memberships = await (this.prisma as any).membership.findMany({
        where: { organizationId: post.organizationId, status: "ACTIVE" }, take: 200,
      }).catch(() => []);
      const recipients = [...new Set((Array.isArray(memberships) ? memberships : [])
        .filter((m: any) => ["OWNER", "ADMIN"].includes(m.role))
        .map((m: any) => m.userId as string))];
      if (recipients.length === 0) return;
      const caption = String(post.caption ?? "");
      const excerpt = caption.length > 120 ? caption.slice(0, 120) : caption;
      const title = "Evergreen পোস্ট আবার Draft হিসেবে তোলা হয়েছে";
      const body = `${excerpt}\nEvergreen নিয়ম অনুযায়ী পোস্টটির একটি নতুন Draft তৈরি হয়েছে — যাচাই করে শিডিউল বা প্রকাশ করুন। নিজে থেকে কিছু প্রকাশ হয়নি।`;
      for (const userId of recipients) {
        await (this.prisma as any).agentNotification.create({
          data: { organizationId: post.organizationId, userId, type: "social_evergreen_recycled", title, body, conversationId: null },
        }).catch(() => undefined);
      }
    } catch (e) {
      this.logger.warn(`evergreen notification failed for post ${post?.id}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }
}
