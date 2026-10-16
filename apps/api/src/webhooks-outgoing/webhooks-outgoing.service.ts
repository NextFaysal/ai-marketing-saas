import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { createHmac, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { seal, unseal } from "../common/platform-config";
import { validateWebhookUrl, defaultWebhookLookup, type WebhookLookupFn } from "./webhook-url";

/**
 * GC23 — outgoing webhooks.
 *
 * Merchants subscribe an https endpoint to public order events;
 * every matching event becomes a WebhookDelivery row delivered by
 * this engine (HMAC-SHA256 signed, 5s timeout, retries at
 * 1m → 5m → 30m → 2h, failed after 5 attempts) driven by the
 * `webhook_delivery_sweep` automation job.
 *
 * Public event vocabulary ↔ in-process bus mapping:
 *  - "order.created"        ← bus "order.ingested" (CANONICAL) and
 *                             bus "order.created". Both bus events
 *                             mean "a new order exists": every emit
 *                             site fires BOTH for one creation
 *                             (integrations.service upsertOrder and
 *                             inbox.service createOrder — ingested
 *                             unconditionally, created 24h-guarded in
 *                             integrations). Subscribing to both
 *                             covers a hypothetical site that fires
 *                             only one; an in-process claim set
 *                             (orgId+orderId, 10 min) guarantees
 *                             ONE webhook per order: the ingested
 *                             handler claims synchronously, and the
 *                             created handler defers 25 ms before
 *                             claiming so ingested always wins the
 *                             claim when both fire (documented
 *                             residual: a process restart between
 *                             the two emits could double-deliver).
 *  - "order.status_changed" ← bus "order.status_changed"
 *                             {context:{orderId, from, to}}.
 *  - "order.paid"           ← bus "order.paid", emitted by
 *                             TenantPaymentsService.markVerifiedPaid
 *                             at the verified_paid transition (there
 *                             was NO bus event for it before GC23).
 *  - "order.returned"       ← bus "order.returned", emitted by
 *                             ReturnsService.createLink — the ONLY
 *                             ReturnRequest creation point (returns
 *                             previously emitted no bus event at all).
 *
 * Payloads are PII-minimal by construction: built from the order
 * row only — orderId, orderNumber, status, source, totalMinor
 * (string), currency, itemCount. NEVER customer name / phone /
 * address. Secrets are sealed at rest, shown EXACTLY ONCE (create
 * + rotate responses), and never logged.
 */

export const WEBHOOK_EVENTS = [
  "order.created",
  "order.status_changed",
  "order.paid",
  "order.returned",
] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

/** Retry backoff after attempt n (1-based failure count). */
export const WEBHOOK_RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000];
export const WEBHOOK_MAX_ATTEMPTS = 5;
export const WEBHOOK_TIMEOUT_MS = 5_000;

type FetchFn = (url: string, init: any) => Promise<{ status: number }>;

@Injectable()
export class WebhooksOutgoingService {
  private readonly logger = new Logger(WebhooksOutgoingService.name);
  /** Test seams: specs pin DNS answers + fetch outcomes. */
  lookupFn: WebhookLookupFn = defaultWebhookLookup;
  fetchFn: FetchFn = (url: string, init: any) => (globalThis as any).fetch(url, init);

