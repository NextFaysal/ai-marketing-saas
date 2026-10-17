import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { formatMinor } from "@repo/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { InboxService, normalizeTags } from "../../inbox/inbox.service";
import { SocialCommentsService } from "../../inbox/social-comments.service";
import { CampaignsService } from "../../campaigns/campaigns.service";
import { PublishingService } from "../../publishing/publishing.service";

/**
 * SA-B10 (Smart AI Phase 2, W1) — action builders / executors /
 * verifiers for the Action Engine.
 *
 * A BUILDER validates a proposal against real rows (org-scoped)
 * and renders the exact title + preview a human will approve —
 * it executes NOTHING (the Milestone-47 discipline).
 * An EXECUTOR performs the act through the EXISTING staff
 * service path — never a parallel write.
 * A VERIFIER re-reads the real state afterwards; the engine
 * records success only when the verifier agrees (plan law L5).
 *
 * SA-B10 registered the two reference actions end-to-end
 * (close_conversation, hide_comment) plus the proposal-only
 * request_refund builder (money-adjacent: no executor/verifier
 * exist for it, by law). SA-B11 (W2) registers the remaining
 * inbox set below (assign / tag / reopen / mark-spam / block);
 * SA-B12 (W3) registers the remaining comment set (unhide /
 * reply / DM / delete) at the bottom of this file.
 */

export interface BuiltAction {
  title: string;
  preview: string;
  /** Server-normalized payload stored on the proposal row. */
  payload: Record<string, unknown>;
  conversationId?: string | null;
}

export type ActionBuilder = (organizationId: string, payload: any) => Promise<BuiltAction>;
export type ActionExecutor = (organizationId: string, actorId: string, payload: any) => Promise<Record<string, unknown>>;
export interface VerificationOutcome {
  verified: boolean;
  detail: Record<string, unknown>;
}
export type ActionVerifier = (organizationId: string, payload: any, result: any) => Promise<VerificationOutcome>;

function reqString(payload: any, field: string): string {
  const v = payload?.[field];
  if (typeof v !== "string" || !v.trim()) throw new BadRequestException(`${field} is required`);
  return v.trim();
}

