import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { createAgentNotification } from "../common/agent-notify";
import { AuditService } from "../audit/audit.service";
import { FulfillmentService } from "./fulfillment.service";
import { OrdersService } from "../orders/orders.service";
import { CourierRulesService } from "../courier/courier-rules.service";
import { OrderNotificationService } from "../order-notifications/order-notifications.service";
import { TRANSIT_STATUSES } from "../orders/order-queues";
import { parseBdAddress } from "../orders/bd-address";
import { SLA_DEFAULTS } from "./sla";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * ON6 — Fulfillment Excellence (API side):
 * - per-org fulfilment SLA settings (lazy defaults 24h / 24h /
 *   5 days — a read never writes a row);
 * - pick waves: staff batch orders, then "pick" packs ALL of an
 *   order's remaining items through the ONE FulfillmentService
 *   path (no second packing implementation);
 * - delivery attempts recorded against a shipment, with the
 *   rescheduled outcome notifying the customer through the ON5
 *   engine (failure-isolated — an attempt record never dies on
 *   a notification problem);
 * - the stuck-parcel sweep: shipments idle in a transit status
 *   past the org's stuckDays are escalated to OWNER/ADMIN staff
 *   (AgentNotification) + the customer (ON5 parcel_stuck),
 *   exactly once per (shipment, status) — the CourierShipment
 *   escalatedAt/escalatedForStatus stamps are the dedupe record,
 *   so a later status change re-arms escalation for the NEW
 *   status.
 *
 * Delivery-attempt shipment choice (documented): a caller-given
 * shipmentId that does not belong to the order is a 400 (the
 * request contradicts itself), not a 404 — the order exists and
 * the attempt form simply named the wrong shipment.
 */

export const DELIVERY_ATTEMPT_OUTCOMES = [
  "customer_unavailable", "refused", "address_issue", "rescheduled", "other",
] as const;

const WAVE_BLOCKED_STATUSES = ["cancelled", "refunded", "failed", "delivered", "completed", "returned"];
const SETTING_KEYS = ["confirmToPackHours", "packToHandoverHours", "stuckDays"] as const;

function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

