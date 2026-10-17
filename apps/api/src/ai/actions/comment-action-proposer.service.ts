import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { EventsService } from "../../common/events.service";
import { ActionEngineService } from "./action-engine.service";

/**
 * SA-B12 (Smart AI Phase 2, W3) — the AI proposers for comment
 * actions: deterministic triggers ONLY (no LLM anywhere invents
 * an action). SocialCommentsService announces two real moments
 * on the global event bus; this service turns each into an
 * engine proposal (proposedBy "ai"), and the ENGINE — autonomy
 * level, open-proposal dedupe, approval, verification, audit —
 * decides what happens next. The split keeps the wiring free
 * of any DI cycle (the B10 leaf-module discipline) and keeps
 * every trigger fire-and-forget: the bus isolates handler
 * failures, and each handler additionally swallows the engine's
 * expected refusals (a builder rejecting a stale target is a
 * normal outcome, not an error).
 *
 * Trigger map (Step-0 record in docs/smart-ai-b12-acceptance.md):
 *  E. "comment.spam_flagged" (ingest classified the comment
 *     SPAM) → when the SAME author (authorSocialId) reaches
 *     REPEAT_SPAM_AUTHOR_THRESHOLD spam-classified comments in
 *     the org, propose delete_comment for the newest one.
 *     The pipeline already HIDES spam itself at ingest
 *     (autoHideSpam + Graph auto-hide) — a hide proposal would
 *     duplicate a performed act, so it is never proposed;
 *     deletion is the stronger act the pipeline never takes.
 *     No comment-side author-block action exists in the
 *     service or the catalog — none is invented here.
 *  F. "comment.dm_followup_needed" (a COMPLAINT comment's
 *     public reply — the humanizer's invite-to-inbox case —
 *     was posted, but the drafted private reply was NOT sent:
 *     org setting off, or the Graph DM attempt failed) →
 *     propose send_dm_to_commenter carrying the plan's own
 *     drafted DM text, for a human to approve. The text is the
 *     system's own draft (staff see it verbatim in the
 *     preview); it contains none of the commenter's personal
 *     facts — it ASKS the customer for their details, exactly
 *     like the humanizer's complaint DM (L3 preview
 *     discipline: author name + the public comment + the DM
 *     text, nothing from memory or orders).
 *
 * Deliberately NOT wired — Trigger D (guard-blocked reply):
 * a comment whose autopilot reply the SA-B8 number guard
 * blocked already sits PENDING in the moderation queue with
 * the rejection recorded on it (metadata.graph.guardBlocked +
 * the social_comments.guard_rejected audit) — that queue IS
 * the human path. An engine reply_to_comment proposal must
 * carry executable text; the only grounded text (the model's)
 * is precisely what the guard rejected, and the execution-time
 * guard would reject it again — a proposal designed to fail is
 * noise, not a path. Full reasoning in the acceptance doc.
 */

/** How many spam-classified comments from one author (by
 *  authorSocialId, org-wide, all-time row count) trigger a
 *  delete proposal for the newest one. No moderation setting
 *  exists for repeat offenders (SocialReplySetting carries
 *  bannedKeywords / autoHideSpam only) — this conservative
 *  named constant is the rule until one does. */
export const REPEAT_SPAM_AUTHOR_THRESHOLD = 3;

@Injectable()
export class CommentActionProposerService implements OnModuleInit {
  constructor(
    private readonly engine: ActionEngineService,
    private readonly events: EventsService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.events.on("comment.spam_flagged", (payload) => this.onSpamFlagged(payload));
    this.events.on("comment.dm_followup_needed", (payload) => this.onDmFollowupNeeded(payload));
  }

  private p(): any {
    return this.prisma as any;
  }

  /** propose() with the proposer's failure discipline: typed
   *  refusals (autonomy off, dedupe hit) are results, builder
   *  rejections of stale targets are expected — nothing here may
   *  ever surface into comment handling. */
  private async proposeQuietly(
    organizationId: string,
    actionId: string,
    payload: Record<string, unknown>,
    sourceRef: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.engine.propose(organizationId, actionId, payload, {
        proposedBy: "ai",
        actorUserId: null,
        sourceRef,
      });
    } catch {
      /* a stale target (deleted / already DM'd since the event)
         simply yields no proposal — recorded by design */
    }
  }

  // Trigger E — a repeat spam author crosses the threshold.
  async onSpamFlagged(payload: any): Promise<void> {
    const organizationId = payload?.organizationId;
    const commentId = payload?.context?.commentId;
    const authorSocialId = payload?.context?.authorSocialId;
    if (typeof organizationId !== "string" || !organizationId) return;
    if (typeof commentId !== "string" || !commentId) return;
    // Author identity is the social id — without one there is
    // no reliable "same author" to count (names are neither
    // unique nor stable), so the trigger stays silent.
    if (typeof authorSocialId !== "string" || !authorSocialId) return;
    const spamCount = await this.p().socialComment
      .count({ where: { organizationId, authorSocialId, sentiment: "SPAM" } })
      .catch(() => 0);
    if (!spamCount || spamCount < REPEAT_SPAM_AUTHOR_THRESHOLD) return;
    await this.proposeQuietly(
      organizationId,
      "delete_comment",
      { commentId },
      { trigger: "repeat_spam_author", authorSocialId, spamCount },
    );
  }

  // Trigger F — the complaint DM follow-through that did not happen.
  async onDmFollowupNeeded(payload: any): Promise<void> {
    const organizationId = payload?.organizationId;
    const commentId = payload?.context?.commentId;
    const privateDmText = payload?.context?.privateDmText;
    if (typeof organizationId !== "string" || !organizationId) return;
    if (typeof commentId !== "string" || !commentId) return;
    if (typeof privateDmText !== "string" || !privateDmText.trim()) return;
    await this.proposeQuietly(
      organizationId,
      "send_dm_to_commenter",
      { commentId, message: privateDmText },
      { trigger: "dm_followup_complaint" },
    );
  }
}
