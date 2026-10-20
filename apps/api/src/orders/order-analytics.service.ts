import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EmailProvider } from "../messaging/email.provider";
import { ShopAccountService } from "../storefront/shop-account.service";
import { parseBdAddress } from "./bd-address";
import { TRANSIT_STATUSES } from "./order-queues";
import { computeSlaStage, SLA_DEFAULTS } from "../fulfillment/sla";
import { classifyShipmentStatus } from "../courier/courier-performance";
import { isSoldOrder } from "../storefront/ec27-discovery";
import { badRequest } from "../i18n";

/**
 * ON9 — Orders Analytics v2 + Owner Digest.
 *
 * METRIC DEFINITIONS (every number on the analytics surface and
 * in the owner digest traces to exactly these — do not fork):
 *
 * - Order date = placedAt ?? createdAt (Order.placedAt is
 *   nullable; createdAt is the fallback, as everywhere else in
 *   the orders area).
 * - Range: `from`/`to` are Asia/Dhaka calendar days
 *   (YYYY-MM-DD). Dhaka is UTC+6 year-round (no DST since 2009),
 *   so the UTC window is [from 00:00 +06:00, to+1day 00:00 +06:00).
 * - Practice orders (isPractice) are excluded EVERYWHERE.
 * - SOLD bucket = the EC33 definition (storefront/ec27-discovery
 *   isSoldOrder, the same predicate Customer-360 LTV uses): not
 *   cancelled/refunded/failed AND (status completed/delivered OR
 *   a CourierShipment in delivered/partial_delivered).
 * - revenueMinor = Σ totalMinor over sold-bucket orders placed
 *   in range. aovMinor = revenue / sold-bucket count (null when
 *   the sold count is 0 — never a fabricated 0).
 * - repeatCustomerRate: among customers (customerId non-null)
 *   with ≥1 sold order in range, % with ≥2 sold orders in range.
 * - cancellationRate: orders with raw status "cancelled" /
 *   all orders placed in range.
 * - returnRate basis (the REAL return machinery): an order
 *   counts as returned when its raw status is "returned" OR it
 *   has ≥1 ReturnRequest in a received/completed state (the
 *   parcel physically came back / the RMA closed). Denominator
 *   = all orders placed in range.
 * - cancelBreakdown is BY SOURCE: the Order model has NO
 *   cancel-reason field, so no reason taxonomy is invented.
 * - District: the customer's structured Customer.address.district
 *   (ON11 confirms a district into exactly that Json) wins;
 *   otherwise parseBdAddress over the order's own address text,
 *   counting medium/high confidence only — low-confidence parses
 *   are excluded, never guessed.
 * - Courier scorecard: shipments BOOKED (CourierShipment.createdAt)
 *   in range, per provider. deliveredPct / returnedPct use the
 *   S5 decided denominator (delivered+returned+cancelled via
 *   courier-performance classifyShipmentStatus); in-flight
 *   shipments have no outcome yet. Delivered-timestamp basis:
 *   CourierShipment has NO deliveredAt column and there is NO
 *   shipment status-history table (the A2 shipment events are
 *   in-memory emissions, not persisted rows), so the basis is
 *   the shipment's updatedAt while its status classifies as
 *   delivered — the last status-sync stamp. This is an
 *   APPROXIMATION (a later sync poll can move updatedAt); S5
 *   refuses this basis and reports null — ON9 adopts it per its
 *   spec, labelled, with the pair count `transitPairs` beside
 *   every average so the sample is never hidden.
 *   avgCodCollectLagDays pairs that delivered basis with
 *   codCollectedAt (EC26: set ONLY by a reconciliation import or
 *   a staff accept_sheet resolution); pairs where codCollectedAt
 *   precedes the delivered basis are excluded (impossible pair —
 *   the updatedAt moved after collection). Averages are null
 *   when there are no pairs — never 0 masquerading as data.
 * - productReturnWarnings: per linked productId, orders =
 *   distinct in-range orders containing it, returns = distinct
 *   such orders with ≥1 received/completed ReturnRequest entry
 *   for it; warns at rate ≥ RETURN_WARN_RATE% AND orders ≥
 *   RETURN_WARN_MIN_ORDERS. Unlinked lines (productId null)
 *   cannot be warned on and are skipped.
 * - stuckNow: parcels (CourierShipments) org-wide RIGHT NOW in a
 *   TRANSIT_STATUSES status whose updatedAt is older than the
 *   org's FulfillmentSetting.stuckDays (SLA_DEFAULTS fallback) —
 *   the ON6 stuck definition, counted whether or not the ON6
 *   sweep has escalated them yet.
 * - slaBreachesNow: non-terminal, non-practice orders org-wide
 *   whose OB3 computeSlaStage reports breached right now.
 * - Digest "collected": Σ amountMinor of APPROVED
 *   PaymentVerification rows CREATED that Dhaka day.
 *   PaymentVerification carries no reviewedAt/updatedAt — createdAt
 *   is its only timestamp. Staff-recorded advances (EC19) are
 *   created already-approved, so for them createdAt IS the
 *   collection moment; an inbox-extracted row approved later
 *   counts on its creation day (stated caveat).
 * - Digest "dueOutstanding": org-wide current due over
 *   delivered/completed orders = Σ (totalMinor − Σ APPROVED
 *   PaymentVerification amounts) where positive — the EC19 math
 *   order-queues.ts due_collection uses.
 *
 * Digest sends are recorded as AuditLog rows (action
 * "owner_order_digest", metadata = figures + per-recipient
 * results). NO new Prisma model. A recipient failure never fails
 * the run for others; a digest failure never blocks anything.
 */

