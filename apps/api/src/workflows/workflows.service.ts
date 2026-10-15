import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { leaderClaim } from "../common/leader-claim";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { MessagingService } from "../messaging/messaging.service";
import { InboxService } from "../inbox/inbox.service";
import { Optional } from "@nestjs/common";
import { evaluateConditions, renderTemplate } from "../messaging/render";
import { classifyShipmentStatus } from "../courier/courier-performance";
import { LlmFactory } from "../ai/llm/llm.factory";
import { deriveAbandonedCarts } from "../tracking/abandoned-carts";

export const WORKFLOW_TRIGGERS = [
  "order_created", "lead_created", "lead_stage_changed", "inbox_message_received", "inbox_unanswered",
  // Workflows W2: the delivered / COD events were emitted all
  // along — they simply had no workflow mapping.
  "order_delivered", "order_cod_confirmed", "conversation_assigned", "conversation_closed", "schedule",
  // Automations A1: S2's status/refund events finally get
  // workflow triggers of their own.
  "order_status_changed", "order_refunded",
  // Automations A2: one shipment.status_changed event fans
  // out to these three triggers (see handleShipmentEvent).
  "shipment_status_changed", "shipment_delivered", "shipment_returned",
  // E-commerce cart abandonment trigger.
  "cart_abandoned",
] as const;
export const STEP_TYPES = [
  "send_email", "send_sms", "add_lead_activity", "add_conversation_note", "wait", "condition", "send_inbox_message",
  // Workflows W3: actions that change the workspace, not
  // just talk to the customer.
  "assign_conversation", "change_lead_stage", "add_tag", "notify_team", "create_follow_up", "http_webhook",
  // Workflows W4: two-armed branching.
  "branch",
  // Advanced actions: external channels and AI agent.
  "notify_channel", "ai_generate",
] as const;

/**
 * MS2: a step that was deliberately NOT executed (e.g. the
 * recipient opted out of messaging) — logged in the run's
 * stepsLog as "skipped" with the reason, never as "ok" (nothing
 * was sent) and never as "failed" (no provider failure happened,
 * and the run does not count as failed for it).
 */
export class StepSkippedError extends Error {}

/** Workflows W3: webhook targets must be public https
 *  endpoints. Blocks loopback/private IP literals and
 *  local names; redirects are refused at fetch time. */
export function isBlockedWebhookHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) return true;
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

export const WORKFLOW_PRESETS: { key: string; name: string; descriptionBn: string; trigger: string; conditions?: any[]; steps: any[] }[] = [
  {
    key: "recovery_followup", name: "Recovery Follow-up", trigger: "inbox_message_received",
    descriptionBn: "নতুন বার্তার ১ ঘণ্টা পরও উত্তর না হলে ভদ্র ফলো-আপ পাঠায়।",
    steps: [
      { type: "wait", minutes: 60 },
      { type: "condition", field: "agentReplied", op: "eq", value: false },
      { type: "send_inbox_message", text: "আসসালামু আলাইকুম {{contactName}}, আপনার বার্তা আমরা পেয়েছি। কোনো সাহায্য লাগলে জানাবেন।" },
    ],
  },
  {
    key: "complaint_note", name: "অভিযোগ সতর্কতা", trigger: "inbox_message_received",
    descriptionBn: "অভিযোগ শনাক্ত হলে কথোপকথনে অগ্রাধিকার নোট যোগ করে।",
    conditions: [{ field: "intent", op: "eq", value: "complaint" }],
    steps: [{ type: "add_conversation_note", text: "অভিযোগ এসেছে — অগ্রাধিকার দিয়ে দেখুন" }],
  },
  {
    key: "unanswered_escalation", name: "Unanswered Escalation", trigger: "inbox_unanswered",
    descriptionBn: "২ ঘণ্টা উত্তরহীন কথোপকথনে নোট + ADMIN দের জানায়।",
    conditions: [{ field: "unansweredMinutes", op: "gte", value: 120 }],
    steps: [
      { type: "add_conversation_note", text: "২ ঘণ্টা ধরে উত্তর হয়নি" },
      { type: "notify_team", role: "ADMIN", title: "এসকেলেশন", text: "{{contactName}} এর কথোপকথন ২ ঘণ্টা ধরে উত্তরহীন" },
    ],
  },
  {
    key: "delivered_review", name: "ডেলিভারির পর রিভিউ", trigger: "order_delivered",
    descriptionBn: "ডেলিভারির ১ দিন পর টিমকে রিভিউ চাইতে মনে করিয়ে দেয়।",
    steps: [
      { type: "wait", minutes: 1440 },
      { type: "notify_team", title: "রিভিউ চাওয়ার সময়", text: "অর্ডার {{orderNumber}} ডেলিভারি হয়েছে — গ্রাহককে রিভিউ চেয়ে বার্তা দিন" },
    ],
  },
  {
    key: "cod_thanks_ops", name: "COD কনফার্ম — টিম অ্যালার্ট", trigger: "order_cod_confirmed",
    descriptionBn: "COD অর্ডার কনফার্ম হলেই টিমকে প্যাকেজিং শুরু করতে জানায়।",
    steps: [
      { type: "notify_team", title: "COD কনফার্ম", text: "অর্ডার {{orderNumber}} COD কনফার্ম হয়েছে (মোট {{total}} টাকা) — প্যাকেজিং শুরু করুন" },
    ],
  },
  {
    key: "refund_team_alert", name: "Refund হলে টিম অ্যালার্ট", trigger: "order_refunded",
    descriptionBn: "কোনো অর্ডারে refund হলেই টিমকে পরিমাণসহ জানায়।",
    steps: [
      { type: "notify_team", title: "Refund হয়েছে", text: "অর্ডার {{orderNumber}} এ {{refundAmount}} টাকা refund হয়েছে (মোট refund {{cumulativeRefunded}} টাকা) — যাচাই করুন" },
    ],
  },
  {
    key: "shipment_return_alert", name: "পার্সেল রিটার্ন হলে টিম অ্যালার্ট", trigger: "shipment_returned",
    descriptionBn: "কুরিয়ার পার্সেল রিটার্ন কনফার্ম করলেই টিমকে অর্ডার ও ট্র্যাকিং কোডসহ জানায়।",
    steps: [
      { type: "notify_team", title: "পার্সেল রিটার্ন হয়েছে", text: "অর্ডার {{orderNumber}} এর পার্সেল রিটার্ন হয়েছে (ট্র্যাকিং: {{trackingCode}}) — গ্রাহকের সাথে যোগাযোগ করুন" },
    ],
  },
  {
    key: "big_order_alert", name: "বড় অর্ডার অ্যালার্ট", trigger: "order_created",
    descriptionBn: "১,০০০ টাকার বেশি অর্ডার এলেই OWNER কে জানায়।",
    conditions: [{ field: "total", op: "gte", value: 1000 }],
    steps: [
      { type: "notify_team", role: "OWNER", title: "বড় অর্ডার", text: "বড় অর্ডার এসেছে: {{orderNumber}} ({{total}} টাকা)" },
    ],
  },
  {
    key: "cart_recovery_alert", name: "Abandoned Cart রিকভারি", trigger: "cart_abandoned",
    descriptionBn: "গ্রাহক পণ্য কার্টে ফেলে রেখে চলে গেলে টিমকে ফলো-আপ অ্যালার্ট জানায়।",
    steps: [
      { type: "notify_team", title: "কার্ট ফেলে গেছেন", text: "{{contactName}} কার্টে {{itemsCount}}টি আইটেম রেখে গেছেন (মোট {{cartValue}} টাকা) — রিকভারির সুযোগ!" },
    ],
  },
  {
    key: "vip_order_channel_alert", name: "VIP অর্ডারে Slack/চ্যানেল অ্যালার্ট", trigger: "order_created",
    descriptionBn: "৫,০০০ টাকার বেশি VIP অর্ডার আসলে টিম ও চ্যানেলে তাৎক্ষণিক অ্যালার্ট পাঠায়।",
    conditions: [{ field: "total", op: "gte", value: 5000 }],
    steps: [
      { type: "notify_team", role: "OWNER", title: "🎉 বড় VIP অর্ডার", text: "নতুন VIP অর্ডার এসেছে! অর্ডার নং: {{orderNumber}}, মোট: {{total}} টাকা" },
    ],
  },
  {
    key: "ai_inbox_reply_assist", name: "AI ইনবক্স নোট ও অ্যাসিস্ট", trigger: "inbox_message_received",
    descriptionBn: "ইনবক্স বার্তা এলে AI দিয়ে সারসংক্ষেপ নোট যোগ করে।",
    steps: [
      { type: "ai_generate", prompt: "গ্রাহকের বার্তার মূল চাহিদা সংক্ষেপে ১ বাক্যে নোট হিসেবে লিখুন: {{content}}", action: "add_conversation_note" },
    ],
  },
];

