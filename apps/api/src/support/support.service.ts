import { BadRequestException, Injectable, NotFoundException, Optional, MessageEvent } from "@nestjs/common";
import { Observable, Subject, interval, merge } from "rxjs";
import { map } from "rxjs/operators";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EmailProvider } from "../messaging/email.provider";
import { LlmFactory } from "../ai/llm/llm.factory";
import {
  AdminTicketUpdateDto,
  CannedResponseDto,
  CreateTicketDto,
  CsatDto,
  InternalNoteDto,
  ReplyDto,
  SuggestSolutionsDto,
  UploadAttachmentDto,
} from "./support.dto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export const STATUSES = ["open", "pending", "in_progress", "resolved", "closed"] as const;
export const PRIORITIES = ["normal", "high", "urgent"] as const;
export const TICKET_CATEGORIES = [
  "general",
  "billing",
  "technical",
  "campaigns",
  "integration",
  "account",
  "feature",
  "other",
] as const;
export const CATEGORIES = TICKET_CATEGORIES;

const DEFAULT_CANNED_RESPONSES = [
  {
    shortcut: "/meta-reauth",
    title: "Meta / Facebook টোকেন রি-কানেক্ট গাইড",
    body: "অনুগ্রহ করে Settings > Integrations পেজে গিয়ে Meta কানেকশনটি একবার Disconnect করে পুনরায় Connect করুন। ফেসবুকের নতুন পারমিশন পলিসির কারণে টোকেন এক্সপায়ার হলে এটি স্বয়ংক্রিয়ভাবে রিনিউ হয়ে যাবে।",
    category: "integration",
  },
  {
    shortcut: "/billing-bkash",
    title: "bKash / Nagad পেমেন্ট ভেরিফিকেশন",
    body: "আপনার পেমেন্ট ট্রানজ্যাকশন আইডি (TrxID) টি যাচাই করা হচ্ছে। সফল ভেরিফিকেশনের পর ১০-১৫ মিনিটের মধ্যে আপনার সাবস্ক্রিপশন ও ক্রেডিট একাউন্টে সক্রিয় হয়ে যাবে।",
    category: "billing",
  },
  {
    shortcut: "/pixel-test",
    title: "Meta Pixel ট্র্যাকিং টেস্ট ও ভেরিফিকেশন",
    body: "Meta Pixel হেল্পার এক্সটেনশন দিয়ে আপনার ওয়েবসাইটের PageView ও Purchase ইভেন্ট ফায়ার হচ্ছে কিনা দেখুন। সার্ভার-সাইড CAPI কনভার্সন এপিআই এর ইভেন্ট ড্যাশবোর্ডে আসতে সর্বোচ্চ ১৫-২০ মিনিট সময় লাগতে পারে।",
    category: "technical",
  },
  {
    shortcut: "/campaign-review",
    title: "ক্যাম্পেইন ইন-রিভিউ স্ট্যাটাস",
    body: "বিজ্ঞাপন সাবমিট করার পর মেটার পলিসি অনুযায়ী অ্যাড রিভিউ হতে সাধারণত ২ থেকে ২৪ ঘণ্টা সময় লাগতে পারে। অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করুন, একটিভ হলে নোটিফিকেশন পাবেন।",
    category: "campaigns",
  },
  {
    shortcut: "/resolved-closing",
    title: "সমস্যা সমাধান ও টিকেট ক্লোজিং বার্তা",
    body: "আপনার সমস্যাটির সমাধান সম্পন্ন হয়েছে। আপনার অন্য কোনো জিজ্ঞাসা বা সমস্যা থাকলে নির্দ্বিধায় আমাদের জানান। টিকেটটি ক্লোজ করার পর আপনার অভিজ্ঞতা কেমন ছিল তা ৫-স্টার রেটিং দিয়ে আমাদের জানাতে পারেন। ধন্যবাদ!",
    category: "general",
  },
];

/**
 * GC23 — first-response SLA (hours), configured by the platform
 * via the SystemSetting "supportSlaHours" = { low, normal, high,
 * urgent }; defaults below. Tickets today carry priority
 * normal|high only — the map still covers all four keys and any
 * unknown priority falls back to `normal`. Breach is COMPUTED ON
 * READ (no stored state to drift): unresolved + no first admin
 * response + past createdAt + slaHours.
 */
export const SUPPORT_SLA_DEFAULTS: Record<string, number> = { low: 72, normal: 24, high: 8, urgent: 4 };

