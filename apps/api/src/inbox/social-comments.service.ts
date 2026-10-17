import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { isMemberConnectionDenied } from "../common/permission-catalog";
import { decryptJson } from "../integrations/crypto";
import { MetaMessagingClient, MessagingSecrets } from "./meta-messaging.client";
import { CommentClassifier } from "./comment-classifier";
import { CommentHumanizer } from "./comment-humanizer";
import { LlmFactory, providerForOrg } from "../ai/llm/llm.factory";
import { OrgBrainService } from "../ai/org-brain.service";
import { AnswerStoreService } from "../ai/answer-store.service";
import { EmbeddingsService } from "../ai/embeddings.service";
import { buildReplyQualityBlock, resolveReplyLanguage } from "../ai/reply-quality";
import { extractGuardNumbers } from "./business-brain";
import { detectReplyLanguage } from "./in7-ai";
import { 
  ListCommentsQueryDto, 
  ReplyCommentDto, 
  GenerateAiReplyDto, 
  UpdateReplySettingsDto, 
  IngestExternalCommentDto 
} from "./social-comments.dto";
import { formatMinor } from "@repo/contracts";
import { aiScheduleBlocks, parseAiSchedule } from "./ai-schedule";

@Injectable()
export class SocialCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // SA-B8 (R2): the comment autopilot's Brain stack — the same
    // services the inbox autopilot composes from (LlmFactory is
    // an InboxModule provider; OrgBrainService +
    // AnswerStoreService arrive via OrgBrainModule, which
    // InboxModule already imports). Appended + @Optional so
    // every existing positional construction (unit specs build
    // (prisma, audit)) keeps working: absent collaborators make
    // the grounded compose decline, which is exactly the
    // pre-SA-B8 humanizer behaviour.
    @Optional() private readonly llm?: LlmFactory,
    @Optional() private readonly orgBrain?: OrgBrainService,
    @Optional() private readonly answerStore?: AnswerStoreService,
    // SA-B12 (W3): the global event bus, appended + @Optional in
    // the same pattern (EventsModule is global; InboxService
    // takes it the same way). This service only ever EMITS the
    // two comment trigger announcements — the Action Engine's
    // CommentActionProposerService subscribes from its own leaf
    // module, so no dependency runs the other way. Absent in
    // positional spec constructions → the emits are skipped and
    // behaviour is exactly as before.
    @Optional() private readonly events?: EventsService,
  ) {}

  private brainFallback?: OrgBrainService;
  private brainSvc(): OrgBrainService {
    return this.orgBrain ?? (this.brainFallback ??= new OrgBrainService(this.prisma as any));
  }

  private answerStoreFallback?: AnswerStoreService;
  private answerStoreSvc(): AnswerStoreService {
    return (
      this.answerStore ??
      (this.answerStoreFallback ??= new AnswerStoreService(this.prisma as any, new EmbeddingsService(this.prisma as any)))
    );
  }

  async getSettings(organizationId: string) {
    let settings = await (this.prisma as any).socialReplySetting.findUnique({
      where: { organizationId },
    });

    if (!settings) {
      settings = await (this.prisma as any).socialReplySetting.create({
        data: {
          organizationId,
          aiAutoReplyEnabled: true,
          sendPrivateDm: true,
          autoHideSpam: true,
          replyDelaySeconds: 25,
          tonePreference: "FRIENDLY_SALES",
          bannedKeywords: [],
          nightOwlEnabled: true,
          urgentAlertTelegramEnabled: false,
          cannedSnippets: [
            { code: "delivery", label: "ডেলিভারি তথ্য", text: "ঢাকা সিটির মধ্যে ৬০ টাকা (২৪-৪৮ ঘণ্টা) এবং ঢাকার বাইরে ১২০ টাকা (২-৩ দিন)। হোম ডেলিভারি ক্যাশ অন ডেলিভারিতে পাবেন!" },
            { code: "size", label: "সাইজ চার্ট", text: "আমাদের সাইজ চার্ট: M (বডি ৩৮), L (বডি ৪০), XL (বডি ৪২), XXL (বডি ৪৪)। আপনার সঠিক সাইজটি ইনবক্সে কনফার্ম করুন।" },
            { code: "warranty", label: "ওয়ারেন্টি পলিসি", text: "প্রোডাক্ট রিসিভের পর ৭ দিনের মধ্যে যেকোনো সমস্যায় ১০০% ফ্রি রিটার্ন ও রিপ্লেসমেন্ট সুবিধা পাবেন।" }
          ],
        },
      });
    }

    return settings;
  }

  async updateSettings(organizationId: string, actorId: string, dto: UpdateReplySettingsDto) {
    const existing = await this.getSettings(organizationId);
    const updated = await (this.prisma as any).socialReplySetting.update({
      where: { id: existing.id },
      data: {
        aiAutoReplyEnabled: dto.aiAutoReplyEnabled ?? existing.aiAutoReplyEnabled,
        sendPrivateDm: dto.sendPrivateDm ?? existing.sendPrivateDm,
        autoHideSpam: dto.autoHideSpam ?? existing.autoHideSpam,
        replyDelaySeconds: dto.replyDelaySeconds ?? existing.replyDelaySeconds,
        tonePreference: dto.tonePreference ?? existing.tonePreference,
        bannedKeywords: dto.bannedKeywords ?? existing.bannedKeywords,
        salesOrderUrl: dto.salesOrderUrl !== undefined ? dto.salesOrderUrl : existing.salesOrderUrl,
        freeDeliveryThresholdMinor: dto.freeDeliveryThresholdMinor ? BigInt(dto.freeDeliveryThresholdMinor) : existing.freeDeliveryThresholdMinor,
        nightOwlEnabled: dto.nightOwlEnabled ?? existing.nightOwlEnabled,
        nightOwlMessage: dto.nightOwlMessage !== undefined ? dto.nightOwlMessage : existing.nightOwlMessage,
        urgentAlertTelegramEnabled: dto.urgentAlertTelegramEnabled ?? existing.urgentAlertTelegramEnabled,
        telegramChatId: dto.telegramChatId !== undefined ? dto.telegramChatId : existing.telegramChatId,
        telegramBotToken: dto.telegramBotToken !== undefined ? dto.telegramBotToken : existing.telegramBotToken,
        // CC27: record the CONFIGURING actor on the settings row
        // itself — the AI auto-reply deny gate reads exactly this
        // (see aiAutoReplyDenied). Default-minted rows keep null:
        // no human configured them, so no actor exists to deny.
        updatedById: actorId,
      },
    });

    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "social_comments.settings_updated",
      entityType: "SocialReplySetting",
      entityId: updated.id,
    });

    return updated;
  }

  // ----- IN8: Meta Graph layer for comment actions -----
  // Before IN8 every comment action below was DB-only: hide just
  // flipped the local status, "replies" were stored text that
  // never reached Meta, there was no delete path at all, and
  // isPrivateDmSent was set from the AI plan without any send.
  // Now each platform action goes through MetaMessagingClient's
  // Graph comment methods FIRST and the local row changes only
  // when Graph confirms (2xx + the documented confirmation body).
  // Graph failures surface verbatim and leave the row untouched.

  /** Integration providers that can carry a Page/IG comment token,
   * in preference order for the comment's platform. TikTok/YouTube
   * have no wired Graph comment path — honestly none. */
  private graphProvidersFor(platform: string): string[] {
    if (platform === "instagram") return ["instagram", "messenger", "meta"];
    if (platform === "facebook") return ["messenger", "meta", "instagram"];
    return [];
  }

  /** Seam for specs: build the real client (they substitute a
   * real client over a fake fetch, so the HTTP shape is proven). */
  protected createGraphClient(secrets: MessagingSecrets): MetaMessagingClient {
    return new MetaMessagingClient(secrets);
  }

  /**
   * CC27: the Integration a comment action for this platform
   * would actually send through — the SAME resolution
   * graphClientFor performs (provider preference order, newest
   * CONNECTED first). The deny gate checks the member against
   * THIS row: it is the connection the reply leaves through.
   * Null when no wired Graph path / no connected integration
   * exists (graphClientFor then produces its own honest error;
   * there is no target to deny).
   */
  private async resolveGraphIntegration(organizationId: string, platform: string): Promise<any | null> {
    const providers = this.graphProvidersFor(platform);
    if (!providers.length) return null;
    const findFirst = (this.prisma as any).integration?.findFirst;
    if (!findFirst) return null;
    return findFirst.call((this.prisma as any).integration, {
      where: { organizationId, provider: { in: providers }, status: "CONNECTED" },
      orderBy: { createdAt: "desc" },
      include: { credential: true },
    }).catch(() => null);
  }

  private async graphClientFor(organizationId: string, platform: string): Promise<MetaMessagingClient> {
    const providers = this.graphProvidersFor(platform);
    if (!providers.length) {
      throw new BadRequestException(`Meta Graph comment actions are not available for platform "${platform}" — no Graph comment API path is wired for it, so nothing was sent or changed`);
    }
    const integration = await this.resolveGraphIntegration(organizationId, platform);
    if (!integration?.credential) {
      throw new BadRequestException("No connected Meta (Messenger/Instagram) integration for this organization — the comment action cannot reach Meta Graph, so nothing was sent or changed");
    }
    const secrets = decryptJson<MessagingSecrets>(integration.credential.encryptedData);
    if (!secrets?.accessToken) throw new BadRequestException("The connected Meta integration has no access token — the comment action cannot reach Meta Graph, so nothing was sent or changed");
    return this.createGraphClient(secrets);
  }

  /**
   * CC27: human comment-reply deny gate. If the acting member is
   * denied the Integration this reply would be sent through,
   * refuse BEFORE any Graph call (the CC17 inbox discipline).
   * No resolvable integration → no gate (graphClientFor's own
   * error follows); OWNER is never denied (helper semantics).
   */
  private async assertCommentReplyAccess(organizationId: string, actorId: string, comment: any): Promise<void> {
    const integration = await this.resolveGraphIntegration(organizationId, comment.platform);
    if (!integration?.id) return;
    if (await isMemberConnectionDenied(this.prisma as any, organizationId, actorId, integration.id)) {
      throw new ForbiddenException("এই অ্যাকাউন্টে কমেন্টের উত্তর পাঠানোর অনুমতি আপনাকে দেওয়া হয়নি — Connect Center-এর অ্যাক্সেস সেটিংস দেখুন বা OWNER/ADMIN-কে বলুন।");
    }
  }

  /**
   * CC27: is the AI comment auto-reply DENIED for this platform?
   * The actor is the member recorded as having configured the
   * autopilot settings (SocialReplySetting.updatedById, written
   * by updateSettings since CC27). No recorded actor (default-
   * minted or pre-CC27 settings) → NOT denied and NOT gated:
   * there is nobody whose deny-list could apply, and inventing
   * an actor would be fake gating (documented in the B12
   * acceptance). Returns the denying integration id or null.
   */
  private async aiAutoReplyDeniedTarget(organizationId: string, settings: any, platform: string): Promise<string | null> {
    const actorId = settings?.updatedById ?? null;
    if (!actorId) return null;
    const integration = await this.resolveGraphIntegration(organizationId, platform);
    if (!integration?.id) return null;
    const denied = await isMemberConnectionDenied(this.prisma as any, organizationId, actorId, integration.id);
    return denied ? integration.id : null;
  }

  /** CC27: record an AI-reply suppression on the comment itself
   * (visible in its metadata, not a silent drop) + audit. The
   * comment stays PENDING — a human answers it. */
  private async recordAiReplySuppressed(organizationId: string, settings: any, comment: any, integrationId: string): Promise<void> {
    await (this.prisma as any).socialComment.update({
      where: { id: comment.id },
      data: {
        metadata: this.graphMeta(comment, {
          denySuppressed: {
            at: new Date().toISOString(),
            reason: "settings_actor_connection_denied",
            actorId: settings?.updatedById ?? null,
            integrationId,
          },
        }),
      },
    }).catch(() => undefined);
    await this.audit.log({
      organizationId, userId: "system", action: "social_comments.ai_reply_suppressed_denied",
      entityType: "SocialComment", entityId: comment.id,
      metadata: { actorId: settings?.updatedById ?? null, integrationId },
    }).catch(() => undefined);
  }

  private graphMeta(comment: any, patch: Record<string, unknown>): Record<string, unknown> {
    const meta = ((comment?.metadata as any) ?? {}) as Record<string, unknown>;
    return { ...meta, graph: { ...(((meta as any).graph as any) ?? {}), ...patch } };
  }

  /**
   * IN8c helper: send a private reply via Graph and, ONLY on
   * Graph confirmation, find/create the inbox conversation for
   * the commenter and attach a context NOTE (post + comment +
   * Graph id). No ChannelMessage is fabricated — the DM lives on
   * Meta; the note is our internal context record. Never throws:
   * the outcome is returned for honest recording by the caller.
   */
  private async attemptPrivateDm(
    organizationId: string,
    actorId: string,
    comment: any,
    messageText: string,
    client: MetaMessagingClient,
  ): Promise<{ sent: boolean; messageId?: string; conversationId?: string; error?: string }> {
    let messageId: string;
    try {
      messageId = (await client.privateReplyToComment(comment.externalCommentId, messageText)).messageId;
    } catch (e) {
      return { sent: false, error: e instanceof Error ? e.message : String(e) };
    }
    // Graph confirmed the DM. Link context in the inbox.
    try {
      const p = this.prisma as any;
      const channel = comment.platform === "instagram" ? "instagram" : "messenger";
      const externalContactId = comment.authorSocialId || `comment:${comment.externalCommentId}`;
      let conv = await p.channelConversation?.findFirst?.({ where: { organizationId, channel, externalContactId } }).catch(() => null);
      if (!conv && p.channelConversation?.create) {
        conv = await p.channelConversation.create({
          data: {
            organizationId, channel, externalContactId,
            contactName: comment.authorName ?? null, status: "open",
          },
        });
      }
      if (conv?.id && p.conversationNote?.create) {
        await p.conversationNote.create({
          data: {
            organizationId, conversationId: conv.id, authorUserId: actorId || "system",
            content: `Comment → DM (IN8): private reply sent from a ${comment.platform} comment on post ${comment.externalPostId}${comment.postTitle ? ` ("${comment.postTitle}")` : ""}. Comment by ${comment.authorName}: "${String(comment.commentText ?? "").slice(0, 300)}" — Graph private reply id ${messageId}.`,
          },
        }).catch(() => undefined);
      }
      return { sent: true, messageId, conversationId: conv?.id };
    } catch (e) {
      // The DM itself WAS confirmed by Graph; only our context
      // link failed — report both facts, never hide either.
      return { sent: true, messageId, error: `DM confirmed by Meta (id ${messageId}) but linking its inbox conversation failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * IN8a/IN8d: the ingest auto-hide (hide-words / spam) now goes
   * through the same Graph layer as a manual hide. The local
   * HIDDEN status stays immediate (it is the safety action), but
   * the Graph outcome is recorded verbatim on metadata.graphHide —
   * ok:false with Meta's (or the no-integration) error means the
   * comment is hidden in OUR queue only, and the record says so.
   * Never throws: webhook ingest must not break on this.
   */
  private async attemptGraphAutoHide(organizationId: string, comment: any): Promise<any> {
    try {
      if ((comment.metadata as any)?.graphHide?.ok) return comment;
      let outcome: Record<string, unknown>;
      try {
        const client = await this.graphClientFor(organizationId, comment.platform);
        await client.setCommentHidden(comment.externalCommentId, true);
        outcome = { attempted: true, ok: true, at: new Date().toISOString(), source: "auto_hide" };
      } catch (e) {
        outcome = { attempted: true, ok: false, error: e instanceof Error ? e.message : String(e), at: new Date().toISOString(), source: "auto_hide" };
      }
      const updated = await (this.prisma as any).socialComment.update({
        where: { id: comment.id },
        data: { metadata: { ...((comment.metadata as any) ?? {}), graphHide: outcome } },
      }).catch(() => null);
      return updated ?? comment;
    } catch {
      return comment;
    }
  }

  async listComments(organizationId: string, query: ListCommentsQueryDto) {
    const where: any = { organizationId };
    if (query.platform) where.platform = query.platform;
    if (query.status) where.status = query.status;
    if (query.sentiment) where.sentiment = query.sentiment;
    if (query.intent) where.intent = query.intent;
    // IN8b: the comments queue supports assignment filtering —
    // a specific assignee, or the unassigned pile.
    if (query.assignedUserId) where.assignedUserId = query.assignedUserId;
    if (String((query as any).unassigned ?? "") === "true") where.assignedUserId = null;
    if (query.search) {
      where.OR = [
        { commentText: { contains: query.search, mode: "insensitive" } },
        { authorName: { contains: query.search, mode: "insensitive" } },
        { postTitle: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(query.limit || 25)));
    const skip = (page - 1) * limit;

    const [items, total, pendingCount, spamCount, hiddenCount, hiddenSpamCount] = await Promise.all([
      (this.prisma as any).socialComment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      (this.prisma as any).socialComment.count({ where }),
      (this.prisma as any).socialComment.count({ where: { organizationId, status: "PENDING" } }),
      (this.prisma as any).socialComment.count({ where: { organizationId, sentiment: "SPAM" } }),
      // IN8d: the auto-hide report is counted from real rows only:
      // hiddenCount = every locally HIDDEN comment; hiddenSpamCount
      // = the spam-classified subset (the auto-hide population).
      // Per-comment Graph confirmation lives on metadata.graphHide.
      (this.prisma as any).socialComment.count({ where: { organizationId, status: "HIDDEN" } }).catch(() => 0),
      (this.prisma as any).socialComment.count({ where: { organizationId, status: "HIDDEN", sentiment: "SPAM" } }).catch(() => 0),
    ]);

    return {
      items,
      total,
      page,
      limit,
      stats: {
        pendingCount,
        spamCount,
        hiddenCount,
        hiddenSpamCount,
      },
    };
  }

  /**
   * CX3: the reply-plan computation shared by ingest and the
   * due-comment sweep — classification, product match, night-owl
   * flag and the humanizer plan for a (possibly batched) comment
   * text. Pure planning: no writes, no alerts, no leads; those
   * side effects stay in ingestComment, immediate and unchanged.
   */
  private async buildReplyPlan(organizationId: string, settings: any, input: { authorName: string; commentText: string; postTitle?: string }) {
    const classification = CommentClassifier.classify(input.commentText, settings.bannedKeywords);

    // Enhanced Multi-Product Smart Auto-Detector:
    // First, check if the customer specifically mentioned any product name in their comment text
    let matchedProduct: any = null;
    const prods = await (this.prisma as any).product.findMany({
      where: { organizationId, status: "ACTIVE" },
      take: 20,
    });

    const commentWords = input.commentText.toLowerCase();
    for (const p of prods) {
      if (commentWords.includes(p.name.toLowerCase())) {
        matchedProduct = {
          // SA-B8: the live row's id rides along so the grounded
          // compose can record the product as an Answer Store
          // source (its live price is then re-verified at serve
          // time, SA-B3). The humanizer ignores the extra field.
          id: p.id,
          name: p.name,
          priceFormatted: formatMinor(BigInt(p.priceMinor), p.currency || "BDT"),
          orderUrl: p.slug ? `/checkout/${p.slug}` : (settings.salesOrderUrl || undefined),
        };
        break;
      }
    }

    // Fallback: match by post title keywords if no specific product was mentioned in comment
    if (!matchedProduct && input.postTitle) {
      const words = input.postTitle.toLowerCase().split(/\s+/);
      for (const p of prods) {
        if (words.some((w: string) => p.name.toLowerCase().includes(w))) {
          matchedProduct = {
            id: p.id,
            name: p.name,
            priceFormatted: formatMinor(BigInt(p.priceMinor), p.currency || "BDT"),
            orderUrl: p.slug ? `/checkout/${p.slug}` : (settings.salesOrderUrl || undefined),
          };
          break;
        }
      }
    }

    // Determine if it's Night-Owl time (12:00 AM - 8:00 AM in Bangladesh / Local)
    const currentHour = new Date().getHours();
    const isNightOwl = settings.nightOwlEnabled && (currentHour >= 0 && currentHour < 8);

    const aiPlan = CommentHumanizer.generateHumanReply({
      authorName: input.authorName,
      commentText: input.commentText,
      classification,
      postTitle: input.postTitle,
      matchedProduct,
      tonePreference: settings.tonePreference,
      isNightOwl,
    });

    return { classification, matchedProduct, isNightOwl, aiPlan };
  }

  /**
   * SA-B8 (R2): assemble the comment fact set from the Org
   * Brain — the same surfaces the inbox fact pack uses (public
   * profile fact lines, policies, audience-filtered knowledge
   * matches, semantic product knowledge) PLUS the live matched
   * product's price line, which buildReplyPlan read from the
   * LIVE product row (price/stock are never indexed — the SA-B2
   * rule). The number guard admits a grounded comment reply
   * only when every number in it appears in these lines.
   * Deliberately NOT assembled here: brain.customerMemoryFacts
   * — a comment reply is a PUBLIC post, so the commenter's own
   * memory facts (CUSTOMER-OWN class, L3) never enter its fact
   * set; the memory is read for language preference only (see
   * composeGroundedCommentReply).
   */
  private buildCommentFacts(brain: any, matchedProduct: any): { factsText: string; sources: { docIds: string[]; productIds: string[]; policyIds: string[]; profileAreas: string[] } } {
    const lines: string[] = [];
    const docIds: string[] = [];
    const productIds: string[] = [];
    const policyIds: string[] = [];
    const profileAreas: string[] = [];
    if (brain?.orgName) lines.push(`ব্যবসার নাম: ${brain.orgName}`);
    lines.push(...(brain?.facts ?? []));
    if ((brain?.deliveryFacts ?? []).length) profileAreas.push("delivery");
    if ((brain?.paymentFacts ?? []).length) profileAreas.push("payment");
    if ((brain?.contactFacts ?? []).length || (brain?.hoursFacts ?? []).length) profileAreas.push("contact_hours");
    for (const policy of (brain?.policies ?? []).slice(0, 5)) {
      if (!policy?.content) continue;
      lines.push(`নীতি (${String(policy.title ?? policy.policyType ?? "সাধারণ")}): ${String(policy.content).replace(/\s+/g, " ").slice(0, 300)}`);
      if (policy.id) policyIds.push(String(policy.id));
    }
    for (const m of brain?.knowledgeMatches ?? []) {
      lines.push(`জ্ঞানভান্ডার (${m.title}): ${String(m.content).replace(/\s+/g, " ").slice(0, 400)}`);
      if (m.docId) docIds.push(String(m.docId));
    }
    for (const pm of brain?.productMatches ?? []) {
      lines.push(`পণ্যের তথ্য (${pm.name}): ${String(pm.content).replace(/\s+/g, " ").slice(0, 400)}`);
      if (pm.productId) productIds.push(String(pm.productId));
    }
    if (matchedProduct?.name) {
      lines.push(`পণ্য: ${matchedProduct.name}`);
      if (matchedProduct.priceFormatted) lines.push(`দাম: ${matchedProduct.priceFormatted}`);
      if (matchedProduct.id) productIds.push(String(matchedProduct.id));
    }
    return { factsText: lines.join("\n"), sources: { docIds, productIds, policyIds, profileAreas } };
  }

  /** SA-B8: usage rows for the comment autopilot's Brain paths,
   * in the same AIUsageRecord ledger the inbox uses (a store hit
   * is a zero-token "answer_store_hit" row so the saving stays
   * visible; an LLM compose is "comment_autopilot"). Fully
   * guarded — accounting never breaks a reply. */
  private async recordCommentUsage(organizationId: string, row: { feature: string; provider: string; inputTokens: number; outputTokens: number; estimated?: boolean }): Promise<void> {
    try {
      await (this.prisma as any).aIUsageRecord?.create?.({
        data: { organizationId, userId: "system", feature: row.feature, provider: row.provider, model: null, inputTokens: row.inputTokens ?? 0, outputTokens: row.outputTokens ?? 0, estimated: row.estimated ?? false },
      })?.catch?.(() => undefined);
    } catch { /* usage accounting never breaks a reply */ }
  }

  /**
   * SA-B8 (R2): capture a guard-passed, actually-posted grounded
   * comment answer into the Answer Store (channel "comment"),
   * so the next identical or paraphrased comment can be served
   * without an LLM call under the store's own live
   * re-verification (SA-B3). Fire-and-forget; the store screens
   * eligibility + PII itself, so an answer carrying personal
   * data is refused there, never stored. The deterministic
   * humanizer plan is never captured — the same rule as the
   * inbox's deterministic tier (it is recomputed from live rows
   * every time).
   */
  private captureCommentAnswer(organizationId: string, question: string, grounded: { text: string; sources: { docIds: string[]; productIds: string[]; policyIds: string[]; profileAreas: string[] } }): void {
    void this.answerStoreSvc()
      .store(organizationId, {
        question,
        answer: grounded.text,
        channel: "comment",
        language: detectReplyLanguage(question),
        sourceRefs: grounded.sources,
        origin: "autopilot_grounded",
        flags: { audience: "customer", customerOwn: false, personalized: false },
      })
      .catch(() => undefined);
  }

  /**
   * SA-B8 (R2): the Brain-grounded compose for the comment
   * autopilot — the comment surface joins the one Brain every
   * other AI surface already reads (Master Plan Phase 1, R2).
   *
   * Attempt order (the SA-B3/SA-B7 discipline):
   *  1. Answer Store, channel "comment" — a hit serves only
   *     after the store's own live re-verification AND the same
   *     deterministic number guard the inbox runs, here against
   *     the fresh Brain fact set; a guard failure retires the
   *     entry and the compose proceeds to the model.
   *  2. The org's LLM over an OrgBrainService context — facts
   *     only, NO_ANSWER honoured, the number guard applied to
   *     the model's text before anything may be posted.
   * A guard failure on the MODEL's text returns { blocked }:
   * the caller must NOT fall back to the humanizer (that would
   * post a different text to dodge the guard) — the comment
   * routes to the human moderation queue instead. Every other
   * failure (no Brain, no real LLM, NO_ANSWER, provider error,
   * no verified facts) returns null and the caller uses the
   * pre-SA-B8 humanizer plan unchanged — an org without a
   * working LLM sees exactly today's behaviour.
   *
   * Confidentiality (L3): the facts come from a CUSTOMER-class
   * Brain context — internal documents and internal profile
   * fields never enter it. The audience is "own_customer" when
   * the commenter resolves to a memory key (the same identity
   * the DM linking uses: <instagram|messenger>:<authorSocialId>),
   * but the memory contributes ONLY its language preference —
   * its fact lines are never added to a public reply's fact set
   * (see buildCommentFacts), and the prompt instructs the model
   * to deflect personal/order questions to the inbox.
   */
  private async composeGroundedCommentReply(
    organizationId: string,
    input: {
      comment: any;
      commentText: string;
      plan: { classification: any; matchedProduct: any; isNightOwl: boolean; aiPlan: any };
      allowStore: boolean;
      storeQuestion?: string;
    },
  ): Promise<{ text: string; via: "answer_store" | "llm"; sources: { docIds: string[]; productIds: string[]; policyIds: string[]; profileAreas: string[] } } | { blocked: true; inventedNumbers: string[] } | null> {
    const { comment, plan } = input;
    // Night-owl is a deliberate holding behaviour (the office is
    // closed; the humanizer's assurance reply + DM carry it).
    // The grounded compose never overrides it.
    if (plan.isNightOwl) return null;
    const channel = comment.platform === "instagram" ? "instagram" : "messenger";
    const customerKey = comment.authorSocialId ? `${channel}:${String(comment.authorSocialId)}` : null;
    const brain = await this.brainSvc()
      .getContext(organizationId, {
        audience: customerKey ? "own_customer" : "customer",
        query: input.commentText,
        ...(customerKey ? { customerKey } : {}),
      })
      .catch(() => null);
    if (!brain) return null;
    const { factsText, sources } = this.buildCommentFacts(brain, plan.matchedProduct);
    const allowedNumbers = new Set(extractGuardNumbers(factsText));
    const language = detectReplyLanguage(input.storeQuestion ?? input.commentText);

    // 1) Answer Store (channel "comment").
    if (input.allowStore && input.storeQuestion) {
      const hit = await this.answerStoreSvc()
        .lookup(organizationId, input.storeQuestion, { channel: "comment", language })
        .catch(() => null);
      if (hit?.hit) {
        const invented = extractGuardNumbers(hit.answer).filter((n) => !allowedNumbers.has(n));
        if (!invented.length) {
          await this.recordCommentUsage(organizationId, { feature: "answer_store_hit", provider: "answer_store", inputTokens: 0, outputTokens: 0, estimated: false });
          return { text: String(hit.answer).slice(0, 1000), via: "answer_store", sources };
        }
        await this.answerStoreSvc().invalidate(organizationId, hit.entryId, "number_guard_failed").catch(() => undefined);
      }
    }

    // 2) LLM compose over the Brain context.
    if (!this.llm) return null;
    let provider: any;
    try { provider = await providerForOrg(this.llm, organizationId); } catch { return null; }
    if (!provider?.isRealLlm) return null;
    if (!factsText.trim()) return null; // nothing verified to ground on — the humanizer plan stands
    const memoryLanguage = (brain as any).customerMemory?.languagePref;
    const detected = detectReplyLanguage(input.commentText);
    const result = await provider.complete([
      {
        role: "system",
        content: [
          "You are the social-media assistant of a Bangladeshi ecommerce business, writing a public reply under a social-media post.",
          "Write ONE short, friendly public comment reply (1-3 sentences). Answer using ONLY the verified facts below. Never invent prices, stock, discounts, delivery times or promises.",
          "This reply is PUBLIC: never include any customer's personal information, order status, phone number or address. If the commenter asks about their own order or anything personal, politely invite them to message the page inbox instead — never ask anyone to post personal details publicly.",
          "If the facts do not answer the question, reply with exactly: NO_ANSWER",
          ...((brain as any).ownerInstructions ? ["", `Owner's standing instructions for tone and conduct (never override the verified facts): ${String((brain as any).ownerInstructions).slice(0, 1000)}`] : []),
          // SA-B9 (R3): the shared reply-quality block replaces
          // this prompt's own style spread + three-branch
          // language logic — the same resolver and rendering
          // every channel now uses (explicit org language ->
          // detected -> remembered preference -> Bengali
          // default; the learned voice inside the block under
          // its SA-B5 label). One nuance improves: with the org
          // language on "auto" the remembered preference now
          // applies even when a stale non-bn/en value used to
          // suppress every language line. The publicness and
          // length rules above stay local — they are comment-
          // specific, not quality rules.
          "",
          ...buildReplyQualityBlock({
            language: resolveReplyLanguage({
              orgReplyLanguage: brain.replyLanguage ?? null,
              detected,
              memoryLanguagePref: memoryLanguage ?? null,
            }),
            styleInstructions: (brain as any).styleInstructions ?? null,
            platformGuidance: (brain as any).platformGuidance ?? null,
            channel: "comment",
          }),
          "",
          "VERIFIED FACTS:",
          factsText,
        ].join("\n"),
      },
      { role: "user", content: input.commentText },
    ], { maxTokens: 300 }).catch(() => null);
    if (!result) return null;
    await this.recordCommentUsage(organizationId, { feature: "comment_autopilot", provider: provider.name, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimated: result.tokensEstimated });
    const reply = String(result.text ?? "").trim();
    if (!reply || reply.toUpperCase().includes("NO_ANSWER")) return null;
    const invented = extractGuardNumbers(reply).filter((n) => !allowedNumbers.has(n));
    if (invented.length) {
      await this.audit.log({
        organizationId, userId: "system", action: "social_comments.guard_rejected", entityType: "SocialComment",
        entityId: comment.id, metadata: { inventedNumbers: invented },
      }).catch(() => undefined);
      return { blocked: true, inventedNumbers: invented };
    }
    return { text: reply.slice(0, 1000), via: "llm", sources };
  }

  /**
   * SA-B12 (W3): the number-guard check the Action Engine's
   * reply_to_comment executor runs at EXECUTION time, before an
   * approved reply text may be posted. An approval can age: the
   * text was approved against the facts of its moment, and a
   * price that moved since would make it a stale claim. This
   * re-assembles the comment fact set EXACTLY as the SA-B8
   * grounded compose does (Org Brain context for the comment,
   * audience-filtered, plus the LIVE matched product's lines —
   * buildCommentFacts never includes the commenter's own memory
   * facts, so the check is over public facts only) and returns
   * every number in the candidate text that the fresh fact set
   * does not support. An empty list means the text may post; a
   * non-empty list means the executor must fail the proposal and
   * post NOTHING (the engine records the failure verbatim).
   * A text with no numbers passes trivially — the same
   * discipline the compose guard applies to model output.
   */
  async checkCommentReplyGuard(
    organizationId: string,
    commentId: string,
    replyText: string,
  ): Promise<{ inventedNumbers: string[] }> {
    const comment = await (this.prisma as any).socialComment.findFirst({
      where: { id: commentId, organizationId },
    });
    if (!comment) throw new NotFoundException("Comment not found");
    const settings = await this.getSettings(organizationId);
    const plan = await this.buildReplyPlan(organizationId, settings, {
      authorName: comment.authorName,
      commentText: String(comment.commentText ?? ""),
      postTitle: comment.postTitle ?? undefined,
    });
    const channel = comment.platform === "instagram" ? "instagram" : "messenger";
    const customerKey = comment.authorSocialId ? `${channel}:${String(comment.authorSocialId)}` : null;
    const brain = await this.brainSvc()
      .getContext(organizationId, {
        audience: customerKey ? "own_customer" : "customer",
        query: String(comment.commentText ?? ""),
        ...(customerKey ? { customerKey } : {}),
      })
      .catch(() => null);
    const { factsText } = this.buildCommentFacts(brain, plan.matchedProduct);
    const allowedNumbers = new Set(extractGuardNumbers(factsText));
    return { inventedNumbers: extractGuardNumbers(replyText).filter((n) => !allowedNumbers.has(n)) };
  }

  /**
   * CX12d: does the channel-wise AI schedule (InboxSetting.
   * aiScheduleByChannel, organization timezone) currently block
   * AI replies for this comment platform? facebook/instagram use
   * the same channel keys as the inbox; other platforms simply
   * have no entry unless the owner added one. Defensive: missing
   * rows or a corrupt stored value -> not blocked.
   */
  private async aiScheduleBlocksFor(organizationId: string, platform: string): Promise<boolean> {
    try {
      const row = await (this.prisma as any).inboxSetting?.findUnique?.({ where: { organizationId } }).catch(() => null);
      if (!row?.aiScheduleByChannel) return false;
      let map: Record<string, any> = {};
      try { map = parseAiSchedule(row.aiScheduleByChannel); } catch { return false; }
      if (!map[platform]) return false;
      const org = await (this.prisma as any).organization?.findUnique?.({ where: { id: organizationId }, select: { timezone: true } }).catch(() => null);
      return aiScheduleBlocks(map, platform, new Date(), org?.timezone || "Asia/Dhaka");
    } catch { return false; }
  }

  async ingestComment(organizationId: string, dto: IngestExternalCommentDto) {
    const settings = await this.getSettings(organizationId);
    // CX12d: the schedule gates ONLY the AI reply plan's
    // application — classification/hide, Telegram alerts and lead
    // creation below are unaffected.
    const aiReplyEffective = settings.aiAutoReplyEnabled && !(await this.aiScheduleBlocksFor(organizationId, dto.platform));
    const { classification, matchedProduct, isNightOwl, aiPlan } = await this.buildReplyPlan(organizationId, settings, {
      authorName: dto.authorName,
      commentText: dto.commentText,
      postTitle: dto.postTitle,
    });

    // Initial status determination — hide/spam is a SAFETY action
    // and stays immediate under CX3: it never waits for the delay.
    let initialStatus = "PENDING";
    if (classification.shouldHideOrDelete && settings.autoHideSpam) {
      initialStatus = "HIDDEN";
    }

    const comment = await (this.prisma as any).socialComment.upsert({
      where: {
        organizationId_externalCommentId: {
          organizationId,
          externalCommentId: dto.externalCommentId,
        },
      },
      update: {
        commentText: dto.commentText,
        sentiment: classification.sentiment,
        intent: classification.intent,
      },
      create: {
        organizationId,
        platform: dto.platform,
        externalPostId: dto.externalPostId,
        externalCommentId: dto.externalCommentId,
        postTitle: dto.postTitle,
        postMediaUrl: dto.postMediaUrl,
        authorName: dto.authorName,
        authorAvatarUrl: dto.authorAvatarUrl,
        authorSocialId: dto.authorSocialId,
        commentText: dto.commentText,
        sentiment: classification.sentiment,
        intent: classification.intent,
        status: initialStatus,
        // CX3: with a reply delay configured, the reply is NOT
        // applied at ingest — the plan is retained (metadata +
        // privateDmText) and aiReplyDueAt schedules the sweep
        // that will compose the final (possibly batched) reply.
        // IN8: even with delay 0 the reply is no longer "applied"
        // here — the row is created unreplied and
        // attemptInstantGraphReply (below, right after the
        // upsert) posts it through Graph; replyText/repliedAt/
        // isPrivateDmSent are set only on Graph confirmation.
        replyText: null,
        repliedAt: null,
        isPrivateDmSent: false,
        privateDmText: aiPlan.privateDmText,
        aiReplyDueAt: aiReplyEffective && initialStatus !== "HIDDEN" && settings.replyDelaySeconds > 0 ? new Date(Date.now() + settings.replyDelaySeconds * 1000) : null,
        confidenceScore: classification.confidenceScore,
        metadata: {
          aiPlanned: aiPlan,
          matchedProduct,
          isNightOwl,
        },
      },
    });

    // SA-B12 (W3) Trigger E announcement: a SPAM-classified
    // comment with a resolvable author. The Action Engine's
    // proposer counts the author's spam rows and proposes a
    // delete only at the repeat threshold — ingest itself does
    // nothing more (the auto-hide above already happened; that
    // act is never re-proposed). Fire-and-forget, isolated
    // exactly like every neighbouring emit.
    if (classification.sentiment === "SPAM" && dto.authorSocialId) {
      try {
        this.events?.emit("comment.spam_flagged", {
          organizationId,
          context: { commentId: comment.id, authorSocialId: dto.authorSocialId },
        });
      } catch { /* a trigger failure never affects ingest */ }
    }

    // Urgent Alert Bot Dispatcher: If complaint or high priority, send Telegram notification
    if (settings.urgentAlertTelegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
      if (classification.isHighPriorityComplaint || classification.intent === "COMPETITOR_MENTION") {
        this.dispatchUrgentTelegramAlert(settings.telegramBotToken, settings.telegramChatId, {
          platform: dto.platform,
          authorName: dto.authorName,
          commentText: dto.commentText,
          intent: classification.intent,
          postTitle: dto.postTitle,
        }).catch(() => undefined);
      }
    }

    // IN8: a comment hidden at ingest (hide-word / spam, with
    // autoHideSpam on) is ALSO hidden through the Graph layer;
    // the outcome is recorded on metadata.graphHide either way.
    let finalComment = comment;
    if (initialStatus === "HIDDEN") {
      finalComment = await this.attemptGraphAutoHide(organizationId, comment);
    } else if (aiReplyEffective && !(settings.replyDelaySeconds > 0) && !finalComment.replyText && finalComment.status === "PENDING") {
      // IN8: delay-0 instant reply — posted through Graph now
      // (attemptInstantGraphReply records/re-due on failure).
      // The guards keep a webhook redelivery of an already
      // replied comment from ever sending twice.
      finalComment = await this.attemptInstantGraphReply(organizationId, settings, finalComment, { classification, matchedProduct, isNightOwl, aiPlan });
    }

    // Auto-create Lead in CRM if intent is PRICE_QUERY or BARGAIN (High-intent buyer prospect)
    if (classification.intent === "PRICE_QUERY" || classification.intent === "PRODUCT_INFO" || classification.intent === "BARGAIN") {
      try {
        const leadSource = `${dto.platform.toUpperCase()} Comment`;
        await (this.prisma as any).lead.create({
          data: {
            organizationId,
            fullName: dto.authorName || "Social Lead",
            source: leadSource,
            stage: "NEW",
            status: "OPEN",
            score: classification.intent === "BARGAIN" ? 85 : 75,
            notes: `Auto-captured from ${dto.platform} comment on post: "${dto.postTitle || dto.externalPostId}". Intent: ${classification.intent}. Question: "${dto.commentText}"`,
          },
        }).catch(() => undefined);
      } catch {
        // ignore CRM lead creation errors
      }
    }

    return finalComment;
  }

  /**
   * SA-B12 (W3) Trigger F announcement: a COMPLAINT comment's
   * public reply has just been posted — the humanizer's
   * complaint plan IS the DM-invitation case (publicly: "tell
   * us your order number in the inbox"; privately: a drafted
   * follow-up DM) — but the drafted private reply was NOT sent
   * in this pass (the org's sendPrivateDm setting is off, or
   * the Graph DM attempt failed and its error is recorded on
   * the comment). Announce it so the Action Engine can propose
   * send_dm_to_commenter with the plan's own drafted text for a
   * human to approve — the follow-through W3 names. Silent in
   * every other case: non-complaint intents are answered
   * publicly in full; a DM that was sent needs no follow-up;
   * a comment already DM'd (Meta's one-per-comment rule) can
   * never take another. Fire-and-forget, never throws.
   */
  private emitCommentDmFollowup(organizationId: string, comment: any, plan: any, dmSent: boolean): void {
    try {
      if (dmSent) return;
      if (comment?.isPrivateDmSent) return;
      const intent = plan?.classification?.intent ?? comment?.intent;
      if (intent !== "COMPLAINT") return;
      const privateDmText = plan?.aiPlan?.privateDmText ?? comment?.privateDmText;
      if (!privateDmText) return;
      this.events?.emit("comment.dm_followup_needed", {
        organizationId,
        context: { commentId: comment.id, intent, privateDmText },
      });
    } catch { /* a trigger failure never affects the reply flow */ }
  }

  /**
   * IN8: the delay-0 ingest reply, posted through Graph at
   * ingest. Uses the plan ingest already composed. On Graph
   * confirmation the row gets exactly the values the pre-IN8
   * instant path stored (replyText, repliedAt, DM flag) plus the
   * Graph ids. On failure the row stays PENDING/unreplied, the
   * verbatim error is recorded, and the comment is re-due in 60s
   * so the CX3 sweep retries it (attempts capped there at 3).
   * Never throws — webhook ingest must not break on a send.
   */
  private async attemptInstantGraphReply(organizationId: string, settings: any, comment: any, plan: any): Promise<any> {
    const aiPlan = plan.aiPlan;
    // CC27: AI auto-reply deny gate — the settings' recorded
    // configuring actor is denied the account this reply would
    // leave through → no Graph call; the suppression is recorded
    // on the comment and it stays PENDING for a human.
    const deniedTarget = await this.aiAutoReplyDeniedTarget(organizationId, settings, comment.platform).catch(() => null);
    if (deniedTarget) {
      await this.recordAiReplySuppressed(organizationId, settings, comment, deniedTarget);
      return comment;
    }
    // SA-B8 (R2): the Brain-grounded compose gets its chance
    // before the humanizer plan is posted. A guard rejection is
    // terminal for the AI here: NOTHING is posted (not the
    // model's text, and not the humanizer plan as a dodge) and
    // the comment stays PENDING in the moderation queue with
    // the rejection recorded on it.
    const grounded = await this.composeGroundedCommentReply(organizationId, {
      comment,
      commentText: String(comment.commentText ?? ""),
      plan,
      allowStore: true,
      storeQuestion: String(comment.commentText ?? ""),
    }).catch(() => null);
    if (grounded && "blocked" in grounded) {
      const updated = await (this.prisma as any).socialComment.update({
        where: { id: comment.id },
        data: {
          metadata: this.graphMeta(comment, {
            guardBlocked: { at: new Date().toISOString(), inventedNumbers: grounded.inventedNumbers },
          }),
        },
      }).catch(() => null);
      return updated ?? comment;
    }
    const groundedOk = grounded && "text" in grounded ? grounded : null;
    const replyText = groundedOk ? groundedOk.text : aiPlan.publicCommentReply;
    try {
      let client: MetaMessagingClient;
      let graphReplyId: string;
      try {
        client = await this.graphClientFor(organizationId, comment.platform);
        graphReplyId = (await client.replyToComment(comment.externalCommentId, replyText)).commentId;
      } catch (e) {
        const updated = await (this.prisma as any).socialComment.update({
          where: { id: comment.id },
          data: {
            aiReplyDueAt: new Date(Date.now() + 60_000),
            metadata: this.graphMeta(comment, {
              replyError: e instanceof Error ? e.message : String(e),
              replyAttempts: 1,
              replyErrorAt: new Date().toISOString(),
            }),
          },
        }).catch(() => null);
        return updated ?? comment;
      }
      let dm: { sent: boolean; messageId?: string; conversationId?: string; error?: string } = { sent: false };
      if (settings.sendPrivateDm && aiPlan.shouldSendDm && aiPlan.privateDmText) {
        dm = await this.attemptPrivateDm(organizationId, "system", comment, aiPlan.privateDmText, client);
      }
      const updated = await (this.prisma as any).socialComment.update({
        where: { id: comment.id },
        data: {
          replyText,
          repliedAt: new Date(),
          isPrivateDmSent: dm.sent,
          ...(dm.conversationId ? { dmConversationId: dm.conversationId } : {}),
          metadata: this.graphMeta(comment, {
            replyId: graphReplyId,
            repliedAt: new Date().toISOString(),
            ...(groundedOk ? { groundedVia: groundedOk.via } : {}),
            ...(dm.messageId ? { privateReplyId: dm.messageId } : {}),
            ...(dm.error ? { privateReplyError: dm.error } : {}),
          }),
        },
      }).catch(() => null);
      if (groundedOk?.via === "llm") {
        this.captureCommentAnswer(organizationId, String(comment.commentText ?? ""), groundedOk);
      }
      // SA-B12 Trigger F: the public reply is out; if this was
      // a complaint and its drafted DM did not go with it, the
      // engine gets its follow-up proposal moment.
      this.emitCommentDmFollowup(organizationId, comment, plan, dm.sent);
      return updated ?? comment;
    } catch {
      return comment;
    }
  }

  /**
   * CX3: apply a due comment's AI reply. Batching: earlier
   * still-pending comments by the SAME author on the SAME post
   * are claimed into this reply (their aiReplyBatchOf points at
   * this comment) and discharged as AUTO_REPLIED with a
   * metadata pointer — ONE reply, composed from the combined
   * text, covers the whole burst. This is the seam a later
   * package item gates with the channel AI schedule: keep any
   * pre-reply check immediately before calling this method.
   */
  private async applyDueCommentReply(organizationId: string, settings: any, fresh: any): Promise<{ batched: number; graphFailed?: boolean; guardBlocked?: boolean }> {
    const p = this.prisma as any;
    const earlier = await p.socialComment.findMany({
      where: {
        organizationId,
        externalPostId: fresh.externalPostId,
        status: "PENDING",
        aiReplyDueAt: { not: null },
        createdAt: { lt: fresh.createdAt },
        ...(fresh.authorSocialId ? { authorSocialId: fresh.authorSocialId } : { authorName: fresh.authorName }),
      },
      orderBy: { createdAt: "asc" },
    }).catch(() => []);
    const batchText = [...(earlier as any[]), fresh].map((c: any) => c.commentText).join("\n").slice(0, 1200);
    const plan = await this.buildReplyPlan(organizationId, settings, {
      authorName: fresh.authorName,
      commentText: batchText,
      postTitle: fresh.postTitle ?? undefined,
    });
    // SA-B8 (R2): the Brain-grounded compose gets its chance
    // before the humanizer plan is posted (facts from the Brain
    // for the COMBINED batch text; the Answer Store only for a
    // single-comment fire — the store is keyed to single
    // questions, a batch is a composite). A guard rejection is
    // terminal for the AI on this comment: nothing is posted,
    // the firing comment stays PENDING for a human (its due
    // stamp was already claimed — the CX12d drop semantics),
    // the rejection is recorded on it, and the earlier comments
    // keep their own due stamps to be judged on their own
    // merits by a later sweep.
    const grounded = await this.composeGroundedCommentReply(organizationId, {
      comment: fresh,
      commentText: batchText,
      plan,
      allowStore: (earlier as any[]).length === 0,
      storeQuestion: String(fresh.commentText ?? ""),
    }).catch(() => null);
    if (grounded && "blocked" in grounded) {
      await p.socialComment.update({
        where: { id: fresh.id },
        data: {
          metadata: this.graphMeta(fresh, {
            guardBlocked: { at: new Date().toISOString(), inventedNumbers: grounded.inventedNumbers },
          }),
        },
      }).catch(() => undefined);
      return { batched: 0, guardBlocked: true };
    }
    const groundedOk = grounded && "text" in grounded ? grounded : null;
    const publicReplyText = groundedOk ? groundedOk.text : plan.aiPlan.publicCommentReply;
    // IN8: the reply is POSTED through the Graph layer first.
    // Only a Graph-confirmed reply may mark anything AUTO_REPLIED
    // (before IN8 this stored reply text that never left our DB).
    // On failure nothing is claimed or marked: the error is
    // recorded verbatim and the comment is re-due in 60s, up to
    // 3 attempts, after which it stays PENDING for a human.
    let client: MetaMessagingClient;
    let graphReplyId: string;
    try {
      client = await this.graphClientFor(organizationId, fresh.platform);
      graphReplyId = (await client.replyToComment(fresh.externalCommentId, publicReplyText)).commentId;
    } catch (e) {
      const attempts = Number(((fresh.metadata as any)?.graph?.replyAttempts ?? 0)) + 1;
      await p.socialComment.update({
        where: { id: fresh.id },
        data: {
          aiReplyDueAt: attempts < 3 ? new Date(Date.now() + 60_000) : null,
          metadata: this.graphMeta(fresh, {
            replyError: e instanceof Error ? e.message : String(e),
            replyAttempts: attempts,
            replyErrorAt: new Date().toISOString(),
          }),
        },
      }).catch(() => undefined);
      return { batched: 0, graphFailed: true };
    }
    const covered: any[] = [];
    for (const e of earlier as any[]) {
      const c = await p.socialComment.updateMany({
        where: { id: e.id, aiReplyDueAt: e.aiReplyDueAt },
        data: { aiReplyDueAt: null, aiReplyBatchOf: fresh.externalCommentId },
      }).catch(() => ({ count: 0 }));
      if (c?.count) covered.push(e);
    }
    // IN8c: the plan's private DM is a real Graph private reply
    // now — isPrivateDmSent is set only when Meta confirms it.
    let dm: { sent: boolean; messageId?: string; conversationId?: string; error?: string } = { sent: false };
    if (settings.sendPrivateDm && plan.aiPlan.shouldSendDm && plan.aiPlan.privateDmText) {
      dm = await this.attemptPrivateDm(organizationId, "system", fresh, plan.aiPlan.privateDmText, client);
    }
    await p.socialComment.update({
      where: { id: fresh.id },
      data: {
        status: "AUTO_REPLIED",
        replyText: publicReplyText,
        repliedAt: new Date(),
        isPrivateDmSent: dm.sent,
        privateDmText: plan.aiPlan.privateDmText,
        ...(dm.conversationId ? { dmConversationId: dm.conversationId } : {}),
        metadata: this.graphMeta(fresh, {
          replyId: graphReplyId,
          repliedAt: new Date().toISOString(),
          ...(groundedOk ? { groundedVia: groundedOk.via } : {}),
          ...(dm.messageId ? { privateReplyId: dm.messageId } : {}),
          ...(dm.error ? { privateReplyError: dm.error } : {}),
        }),
      },
    });
    if (groundedOk?.via === "llm" && (earlier as any[]).length === 0) {
      this.captureCommentAnswer(organizationId, String(fresh.commentText ?? ""), groundedOk);
    }
    for (const e of covered) {
      await p.socialComment.update({
        where: { id: e.id },
        data: {
          status: "AUTO_REPLIED",
          metadata: { ...((e.metadata as any) ?? {}), aiReplyBatch: { coveredBy: fresh.externalCommentId } },
        },
      }).catch(() => undefined);
    }
    // SA-B12 Trigger F (single-comment fires only — a batch's
    // plan text is a composite of several comments, so its
    // drafted DM is not one commenter's follow-up text).
    if (covered.length === 0) {
      this.emitCommentDmFollowup(organizationId, fresh, plan, dm.sent);
    }
    return { batched: covered.length };
  }

  /**
   * CX3 sweep (driven by the "comment_autoreply_sweep"
   * automation job, ~1 minute): fire due comment replies for
   * this org. Rows are taken newest-first so the latest comment
   * of a burst claims first and batches the earlier ones into
   * its reply. The claim is a conditional updateMany on the
   * EXACT due timestamp — a double fire gets count 0 and skips,
   * so a comment can never be replied to twice by the sweep.
   * Each comment is failure-isolated.
   */
  async runDueCommentReplies(organizationId: string): Promise<{ fired: number; batched: number; skipped: number }> {
    const p = this.prisma as any;
    let fired = 0;
    let batched = 0;
    let skipped = 0;
    const rows = await p.socialComment.findMany({
      where: { organizationId, status: "PENDING", aiReplyDueAt: { not: null, lte: new Date() } },
      orderBy: { createdAt: "desc" },
      take: 25,
    }).catch(() => []);
    for (const row of rows as any[]) {
      try {
        const claim = await p.socialComment.updateMany({
          where: { id: row.id, aiReplyDueAt: row.aiReplyDueAt },
          data: { aiReplyDueAt: null },
        });
        if (!claim?.count) { skipped++; continue; }
        const fresh = await p.socialComment.findFirst({ where: { id: row.id } }).catch(() => null);
        if (!fresh || fresh.status !== "PENDING") { skipped++; continue; }
        const settings = await this.getSettings(organizationId);
        if (!settings.aiAutoReplyEnabled) { skipped++; continue; }
        // CC27: AI auto-reply deny gate (configuring-actor rule,
        // see aiAutoReplyDeniedTarget). The claim already cleared
        // aiReplyDueAt, so a suppressed reply is NOT re-due — the
        // comment stays PENDING for a human, with the suppression
        // recorded on it (same drop semantics as the CX12d
        // schedule block below).
        const deniedTarget = await this.aiAutoReplyDeniedTarget(organizationId, settings, fresh.platform).catch(() => null);
        if (deniedTarget) {
          await this.recordAiReplySuppressed(organizationId, settings, fresh, deniedTarget);
          skipped++;
          continue;
        }
        // CX12d DROP SEMANTICS: the claim above already cleared
        // aiReplyDueAt, so a comment whose fire time falls outside
        // the AI schedule is NOT retried later — its pending AI
        // reply is cancelled and the comment stays PENDING for
        // the team to answer manually.
        if (await this.aiScheduleBlocksFor(organizationId, fresh.platform)) { skipped++; continue; }
        const applied = await this.applyDueCommentReply(organizationId, settings, fresh);
        // IN8: a Graph failure is NOT a fired reply — the comment
        // was re-due (or left PENDING after 3 attempts) inside
        // applyDueCommentReply and counts as skipped here.
        if (applied.graphFailed) { skipped++; continue; }
        // SA-B8: a number-guard rejection is NOT a fired reply
        // either — the comment stays PENDING for a human with
        // the rejection recorded on it (inside
        // applyDueCommentReply) and counts as skipped here.
        if (applied.guardBlocked) { skipped++; continue; }
        fired++;
        batched += applied.batched;
      } catch {
        skipped++;
      }
    }
    return { fired, batched, skipped };
  }

  private async dispatchUrgentTelegramAlert(token: string, chatId: string, payload: any) {
    try {
      const text = `🚨 *URGENT SOCIAL COMMENT ALERT!*\n\n` +
        `• *চ্যানেল:* ${payload.platform.toUpperCase()}\n` +
        `• *কাস্টমার:* ${payload.authorName}\n` +
        `• *ধরন:* ${payload.intent === "COMPLAINT" ? "⚠️ কাস্টমার কমপ্লেইন্ট / অভিযোগ" : "🛑 প্রতিদ্বন্দী ব্র্যান্ডের তুলনা"}\n` +
        `• *মন্তব্য:* "${payload.commentText}"\n` +
        (payload.postTitle ? `• *পোস্ট:* ${payload.postTitle}\n\n` : `\n`) +
        `_AI অটোমেশন ইতিমধ্যে হ্যান্ডেল করেছে। দ্রুত কাস্টমারের সাথে ফোনে যোগাযোগ করার অনুরোধ করা হচ্ছে!_`;

      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
        }),
      });
    } catch {
      // ignore telegram alert errors
    }
  }

  async generateAiSuggestion(organizationId: string, commentId: string, dto?: GenerateAiReplyDto) {
    const comment = await (this.prisma as any).socialComment.findFirst({
      where: { id: commentId, organizationId },
    });
    if (!comment) throw new NotFoundException("Comment not found");

    const settings = await this.getSettings(organizationId);
    const classification = CommentClassifier.classify(comment.commentText, settings.bannedKeywords);

    // Fetch matched product if possible
    let matchedProduct: any = null;
    const prods = await (this.prisma as any).product.findMany({
      where: { organizationId, status: "ACTIVE" },
      take: 5,
    });
    if (prods.length > 0) {
      matchedProduct = {
        name: prods[0].name,
        priceFormatted: formatMinor(BigInt(prods[0].priceMinor), prods[0].currency || "BDT"),
        orderUrl: settings.salesOrderUrl || undefined,
      };
    }

    const aiPlan = CommentHumanizer.generateHumanReply({
      authorName: comment.authorName,
      commentText: comment.commentText,
      classification,
      postTitle: comment.postTitle ?? undefined,
      matchedProduct,
      tonePreference: dto?.tone ?? settings.tonePreference,
    });

    return {
      commentId,
      classification,
      aiPlan,
    };
  }

  /**
   * IN8: manual reply — the public reply is posted through Graph
   * FIRST (POST /{comment-id}/comments). The row is marked
   * MANUALLY_REPLIED only when Meta returns the new comment id;
   * a Graph failure throws verbatim and changes nothing. An
   * optional private DM rides the same request: it is attempted
   * through the private-reply endpoint after the public reply
   * lands, and a DM failure is reported on the return value
   * (privateDmError) with isPrivateDmSent left false — the public
   * reply's success is never used to dress up a failed DM.
   */
  async sendReply(organizationId: string, actorId: string, commentId: string, dto: ReplyCommentDto) {
    const comment = await (this.prisma as any).socialComment.findFirst({
      where: { id: commentId, organizationId },
    });
    if (!comment) throw new NotFoundException("Comment not found");

    // CC27: deny gate — before any Graph call.
    await this.assertCommentReplyAccess(organizationId, actorId, comment);
    const client = await this.graphClientFor(organizationId, comment.platform);
    let graphReplyId: string;
    try {
      graphReplyId = (await client.replyToComment(comment.externalCommentId, dto.replyText)).commentId;
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }

    let dm: { sent: boolean; messageId?: string; conversationId?: string; error?: string } = { sent: false };
    const dmText = dto.privateDmText ?? comment.privateDmText;
    if (dto.sendPrivateDm && dmText) {
      dm = await this.attemptPrivateDm(organizationId, actorId, comment, dmText, client);
    }

    const updated = await (this.prisma as any).socialComment.update({
      where: { id: commentId },
      data: {
        status: "MANUALLY_REPLIED",
        replyText: dto.replyText,
        repliedAt: new Date(),
        isPrivateDmSent: dm.sent ? true : comment.isPrivateDmSent,
        privateDmText: dmText ?? comment.privateDmText,
        ...(dm.conversationId ? { dmConversationId: dm.conversationId } : {}),
        metadata: this.graphMeta(comment, {
          replyId: graphReplyId,
          repliedAt: new Date().toISOString(),
          ...(dm.messageId ? { privateReplyId: dm.messageId } : {}),
          ...(dm.error ? { privateReplyError: dm.error } : {}),
        }),
      },
    });

    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "social_comments.replied",
      entityType: "SocialComment",
      entityId: comment.id,
    });

    return { ...updated, graphReplyId, ...(dm.error ? { privateDmError: dm.error } : {}) };
  }

  /**
   * IN8c: standalone "DM করুন" — one Graph private reply to this
   * comment (POST /{comment-id}/private_replies). On confirmation
   * the comment is flagged DM-sent and linked to the inbox
   * conversation attemptPrivateDm created/found (with its context
   * note). On ANY Graph failure (incl. Meta's window/already-used
   * errors) this throws verbatim, no conversation is created and
   * no flag is set.
   */
  async sendPrivateReply(organizationId: string, actorId: string, commentId: string, message: string) {
    const comment = await (this.prisma as any).socialComment.findFirst({
      where: { id: commentId, organizationId },
    });
    if (!comment) throw new NotFoundException("Comment not found");
    if (comment.isPrivateDmSent) {
      throw new BadRequestException("A private reply was already sent for this comment — Meta allows only one private reply per comment");
    }
    // CC27: deny gate — before any Graph call.
    await this.assertCommentReplyAccess(organizationId, actorId, comment);
    const client = await this.graphClientFor(organizationId, comment.platform);
    const dm = await this.attemptPrivateDm(organizationId, actorId, comment, message, client);
    if (!dm.sent) throw new BadRequestException(dm.error ?? "Private reply failed");
    const updated = await (this.prisma as any).socialComment.update({
      where: { id: commentId },
      data: {
        isPrivateDmSent: true,
        privateDmText: message,
        ...(dm.conversationId ? { dmConversationId: dm.conversationId } : {}),
        metadata: this.graphMeta(comment, {
          privateReplyId: dm.messageId,
          privateReplyAt: new Date().toISOString(),
          ...(dm.error ? { dmLinkError: dm.error } : {}),
        }),
      },
    });
    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "social_comments.private_replied",
      entityType: "SocialComment",
      entityId: comment.id,
    });
    return { ...updated, graphPrivateReplyId: dm.messageId, dmConversationId: dm.conversationId ?? updated.dmConversationId ?? null, ...(dm.error ? { dmLinkWarning: dm.error } : {}) };
  }

  /** IN8: delete on the platform — DELETE /{comment-id}; the
   * local DELETED status is set only on Graph's {success:true}. */
  async deleteComment(organizationId: string, actorId: string, commentId: string) {
    const comment = await (this.prisma as any).socialComment.findFirst({
      where: { id: commentId, organizationId },
    });
    if (!comment) throw new NotFoundException("Comment not found");
    const client = await this.graphClientFor(organizationId, comment.platform);
    try {
      await client.deleteComment(comment.externalCommentId);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
    const updated = await (this.prisma as any).socialComment.update({
      where: { id: commentId },
      data: {
        status: "DELETED",
        metadata: this.graphMeta(comment, { deletedAt: new Date().toISOString(), deletedBy: actorId }),
      },
    });
    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "social_comments.deleted",
      entityType: "SocialComment",
      entityId: comment.id,
    });
    return updated;
  }

  /** IN8b: assign/unassign a queued comment (plain user id; the
   * comments queue is the assignment surface — SLA/snooze stay
   * conversation-only, see the schema note). */
  async assignComment(organizationId: string, actorId: string, commentId: string, assignedUserId: string | null) {
    const comment = await (this.prisma as any).socialComment.findFirst({
      where: { id: commentId, organizationId },
    });
    if (!comment) throw new NotFoundException("Comment not found");
    const updated = await (this.prisma as any).socialComment.update({
      where: { id: commentId },
      data: { assignedUserId },
    });
    await this.audit.log({
      organizationId,
      userId: actorId,
      action: assignedUserId ? "social_comments.assigned" : "social_comments.unassigned",
      entityType: "SocialComment",
      entityId: comment.id,
    });
    return updated;
  }

  async updateCommentStatus(organizationId: string, commentId: string, status: "PENDING" | "HIDDEN" | "ESCALATED") {
    const comment = await (this.prisma as any).socialComment.findFirst({
      where: { id: commentId, organizationId },
    });
    if (!comment) throw new NotFoundException("Comment not found");

    // IN8: HIDDEN is a platform action now — POST /{comment-id}
    // {is_hidden:true} must confirm before the local status moves;
    // un-hiding (back to PENDING from HIDDEN) confirms the same
    // way with is_hidden:false. ESCALATED is our own triage state
    // (Meta has no such concept) and stays a local transition.
    if (status === "HIDDEN" && comment.status !== "HIDDEN") {
      const client = await this.graphClientFor(organizationId, comment.platform);
      try {
        await client.setCommentHidden(comment.externalCommentId, true);
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : String(e));
      }
      return (this.prisma as any).socialComment.update({
        where: { id: commentId },
        data: { status, metadata: this.graphMeta(comment, { hiddenAt: new Date().toISOString(), hiddenVia: "manual" }) },
      });
    }
    if (status === "PENDING" && comment.status === "HIDDEN") {
      const client = await this.graphClientFor(organizationId, comment.platform);
      try {
        await client.setCommentHidden(comment.externalCommentId, false);
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : String(e));
      }
      return (this.prisma as any).socialComment.update({
        where: { id: commentId },
        data: { status, metadata: this.graphMeta(comment, { unhiddenAt: new Date().toISOString() }) },
      });
    }

    return (this.prisma as any).socialComment.update({
      where: { id: commentId },
      data: { status },
    });
  }

  async executeBulkAction(organizationId: string, actorId: string, commentIds: string[], action: "AI_REPLY_ALL" | "HIDE_ALL" | "MARK_RESOLVED") {
    let affected = 0;
    // IN8: bulk hide/reply go through the same Graph layer as the
    // single actions; per-item failures are collected verbatim
    // and those rows are left untouched (never counted affected).
    const failed: { id: string; error: string }[] = [];
    const settings = await this.getSettings(organizationId);

    for (const id of commentIds) {
      const c = await (this.prisma as any).socialComment.findFirst({
        where: { id, organizationId },
      });
      if (!c) continue;

      if (action === "HIDE_ALL") {
        try {
          const client = await this.graphClientFor(organizationId, c.platform);
          await client.setCommentHidden(c.externalCommentId, true);
          await (this.prisma as any).socialComment.update({
            where: { id },
            data: { status: "HIDDEN", metadata: this.graphMeta(c, { hiddenAt: new Date().toISOString(), hiddenVia: "bulk" }) },
          });
          affected++;
        } catch (e) {
          failed.push({ id, error: e instanceof Error ? e.message : String(e) });
        }
      } else if (action === "MARK_RESOLVED") {
        await (this.prisma as any).socialComment.update({
          where: { id },
          data: { status: "AUTO_REPLIED" },
        });
        affected++;
      } else if (action === "AI_REPLY_ALL") {
        try {
          // CC27: the bulk AI reply is a HUMAN-triggered send —
          // the acting member's deny-list applies per comment,
          // refused into the per-item failure list (the path's
          // native record), never sent.
          await this.assertCommentReplyAccess(organizationId, actorId, c);
          const suggestion = await this.generateAiSuggestion(organizationId, id);
          const client = await this.graphClientFor(organizationId, c.platform);
          const graphReplyId = (await client.replyToComment(c.externalCommentId, suggestion.aiPlan.publicCommentReply)).commentId;
          let dm: { sent: boolean; messageId?: string; conversationId?: string; error?: string } = { sent: false };
          if (settings.sendPrivateDm && suggestion.aiPlan.shouldSendDm && suggestion.aiPlan.privateDmText) {
            dm = await this.attemptPrivateDm(organizationId, actorId, c, suggestion.aiPlan.privateDmText, client);
          }
          await (this.prisma as any).socialComment.update({
            where: { id },
            data: {
              status: "AUTO_REPLIED",
              replyText: suggestion.aiPlan.publicCommentReply,
              repliedAt: new Date(),
              isPrivateDmSent: dm.sent,
              privateDmText: suggestion.aiPlan.privateDmText,
              ...(dm.conversationId ? { dmConversationId: dm.conversationId } : {}),
              metadata: this.graphMeta(c, {
                replyId: graphReplyId,
                repliedAt: new Date().toISOString(),
                ...(dm.messageId ? { privateReplyId: dm.messageId } : {}),
                ...(dm.error ? { privateReplyError: dm.error } : {}),
              }),
            },
          });
          affected++;
        } catch (e) {
          failed.push({ id, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    await this.audit.log({
      organizationId,
      userId: actorId,
      action: `social_comments.bulk_${action.toLowerCase()}`,
      entityType: "SocialComment",
      entityId: organizationId,
    });

    return { success: true, affected, failed };
  }

  async seedDemoFeedIfEmpty(organizationId: string) {
    const count = await (this.prisma as any).socialComment.count({ where: { organizationId } });
    if (count > 0) return { count };

    const demos: IngestExternalCommentDto[] = [
      {
        platform: "facebook",
        externalPostId: "fb_post_101",
        externalCommentId: "fb_cmt_001",
        postTitle: "অরিজিনাল লেদার ওয়ালেট ও বেল্ট প্রিমিয়াম কম্বো",
        postMediaUrl: "https://images.unsplash.com/photo-1627123424574-724758594e93?w=500&q=80",
        authorName: "তানভীর আহমেদ",
        commentText: "এটার প্রাইস কত ভাইয়া? ডেলিভারি চার্জ কি ফ্রি?",
      },
      {
        platform: "instagram",
        externalPostId: "ig_post_102",
        externalCommentId: "ig_cmt_002",
        postTitle: "স্মার্ট ওয়্যারলেস নয়েজ ক্যান্সেলিং ইয়ারবাডস",
        postMediaUrl: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500&q=80",
        authorName: "সাবরিনা চৌধুরী",
        commentText: "চট্টগ্রামে কতদিনের মধ্যে ডেলিভারি দেওয়া সম্ভব?",
      },
      {
        platform: "tiktok",
        externalPostId: "tt_post_103",
        externalCommentId: "tt_cmt_003",
        postTitle: "ড্রাই স্কিন ময়েশ্চারাইজিং ডে ক্রিম",
        postMediaUrl: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=500&q=80",
        authorName: "নুসরাত জাহান",
        commentText: "অনেক সুন্দর প্রোডাক্ট! আমার স্কিন খুব সেনসিটিভ, এটা কি স্যুট করবে?",
      },
      {
        platform: "facebook",
        externalPostId: "fb_post_104",
        externalCommentId: "fb_cmt_004",
        postTitle: "অরিজিনাল লেদার ওয়ালেট ও বেল্ট প্রিমিয়াম কম্বো",
        authorName: "Earn Money Online Fast",
        commentText: "ঘরে বসে প্রতিদিন ১০০০ টাকা ইনকাম করতে এই লিংকে ক্লিক করুন: bit.ly/spam123",
      },
      {
        platform: "facebook",
        externalPostId: "fb_post_101",
        externalCommentId: "fb_cmt_005",
        postTitle: "অরিজিনাল লেদার ওয়ালেট ও বেল্ট প্রিমিয়াম কম্বো",
        authorName: "কামরুল হাসান",
        commentText: "গত পরশু পার্সেল পেলাম, কিন্তু বক্স ভাঙা ছিল! এটা কি ধরনের সার্ভিস?",
      },
    ];

    for (const d of demos) {
      await this.ingestComment(organizationId, d);
    }

    return { seeded: demos.length };
  }
}
