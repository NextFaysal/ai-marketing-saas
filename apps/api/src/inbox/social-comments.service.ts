import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson } from "../integrations/crypto";
import { MetaMessagingClient, MessagingSecrets } from "./meta-messaging.client";
import { CommentClassifier } from "./comment-classifier";
import { CommentHumanizer } from "./comment-humanizer";
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
  ) {}

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

  private async graphClientFor(organizationId: string, platform: string): Promise<MetaMessagingClient> {
    const providers = this.graphProvidersFor(platform);
    if (!providers.length) {
      throw new BadRequestException(`Meta Graph comment actions are not available for platform "${platform}" — no Graph comment API path is wired for it, so nothing was sent or changed`);
    }
    const findFirst = (this.prisma as any).integration?.findFirst;
    const integration = findFirst
      ? await findFirst.call((this.prisma as any).integration, {
          where: { organizationId, provider: { in: providers }, status: "CONNECTED" },
          orderBy: { createdAt: "desc" },
          include: { credential: true },
        }).catch(() => null)
      : null;
    if (!integration?.credential) {
      throw new BadRequestException("No connected Meta (Messenger/Instagram) integration for this organization — the comment action cannot reach Meta Graph, so nothing was sent or changed");
    }
    const secrets = decryptJson<MessagingSecrets>(integration.credential.encryptedData);
    if (!secrets?.accessToken) throw new BadRequestException("The connected Meta integration has no access token — the comment action cannot reach Meta Graph, so nothing was sent or changed");
    return this.createGraphClient(secrets);
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
      finalComment = await this.attemptInstantGraphReply(organizationId, settings, finalComment, aiPlan);
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
   * IN8: the delay-0 ingest reply, posted through Graph at
   * ingest. Uses the plan ingest already composed. On Graph
   * confirmation the row gets exactly the values the pre-IN8
   * instant path stored (replyText, repliedAt, DM flag) plus the
   * Graph ids. On failure the row stays PENDING/unreplied, the
   * verbatim error is recorded, and the comment is re-due in 60s
   * so the CX3 sweep retries it (attempts capped there at 3).
   * Never throws — webhook ingest must not break on a send.
   */
  private async attemptInstantGraphReply(organizationId: string, settings: any, comment: any, aiPlan: any): Promise<any> {
    try {
      let client: MetaMessagingClient;
      let graphReplyId: string;
      try {
        client = await this.graphClientFor(organizationId, comment.platform);
        graphReplyId = (await client.replyToComment(comment.externalCommentId, aiPlan.publicCommentReply)).commentId;
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
          replyText: aiPlan.publicCommentReply,
          repliedAt: new Date(),
          isPrivateDmSent: dm.sent,
          ...(dm.conversationId ? { dmConversationId: dm.conversationId } : {}),
          metadata: this.graphMeta(comment, {
            replyId: graphReplyId,
            repliedAt: new Date().toISOString(),
            ...(dm.messageId ? { privateReplyId: dm.messageId } : {}),
            ...(dm.error ? { privateReplyError: dm.error } : {}),
          }),
        },
      }).catch(() => null);
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
  private async applyDueCommentReply(organizationId: string, settings: any, fresh: any): Promise<{ batched: number; graphFailed?: boolean }> {
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
      graphReplyId = (await client.replyToComment(fresh.externalCommentId, plan.aiPlan.publicCommentReply)).commentId;
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
        replyText: plan.aiPlan.publicCommentReply,
        repliedAt: new Date(),
        isPrivateDmSent: dm.sent,
        privateDmText: plan.aiPlan.privateDmText,
        ...(dm.conversationId ? { dmConversationId: dm.conversationId } : {}),
        metadata: this.graphMeta(fresh, {
          replyId: graphReplyId,
          repliedAt: new Date().toISOString(),
          ...(dm.messageId ? { privateReplyId: dm.messageId } : {}),
          ...(dm.error ? { privateReplyError: dm.error } : {}),
        }),
      },
    });
    for (const e of covered) {
      await p.socialComment.update({
        where: { id: e.id },
        data: {
          status: "AUTO_REPLIED",
          metadata: { ...((e.metadata as any) ?? {}), aiReplyBatch: { coveredBy: fresh.externalCommentId } },
        },
      }).catch(() => undefined);
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