  /** order.created dedupe claims: `${organizationId}:${orderId}` → claimedAt. */
  private readonly newOrderClaims = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly events?: EventsService,
  ) {
    if (this.events) {
      this.events.on("order.ingested", (p: any) => {
        void this.handleNewOrder(p?.organizationId, p?.context?.orderId, true);
      });
      this.events.on("order.created", (p: any) => {
        void this.handleNewOrder(p?.organizationId, p?.context?.orderId, false);
      });
      this.events.on("order.status_changed", (p: any) => {
        void this.handleStatusChanged(p).catch(() => undefined);
      });
      this.events.on("order.paid", (p: any) => {
        void this.handlePaid(p).catch(() => undefined);
      });
      this.events.on("order.returned", (p: any) => {
        void this.handleReturned(p).catch(() => undefined);
      });
    }
  }

  // ---------------- event handlers (failure-isolated) ----------------

  private claimNewOrder(organizationId: string, orderId: string): boolean {
    const key = `${organizationId}:${orderId}`;
    const now = Date.now();
    for (const [k, at] of this.newOrderClaims) {
      if (now - at > 10 * 60_000) this.newOrderClaims.delete(k);
    }
    if (this.newOrderClaims.has(key)) return false;
    this.newOrderClaims.set(key, now);
    return true;
  }

  private async handleNewOrder(organizationId: string, orderId: string, canonical: boolean): Promise<void> {
    try {
      if (!organizationId || !orderId) return;
      if (!canonical) {
        // Defer briefly: when a creation site fires BOTH bus
        // events in one synchronous block, the canonical
        // "order.ingested" handler (queued as an earlier/later
        // microtask) claims first; this path then no-ops. A site
        // firing ONLY "order.created" still produces the webhook.
        await new Promise((r) => setTimeout(r, 25));
      }
      if (!this.claimNewOrder(organizationId, orderId)) return;
      const data = await this.orderPayloadData(organizationId, orderId);
      if (!data) return;
      await this.fanOut(organizationId, "order.created", data);
    } catch (e) {
      this.logger.warn(`webhook order.created fan-out failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async handleStatusChanged(p: any): Promise<void> {
    const organizationId = p?.organizationId;
    const orderId = p?.context?.orderId;
    if (!organizationId || !orderId) return;
    const data = await this.orderPayloadData(organizationId, orderId);
    if (!data) return;
    await this.fanOut(organizationId, "order.status_changed", {
      ...data,
      from: p?.context?.from ?? null,
      to: p?.context?.to ?? data.status,
    });
  }

  private async handlePaid(p: any): Promise<void> {
    const organizationId = p?.organizationId;
    const orderId = p?.context?.orderId;
    if (!organizationId || !orderId) return;
    const data = await this.orderPayloadData(organizationId, orderId);
    if (!data) return;
    await this.fanOut(organizationId, "order.paid", {
      ...data,
      transactionId: p?.context?.transactionId ?? null,
      provider: p?.context?.provider ?? null,
      amountMinor: p?.context?.amountMinor != null ? String(p.context.amountMinor) : data.totalMinor,
    });
  }

  private async handleReturned(p: any): Promise<void> {
    const organizationId = p?.organizationId;
    const orderId = p?.context?.orderId;
    const returnRequestId = p?.context?.returnRequestId;
    if (!organizationId || !orderId || !returnRequestId) return;
    await this.fanOut(organizationId, "order.returned", {
      orderId,
      returnRequestId,
      status: p?.context?.status ?? "requested",
    });
  }

  /** PII-minimal order payload fields, from the order row only. */
  private async orderPayloadData(organizationId: string, orderId: string): Promise<any | null> {
    const order = await (this.prisma as any).order.findFirst({
      where: { id: orderId, organizationId },
      include: { items: { select: { quantity: true } } },
    }).catch(() => null);
    if (!order) return null;
    const itemCount = Array.isArray(order.items)
      ? order.items.reduce((sum: number, i: any) => sum + (Number(i.quantity) || 0), 0)
      : 0;
    return {
      orderId: order.id,
      orderNumber: order.externalNumber ?? null,
      status: order.status,
      source: order.source,
      totalMinor: String(order.totalMinor ?? 0),
      currency: order.currency ?? "BDT",
      itemCount,
    };
  }

  private async fanOut(organizationId: string, event: WebhookEventName, data: any): Promise<void> {
    const subs = await (this.prisma as any).webhookSubscription.findMany({
      where: { organizationId, active: true },
    }).catch(() => []);
    const payload = { event, organizationId, occurredAt: new Date().toISOString(), data };
    for (const sub of subs as any[]) {
      const events: unknown = sub.events;
      if (!Array.isArray(events) || !events.includes(event)) continue;
      await (this.prisma as any).webhookDelivery.create({
        data: {
          subscriptionId: sub.id, organizationId, event, payload,
          status: "pending", nextRetryAt: new Date(),
        },
      }).catch((e: unknown) => {
        this.logger.warn(`webhook delivery create failed (${event}): ${e instanceof Error ? e.message : e}`);
      });
    }
  }

  // ---------------- subscription CRUD ----------------

  private pub(sub: any) {
    return {
      id: sub.id,
      organizationId: sub.organizationId,
      url: sub.url,
      events: Array.isArray(sub.events) ? sub.events : [],
      active: Boolean(sub.active),
      secretSet: true,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    };
  }

  private validateEvents(events: unknown): string[] {
    const list = Array.isArray(events) ? events.map((e) => String(e)) : [];
    if (!list.length) throw new BadRequestException("কমপক্ষে একটি ইভেন্ট বেছে দিন");
    for (const e of list) {
      if (!(WEBHOOK_EVENTS as readonly string[]).includes(e)) {
        throw new BadRequestException(`অজানা ইভেন্ট: ${e} — সমর্থিত: ${WEBHOOK_EVENTS.join(", ")}`);
      }
    }
    return [...new Set(list)];
  }

  private async getSubscriptionOrThrow(organizationId: string, id: string) {
    const sub = await (this.prisma as any).webhookSubscription.findFirst({
      where: { id, organizationId },
    });
    if (!sub) throw new NotFoundException("Webhook subscription not found");
    return sub;
  }

  async createSubscription(organizationId: string, userId: string, dto: { url: string; events: string[] }) {
    const events = this.validateEvents(dto?.events);
    const verdict = await validateWebhookUrl(dto?.url, this.lookupFn);
    if (!verdict.ok) throw new BadRequestException(verdict.reason);
    const secret = randomBytes(32).toString("hex");
    const sub = await (this.prisma as any).webhookSubscription.create({
      data: {
        organizationId, url: verdict.url, events,
        secretSealed: seal(secret), active: true, createdById: userId,
      },
    });
    await this.audit?.log({
      organizationId, userId, action: "webhooks.subscription_created",
      entityType: "WebhookSubscription", entityId: sub.id,
      metadata: { url: verdict.url, events },
    }).catch(() => undefined);
    // The secret is returned EXACTLY ONCE — here. Never again.
    return { ...this.pub(sub), secret, secretShownOnce: true };
  }

  async listSubscriptions(organizationId: string) {
    const rows = await (this.prisma as any).webhookSubscription.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" },
    });
    return (rows as any[]).map((s) => this.pub(s));
  }

  async getSubscription(organizationId: string, id: string) {
    return this.pub(await this.getSubscriptionOrThrow(organizationId, id));
  }

  async updateSubscription(
    organizationId: string, userId: string, id: string,
    dto: { url?: string; events?: string[]; active?: boolean },
  ) {
    const sub = await this.getSubscriptionOrThrow(organizationId, id);
    const data: Record<string, unknown> = {};
    if (dto.url !== undefined) {
      const verdict = await validateWebhookUrl(dto.url, this.lookupFn);
      if (!verdict.ok) throw new BadRequestException(verdict.reason);
      data.url = verdict.url;
    }
    if (dto.events !== undefined) data.events = this.validateEvents(dto.events);
    if (dto.active !== undefined) data.active = Boolean(dto.active);
    if (!Object.keys(data).length) return this.pub(sub);
    const updated = await (this.prisma as any).webhookSubscription.update({
      where: { id: sub.id }, data,
    });
    await this.audit?.log({
      organizationId, userId, action: "webhooks.subscription_updated",
      entityType: "WebhookSubscription", entityId: sub.id,
      metadata: { changes: Object.keys(data) },
    }).catch(() => undefined);
    return this.pub(updated);
  }

  async rotateSecret(organizationId: string, userId: string, id: string) {
    const sub = await this.getSubscriptionOrThrow(organizationId, id);
    const secret = randomBytes(32).toString("hex");
    const updated = await (this.prisma as any).webhookSubscription.update({
      where: { id: sub.id }, data: { secretSealed: seal(secret) },
    });
    await this.audit?.log({
      organizationId, userId, action: "webhooks.subscription_secret_rotated",
      entityType: "WebhookSubscription", entityId: sub.id,
    }).catch(() => undefined);
    // Shown exactly once — same discipline as create.
    return { ...this.pub(updated), secret, secretShownOnce: true };
  }

  async deleteSubscription(organizationId: string, userId: string, id: string) {
    const sub = await this.getSubscriptionOrThrow(organizationId, id);
    await (this.prisma as any).webhookSubscription.delete({ where: { id: sub.id } });
    await this.audit?.log({
      organizationId, userId, action: "webhooks.subscription_deleted",
      entityType: "WebhookSubscription", entityId: sub.id,
      metadata: { url: sub.url },
    }).catch(() => undefined);
    return { ok: true, deleted: true };
  }

  // ---------------- delivery log ----------------

  async listDeliveries(organizationId: string, filter?: { subscriptionId?: string; status?: string; limit?: number }) {
    const where: any = { organizationId };
    if (filter?.subscriptionId) where.subscriptionId = filter.subscriptionId;
    if (filter?.status) where.status = filter.status;
    const take = Math.min(Math.max(Number(filter?.limit ?? 100) || 100, 1), 200);
    const rows = await (this.prisma as any).webhookDelivery.findMany({
      where, orderBy: { createdAt: "desc" }, take,
    });
    return (rows as any[]).map((d) => ({ ...d, payload: undefined, hasPayload: true }));
  }

  async getDelivery(organizationId: string, deliveryId: string) {
    const d = await (this.prisma as any).webhookDelivery.findFirst({
      where: { id: deliveryId, organizationId },
    });
    if (!d) throw new NotFoundException("Webhook delivery not found");
    return d;
  }

  /**
   * Manual resend: the SAME delivery row returns to pending
   * (attempts are KEPT — the retry budget is a property of the
   * delivery, a resend must not silently grant five fresh tries
   * against a failing endpoint; the attempt counter continues)
   * and one attempt runs immediately through the sweep path.
   */
  async resendDelivery(organizationId: string, deliveryId: string) {
    const d = await this.getDelivery(organizationId, deliveryId);
    const reset = await (this.prisma as any).webhookDelivery.update({
      where: { id: d.id },
      data: { status: "pending", nextRetryAt: new Date(), error: null },
    });
    await this.attemptDelivery(reset);
    return this.getDelivery(organizationId, deliveryId);
  }

  // ---------------- delivery engine ----------------

  /** Automation job entry: attempt every due delivery of the org. */
  async runDeliverySweep(organizationId: string) {
    const now = new Date();
    const due = await (this.prisma as any).webhookDelivery.findMany({
      where: { organizationId, status: "pending" },
      orderBy: { createdAt: "asc" }, take: 100,
    }).catch(() => []);
    let attempted = 0;
    let delivered = 0;
    let failed = 0;
    for (const d of due as any[]) {
      if (d.nextRetryAt && new Date(d.nextRetryAt).getTime() > now.getTime()) continue;
      attempted++;
      const outcome = await this.attemptDelivery(d).catch(() => "failed" as const);
      if (outcome === "delivered") delivered++;
      else if (outcome === "failed") failed++;
    }
    return { attempted, delivered, failed };
  }

  /** One delivery attempt. Returns the resulting coarse state. */
  async attemptDelivery(delivery: any): Promise<"delivered" | "retry" | "failed"> {
    const attempts = (Number(delivery.attempts) || 0) + 1;
    const fail = async (error: string, responseCode?: number): Promise<"retry" | "failed"> => {
      const exhausted = attempts >= WEBHOOK_MAX_ATTEMPTS;
      await (this.prisma as any).webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts,
          error: String(error).slice(0, 500),
          responseCode: responseCode ?? null,
          status: exhausted ? "failed" : "pending",
          nextRetryAt: exhausted
            ? null
            : new Date(Date.now() + WEBHOOK_RETRY_DELAYS_MS[Math.min(attempts - 1, WEBHOOK_RETRY_DELAYS_MS.length - 1)]),
        },
      }).catch(() => undefined);
      return exhausted ? "failed" : "retry";
    };

    const sub = await (this.prisma as any).webhookSubscription.findFirst({
      where: { id: delivery.subscriptionId, organizationId: delivery.organizationId },
    }).catch(() => null);
    if (!sub) return fail("subscription no longer exists");

    // SSRF re-check at attempt time: DNS may have changed since
    // the subscription was created (see webhook-url.ts TOCTOU note).
    const verdict = await validateWebhookUrl(sub.url, this.lookupFn);
    if (!verdict.ok) return fail(`URL re-validation failed: ${verdict.reason}`);

    const secret = unseal(sub.secretSealed);
    if (!secret) return fail("subscription secret cannot be decrypted");

    const body = JSON.stringify(delivery.payload ?? {});
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const res = await this.fetchFn(verdict.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Qosprey-Event": String(delivery.event),
          "X-Qosprey-Signature": `sha256=${signature}`,
          "X-Qosprey-Delivery": String(delivery.id),
        },
        body,
        signal: controller.signal,
      });
      const code = Number(res?.status ?? 0);
      if (code >= 200 && code < 300) {
        await (this.prisma as any).webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            attempts, status: "delivered", deliveredAt: new Date(),
            responseCode: code, error: null, nextRetryAt: null,
          },
        }).catch(() => undefined);
        return "delivered";
      }
      return fail(`endpoint responded HTTP ${code || "unknown"}`, code || undefined);
    } catch (e) {
      const msg = e instanceof Error && e.name === "AbortError"
        ? `request timed out after ${WEBHOOK_TIMEOUT_MS}ms`
        : e instanceof Error ? e.message : String(e);
      return fail(msg);
    } finally {
      clearTimeout(timer);
    }
  }
}
