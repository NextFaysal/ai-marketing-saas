import { Injectable, OnModuleInit } from "@nestjs/common";
import { EventsService } from "../../common/events.service";
import { ActionEngineService } from "./action-engine.service";

/**
 * SA-B11 (Smart AI Phase 2, W2) — the AI proposers for inbox
 * actions: deterministic triggers ONLY (no LLM-freeform action
 * invention). InboxService announces three real moments on the
 * global event bus; this service turns each into an engine
 * proposal (proposedBy "ai"), and the ENGINE — autonomy level,
 * open-proposal dedupe, approval, verification, audit — decides
 * what happens next. That split is what keeps the wiring free
 * of any DI cycle (the B10 leaf-module discipline: the engine
 * module consumes InboxModule, never the reverse) and keeps
 * every trigger fire-and-forget: the bus isolates handler
 * failures, and each handler here additionally swallows the
 * engine's expected refusals (a builder rejecting an
 * already-closed target is a normal outcome, not an error).
 *
 * Trigger map (Step-0 record in docs/smart-ai-b11-acceptance.md):
 *  A. "conversation.bot_order_completed" (bot session completed
 *     after a real order was created; the thread stays open)
 *     → propose close_conversation.
 *  B. "conversation.spam_flagged" (the inbound spam detector
 *     has JUST flagged the thread — its own act; it never blocks)
 *     → propose block_sender. mark_conversation_spam is NOT
 *     proposed here: the detector already wrote that flag
 *     itself, so an engine proposal for it would be a duplicate
 *     record of a done act.
 *  C. "conversation.next_action_suggested" (IN7's validated
 *     suggestion) → action "resolve" proposes close_conversation;
 *     a non-empty tags list proposes tag_conversation. The other
 *     allowlist actions and pipelineStage have no catalog entry
 *     and are not proposed.
 */
@Injectable()
export class InboxActionProposerService implements OnModuleInit {
  constructor(
    private readonly engine: ActionEngineService,
    private readonly events: EventsService,
  ) {}

  onModuleInit() {
    this.events.on("conversation.bot_order_completed", (payload) => this.onBotOrderCompleted(payload));
    this.events.on("conversation.spam_flagged", (payload) => this.onSpamFlagged(payload));
    this.events.on("conversation.next_action_suggested", (payload) => this.onNextActionSuggested(payload));
  }

  private ids(payload: any): { organizationId: string; conversationId: string } | null {
    const organizationId = payload?.organizationId;
    const conversationId = payload?.context?.conversationId;
    if (typeof organizationId !== "string" || !organizationId) return null;
    if (typeof conversationId !== "string" || !conversationId) return null;
    return { organizationId, conversationId };
  }

  /** propose() with the proposer's failure discipline: typed
   *  refusals (autonomy off, dedupe hit) are results, builder
   *  rejections of stale targets are expected — nothing here may
   *  ever surface into message handling. */
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
        conversationId: typeof payload.conversationId === "string" ? payload.conversationId : null,
      });
    } catch {
      /* a stale target (closed/blocked/flagged since the event)
         simply yields no proposal — recorded by design */
    }
  }

  // Trigger A — order completed through the order bot.
  async onBotOrderCompleted(payload: any): Promise<void> {
    const ids = this.ids(payload);
    if (!ids) return;
    await this.proposeQuietly(
      ids.organizationId,
      "close_conversation",
      { conversationId: ids.conversationId },
      { trigger: "order_bot_completed", orderId: payload?.context?.orderId ?? null },
    );
  }

  // Trigger B — the spam detector just flagged this thread.
  async onSpamFlagged(payload: any): Promise<void> {
    const ids = this.ids(payload);
    if (!ids) return;
    const reason = typeof payload?.context?.reason === "string" ? payload.context.reason : "";
    await this.proposeQuietly(
      ids.organizationId,
      "block_sender",
      { conversationId: ids.conversationId, ...(reason ? { reason: `স্প্যাম শনাক্ত: ${reason}` } : {}) },
      { trigger: "spam_detector", reason: reason || null },
    );
  }

  // Trigger C — IN7 suggestNextAction's validated suggestion.
  async onNextActionSuggested(payload: any): Promise<void> {
    const ids = this.ids(payload);
    if (!ids) return;
    const action = payload?.context?.action;
    const reason = typeof payload?.context?.reason === "string" ? payload.context.reason : null;
    if (action === "resolve") {
      await this.proposeQuietly(
        ids.organizationId,
        "close_conversation",
        { conversationId: ids.conversationId },
        { trigger: "next_action_suggested", aiReason: reason },
      );
    }
    const tags = Array.isArray(payload?.context?.tags)
      ? payload.context.tags.filter((t: any) => typeof t === "string" && t.trim())
      : [];
    if (tags.length > 0) {
      await this.proposeQuietly(
        ids.organizationId,
        "tag_conversation",
        { conversationId: ids.conversationId, addTags: tags },
        { trigger: "next_action_suggested", aiReason: reason },
      );
    }
  }
}
