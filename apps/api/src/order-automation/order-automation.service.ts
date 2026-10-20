import {
  BadRequestException, Injectable, Logger, Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { createAgentNotification } from "../common/agent-notify";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { OrdersService } from "../orders/orders.service";
import { FraudShieldService } from "../orders/fraud-shield.service";
import { OrderNotificationService } from "../order-notifications/order-notifications.service";
import { formatTakaMinor, renderTemplate } from "../order-notifications/order-notifications";
import { parseBdAddress } from "../orders/bd-address";
import { TRANSIT_STATUSES } from "../orders/order-queues";
import {
  AUTOMATION_PRESETS, evaluateConditions, normalizeRuleInput, validateRuleInput,
  type ConditionFacts,
} from "./order-automation";
import { badRequest, conflict, notFound } from "../i18n/api-exception";

/**
 * ON8 — Orders Automation Studio engine (DEDICATED — see the
 * engine verdict in order-automation.ts: WorkflowsService's
 * step vocabulary is lead/conversation-scoped with no
 * order-hold / order-assign / order-tag steps and no
 * parcel-stuck / due-overdue time triggers, so this engine
 * owns ORDER-operation rules and nothing else).
 *
 * Failure discipline: a rule failure NEVER blocks an order
 * operation. Event handlers and the sweep catch everything,
 * log it, and move on; each ACTION inside a firing is
 * isolated the same way (one bad action never stops the
 * later actions, and its failure is recorded per-action).
 *
 * Exactly-once semantics (the OrderAutomationLog @@unique on
 * [ruleId, orderId, triggerKey] is the guard — the engine
 * RESERVES the log row BEFORE running any action, so a
 * duplicate delivery can never re-run actions):
 *  - order_created:      triggerKey "created" — once per
 *                        (rule, order), ever.
 *  - status_changed:     triggerKey `status:${to}:${bucket}`
 *                        where bucket is the transition's
 *                        occurredAt when the emitter supplies
 *                        one, else the createdAt of the
 *                        matching orders.status_changed
 *                        AuditLog row (the transition stamp
 *                        OrdersService.updateOrder writes),
 *                        else the order's updatedAt. So
 *                        re-entering the same status at a
 *                        different time CAN fire again, while
 *                        a duplicate delivery of the SAME
 *                        transition cannot.
 *  - parcel_stuck_hours: triggerKey `stuck:${shipmentId}:${status}`
 *                        — once per shipment per stuck status;
 *                        a later status change re-arms it.
 *                        Age basis: CourierShipment.updatedAt
 *                        (the last status-sync stamp).
 *  - due_overdue_days:   triggerKey `due:${days}` — once per
 *                        (rule, order) per configured days
 *                        value; a rule edited to a different
 *                        days value may therefore fire again.
 *                        Age basis: Order.updatedAt (the
 *                        order's last-update stamp — for a
 *                        delivered/completed order this is
 *                        the closest stored witness of when
 *                        it entered that bucket; honest limit,
 *                        there is no dedicated deliveredAt
 *                        column on Order).
 *
 * Subscriptions: order_created fires off BOTH
 * "order.ingested" (emitted unconditionally on creation by
 * IntegrationsService.upsertOrder + InboxService chat orders)
 * and "order.created" (the workflow event, 24h-guarded) —
 * both map to the same triggerKey "created", so the unique
 * guard collapses any double delivery into one firing.
 */
@Injectable()
export class OrderAutomationService {
  private readonly logger = new Logger(OrderAutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly events?: EventsService,
    @Optional() private readonly orders?: OrdersService,
    @Optional() private readonly fraud?: FraudShieldService,
    @Optional() private readonly notifications?: OrderNotificationService,
  ) {
    // FraudShieldService pattern: subscribe in the constructor;
    // handlers delegate to public methods (spec-callable) and
    // never throw.
    try {
      this.events?.on("order.ingested", (p: any) => { void this.handleOrderCreated(p).catch(() => undefined); });
      this.events?.on("order.created", (p: any) => { void this.handleOrderCreated(p).catch(() => undefined); });
      this.events?.on("order.status_changed", (p: any) => { void this.handleStatusChanged(p).catch(() => undefined); });
    } catch { /* events are best-effort */ }
  }

  private t(name: string): any { return (this.prisma as any)[name]; }

  private isUniqueViolation(e: any): boolean {
    return e?.code === "P2002" || /unique/i.test(String(e?.message ?? ""));
  }

  // ---------- rule CRUD ----------

  private rulePublic(row: any, extra?: { runCount?: number; lastRunAt?: any }) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      enabled: row.enabled === true,
      trigger: row.trigger,
      triggerConfig: row.triggerConfig ?? null,
      conditions: row.conditions ?? null,
      actions: row.actions ?? [],
      presetKey: row.presetKey ?? null,
      createdById: row.createdById ?? null,
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
      runCount: extra?.runCount ?? 0,
      lastRunAt: extra?.lastRunAt ?? null,
    };
  }

  private async loadRule(orgId: string, ruleId: string): Promise<any | null> {
    const table = this.t("orderAutomationRule");
    if (!table?.findFirst) return null;
    return table.findFirst({ where: { id: ruleId, organizationId: orgId } }).catch(() => null);
  }

  private async runStats(orgId: string, ruleIds: string[]): Promise<Map<string, { count: number; last: any }>> {
    const out = new Map<string, { count: number; last: any }>();
    if (ruleIds.length === 0) return out;
    try {
      const rows = await this.t("orderAutomationLog").findMany({
        where: { organizationId: orgId, ruleId: { in: ruleIds } },
      }).catch(() => []);
      for (const r of rows ?? []) {
        const cur = out.get(String(r.ruleId)) ?? { count: 0, last: null };
        cur.count += 1;
        if (!cur.last || new Date(r.createdAt ?? 0).getTime() > new Date(cur.last).getTime()) cur.last = r.createdAt ?? null;
        out.set(String(r.ruleId), cur);
      }
    } catch { /* counts are decoration; rules ship without them */ }
    return out;
  }

  async createRule(orgId: string, actorId: string, dto: any) {
    const error = validateRuleInput(dto);
    if (error) throw new BadRequestException(error);
    const data = normalizeRuleInput(dto);
    const row = await this.t("orderAutomationRule").create({
      data: { organizationId: orgId, ...data, presetKey: null, createdById: actorId },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "orders.automation_rule_created",
      entityType: "OrderAutomationRule", entityId: row.id,
      metadata: { trigger: data.trigger, enabled: data.enabled },
    }).catch(() => undefined);
    return this.rulePublic(row);
  }

  async listRules(orgId: string) {
    const table = this.t("orderAutomationRule");
    const rows = table?.findMany
      ? ((await table.findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [])
      : [];
    const sorted = [...rows].sort((a: any, b: any) =>
      new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    const stats = await this.runStats(orgId, sorted.map((r: any) => String(r.id)));
    return sorted.map((r: any) => {
      const s = stats.get(String(r.id));
      return this.rulePublic(r, { runCount: s?.count ?? 0, lastRunAt: s?.last ?? null });
    });
  }

  async getRule(orgId: string, ruleId: string) {
    const row = await this.loadRule(orgId, ruleId);
    if (!row) throw notFound("orderAutomation.theAutomationRuleWasNotFound");
    const stats = await this.runStats(orgId, [String(row.id)]);
    const s = stats.get(String(row.id));
    return this.rulePublic(row, { runCount: s?.count ?? 0, lastRunAt: s?.last ?? null });
  }

  async updateRule(orgId: string, actorId: string, ruleId: string, dto: any) {
    const row = await this.loadRule(orgId, ruleId);
    if (!row) throw notFound("orderAutomation.theAutomationRuleWasNotFound");
    // Partial PATCH (incl. the enabled toggle alone): merge
    // over the stored rule, then validate the MERGED shape so
    // a partial edit can never leave an invalid rule behind.
    const merged = {
      name: dto?.name !== undefined ? dto.name : row.name,
      trigger: dto?.trigger !== undefined ? dto.trigger : row.trigger,
      triggerConfig: dto?.triggerConfig !== undefined ? dto.triggerConfig : (row.triggerConfig ?? null),
      conditions: dto?.conditions !== undefined ? dto.conditions : (row.conditions ?? null),
      actions: dto?.actions !== undefined ? dto.actions : row.actions,
      enabled: dto?.enabled !== undefined ? dto.enabled : row.enabled === true,
    };
    const error = validateRuleInput(merged);
    if (error) throw new BadRequestException(error);
    const data = normalizeRuleInput(merged);
    const updated = await this.t("orderAutomationRule").update({ where: { id: row.id }, data });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "orders.automation_rule_updated",
      entityType: "OrderAutomationRule", entityId: ruleId,
      metadata: { trigger: data.trigger, enabled: data.enabled },
    }).catch(() => undefined);
    return this.rulePublic(updated ?? { ...row, ...data });
  }

  async deleteRule(orgId: string, actorId: string, ruleId: string) {
    const row = await this.loadRule(orgId, ruleId);
    if (!row) throw notFound("orderAutomation.theAutomationRuleWasNotFound");
    await this.t("orderAutomationRule").delete({ where: { id: row.id } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "orders.automation_rule_deleted",
      entityType: "OrderAutomationRule", entityId: ruleId, metadata: { name: row.name },
    }).catch(() => undefined);
    return { deleted: true, id: ruleId };
  }

  // ---------- presets ----------

  async listPresets(orgId: string) {
    const installed = new Set<string>();
    try {
      const rows = await this.t("orderAutomationRule").findMany({ where: { organizationId: orgId } }).catch(() => []);
      for (const r of rows ?? []) if (r.presetKey) installed.add(String(r.presetKey));
    } catch { /* installed flags degrade to false */ }
    return AUTOMATION_PRESETS.map((p) => ({ ...p, installed: installed.has(p.key) }));
  }

  async installPreset(orgId: string, actorId: string, key: string) {
    const preset = AUTOMATION_PRESETS.find((p) => p.key === key);
    if (!preset) throw notFound("orderAutomation.thePresetWasNotFound");
    // presetKey uniqueness per org is enforced HERE with a
    // lookup (Prisma cannot express a partial unique index);
    // a second install of the same preset is a 409 refusal.
    const existing = await this.t("orderAutomationRule").findFirst({
      where: { organizationId: orgId, presetKey: key },
    }).catch(() => null);
    if (existing) {
      throw conflict("orderAutomation.thePresetIsAlreadyInstalled", { presetName: preset.name });
    }
    const row = await this.t("orderAutomationRule").create({
      data: {
        organizationId: orgId, name: preset.name, enabled: false,
        trigger: preset.trigger, triggerConfig: preset.triggerConfig,
        conditions: preset.conditions, actions: preset.actions,
        presetKey: preset.key, createdById: actorId,
      },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "orders.automation_preset_installed",
      entityType: "OrderAutomationRule", entityId: row.id, metadata: { presetKey: key },
    }).catch(() => undefined);
    return this.rulePublic(row);
  }

  // ---------- logs ----------

  async listRuleLogs(orgId: string, ruleId: string, q?: { page?: number; pageSize?: number }) {
    const rule = await this.loadRule(orgId, ruleId);
    if (!rule) throw notFound("orderAutomation.theAutomationRuleWasNotFound");
    const page = Math.max(1, q?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q?.pageSize ?? 20));
    const rows = ((await this.t("orderAutomationLog").findMany({
      where: { organizationId: orgId, ruleId },
    }).catch(() => [])) ?? [])
      .filter((r: any) => String(r.ruleId) === String(ruleId))
      .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    return {
      total: rows.length, page, pageSize,
      items: rows.slice((page - 1) * pageSize, page * pageSize),
    };
  }

  /** Per-order automation logs (consumed by the ON2 timeline
   * extension through the same table; exposed here for the
   * web log viewer / debugging). Foreign order → 404. */
  async listOrderLogs(orgId: string, orderId: string) {
    const order = await this.t("order").findFirst({ where: { id: orderId, organizationId: orgId } }).catch(() => null);
    if (!order) throw notFound("orderAutomation.orderNotFoundInThisOrganization");
    const rows = ((await this.t("orderAutomationLog").findMany({
      where: { organizationId: orgId, orderId },
    }).catch(() => [])) ?? [])
      .filter((r: any) => String(r.orderId) === String(orderId))
      .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    return rows.slice(0, 50);
  }

  // ---------- evaluation: facts ----------

  private async loadOrder(orgId: string, orderId: string): Promise<any | null> {
    try {
      const order = await this.t("order").findFirst({
        where: { id: orderId, organizationId: orgId }, include: { customer: true },
      });
      if (!order) return null;
      if (!order.customer && order.customerId) {
        order.customer = await this.t("customer").findFirst({
          where: { id: order.customerId, organizationId: orgId },
        }).catch(() => null);
      }
      return order;
    } catch { return null; }
  }

  private resolveDistrict(order: any): string | null {
    const customer = order?.customer ?? null;
    const addr = customer?.address;
    if (addr && typeof addr === "object" && addr.district) return String(addr.district);
    // No structured district: parse the free-text address
    // (order.address first, then the customer's address_1).
    // Low confidence = NO match (never guessed onto a rule).
    const text = String(order?.address ?? "").trim()
      || (addr && typeof addr === "object" ? String(addr.address_1 ?? addr.address1 ?? "") : "")
      || (typeof addr === "string" ? addr : "");
    if (!text) return null;
    const parsed = parseBdAddress(text);
    if (!parsed.district || parsed.confidence === "low") return null;
    return parsed.district;
  }

  private async buildFacts(orgId: string, order: any): Promise<ConditionFacts> {
    let priorCount = 0;
    if (order.customerId) {
      try {
        const rows = await this.t("order").findMany({
          where: { organizationId: orgId, customerId: order.customerId },
        }).catch(() => []);
        priorCount = (rows ?? []).filter((o: any) =>
          String(o.id) !== String(order.id) && o.isPractice !== true).length;
      } catch { priorCount = 0; }
    }
    let total = 0n;
    try { total = BigInt(order.totalMinor ?? 0); } catch { total = 0n; }
    return {
      totalMinor: total,
      source: String(order.source ?? ""),
      isCod: order.isCod === true,
      // Spec definition: new ⇔ ≤1 prior non-practice order.
      customerIsNew: priorCount <= 1,
      district: this.resolveDistrict(order),
      riskBand: order.riskBand ?? null,
    };
  }

  private messageVars(order: any): Record<string, string> {
    const customer = order?.customer ?? null;
    const customerName = [customer?.firstName, customer?.lastName].filter(Boolean).join(" ").trim();
    let total = 0n;
    try { total = BigInt(order.totalMinor ?? 0); } catch { total = 0n; }
    return {
      orderNumber: String(order.externalNumber ?? order.id),
      total: formatTakaMinor(total),
      customerName,
    };
  }

  // ---------- evaluation: actions ----------

  private async runAction(orgId: string, rule: any, order: any, action: any): Promise<{ type: string; ok: boolean; detail?: string }> {
    const type = String(action?.type ?? "");
    const actorId = rule.createdById ?? "automation";
    try {
      if (type === "add_tag") {
        const tag = String(action.tag).trim();
        const current: string[] = Array.isArray(order.tags) ? order.tags.map(String) : [];
        if (current.includes(tag)) return { type, ok: true, detail: "already_tagged" };
        const next = [...current, tag];
        // OrdersService.setTags semantics (replace with the
        // merged list, its validation + audit ride along);
        // direct update is the fallback when the orders
        // service is not wired (partial deployment / specs).
        if (this.orders?.setTags) await this.orders.setTags(orgId, actorId, order.id, next);
        else await this.t("order").update({ where: { id: order.id }, data: { tags: next } });
        order.tags = next;
        return { type, ok: true };
      }
      if (type === "assign") {
        const userId = String(action.userId);
        // OrdersService.assignOrder validates ACTIVE org
        // membership (ON1 path); fallback mirrors that check.
        if (this.orders?.assignOrder) await this.orders.assignOrder(orgId, actorId, order.id, userId);
        else {
          if (this.orders?.assertActiveMember) await this.orders.assertActiveMember(orgId, userId);
          else {
            const member = await this.t("membership").findFirst({
              where: { userId, organizationId: orgId, status: "ACTIVE" },
            }).catch(() => null);
            if (!member) throw badRequest("orderAutomation.theAssigneeIsNotAnActive");
          }
          await this.t("order").update({ where: { id: order.id }, data: { assigneeId: userId } });
        }
        order.assigneeId = userId;
        return { type, ok: true };
      }
      if (type === "hold") {
        const reason = String(action.reason).trim();
        // The ON4 hold path (FraudShieldService.hold — sets
        // reviewHold/reason/heldAt + audits); NEVER forked.
        if (this.fraud?.hold) await this.fraud.hold(orgId, actorId, order.id, reason);
        else {
          await this.t("order").update({
            where: { id: order.id },
            data: { reviewHold: true, reviewHoldReason: reason, reviewHeldAt: new Date() },
          });
        }
        order.reviewHold = true;
        return { type, ok: true };
      }
      if (type === "notify_staff") {
        const rendered = renderTemplate(String(action.message ?? ""), this.messageVars(order));
        const memberships = ((await this.t("membership").findMany({
          where: { organizationId: orgId, status: "ACTIVE" },
        }).catch(() => [])) ?? [])
          .filter((m: any) => m.status === "ACTIVE" && ["OWNER", "ADMIN"].includes(String(m.role)));
        const userIds = [...new Set(memberships.map((m: any) => String(m.userId)))];
        let written = 0;
        for (const userId of userIds) {
          const made = await createAgentNotification(this.prisma as any, {
              organizationId: orgId, userId, type: "urgent",
              title: String(rule.name), body: rendered, conversationId: null,
            }).catch(() => null);
          if (made) written += 1;
        }
        return { type, ok: written > 0, detail: `recipients:${written}` };
      }
      if (type === "notify_customer") {
        if (!this.notifications?.notify) return { type, ok: false, detail: "notifications_unavailable" };
        const rendered = renderTemplate(String(action.message ?? ""), this.messageVars(order));
        // ON5 machinery with event "automation_rule": the
        // ON5 settings do NOT gate it (the rule is the
        // opt-in); channel resolution is ON5's own.
        const res: any = await this.notifications.notify(orgId, order.id, "automation_rule", { customMessage: rendered });
        return { type, ok: res?.sent === true, detail: res?.sent ? `channel:${res.channel ?? ""}` : `skipped:${res?.skipped ?? (res?.statuses ?? []).join(",")}` };
      }
      return { type, ok: false, detail: "unknown_action" };
    } catch (e) {
      // Failure isolation: one bad action never stops the rest.
      return { type, ok: false, detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
    }
  }

  // ---------- evaluation: core ----------

  /**
   * Fire ONE rule against ONE order under ONE triggerKey.
   * Returns a result object; NEVER throws.
   */
  async fireRule(orgId: string, rule: any, orderId: string, triggerKey: string): Promise<any> {
    try {
      if (!rule || rule.enabled !== true) return { skipped: "rule_disabled" };
      const order = await this.loadOrder(orgId, orderId);
      if (!order) return { skipped: "order_not_found" };
      if (order.isPractice) return { skipped: "practice" };
      const facts = await this.buildFacts(orgId, order);
      if (!evaluateConditions(rule.conditions ?? null, facts)) return { skipped: "conditions" };

      // Reserve-first exactly-once: create the log row BEFORE
      // any action runs. A duplicate delivery hits the unique
      // guard here and skips silently — actions never re-run.
      let logRow: any = null;
      try {
        logRow = await this.t("orderAutomationLog").create({
          data: { organizationId: orgId, ruleId: rule.id, orderId, triggerKey, actionsResult: [] },
        });
      } catch (e) {
        if (this.isUniqueViolation(e)) return { skipped: "already_fired" };
        throw e;
      }

      const results: { type: string; ok: boolean; detail?: string }[] = [];
      for (const action of (Array.isArray(rule.actions) ? rule.actions : [])) {
        results.push(await this.runAction(orgId, rule, order, action));
      }
      try {
        await this.t("orderAutomationLog").update({
          where: { id: logRow.id }, data: { actionsResult: results },
        });
      } catch { /* the reservation row stands; results are also returned */ }
      return { fired: true, logId: logRow.id, results };
    } catch (e) {
      this.logger.warn(`order automation rule failed (${rule?.id}/${orderId}): ${e instanceof Error ? e.message : "unknown"}`);
      return { skipped: "internal_error" };
    }
  }

  private async enabledRules(orgId: string, trigger: string): Promise<any[]> {
    try {
      const rows = await this.t("orderAutomationRule").findMany({
        where: { organizationId: orgId, enabled: true, trigger },
      }).catch(() => []);
      return (rows ?? []).filter((r: any) => r.enabled === true && r.trigger === trigger);
    } catch { return []; }
  }

  // ---------- event handlers (public for specs) ----------

  async handleOrderCreated(payload: any): Promise<any> {
    try {
      const orgId = payload?.organizationId;
      const orderId = payload?.context?.orderId;
      if (!orgId || !orderId) return { skipped: "bad_payload" };
      const rules = await this.enabledRules(orgId, "order_created");
      const out: any[] = [];
      for (const rule of rules) out.push(await this.fireRule(orgId, rule, orderId, "created"));
      return out;
    } catch (e) {
      this.logger.warn(`order automation order_created failed: ${e instanceof Error ? e.message : "unknown"}`);
      return { skipped: "internal_error" };
    }
  }

  async handleStatusChanged(payload: any): Promise<any> {
    try {
      const orgId = payload?.organizationId;
      const orderId = payload?.context?.orderId;
      const to = payload?.context?.to ? String(payload.context.to) : "";
      if (!orgId || !orderId || !to) return { skipped: "bad_payload" };
      const rules = (await this.enabledRules(orgId, "status_changed"))
        .filter((r: any) => String(r.triggerConfig?.toStatus ?? "") === to);
      if (rules.length === 0) return [];
      // Transition bucket (see the header): the emitter's
      // occurredAt when present, else the matching audit
      // row's createdAt, else the order's updatedAt.
      let bucket = payload?.context?.occurredAt ? String(payload.context.occurredAt) : "";
      if (!bucket) {
        try {
          const audits = await this.t("auditLog").findMany({
            where: { organizationId: orgId, entityType: "Order", entityId: orderId },
          }).catch(() => []);
          const matching = (audits ?? [])
            .filter((a: any) => a.action === "orders.status_changed" && String(a.metadata?.to ?? "") === to)
            .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
          if (matching[0]?.createdAt) bucket = new Date(matching[0].createdAt).toISOString();
        } catch { /* fall through to updatedAt */ }
      }
      if (!bucket) {
        const order = await this.loadOrder(orgId, orderId);
        bucket = order?.updatedAt ? new Date(order.updatedAt).toISOString() : "unknown";
      }
      const triggerKey = `status:${to}:${bucket}`;
      const out: any[] = [];
      for (const rule of rules) out.push(await this.fireRule(orgId, rule, orderId, triggerKey));
      return out;
    } catch (e) {
      this.logger.warn(`order automation status_changed failed: ${e instanceof Error ? e.message : "unknown"}`);
      return { skipped: "internal_error" };
    }
  }

  // ---------- sweep (order_automation_sweep job) ----------

  /**
   * Time-trigger sweep body for the per-org
   * order_automation_sweep job. The AutomationService
   * dispatch only calls this for orgs with the job enabled —
   * the same enablement contract as every other sweep — and
   * orgs without enabled time-trigger rules no-op here.
   */
  async runAutomationSweep(orgId: string, now: Date = new Date()): Promise<any> {
    try {
      const stuckRules = await this.enabledRules(orgId, "parcel_stuck_hours");
      const dueRules = await this.enabledRules(orgId, "due_overdue_days");
      if (stuckRules.length === 0 && dueRules.length === 0) {
        return { skipped: "no_time_rules", fired: 0 };
      }
      let fired = 0;

      // --- parcel stuck: shipment in an in-transit status
      // whose updatedAt (last status-sync stamp) is older
      // than the rule's hours. ---
      if (stuckRules.length > 0) {
        const shipments = ((await this.t("courierShipment").findMany({
          where: { organizationId: orgId },
        }).catch(() => [])) ?? [])
          .filter((s: any) => (TRANSIT_STATUSES as readonly string[]).includes(String(s.status)) && s.updatedAt);
        for (const rule of stuckRules) {
          const hours = Number(rule.triggerConfig?.hours ?? 0);
          if (!(hours > 0)) continue;
          const cutoff = now.getTime() - hours * 3600_000;
          for (const s of shipments) {
            if (new Date(s.updatedAt).getTime() >= cutoff) continue;
            const res = await this.fireRule(orgId, rule, String(s.orderId), `stuck:${s.id}:${s.status}`);
            if (res?.fired) fired += 1;
          }
        }
      }

      // --- due overdue: delivered/completed orders with
      // amountDue > 0 (EC19 due math: total − APPROVED
      // PaymentVerification sums) whose updatedAt is older
      // than the rule's days. ---
      if (dueRules.length > 0) {
        const orders = ((await this.t("order").findMany({
          where: { organizationId: orgId },
        }).catch(() => [])) ?? [])
          .filter((o: any) => ["delivered", "completed"].includes(String(o.status)) && o.isPractice !== true);
        for (const rule of dueRules) {
          const days = Number(rule.triggerConfig?.days ?? 0);
          if (!(days > 0)) continue;
          const cutoff = now.getTime() - days * 86400_000;
          for (const o of orders) {
            const stamp = o.updatedAt ?? o.createdAt;
            if (!stamp || new Date(stamp).getTime() >= cutoff) continue;
            let paid = 0n;
            try {
              const rows = await this.t("paymentVerification").findMany({
                where: { organizationId: orgId, orderId: o.id, status: "approved" },
              }).catch(() => []);
              for (const r of rows ?? []) {
                if (String(r.orderId) !== String(o.id) || r.status !== "approved") continue;
                try { paid += BigInt(r.amountMinor ?? 0); } catch { /* 0 */ }
              }
            } catch { paid = 0n; }
            let total = 0n;
            try { total = BigInt(o.totalMinor ?? 0); } catch { total = 0n; }
            if (total - paid <= 0n) continue;
            const res = await this.fireRule(orgId, rule, String(o.id), `due:${days}`);
            if (res?.fired) fired += 1;
          }
        }
      }
      return { fired, stuckRules: stuckRules.length, dueRules: dueRules.length };
    } catch (e) {
      this.logger.warn(`order automation sweep failed (${orgId}): ${e instanceof Error ? e.message : "unknown"}`);
      return { skipped: "internal_error", fired: 0 };
    }
  }
}