@Injectable()
export class FulfillmentExcellenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfillments: FulfillmentService,
    @Optional() private readonly orders?: OrdersService,
    @Optional() private readonly courierRules?: CourierRulesService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly orderNotifications?: OrderNotificationService,
  ) {}

  private t(name: string): any { return (this.prisma as any)[name]; }

  private async safeFindMany(tableName: string, args: any): Promise<any[]> {
    try {
      const table = this.t(tableName);
      if (!table?.findMany) return [];
      return (await table.findMany(args)) ?? [];
    } catch { return []; }
  }

  // ---------- settings ----------

  /** Lazy defaults: no row ⇒ the in-code defaults, nothing written. */
  async getSettings(organizationId: string) {
    let row: any = null;
    try {
      const table = this.t("fulfillmentSetting");
      if (table?.findUnique) row = await table.findUnique({ where: { organizationId } }).catch(() => null);
      if (!row && table?.findFirst) row = await table.findFirst({ where: { organizationId } }).catch(() => null);
    } catch { row = null; }
    return {
      id: row?.id ?? null,
      organizationId,
      confirmToPackHours: row?.confirmToPackHours ?? SLA_DEFAULTS.confirmToPackHours,
      packToHandoverHours: row?.packToHandoverHours ?? SLA_DEFAULTS.packToHandoverHours,
      stuckDays: row?.stuckDays ?? SLA_DEFAULTS.stuckDays,
      createdAt: row?.createdAt ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async updateSettings(organizationId: string, actorId: string, dto: any) {
    const before = await this.getSettings(organizationId);
    const data: Record<string, number> = {};
    for (const key of SETTING_KEYS) {
      if (dto?.[key] === undefined) continue;
      const v = dto[key];
      if (!Number.isInteger(v) || v < 1 || v > 720) {
        throw badRequest("fulfillment.mustBeAnIntegerBetween1", { key: key });
      }
      data[key] = v;
    }
    const changedKeys = Object.keys(data).filter(
      (k) => (before as any)[k] !== data[k as keyof typeof data],
    );
    const table = this.t("fulfillmentSetting");
    const merged = {
      confirmToPackHours: data.confirmToPackHours ?? before.confirmToPackHours,
      packToHandoverHours: data.packToHandoverHours ?? before.packToHandoverHours,
      stuckDays: data.stuckDays ?? before.stuckDays,
    };
    let row: any = null;
    if (table?.upsert) {
      row = await table.upsert({
        where: { organizationId },
        create: { organizationId, ...merged },
        update: data,
      });
    } else if (table?.findFirst && table?.create && table?.update) {
      const existing = await table.findFirst({ where: { organizationId } }).catch(() => null);
      row = existing
        ? await table.update({ where: { id: existing.id }, data })
        : await table.create({ data: { organizationId, ...merged } });
    }
    await this.audit?.log({
      organizationId, userId: actorId, action: "fulfillment.settings_updated",
      entityType: "FulfillmentSetting", entityId: row?.id ?? organizationId,
      metadata: { changedKeys },
    }).catch(() => undefined);
    return this.getSettings(organizationId);
  }

  // ---------- pick waves ----------

  private async openWaveIds(organizationId: string): Promise<Set<string>> {
    const waves = await this.safeFindMany("pickWave", { where: { organizationId, status: "open" } });
    return new Set(waves.map((w: any) => String(w.id)));
  }

  private async orderInOpenWave(organizationId: string, orderId: string): Promise<boolean> {
    const openIds = await this.openWaveIds(organizationId);
    if (openIds.size === 0) return false;
    const rows = await this.safeFindMany("pickWaveOrder", { where: { orderId } });
    return rows.some((r: any) => openIds.has(String(r.waveId)));
  }

  /** Packable = some quantity still remaining, OR the order has
   * no fulfilments at all (nothing committed yet counts as
   * packable even when the remaining map reads 0 — e.g. an
   * order whose items were never loaded). */
  private async isPackable(organizationId: string, order: any): Promise<boolean> {
    const existing = await this.safeFindMany("fulfillment", { where: { organizationId, orderId: order.id } });
    if (existing.length === 0) return true;
    const remaining = await this.fulfillments.remainingFor(organizationId, order);
    let sum = 0;
    for (const v of remaining.values()) sum += v;
    return sum > 0;
  }

  async createWave(organizationId: string, actorId: string, dto: { orderIds?: string[]; note?: string }) {
    const rawIds = Array.isArray(dto?.orderIds) ? dto.orderIds.map((x) => String(x)).filter(Boolean) : [];
    const orderIds = [...new Set(rawIds)];
    if (orderIds.length < 1 || orderIds.length > 100) {
      throw badRequest("fulfillment.select1100OrdersInA");
    }
    const results: { orderId: string; ok: boolean; error?: string }[] = [];
    const passing: string[] = [];
    for (const orderId of orderIds) {
      const fail = (error: string) => results.push({ orderId, ok: false, error });
      const order = await this.t("order").findFirst({
        where: { id: orderId, organizationId }, include: { items: true },
      }).catch(() => null);
      if (!order) { fail("পাওয়া যায়নি"); continue; }
      if (WAVE_BLOCKED_STATUSES.includes(String(order.status))) {
        fail(`এই অবস্থার অর্ডার ওয়েভে নেওয়া যাবে না (${order.status})`); continue;
      }
      if (order.reviewHold === true) {
        fail("পর্যালোচনার জন্য আটকানো আছে (review hold) — আগে হোল্ড ছাড়ুন"); continue;
      }
      if (!(await this.isPackable(organizationId, order))) {
        fail("অর্ডারের সব আইটেম আগেই প্যাক/ফুলফিল করা হয়েছে"); continue;
      }
      if (await this.orderInOpenWave(organizationId, orderId)) {
        fail("অর্ডারটি অন্য একটি খোলা ওয়েভে ইতিমধ্যে আছে"); continue;
      }
      results.push({ orderId, ok: true });
      passing.push(orderId);
    }
    if (passing.length === 0) {
      const reasons = results.map((r) => `${r.orderId}: ${r.error}`).join("; ");
      throw badRequest("fulfillment.noOrderCouldBeTakenInto", { reasons: reasons });
    }
    const wave = await this.t("pickWave").create({
      data: { organizationId, status: "open", note: dto?.note?.trim() ? dto.note.trim() : null, createdById: actorId },
    });
    for (const orderId of passing) {
      await this.t("pickWaveOrder").create({ data: { waveId: wave.id, orderId } });
    }
    await this.audit?.log({
      organizationId, userId: actorId, action: "fulfillment.wave_created",
      entityType: "PickWave", entityId: wave.id,
      metadata: { added: passing.length, failed: results.length - passing.length },
    }).catch(() => undefined);
    return { wave, results };
  }

  private async waveProgress(waveId: string): Promise<{ total: number; picked: number }> {
    const rows = await this.safeFindMany("pickWaveOrder", { where: { waveId } });
    return { total: rows.length, picked: rows.filter((r: any) => r.pickedAt).length };
  }

  async listWaves(organizationId: string) {
    const waves = await this.safeFindMany("pickWave", { where: { organizationId } });
    const sorted = [...waves].sort((a: any, b: any) => {
      const openDiff = (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1);
      if (openDiff !== 0) return openDiff;
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    }).slice(0, 50);
    const out: any[] = [];
    for (const w of sorted) out.push({ ...w, progress: await this.waveProgress(w.id) });
    return out;
  }

  private async loadWave(organizationId: string, waveId: string) {
    const wave = await this.t("pickWave").findFirst({ where: { id: waveId, organizationId } }).catch(() => null);
    if (!wave) throw notFound("fulfillment.pickWaveNotFoundInThis");
    return wave;
  }

  async getWave(organizationId: string, waveId: string) {
    const wave = await this.loadWave(organizationId, waveId);
    const rows = await this.safeFindMany("pickWaveOrder", { where: { waveId } });
    const orders: any[] = [];
    for (const r of rows) {
      const order = await this.t("order").findFirst({ where: { id: r.orderId, organizationId } }).catch(() => null);
      orders.push({
        id: r.id, waveId: r.waveId, orderId: r.orderId,
        orderNumber: order?.externalNumber ?? null,
        status: order?.status ?? null,
        pickedAt: r.pickedAt ?? null, pickedById: r.pickedById ?? null,
        createdAt: r.createdAt ?? null,
        // AB3 (AX4): this order's stock allocations, as labels
        // for the pick view. NOTE the placement: getWave's order
        // entries carry NO per-line items today, so allocations
        // ride at the ORDER level (each label carries its
        // orderItemId + product/variant keys, so a line-level
        // consumer can match by orderItemId, falling back to
        // (productId, variantId) for component rows whose
        // orderItemId is null). Additive only.
        allocations: await this.allocationLabelsForOrder(organizationId, r.orderId),
      });
    }
    return { ...wave, progress: await this.waveProgress(waveId), orders };
  }

  /** AB3: allocation labels for one order — active rows only
   * (settled claims no longer hold pickable stock), oldest
   * first, failure-isolated like every read here (a missing
   * pre-migration table reads as no allocations). */
  private async allocationLabelsForOrder(organizationId: string, orderId: string): Promise<any[]> {
    const rows = await this.safeFindMany("stockAllocation", { where: { organizationId, orderId, status: "active" } });
    const sorted = [...rows].sort((a: any, b: any) =>
      new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()
      || String(a.id ?? "").localeCompare(String(b.id ?? "")));
    const out: any[] = [];
    for (const row of sorted) {
      const warehouse = row.warehouseId
        ? await this.t("warehouse")?.findFirst({ where: { id: row.warehouseId, organizationId } }).catch(() => null)
        : null;
      const bin = row.binId
        ? await this.t("binLocation")?.findFirst({ where: { id: row.binId, organizationId } }).catch(() => null)
        : null;
      out.push({
        warehouseName: warehouse?.name ?? null,
        binCode: bin?.code ?? null,
        qty: row.qty,
        orderItemId: row.orderItemId ?? null,
        productId: row.productId,
        variantId: row.variantId ?? null,
        warehouseId: row.warehouseId,
        binId: row.binId,
      });
    }
    return out;
  }

  async pickWaveOrder(organizationId: string, actorId: string, waveId: string, orderId: string) {
    const wave = await this.loadWave(organizationId, waveId);
    const row = await this.t("pickWaveOrder").findFirst({ where: { waveId, orderId } }).catch(() => null);
    if (!row) throw notFound("fulfillment.orderIsNotInThisWave");
    // Idempotent: an already-picked row returns unchanged and
    // never creates a second fulfilment.
    if (row.pickedAt) return row;
    if (wave.status !== "open") throw badRequest("fulfillment.theWaveIsClosedPickingIs");
    const order = await this.fulfillments.loadOrder(organizationId, orderId);
    const remaining = await this.fulfillments.remainingFor(organizationId, order);
    const lines = [...remaining.entries()]
      .filter(([, qty]) => qty > 0)
      .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
    const total = lines.reduce((s, l) => s + l.quantity, 0);
    if (total > 0) {
      const created = await this.fulfillments.create(organizationId, actorId, orderId, { items: lines });
      await this.fulfillments.update(organizationId, actorId, created.id, {
        packed: lines.map((l) => ({ orderItemId: l.orderItemId, packed: true })),
      });
    }
    // total == 0: already fully covered elsewhere — just stamp.
    const updated = await this.t("pickWaveOrder").update({
      where: { id: row.id }, data: { pickedAt: new Date(), pickedById: actorId },
    });
    return updated ?? { ...row, pickedAt: new Date(), pickedById: actorId };
  }

  async closeWave(organizationId: string, actorId: string, waveId: string) {
    const wave = await this.loadWave(organizationId, waveId);
    if (wave.status === "closed") return wave;
    const updated = await this.t("pickWave").update({
      where: { id: wave.id }, data: { status: "closed", closedAt: new Date() },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "fulfillment.wave_closed",
      entityType: "PickWave", entityId: waveId, metadata: { waveId },
    }).catch(() => undefined);
    return updated ?? { ...wave, status: "closed", closedAt: new Date() };
  }

  async removeWaveOrder(organizationId: string, actorId: string, waveId: string, orderId: string) {
    const wave = await this.loadWave(organizationId, waveId);
    if (wave.status !== "open") throw badRequest("fulfillment.anOrderCannotBeRemovedFrom");
    const row = await this.t("pickWaveOrder").findFirst({ where: { waveId, orderId } }).catch(() => null);
    if (!row) throw notFound("fulfillment.orderIsNotInThisWave");
    await this.t("pickWaveOrder").delete({ where: { id: row.id } });
    await this.audit?.log({
      organizationId, userId: actorId, action: "fulfillment.wave_order_removed",
      entityType: "PickWave", entityId: waveId, metadata: { waveId, orderId },
    }).catch(() => undefined);
    return { deleted: true, waveId, orderId };
  }

  /** Group the ready_to_pack queue by the courier a rule would
   * pick for each order, else by district — the wave-planning view. */
  async suggestWaves(organizationId: string) {
    if (!this.orders) return { groups: [], capped: false };
    const allIds = await this.orders.resolveQueueOrderIds(organizationId, "ready_to_pack");
    const capped = allIds.length > 200;
    const ids = allIds.slice(0, 200);
    const groups = new Map<string, { key: string; label: string; count: number; orderIds: string[] }>();
    const add = (key: string, orderId: string) => {
      const g = groups.get(key) ?? { key, label: key, count: 0, orderIds: [] };
      g.orderIds.push(orderId); g.count = g.orderIds.length;
      groups.set(key, g);
    };
    for (const orderId of ids) {
      let key: string | null = null;
      const order = await this.t("order").findFirst({
        where: { id: orderId, organizationId }, include: { customer: true },
      }).catch(() => null);
      if (order && this.courierRules) {
        try {
          const facts = await this.courierRules.factsForOrder(organizationId, order);
          const match = await this.courierRules.evaluate(organizationId, facts);
          if (match?.provider) key = String(match.provider);
        } catch { key = null; /* failure-isolated per order */ }
      }
      if (!key && order) {
        key = this.districtOf(order) ?? "অন্যান্য";
      }
      add(key ?? "অন্যান্য", orderId);
    }
    return { groups: [...groups.values()], capped };
  }

  private districtOf(order: any): string | null {
    const customer = order?.customer ?? null;
    const address = customer?.address ?? null;
    if (address && typeof address === "object" && address.district) return String(address.district);
    let text = "";
    if (typeof address === "string") text = address;
    else if (address && typeof address === "object") text = String(address.address_1 ?? address.address1 ?? "");
    if (!text) text = typeof order?.address === "string" ? order.address : "";
    return parseBdAddress(text).district;
  }

  // ---------- delivery attempts ----------

  private async loadOrderOr404(organizationId: string, orderId: string) {
    const order = await this.t("order").findFirst({ where: { id: orderId, organizationId } }).catch(() => null);
    if (!order) throw notFound("fulfillment.orderNotFoundInThisOrganization");
    return order;
  }

  async recordDeliveryAttempt(organizationId: string, actorId: string, orderId: string, dto: {
    shipmentId?: string; outcome?: string; note?: string; rescheduleDate?: string;
  }) {
    const outcome = String(dto?.outcome ?? "");
    if (!(DELIVERY_ATTEMPT_OUTCOMES as readonly string[]).includes(outcome)) {
      throw badRequest("fulfillment.outcomeMustBeOneOf", { p1: DELIVERY_ATTEMPT_OUTCOMES.join(", ") });
    }
    await this.loadOrderOr404(organizationId, orderId);
    let shipment: any = null;
    if (dto?.shipmentId) {
      shipment = await this.t("courierShipment").findFirst({
        where: { id: dto.shipmentId, organizationId, orderId },
      }).catch(() => null);
      // Documented choice: 400 (the request names a shipment
      // that contradicts the order), not 404.
      if (!shipment) throw badRequest("fulfillment.shipmentidIsNotAShipmentOf");
    } else {
      const rows = await this.safeFindMany("courierShipment", { where: { organizationId, orderId } });
      shipment = [...rows].sort((a: any, b: any) =>
        new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())[0] ?? null;
      if (!shipment) throw badRequest("fulfillment.thisOrderHasNoShipmentA");
    }
    let rescheduleDate: string | null = null;
    if (dto?.rescheduleDate !== undefined && dto.rescheduleDate !== null && dto.rescheduleDate !== "") {
      if (!isValidYmd(String(dto.rescheduleDate))) {
        throw badRequest("fulfillment.rescheduledateIsNotValidGiveIt");
      }
      rescheduleDate = String(dto.rescheduleDate);
    }
    if (outcome === "rescheduled" && !rescheduleDate) {
      throw badRequest("fulfillment.aRescheduledateYyyyMmDdIs");
    }
    const row = await this.t("deliveryAttempt").create({
      data: {
        organizationId, shipmentId: shipment.id, orderId,
        outcome, note: dto?.note?.trim() ? dto.note.trim() : null,
        rescheduleDate, recordedById: actorId,
      },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "fulfillment.delivery_attempt_recorded",
      entityType: "Order", entityId: orderId, metadata: { outcome },
    }).catch(() => undefined);
    if (outcome === "rescheduled" && this.orderNotifications) {
      try {
        await this.orderNotifications.notify(organizationId, orderId, "delivery_rescheduled", {
          shipmentId: shipment.id, rescheduleDate: rescheduleDate ?? undefined,
        }).catch(() => undefined);
      } catch { /* failure-isolated: the attempt record stands */ }
    }
    return row;
  }

  async listDeliveryAttempts(organizationId: string, orderId: string) {
    await this.loadOrderOr404(organizationId, orderId);
    const rows = await this.safeFindMany("deliveryAttempt", { where: { organizationId, orderId } });
    return [...rows]
      .filter((r: any) => String(r.orderId) === String(orderId))
      .sort((a: any, b: any) =>
        new Date(b.attemptedAt ?? b.createdAt ?? 0).getTime() - new Date(a.attemptedAt ?? a.createdAt ?? 0).getTime())
      .slice(0, 50);
  }

  // ---------- escalations ----------

  async listEscalations(organizationId: string) {
    const rows = await this.safeFindMany("courierShipment", { where: { organizationId } });
    const escalated = rows
      .filter((s: any) => s.escalatedAt)
      .sort((a: any, b: any) => new Date(b.escalatedAt ?? 0).getTime() - new Date(a.escalatedAt ?? 0).getTime())
      .slice(0, 100);
    const orderIds = [...new Set(escalated.map((s: any) => String(s.orderId)).filter(Boolean))];
    const orders = orderIds.length
      ? await this.safeFindMany("order", { where: { organizationId, id: { in: orderIds } } })
      : [];
    const numberById = new Map(orders.map((o: any) => [String(o.id), o.externalNumber ?? null]));
    const now = Date.now();
    return escalated.map((s: any) => ({
      ...s,
      orderNumber: numberById.get(String(s.orderId)) ?? null,
      trackingCode: s.trackingCode ?? null,
      provider: s.provider ?? null,
      status: s.status ?? null,
      escalatedForStatus: s.escalatedForStatus ?? null,
      ageDays: s.updatedAt ? Math.max(0, Math.floor((now - new Date(s.updatedAt).getTime()) / 86400_000)) : null,
    }));
  }

  /** stuck_parcel_sweep job body. Exactly-once per
   * (shipment, status) by construction: a shipment whose
   * escalatedForStatus already equals its current status is
   * never a candidate again until the status changes. */
  async runStuckParcelSweep(organizationId: string, now: Date = new Date()) {
    const setting = await this.getSettings(organizationId);
    const stuckDays = setting.stuckDays ?? SLA_DEFAULTS.stuckDays;
    const cutoff = now.getTime() - stuckDays * 86400_000;
    const shipments = await this.safeFindMany("courierShipment", { where: { organizationId } });
    const candidates = shipments
      .filter((s: any) =>
        (TRANSIT_STATUSES as readonly string[]).includes(String(s.status))
        && s.updatedAt && new Date(s.updatedAt).getTime() < cutoff
        && (!s.escalatedAt || s.escalatedForStatus !== s.status))
      .slice(0, 200);

    // Batch-resolve staff recipients ONCE. If the membership
    // lookup fails, notifications are skipped but the stamps
    // still land (failure-isolated, per the batch spec).
    let recipients: string[] = [];
    try {
      const memberships = await this.safeFindMany("membership", { where: { organizationId, status: "ACTIVE" } });
      recipients = [...new Set(memberships
        .filter((m: any) => m.status === "ACTIVE" && ["OWNER", "ADMIN"].includes(String(m.role)))
        .map((m: any) => String(m.userId)))];
    } catch { recipients = []; }

    let escalated = 0;
    let staffNotified = 0;
    for (const s of candidates) {
      const stamped = await this.t("courierShipment").update({
        where: { id: s.id }, data: { escalatedAt: now, escalatedForStatus: s.status },
      }).catch(() => null);
      if (!stamped) continue;
      escalated++;
      const order = await this.t("order").findFirst({
        where: { id: s.orderId, organizationId },
      }).catch(() => null);
      const orderNumber = order?.externalNumber ?? s.orderId;
      const days = s.updatedAt ? Math.max(0, Math.floor((now.getTime() - new Date(s.updatedAt).getTime()) / 86400_000)) : 0;
      for (const userId of recipients) {
        const made = await createAgentNotification(this.prisma as any, {
            organizationId, userId, type: "urgent",
            title: `পার্সেল আটকে আছে — অর্ডার ${orderNumber}`,
            body: `কুরিয়ার: ${s.provider ?? "—"} · ট্র্যাকিং: ${s.trackingCode ?? "—"} · ${days} দিন ধরে আটকে আছে (স্ট্যাটাস: ${s.status})`,
            conversationId: null,
          }).catch(() => null);
        if (made) staffNotified++;
      }
      if (this.orderNotifications) {
        try {
          await this.orderNotifications.notify(organizationId, String(s.orderId), "parcel_stuck", {
            shipmentId: s.id,
          }).catch(() => undefined);
        } catch { /* failure-isolated */ }
      }
    }
    return { checked: candidates.length, escalated, staffNotified };
  }
}
