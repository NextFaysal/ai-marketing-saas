import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { MessagingService } from "../messaging/messaging.service";
import { InboxService } from "../inbox/inbox.service";
import { Optional } from "@nestjs/common";
import { evaluateConditions, renderTemplate } from "../messaging/render";

export const WORKFLOW_TRIGGERS = ["order_created", "lead_created", "lead_stage_changed", "inbox_message_received", "inbox_unanswered"] as const;
export const STEP_TYPES = ["send_email", "send_sms", "add_lead_activity", "add_conversation_note", "wait", "condition", "send_inbox_message"] as const;

const EVENT_TO_TRIGGER: Record<string, string> = {
  "order.created": "order_created",
  "lead.created": "lead_created",
  "lead.stage_changed": "lead_stage_changed",
  "conversation.message_received": "inbox_message_received",
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
  ) {}

  private scanTimer?: ReturnType<typeof setInterval>;

  onModuleInit() {
    for (const [event, trigger] of Object.entries(EVENT_TO_TRIGGER)) {
      this.events.on(event, (payload) => this.handleTrigger(trigger, payload));
    }
    // Time-based work every 5 minutes (same kill switch as the
    // automation scheduler): unanswered-conversation scan + resuming
    // workflow runs paused on wait steps.
    if (process.env.DISABLE_SCHEDULER !== "true") {
      this.scanTimer = setInterval(() => {
        void this.scanUnanswered().catch(() => undefined);
        void this.resumeRuns().catch(() => undefined);
      }, 5 * 60_000);
    }
  }

  /** Resume runs paused on a wait step whose time has come. */
  async resumeRuns(now = new Date()): Promise<number> {
    const due = await (this.prisma as any).workflowRun.findMany({
      where: { status: "waiting", resumeAt: { lte: now } }, take: 50,
    });
    let resumed = 0;
    for (const run of due) {
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

  // ---------- CRUD ----------
  async create(organizationId: string, actorId: string, dto: { name: string; trigger: string; conditions?: unknown; steps: any[] }) {
    if (!(WORKFLOW_TRIGGERS as readonly string[]).includes(dto.trigger)) throw new BadRequestException("Invalid trigger");
    if (!Array.isArray(dto.steps) || dto.steps.length === 0) throw new BadRequestException("A workflow needs at least one step");
    for (const step of dto.steps) {
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
      if (step.templateId) await this.messaging.getTemplate(organizationId, step.templateId);
    }
    const workflow = await (this.prisma as any).workflow.create({
      data: { organizationId, name: dto.name, trigger: dto.trigger, conditions: dto.conditions ?? undefined, steps: dto.steps, enabled: true, createdById: actorId },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "workflow.create", entityType: "Workflow", entityId: workflow.id });
    return workflow;
  }

  async list(organizationId: string) {
    return (this.prisma as any).workflow.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  }

  async update(organizationId: string, workflowId: string, dto: { enabled?: boolean; name?: string }) {
    const workflow = await (this.prisma as any).workflow.findFirst({ where: { id: workflowId, organizationId } });
    if (!workflow) throw new NotFoundException("Workflow not found");
    return (this.prisma as any).workflow.update({ where: { id: workflowId }, data: { ...dto } });
  }

  async delete(organizationId: string, workflowId: string) {
    const workflow = await (this.prisma as any).workflow.findFirst({ where: { id: workflowId, organizationId } });
    if (!workflow) throw new NotFoundException("Workflow not found");
    await (this.prisma as any).workflow.delete({ where: { id: workflowId } });
    return { deleted: true };
  }

  async listRuns(organizationId: string) {
    return (this.prisma as any).workflowRun.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  // ---------- Engine ----------
  async handleTrigger(trigger: string, payload: { organizationId: string; context: Record<string, any> }): Promise<void> {
    const { organizationId, context } = payload;
    if (!organizationId) return;
    const workflows = await (this.prisma as any).workflow.findMany({
      where: { organizationId, trigger, enabled: true },
    });
    for (const workflow of workflows) {
      await this.runWorkflow(workflow, context).catch((e) =>
        this.logger.warn(`Workflow ${workflow.id} failed: ${e instanceof Error ? e.message : e}`));
    }
  }

  async runWorkflow(workflow: any, context: Record<string, any>) {
    const organizationId: string = workflow.organizationId;
    if (!evaluateConditions(context, workflow.conditions ?? undefined)) {
      return (this.prisma as any).workflowRun.create({
        data: { organizationId, workflowId: workflow.id, trigger: workflow.trigger, context, status: "skipped", stepsLog: [], error: null },
      });
    }
    const run = await (this.prisma as any).workflowRun.create({
      data: { organizationId, workflowId: workflow.id, trigger: workflow.trigger, context, status: "completed", stepsLog: [] },
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
    const steps = (workflow.steps as any[]) ?? [];
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
        const detail = await this.executeStep(organizationId, run.id, step, context);
        stepsLog.push({ step: step.type, status: "ok", detail });
      } catch (e) {
        anyFailed = true;
        stepsLog.push({ step: step.type, status: "failed", detail: e instanceof Error ? e.message : "Step failed" });
      }
    }
    await (this.prisma as any).workflowRun.update({
      where: { id: run.id },
      data: { status: anyFailed ? "failed" : "completed", stepsLog, resumeAt: null, context },
    });
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
    if (context.email || context.phone) {
      return { type: "customer" as const, id: context.customerId ?? context.leadId ?? "unknown", name: context.name ?? "Customer", email: context.email ?? null, phone: context.phone ?? null };
    }
    return null;
  }
}
