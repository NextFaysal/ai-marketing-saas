import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ShopAccountService } from "../storefront/shop-account.service";
import { EmailProvider } from "../messaging/email.provider";
import { InboxService } from "../inbox/inbox.service";
import { EventsService } from "../common/events.service";
import { newTrackingToken, trackingLinkFor } from "../courier/tracking-token";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  NotificationEvent,
  formatTakaMinor,
  mergeConfig,
  renderTemplate,
  templateFor,
  validateConfig,
} from "./order-notifications";

/**
 * ON5 — Transactional Notification Engine (the single entry is
 * `notify`). Failure discipline: notify NEVER throws — a
 * notification failure must never break order creation, courier
 * booking/sync, or fulfillment updates. Every decision is
 * recorded on OrderNotificationLog (except practice orders and
 * missing orders, which write nothing).
 *
 * Dedupe: at most ONE "sent" row ever exists per
 * (org, order, event) — a later notify for the same event
 * returns { skipped: "already_sent" } and writes nothing. This
 * is also what makes the legacy courier path and this engine
 * coexist: courier hooks pass coveredExisting when the legacy
 * notifyCustomer already reached the customer for a status.
 *
 * Store-synced exclusion set (order.ingested): EXACTLY
 * { "woocommerce", "shopify" } — those orders already get the
 * store's own transactional emails, and a first sync can backfill
 * old orders. Every other enumerated source notifies:
 * "manual" (OrdersService.createManual AND the single-product
 * checkout in ProductsService — both pass "manual"),
 * "native_storefront" (StorefrontService), "landing",
 * "pos", "csv" (ImportsService), "chat" (InboxService.
 * createChatOrder, emitted directly), and "subscription"
 * (SubscriptionsService renewals — its own source string;
 * CHOICE: renewals DO notify order_placed, since a renewal is a
 * genuinely new order the customer should hear about; the old
 * "no notification in v1" note in that service predates ON5).
 *
 * Email subject: EmailProvider requires a subject and the ON5
 * config shape carries only a body template per channel, so the
 * subject is the fixed `অর্ডার {orderNumber} — {shopName}` line
 * and the rendered template is the body (documented choice).
 *
 * Channel loop: channels are tried in the event's configured
 * order; the loop STOPS after the first "sent" — channels after
 * a success get NO log rows.
 */

export const STORE_SYNCED_SOURCES = new Set(["woocommerce", "shopify"]);

@Injectable()
export class OrderNotificationService {
  private readonly logger = new Logger(OrderNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly shopAccount?: ShopAccountService,
    @Optional() private readonly emailProvider?: EmailProvider,
    @Optional() private readonly inbox?: InboxService,
    @Optional() private readonly events?: EventsService,
  ) {
    // FraudShieldService pattern: subscribe in the constructor;
    // handlers delegate to public methods (spec-callable) and
    // never throw (notify never throws anyway).
    try {
      this.events?.on("order.ingested", (p: any) => { void this.handleIngested(p).catch(() => undefined); });
      this.events?.on("order.delivered", (p: any) => { void this.handleDelivered(p).catch(() => undefined); });
      this.events?.on("order.status_changed", (p: any) => { void this.handleStatusChanged(p).catch(() => undefined); });
    } catch { /* events are best-effort */ }
  }

  private t(name: string): any { return (this.prisma as any)[name]; }

  // ---------- event handlers (public for specs) ----------

  async handleIngested(payload: any): Promise<any> {
    const orgId = payload?.organizationId;
    const orderId = payload?.context?.orderId;
    const source = payload?.context?.source ? String(payload.context.source) : "";
    if (!orgId || !orderId) return { skipped: "bad_payload" };
    if (STORE_SYNCED_SOURCES.has(source)) return { skipped: "store_synced_source", source };
    return this.notify(orgId, orderId, "order_placed");
  }

  async handleDelivered(payload: any): Promise<any> {
    const orgId = payload?.organizationId;
    const orderId = payload?.context?.orderId;
    if (!orgId || !orderId) return { skipped: "bad_payload" };
    return this.notify(orgId, orderId, "delivered", { via: "order_completed" });
  }