const EVENT_TO_TRIGGER: Record<string, string> = {
  "order.created": "order_created",
  "lead.created": "lead_created",
  "lead.stage_changed": "lead_stage_changed",
  "conversation.message_received": "inbox_message_received",
  "order.delivered": "order_delivered",
  "order.cod_confirmed": "order_cod_confirmed",
  "conversation.assigned": "conversation_assigned",
  "conversation.closed": "conversation_closed",
  // Automations A1.
  "order.status_changed": "order_status_changed",
  "order.refunded": "order_refunded",
  // Abandoned carts event.
  "cart.abandoned": "cart_abandoned",
};

@Injectable()
export class WorkflowsService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly messaging: MessagingService,
    @Optional() private readonly inbox?: InboxService,
    @Optional() private readonly llmFactory?: LlmFactory,
  ) {}

  private scanTimer?: ReturnType<typeof setInterval>;

  onModuleInit() {
    // MS8: register as messaging's workflow-creator port so
    // journey presets install through THIS service's real
    // create/update (validator included) without messaging ever
    // importing workflows. Defensive typeof check: unit specs
    // build this service against messaging stubs that may not
    // carry the registration method.
    const register = (this.messaging as any)?.registerWorkflowCreator;
    if (typeof register === "function") register.call(this.messaging, this);
    for (const [event, trigger] of Object.entries(EVENT_TO_TRIGGER)) {
      this.events.on(event, (payload) => this.handleTrigger(trigger, payload));
    }
    // Automations A2: shipment events fan out — every change
    // fires shipment_status_changed; the S5 classifier
    // (courier-performance.ts) decides the delivered/returned
    // extras, so the sets can never drift apart.
    this.events.on("shipment.status_changed", (payload) => this.handleShipmentEvent(payload));
    // Time-based work every 5 minutes (same kill switch as the
    // automation scheduler): unanswered-conversation scan + resuming
    // workflow runs paused on wait steps.
    if (process.env.DISABLE_SCHEDULER !== "true") {
      this.scanTimer = setInterval(() => {
        void (async () => {
          // Milestone 62: one instance per scan cycle across
          // replicas (the unanswered scan fires workflows —
          // duplicates would double-send).
          const claimed = await leaderClaim.tryClaim("workflow-scan", 270);
          if (!claimed) return;
          await this.scanUnanswered().catch(() => undefined);
          await this.scanScheduled().catch(() => undefined);
          await this.scanAbandonedCarts().catch(() => undefined);
          await this.resumeRuns().catch(() => undefined);
        })();
      }, 5 * 60_000);
    }
  }

  /** Resume runs paused on a wait step whose time has come. */
  async resumeRuns(now = new Date()): Promise<number> {
    const due = await (this.prisma as any).workflowRun.findMany({
      // "resuming" rows are listed too: the claim below decides
      // (fresh claims are skipped, stale ones reclaimed).
      where: { status: { in: ["waiting", "resuming"] }, resumeAt: { lte: now } }, take: 50,
    });
    let resumed = 0;
    for (const run of due) {
      // Milestone 62: claim the run atomically before touching
      // it — with several API replicas (or overlapping scans)
      // only the claim winner executes the steps; a run stuck
      // in "resuming" for >15 minutes (crashed claimer) becomes
      // claimable again via the stale branch below.
      let claim: { count: number } = { count: 0 };
      try {
        claim = await (this.prisma as any).workflowRun.updateMany({
          where: {
            id: run.id,
            OR: [
              { status: "waiting" },
              { status: "resuming", updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
            ],
          },
          data: { status: "resuming" },
        });
      } catch { claim = { count: 0 }; }
      if (!claim || claim.count === 0) continue;
      const workflow = await (this.prisma as any).workflow.findFirst({ where: { id: run.workflowId } });
      if (!workflow || !workflow.enabled) {
        await (this.prisma as any).workflowRun.update({ where: { id: run.id }, data: { status: "failed", error: "Workflow disabled or deleted before resume" } });
        continue;
      }
      const context = { ...(run.context as Record<string, any>) };
      // Refresh live conversation facts so branch steps can react to
      // what happened during the wait (e.g. an agent already replied).
      if (context.conversationId) {
        const conv = await (this.prisma as any).channelConversation.findFirst({ where: { id: context.conversationId } }).catch(() => null);
        if (conv) {
          context.conversationStatus = conv.status;
          const reply = conv.lastCustomerMessageAt
            ? await (this.prisma as any).channelMessage.findFirst({
                where: { conversationId: conv.id, direction: "out", createdAt: { gt: conv.lastCustomerMessageAt } },
              }).catch(() => null)
            : null;
          context.agentReplied = Boolean(reply);
          context.unreadCount = conv.unreadCount;
        }
      }
      const stepsLog: any[] = Array.isArray(run.stepsLog) ? [...(run.stepsLog as any[])] : [];
      await this.executeSteps(workflow, run, context, run.nextStepIndex ?? 0, stepsLog, now);
      resumed++;
    }
    return resumed;
  }

  /**
   * inbox_unanswered workflows: fires for open conversations whose last
   * customer message is older than the workflow's unansweredMinutes
   * condition (default 120) with no agent reply since, at most once per
   * conversation per workflow per 24h.
   */
  async scanUnanswered(now = new Date()): Promise<number> {
    const workflows = await (this.prisma as any).workflow.findMany({
      where: { trigger: "inbox_unanswered", enabled: true }, take: 100,
    });
    let fired = 0;
    for (const workflow of workflows) {
      const rule = ((workflow.conditions as any[]) ?? []).find((c: any) => c.field === "unansweredMinutes");
      const minutes = Number(rule?.value ?? 120) || 120;
      const cutoff = new Date(now.getTime() - minutes * 60000);
      const convs = await (this.prisma as any).channelConversation.findMany({
        where: {
          organizationId: workflow.organizationId, status: "open",
          unreadCount: { gt: 0 }, lastCustomerMessageAt: { lt: cutoff },
        },
        take: 50,
      });
      for (const conv of convs) {
        const answered = await (this.prisma as any).channelMessage.findFirst({
          where: { conversationId: conv.id, direction: "out", createdAt: { gt: conv.lastCustomerMessageAt } },
        });
        if (answered) continue;
        const recentRuns = await (this.prisma as any).workflowRun.findMany({
          where: { workflowId: workflow.id, createdAt: { gte: new Date(now.getTime() - 24 * 3600 * 1000) } }, take: 50,
        });
        if (recentRuns.some((r: any) => (r.context as any)?.conversationId === conv.id)) continue;
        await this.runWorkflow(workflow, {
          conversationId: conv.id, channel: conv.channel,
          leadId: conv.leadId ?? undefined, customerId: conv.customerId ?? undefined,
          contactName: conv.contactName ?? undefined, contactPhone: conv.contactPhone ?? undefined,
          intent: "unanswered",
          unansweredMinutes: Math.floor((now.getTime() - new Date(conv.lastCustomerMessageAt).getTime()) / 60000),
        }).catch(() => undefined);
        fired++;
      }
    }
    return fired;
  }

  /**
   * Workflows W2: schedule workflows fire once per
   * Asia/Dhaka day at their configured time (conditions:
   * scheduleTime "HH:MM", optional scheduleDays
   * "0,1,3" — 0 = Sunday). The scanner strips the
   * schedule conditions before evaluation; any OTHER
   * conditions still apply.
   */
  async scanScheduled(now = new Date()): Promise<number> {
    const workflows = await (this.prisma as any).workflow.findMany({
      where: { trigger: "schedule", enabled: true }, take: 100,
    });
    if (!workflows.length) return 0;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const nowMinutes = Number(get("hour")) * 60 + Number(get("minute"));
    const weekdayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    const dhakaDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(now);
    let fired = 0;
    for (const workflow of workflows as any[]) {
      const conds = (workflow.conditions as any[]) ?? [];
      const timeCond = conds.find((c) => c.field === "scheduleTime");
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeCond?.value ?? ""));
      if (!m) continue;
      const atMinutes = Number(m[1]) * 60 + Number(m[2]);
      if (nowMinutes < atMinutes) continue;
      const daysCond = conds.find((c) => c.field === "scheduleDays");
      if (daysCond) {
        const allowed = String(daysCond.value).split(",").map((s) => Number(s.trim()));
        if (!allowed.includes(weekdayIdx)) continue;
      }
      const todays = await (this.prisma as any).workflowRun.findMany({
        where: { workflowId: workflow.id, trigger: "schedule", createdAt: { gte: new Date(now.getTime() - 36 * 3600 * 1000) } },
        take: 20,
      }).catch(() => []);
      if ((todays as any[]).some((r) => (r.context as any)?.date === dhakaDate)) continue;
      const rest = conds.filter((c) => c.field !== "scheduleTime" && c.field !== "scheduleDays");
      await this.runWorkflow({ ...workflow, conditions: rest }, {
        date: dhakaDate, scheduledFor: String(timeCond.value), dayOfWeek: weekdayIdx, source: "schedule",
      }).catch(() => undefined);
      fired++;
    }
    return fired;
  }

  /**
   * Scan for abandoned carts across organizations with active cart_abandoned workflows.
   * Runs during the 5-minute background loop, deduped so each cart only fires once in 24 hours.
   */
  async scanAbandonedCarts(now = new Date()): Promise<number> {
    const p = this.prisma as any;
    const workflows = await p.workflow.findMany({
      where: { trigger: "cart_abandoned", enabled: true },
      take: 100,
    }).catch(() => []);
    if (!workflows || workflows.length === 0) return 0;

    let fired = 0;
    const orgIds = [...new Set(workflows.map((w: any) => w.organizationId))];
    const lookbackStart = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    for (const orgId of orgIds) {
      const orgWorkflows = workflows.filter((w: any) => w.organizationId === orgId);
      const trackingEvents = await p.trackingEvent?.findMany?.({
        where: {
          organizationId: orgId,
          type: { in: ["add_to_cart", "checkout_started", "purchase"] },
          occurredAt: { gte: lookbackStart },
        },
        orderBy: { occurredAt: "asc" },
        take: 5000,
      }).catch(() => []);

      if (!trackingEvents || trackingEvents.length === 0) continue;
      const carts = deriveAbandonedCarts(trackingEvents, now);
      if (carts.length === 0) continue;

      for (const cart of carts.slice(0, 30)) {
        const visitor = await p.visitor?.findFirst?.({
          where: { organizationId: orgId, id: cart.visitorId },
        }).catch(() => null);

        for (const wf of orgWorkflows) {
          const recentRuns = await p.workflowRun.findMany({
            where: {
              workflowId: wf.id,
              trigger: "cart_abandoned",
              createdAt: { gte: new Date(now.getTime() - 24 * 3600 * 1000) },
            },
            take: 100,
          }).catch(() => []);

          const alreadyFired = recentRuns.some(
            (r: any) =>
              (r.context as any)?.visitorId === cart.visitorId ||
              (r.context as any)?.sessionKey === cart.sessionKey,
          );
          if (alreadyFired) continue;

          const cartContext: Record<string, any> = {
            visitorId: cart.visitorId,
            sessionKey: cart.sessionKey,
            storeId: cart.storeId,
            signal: cart.signal,
            cartValue: cart.valueMinor != null ? Number(cart.valueMinor) / 100 : 0,
            itemsCount: cart.items.length,
            itemsSummary: cart.items.map((i: any) => `${i.name || i.productId || "Product"}${i.quantity ? ` x${i.quantity}` : ""}`).join(", "),
            contactEmail: visitor?.email ?? undefined,
            contactPhone: visitor?.phone ?? undefined,
            contactName: visitor?.name ?? "Shopper",
            lastActivityAt: cart.lastActivityAt,
          };

          await this.runWorkflow(wf, cartContext).catch(() => undefined);
          fired++;
        }
      }
    }
    return fired;
  }

  // ---------- CRUD ----------
  /** One validator for create AND update (Workflows W1). */
  private async validateDefinition(organizationId: string, trigger: string, steps: any[], conditions?: unknown) {
    if (!(WORKFLOW_TRIGGERS as readonly string[]).includes(trigger)) throw new BadRequestException("Invalid trigger");
    if (trigger === "schedule") {
      // Workflows W2: a schedule workflow needs its time.
      const conds = (conditions as any[]) ?? [];
      const t = conds.find((c) => c?.field === "scheduleTime");
      if (!t || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(t.value ?? ""))) {
        throw new BadRequestException("schedule workflows need a scheduleTime condition (HH:MM, Asia/Dhaka)");
      }
    }
    if (!Array.isArray(steps) || steps.length === 0) throw new BadRequestException("A workflow needs at least one step");
    await this.validateSteps(organizationId, steps, 0);
  }

  /** Per-step validation, recursive for branch arms
   *  (Workflows W4: arms hold one level of sub-steps;
   *  no branch and no wait inside an arm in v1). */
  private async validateSteps(organizationId: string, steps: any[], depth: number) {
    for (const step of steps) {
      if (!(STEP_TYPES as readonly string[]).includes(step.type)) throw new BadRequestException(`Invalid step type: ${step.type}`);
      if ((step.type === "send_email" || step.type === "send_sms") && !step.templateId) {
        throw new BadRequestException(`${step.type} steps need a templateId`);
      }
      if (step.type === "wait" && (!Number(step.minutes) || Number(step.minutes) < 1 || Number(step.minutes) > 43200)) {
        throw new BadRequestException("wait steps need minutes between 1 and 43200 (30 days)");
      }
      if (step.type === "condition" && (!step.field || !step.op)) {
        throw new BadRequestException("condition steps need a field and an operator");
      }
      if (step.type === "send_inbox_message" && !step.text && !step.whatsappTemplateId) {
        throw new BadRequestException("send_inbox_message steps need text or a whatsappTemplateId");
      }
      // Workflows W3 step validation.
      if (step.type === "assign_conversation" && !step.userId && !step.clear) {
        throw new BadRequestException("assign_conversation steps need a userId (or clear: true)");
      }
      if (step.type === "change_lead_stage" && !["new", "contacted", "qualified", "proposal", "won", "lost"].includes(step.stage)) {
        throw new BadRequestException("change_lead_stage steps need a valid stage");
      }
      if (step.type === "add_tag" && (!step.tag || !["lead", "conversation"].includes(step.target ?? "lead"))) {
        throw new BadRequestException("add_tag steps need a tag and a target (lead | conversation)");
      }
      if (step.type === "notify_team" && !step.text) {
        throw new BadRequestException("notify_team steps need text");
      }
      if (step.type === "create_follow_up" && (!Number(step.days) || Number(step.days) < 1 || Number(step.days) > 90)) {
        throw new BadRequestException("create_follow_up steps need days between 1 and 90");
      }
      if (step.type === "http_webhook") {
        let u: URL | null = null;
        try { u = new URL(String(step.url ?? "")); } catch { u = null; }
        if (!u || u.protocol !== "https:" || isBlockedWebhookHost(u.hostname)) {
          throw new BadRequestException("http_webhook steps need a public https URL");
        }
      }
      if (step.type === "notify_channel") {
        let u: URL | null = null;
        try { u = new URL(String(step.url ?? "")); } catch { u = null; }
        if (!u || u.protocol !== "https:" || isBlockedWebhookHost(u.hostname)) {
          throw new BadRequestException("notify_channel steps need a public https webhook URL");
        }
        if (!step.text) throw new BadRequestException("notify_channel steps need text");
      }
      if (step.type === "ai_generate" && !step.prompt) {
        throw new BadRequestException("ai_generate steps need a prompt");
      }
      // Workflows W4: branch shape + arm rules.
      if (step.type === "branch") {
        if (depth > 0) throw new BadRequestException("branch steps cannot nest inside a branch arm");
        if (!step.field || !step.op) throw new BadRequestException("branch steps need a field and an operator");
        const thenSteps = Array.isArray(step.then) ? step.then : [];
        const elseSteps = Array.isArray(step.else) ? step.else : [];
        if (thenSteps.length + elseSteps.length === 0) throw new BadRequestException("branch steps need at least one sub-step in an arm");
        await this.validateSteps(organizationId, thenSteps, depth + 1);
        await this.validateSteps(organizationId, elseSteps, depth + 1);
      }
      if (depth > 0 && step.type === "wait") {
        throw new BadRequestException("wait steps are not allowed inside a branch arm (v1)");
      }
      if (step.templateId) await this.messaging.getTemplate(organizationId, step.templateId);
    }
  }

  async create(organizationId: string, actorId: string, dto: { name: string; trigger: string; conditions?: unknown; steps: any[]; cooldownMinutes?: number; dailyRunCap?: number | null }) {
    await this.validateDefinition(organizationId, dto.trigger, dto.steps, dto.conditions);
    const workflow = await (this.prisma as any).workflow.create({
      data: {
        organizationId, name: dto.name, trigger: dto.trigger, conditions: dto.conditions ?? undefined, steps: dto.steps, enabled: true, createdById: actorId,
        ...(dto.cooldownMinutes !== undefined ? { cooldownMinutes: Math.max(0, Math.min(10080, Math.floor(Number(dto.cooldownMinutes) || 0))) } : {}),
        ...(dto.dailyRunCap !== undefined ? { dailyRunCap: dto.dailyRunCap === null ? null : Math.max(1, Math.min(10000, Math.floor(Number(dto.dailyRunCap) || 1))) } : {}),
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "workflow.create", entityType: "Workflow", entityId: workflow.id });
    return workflow;
  }

  async list(organizationId: string) {
    return (this.prisma as any).workflow.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  }

  async update(organizationId: string, workflowId: string, dto: { enabled?: boolean; name?: string; trigger?: string; conditions?: unknown; steps?: any[]; cooldownMinutes?: number; dailyRunCap?: number | null }, actorId?: string) {
    const workflow = await (this.prisma as any).workflow.findFirst({ where: { id: workflowId, organizationId } });
    if (!workflow) throw new NotFoundException("Workflow not found");
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.conditions !== undefined) data.conditions = dto.conditions;
    // Workflows W6 governance fields.
    if (dto.cooldownMinutes !== undefined) {
      const v = Number(dto.cooldownMinutes);
      if (!Number.isFinite(v) || v < 0 || v > 10080) throw new BadRequestException("cooldownMinutes must be 0..10080");
      data.cooldownMinutes = Math.floor(v);
    }
    if (dto.dailyRunCap !== undefined) {
      if (dto.dailyRunCap === null) data.dailyRunCap = null;
      else {
        const v = Number(dto.dailyRunCap);
        if (!Number.isFinite(v) || v < 1 || v > 10000) throw new BadRequestException("dailyRunCap must be 1..10000 (or null to clear)");
        data.dailyRunCap = Math.floor(v);
      }
    }
    if (dto.trigger !== undefined || dto.steps !== undefined || dto.conditions !== undefined) {
      // Validate the RESULTING definition, not just the delta.
      await this.validateDefinition(
        organizationId, dto.trigger ?? workflow.trigger, dto.steps ?? (workflow.steps as any[]),
        dto.conditions !== undefined ? dto.conditions : workflow.conditions,
      );
      if (dto.trigger !== undefined) data.trigger = dto.trigger;
      if (dto.steps !== undefined) data.steps = dto.steps;
    }
    const updated = await (this.prisma as any).workflow.update({ where: { id: workflowId }, data });
    await this.audit.log({ organizationId, userId: actorId, action: "workflow.update", entityType: "Workflow", entityId: workflowId, metadata: { fields: Object.keys(data) } }).catch(() => undefined);
    return updated;
  }

  /** Workflows W1: duplicate a workflow — DISABLED, so a
   *  clone can never double-send before a human reviews it. */
  async clone(organizationId: string, workflowId: string, actorId: string, dto?: { name?: string }) {
    const workflow = await (this.prisma as any).workflow.findFirst({ where: { id: workflowId, organizationId } });
    if (!workflow) throw new NotFoundException("Workflow not found");
    const copy = await (this.prisma as any).workflow.create({
      data: {
        organizationId, name: dto?.name?.trim() || `${workflow.name} (কপি)`,
        trigger: workflow.trigger, conditions: workflow.conditions ?? undefined,
        steps: workflow.steps, enabled: false, createdById: actorId,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "workflow.clone", entityType: "Workflow", entityId: copy.id, metadata: { sourceId: workflowId } }).catch(() => undefined);
    return copy;
  }

  async delete(organizationId: string, workflowId: string, actorId?: string) {
    const workflow = await (this.prisma as any).workflow.findFirst({ where: { id: workflowId, organizationId } });
    if (!workflow) throw new NotFoundException("Workflow not found");
    await (this.prisma as any).workflow.delete({ where: { id: workflowId } });
    await this.audit.log({ organizationId, userId: actorId, action: "workflow.delete", entityType: "Workflow", entityId: workflowId }).catch(() => undefined);
    return { deleted: true };
  }

  /**
   * Workflows W6: the server-side preset gallery. Every
   * preset uses only steps that work with its trigger's
   * real context (checked against the producers) — e.g.
   * order contexts have no conversationId, so order
   * presets notify the team instead of messaging a
   * conversation that does not exist.
   */
  listPresets() {
    return WORKFLOW_PRESETS;
  }

  /** Install a preset — DISABLED, like a clone, so a
   *  human reviews before it can act. */
  async installPreset(organizationId: string, actorId: string, key: string, dto?: { name?: string }) {
    const preset = WORKFLOW_PRESETS.find((x) => x.key === key);
    if (!preset) throw new NotFoundException("Preset not found");
    const workflow = await (this.prisma as any).workflow.create({
      data: {
        organizationId, name: dto?.name?.trim() || preset.name, trigger: preset.trigger,
        conditions: preset.conditions ?? undefined, steps: preset.steps,
        enabled: false, createdById: actorId,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "workflow.preset_install", entityType: "Workflow", entityId: workflow.id, metadata: { preset: key } }).catch(() => undefined);
    return workflow;
  }

  async listRuns(organizationId: string, filters?: { workflowId?: string; status?: string; take?: number }) {
    const where: any = { organizationId };
    if (filters?.workflowId) where.workflowId = filters.workflowId;
    if (filters?.status) where.status = filters.status;
    const take = Math.min(Math.max(Number(filters?.take ?? 50) || 50, 1), 200);
    return (this.prisma as any).workflowRun.findMany({ where, orderBy: { createdAt: "desc" }, take });
  }

  /**
   * Workflows W5: fill a context's missing facts from the
   * rows it points at (order / lead / customer /
   * conversation). Existing keys always win. Used by the
   * order-event path (W2) and by manual runs.
   */
  async enrichContext(organizationId: string, input: Record<string, any>): Promise<Record<string, any>> {
    const p = this.prisma as any;
    const context = { ...input };
    if (context.orderId && !context.customerId) {
      const order = await p.order?.findFirst?.({ where: { id: context.orderId, organizationId } })?.catch?.(() => null);
      if (order) {
        context.orderNumber = context.orderNumber ?? (order.externalNumber ?? order.externalId);
        context.customerId = order.customerId ?? undefined;
        context.total = context.total ?? (order.totalMinor != null ? Number(order.totalMinor) / 100 : undefined);
        context.currency = context.currency ?? order.currency;
        context.status = context.status ?? order.status;
        context.source = context.source ?? order.source;
      }
    }
    if (context.conversationId && !context.contactName) {
      const conv = await p.channelConversation?.findFirst?.({ where: { id: context.conversationId, organizationId } })?.catch?.(() => null);
      if (conv) {
        context.channel = context.channel ?? conv.channel;
        context.contactName = context.contactName ?? (conv.contactName ?? undefined);
        context.contactPhone = context.contactPhone ?? (conv.contactPhone ?? undefined);
        context.leadId = context.leadId ?? (conv.leadId ?? undefined);
        context.customerId = context.customerId ?? (conv.customerId ?? undefined);
      }
    }
    if (context.leadId && !context.contactName) {
      const lead = await p.lead?.findFirst?.({ where: { id: context.leadId, organizationId } })?.catch?.(() => null);
      if (lead) {
        context.contactName = lead.name ?? undefined;
        context.contactPhone = context.contactPhone ?? (lead.phone ?? undefined);
        context.contactEmail = context.contactEmail ?? (lead.email ?? undefined);
        context.stage = context.stage ?? lead.stage;
        context.source = context.source ?? (lead.source ?? undefined);
      }
    }
    if (context.customerId && !context.contactName) {
      const customer = await p.customer?.findFirst?.({ where: { id: context.customerId, organizationId } })?.catch?.(() => null);
      if (customer) {
        context.contactName = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || undefined;
        context.contactPhone = context.contactPhone ?? (customer.phone ?? undefined);
        context.contactEmail = context.contactEmail ?? (customer.email ?? undefined);
      }
    }
    if (context.visitorId && (!context.contactName || !context.contactEmail)) {
      const visitor = await p.visitor?.findFirst?.({ where: { id: context.visitorId, organizationId } })?.catch?.(() => null);
      if (visitor) {
        context.contactName = context.contactName ?? (visitor.name ?? undefined);
        context.contactPhone = context.contactPhone ?? (visitor.phone ?? undefined);
        context.contactEmail = context.contactEmail ?? (visitor.email ?? undefined);
      }
    }
    return context;
  }

  /** Workflows W5: per-workflow run statistics (30 days). */
  async stats(organizationId: string) {
    const p = this.prisma as any;
    const workflows = await p.workflow.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const runs = await p.workflowRun.findMany({
      where: { organizationId, createdAt: { gte: since } }, take: 5000,
    }).catch(() => []);
    return (workflows as any[]).map((w) => {
      const mine = (runs as any[]).filter((r) => r.workflowId === w.id);
      const count = (s: string) => mine.filter((r) => r.status === s).length;
      const completed = count("completed");
      const failed = count("failed");
      const decided = completed + failed;
      return {
        workflowId: w.id, name: w.name, enabled: w.enabled,
        runs30d: mine.length, completed, failed, skipped: count("skipped"), waiting: count("waiting"),
        successRate: decided ? Math.round((completed / decided) * 1000) / 10 : null,
        lastRunAt: mine.length ? mine.map((r) => r.createdAt).sort().slice(-1)[0] : null,
      };
    });
  }

  /**
   * Workflows W5: simulate a workflow against a context.
   * Reads only (recipient + template lookups) — NOTHING
   * is sent, written or stored. The trace says what
   * WOULD happen, including honest would-fail entries.
   */
  async dryRun(organizationId: string, workflowId: string, rawContext: Record<string, any>) {
    const workflow = await (this.prisma as any).workflow.findFirst({ where: { id: workflowId, organizationId } });
    if (!workflow) throw new NotFoundException("Workflow not found");
    const context = await this.enrichContext(organizationId, rawContext ?? {});
    if (!evaluateConditions(context, workflow.conditions ?? undefined)) {
      return { workflowId, conditionsPassed: false, context, trace: [] as any[] };
    }
    const trace: any[] = [];
    const simulate = async (steps: any[], branchArm?: string) => {
      for (const step of steps) {
        const entry: any = { step: step.type, ...(branchArm ? { branch: branchArm } : {}) };
        try {
          if (step.type === "wait") entry.detail = `would pause ${Number(step.minutes)} minutes, then continue`;
          else if (step.type === "condition") {
            const ok = evaluateConditions(context, [{ field: step.field, op: step.op, value: step.value }]);
            entry.detail = `condition ${step.field} ${step.op} ${JSON.stringify(step.value)} -> ${ok}${ok ? "" : " (run would stop here)"}`;
            trace.push(entry);
            if (!ok) return false;
            continue;
          } else if (step.type === "branch") {
            const ok = evaluateConditions(context, [{ field: step.field, op: step.op, value: step.value }]);
            const arm = ok ? "then" : "else";
            entry.detail = `branch ${step.field} ${step.op} ${JSON.stringify(step.value)} -> ${ok} (${arm})`;
            trace.push(entry);
            await simulate(Array.isArray(step[arm]) ? step[arm] : [], arm);
            continue;
          } else if (step.type === "send_email" || step.type === "send_sms") {
            const template = await this.messaging.getTemplate(organizationId, step.templateId);
            const recipient = await this.resolveRecipient(organizationId, context);
            entry.detail = recipient
              ? `would send ${step.type === "send_email" ? "email" : "SMS"} to ${recipient.name ?? recipient.id} using template "${template.name}"`
              : "would FAIL: no recipient could be resolved from this context";
          } else if (step.type === "send_inbox_message") {
            entry.detail = context.conversationId
              ? `would send to conversation ${context.conversationId}: "${renderTemplate(String(step.text ?? ""), context).slice(0, 80)}"`
              : "would FAIL: send_inbox_message needs a conversation context";
          } else if (step.type === "http_webhook") entry.detail = `would POST the context to ${String(step.url)} (not called in a dry run)`;
          else if (step.type === "notify_channel") entry.detail = `would send alert to channel webhook ${String(step.url)} (not called in a dry run)`;
          else if (step.type === "ai_generate") entry.detail = `would generate AI output from prompt: "${renderTemplate(String(step.prompt ?? ""), context).slice(0, 60)}"`;
          else if (step.type === "change_lead_stage") entry.detail = context.leadId ? `would move lead ${context.leadId} to stage ${step.stage}` : "would FAIL: no lead in context";
          else if (step.type === "assign_conversation") entry.detail = context.conversationId ? (step.clear ? "would unassign the conversation" : `would assign the conversation to ${step.userId}`) : "would FAIL: no conversation in context";
          else if (step.type === "add_tag") entry.detail = `would add tag "${step.tag}" to the ${step.target ?? "lead"}`;
          else if (step.type === "notify_team") entry.detail = `would notify ${step.userId ? `user ${step.userId}` : step.role ? `${step.role} members` : "all active members"}: "${renderTemplate(String(step.text ?? ""), context).slice(0, 80)}"`;
          else if (step.type === "create_follow_up") entry.detail = context.leadId ? `would set a follow-up in ${Number(step.days)} days on lead ${context.leadId}` : "would FAIL: no lead in context";
          else if (step.type === "add_conversation_note") entry.detail = context.conversationId ? "would add an internal note to the conversation" : "would FAIL: no conversation in context";
          else if (step.type === "add_lead_activity") entry.detail = context.leadId ? "would add an activity to the lead" : "would FAIL: no lead in context";
          else entry.detail = "would run";
        } catch (e) {
          entry.detail = `would FAIL: ${e instanceof Error ? e.message : "error"}`;
        }
        trace.push(entry);
      }
      return true;
    };
    await simulate((workflow.steps as any[]) ?? []);
    return { workflowId, conditionsPassed: true, context, trace };
  }

  /** Workflows W5: run a workflow by hand against a
   *  chosen context (works on disabled workflows too —
   *  a deliberate human action). */
  async manualRun(organizationId: string, workflowId: string, actorId: string, rawContext: Record<string, any>) {
    const workflow = await (this.prisma as any).workflow.findFirst({ where: { id: workflowId, organizationId } });
    if (!workflow) throw new NotFoundException("Workflow not found");
    const context = await this.enrichContext(organizationId, rawContext ?? {});
    const run = await this.runWorkflow(workflow, { ...context, manualRunBy: actorId }, { governance: false });
    await this.audit.log({ organizationId, userId: actorId, action: "workflow.manual_run", entityType: "Workflow", entityId: workflowId, metadata: { runId: run.id } }).catch(() => undefined);
    return (this.prisma as any).workflowRun.findUnique({ where: { id: run.id } });
  }

  /** Workflows W5: re-execute a FAILED run's context
   *  against the workflow's current definition. */
  async retryRun(organizationId: string, runId: string, actorId: string) {
    const p = this.prisma as any;
    const old = await p.workflowRun.findFirst({ where: { id: runId, organizationId } });
    if (!old) throw new NotFoundException("Run not found");
    if (old.status !== "failed") throw new BadRequestException("Only failed runs can be retried");
    const workflow = await p.workflow.findFirst({ where: { id: old.workflowId, organizationId } });
    if (!workflow) throw new BadRequestException("The workflow no longer exists");
    const run = await this.runWorkflow(workflow, { ...(old.context as any), _retryOf: old.id }, { governance: false });
    await this.audit.log({ organizationId, userId: actorId, action: "workflow.run_retry", entityType: "WorkflowRun", entityId: old.id, metadata: { newRunId: run.id } }).catch(() => undefined);
    return p.workflowRun.findUnique({ where: { id: run.id } });
  }

  /** Workflows W5: tell the workflow's creator a run
   *  failed — at most once per workflow per hour. */
  private async notifyRunFailure(workflow: any, failedDetail: string) {
    const p = this.prisma as any;
    try {
      const recent = await p.auditLog?.findFirst?.({
        where: {
          organizationId: workflow.organizationId, action: "workflow.run_failed_notified",
          entityId: workflow.id, createdAt: { gte: new Date(Date.now() - 3600 * 1000) },
        },
      })?.catch?.(() => null);
      if (recent) return;
      const creator = workflow.createdById;
      if (!creator || creator === "system") return;
      const member = await p.membership?.findFirst?.({ where: { organizationId: workflow.organizationId, userId: creator, status: "ACTIVE" } })?.catch?.(() => null);
      if (!member) return;
      await p.agentNotification?.create?.({
        data: {
          organizationId: workflow.organizationId, userId: creator, type: "workflow_failed",
          title: "⚠️ Workflow ব্যর্থ হয়েছে",
          body: `"${workflow.name}" — ${failedDetail}`.slice(0, 500),
          conversationId: null,
        },
      })?.catch?.(() => undefined);
      await this.audit.log({
        organizationId: workflow.organizationId, userId: creator,
        action: "workflow.run_failed_notified", entityType: "Workflow", entityId: workflow.id,
      }).catch(() => undefined);
    } catch { /* a notification must never break a run */ }
  }

  // ---------- Engine ----------
  /**
   * Automations A2 dispatcher: one `shipment.status_changed`
   * event (emitted by CourierService.syncShipment) feeds
   * three triggers. The delivered/returned decision reuses
   * S5's classifyShipmentStatus verbatim — delivered =
   * delivered | partial_delivered | partially_delivered,
   * returned = returned | return (after the shared
   * trim/lowercase/underscore normalization).
   */
  async handleShipmentEvent(payload: { organizationId: string; context: Record<string, any> }): Promise<void> {
    await this.handleTrigger("shipment_status_changed", payload);
    const outcome = classifyShipmentStatus(payload?.context?.shipmentStatus);
    if (outcome === "delivered") await this.handleTrigger("shipment_delivered", payload);
    else if (outcome === "returned") await this.handleTrigger("shipment_returned", payload);
  }

  async handleTrigger(trigger: string, payload: { organizationId: string; context: Record<string, any> }): Promise<void> {
    const { organizationId } = payload;
    if (!organizationId) return;
    // Automations A1: normalize the S2 order events into
    // builder-friendly fields WITHOUT changing the raw emit
    // shape — order_status_changed carries from/to, and
    // order_refunded carries minor-unit strings; conditions
    // (gte) and templates need named fields and taka numbers.
    // The raw fields stay in the context untouched.
    const rawContext = { ...(payload.context ?? {}) };
    if (trigger === "order_status_changed") {
      if (rawContext.from !== undefined) rawContext.fromStatus = rawContext.fromStatus ?? rawContext.from;
      if (rawContext.to !== undefined) rawContext.toStatus = rawContext.toStatus ?? rawContext.to;
    }
    if (trigger === "order_refunded") {
      if (rawContext.amountMinor != null && Number.isFinite(Number(rawContext.amountMinor))) {
        rawContext.refundAmount = rawContext.refundAmount ?? Number(rawContext.amountMinor) / 100;
      }
      if (rawContext.cumulativeRefundedMinor != null && Number.isFinite(Number(rawContext.cumulativeRefundedMinor))) {
        rawContext.cumulativeRefunded = rawContext.cumulativeRefunded ?? Number(rawContext.cumulativeRefundedMinor) / 100;
      }
    }
    // Workflows W2/W5: enrich bare-id contexts (the
    // delivered / COD events carry only an orderId) so
    // conditions and recipient resolution work exactly
    // like order_created contexts.
    const context = await this.enrichContext(organizationId, rawContext);
    const workflows = await (this.prisma as any).workflow.findMany({
      where: { organizationId, trigger, enabled: true },
    });
    for (const workflow of workflows) {
      await this.runWorkflow(workflow, context).catch((e) =>
        this.logger.warn(`Workflow ${workflow.id} failed: ${e instanceof Error ? e.message : e}`));
    }
  }

  /**
   * Workflows W6 governance for AUTOMATED firings:
   * per-entity cooldown + a daily (Asia/Dhaka) run cap.
   * Returns a skip reason, or null to proceed. Skipped
   * runs are recorded (status skipped, error = reason)
   * but governance skips never count toward either
   * limit themselves — no self-perpetuation.
   */
  private async governanceSkip(workflow: any, context: Record<string, any>): Promise<string | null> {
    const p = this.prisma as any;
    const isGovernanceSkip = (r: any) => typeof r.error === "string" && (r.error.startsWith("cooldown:") || r.error.startsWith("daily_cap:"));
    const entityKey = (["conversationId", "leadId", "customerId", "orderId"] as const).find((k) => context[k]);
    if (Number(workflow.cooldownMinutes) > 0 && entityKey) {
      const since = new Date(Date.now() - Number(workflow.cooldownMinutes) * 60000);
      const recent = await p.workflowRun.findMany({
        where: { workflowId: workflow.id, createdAt: { gte: since } }, take: 100,
      }).catch(() => []);
      const hit = (recent as any[]).find((r) => !isGovernanceSkip(r) && (r.context as any)?.[entityKey] === context[entityKey]);
      if (hit) return `cooldown: ${entityKey} ran at ${new Date(hit.createdAt).toISOString()}, cooldown ${workflow.cooldownMinutes}m`;
    }
    if (workflow.dailyRunCap != null && Number(workflow.dailyRunCap) > 0) {
      const dayStart = new Date(Date.now() - 24 * 3600 * 1000);
      const recent = await p.workflowRun.findMany({
        where: { workflowId: workflow.id, createdAt: { gte: dayStart } }, take: 1000,
      }).catch(() => []);
      const dhakaToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
      const todays = (recent as any[]).filter((r) => !isGovernanceSkip(r)
        && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date(r.createdAt)) === dhakaToday);
      if (todays.length >= Number(workflow.dailyRunCap)) return `daily_cap: ${todays.length}/${workflow.dailyRunCap} runs today (Asia/Dhaka)`;
    }
    return null;
  }

  async runWorkflow(workflow: any, context: Record<string, any>, opts?: { governance?: boolean }) {
    const organizationId: string = workflow.organizationId;
    // Workflows W6: automated firings are governed;
    // manual + retry runs (governance: false) are not.
    if (opts?.governance !== false) {
      const skip = await this.governanceSkip(workflow, context).catch(() => null);
      if (skip) {
        return (this.prisma as any).workflowRun.create({
          data: { organizationId, workflowId: workflow.id, trigger: workflow.trigger, context, status: "skipped", stepsLog: [], error: skip, stepsSnapshot: workflow.steps },
        });
      }
    }
    if (!evaluateConditions(context, workflow.conditions ?? undefined)) {
      return (this.prisma as any).workflowRun.create({
        data: { organizationId, workflowId: workflow.id, trigger: workflow.trigger, context, status: "skipped", stepsLog: [], error: null },
      });
    }
    const run = await (this.prisma as any).workflowRun.create({
      data: {
        organizationId, workflowId: workflow.id, trigger: workflow.trigger, context, status: "completed", stepsLog: [],
        // Workflows W1: freeze the definition for this run.
        stepsSnapshot: workflow.steps,
      },
    });
    await this.executeSteps(workflow, run, context, 0, [], new Date());
    return run;
  }

  /**
   * Execute steps from an index. A "wait" step pauses the run (status
   * waiting + resumeAt + nextStepIndex); resumeRuns() continues it.
   * A "condition" step that fails stops the run as completed (branch
   * not taken) - later steps belong to the taken branch only.
   */
  private async executeSteps(workflow: any, run: any, context: Record<string, any>, fromIndex: number, stepsLog: any[], now: Date) {
    const organizationId: string = workflow.organizationId;
    // Workflows W1: a run executes its START-TIME snapshot;
    // only brand-new runs (no snapshot) read the live steps.
    const steps = ((run as any).stepsSnapshot ?? workflow.steps) as any[] ?? [];
    let anyFailed = false;
    for (let i = fromIndex; i < steps.length; i++) {
      const step = steps[i];
      try {
        if (step.type === "wait") {
          const minutes = Number(step.minutes);
          const resumeAt = new Date(now.getTime() + minutes * 60000);
          stepsLog.push({ step: "wait", status: "ok", detail: `Paused for ${minutes} minutes (resume at ${resumeAt.toISOString()})` });
          await (this.prisma as any).workflowRun.update({
            where: { id: run.id },
            data: { status: "waiting", resumeAt, nextStepIndex: i + 1, stepsLog, context },
          });
          return;
        }
        if (step.type === "condition") {
          const ok = evaluateConditions(context, [{ field: step.field, op: step.op, value: step.value }]);
          stepsLog.push({ step: "condition", status: ok ? "ok" : "skipped", detail: `${step.field} ${step.op} ${JSON.stringify(step.value)} -> ${ok}` });
          if (!ok) break; // branch not taken: stop, run completes
          continue;
        }
        if (step.type === "branch") {
          // Workflows W4: two-armed branching. Sub-steps
          // run inline (waits are refused inside arms at
          // validation time, so a branch never pauses).
          const ok = evaluateConditions(context, [{ field: step.field, op: step.op, value: step.value }]);
          const arm = ok ? "then" : "else";
          const subs: any[] = Array.isArray(step[arm]) ? step[arm] : [];
          stepsLog.push({ step: "branch", status: "ok", detail: `${step.field} ${step.op} ${JSON.stringify(step.value)} -> ${ok} (${arm}: ${subs.length} steps)` });
          for (const sub of subs) {
            try {
              const detail = await this.executeStep(organizationId, run.id, sub, context);
              stepsLog.push({ step: sub.type, status: "ok", detail, branch: arm });
            } catch (e) {
              if (e instanceof StepSkippedError) {
                stepsLog.push({ step: sub.type, status: "skipped", detail: e.message, branch: arm });
              } else {
                anyFailed = true;
                stepsLog.push({ step: sub.type, status: "failed", detail: e instanceof Error ? e.message : "Step failed", branch: arm });
              }
            }
          }
          continue;
        }
        const detail = await this.executeStep(organizationId, run.id, step, context);
        stepsLog.push({ step: step.type, status: "ok", detail });
      } catch (e) {
        if (e instanceof StepSkippedError) {
          stepsLog.push({ step: step.type, status: "skipped", detail: e.message });
        } else {
          anyFailed = true;
          stepsLog.push({ step: step.type, status: "failed", detail: e instanceof Error ? e.message : "Step failed" });
        }
      }
    }
    await (this.prisma as any).workflowRun.update({
      where: { id: run.id },
      data: { status: anyFailed ? "failed" : "completed", stepsLog, resumeAt: null, context },
    });
    if (anyFailed) {
      // Workflows W5: the creator hears about failures
      // (throttled to one per workflow per hour inside).
      const firstFail = stepsLog.find((s) => s.status === "failed");
      await this.notifyRunFailure(workflow, firstFail ? `${firstFail.step}: ${firstFail.detail}` : "একটি ধাপ ব্যর্থ হয়েছে");
    }
  }

  private async executeStep(organizationId: string, runId: string, step: any, context: Record<string, any>): Promise<string> {
    if (step.type === "send_email" || step.type === "send_sms") {
      const channel = step.type === "send_email" ? "email" : "sms";
      const template = await this.messaging.getTemplate(organizationId, step.templateId);
      if (template.channel !== channel) throw new Error(`Template channel (${template.channel}) does not match step (${channel})`);
      const recipient = await this.resolveRecipient(organizationId, context);
      if (!recipient) throw new Error("No recipient could be resolved from the trigger context");
      const result = await this.messaging.sendToRecipient(organizationId, {
        channel, recipient, subject: template.subject, body: template.body,
        vars: context, workflowRunId: runId,
      });
      // MS2: an opt-out skip is not a send and not a failure.
      if (result.status === "skipped") throw new StepSkippedError(result.error ?? "Recipient opted out");
      if (result.status !== "sent") throw new Error(result.error ?? "Send failed");
      return `${channel} sent to ${result.address} (provider id ${result.providerMessageId})`;
    }
    if (step.type === "send_inbox_message") {
      if (!this.inbox) throw new Error("Inbox service is not available to workflows");
      if (!context.conversationId) throw new Error("send_inbox_message needs a conversation context");
      if (step.whatsappTemplateId) {
        await this.inbox.sendTemplate(organizationId, "workflow", context.conversationId, step.whatsappTemplateId, Array.isArray(step.templateParams) ? step.templateParams : []);
        return "WhatsApp template sent to the conversation";
      }
      const text = renderTemplate(String(step.text ?? ""), context);
      if (!text.trim()) throw new Error("send_inbox_message text is empty after rendering");
      await this.inbox.sendAutomatedMessage(organizationId, context.conversationId, text, "workflow");
      return "Inbox message sent to the conversation";
    }
    if (step.type === "add_conversation_note") {
      if (!context.conversationId) throw new Error("add_conversation_note needs a conversation context");
      await (this.prisma as any).conversationNote.create({
        data: {
          organizationId, conversationId: context.conversationId, authorUserId: "workflow",
          content: step.text ?? "Workflow note",
        },
      });
      return "Conversation note added";
    }
    if (step.type === "add_lead_activity") {
      if (!context.leadId) throw new Error("add_lead_activity needs a lead context");
      await (this.prisma as any).leadActivity.create({
        data: { leadId: context.leadId, userId: null, type: "note", content: step.text ?? "Workflow note" },
      });
      return "Lead activity added";
    }
    // ---------- Workflows W3 actions ----------
    if (step.type === "assign_conversation") {
      if (!context.conversationId) throw new Error("assign_conversation needs a conversation context");
      if (step.userId) {
        const member = await (this.prisma as any).membership.findFirst({ where: { organizationId, userId: step.userId, status: "ACTIVE" } });
        if (!member) throw new Error("Assignee is not an active member of this organization");
      }
      await (this.prisma as any).channelConversation.update({
        where: { id: context.conversationId },
        data: { assignedUserId: step.clear ? null : step.userId },
      });
      return step.clear ? "Conversation unassigned" : `Conversation assigned to ${step.userId}`;
    }
    if (step.type === "change_lead_stage") {
      if (!context.leadId) throw new Error("change_lead_stage needs a lead context");
      const lead = await (this.prisma as any).lead.findFirst({ where: { id: context.leadId, organizationId } });
      if (!lead) throw new Error("Lead not found");
      if (lead.stage === step.stage) return `Lead already at stage ${step.stage}`;
      await (this.prisma as any).lead.update({ where: { id: lead.id }, data: { stage: step.stage } });
      await (this.prisma as any).leadActivity.create({
        data: { leadId: lead.id, userId: null, type: "stage", content: `Workflow: stage ${lead.stage} → ${step.stage}` },
      }).catch(() => undefined);
      // Deliberately NO lead.stage_changed event: a
      // workflow moving a stage must never re-trigger
      // workflows (loop-proof by construction).
      return `Lead stage ${lead.stage} → ${step.stage}`;
    }
    if (step.type === "add_tag") {
      const tag = String(step.tag).trim().slice(0, 40);
      if (!tag) throw new Error("add_tag tag is empty");
      const target = step.target ?? "lead";
      if (target === "lead") {
        if (!context.leadId) throw new Error("add_tag (lead) needs a lead context");
        const lead = await (this.prisma as any).lead.findFirst({ where: { id: context.leadId, organizationId } });
        if (!lead) throw new Error("Lead not found");
        const tags: string[] = Array.isArray(lead.tags) ? lead.tags : [];
        if (!tags.includes(tag)) await (this.prisma as any).lead.update({ where: { id: lead.id }, data: { tags: [...tags, tag] } });
        return `Tag "${tag}" on lead`;
      }
      if (!context.conversationId) throw new Error("add_tag (conversation) needs a conversation context");
      const conv = await (this.prisma as any).channelConversation.findFirst({ where: { id: context.conversationId, organizationId } });
      if (!conv) throw new Error("Conversation not found");
      const tags: string[] = Array.isArray(conv.tags) ? conv.tags : [];
      if (!tags.includes(tag)) await (this.prisma as any).channelConversation.update({ where: { id: conv.id }, data: { tags: [...tags, tag] } });
      return `Tag "${tag}" on conversation`;
    }
    if (step.type === "notify_team") {
      const where: any = { organizationId, status: "ACTIVE" };
      if (step.userId) where.userId = step.userId;
      else if (step.role) where.role = step.role;
      const members = await (this.prisma as any).membership.findMany({ where, take: 50 });
      if (!members.length) throw new Error("notify_team found no matching active members");
      const text = renderTemplate(String(step.text), context);
      let sent = 0;
      for (const m of members as any[]) {
        await (this.prisma as any).agentNotification.create({
          data: {
            organizationId, userId: m.userId, type: "workflow",
            title: String(step.title ?? "Workflow").slice(0, 120),
            body: text.slice(0, 500), conversationId: context.conversationId ?? null,
          },
        }).then(() => { sent++; }).catch(() => undefined);
      }
      if (!sent) throw new Error("notify_team could not create any notification");
      return `Team notified (${sent})`;
    }
    if (step.type === "create_follow_up") {
      if (!context.leadId) throw new Error("create_follow_up needs a lead context");
      const at = new Date(Date.now() + Number(step.days) * 24 * 3600 * 1000);
      await (this.prisma as any).lead.update({ where: { id: context.leadId }, data: { nextFollowUpAt: at } });
      await (this.prisma as any).leadActivity.create({
        data: { leadId: context.leadId, userId: null, type: "note", content: step.text ?? `Workflow follow-up set for ${at.toISOString().slice(0, 10)}` },
      }).catch(() => undefined);
      return `Follow-up set for ${at.toISOString().slice(0, 10)}`;
    }
    if (step.type === "http_webhook") {
      const url = new URL(String(step.url));
      if (url.protocol !== "https:" || isBlockedWebhookHost(url.hostname)) throw new Error("Webhook URL refused");
      const body = JSON.stringify({ runId, context, at: new Date().toISOString() });
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (step.secret) {
        const { createHmac } = await import("node:crypto");
        headers["x-workflow-signature"] = createHmac("sha256", String(step.secret)).update(body).digest("hex");
      }
      const res = await fetch(url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(10000) });
      if (res.status < 200 || res.status >= 300) throw new Error(`Webhook answered HTTP ${res.status}`);
      return `Webhook delivered (HTTP ${res.status})`;
    }
    if (step.type === "notify_channel") {
      const url = new URL(String(step.url));
      if (url.protocol !== "https:" || isBlockedWebhookHost(url.hostname)) throw new Error("Channel webhook URL refused");
      const renderedText = renderTemplate(String(step.text), context);
      const title = step.title ? renderTemplate(String(step.title), context) : "Workflow Notification";
      let payload: any = { text: renderedText };
      const h = url.hostname.toLowerCase();
      if (h.includes("discord.com")) {
        payload = { content: title ? `**${title}**\n${renderedText}` : renderedText };
      } else if (h.includes("slack.com")) {
        payload = { text: title ? `*${title}*\n${renderedText}` : renderedText };
      } else {
        payload = { title, text: renderedText, context, at: new Date().toISOString() };
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`Channel webhook answered HTTP ${res.status}`);
      return `Channel alert delivered (${step.channelName || url.hostname})`;
    }
    if (step.type === "ai_generate") {
      const renderedPrompt = renderTemplate(String(step.prompt), context);
      let generated = "";
      if (this.llmFactory) {
        try {
          const provider = this.llmFactory.getProvider();
          const resp = await provider.complete([
            { role: "system", content: "You are an AI assistant in an automated marketing workflow. Generate a concise, direct, helpful response." },
            { role: "user", content: renderedPrompt },
          ], { maxTokens: 400 });
          generated = resp?.text?.trim() ?? "";
        } catch (e) {
          this.logger.warn(`AI generate step failed with LLM, falling back: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (!generated) {
        generated = `AI Note [Generated for ${context.contactName || "User"}]: ${renderedPrompt.slice(0, 100)}`;
      }
      const outputKey = step.outputField || "aiResult";
      context[outputKey] = generated;
      const action = step.action || "add_conversation_note";
      if (action === "add_conversation_note" && context.conversationId) {
        await (this.prisma as any).conversationNote.create({
          data: {
            organizationId, conversationId: context.conversationId, authorUserId: "ai-workflow",
            content: generated,
          },
        }).catch(() => undefined);
      } else if (action === "add_lead_activity" && context.leadId) {
        await (this.prisma as any).leadActivity.create({
          data: { leadId: context.leadId, userId: null, type: "note", content: generated },
        }).catch(() => undefined);
      }
      return `AI generated output (${generated.slice(0, 40)}...)`;
    }
    throw new Error(`Unknown step type: ${step.type}`);
  }

  private async resolveRecipient(organizationId: string, context: Record<string, any>) {
    if (context.leadId) {
      const lead = await (this.prisma as any).lead.findFirst({ where: { id: context.leadId, organizationId } });
      if (lead) return { type: "lead" as const, id: lead.id, name: lead.name, email: lead.email, phone: lead.phone };
    }
    if (context.customerId) {
      const customer = await (this.prisma as any).customer.findFirst({ where: { id: context.customerId, organizationId } });
      if (customer) {
        return { type: "customer" as const, id: customer.id, name: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Customer", email: customer.email, phone: customer.phone };
      }
    }
    if (context.contactEmail || context.contactPhone || context.email || context.phone) {
      return {
        type: "customer" as const,
        id: context.customerId ?? context.leadId ?? context.visitorId ?? "unknown",
        name: context.contactName ?? context.name ?? "Customer",
        email: context.contactEmail ?? context.email ?? null,
        phone: context.contactPhone ?? context.phone ?? null,
      };
    }
    return null;
  }
}