@Injectable()
export class ActionExecutorsService {
  /** Keyed by catalog action id. */
  readonly builders = new Map<string, ActionBuilder>();
  /** Keyed by catalog executorKey. */
  readonly executors = new Map<string, ActionExecutor>();
  /** Keyed by catalog verifierKey. */
  readonly verifiers = new Map<string, ActionVerifier>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly socialComments: SocialCommentsService,
    // SA-B15 (A2): the hub services the ads executors ride.
    // Optional so existing constructions (specs, other modules)
    // keep working — the ads builders/executors refuse honestly
    // when a service is absent, never fall back to a fake path.
    @Optional() private readonly campaigns?: CampaignsService,
    @Optional() private readonly publishing?: PublishingService,
  ) {
    this.registerCloseConversation();
    this.registerHideComment();
    this.registerRequestRefund();
    // SA-B11 (W2): the remaining inbox set.
    this.registerAssignConversation();
    this.registerTagConversation();
    this.registerReopenConversation();
    this.registerMarkConversationSpam();
    this.registerBlockSender();
    // SA-B12 (W3): the remaining comment set.
    this.registerUnhideComment();
    this.registerReplyToComment();
    this.registerSendDmToCommenter();
    this.registerDeleteComment();
    // SA-B15 (A2): the ads set.
    this.registerAdsPauseResume();
    this.registerSetCampaignBudget();
  }

  private p(): any {
    return this.prisma as any;
  }

  // ---------- reference action 1: inbox / close_conversation ----------
  private registerCloseConversation() {
    this.builders.set("close_conversation", async (organizationId, payload) => {
      const conversationId = reqString(payload, "conversationId");
      const conv = await this.p().channelConversation.findFirst({ where: { id: conversationId, organizationId } });
      if (!conv) throw new NotFoundException("Conversation not found in this organization");
      if (conv.status === "closed") throw new BadRequestException("এই কথোপকথনটি ইতিমধ্যে বন্ধ আছে — বন্ধ করার কিছু নেই।");
      const who = conv.contactName ?? conv.externalContactId ?? conv.id;
      return {
        title: `কথোপকথন বন্ধ: ${who}`,
        preview: `অনুমোদন দিলে “${who}”-এর কথোপকথনটি বন্ধ (closed) করা হবে — InboxService-এর স্বাভাবিক পথে, ঠিক যেভাবে টিম নিজে বন্ধ করে। আবার খোলা যাবে (reopen একটি আলাদা কাজ)। এখনো কিছুই করা হয়নি।`,
        payload: { conversationId: conv.id },
        conversationId: conv.id,
      };
    });
    this.executors.set("inbox.close_conversation", async (organizationId, actorId, payload) => {
      const updated: any = await this.inbox.updateConversation(organizationId, actorId, payload.conversationId, { status: "closed" });
      return { conversationId: payload.conversationId, status: updated?.status ?? null };
    });
    this.verifiers.set("inbox.close_conversation.verify", async (organizationId, payload) => {
      const conv = await this.p().channelConversation.findFirst({ where: { id: payload.conversationId, organizationId } });
      return {
        verified: !!conv && conv.status === "closed",
        detail: { conversationId: payload.conversationId, observedStatus: conv?.status ?? null },
      };
    });
  }

  // ---------- reference action 2: comment / hide_comment ----------
  private registerHideComment() {
    this.builders.set("hide_comment", async (organizationId, payload) => {
      const commentId = reqString(payload, "commentId");
      const comment = await this.p().socialComment.findFirst({ where: { id: commentId, organizationId } });
      if (!comment) throw new NotFoundException("Comment not found in this organization");
      if (comment.status === "HIDDEN") throw new BadRequestException("এই কমেন্টটি ইতিমধ্যে লুকানো আছে — লুকানোর কিছু নেই।");
      const author = comment.authorName ?? "অজানা";
      const snippet = String(comment.commentText ?? "").slice(0, 120);
      return {
        title: `কমেন্ট লুকানো: ${author}`,
        preview: `অনুমোদন দিলে ${comment.platform}-এ “${author}”-এর কমেন্টটি (“${snippet}”) platform-এ লুকানো হবে — আগে Meta Graph নিশ্চিত করবে, তারপরই local status বদলাবে। আবার দেখানো যাবে (unhide একটি আলাদা কাজ)। এখনো কিছুই করা হয়নি।`,
        payload: { commentId: comment.id },
      };
    });
    this.executors.set("comment.hide_comment", async (organizationId, _actorId, payload) => {
      const updated: any = await this.socialComments.updateCommentStatus(organizationId, payload.commentId, "HIDDEN");
      return { commentId: payload.commentId, status: updated?.status ?? null };
    });
    this.verifiers.set("comment.hide_comment.verify", async (organizationId, payload) => {
      const comment = await this.p().socialComment.findFirst({ where: { id: payload.commentId, organizationId } });
      return {
        verified: !!comment && comment.status === "HIDDEN",
        detail: { commentId: payload.commentId, observedStatus: comment?.status ?? null },
      };
    });
  }

  // ---------- proposal-only: inbox / request_refund ----------
  // Money-adjacent (L5): a builder exists so the request can be
  // proposed + approved as a recorded decision, but NO executor
  // or verifier is ever registered — the engine refuses to
  // execute it at every autonomy level.
  private registerRequestRefund() {
    this.builders.set("request_refund", async (organizationId, payload) => {
      const conversationId = reqString(payload, "conversationId");
      const reason = typeof payload?.reason === "string" ? payload.reason.trim().slice(0, 500) : "";
      if (!reason) throw new BadRequestException("রিফান্ডের অনুরোধে একটি কারণ (reason) দরকার");
      const conv = await this.p().channelConversation.findFirst({ where: { id: conversationId, organizationId } });
      if (!conv) throw new NotFoundException("Conversation not found in this organization");
      let order: any = null;
      if (payload?.orderId !== undefined && payload?.orderId !== null) {
        const orderId = reqString(payload, "orderId");
        order = await this.p().order.findFirst({ where: { id: orderId, organizationId } });
        if (!order) throw new NotFoundException("Order not found in this organization");
      }
      const who = conv.contactName ?? conv.externalContactId ?? conv.id;
      return {
        title: `রিফান্ডের অনুরোধ: ${who}`,
        preview: `এটি শুধুমাত্র একটি প্রস্তাব। অনুমোদন মানে সিদ্ধান্তটি রেকর্ড হবে — রিফান্ড AI কার্যকর করবে না (আইন L5)। রিফান্ড দিতে হলে টিমকে বিদ্যমান staff refund-request পথে নিজে করতে হবে। কারণ: “${reason}”${order ? `, অর্ডার: ${order.id}` : ""}। এখনো কিছুই করা হয়নি।`,
        payload: { conversationId: conv.id, ...(order ? { orderId: order.id } : {}), reason },
        conversationId: conv.id,
      };
    });
  }

  // =====================================================================
  // SA-B11 (W2) — the remaining inbox set. Every executor calls the
  // SAME InboxService method the dashboard calls; every verifier
  // re-reads the conversation row (L5).
  // =====================================================================

  private async conversationOrThrow(organizationId: string, payload: any) {
    const conversationId = reqString(payload, "conversationId");
    const conv = await this.p().channelConversation.findFirst({ where: { id: conversationId, organizationId } });
    if (!conv) throw new NotFoundException("Conversation not found in this organization");
    return conv;
  }

  // ---------- inbox / assign_conversation ----------
  // Membership validation is NOT duplicated here: the staff path
  // itself (updateConversation) refuses a non-member assignee
  // ("Assignee is not a member of this organization"), so an
  // invalid assignee surfaces at execution as a FAILED proposal
  // with the service's error verbatim — recorded, never a crash,
  // and the assignment itself never happens.
  private registerAssignConversation() {
    this.builders.set("assign_conversation", async (organizationId, payload) => {
      const conv = await this.conversationOrThrow(organizationId, payload);
      const raw = payload?.assignedUserId;
      if (raw !== undefined && raw !== null && (typeof raw !== "string" || !raw.trim())) {
        throw new BadRequestException("assignedUserId must be a user id string or null (unassign)");
      }
      const assignedUserId = typeof raw === "string" && raw.trim() ? raw.trim() : null;
      const who = conv.contactName ?? conv.externalContactId ?? conv.id;
      let assigneeLabel = "কেউ নয় (আনঅ্যাসাইন)";
      let memberNote = "";
      if (assignedUserId) {
        const member = await this.p().membership.findFirst({
          where: { organizationId, userId: assignedUserId },
          include: { user: { select: { name: true, email: true } } },
        }).catch(() => null);
        if (member) {
          assigneeLabel = member.user?.name ?? member.user?.email ?? assignedUserId;
        } else {
          assigneeLabel = assignedUserId;
          memberNote = " লক্ষ্য করুন: এই ব্যবহারকারী বর্তমানে এই org-এর সদস্য নন — কার্যকর করার সময় staff পথের নিজের যাচাইয়ে প্রস্তাবটি ব্যর্থ (failed) হিসেবে রেকর্ড হবে।";
        }
      }
      return {
        title: assignedUserId ? `অ্যাসাইন: ${who} → ${assigneeLabel}` : `আনঅ্যাসাইন: ${who}`,
        preview: `অনুমোদন দিলে “${who}”-এর কথোপকথনটি ${assignedUserId ? `“${assigneeLabel}”-কে অ্যাসাইন করা হবে` : "আনঅ্যাসাইন করা হবে"} — InboxService-এর স্বাভাবিক updateConversation পথে, ঠিক যেভাবে টিম নিজে করে।${memberNote} এখনো কিছুই করা হয়নি।`,
        payload: { conversationId: conv.id, assignedUserId },
        conversationId: conv.id,
      };
    });
    this.executors.set("inbox.assign_conversation", async (organizationId, actorId, payload) => {
      const updated: any = await this.inbox.updateConversation(organizationId, actorId, payload.conversationId, {
        assignedUserId: payload.assignedUserId ?? null,
      });
      return { conversationId: payload.conversationId, assignedUserId: updated?.assignedUserId ?? null };
    });
    this.verifiers.set("inbox.assign_conversation.verify", async (organizationId, payload) => {
      const conv = await this.p().channelConversation.findFirst({ where: { id: payload.conversationId, organizationId } });
      const expected = payload.assignedUserId ?? null;
      return {
        verified: !!conv && (conv.assignedUserId ?? null) === expected,
        detail: { conversationId: payload.conversationId, expectedAssignee: expected, observedAssignee: conv?.assignedUserId ?? null },
      };
    });
  }

  // ---------- inbox / tag_conversation ----------
  // Tags are a free-form string[] on the conversation — there is
  // NO tag registry in the inbox. The only rules are the inbox's
  // own: normalizeTags (trim, 30 chars, case-insensitive dedupe,
  // max 10), which updateConversation applies on write. The
  // executor merges into the current set (the catalog's promise).
  private registerTagConversation() {
    this.builders.set("tag_conversation", async (organizationId, payload) => {
      const conv = await this.conversationOrThrow(organizationId, payload);
      if (!Array.isArray(payload?.addTags) || payload.addTags.length === 0) {
        throw new BadRequestException("addTags must be a non-empty array of tag strings");
      }
      const addTags = normalizeTags(payload.addTags.map((t: any) => String(t ?? "")));
      if (addTags.length === 0) throw new BadRequestException("addTags-এ কোনো বৈধ ট্যাগ নেই (খালি/শুধু space)।");
      const current = new Set((conv.tags ?? []).map((t: string) => String(t).toLowerCase()));
      const fresh = addTags.filter((t) => !current.has(t.toLowerCase()));
      if (fresh.length === 0) throw new BadRequestException("এই ট্যাগগুলো কথোপকথনে ইতিমধ্যে আছে — যোগ করার কিছু নেই।");
      const who = conv.contactName ?? conv.externalContactId ?? conv.id;
      return {
        title: `ট্যাগ যোগ: ${who} — ${fresh.join(", ")}`,
        preview: `অনুমোদন দিলে “${who}”-এর কথোপকথনে ${fresh.map((t) => `“${t}”`).join(", ")} ট্যাগ যোগ হবে (বর্তমান ট্যাগের সঙ্গে মিলিয়ে, updateConversation-এর পথে — inbox-এর নিজের normalizeTags নিয়মে)। এখনো কিছুই করা হয়নি।`,
        payload: { conversationId: conv.id, addTags: fresh },
        conversationId: conv.id,
      };
    });
    this.executors.set("inbox.tag_conversation", async (organizationId, actorId, payload) => {
      const conv = await this.p().channelConversation.findFirst({ where: { id: payload.conversationId, organizationId } });
      if (!conv) throw new NotFoundException("Conversation not found in this organization");
      const merged = normalizeTags([...(conv.tags ?? []), ...(payload.addTags ?? [])]);
      const updated: any = await this.inbox.updateConversation(organizationId, actorId, payload.conversationId, { tags: merged });
      return { conversationId: payload.conversationId, tags: updated?.tags ?? merged };
    });
    this.verifiers.set("inbox.tag_conversation.verify", async (organizationId, payload) => {
      const conv = await this.p().channelConversation.findFirst({ where: { id: payload.conversationId, organizationId } });
      const present = new Set((conv?.tags ?? []).map((t: string) => String(t).toLowerCase()));
      const missing = (payload.addTags ?? []).filter((t: string) => !present.has(String(t).toLowerCase()));
      return {
        verified: !!conv && missing.length === 0,
        detail: { conversationId: payload.conversationId, observedTags: conv?.tags ?? null, missing },
      };
    });
  }

  // ---------- inbox / reopen_conversation ----------
  private registerReopenConversation() {
    this.builders.set("reopen_conversation", async (organizationId, payload) => {
      const conv = await this.conversationOrThrow(organizationId, payload);
      if (conv.status === "open") throw new BadRequestException("এই কথোপকথনটি ইতিমধ্যে খোলা (open) আছে — আবার খোলার কিছু নেই।");
      const who = conv.contactName ?? conv.externalContactId ?? conv.id;
      return {
        title: `কথোপকথন আবার খোলা: ${who}`,
        preview: `অনুমোদন দিলে “${who}”-এর কথোপকথনটি আবার খোলা (open) হবে — updateConversation-এর পথে (resolvedAt মুছে যাবে, যেমনটা টিম নিজে খুললে হয়)। এখনো কিছুই করা হয়নি।`,
        payload: { conversationId: conv.id },
        conversationId: conv.id,
      };
    });
    this.executors.set("inbox.reopen_conversation", async (organizationId, actorId, payload) => {
      const updated: any = await this.inbox.updateConversation(organizationId, actorId, payload.conversationId, { status: "open" });
      return { conversationId: payload.conversationId, status: updated?.status ?? null };
    });
    this.verifiers.set("inbox.reopen_conversation.verify", async (organizationId, payload) => {
      const conv = await this.p().channelConversation.findFirst({ where: { id: payload.conversationId, organizationId } });
      return {
        verified: !!conv && conv.status === "open",
        detail: { conversationId: payload.conversationId, observedStatus: conv?.status ?? null },
      };
    });
  }

  // ---------- inbox / mark_conversation_spam ----------
  // Distinct from block_sender: marking spam only sets spamFlag
  // (the thread lands in the spam queue). The inbound spam
  // detector writes this same flag itself when it fires — this
  // action is the engine path for proposals from other surfaces.
  private registerMarkConversationSpam() {
    this.builders.set("mark_conversation_spam", async (organizationId, payload) => {
      const conv = await this.conversationOrThrow(organizationId, payload);
      if (conv.spamFlag) throw new BadRequestException("এই কথোপকথনটি ইতিমধ্যে স্প্যাম হিসেবে চিহ্নিত — আবার চিহ্নিত করার কিছু নেই।");
      const who = conv.contactName ?? conv.externalContactId ?? conv.id;
      return {
        title: `স্প্যাম হিসেবে চিহ্নিত: ${who}`,
        preview: `অনুমোদন দিলে “${who}”-এর কথোপকথনটি স্প্যাম হিসেবে চিহ্নিত হবে (spamFlag — থ্রেডটি স্প্যাম queue-তে যাবে) — updateConversation-এর পথে। প্রেরক ব্লক হবে না; ব্লক করা আলাদা কাজ (block_sender)। এখনো কিছুই করা হয়নি।`,
        payload: { conversationId: conv.id },
        conversationId: conv.id,
      };
    });
    this.executors.set("inbox.mark_conversation_spam", async (organizationId, actorId, payload) => {
      const updated: any = await this.inbox.updateConversation(organizationId, actorId, payload.conversationId, { spamFlag: true });
      return { conversationId: payload.conversationId, spamFlag: updated?.spamFlag ?? null };
    });
    this.verifiers.set("inbox.mark_conversation_spam.verify", async (organizationId, payload) => {
      const conv = await this.p().channelConversation.findFirst({ where: { id: payload.conversationId, organizationId } });
      return {
        verified: !!conv && conv.spamFlag === true,
        detail: { conversationId: payload.conversationId, observedSpamFlag: conv?.spamFlag ?? null },
      };
    });
  }

  // ---------- inbox / block_sender ----------
  // The real path is setConversationBlocked: it stamps blockedAt
  // and (as its own side effect) also raises spamFlag so the
  // blocked thread shows in the spam queue. While blocked, inbound
  // messages are stored but NO automation runs on them.
  private registerBlockSender() {
    this.builders.set("block_sender", async (organizationId, payload) => {
      const conv = await this.conversationOrThrow(organizationId, payload);
      if (conv.blockedAt) throw new BadRequestException("এই প্রেরক ইতিমধ্যে ব্লক করা আছে — আবার ব্লক করার কিছু নেই।");
      const reason = typeof payload?.reason === "string" ? payload.reason.trim().slice(0, 300) : "";
      const who = conv.contactName ?? conv.externalContactId ?? conv.id;
      return {
        title: `প্রেরক ব্লক: ${who}`,
        preview: `অনুমোদন দিলে “${who}”-কে ব্লক করা হবে — setConversationBlocked-এর পথে: এরপর তার বার্তা জমা হলেও কোনো স্বয়ংক্রিয় প্রক্রিয়া (বট/autopilot) চলবে না, থ্রেডটি স্প্যাম queue-তে থাকবে। আনব্লক করা যাবে।${reason ? ` কারণ: “${reason}”` : ""} এখনো কিছুই করা হয়নি।`,
        payload: { conversationId: conv.id, ...(reason ? { reason } : {}) },
        conversationId: conv.id,
      };
    });
    this.executors.set("inbox.block_sender", async (organizationId, actorId, payload) => {
      const updated: any = await this.inbox.setConversationBlocked(organizationId, actorId, payload.conversationId, {
        blocked: true,
        ...(payload.reason ? { reason: payload.reason } : {}),
      });
      return { conversationId: payload.conversationId, blockedAt: updated?.blockedAt ?? null };
    });
    this.verifiers.set("inbox.block_sender.verify", async (organizationId, payload) => {
      const conv = await this.p().channelConversation.findFirst({ where: { id: payload.conversationId, organizationId } });
      return {
        verified: !!conv && !!conv.blockedAt,
        detail: { conversationId: payload.conversationId, observedBlockedAt: conv?.blockedAt ?? null },
      };
    });
  }

  // =====================================================================
  // SA-B12 (W3) — the remaining comment set. Every executor calls
  // the SAME SocialCommentsService staff method the moderation
  // queue calls — all of them Graph-first (IN8): the platform
  // confirms before any local state moves, so a Graph failure
  // surfaces as a FAILED proposal with the platform error
  // verbatim and the local row is left exactly as it was.
  // =====================================================================

  private async commentOrThrow(organizationId: string, payload: any) {
    const commentId = reqString(payload, "commentId");
    const comment = await this.p().socialComment.findFirst({ where: { id: commentId, organizationId } });
    if (!comment) throw new NotFoundException("Comment not found in this organization");
    return comment;
  }

  /** The moderation-queue label for a comment, shared by the
   *  b12 previews: author + a short text snippet. NO customer
   *  facts beyond what the public comment itself carries (L3 —
   *  a proposal preview is a staff surface, and the comment is
   *  already public; nothing from memory/orders is ever quoted
   *  into one). */
  private commentLabel(comment: any): { author: string; snippet: string } {
    return {
      author: comment.authorName ?? "অজানা",
      snippet: String(comment.commentText ?? "").slice(0, 120),
    };
  }

  // ---------- comment / unhide_comment ----------
  // The staff path is updateCommentStatus(PENDING): from HIDDEN
  // it confirms on Graph with is_hidden:false BEFORE the local
  // status moves. Only a HIDDEN comment has anything to unhide
  // — the builder refuses every other state rather than letting
  // a no-op local write pose as a platform action.
  private registerUnhideComment() {
    this.builders.set("unhide_comment", async (organizationId, payload) => {
      const comment = await this.commentOrThrow(organizationId, payload);
      if (comment.status !== "HIDDEN") {
        throw new BadRequestException(`এই কমেন্টটি লুকানো (HIDDEN) অবস্থায় নেই (বর্তমান status: ${comment.status ?? "অজানা"}) — আবার দেখানোর কিছু নেই।`);
      }
      const { author, snippet } = this.commentLabel(comment);
      return {
        title: `কমেন্ট আবার দেখানো: ${author}`,
        preview: `অনুমোদন দিলে ${comment.platform}-এ “${author}”-এর লুকানো কমেন্টটি (“${snippet}”) আবার দেখানো হবে — আগে Meta Graph নিশ্চিত করবে (is_hidden: false), তারপরই local status PENDING হবে। এখনো কিছুই করা হয়নি।`,
        payload: { commentId: comment.id },
      };
    });
    this.executors.set("comment.unhide_comment", async (organizationId, _actorId, payload) => {
      const updated: any = await this.socialComments.updateCommentStatus(organizationId, payload.commentId, "PENDING");
      return { commentId: payload.commentId, status: updated?.status ?? null };
    });
    this.verifiers.set("comment.unhide_comment.verify", async (organizationId, payload) => {
      const comment = await this.p().socialComment.findFirst({ where: { id: payload.commentId, organizationId } });
      return {
        verified: !!comment && comment.status === "PENDING",
        detail: { commentId: payload.commentId, observedStatus: comment?.status ?? null },
      };
    });
  }

  // ---------- comment / reply_to_comment ----------
  // The payload carries the EXACT text a human approved. At
  // execution the SA-B8 number guard re-runs against FRESH
  // facts (SocialCommentsService.checkCommentReplyGuard — the
  // same fact assembly the autopilot compose guards with):
  // approved text can go stale (a price moved after approval),
  // and a guard failure fails the proposal with the guard
  // reason and posts NOTHING. The send itself is the staff
  // path — sendReply: CC27 deny gate for the approving actor,
  // Graph reply first, local MANUALLY_REPLIED only on Graph
  // confirmation.
  private registerReplyToComment() {
    this.builders.set("reply_to_comment", async (organizationId, payload) => {
      const comment = await this.commentOrThrow(organizationId, payload);
      if (comment.status === "DELETED") {
        throw new BadRequestException("এই কমেন্টটি মুছে ফেলা হয়েছে — এর উত্তর দেওয়া যায় না।");
      }
      const replyText = reqString(payload, "replyText");
      if (replyText.length > 1000) {
        throw new BadRequestException("replyText সর্বোচ্চ ১০০০ অক্ষরের হতে পারবে (SA-B8 grounded compose-এর সীমা)।");
      }
      const { author, snippet } = this.commentLabel(comment);
      return {
        title: `কমেন্টের উত্তর: ${author}`,
        preview: `অনুমোদন দিলে ${comment.platform}-এ “${author}”-এর কমেন্টের (“${snippet}”) উত্তর হিসেবে ঠিক এই লেখাটি পাবলিক reply পোস্ট হবে: “${replyText}” — আগে Meta Graph নিশ্চিত করবে, তারপরই local status বদলাবে। পোস্টের ঠিক আগে লেখাটির সব সংখ্যা তাজা যাচাইকৃত তথ্যের সঙ্গে আবার মিলিয়ে দেখা হবে (number guard, SA-B8) — কোনো সংখ্যা মিল না খেলে কিছুই পোস্ট হবে না এবং প্রস্তাবটি failed হিসেবে রেকর্ড হবে। এখনো কিছুই করা হয়নি।`,
        payload: { commentId: comment.id, replyText },
      };
    });
    this.executors.set("comment.reply_to_comment", async (organizationId, actorId, payload) => {
      const guard = await this.socialComments.checkCommentReplyGuard(organizationId, payload.commentId, payload.replyText);
      if (guard.inventedNumbers.length) {
        throw new BadRequestException(
          `number guard: উত্তরের এই সংখ্যাগুলো তাজা যাচাইকৃত তথ্যে নেই — ${guard.inventedNumbers.join(", ")}। অনুমোদনের পর তথ্য বদলে গেছে (বা লেখাটি কখনোই grounded ছিল না) — কিছুই পোস্ট হয়নি।`,
        );
      }
      const res: any = await this.socialComments.sendReply(organizationId, actorId, payload.commentId, { replyText: payload.replyText });
      return { commentId: payload.commentId, status: res?.status ?? null, graphReplyId: res?.graphReplyId ?? null };
    });
    this.verifiers.set("comment.reply_to_comment.verify", async (organizationId, payload) => {
      const comment = await this.p().socialComment.findFirst({ where: { id: payload.commentId, organizationId } });
      const graphReplyId = (comment?.metadata as any)?.graph?.replyId ?? null;
      return {
        verified:
          !!comment &&
          comment.status === "MANUALLY_REPLIED" &&
          comment.replyText === payload.replyText &&
          !!graphReplyId,
        detail: {
          commentId: payload.commentId,
          observedStatus: comment?.status ?? null,
          replyTextMatches: !!comment && comment.replyText === payload.replyText,
          graphReplyId,
        },
      };
    });
  }

  // ---------- comment / send_dm_to_commenter ----------
  // The staff path is sendPrivateReply: Meta allows ONE private
  // reply per comment, and the service itself refuses when one
  // was already sent (checked again at execution — a DM sent
  // between proposal and approval surfaces as a FAILED proposal
  // with the service's reason verbatim, never a second send).
  // The message is staff/proposer-supplied text; the system
  // never embeds the commenter's own facts into it (L3).
  private registerSendDmToCommenter() {
    this.builders.set("send_dm_to_commenter", async (organizationId, payload) => {
      const comment = await this.commentOrThrow(organizationId, payload);
      if (comment.status === "DELETED") {
        throw new BadRequestException("এই কমেন্টটি মুছে ফেলা হয়েছে — এর লেখককে DM পাঠানো যায় না।");
      }
      if (comment.isPrivateDmSent) {
        throw new BadRequestException("এই কমেন্টের জন্য ইতিমধ্যে একটি private reply (DM) পাঠানো হয়েছে — Meta প্রতি কমেন্টে একটির বেশি private reply দেয় না।");
      }
      const message = reqString(payload, "message");
      if (message.length > 1000) {
        throw new BadRequestException("message সর্বোচ্চ ১০০০ অক্ষরের হতে পারবে।");
      }
      const { author, snippet } = this.commentLabel(comment);
      return {
        title: `কমেন্টকারীকে DM: ${author}`,
        preview: `অনুমোদন দিলে ${comment.platform}-এ “${author}” (“${snippet}” কমেন্টের লেখক)-কে ঠিক এই private reply (DM) পাঠানো হবে: “${message}” — Meta Graph নিশ্চিত করলেই কেবল DM পাঠানো হয়েছে বলে ধরা হবে; ব্যর্থ হলে প্রস্তাবটি failed হিসেবে রেকর্ড হবে। Meta প্রতি কমেন্টে মাত্র একটি private reply দেয় — এটি পাঠালে পরে আর পাঠানো যাবে না। এখনো কিছুই করা হয়নি।`,
        payload: { commentId: comment.id, message },
      };
    });
    this.executors.set("comment.send_dm_to_commenter", async (organizationId, actorId, payload) => {
      const res: any = await this.socialComments.sendPrivateReply(organizationId, actorId, payload.commentId, payload.message);
      return {
        commentId: payload.commentId,
        graphPrivateReplyId: res?.graphPrivateReplyId ?? null,
        dmConversationId: res?.dmConversationId ?? null,
      };
    });
    this.verifiers.set("comment.send_dm_to_commenter.verify", async (organizationId, payload) => {
      const comment = await this.p().socialComment.findFirst({ where: { id: payload.commentId, organizationId } });
      const graphPrivateReplyId = (comment?.metadata as any)?.graph?.privateReplyId ?? null;
      return {
        verified: !!comment && comment.isPrivateDmSent === true && (!!graphPrivateReplyId || !!comment.dmConversationId),
        detail: {
          commentId: payload.commentId,
          observedDmSent: comment?.isPrivateDmSent ?? null,
          graphPrivateReplyId,
          dmConversationId: comment?.dmConversationId ?? null,
        },
      };
    });
  }

  // ---------- comment / delete_comment ----------
  // HIGH RISK, irreversible. The staff path is deleteComment:
  // the platform DELETE confirms first ({success:true}); only
  // then does the local row become DELETED (with the Graph
  // marker in metadata). The verifier reads back BOTH: the
  // local status AND the Graph deletion marker — a local-only
  // flip can never verify. The engine's L2 gate never touches
  // high-risk entries, so this always waits for a human.
  private registerDeleteComment() {
    this.builders.set("delete_comment", async (organizationId, payload) => {
      const comment = await this.commentOrThrow(organizationId, payload);
      if (comment.status === "DELETED") {
        throw new BadRequestException("এই কমেন্টটি ইতিমধ্যে মুছে ফেলা হয়েছে — আবার মোছার কিছু নেই।");
      }
      const { author, snippet } = this.commentLabel(comment);
      return {
        title: `কমেন্ট মুছে ফেলা: ${author}`,
        preview: `সতর্কতা: এটি স্থায়ী — ফেরত আনা যাবে না। অনুমোদন দিলে ${comment.platform}-এ “${author}”-এর কমেন্টটি (“${snippet}”) platform থেকেই মুছে ফেলা হবে — আগে Meta Graph মুছে নিশ্চিত করবে, তারপরই local status DELETED হবে। এখনো কিছুই করা হয়নি।`,
        payload: { commentId: comment.id },
      };
    });
    this.executors.set("comment.delete_comment", async (organizationId, actorId, payload) => {
      const updated: any = await this.socialComments.deleteComment(organizationId, actorId, payload.commentId);
      return { commentId: payload.commentId, status: updated?.status ?? null };
    });
    this.verifiers.set("comment.delete_comment.verify", async (organizationId, payload) => {
      const comment = await this.p().socialComment.findFirst({ where: { id: payload.commentId, organizationId } });
      const graphDeletedAt = (comment?.metadata as any)?.graph?.deletedAt ?? null;
      return {
        verified: !!comment && comment.status === "DELETED" && !!graphDeletedAt,
        detail: { commentId: payload.commentId, observedStatus: comment?.status ?? null, graphDeletedAt },
      };
    });
  }

  // =====================================================================
  // SA-B15 (A2) — the ads set. Every executor calls the hub's OWN
  // lifecycle path for the campaign's route (the same methods the
  // dashboard's pause/resume buttons call); every verifier re-reads
  // the platform-confirmed status — the hub-maintained local record
  // where one exists (a Meta plan's metaStatus, written only after
  // Meta confirms), otherwise the hub's own live status read
  // (PublishingService.crossPlatformCampaignStatus /
  // CampaignsService.getMetaCampaignStatusByAccount). A state that
  // does not match the target is verification_mismatch with the
  // observed state recorded — never a hopeful success (L5).
  //
  // Route resolution (resolveAdsTarget) follows the hub's own
  // structure: a published CampaignPlan is the dashboard's object
  // and wins for Meta; a created CrossPlatformDraft wins for
  // plan-published Google/TikTok campaigns; anything else resolves
  // through the synced AdCampaign row's account. A campaign whose
  // account is not API-connected (CSV/manual) has NO lifecycle
  // path on this line — the builder refuses and names it, rather
  // than inventing an executor.
  // =====================================================================

  private campaignsOrThrow(): CampaignsService {
    if (!this.campaigns) throw new BadRequestException("Campaigns service is not available in this context");
    return this.campaigns;
  }

  private publishingOrThrow(): PublishingService {
    if (!this.publishing) throw new BadRequestException("Publishing service is not available in this context");
    return this.publishing;
  }

  /** Resolve (platform, campaignExternalId[, adAccountId]) to the
   *  ONE hub route that can act on that campaign in this org. */
  private async resolveAdsTarget(organizationId: string, payload: any) {
    const platform = reqString(payload, "platform").toLowerCase();
    if (!["meta", "google", "tiktok"].includes(platform)) {
      throw new BadRequestException(`platform must be meta, google or tiktok (got "${platform}") — manual/CSV-only data has no platform to act on`);
    }
    const campaignExternalId = reqString(payload, "campaignExternalId");
    const wantAccountId =
      typeof payload?.adAccountId === "string" && payload.adAccountId.trim() ? payload.adAccountId.trim() : null;

    // Meta first: a published CampaignPlan is the dashboard's own object.
    if (platform === "meta") {
      const plan = await this.p().campaignPlan.findFirst({
        where: {
          organizationId,
          externalCampaignId: campaignExternalId,
          status: "published",
          ...(wantAccountId ? { adAccountId: wantAccountId } : {}),
        },
      });
      if (plan) {
        const account = await this.p().adAccount.findFirst({ where: { id: plan.adAccountId, organizationId } });
        return {
          route: "meta_plan" as const,
          platform,
          campaignExternalId,
          planId: plan.id as string,
          plan,
          draftId: null as string | null,
          adAccountId: plan.adAccountId as string,
          accountName: account?.name ?? null,
          accountCurrency: account?.currency ?? null,
          campaignName: plan.name as string,
        };
      }
    }

    // Google/TikTok: a created plan publication rides the draft lifecycle.
    if (platform !== "meta") {
      const draft = await this.p().crossPlatformDraft.findFirst({
        where: {
          organizationId,
          platform,
          externalCampaignId: campaignExternalId,
          status: "created",
          ...(wantAccountId ? { targetAdAccountId: wantAccountId } : {}),
        },
      });
      if (draft) {
        const account = await this.p().adAccount.findFirst({ where: { id: draft.targetAdAccountId, organizationId } });
        const plan = await this.p().campaignPlan.findFirst({ where: { id: draft.planId, organizationId } });
        const synced = await this.p().adCampaign.findFirst({
          where: { organizationId, adAccountId: draft.targetAdAccountId, externalId: campaignExternalId },
        });
        return {
          route: "cross_draft" as const,
          platform,
          campaignExternalId,
          planId: draft.planId as string,
          plan: null,
          draftId: draft.id as string,
          adAccountId: draft.targetAdAccountId as string,
          accountName: account?.name ?? null,
          accountCurrency: account?.currency ?? null,
          campaignName: (synced?.name as string) ?? (plan?.name as string) ?? campaignExternalId,
        };
      }
    }

    // Synced campaign rows (the digest's universe).
    const rows = await this.p().adCampaign.findMany({
      where: { organizationId, externalId: campaignExternalId, ...(wantAccountId ? { adAccountId: wantAccountId } : {}) },
      include: { adAccount: true },
    });
    const matches = (rows as any[]).filter((r) => String(r.adAccount?.platform ?? "").toLowerCase() === platform);
    if (matches.length > 1) {
      throw new BadRequestException(
        `একই campaign id (${campaignExternalId}) এই org-এর একাধিক ${platform} অ্যাকাউন্টে আছে — কোন অ্যাকাউন্টের campaign তা adAccountId দিয়ে নির্দিষ্ট করুন।`,
      );
    }
    const row = matches[0] ?? null;
    if (!row) {
      throw new NotFoundException(
        `এই org-এ ${platform} campaign "${campaignExternalId}"-এর কোনো record নেই — campaign-টি আগে sync/connect করুন।`,
      );
    }
    if (!row.adAccount?.integrationId) {
      throw new BadRequestException(
        `“${row.name}” campaign-এর অ্যাকাউন্ট (${row.adAccount?.name ?? "অজানা"}) API দিয়ে connected নয় (CSV/manual) — platform-এ সরাসরি কাজ করার কোনো পথ এই system-এ নেই; campaign-টি Ads Manager থেকে পরিচালনা করুন।`,
      );
    }
    return {
      route: platform === "meta" ? ("meta_account" as const) : ("cross_platform" as const),
      platform,
      campaignExternalId,
      planId: null as string | null,
      plan: null,
      draftId: null as string | null,
      adAccountId: row.adAccountId as string,
      accountName: row.adAccount?.name ?? null,
      accountCurrency: row.adAccount?.currency ?? null,
      campaignName: row.name as string,
    };
  }

  private adsRouteNote(route: string): string {
    switch (route) {
      case "meta_plan":
        return "CampaignsService.setMetaStatus — ঠিক যেভাবে dashboard campaign pause/resume করে";
      case "meta_account":
        return "CampaignsService-এর account-scoped lifecycle পথ (Ads Manager-এ তৈরি, এখানে sync-হওয়া campaign)";
      case "cross_draft":
        return "CampaignsService-এর cross-platform draft lifecycle — ঠিক যেভাবে dashboard করে";
      default:
        return "PublishingService-এর cross-platform lifecycle পথ";
    }
  }

  // ---------- ads / pause_campaign + resume_campaign ----------
  private registerAdsPauseResume() {
    const pairs = [
      ["pause_campaign", "PAUSED"],
      ["resume_campaign", "ACTIVE"],
    ] as const;
    for (const [actionId, target] of pairs) {
      this.builders.set(actionId, async (organizationId, payload) =>
        this.buildAdsLifecycle(organizationId, payload, target),
      );
      this.executors.set(`ads.${actionId}`, async (organizationId, actorId, payload) =>
        this.executeAdsLifecycle(organizationId, actorId, payload, target),
      );
      this.verifiers.set(`ads.${actionId}.verify`, async (organizationId, payload) =>
        this.verifyAdsLifecycle(organizationId, payload, target),
      );
    }
  }

  private async buildAdsLifecycle(organizationId: string, payload: any, target: "ACTIVE" | "PAUSED") {
    const t = await this.resolveAdsTarget(organizationId, payload);
    // The only locally-knowable current state is a Meta plan's
    // hub-maintained metaStatus (written only after Meta
    // confirms). Where it already equals the target there is
    // nothing to do — refuse the no-op like the inbox builders
    // do, instead of dressing a redundant call as an action.
    // Other routes hold no trustworthy local state (no sync
    // maintains it), so no state claim is made for them.
    if (t.route === "meta_plan" && t.plan?.metaStatus === target) {
      throw new BadRequestException(
        target === "PAUSED"
          ? `“${t.campaignName}” campaign-টি ইতিমধ্যে বন্ধ (PAUSED) আছে — Meta-র সর্বশেষ নিশ্চিত record অনুযায়ী। আবার বন্ধ করার কিছু নেই।`
          : `“${t.campaignName}” campaign-টি ইতিমধ্যে চালু (ACTIVE) আছে — Meta-র সর্বশেষ নিশ্চিত record অনুযায়ী। আবার চালু করার কিছু নেই।`,
      );
    }
    return {
      title: `ক্যাম্পেইন ${target === "PAUSED" ? "বন্ধ" : "আবার চালু"}: ${t.campaignName} (${t.platform})`,
      preview:
        `অনুমোদন দিলে ${t.platform}-এর “${t.campaignName}” campaign-টি ${target === "PAUSED" ? "বন্ধ (pause)" : "আবার চালু (resume)"} করা হবে — hub-এর নিজের lifecycle পথে (${this.adsRouteNote(t.route)}), platform নিশ্চিত করলেই কেবল কাজটি হয়েছে ধরা হবে; কার্যকরের পর platform-নিশ্চিত status আবার পড়ে যাচাই করা হবে, মিল না খেলে প্রস্তাবটি failed হিসেবে রেকর্ড হবে। ` +
        `এটি কোনো টাকা সরায় না${target === "PAUSED" ? " — শুধু ব্যয় থামে" : ""} এবং ${target === "PAUSED" ? "resume_campaign" : "pause_campaign"} দিয়ে ফেরত আনা যায়। এখনো কিছুই করা হয়নি।`,
      payload: {
        platform: t.platform,
        campaignExternalId: t.campaignExternalId,
        campaignName: t.campaignName,
        adAccountId: t.adAccountId,
        route: t.route,
        ...(t.planId ? { planId: t.planId } : {}),
        ...(t.draftId ? { draftId: t.draftId } : {}),
        // The engine's ads dedupe identity (SA-B15): one open
        // proposal per campaign + action.
        campaignKey: `${t.platform}::${t.adAccountId}::${t.campaignExternalId}`,
      },
    };
  }

  private async executeAdsLifecycle(
    organizationId: string,
    actorId: string,
    payload: any,
    target: "ACTIVE" | "PAUSED",
  ): Promise<Record<string, unknown>> {
    const route = String(payload?.route ?? "");
    const base = { platform: payload.platform, campaignExternalId: payload.campaignExternalId, route, target };
    switch (route) {
      case "meta_plan": {
        const full: any = await this.campaignsOrThrow().setMetaStatus(organizationId, actorId, payload.planId, target);
        return { ...base, planId: payload.planId, confirmedStatus: full?.metaStatus ?? null };
      }
      case "meta_account": {
        const res: any = await this.campaignsOrThrow().setMetaCampaignStatusByAccount(
          organizationId,
          actorId,
          payload.adAccountId,
          payload.campaignExternalId,
          target,
        );
        return { ...base, confirmedStatus: res?.status ?? null };
      }
      case "cross_draft": {
        const res: any = await this.campaignsOrThrow().setCrossPlatformDraftLifecycle(
          organizationId,
          actorId,
          payload.planId,
          payload.draftId,
          target === "PAUSED" ? "pause" : "resume",
        );
        return {
          ...base,
          planId: payload.planId,
          draftId: payload.draftId,
          providerStatus: res?.providerStatus ?? null,
          providerStatusSource: res?.providerStatusSource ?? null,
        };
      }
      case "cross_platform": {
        const res: any = await this.publishingOrThrow().crossPlatformSetCampaignStatus(
          organizationId,
          actorId,
          payload.adAccountId,
          payload.platform,
          payload.campaignExternalId,
          target,
        );
        return { ...base, providerStatus: res?.providerStatus ?? null, providerStatusRaw: res?.providerStatusRaw ?? null };
      }
      default:
        throw new BadRequestException(`Unknown ads lifecycle route: ${route || "(missing)"}`);
    }
  }

  private async verifyAdsLifecycle(
    organizationId: string,
    payload: any,
    target: "ACTIVE" | "PAUSED",
  ): Promise<VerificationOutcome> {
    const route = String(payload?.route ?? "");
    switch (route) {
      case "meta_plan": {
        // The hub-maintained record: metaStatus is written ONLY
        // after Meta confirms the change (setMetaStatus), so
        // this re-read is a read of platform-confirmed state.
        const plan = await this.p().campaignPlan.findFirst({ where: { id: payload.planId, organizationId } });
        return {
          verified: !!plan && plan.metaStatus === target,
          detail: {
            route,
            expectedStatus: target,
            observedStatus: plan?.metaStatus ?? null,
            observedEffectiveStatus: plan?.metaEffectiveStatus ?? null,
          },
        };
      }
      case "meta_account": {
        // No local record is maintained for synced campaigns —
        // the hub's own read is a live Meta read (status =
        // configured status; effectiveStatus recorded too).
        const res: any = await this.campaignsOrThrow().getMetaCampaignStatusByAccount(
          organizationId,
          payload.adAccountId,
          payload.campaignExternalId,
        );
        return {
          verified: String(res?.status ?? "").toUpperCase() === target,
          detail: {
            route,
            expectedStatus: target,
            observedStatus: res?.status ?? null,
            observedEffectiveStatus: res?.effectiveStatus ?? null,
          },
        };
      }
      case "cross_draft":
      case "cross_platform": {
        const want = target === "PAUSED" ? "paused" : "active";
        const res: any = await this.publishingOrThrow().crossPlatformCampaignStatus(
          organizationId,
          payload.adAccountId,
          payload.platform,
          payload.campaignExternalId,
        );
        return {
          verified: String(res?.providerStatus ?? "").toLowerCase() === want,
          detail: {
            route,
            expectedStatus: want,
            observedStatus: res?.providerStatus ?? null,
            observedStatusRaw: res?.providerStatusRaw ?? null,
          },
        };
      }
      default:
        return { verified: false, detail: { route, error: `unknown_route:${route || "missing"}` } };
    }
  }

  // ---------- ads / set_campaign_budget (proposal-only, L5 wall) ----------
  // Money movement: a builder exists so the request can be
  // proposed + approved as a recorded decision, but NO executor
  // or verifier is ever registered — the engine refuses to
  // execute it at every autonomy level (the request_refund
  // pattern). The preview must state the CURRENT budget, so the
  // builder reads it from the hub's own record where one exists
  // (a Meta plan's campaign budget fields, or its ad sets' sum —
  // values Meta confirmed at publish/last edit; a cross-platform
  // draft's explicit minor-units field). Where NO current-budget
  // source exists on this line (synced non-plan campaigns of any
  // platform; no platform budget READ exists in any hub client),
  // the builder refuses and names the gap rather than inventing
  // a number (law L2).
  private registerSetCampaignBudget() {
    this.builders.set("set_campaign_budget", async (organizationId, payload) => {
      let requested: bigint;
      try {
        requested = BigInt(payload?.requestedBudgetMinor);
      } catch {
        throw new BadRequestException("requestedBudgetMinor must be an integer amount in minor units");
      }
      if (requested <= 0n) throw new BadRequestException("requestedBudgetMinor must be positive");
      const budgetKind = payload?.budgetKind === "lifetime" ? "lifetime" : "daily";
      const t = await this.resolveAdsTarget(organizationId, payload);
      const current = await this.currentCampaignBudget(organizationId, t);
      if (!current) {
        throw new BadRequestException(
          `“${t.campaignName}” campaign-এর বর্তমান বাজেট এই system-এ পড়ার কোনো পথ নেই (কোনো platform client-এ budget read নেই, আর এই campaign-এর hub-এ কোনো সংরক্ষিত budget record-ও নেই) — বর্তমান বাজেট না জানিয়ে বাজেট-বদলের প্রস্তাব তৈরি করা হয় না। বাজেট জানতে/বদলাতে Ads Manager বা hub-এর campaign plan দেখুন।`,
        );
      }
      const currency = t.accountCurrency ?? "BDT";
      const kindBn = (k: string) => (k === "lifetime" ? "lifetime" : "দৈনিক");
      return {
        title: `বাজেট বদলের প্রস্তাব: ${t.campaignName} (${t.platform})`,
        preview:
          `এটি শুধুমাত্র একটি প্রস্তাব। অনুমোদন মানে সিদ্ধান্তটি রেকর্ড হবে — বাজেট engine নিজে কার্যকর করবে না (আইন L5: বাজেট বদল মানেই টাকার সিদ্ধান্ত)। ` +
          `বর্তমান বাজেট (${current.sourceLabel}): ${kindBn(current.kind)} ${formatMinor(current.amountMinor, currency)}। ` +
          `প্রস্তাবিত নতুন বাজেট: ${kindBn(budgetKind)} ${formatMinor(requested, currency)}। ` +
          `অনুমোদনের পর টিমকে Ads Manager/hub থেকে নিজে এই বাজেটটি বদলাতে হবে। এখনো কিছুই করা হয়নি।`,
        payload: {
          platform: t.platform,
          campaignExternalId: t.campaignExternalId,
          campaignName: t.campaignName,
          adAccountId: t.adAccountId,
          route: t.route,
          ...(t.planId ? { planId: t.planId } : {}),
          ...(t.draftId ? { draftId: t.draftId } : {}),
          campaignKey: `${t.platform}::${t.adAccountId}::${t.campaignExternalId}`,
          requestedBudgetMinor: requested.toString(),
          budgetKind,
          currentBudgetMinor: current.amountMinor.toString(),
          currentBudgetKind: current.kind,
          currentBudgetSource: current.source,
          currency,
        },
      };
    });
  }

  /** The current budget from the hub's own records — or null
   *  when this line has no honest source for the target. */
  private async currentCampaignBudget(
    organizationId: string,
    t: any,
  ): Promise<{ amountMinor: bigint; kind: "daily" | "lifetime"; source: string; sourceLabel: string } | null> {
    if (t.route === "meta_plan" && t.plan) {
      const plan = t.plan;
      if (plan.campaignDailyBudgetMinor != null) {
        return {
          amountMinor: BigInt(plan.campaignDailyBudgetMinor),
          kind: "daily",
          source: "campaign_plan_record",
          sourceLabel: "hub-এর plan record — সর্বশেষ publish/edit-এ Meta-নিশ্চিত",
        };
      }
      if (plan.campaignLifetimeBudgetMinor != null) {
        return {
          amountMinor: BigInt(plan.campaignLifetimeBudgetMinor),
          kind: "lifetime",
          source: "campaign_plan_record",
          sourceLabel: "hub-এর plan record — সর্বশেষ publish/edit-এ Meta-নিশ্চিত",
        };
      }
      const adSets = await this.p().campaignAdSet.findMany({ where: { planId: plan.id } });
      let sum = 0n;
      let any = false;
      for (const s of adSets as any[]) {
        if (s.dailyBudgetMinor != null) {
          sum += BigInt(s.dailyBudgetMinor);
          any = true;
        }
      }
      if (any) {
        return {
          amountMinor: sum,
          kind: "daily",
          source: "campaign_plan_ad_sets_record",
          sourceLabel: "hub-এর plan record — সব ad set-এর দৈনিক বাজেটের যোগফল (সর্বশেষ publish/edit-এ Meta-নিশ্চিত)",
        };
      }
      return null;
    }
    if (t.route === "cross_draft" && t.draftId) {
      const draft = await this.p().crossPlatformDraft.findFirst({ where: { id: t.draftId, organizationId } });
      const raw = (draft?.fields as any)?.dailyBudgetMinor;
      if (raw != null && String(raw).trim() !== "") {
        try {
          return {
            amountMinor: BigInt(raw),
            kind: "daily",
            source: "cross_platform_draft_record",
            sourceLabel: "hub-এর draft record — publish-এর সময় platform-নিশ্চিত",
          };
        } catch {
          return null;
        }
      }
      return null;
    }
    // meta_account / cross_platform (synced, non-plan): no
    // platform budget read exists in any hub client on this
    // line and no local budget record is kept — honestly none.
    return null;
  }
}