  async handleStatusChanged(payload: any): Promise<any> {
    const orgId = payload?.organizationId;
    const orderId = payload?.context?.orderId;
    const to = payload?.context?.to ? String(payload.context.to) : "";
    if (!orgId || !orderId) return { skipped: "bad_payload" };
    // Only "delivered" maps here. "completed" is intentionally
    // NOT mapped: OrdersService.updateOrder already emits
    // order.delivered for completed, so mapping it would
    // double-fire (the sent-dedupe would catch it, but we do
    // not rely on that silently).
    if (to === "delivered") return this.notify(orgId, orderId, "delivered", { via: "status" });
    return { skipped: "unmapped_status", to };
  }

  // ---------- settings ----------

  async getSettings(orgId: string) {
    let row: any = null;
    try {
      const table = this.t("orderNotificationSetting");
      if (table?.findUnique) row = await table.findUnique({ where: { organizationId: orgId } }).catch(() => null);
      if (!row && table?.findFirst) row = await table.findFirst({ where: { organizationId: orgId } }).catch(() => null);
    } catch { row = null; }
    // Lazy: no row ⇒ defaults, nothing is written on read.
    return mergeConfig(row?.config ?? null);
  }

  async updateSettings(orgId: string, actorId: string, config: any) {
    const error = validateConfig(config);
    if (error) throw new BadRequestException(error);
    const merged = mergeConfig(config ?? null);
    const before = await this.getSettings(orgId);
    const changedEventKeys = NOTIFICATION_EVENTS.filter(
      (e) => JSON.stringify(before[e]) !== JSON.stringify(merged[e]),
    );
    const table = this.t("orderNotificationSetting");
    let row: any = null;
    if (table?.upsert) {
      row = await table.upsert({
        where: { organizationId: orgId },
        create: { organizationId: orgId, config: merged },
        update: { config: merged },
      });
    } else if (table?.findFirst && table?.create && table?.update) {
      const existing = await table.findFirst({ where: { organizationId: orgId } }).catch(() => null);
      row = existing
        ? await table.update({ where: { id: existing.id }, data: { config: merged } })
        : await table.create({ data: { organizationId: orgId, config: merged } });
    }
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "orders.notification_settings_updated",
      entityType: "OrderNotificationSetting", entityId: row?.id ?? orgId,
      metadata: { changedEventKeys },
    }).catch(() => undefined);
    return merged;
  }

  // ---------- logs ----------

  async listLogs(orgId: string, orderId: string) {
    const order = await this.t("order").findFirst({ where: { id: orderId, organizationId: orgId } }).catch(() => null);
    if (!order) throw new NotFoundException("Order not found in this organization");
    const rows = await this.t("orderNotificationLog").findMany({
      where: { organizationId: orgId, orderId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }).catch(() => []);
    return rows ?? [];
  }

  private async writeLog(orgId: string, orderId: string, event: string, channel: string, status: string, extra?: { providerMessageId?: string | null; error?: string | null }): Promise<void> {
    try {
      await this.t("orderNotificationLog").create({
        data: {
          organizationId: orgId, orderId, event, channel, status,
          providerMessageId: extra?.providerMessageId ?? null,
          error: extra?.error ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`order notification log write failed (${event}/${channel}/${status}): ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  // ---------- variable building ----------

  private async resolveShipment(orgId: string, orderId: string, shipmentId?: string): Promise<any | null> {
    try {
      const table = this.t("courierShipment");
      if (!table) return null;
      if (shipmentId) {
        const row = await table.findFirst({ where: { id: shipmentId, organizationId: orgId, orderId } }).catch(() => null);
        if (row) return row;
      }
      const rows = await table.findMany({
        where: { organizationId: orgId, orderId }, orderBy: { createdAt: "desc" }, take: 1,
      }).catch(() => []);
      return rows?.[0] ?? null;
    } catch { return null; }
  }

  /** CX6 public link: mint exactly like
   * CourierService.ensureTrackingToken (newTrackingToken +
   * trackingLinkFor, one retry on the write); on failure fall
   * back to the EC22 Integration.trackingUrlTemplate for the
   * shipment's provider (both {trackingCode} and the EC22
   * {trackingId} placeholders are substituted); else "". */
  private async resolveTrackingUrl(orgId: string, shipment: any): Promise<string> {
    if (!shipment) return "";
    try {
      if (shipment.trackingToken) return trackingLinkFor(String(shipment.trackingToken));
      if (shipment.id) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const token = newTrackingToken();
          try {
            await this.t("courierShipment").update({ where: { id: shipment.id }, data: { trackingToken: token } });
            shipment.trackingToken = token;
            return trackingLinkFor(token);
          } catch { if (attempt === 1) break; }
        }
      }
    } catch { /* fall through to the template */ }
    try {
      if (!shipment.trackingCode) return "";
      const integration = await this.t("integration").findFirst({
        where: { organizationId: orgId, provider: shipment.provider },
      }).catch(() => null);
      const template = integration?.trackingUrlTemplate;
      if (!template) return "";
      const code = encodeURIComponent(String(shipment.trackingCode));
      return String(template).split("{trackingCode}").join(code).split("{trackingId}").join(code);
    } catch { return ""; }
  }

  private async buildVars(orgId: string, order: any, customer: any, shipment: any): Promise<Record<string, string>> {
    // shopName: StorefrontSetting.shopName || Organization.name
    // (the ShopAccountService resolution, replicated minimally).
    let shopName = "";
    try {
      const setting = await this.t("storefrontSetting").findFirst({ where: { organizationId: orgId } }).catch(() => null);
      if (setting?.shopName) shopName = String(setting.shopName);
    } catch { /* org name below */ }
    if (!shopName) {
      try {
        const org = await this.t("organization").findFirst({ where: { id: orgId } }).catch(() => null);
        shopName = org?.name ? String(org.name) : "";
      } catch { shopName = ""; }
    }
    // due = total − APPROVED PaymentVerification sum, floor 0
    // (per-order findMany here — one order, no groupBy needed).
    let paid = 0n;
    try {
      const rows = await this.t("paymentVerification").findMany({
        where: { organizationId: orgId, orderId: order.id, status: "approved" },
      }).catch(() => []);
      for (const r of rows ?? []) {
        try { paid += BigInt(r.amountMinor ?? 0); } catch { /* unparseable counts 0 */ }
      }
    } catch { paid = 0n; }
    let total = 0n;
    try { total = BigInt(order.totalMinor ?? 0); } catch { total = 0n; }
    const due = total - paid > 0n ? total - paid : 0n;
    const customerName =
      [customer?.firstName, customer?.lastName].filter(Boolean).join(" ").trim()
      || (shipment?.recipientName ? String(shipment.recipientName) : "");
    const trackingUrl = await this.resolveTrackingUrl(orgId, shipment);
    return {
      customerName,
      orderNumber: String(order.externalNumber ?? order.id),
      total: formatTakaMinor(total),
      due: formatTakaMinor(due),
      trackingUrl,
      shopName,
      courierName: shipment?.provider ? String(shipment.provider) : "",
      trackingCode: shipment?.trackingCode ? String(shipment.trackingCode) : "",
    };
  }

  // ---------- THE single entry ----------

  async notify(orgId: string, orderId: string, event: string, data?: { shipmentId?: string; coveredExisting?: boolean; via?: string; rescheduleDate?: string; customMessage?: string }): Promise<any> {
    try {
      // ON8: the log's event vocabulary gains ONE extra value,
      // "automation_rule" — it is NOT a NOTIFICATION_EVENTS
      // settings event: the ON5 per-event settings must NOT
      // gate rule sends (the merchant's enabled rule IS the
      // opt-in), there is no per-(order,event) sent-dedupe
      // (a rule may legitimately fire again on a later
      // transition / stuck status / due bucket), and the
      // message text comes from the rule action itself
      // (data.customMessage, already rendered by the caller),
      // sent over the ON5 channel machinery in the default
      // channel order sms → whatsapp → email.
      const isAutomationRule = event === "automation_rule";
      if (!orgId || !orderId || (!isAutomationRule && !(NOTIFICATION_EVENTS as readonly string[]).includes(event))) {
        return { event, sent: false, skipped: "bad_input", statuses: [] };
      }
      const ev = event as NotificationEvent;
      // a. load order (+ customer)
      let order: any = null;
      try {
        order = await this.t("order").findFirst({
          where: { id: orderId, organizationId: orgId }, include: { customer: true },
        });
      } catch { order = null; }
      if (!order) return { event, sent: false, skipped: "order_not_found", statuses: [] };
      if (order.isPractice) return { event, sent: false, skipped: "practice", statuses: [] };
      let customer: any = order.customer ?? null;
      if (!customer && order.customerId) {
        customer = await this.t("customer").findFirst({ where: { id: order.customerId, organizationId: orgId } }).catch(() => null);
      }
      // b. dedupe — a prior "sent" for this event ends it
      // (ON8 automation_rule is exempt: see the header note —
      // its exactly-once guard is the OrderAutomationLog
      // unique on (ruleId, orderId, triggerKey), not this one.)
      if (!isAutomationRule) {
        const priorSent = await this.t("orderNotificationLog").findFirst({
          where: { organizationId: orgId, orderId, event, status: "sent" },
        }).catch(() => null);
        if (priorSent) return { event, sent: false, skipped: "already_sent", statuses: [] };
      }
      // c. settings gate (spec order: settings before covered;
      // ON8 automation_rule is exempt — the rule is the opt-in)
      const config = await this.getSettings(orgId);
      const eventConfig = isAutomationRule
        ? { enabled: true, channels: [...NOTIFICATION_CHANNELS], templates: { sms: null, whatsapp: null, email: null } }
        : config[ev];
      if (!isAutomationRule && !eventConfig?.enabled) {
        await this.writeLog(orgId, orderId, event, "none", "skipped_setting_off");
        return { event, sent: false, skipped: "setting_off", statuses: ["skipped_setting_off"] };
      }
      // d. covered-existing (legacy already reached the customer)
      if (!isAutomationRule && data?.coveredExisting === true) {
        await this.writeLog(orgId, orderId, event, "legacy", "covered_existing");
        return { event, sent: false, skipped: "covered_existing", statuses: ["covered_existing"] };
      }
      if (isAutomationRule && !String(data?.customMessage ?? "").trim()) {
        await this.writeLog(orgId, orderId, event, "none", "failed_no_channel");
        return { event, sent: false, statuses: ["failed_no_channel"] };
      }
      // e. variables from real data
      const shipment = await this.resolveShipment(orgId, orderId, data?.shipmentId);
      const vars = await this.buildVars(orgId, order, customer, shipment);
      // ON6: the reschedule date is a notify-call input, not
      // order data — "" when the call carries none.
      vars.rescheduleDate = data?.rescheduleDate ?? "";
      const phone = customer?.phone ? String(customer.phone) : shipment?.recipientPhone ? String(shipment.recipientPhone) : null;
      const email = customer?.email ? String(customer.email) : null;
      // f. channel loop, in configured order
      const statuses: string[] = [];
      let rowsWritten = 0;
      for (const channel of eventConfig.channels ?? []) {
        // capability checks
        if (channel === "sms" && !phone) {
          await this.writeLog(orgId, orderId, event, "sms", "skipped_no_channel"); rowsWritten++; statuses.push("skipped_no_channel"); continue;
        }
        if (channel === "whatsapp" && !order.conversationId) {
          await this.writeLog(orgId, orderId, event, "whatsapp", "skipped_no_channel"); rowsWritten++; statuses.push("skipped_no_channel"); continue;
        }
        if (channel === "email" && !email) {
          await this.writeLog(orgId, orderId, event, "email", "skipped_no_channel"); rowsWritten++; statuses.push("skipped_no_channel"); continue;
        }
        const text = isAutomationRule
          ? String(data?.customMessage ?? "")
          : renderTemplate(templateFor(config, ev, channel), vars);
        if (channel === "sms") {
          if (!this.shopAccount) {
            await this.writeLog(orgId, orderId, event, "sms", "skipped_no_channel"); rowsWritten++; statuses.push("skipped_no_channel"); continue;
          }
          const res: any = await this.shopAccount.sendShopSms(orgId, phone!, text, `order-notif-${orderId}-${event}`).catch((e: any) => ({ sent: false, notConfigured: false, reason: e instanceof Error ? e.message : String(e) }));
          if (res?.sent) {
            // sendShopSms returns no providerMessageId — null, never invented.
            await this.writeLog(orgId, orderId, event, "sms", "sent", { providerMessageId: null });
            return { event, sent: true, channel: "sms", statuses: [...statuses, "sent"] };
          }
          if (res?.notConfigured) {
            await this.writeLog(orgId, orderId, event, "sms", "skipped_no_channel"); rowsWritten++; statuses.push("skipped_no_channel"); continue;
          }
          await this.writeLog(orgId, orderId, event, "sms", "failed_error", { error: String(res?.reason ?? "SMS send failed").slice(0, 200) });
          rowsWritten++; statuses.push("failed_error"); continue;
        }
        if (channel === "whatsapp") {
          if (!this.inbox) {
            await this.writeLog(orgId, orderId, event, "whatsapp", "skipped_no_channel"); rowsWritten++; statuses.push("skipped_no_channel"); continue;
          }
          try {
            const sent: any = await this.inbox.sendAutomatedMessage(orgId, order.conversationId, text, "order_notification");
            await this.writeLog(orgId, orderId, event, "whatsapp", "sent", { providerMessageId: sent?.externalId ?? null });
            return { event, sent: true, channel: "whatsapp", statuses: [...statuses, "sent"] };
          } catch (e) {
            await this.writeLog(orgId, orderId, event, "whatsapp", "failed_error", { error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
            rowsWritten++; statuses.push("failed_error"); continue;
          }
        }
        if (channel === "email") {
          if (!this.emailProvider || !this.emailProvider.isConfigured()) {
            await this.writeLog(orgId, orderId, event, "email", "skipped_no_channel"); rowsWritten++; statuses.push("skipped_no_channel"); continue;
          }
          try {
            const subject = `অর্ডার ${vars.orderNumber} — ${vars.shopName}`;
            // AB8 (AX24): a white-label org's order email carries
            // the org's own brand as the sender display name.
            // Failure-isolated: any load error ⇒ no fromName,
            // exactly today's behaviour; whiteLabel off/absent
            // ⇒ no fromName key at all.
            let fromName: string | undefined;
            try {
              const orgRow: any = await this.t("organization").findFirst({ where: { id: orgId } }).catch(() => null);
              if (orgRow?.whiteLabel === true) {
                let settingShopName: string | null = null;
                try {
                  const settingRow: any = await this.t("storefrontSetting").findFirst({ where: { organizationId: orgId } }).catch(() => null);
                  if (settingRow?.shopName) settingShopName = String(settingRow.shopName);
                } catch { settingShopName = null; }
                const candidate = orgRow.brandName ?? settingShopName ?? orgRow.name ?? null;
                if (candidate && String(candidate).trim()) fromName = String(candidate);
              }
            } catch { fromName = undefined; }
            const res: any = await this.emailProvider.send({ to: email!, subject, text, ...(fromName ? { fromName } : {}) });
            await this.writeLog(orgId, orderId, event, "email", "sent", { providerMessageId: res?.providerMessageId ?? null });
            return { event, sent: true, channel: "email", statuses: [...statuses, "sent"] };
          } catch (e) {
            await this.writeLog(orgId, orderId, event, "email", "failed_error", { error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
            rowsWritten++; statuses.push("failed_error"); continue;
          }
        }
      }
      if (rowsWritten === 0) {
        await this.writeLog(orgId, orderId, event, "none", "failed_no_channel");
        statuses.push("failed_no_channel");
      }
      return { event, sent: false, statuses };
    } catch (e) {
      // notify NEVER throws.
      this.logger.warn(`order notification failed (${event}/${orderId}): ${e instanceof Error ? e.message : "unknown"}`);
      return { event, sent: false, skipped: "internal_error", statuses: [] };
    }
  }
}
