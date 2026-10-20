import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InboxService } from "./inbox.service";
import { DEMO_PACK_SCENARIOS, buildDemoPack } from "./demo-pack";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * CX12a — Practice Mode.
 *
 * While Organization.practiceMode is ON, the team can rehearse the
 * FULL AI reply + order flow on synthetic practice conversations:
 * the same ingest dispatch (processInboundIntelligence via
 * InboxService.ingestChatMessage) runs the real autopilot and the
 * real order bot against the org's real instructions / KB /
 * products (read-only — practice never mutates the catalog).
 *
 * Containment (the whole point of the feature):
 * - The practice conversation carries NO real channel identity:
 *   integrationId is null and externalContactId is a practice-*
 *   token, so no sender can ever be resolved for it — and as a
 *   second, independent barrier, InboxService.deliverText refuses
 *   to hand ANY send on an isPractice conversation to a channel
 *   sender; replies are stored locally with status "practice".
 * - Orders created from it are isPractice (no Customer row, no
 *   stock movement, no WooCommerce push, no order.created event —
 *   see InboxService.createChatOrder), are excluded from order
 *   lists/stats by default, and courier booking refuses them.
 * - Background sweeps skip practice rows: CX3 autoreply sweep
 *   (query filter), CX7 chase sweep (terminal "practice" stop),
 *   CX12b review asks (never created for practice orders), CX6
 *   courier notify (practice orders can hold no shipment, and
 *   notifyCustomer re-checks the flag).
 * - Cleanup hard-deletes every practice conversation (+ messages,
 *   drafts, bot sessions, notes cascade) and practice order
 *   (+ items) of THIS org in one transaction, turns the flag OFF
 *   and audit-logs the cleanup. Idempotent.
 */