export const RETURN_WARN_MIN_ORDERS = 10;
export const RETURN_WARN_RATE = 25;
export const OWNER_DIGEST_ACTION = "owner_order_digest";
export const OWNER_DIGEST_JOB_TYPE = "owner_order_digest";

const DAY_MS = 86400_000;
const CANCELLED = "cancelled";
const RETURNED_REQUEST_STATUSES = ["received", "completed"];
const TERMINAL_ORDER_STATUSES = ["cancelled", "refunded", "failed", "returned", "delivered", "completed"];

function toTime(v: any): number | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}
function orderDate(o: any): number | null {
  return toTime(o?.placedAt) ?? toTime(o?.createdAt);
}
function money(v: any): bigint {
  try { return BigInt(v ?? 0); } catch { return 0n; }
}
function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 10000) / 100;
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function fmtDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(d);
}

/** UTC bounds [start, end) for one Asia/Dhaka calendar day. */
export function dhakaDayBounds(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00+06:00`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function parseRange(from?: string, to?: string, now: Date = new Date()) {
  const dayRe = /^\d{4}-\d{2}-\d{2}$/;
  const toDay = to && dayRe.test(to) ? to : fmtDay(now);
  let fromDay = from && dayRe.test(from) ? from : null;
  if (!fromDay) {
    const toStart = dhakaDayBounds(toDay).start;
    fromDay = fmtDay(new Date(toStart.getTime() - 29 * DAY_MS));
  }
  if (fromDay > toDay) {
    throw badRequest("connections.fromAfterToDates");
  }
  const { start } = dhakaDayBounds(fromDay);
  const { end } = dhakaDayBounds(toDay);
  return { from: fromDay, to: toDay, start, end };
}

/** Structured (ON11-confirmed) district, else a medium/high parse. */
export function resolveDistrict(order: any, customer: any): string | null {
  const structured = customer?.address && typeof customer.address === "object"
    ? (customer.address as any).district : null;
  if (typeof structured === "string" && structured.trim()) return structured.trim();
  const text = typeof order?.address === "string" ? order.address : "";
  if (!text.trim()) return null;
  const parsed = parseBdAddress(text);
  if (parsed.district && (parsed.confidence === "medium" || parsed.confidence === "high")) return parsed.district;
  return null;
}

function takaText(minor: bigint): string {
  const neg = minor < 0n;
  const v = neg ? -minor : minor;
  const whole = v / 100n;
  const frac = v % 100n;
  const s = frac === 0n ? whole.toString() : `${whole.toString()}.${frac.toString().padStart(2, "0")}`;
  return `${neg ? "-" : ""}৳${s}`;
}

@Injectable()
export class OrderAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly email?: EmailProvider,
    @Optional() private readonly shopAccounts?: ShopAccountService,
  ) {}

  private t(name: string): any { return (this.prisma as any)[name]; }

  private async rows(name: string, where: any): Promise<any[]> {
    try {
      const table = this.t(name);
      if (!table?.findMany) return [];
      return (await table.findMany({ where })) ?? [];
    } catch { return []; }
  }

  private async loadOrgData(organizationId: string) {
    const [orders, shipments, customers, fulfillments] = await Promise.all([
      this.rows("order", { organizationId }),
      this.rows("courierShipment", { organizationId }),
      this.rows("customer", { organizationId }),
      this.rows("fulfillment", { organizationId }),
    ]);
    return {
      orders: orders.filter((o: any) => !o.isPractice),
      shipments,
      customerById: new Map(customers.map((c: any) => [String(c.id), c])),
      fulfillments,
    };
  }

  private async getSetting(organizationId: string) {
    try {
      const table = this.t("fulfillmentSetting");
      if (table?.findUnique) {
        const row = await table.findUnique({ where: { organizationId } }).catch(() => null);
        if (row) return row;
      }
      if (table?.findFirst) return await table.findFirst({ where: { organizationId } }).catch(() => null);
    } catch { /* defaults */ }
    return null;
  }

  /** Current stuck + SLA snapshot — the ON6/OB3 definitions. */
  async snapshot(organizationId: string, now: Date = new Date(), preloaded?: any) {
    const data = preloaded ?? await this.loadOrgData(organizationId);
    const setting = await this.getSetting(organizationId);
    const stuckDays = typeof setting?.stuckDays === "number" && setting.stuckDays > 0
      ? setting.stuckDays : SLA_DEFAULTS.stuckDays;
    const cutoff = now.getTime() - stuckDays * DAY_MS;
    const stuckNow = data.shipments.filter((s: any) =>
      (TRANSIT_STATUSES as readonly string[]).includes(String(s.status))
      && toTime(s.updatedAt) !== null && (toTime(s.updatedAt) as number) < cutoff).length;

    const fulfillmentsByOrder = new Map<string, any[]>();
    for (const f of data.fulfillments) {
      const k = String(f.orderId);
      if (!fulfillmentsByOrder.has(k)) fulfillmentsByOrder.set(k, []);
      fulfillmentsByOrder.get(k)!.push(f);
    }
    const shipmentsByOrder = new Map<string, any[]>();
    for (const s of data.shipments) {
      const k = String(s.orderId);
      if (!shipmentsByOrder.has(k)) shipmentsByOrder.set(k, []);
      shipmentsByOrder.get(k)!.push(s);
    }
    let slaBreachesNow = 0;
    for (const o of data.orders) {
      if (TERMINAL_ORDER_STATUSES.includes(String(o.status))) continue;
      const stage = computeSlaStage(o, fulfillmentsByOrder.get(String(o.id)) ?? [], shipmentsByOrder.get(String(o.id)) ?? [], setting, now);
      if (stage.breached) slaBreachesNow++;
    }
    return { stuckNow, slaBreachesNow };
  }

  async getAnalytics(organizationId: string, from?: string, to?: string, now: Date = new Date()) {
    const range = parseRange(from, to, now);
    const data = await this.loadOrgData(organizationId);
    const inRange = (t: number | null) => t !== null && t >= range.start.getTime() && t < range.end.getTime();

    const placed = data.orders.filter((o: any) => inRange(orderDate(o)));
    const placedIds = new Set(placed.map((o: any) => String(o.id)));

    const statusesByOrder = new Map<string, string[]>();
    for (const s of data.shipments) {
      const k = String(s.orderId);
      if (!statusesByOrder.has(k)) statusesByOrder.set(k, []);
      statusesByOrder.get(k)!.push(String(s.status));
    }
    const isSold = (o: any) => isSoldOrder(o, statusesByOrder.get(String(o.id)) ?? []);
    const sold = placed.filter(isSold);

    let revenue = 0n;
    for (const o of sold) revenue += money(o.totalMinor);
    const aovMinor = sold.length ? (revenue / BigInt(sold.length)).toString() : null;

    // Repeat customers (sold bucket, in range).
    const soldByCustomer = new Map<string, number>();
    for (const o of sold) {
      if (!o.customerId) continue;
      const k = String(o.customerId);
      soldByCustomer.set(k, (soldByCustomer.get(k) ?? 0) + 1);
    }
    const repeaters = [...soldByCustomer.values()].filter((n) => n >= 2).length;
    const repeatCustomerRate = pct(repeaters, soldByCustomer.size);

    // Cancellation.
    const cancelled = placed.filter((o: any) => String(o.status) === CANCELLED);
    const bySource = new Map<string, number>();
    for (const o of cancelled) {
      const src = String(o.source ?? "unknown");
      bySource.set(src, (bySource.get(src) ?? 0) + 1);
    }
    const cancelBreakdown = [...bySource.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

    // Returns — the real RMA machinery (see header definition).
    const returnRequests = (await this.rows("returnRequest", { organizationId }))
      .filter((r: any) => RETURNED_REQUEST_STATUSES.includes(String(r.status)));
    const returnedOrderIds = new Set<string>();
    for (const r of returnRequests) {
      if (placedIds.has(String(r.orderId))) returnedOrderIds.add(String(r.orderId));
    }
    for (const o of placed) if (String(o.status) === "returned") returnedOrderIds.add(String(o.id));
    const returnRate = pct(returnedOrderIds.size, placed.length);

    // Top districts over the sold bucket.
    const districtAgg = new Map<string, { orders: number; revenue: bigint }>();
    for (const o of sold) {
      const district = resolveDistrict(o, o.customerId ? data.customerById.get(String(o.customerId)) : null);
      if (!district) continue;
      const agg = districtAgg.get(district) ?? { orders: 0, revenue: 0n };
      agg.orders++;
      agg.revenue += money(o.totalMinor);
      districtAgg.set(district, agg);
    }
    const topDistricts = [...districtAgg.entries()]
      .map(([district, agg]) => ({ district, orders: agg.orders, revenueMinor: agg.revenue.toString() }))
      .sort((a, b) => b.orders - a.orders || a.district.localeCompare(b.district))
      .slice(0, 10);

    // Courier scorecard — shipments BOOKED in range.
    const booked = data.shipments.filter((s: any) => inRange(toTime(s.createdAt)));
    const byProvider = new Map<string, any[]>();
    for (const s of booked) {
      const k = String(s.provider ?? "unknown");
      if (!byProvider.has(k)) byProvider.set(k, []);
      byProvider.get(k)!.push(s);
    }
    const courierScorecard = [...byProvider.entries()].map(([provider, rowsForProvider]) => {
      let delivered = 0; let returned = 0; let cancelledCount = 0;
      let transitSum = 0; let transitPairs = 0;
      let codSum = 0; let codPairs = 0;
      for (const s of rowsForProvider) {
        const outcome = classifyShipmentStatus(s.status);
        if (outcome === "delivered") {
          delivered++;
          const bookedAt = toTime(s.createdAt);
          const deliveredAt = toTime(s.updatedAt); // basis: see header caveat
          if (bookedAt !== null && deliveredAt !== null && deliveredAt >= bookedAt) {
            transitSum += (deliveredAt - bookedAt) / DAY_MS;
            transitPairs++;
          }
          const codAt = toTime(s.codCollectedAt);
          if (codAt !== null && deliveredAt !== null && codAt >= deliveredAt) {
            codSum += (codAt - deliveredAt) / DAY_MS;
            codPairs++;
          }
        } else if (outcome === "returned") returned++;
        else if (outcome === "cancelled") cancelledCount++;
      }
      const decided = delivered + returned + cancelledCount;
      return {
        provider,
        shipments: rowsForProvider.length,
        delivered,
        returned,
        cancelled: cancelledCount,
        deliveredPct: pct(delivered, decided),
        returnedPct: pct(returned, decided),
        avgTransitDays: transitPairs ? round2(transitSum / transitPairs) : null,
        transitPairs,
        avgCodCollectLagDays: codPairs ? round2(codSum / codPairs) : null,
        codPairs,
      };
    }).sort((a, b) => b.shipments - a.shipments || a.provider.localeCompare(b.provider));

    // Product return warnings (same return basis as returnRate).
    const items = (await this.rows("orderItem", {}))
      .filter((i: any) => placedIds.has(String(i.orderId)));
    const itemById = new Map(items.map((i: any) => [String(i.id), i]));
    const productAgg = new Map<string, { name: string; orders: Set<string>; returns: Set<string> }>();
    for (const i of items) {
      if (!i.productId) continue;
      const k = String(i.productId);
      if (!productAgg.has(k)) productAgg.set(k, { name: String(i.name ?? ""), orders: new Set(), returns: new Set() });
      productAgg.get(k)!.orders.add(String(i.orderId));
    }
    for (const r of returnRequests) {
      if (!placedIds.has(String(r.orderId))) continue;
      const entries = Array.isArray(r.items) ? r.items : [];
      for (const e of entries) {
        const item = itemById.get(String(e?.orderItemId ?? ""));
        if (!item?.productId) continue;
        productAgg.get(String(item.productId))?.returns.add(String(r.orderId));
      }
    }
    const productReturnWarnings = [...productAgg.entries()]
      .map(([productId, agg]) => ({
        productId,
        productName: agg.name,
        orders: agg.orders.size,
        returns: agg.returns.size,
        ratePct: agg.orders.size ? round2((agg.returns.size / agg.orders.size) * 100) : 0,
      }))
      .filter((w) => w.orders >= RETURN_WARN_MIN_ORDERS && w.ratePct >= RETURN_WARN_RATE)
      .sort((a, b) => b.ratePct - a.ratePct || b.orders - a.orders);

    const snap = await this.snapshot(organizationId, now, data);

    return {
      from: range.from,
      to: range.to,
      timezone: "Asia/Dhaka",
      ordersCount: placed.length,
      soldCount: sold.length,
      revenueMinor: revenue.toString(),
      aovMinor,
      repeatCustomerRate,
      cancellationRate: pct(cancelled.length, placed.length),
      returnRate,
      // No cancel-reason field exists on Order — breakdown is by source.
      cancelBreakdownBasis: "source",
      cancelBreakdown,
      topDistricts,
      courierScorecard,
      productReturnWarnings,
      stuckNow: snap.stuckNow,
      slaBreachesNow: snap.slaBreachesNow,
    };
  }

  // ---------------- Owner digest ----------------

  async buildDigest(organizationId: string, period: "yesterday" | "today", now: Date = new Date()) {
    const todayStr = fmtDay(now);
    const day = period === "yesterday"
      ? fmtDay(new Date(dhakaDayBounds(todayStr).start.getTime() - DAY_MS))
      : todayStr;
    const { start, end } = dhakaDayBounds(day);
    const inDay = (t: number | null) => t !== null && t >= start.getTime() && t < end.getTime();

    const data = await this.loadOrgData(organizationId);
    const statusesByOrder = new Map<string, string[]>();
    for (const s of data.shipments) {
      const k = String(s.orderId);
      if (!statusesByOrder.has(k)) statusesByOrder.set(k, []);
      statusesByOrder.get(k)!.push(String(s.status));
    }
    const placedToday = data.orders.filter((o: any) => inDay(orderDate(o)));
    const soldToday = placedToday.filter((o: any) => isSoldOrder(o, statusesByOrder.get(String(o.id)) ?? []));
    let revenue = 0n;
    for (const o of soldToday) revenue += money(o.totalMinor);

    // Collected that day: APPROVED verifications CREATED that day
    // (createdAt is the only timestamp the model carries).
    const verifications = await this.rows("paymentVerification", { organizationId });
    let collected = 0n;
    const approvedByOrder = new Map<string, bigint>();
    for (const v of verifications) {
      if (String(v.status) !== "approved") continue;
      if (v.orderId) {
        const k = String(v.orderId);
        approvedByOrder.set(k, (approvedByOrder.get(k) ?? 0n) + money(v.amountMinor));
      }
      if (inDay(toTime(v.createdAt))) collected += money(v.amountMinor);
    }

    // Due outstanding (org-wide, EC19 math over delivered/completed).
    let dueOutstanding = 0n;
    for (const o of data.orders) {
      if (!["delivered", "completed"].includes(String(o.status))) continue;
      const due = money(o.totalMinor) - (approvedByOrder.get(String(o.id)) ?? 0n);
      if (due > 0n) dueOutstanding += due;
    }

    // Top district of the day (sold bucket).
    const districtCounts = new Map<string, number>();
    for (const o of soldToday) {
      const district = resolveDistrict(o, o.customerId ? data.customerById.get(String(o.customerId)) : null);
      if (district) districtCounts.set(district, (districtCounts.get(district) ?? 0) + 1);
    }
    const topEntry = [...districtCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];

    const snap = await this.snapshot(organizationId, now, data);
    return {
      period,
      day,
      ordersPlaced: placedToday.length,
      soldCount: soldToday.length,
      revenueMinor: revenue.toString(),
      collectedMinor: collected.toString(),
      dueOutstandingMinor: dueOutstanding.toString(),
      stuckNow: snap.stuckNow,
      slaBreachesNow: snap.slaBreachesNow,
      topDistrict: topEntry ? { district: topEntry[0], orders: topEntry[1] } : null,
    };
  }

  /** OWNER recipients (ACTIVE memberships, role OWNER) + their users. */
  async ownerRecipients(organizationId: string) {
    const memberships = (await this.rows("membership", { organizationId }))
      .filter((m: any) => m.status === "ACTIVE" && String(m.role) === "OWNER");
    const users = await this.rows("user", {});
    const userById = new Map(users.map((u: any) => [String(u.id), u]));
    const seen = new Set<string>();
    const out: { userId: string; email: string | null; phone: string | null }[] = [];
    for (const m of memberships) {
      const userId = String(m.userId);
      if (seen.has(userId)) continue;
      seen.add(userId);
      const user = userById.get(userId);
      // Owner phone audit: neither User nor Organization carries a
      // phone field anywhere in the schema, so this is null in
      // practice and the SMS leg skips with "no_phone_on_record".
      // The lookup stays so a future real field is picked up.
      const phone = (user as any)?.phone ?? null;
      out.push({ userId, email: user?.email ? String(user.email) : null, phone: phone ? String(phone) : null });
    }
    return out;
  }

  async sendDigest(organizationId: string, period: "yesterday" | "today", actorId?: string, now: Date = new Date()) {
    const figures = await this.buildDigest(organizationId, period, now);
    let org: any = null;
    try {
      const orgTable = this.t("organization");
      if (orgTable?.findFirst) org = await orgTable.findFirst({ where: { id: organizationId } });
    } catch { org = null; }
    const orgName = String(org?.brandName ?? org?.name ?? "আপনার দোকান");
    const recipients = await this.ownerRecipients(organizationId);

    const label = period === "yesterday" ? "গতকালের" : "আজকের";
    const subject = `${label} অর্ডার সারাংশ — ${orgName}`;
    const lines = [
      `${label} অর্ডার সারাংশ (${figures.day}) — ${orgName}`,
      `নতুন অর্ডার: ${figures.ordersPlaced}টি`,
      `বিক্রি (ডেলিভারি-প্রমাণিত): ${figures.soldCount}টি অর্ডার · ${takaText(BigInt(figures.revenueMinor))}`,
      `আদায় হয়েছে: ${takaText(BigInt(figures.collectedMinor))}`,
      `মোট বকেয়া বাকি: ${takaText(BigInt(figures.dueOutstandingMinor))}`,
      `কুরিয়ারে আটকে থাকা পার্সেল: ${figures.stuckNow}টি`,
      `SLA ভঙ্গ হয়েছে এমন খোলা অর্ডার: ${figures.slaBreachesNow}টি`,
      figures.topDistrict ? `সবচেয়ে বেশি অর্ডারের জেলা: ${figures.topDistrict.district} (${figures.topDistrict.orders}টি)` : "জেলাভিত্তিক তথ্য: আজকের বিক্রিতে জেলা শনাক্ত হয়নি",
    ];
    const text = lines.join("\n");
    const smsText = `${label} সারাংশ: অর্ডার ${figures.ordersPlaced}টি, বিক্রি ${takaText(BigInt(figures.revenueMinor))}, বকেয়া ${takaText(BigInt(figures.dueOutstandingMinor))}, আটকে থাকা পার্সেল ${figures.stuckNow}টি — ${orgName}`;

    const results: { userId: string; channel: string; ok: boolean; skipped?: boolean; error?: string }[] = [];
    for (const r of recipients) {
      // Email leg.
      if (!r.email) {
        results.push({ userId: r.userId, channel: "email", ok: false, skipped: true, error: "no_email_on_record" });
      } else {
        try {
          if (!this.email) throw new Error("Email provider unavailable");
          await this.email.send({ to: r.email, subject, text });
          results.push({ userId: r.userId, channel: "email", ok: true });
        } catch (e) {
          results.push({ userId: r.userId, channel: "email", ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      // SMS leg — only when a real owner phone exists on record.
      if (!r.phone) {
        results.push({ userId: r.userId, channel: "sms", ok: false, skipped: true, error: "no_phone_on_record" });
      } else {
        try {
          if (!this.shopAccounts) throw new Error("SMS sender unavailable");
          const sent = await this.shopAccounts.sendShopSms(organizationId, r.phone, smsText, `owner-digest-${figures.day}`);
          if (sent.sent) results.push({ userId: r.userId, channel: "sms", ok: true });
          else results.push({ userId: r.userId, channel: "sms", ok: false, error: sent.reason });
        } catch (e) {
          results.push({ userId: r.userId, channel: "sms", ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    const summary = {
      period,
      day: figures.day,
      figures,
      recipients: results,
      sentCount: results.filter((r) => r.ok).length,
      failedCount: results.filter((r) => !r.ok && !r.skipped).length,
      skippedCount: results.filter((r) => r.skipped).length,
    };

    // ONE AuditLog row per run (the digest send record — no model).
    try {
      await this.audit?.log({
        organizationId,
        ...(actorId ? { userId: actorId } : {}),
        action: OWNER_DIGEST_ACTION,
        entityType: "Organization",
        entityId: organizationId,
        metadata: {
          period, day: figures.day,
          ordersPlaced: figures.ordersPlaced,
          revenueMinor: figures.revenueMinor,
          collectedMinor: figures.collectedMinor,
          dueOutstandingMinor: figures.dueOutstandingMinor,
          stuckNow: figures.stuckNow,
          slaBreachesNow: figures.slaBreachesNow,
          results,
        } as any,
      });
    } catch { /* the audit write never fails the run */ }

    return summary;
  }

  /** owner_order_digest job body (AutomationService dispatch). */
  async runOwnerDigestJob(organizationId: string) {
    return this.sendDigest(organizationId, "yesterday");
  }

  async digestStatus(organizationId: string) {
    const audits = (await this.rows("auditLog", { organizationId }))
      .filter((a: any) => String(a.action) === OWNER_DIGEST_ACTION)
      .sort((a: any, b: any) => (toTime(b.createdAt) ?? 0) - (toTime(a.createdAt) ?? 0));
    const last = audits[0] ?? null;
    const jobs = (await this.rows("scheduledJob", { organizationId }))
      .filter((j: any) => String(j.type) === OWNER_DIGEST_JOB_TYPE);
    const recipients = await this.ownerRecipients(organizationId);
    return {
      lastRun: last ? {
        at: last.createdAt ?? null,
        period: (last.metadata as any)?.period ?? null,
        day: (last.metadata as any)?.day ?? null,
        results: (last.metadata as any)?.results ?? [],
        figures: {
          ordersPlaced: (last.metadata as any)?.ordersPlaced ?? null,
          revenueMinor: (last.metadata as any)?.revenueMinor ?? null,
          collectedMinor: (last.metadata as any)?.collectedMinor ?? null,
          dueOutstandingMinor: (last.metadata as any)?.dueOutstandingMinor ?? null,
          stuckNow: (last.metadata as any)?.stuckNow ?? null,
          slaBreachesNow: (last.metadata as any)?.slaBreachesNow ?? null,
        },
      } : null,
      jobEnabled: jobs.some((j: any) => j.enabled !== false),
      jobInstalled: jobs.length > 0,
      ownerEmails: recipients.map((r) => r.email).filter(Boolean),
    };
  }
}