export async function loadSupportSlaHours(prisma: any): Promise<Record<string, number>> {
  const out = { ...SUPPORT_SLA_DEFAULTS };
  try {
    const row = await prisma.systemSetting?.findUnique({ where: { key: "supportSlaHours" } });
    const v = row?.value;
    if (v && typeof v === "object") {
      for (const key of Object.keys(SUPPORT_SLA_DEFAULTS)) {
        const n = Number((v as any)[key]);
        if (Number.isFinite(n) && n > 0) out[key] = n;
      }
    }
  } catch { /* defaults apply — SLA display must never break the queue */ }
  return out;
}

export function slaState(ticket: any, hours: Record<string, number>, now = new Date()) {
  const h = hours[String(ticket?.priority ?? "normal")] ?? hours.normal ?? SUPPORT_SLA_DEFAULTS.normal;
  const dueAt = new Date(new Date(ticket?.createdAt ?? now).getTime() + h * 3600_000);
  const terminal = ticket?.status === "resolved" || ticket?.status === "closed";
  const breached = !terminal && !ticket?.firstRespondedAt && now.getTime() > dueAt.getTime();
  return { slaHours: h, slaDueAt: dueAt.toISOString(), slaBreached: breached };
}

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly llmFactory?: LlmFactory,
  ) {}

  private async orgName(organizationId: string): Promise<string | null> {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    return org?.name ?? null;
  }

  private async withCounts(tickets: any[]) {
    if (!tickets.length) return [];
    const ids = tickets.map((t) => t.id);
    const messages = await (this.prisma as any).supportTicketMessage.findMany({
      where: { ticketId: { in: ids } },
    }).catch(() => []);
    const counts = new Map<string, number>();
    for (const m of messages as any[]) counts.set(m.ticketId, (counts.get(m.ticketId) ?? 0) + 1);
    return tickets.map((t) => ({ ...t, messageCount: counts.get(t.id) ?? 0 }));
  }

  // ---------------- Realtime SSE Streams ----------------
  private readonly ticketStreams = new Map<string, Set<Subject<MessageEvent>>>();

  createTicketStream(ticketId: string, isAdmin: boolean): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    if (!this.ticketStreams.has(ticketId)) {
      this.ticketStreams.set(ticketId, new Set());
    }
    this.ticketStreams.get(ticketId)!.add(subject);

    const heartbeat$ = interval(25000).pipe(
      map(() => ({ data: { type: "heartbeat", at: new Date().toISOString() } } as MessageEvent))
    );

    const custom$ = new Observable<MessageEvent>((subscriber) => {
      const subscription = subject.subscribe({
        next: (event) => {
          if (!isAdmin && (event.data as any)?.isInternal) return;
          subscriber.next(event);
        },
        error: (e) => subscriber.error(e),
        complete: () => subscriber.complete(),
      });

      return () => {
        subscription.unsubscribe();
        const set = this.ticketStreams.get(ticketId);
        if (set) {
          set.delete(subject);
          if (set.size === 0) this.ticketStreams.delete(ticketId);
        }
      };
    });

    return merge(custom$, heartbeat$);
  }

  async getTicketStream(organizationId: string, ticketId: string, isAdmin = false): Promise<Observable<MessageEvent>> {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || (!isAdmin && ticket.organizationId !== organizationId)) {
      throw new NotFoundException("Ticket not found");
    }
    return this.createTicketStream(ticketId, isAdmin);
  }

  async getTicketStreamAdmin(ticketId: string): Promise<Observable<MessageEvent>> {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException("Ticket not found");
    return this.createTicketStream(ticketId, true);
  }

  broadcastTicketEvent(ticketId: string, payload: { type: string; data?: any; who?: string; isTyping?: boolean; isInternal?: boolean }) {
    const set = this.ticketStreams.get(ticketId);
    if (!set || set.size === 0) return;
    const event: MessageEvent = { data: payload };
    for (const s of set) {
      try {
        s.next(event);
      } catch {
        // safe fallback
      }
    }
  }

  emitTyping(ticketId: string, who: "tenant" | "admin", isTyping: boolean) {
    this.broadcastTicketEvent(ticketId, { type: "typing", who, isTyping });
  }

  // ---------------- File & Media Attachments ----------------

  async uploadAttachment(organizationId: string, actorId: string, dto: UploadAttachmentDto) {
    const dataBase64 = String(dto.dataBase64 ?? "").trim();
    if (!dataBase64) throw new BadRequestException("Attachment data is required");

    // Clean data URL prefix if present
    const cleanBase64 = dataBase64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    if (!buffer.length) throw new BadRequestException("Invalid attachment data");
    if (buffer.length > 8 * 1024 * 1024) throw new BadRequestException("File size exceeds 8MB limit");

    const mime = dto.contentType || "application/octet-stream";
    const rawName = (dto.fileName ?? "screenshot.png").replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${rawName}`;

    const dir = join(process.cwd(), "..", ".media-store", "support", organizationId);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true }).catch(() => null);
    }
    const filePath = join(dir, fileId);
    await writeFile(filePath, buffer);

    const isImage = mime.startsWith("image/");
    // Direct data URL for small images (< 400KB) for instant render without network roundtrips
    const inlineUrl = buffer.length <= 400 * 1024 && isImage
      ? `data:${mime};base64,${cleanBase64}`
      : `/api/organizations/${organizationId}/tickets/attachments/${fileId}`;

    return {
      id: fileId,
      name: dto.fileName ?? "attachment",
      size: buffer.length,
      mimeType: mime,
      url: inlineUrl,
    };
  }

  async getAttachmentFile(organizationId: string, fileId: string) {
    const safeFile = fileId.replace(/[^a-zA-Z0-9._-]/g, "");
    const filePath = join(process.cwd(), "..", ".media-store", "support", organizationId, safeFile);
    if (!existsSync(filePath)) throw new NotFoundException("Attachment file not found");
    const buffer = await readFile(filePath);
    let contentType = "application/octet-stream";
    if (safeFile.endsWith(".png")) contentType = "image/png";
    else if (safeFile.endsWith(".jpg") || safeFile.endsWith(".jpeg")) contentType = "image/jpeg";
    else if (safeFile.endsWith(".webp")) contentType = "image/webp";
    else if (safeFile.endsWith(".pdf")) contentType = "application/pdf";
    return { buffer, contentType };
  }

  // ---------------- AI Solutions & Deflection ----------------

  async suggestSolutions(organizationId: string, dto: SuggestSolutionsDto) {
    const text = `${dto.subject} ${dto.body ?? ""}`.toLowerCase();
    const suggestions: Array<{ title: string; summary: string; actionText?: string; link?: string }> = [];

    if (text.includes("pixel") || text.includes("capi") || text.includes("track")) {
      suggestions.push({
        title: "Meta Pixel ও Conversions API সেটআপ নির্দেশিকা",
        summary: "আপনার স্টোরফ্রন্টে ইভেন্ট ফায়ার হচ্ছে কিনা নিশ্চিত হতে Test Events দিয়ে টেস্ট করুন। ব্রাউজার এক্সটেনশনে Meta Pixel Helper ব্যবহার করুন।",
        actionText: "Tracking Settings দেখুন",
        link: "/dashboard/settings",
      });
    }
    if (text.includes("token") || text.includes("facebook") || text.includes("meta") || text.includes("connect")) {
      suggestions.push({
        title: "Facebook / Meta অ্যাকাউন্ট পুনরায় কানেক্ট করুন",
        summary: "মেটা টোকেন প্রতি ৬০ দিন পর রিনিউ করতে হয়। Integrations পেজে গিয়ে একবার ডিসকানেক্ট ও পুনরায় কানেক্ট করলে স্বয়ংক্রিয় সমাধান হবে।",
        actionText: "Integrations পেজে যান",
        link: "/dashboard/integrations",
      });
    }
    if (text.includes("payment") || text.includes("bkash") || text.includes("bill") || text.includes("টাকা") || text.includes("বিল")) {
      suggestions.push({
        title: "বকেয়া বিল ও পেমেন্ট ভেরিফিকেশন",
        summary: "bKash বা কার্ডে পেমেন্ট সফল হওয়ার পর সাধারণত সর্বোচ্চ ১০ মিনিটের মধ্যে প্ল্যান আপগ্রেড কার্যকর হয়। TrxID মিলিয়ে ইনভয়েস পেজে চেক করুন।",
        actionText: "Billing পেজ দেখুন",
        link: "/dashboard/billing",
      });
    }
    if (text.includes("campaign") || text.includes("ad") || text.includes("বিজ্ঞাপন") || text.includes("রিভিউ")) {
      suggestions.push({
        title: "ক্যাম্পেইন রিভিউ ও ডেলিভারি সমস্যা",
        summary: "নতুন বিজ্ঞাপন মেটার পলিসি টিম ম্যানুয়ালি যাচাই করতে পারে। ২৪ ঘণ্টার বেশি পেন্ডিং থাকলে অডিয়েন্স ও ক্রিয়েটিভ টেক্সট চেক করুন।",
        actionText: "Campaigns দেখুন",
        link: "/dashboard/campaigns",
      });
    }

    // Try AI generation if configured
    let aiInstantTip: string | null = null;
    if (this.llmFactory) {
      try {
        const provider = this.llmFactory.getProvider();
        const prompt = `You are a helpful SaaS support assistant for 'Next AI Marketing' in Bangladesh. The customer is opening a ticket with Subject: "${dto.subject}" and Details: "${dto.body ?? ""}".
In 2-3 concise sentences in Bengali (with necessary tech terms in English), suggest the most direct troubleshooting steps or instant solution they can try immediately before waiting for human support. Be polite, friendly, and practical.`;
        const res = await provider.complete([{ role: "user", content: prompt }]);
        if (res && res.text) aiInstantTip = res.text.trim();
      } catch {
        // Honest fallback to predefined suggestions
      }
    }

    return { suggestions, aiInstantTip };
  }

  // ---------------- Tenant side ----------------

  async createTicket(organizationId: string, userId: string, dto: CreateTicketDto) {
    const subject = String(dto.subject ?? "").trim();
    const body = String(dto.body ?? "").trim();
    if (subject.length < 3) throw new BadRequestException("Subject is required (min 3 characters)");
    if (body.length < 1) throw new BadRequestException("Message body is required");

    const priority = dto.priority === "urgent" ? "urgent" : dto.priority === "high" ? "high" : "normal";
    // GC23: category — default "other"; anything outside the
    // vocabulary is a client error, never silently coerced.
    const category = dto.category === undefined || dto.category === null || dto.category === ""
      ? "other"
      : String(dto.category);
    if (!(TICKET_CATEGORIES as readonly string[]).includes(category)) {
      throw new BadRequestException(`category must be one of ${TICKET_CATEGORIES.join(", ")}`);
    }

    // Set SLA deadline based on priority:
    // urgent: 4 hours, high: 12 hours, normal: 24 hours
    const slaHours = priority === "urgent" ? 4 : priority === "high" ? 12 : 24;
    const slaDueAt = new Date(Date.now() + slaHours * 60 * 60 * 1000);

    const ticket = await (this.prisma as any).supportTicket.create({
      data: {
        organizationId,
        createdById: userId,
        subject,
        category,
        priority,
        status: "open",
        slaDueAt,
        diagnostics: dto.diagnostics ? (dto.diagnostics as any) : undefined,
      },
    });

    await (this.prisma as any).supportTicketMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: userId,
        authorKind: "tenant",
        body,
        attachments: dto.attachments ? (dto.attachments as any) : undefined,
        isInternal: false,
      },
    });

    const created = await this.getTicket(organizationId, ticket.id);
    return { ...created, slaDueAt };
  }

  async listTickets(organizationId: string) {
    const rows = await (this.prisma as any).supportTicket.findMany({
      where: { organizationId },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    });
    const withCounts = await this.withCounts(rows);
    return withCounts.map(({ slaDueAt, slaBreached, slaHours, ...rest }: any) => rest);
  }

  async getTicket(organizationId: string, ticketId: string) {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.organizationId !== organizationId) throw new NotFoundException("Ticket not found");

    // Tenant side MUST ONLY receive public messages (isInternal !== true)
    const messages = await (this.prisma as any).supportTicketMessage.findMany({
      where: { ticketId, isInternal: false },
      orderBy: { createdAt: "asc" },
    });
    const { slaDueAt, slaBreached, slaHours, ...cleanTicket } = ticket;
    return { ...cleanTicket, messages };
  }

  async replyAsTenant(organizationId: string, userId: string, ticketId: string, input: ReplyDto | string) {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.organizationId !== organizationId) throw new NotFoundException("Ticket not found");
    const rawBody = typeof input === "string" ? input : input?.body;
    const text = String(rawBody ?? "").trim();
    if (!text) throw new BadRequestException("Message body is required");

    const attachments = typeof input === "string" ? undefined : input?.attachments;

    const message = await (this.prisma as any).supportTicketMessage.create({
      data: {
        ticketId,
        authorId: userId,
        authorKind: "tenant",
        body: text,
        attachments: attachments ? (attachments as any) : undefined,
        isInternal: false,
      },
    });

    const reopen = ticket.status === "resolved" || ticket.status === "closed";
    await (this.prisma as any).supportTicket.update({
      where: { id: ticketId },
      data: {
        lastMessageAt: new Date(),
        ...(reopen ? { status: "open" } : {}),
      },
    });

    this.broadcastTicketEvent(ticketId, { type: "message.created", data: message });
    if (reopen) this.broadcastTicketEvent(ticketId, { type: "ticket.updated", data: { status: "open" } });

    return message;
  }

  async setTenantStatus(organizationId: string, ticketId: string, status: string) {
    if (status !== "closed" && status !== "open") throw new BadRequestException("Tenants can close or reopen a ticket");
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.organizationId !== organizationId) throw new NotFoundException("Ticket not found");

    const data: Record<string, unknown> = { status };
    if (status === "closed") data.resolvedAt = new Date();

    const res = await (this.prisma as any).supportTicket.update({ where: { id: ticketId }, data });
    this.broadcastTicketEvent(ticketId, { type: "ticket.updated", data: { status, resolvedAt: data.resolvedAt } });
    return res;
  }

  async submitCsat(organizationId: string, userId: string, ticketId: string, dto: CsatDto) {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.organizationId !== organizationId) throw new NotFoundException("Ticket not found");

    const rating = Number(dto.rating);
    if (!rating || rating < 1 || rating > 5) throw new BadRequestException("Rating must be between 1 and 5");

    const updated = await (this.prisma as any).supportTicket.update({
      where: { id: ticketId },
      data: {
        csatRating: rating,
        csatFeedback: dto.feedback ? String(dto.feedback).slice(0, 1000) : null,
      },
    });

    await this.audit.log({
      organizationId,
      userId,
      action: "tenant.ticket_csat_submitted",
      entityType: "SupportTicket",
      entityId: ticketId,
      metadata: { rating, feedback: dto.feedback },
    });

    this.broadcastTicketEvent(ticketId, { type: "ticket.csat", data: { rating, feedback: dto.feedback } });

    return updated;
  }

  // ---------------- Admin side ----------------

  async listTicketsAdmin(filter?: { status?: string; organizationId?: string; category?: string; priority?: string; slaBreached?: boolean }) {
    const where: any = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.organizationId) where.organizationId = filter.organizationId;
    if (filter?.category) where.category = filter.category;
    if (filter?.priority) where.priority = filter.priority;

    const rows = await (this.prisma as any).supportTicket.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    });
    const withCounts = await this.withCounts(rows);
    // GC23: SLA state is computed on read and added to ADMIN
    // payloads only — tenant payloads never carry SLA internals.
    const hours = await loadSupportSlaHours(this.prisma as any);
    const now = new Date();
    let out: any[] = [];
    for (const t of withCounts) {
      out.push({ ...t, ...slaState(t, hours, now), organizationName: await this.orgName(t.organizationId) });
    }
    if (filter?.slaBreached) out = out.filter((t) => t.slaBreached);
    return out;
  }

  async getTicketAdmin(ticketId: string) {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException("Ticket not found");

    // Admin sees ALL messages including internal whisper notes
    const messages = await (this.prisma as any).supportTicketMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: "asc" },
    });
    const creator = await (this.prisma as any).user.findUnique({ where: { id: ticket.createdById } }).catch(() => null);

    // Customer 360 overview
    const org = await (this.prisma as any).organization.findUnique({
      where: { id: ticket.organizationId },
    }).catch(() => null);

    const membersCount = await (this.prisma as any).membership.count({
      where: { organizationId: ticket.organizationId },
    }).catch(() => 1);

    const integrationsCount = await (this.prisma as any).integration?.count({
      where: { organizationId: ticket.organizationId, status: "ACTIVE" },
    }).catch(() => 0);

    const customer360 = {
      organizationName: org?.name ?? null,
      organizationSlug: org?.slug ?? null,
      creatorEmail: creator?.email ?? null,
      creatorName: creator?.name ?? null,
      membersCount,
      activeIntegrationsCount: integrationsCount,
      diagnostics: ticket.diagnostics ?? null,
    };

    const hours = await loadSupportSlaHours(this.prisma as any);
    return {
      ...ticket,
      messages,
      ...slaState(ticket, hours),
      organizationName: org?.name ?? null,
      creatorEmail: creator?.email ?? null,
      customer360,
    };
  }

  async replyAsAdmin(actor: any, ticketId: string, input: ReplyDto | string, ip?: string) {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException("Ticket not found");
    const rawBody = typeof input === "string" ? input : input?.body;
    const text = String(rawBody ?? "").trim();
    if (!text) throw new BadRequestException("Message body is required");

    const attachments = typeof input === "string" ? undefined : input?.attachments;

    const message = await (this.prisma as any).supportTicketMessage.create({
      data: {
        ticketId,
        authorId: actor.id,
        authorKind: "admin",
        body: text,
        attachments: attachments ? (attachments as any) : undefined,
        isInternal: false,
      },
    });

    const updateData: Record<string, unknown> = {
      lastMessageAt: new Date(),
      ...(ticket.status === "open" ? { status: "pending" } : {}),
      ...(ticket.firstRespondedAt ? {} : { firstRespondedAt: new Date() }),
      ...(ticket.firstRepliedAt ? {} : { firstRepliedAt: new Date() }),
    };

    await (this.prisma as any).supportTicket.update({
      where: { id: ticketId },
      data: updateData,
    });

    await this.audit.log({
      organizationId: ticket.organizationId,
      userId: actor.id,
      action: "admin.ticket_replied",
      entityType: "SupportTicket",
      entityId: ticketId,
      ipAddress: ip,
    });

    // Notify tenant OWNER/ADMIN members + ticket creator
    let emailSent = 0;
    let emailError: string | null = null;
    try {
      const memberships = await (this.prisma as any).membership.findMany({
        where: { organizationId: ticket.organizationId, role: { in: ["OWNER", "ADMIN"] } },
        include: { user: true },
      });
      const recipients = new Set<string>();
      for (const m of memberships as any[]) if (m.user?.email) recipients.add(m.user.email);
      const orgName = await this.orgName(ticket.organizationId);
      const email = new EmailProvider();
      for (const to of recipients) {
        await email.send({
          to,
          subject: `Support: ${ticket.subject}`,
          text: `আপনার Support Ticket "${ticket.subject}" (${orgName ?? ""}) এ প্ল্যাটফর্ম টিম উত্তর দিয়েছে:\n\n${text}\n\n— Ticket টি আপনার ওয়ার্কস্পেসের Support পেজে দেখুন।`,
        });
        emailSent++;
      }
    } catch (e) {
      emailError = e instanceof Error ? e.message : "email failed";
    }

    // In-App Notification for ticket creator
    try {
      if ((this.prisma as any).agentNotification) {
        await (this.prisma as any).agentNotification.create({
          data: {
            organizationId: ticket.organizationId,
            userId: ticket.createdById,
            type: "support_reply",
            title: `সাপোর্ট টিকিট #${ticket.id.slice(-6).toUpperCase()} এ উত্তর এসেছে`,
            body: text.slice(0, 150),
            conversationId: ticket.id,
          },
        }).catch(() => null);
      }
    } catch {
      // safe fallback
    }

    this.broadcastTicketEvent(ticketId, { type: "message.created", data: message });

    return { message, emailSent, emailError };
  }

  async addInternalNote(actor: any, ticketId: string, dto: InternalNoteDto, ip?: string) {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException("Ticket not found");
    const text = String(dto.body ?? "").trim();
    if (!text) throw new BadRequestException("Internal note body is required");

    const message = await (this.prisma as any).supportTicketMessage.create({
      data: {
        ticketId,
        authorId: actor.id,
        authorKind: "admin",
        body: text,
        attachments: dto.attachments ? (dto.attachments as any) : undefined,
        isInternal: true, // Only visible to admin team!
      },
    });

    await this.audit.log({
      organizationId: ticket.organizationId,
      userId: actor.id,
      action: "admin.ticket_internal_note",
      entityType: "SupportTicket",
      entityId: ticketId,
      ipAddress: ip,
    });

    this.broadcastTicketEvent(ticketId, { type: "message.created", data: message, isInternal: true });

    return message;
  }
  async updateAsAdmin(actor: any, ticketId: string, dto: AdminTicketUpdateDto, ip?: string) {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException("Ticket not found");
    const data: Record<string, unknown> = {};

    if (dto.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(dto.status as any)) {
        throw new BadRequestException(`status must be one of ${STATUSES.join(", ")}`);
      }
      data.status = dto.status;
      if (dto.status === "resolved") data.resolvedAt = new Date();
    }
    if (dto.assignedToId !== undefined) data.assignedToId = dto.assignedToId;
    if (dto.priority !== undefined) {
      if (!(PRIORITIES as readonly string[]).includes(dto.priority as any)) {
        throw new BadRequestException(`priority must be one of ${PRIORITIES.join(", ")}`);
      }
      data.priority = dto.priority;
    }
    // GC23: admins can recategorize a ticket.
    if (dto.category !== undefined) {
      if (!(TICKET_CATEGORIES as readonly string[]).includes(dto.category)) {
        throw new BadRequestException(`category must be one of ${TICKET_CATEGORIES.join(", ")}`);
      }
      data.category = dto.category;
    }
    if (dto.tags !== undefined) {
      data.tags = dto.tags;
    }
    if (dto.slaDueAt !== undefined) {
      data.slaDueAt = dto.slaDueAt ? new Date(dto.slaDueAt) : null;
    }
    const updated = await (this.prisma as any).supportTicket.update({ where: { id: ticketId }, data });
    await this.audit.log({
      organizationId: ticket.organizationId,
      userId: actor.id,
      action: "admin.ticket_updated",
      entityType: "SupportTicket",
      entityId: ticketId,
      metadata: { changes: data },
      ipAddress: ip,
    });

    this.broadcastTicketEvent(ticketId, { type: "ticket.updated", data });

    return updated;
  }

  // ---------------- AI Draft & Thread Summary for Agents ----------------

  async generateAiDraft(ticketId: string, tone = "professional") {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException("Ticket not found");

    const messages = await (this.prisma as any).supportTicketMessage.findMany({
      where: { ticketId, isInternal: false },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    const recentConversation = messages
      .reverse()
      .map((m: any) => `${m.authorKind === "tenant" ? "Customer" : "Agent"}: ${m.body}`)
      .join("\n");

    const orgName = await this.orgName(ticket.organizationId);

    if (this.llmFactory) {
      try {
        const provider = this.llmFactory.getProvider();
        const prompt = `You are a professional senior support agent for Next AI Marketing SaaS.
Customer Organization: ${orgName ?? "Customer Workspace"}
Subject: ${ticket.subject}
Category: ${ticket.category ?? "general"}
Recent Thread:
${recentConversation}

Task: Draft an empathetic, helpful, and technically accurate resolution response in clear Bengali (using common English tech terms).
Tone: ${tone}.
Response guidelines:
- Acknowledge their issue clearly.
- Provide direct, actionable step-by-step guidance.
- Close warmly offering further assistance.
Return ONLY the reply text directly.`;
        const res = await provider.complete([{ role: "user", content: prompt }]);
        if (res && res.text) {
          return { draft: res.text.trim(), source: "ai" };
        }
      } catch {
        // Fallback below
      }
    }

    // Contextual intelligent template fallback
    const draft = `প্রিয় গ্রাহক,

আপনার "${ticket.subject}" সংক্রান্ত সমস্যাটির বিবরণ আমরা পর্যালোচনা করেছি।

আমাদের কারিগরি টিম এটি যাচাই করেছে। অনুগ্রহ করে নিম্নলিখিত ধাপগুলো সম্পন্ন করে দেখুন:
১. আপনার ব্রাউজার ক্যাশ ও কুকিজ একবার ক্লিয়ার করে পেজটি রিলোড করুন।
২. Settings থেকে সংশ্লিষ্ট ইন্টিগ্রেশনের পারমিশন এবং স্ট্যাটাস চেক করুন।
৩. সমস্যাটি চলমান থাকলে দয়া করে স্ক্রিনের সংশ্লিষ্ট এরর স্ক্রিনশট বা লগটি নিচে রিপ্লাই দিন।

আমরা বিষয়টি গুরুত্বের সাথে পর্যবেক্ষণ করছি এবং দ্রুত সমাধানের জন্য সাথে আছি।

ধন্যবাদ,
কাস্টমার সাপোর্ট টিম, Next AI Marketing`;

    return { draft, source: "template" };
  }

  async summarizeThread(ticketId: string) {
    const ticket = await (this.prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException("Ticket not found");

    const messages = await (this.prisma as any).supportTicketMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: "asc" },
    });

    if (!messages.length) return { summary: "কোনো বার্তা নেই।" };

    const customerMessages = messages.filter((m: any) => m.authorKind === "tenant");
    const initialIssue = customerMessages[0]?.body ?? ticket.subject;

    return {
      summary: `গ্রাহকের প্রাথমিক ইস্যু: "${initialIssue.slice(0, 150)}..."। সর্বমোট বার্তা: ${messages.length}টি। বর্তমান স্ট্যাটাস: ${ticket.status}।`,
      ticketStatus: ticket.status,
      priority: ticket.priority,
      slaDueAt: ticket.slaDueAt,
    };
  }

  // ---------------- Canned Responses ----------------

  async listCannedResponses() {
    let rows = await (this.prisma as any).supportCannedResponse.findMany({
      orderBy: { shortcut: "asc" },
    }).catch(() => []);

    // Seed defaults if empty
    if (!rows.length) {
      try {
        for (const item of DEFAULT_CANNED_RESPONSES) {
          await (this.prisma as any).supportCannedResponse.create({ data: item }).catch(() => null);
        }
        rows = await (this.prisma as any).supportCannedResponse.findMany({
          orderBy: { shortcut: "asc" },
        }).catch(() => []);
      } catch {
        // Honest fallback
      }
    }
    return rows;
  }

  async createCannedResponse(actor: any, dto: CannedResponseDto) {
    const shortcut = dto.shortcut.startsWith("/") ? dto.shortcut : `/${dto.shortcut}`;
    const row = await (this.prisma as any).supportCannedResponse.create({
      data: {
        shortcut,
        title: dto.title,
        body: dto.body,
        category: dto.category ?? null,
      },
    });
    return row;
  }

  async updateCannedResponse(id: string, dto: Partial<CannedResponseDto>) {
    const data: Record<string, unknown> = {};
    if (dto.shortcut) data.shortcut = dto.shortcut.startsWith("/") ? dto.shortcut : `/${dto.shortcut}`;
    if (dto.title) data.title = dto.title;
    if (dto.body) data.body = dto.body;
    if (dto.category !== undefined) data.category = dto.category;

    return (this.prisma as any).supportCannedResponse.update({
      where: { id },
      data,
    });
  }

  async deleteCannedResponse(id: string) {
    return (this.prisma as any).supportCannedResponse.delete({ where: { id } });
  }

  // ---------------- Support Analytics & Performance ----------------

  async getSupportAnalytics() {
    const tickets = await (this.prisma as any).supportTicket.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    }).catch(() => []);

    const total = tickets.length;
    const statusCounts: Record<string, number> = { open: 0, pending: 0, in_progress: 0, resolved: 0, closed: 0 };
    const priorityCounts: Record<string, number> = { normal: 0, high: 0, urgent: 0 };
    const categoryCounts: Record<string, number> = { general: 0, billing: 0, technical: 0, campaigns: 0, integration: 0 };

    let totalResponseTimeMs = 0;
    let responseCount = 0;
    let totalResolutionTimeMs = 0;
    let resolutionCount = 0;

    let csatSum = 0;
    let csatCount = 0;
    const csatBreakdown: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    const recentFeedback: any[] = [];

    let slaBreached = 0;
    let slaChecked = 0;

    const now = Date.now();

    for (const t of tickets as any[]) {
      if (statusCounts[t.status] !== undefined) statusCounts[t.status]++;
      if (priorityCounts[t.priority] !== undefined) priorityCounts[t.priority]++;
      if (categoryCounts[t.category] !== undefined) categoryCounts[t.category]++;
      else categoryCounts.general = (categoryCounts.general ?? 0) + 1;

      // First response time
      if (t.firstRepliedAt && t.createdAt) {
        const diff = new Date(t.firstRepliedAt).getTime() - new Date(t.createdAt).getTime();
        if (diff > 0) {
          totalResponseTimeMs += diff;
          responseCount++;
        }
      }

      // Resolution time
      if (t.resolvedAt && t.createdAt) {
        const diff = new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime();
        if (diff > 0) {
          totalResolutionTimeMs += diff;
          resolutionCount++;
        }
      }

      // CSAT
      if (t.csatRating && t.csatRating >= 1 && t.csatRating <= 5) {
        csatSum += t.csatRating;
        csatCount++;
        csatBreakdown[t.csatRating] = (csatBreakdown[t.csatRating] ?? 0) + 1;
        if (t.csatFeedback) {
          recentFeedback.push({
            id: t.id,
            subject: t.subject,
            rating: t.csatRating,
            feedback: t.csatFeedback,
            resolvedAt: t.resolvedAt ?? t.updatedAt,
          });
        }
      }

      // SLA
      if (t.slaDueAt) {
        slaChecked++;
        const due = new Date(t.slaDueAt).getTime();
        const repliedOrResolved = t.firstRepliedAt || t.resolvedAt;
        if (!repliedOrResolved && now > due) {
          slaBreached++;
        } else if (repliedOrResolved && new Date(repliedOrResolved).getTime() > due) {
          slaBreached++;
        }
      }
    }

    const avgFirstResponseMinutes = responseCount > 0 ? Math.round(totalResponseTimeMs / (responseCount * 60 * 1000)) : null;
    const avgResolutionHours = resolutionCount > 0 ? Math.round((totalResolutionTimeMs / (resolutionCount * 60 * 60 * 1000)) * 10) / 10 : null;
    const avgCsat = csatCount > 0 ? Math.round((csatSum / csatCount) * 10) / 10 : null;
    const slaComplianceRate = slaChecked > 0 ? Math.round(((slaChecked - slaBreached) / slaChecked) * 100) : 100;

    return {
      total,
      statusCounts,
      priorityCounts,
      categoryCounts,
      avgFirstResponseMinutes,
      avgResolutionHours,
      csat: {
        average: avgCsat,
        count: csatCount,
        breakdown: csatBreakdown,
        recentFeedback: recentFeedback.slice(0, 10),
      },
      sla: {
        checked: slaChecked,
        breached: slaBreached,
        complianceRate: slaComplianceRate,
      },
    };
  }
}