@Injectable()
export class PracticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
  ) {}

  private p(): any { return this.prisma as any; }

  /** The org's practice state for the banner / setup page. */
  async getState(organizationId: string) {
    const org = await this.p().organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    if (!org) throw notFound("inbox.organizationNotFound");
    const [conversations, orders] = await Promise.all([
      this.p().channelConversation.count({ where: { organizationId, isPractice: true } }).catch(() => 0),
      this.p().order.count({ where: { organizationId, isPractice: true } }).catch(() => 0),
    ]);
    const first = await this.p().channelConversation.findFirst({
      where: { organizationId, isPractice: true }, orderBy: { createdAt: "asc" },
    }).catch(() => null);
    // Demo Chat Pack: how many of the practice rows are demo-pack
    // rows (practice-demo-* contacts), so the UI can show the pack
    // as loaded instead of offering the load button again.
    const demoConversations = await this.p().channelConversation.count({
      where: { organizationId, isPractice: true, externalContactId: { startsWith: "practice-demo-" } },
    }).catch(() => 0);
    return {
      practiceMode: Boolean(org.practiceMode),
      practiceConversationId: first?.id ?? null,
      practiceConversations: conversations,
      practiceOrders: orders,
      demoConversations,
      demoPackLoaded: demoConversations > 0,
    };
  }

  /**
   * Demo Chat Pack — load the 12 labelled demo scenarios (see
   * demo-pack.ts) as practice conversations so the whole team can
   * SEE every inbox feature with realistic data before going live.
   *
   * Same containment as every practice row: isPractice + null
   * integration + practice-demo-* contact ids, so the deliverText
   * guard covers them even though their channels are real names.
   * Orders are created as plain practice rows (customerId null —
   * NO Customer row, NO stock movement, NO CourierShipment: the
   * shipment widget only renders for customer-linked orders and
   * the courier sync path has no practice guard, so a demo
   * shipment would misrepresent the system).
   *
   * Idempotent: if any practice-demo-* conversation already exists
   * for the org, nothing is created and the existing pack is
   * reported back with its conversation ids.
   */
  async loadDemoPack(organizationId: string, actorId: string) {
    const state = await this.getState(organizationId);
    if (!state.practiceMode) {
      throw badRequest("inbox.turnOnPracticeModeFirstThen");
    }
    const p = this.p();
    const existing = await p.channelConversation.findMany({
      where: { organizationId, isPractice: true, externalContactId: { startsWith: "practice-demo-" } },
      orderBy: { createdAt: "asc" },
    }).catch(() => []);
    if (existing.length) {
      const byContact = new Map(existing.map((c: any) => [c.externalContactId, c.id]));
      const scenarios = DEMO_PACK_SCENARIOS
        .filter((m) => byContact.has(`practice-demo-${m.slug}`))
        .map((m) => ({ slug: m.slug, title: m.title, feature: m.feature, conversationId: byContact.get(`practice-demo-${m.slug}`) }));
      return { created: false, count: existing.length, scenarios };
    }
    // The org's first ACTIVE product grounds the demo prices /
    // order items in the REAL catalog when one exists; without a
    // product the builder falls back to a clearly labelled sample
    // item (never a fabricated catalog row).
    const products = await p.product.findMany({
      where: { organizationId, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 5,
    }).catch(() => []);
    const firstProduct = products?.[0] ?? null;
    const pack = buildDemoPack({
      now: new Date(),
      actorId,
      product: firstProduct ? {
        id: firstProduct.id,
        name: firstProduct.name,
        priceMinor: BigInt(firstProduct.priceMinor as any),
        currency: firstProduct.currency ?? "BDT",
      } : null,
    });
    let orderCount = 0;
    const scenarios: { slug: string; title: string; feature: string; conversationId: string }[] = [];
    for (const scenario of pack) {
      const conversation = await p.channelConversation.create({
        data: { organizationId, ...scenario.conversation },
      });
      const createdMessageIds: string[] = [];
      for (const message of scenario.messages) {
        const { quoteRef, ...rest } = message as any;
        const row = await p.channelMessage.create({
          data: {
            ...rest,
            conversationId: conversation.id,
            replyToMessageId: quoteRef != null ? (createdMessageIds[quoteRef] ?? null) : (rest.replyToMessageId ?? null),
          },
        });
        createdMessageIds.push(row.id);
      }
      if (scenario.note) {
        await p.conversationNote.create({
          data: { organizationId, conversationId: conversation.id, authorUserId: actorId, content: scenario.note.content },
        });
      }
      for (const orderData of scenario.orders ?? []) {
        const { items, ...order } = orderData as any;
        const created = await p.order.create({
          data: { organizationId, conversationId: conversation.id, ...order },
        });
        for (const item of items ?? []) {
          await p.orderItem.create({ data: { orderId: created.id, ...item } });
        }
        orderCount++;
      }
      if (scenario.botSession) {
        await p.botSession.create({
          data: { organizationId, conversationId: conversation.id, ...scenario.botSession },
        });
      }
      scenarios.push({ slug: scenario.slug, title: scenario.title, feature: scenario.feature, conversationId: conversation.id });
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "practice.demo_pack_loaded",
      entityType: "Organization", entityId: organizationId,
      metadata: { conversations: scenarios.length, orders: orderCount },
    });
    return { created: true, count: scenarios.length, scenarios };
  }

  /** OWNER/ADMIN only (route guard). Audited both ways. */
  async setPracticeMode(organizationId: string, actorId: string, enabled: boolean) {
    const org = await this.p().organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    if (!org) throw notFound("inbox.organizationNotFound");
    const next = Boolean(enabled);
    if (Boolean(org.practiceMode) !== next) {
      await this.p().organization.update({ where: { id: organizationId }, data: { practiceMode: next } });
      await this.audit.log({
        organizationId, userId: actorId,
        action: next ? "practice.mode_enabled" : "practice.mode_disabled",
        entityType: "Organization", entityId: organizationId, metadata: {},
      });
    }
    return this.getState(organizationId);
  }

  /**
   * Create (or return) THE practice conversation for the org.
   * Channel "practice" + a practice-* external contact id: there
   * is deliberately no integration binding, so nothing on this
   * thread can resolve to a real sender even before the
   * deliverText guard is consulted.
   */
  async createPracticeConversation(organizationId: string, actorId: string) {
    const state = await this.getState(organizationId);
    if (!state.practiceMode) {
      throw badRequest("inbox.turnOnPracticeModeFirstThen2");
    }
    if (state.practiceConversationId) {
      const existing = await this.p().channelConversation.findFirst({
        where: { id: state.practiceConversationId, organizationId, isPractice: true },
      });
      if (existing) return existing;
    }
    const conversation = await this.p().channelConversation.create({
      data: {
        organizationId,
        integrationId: null,
        channel: "practice",
        externalContactId: `practice-${randomUUID()}`,
        contactName: "🧪 প্র্যাক্টিস Customer",
        contactPhone: null,
        customerId: null,
        status: "open",
        isPractice: true,
        lastMessageAt: new Date(),
        lastMessagePreview: "প্র্যাক্টিস কথোপকথন — এখানে লিখে AI-এর উত্তর ও অর্ডার ফ্লো পরীক্ষা করুন",
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "practice.conversation_created",
      entityType: "ChannelConversation", entityId: conversation.id, metadata: {},
    });
    return conversation;
  }

  /**
   * Simulate one inbound customer message on a practice
   * conversation and run it through the SAME dispatch a real
   * webhook message takes (InboxService.ingestChatMessage ->
   * processInboundIntelligence: classification, COD/CSAT/review
   * capture, order bot, autopilot). Refuses non-practice
   * conversations outright — this path must never become a way to
   * inject messages into real customer threads.
   */
  async simulateInboundMessage(organizationId: string, actorId: string, conversationId: string, contentRaw: unknown) {
    const content = String(contentRaw ?? "").trim();
    if (!content) throw badRequest("inbox.theMessageCannotBeEmpty");
    if (content.length > 2000) throw badRequest("inbox.theMessageCanBeAtMost");
    const conv = await this.p().channelConversation.findFirst({ where: { id: conversationId, organizationId } });
    if (!conv) throw notFound("inbox.conversationNotFoundInThisOrganization");
    if (!conv.isPractice) {
      throw badRequest("inbox.thisIsNotAPracticeConversation");
    }
    const state = await this.getState(organizationId);
    if (!state.practiceMode) {
      throw badRequest("inbox.practiceModeIsOffTurnIt");
    }
    const message = await this.p().channelMessage.create({
      data: {
        conversationId, direction: "in", type: "text", content,
        status: "received", platformTimestamp: new Date(),
      },
    });
    await this.p().channelConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), lastMessagePreview: content.slice(0, 120), lastCustomerMessageAt: new Date() },
    });
    await this.inbox.ingestChatMessage(organizationId, conversationId, message.id);
    const messages = await this.p().channelMessage.findMany({
      where: { conversationId }, orderBy: { createdAt: "asc" }, take: 100,
    });
    return { conversationId, messages };
  }

  /**
   * "Practice শেষ করুন" — one transaction: hard-delete all of
   * THIS org's practice conversations (messages/drafts/notes/bot
   * sessions cascade from the conversation; chase chains and
   * message rows are removed explicitly first for FK safety) and
   * practice orders (+ their items), turn practiceMode OFF, and
   * audit-log the cleanup with the deleted counts. A second run
   * is a no-op success (idempotent).
   */
  async cleanupPractice(organizationId: string, actorId: string) {
    const p = this.p();
    const run = async (tx: any) => {
      const conversations = await tx.channelConversation.findMany({
        where: { organizationId, isPractice: true }, select: { id: true },
      });
      const conversationIds = conversations.map((c: any) => c.id);
      let messages = 0;
      if (conversationIds.length) {
        const msg = await tx.channelMessage.deleteMany({ where: { conversationId: { in: conversationIds } } });
        messages = msg?.count ?? 0;
        await tx.messageDraft.deleteMany({ where: { conversationId: { in: conversationIds } } }).catch(() => undefined);
        await tx.conversationNote.deleteMany({ where: { conversationId: { in: conversationIds } } }).catch(() => undefined);
        await tx.botSession.deleteMany({ where: { conversationId: { in: conversationIds } } }).catch(() => undefined);
        await tx.orderChase.deleteMany({ where: { conversationId: { in: conversationIds } } }).catch(() => undefined);
        await tx.channelConversation.deleteMany({ where: { organizationId, isPractice: true } });
      }
      const orders = await tx.order.findMany({
        where: { organizationId, isPractice: true }, select: { id: true },
      });
      const orderIds = orders.map((o: any) => o.id);
      if (orderIds.length) {
        await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => undefined);
        await tx.orderReview.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => undefined);
        await tx.order.deleteMany({ where: { organizationId, isPractice: true } });
      }
      await tx.organization.update({ where: { id: organizationId }, data: { practiceMode: false } });
      return { conversations: conversationIds.length, messages, orders: orderIds.length };
    };
    const result = typeof p.$transaction === "function" ? await p.$transaction(run) : await run(p);
    await this.audit.log({
      organizationId, userId: actorId, action: "practice.cleanup",
      entityType: "Organization", entityId: organizationId,
      metadata: { conversations: result.conversations, messages: result.messages, orders: result.orders },
    });
    return { ok: true, ...result, practiceMode: false };
  }
}
