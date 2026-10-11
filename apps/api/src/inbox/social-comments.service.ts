import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
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

  async listComments(organizationId: string, query: ListCommentsQueryDto) {
    const where: any = { organizationId };
    if (query.platform) where.platform = query.platform;
    if (query.status) where.status = query.status;
    if (query.sentiment) where.sentiment = query.sentiment;
    if (query.intent) where.intent = query.intent;
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

    const [items, total, pendingCount, spamCount] = await Promise.all([
      (this.prisma as any).socialComment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      (this.prisma as any).socialComment.count({ where }),
      (this.prisma as any).socialComment.count({ where: { organizationId, status: "PENDING" } }),
      (this.prisma as any).socialComment.count({ where: { organizationId, sentiment: "SPAM" } }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      stats: {
        pendingCount,
        spamCount,
      },
    };
  }

  async ingestComment(organizationId: string, dto: IngestExternalCommentDto) {
    const settings = await this.getSettings(organizationId);
    const classification = CommentClassifier.classify(dto.commentText, settings.bannedKeywords);

    // Initial status determination
    let initialStatus = "PENDING";
    if (classification.shouldHideOrDelete && settings.autoHideSpam) {
      initialStatus = "HIDDEN";
    }

    // Enhanced Multi-Product Smart Auto-Detector:
    // First, check if the customer specifically mentioned any product name in their comment text
    let matchedProduct: any = null;
    const prods = await (this.prisma as any).product.findMany({
      where: { organizationId, status: "ACTIVE" },
      take: 20,
    });

    const commentWords = dto.commentText.toLowerCase();
    for (const p of prods) {
      if (commentWords.includes(p.name.toLowerCase())) {
        matchedProduct = {
          name: p.name,
          priceFormatted: formatMinor(BigInt(p.priceMinor), p.currency || "BDT"),
          orderUrl: settings.salesOrderUrl || undefined,
        };
        break;
      }
    }

    // Fallback: match by post title keywords if no specific product was mentioned in comment
    if (!matchedProduct && dto.postTitle) {
      const words = dto.postTitle.toLowerCase().split(/\s+/);
      for (const p of prods) {
        if (words.some((w: string) => p.name.toLowerCase().includes(w))) {
          matchedProduct = {
            name: p.name,
            priceFormatted: formatMinor(BigInt(p.priceMinor), p.currency || "BDT"),
            orderUrl: settings.salesOrderUrl || undefined,
          };
          break;
        }
      }
    }

    // Determine if it's Night-Owl time (12:00 AM - 8:00 AM in Bangladesh / Local)
    const currentHour = new Date().getHours();
    const isNightOwl = settings.nightOwlEnabled && (currentHour >= 0 && currentHour < 8);

    const aiPlan = CommentHumanizer.generateHumanReply({
      authorName: dto.authorName,
      commentText: dto.commentText,
      classification,
      postTitle: dto.postTitle,
      matchedProduct,
      tonePreference: settings.tonePreference,
      isNightOwl,
    });

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
        replyText: settings.aiAutoReplyEnabled && initialStatus !== "HIDDEN" ? aiPlan.publicCommentReply : null,
        repliedAt: settings.aiAutoReplyEnabled && initialStatus !== "HIDDEN" ? new Date() : null,
        isPrivateDmSent: settings.aiAutoReplyEnabled && settings.sendPrivateDm && initialStatus !== "HIDDEN" ? aiPlan.shouldSendDm : false,
        privateDmText: aiPlan.privateDmText,
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

    return comment;
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
      tonePreference: dto?.tone?: settings.tonePreference,
    });

    return {
      commentId,
      classification,
      aiPlan,
    };
  }

  async sendReply(organizationId: string, actorId: string, commentId: string, dto: ReplyCommentDto) {
    const comment = await (this.prisma as any).socialComment.findFirst({
      where: { id: commentId, organizationId },
    });
    if (!comment) throw new NotFoundException("Comment not found");

    const updated = await (this.prisma as any).socialComment.update({
      where: { id: commentId },
      data: {
        status: "MANUALLY_REPLIED",
        replyText: dto.replyText,
        repliedAt: new Date(),
        isPrivateDmSent: dto.sendPrivateDm ?? comment.isPrivateDmSent,
        privateDmText: dto.privateDmText ?? comment.privateDmText,
      },
    });

    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "social_comments.replied",
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

    return (this.prisma as any).socialComment.update({
      where: { id: commentId },
      data: { status },
    });
  }

  async executeBulkAction(organizationId: string, actorId: string, commentIds: string[], action: "AI_REPLY_ALL" | "HIDE_ALL" | "MARK_RESOLVED") {
    let affected = 0;
    const settings = await this.getSettings(organizationId);

    for (const id of commentIds) {
      const c = await (this.prisma as any).socialComment.findFirst({
        where: { id, organizationId },
      });
      if (!c) continue;

      if (action === "HIDE_ALL") {
        await (this.prisma as any).socialComment.update({
          where: { id },
          data: { status: "HIDDEN" },
        });
        affected++;
      } else if (action === "MARK_RESOLVED") {
        await (this.prisma as any).socialComment.update({
          where: { id },
          data: { status: "AUTO_REPLIED" },
        });
        affected++;
      } else if (action === "AI_REPLY_ALL") {
        const suggestion = await this.generateAiSuggestion(organizationId, id);
        await (this.prisma as any).socialComment.update({
          where: { id },
          data: {
            status: "AUTO_REPLIED",
            replyText: suggestion.aiPlan.publicCommentReply,
            repliedAt: new Date(),
            isPrivateDmSent: settings.sendPrivateDm && suggestion.aiPlan.shouldSendDm,
            privateDmText: suggestion.aiPlan.privateDmText,
          },
        });
        affected++;
      }
    }

    await this.audit.log({
      organizationId,
      userId: actorId,
      action: `social_comments.bulk_${action.toLowerCase()}`,
      entityType: "SocialComment",
      entityId: organizationId,
    });

    return { success: true, affected };
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
