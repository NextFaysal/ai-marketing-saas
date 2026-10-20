import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { badRequest } from "../i18n/api-exception";

export type AccountingExportType = "sales" | "tax" | "due" | "courier-collections";
const EXPORT_TYPES: AccountingExportType[] = ["sales", "tax", "due", "courier-collections"];

/** Courier statuses that mean the parcel reached the customer —
 * only these count toward expected/collected COD (EC26). */
const DELIVERED_STATUSES = ["delivered", "partial_delivered"];

/** Asia/Dhaka calendar date (YYYY-MM-DD) of an instant. BD is a
 * fixed UTC+06:00 with no DST, so a plain shift is exact. */
function dhakaDateString(d: Date): string {
  return new Date(d.getTime() + 6 * 3600 * 1000).toISOString().slice(0, 10);
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n") + "\n";
}

function big(v: unknown): bigint {
  try {
    return BigInt(v as any);
  } catch {
    return 0n;
  }
}

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Validate the period and return the UTC bounds of
   * [from 00:00, to 23:59:59.999] Asia/Dhaka (+06:00, no DST). */
  private parsePeriod(from?: string, to?: string): { start: Date; end: Date } {
    const bad = () => badRequest("tax.dateInvalidGiveFromAndToYyyyMmDd");
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw bad();
    const start = new Date(`${from}T00:00:00+06:00`);
    const end = new Date(`${to}T23:59:59.999+06:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw bad();
    // Reject rolled-over calendar dates (e.g. 2026-02-30).
    if (dhakaDateString(start) !== from || dhakaDateString(end) !== to) throw bad();
    if (start > end) throw badRequest("tax.theStartDateCannotBeAfter");
    const days =
      Math.round(
        (Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10))) -
          Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)))) /
          86400000,
      ) + 1;
    if (days > 366) throw badRequest("tax.aReportOfAtMost366");
    return { start, end };
  }

  /** Org orders whose effective date (placedAt, fallback createdAt)
   * falls in the period, oldest first. The fallback rule is why the
   * range is applied in memory: a single Prisma range on placedAt
   * alone would silently drop legacy rows whose placedAt is null. */
  private async ordersInPeriod(orgId: string, start: Date, end: Date): Promise<any[]> {
    const table = (this.prisma as any).order;
    const rows =
      (await table
        .findMany({ where: { organizationId: orgId }, include: { customer: true }, take: 5000 })
        .catch(() => [])) ?? [];
    return rows
      .map((o: any) => ({ order: o, effective: new Date(o.placedAt ?? o.createdAt) }))
      .filter(({ effective }: any) => !Number.isNaN(effective.getTime()) && effective >= start && effective <= end)
      .sort((a: any, b: any) => a.effective.getTime() - b.effective.getTime())
      .map(({ order }: any) => order);
  }

  /** EC19 advance logic, reused exactly: the paid advance of an
   * order is the sum of its APPROVED PaymentVerification amounts
   * (null amounts count 0). Grouped per orderId for the period. */
  private async approvedAdvancesByOrder(orgId: string): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>();
    const table = (this.prisma as any).paymentVerification;
    if (!table?.findMany) return out;
    const rows = (await table.findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [];
    for (const row of rows) {
      if (row.status !== "approved" || !row.orderId) continue;
      if (row.amountMinor === null || row.amountMinor === undefined) continue;
      out.set(String(row.orderId), (out.get(String(row.orderId)) ?? 0n) + big(row.amountMinor));
    }
    return out;
  }

  private async customerFor(order: any, customerMap: Map<string, any>): Promise<any | null> {
    if (order.customer) return order.customer;
    if (order.customerId && customerMap.has(String(order.customerId))) return customerMap.get(String(order.customerId));
    return null;
  }

  private async customerMap(orgId: string): Promise<Map<string, any>> {
    const table = (this.prisma as any).customer;
    const map = new Map<string, any>();
    if (!table?.findMany) return map;
    const rows = (await table.findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [];
    for (const c of rows) map.set(String(c.id), c);
    return map;
  }

  private customerName(customer: any | null): string {
    if (!customer) return "";
    return [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.name || "";
  }

  /** amountDue = total − refunded − approved advances, floored at 0
   * (the EC19 helper formula, extended with refunded as specified). */
  private dueOf(order: any, advances: Map<string, bigint>): { advance: bigint; refunded: bigint; due: bigint } {
    const advance = advances.get(String(order.id)) ?? 0n;
    const refunded = big(order.refundedMinor ?? 0);
    const raw = big(order.totalMinor ?? 0) - refunded - advance;
    return { advance, refunded, due: raw > 0n ? raw : 0n };
  }

  async exportCsv(orgId: string, type: string, from?: string, to?: string): Promise<string> {
    if (!(EXPORT_TYPES as string[]).includes(type)) {
      throw badRequest("tax.theReportTypeIsNotValid");
    }
    const { start, end } = this.parsePeriod(from, to);
    if (type === "courier-collections") return this.courierCollectionsCsv(orgId, start, end);
    const orders = await this.ordersInPeriod(orgId, start, end);
    const advances = await this.approvedAdvancesByOrder(orgId);
    const customers = await this.customerMap(orgId);

    if (type === "sales") return this.salesCsv(orders, advances, customers);
    if (type === "tax") return this.taxCsv(orders);
    return this.dueCsv(orders, advances, customers);
  }

  private async salesCsv(orders: any[], advances: Map<string, bigint>, customers: Map<string, any>): Promise<string> {
    const rows: unknown[][] = [];
    for (const o of orders) {
      const customer = await this.customerFor(o, customers);
      const { due } = this.dueOf(o, advances);
      rows.push([
        dhakaDateString(new Date(o.placedAt ?? o.createdAt)),
        o.invoiceNumber ?? "",
        o.externalNumber ?? o.externalId ?? o.id,
        this.customerName(customer),
        customer?.phone ?? "",
        String(big(o.subtotalMinor ?? 0)),
        String(big(o.discountMinor ?? 0)),
        String(big(o.shippingMinor ?? 0)),
        String(big(o.taxMinor ?? 0)),
        String(big(o.totalMinor ?? 0)),
        o.status ?? "",
        o.paymentMethod ?? "",
        o.isCod ? "yes" : "no",
        String(due),
      ]);
    }
    return toCsv(
      ["date", "invoice_number", "order_number", "customer_name", "customer_phone", "subtotal_minor", "discount_minor", "shipping_minor", "tax_minor", "total_minor", "status", "payment_method", "cod", "amount_due_minor"],
      rows,
    );
  }

  private taxCsv(orders: any[]): string {
    // Aggregate each order's stored taxBreakdown snapshot per rate.
    // Orders with taxMinor > 0 but NO breakdown are pre-EC23 legacy
    // rows: their rate is honestly "unknown" — never guessed — and
    // their taxable base stays blank (it was never recorded).
    const byRate = new Map<string, { taxable: bigint; vat: bigint; orders: number; known: boolean }>();
    let totalTaxable = 0n;
    let totalVat = 0n;
    let totalOrders = 0;
    for (const o of orders) {
      const breakdown = Array.isArray(o.taxBreakdown) ? o.taxBreakdown : null;
      if (breakdown && breakdown.length > 0) {
        totalOrders += 1;
        for (const entry of breakdown) {
          const key = String(entry.rateBps);
          const agg = byRate.get(key) ?? { taxable: 0n, vat: 0n, orders: 0, known: true };
          agg.taxable += big(entry.taxableMinor ?? 0);
          agg.vat += big(entry.taxMinor ?? 0);
          agg.orders += 1;
          byRate.set(key, agg);
          totalTaxable += big(entry.taxableMinor ?? 0);
          totalVat += big(entry.taxMinor ?? 0);
        }
      } else if (big(o.taxMinor ?? 0) > 0n) {
        totalOrders += 1;
        const agg = byRate.get("unknown") ?? { taxable: 0n, vat: 0n, orders: 0, known: false };
        agg.vat += big(o.taxMinor);
        agg.orders += 1;
        byRate.set("unknown", agg);
        totalVat += big(o.taxMinor);
      }
    }
    const keys = [...byRate.keys()].sort((a, b) => {
      if (a === "unknown") return 1;
      if (b === "unknown") return -1;
      return Number(a) - Number(b);
    });
    const rows: unknown[][] = keys.map((key) => {
      const agg = byRate.get(key)!;
      return [
        key,
        agg.known ? String(Number(key) / 100) : "",
        agg.known ? String(agg.taxable) : "",
        String(agg.vat),
        agg.orders,
      ];
    });
    rows.push(["TOTAL", "", String(totalTaxable), String(totalVat), totalOrders]);
    return toCsv(["rate_bps", "rate_percent", "taxable_base_minor", "vat_minor", "orders_count"], rows);
  }

  private async dueCsv(orders: any[], advances: Map<string, bigint>, customers: Map<string, any>): Promise<string> {
    const rows: unknown[][] = [];
    for (const o of orders) {
      const { advance, refunded, due } = this.dueOf(o, advances);
      if (due <= 0n) continue;
      const customer = await this.customerFor(o, customers);
      rows.push([
        o.externalNumber ?? o.externalId ?? o.id,
        this.customerName(customer),
        customer?.phone ?? "",
        String(big(o.totalMinor ?? 0)),
        String(advance),
        String(refunded),
        String(due),
        o.status ?? "",
        new Date(o.placedAt ?? o.createdAt).toISOString(),
      ]);
    }
    // NOTE (EC23 finding, resolved by EC26): CourierShipment now
    // carries a real collected marker — codCollectedMinor /
    // codCollectedAt / codCollectionSource, recorded ONLY from a
    // courier settlement-sheet reconciliation import (or a staff
    // accept_sheet resolution). Collections are reported by the
    // dedicated "courier-collections" export below; this due
    // report's semantics are unchanged (order-level due = total −
    // refunded − approved advances), so no collection section is
    // emitted here.
    return toCsv(
      ["order_number", "customer_name", "customer_phone", "total_minor", "advance_paid_minor", "refunded_minor", "amount_due_minor", "status", "placed_at"],
      rows,
    );
  }

  /**
   * EC26 — courier COD collections per provider.
   *
   * Period membership follows the SAME convention as the other
   * exports: the ORDER's effective date (placedAt ?? createdAt)
   * must fall in the period — a shipment counts when its order
   * does. `shipments` counts every shipment booked for those
   * orders; expected/collected/outstanding consider DELIVERED
   * shipments only (delivered / partial_delivered): expected =
   * Σ booked codAmountMinor, collected = Σ codCollectedMinor
   * (stamped only by a reconciliation import — a delivered status
   * alone collects nothing), outstanding = expected − collected.
   * discrepancy_count counts amount_mismatch reconciliation lines
   * whose IMPORT was created in the period, attributed to the
   * provider through import.courierIntegrationId → Integration.
   */
  private async courierCollectionsCsv(orgId: string, start: Date, end: Date): Promise<string> {
    const orders = await this.ordersInPeriod(orgId, start, end);
    const orderIds = new Set(orders.map((o: any) => String(o.id)));

    const shipmentTable = (this.prisma as any).courierShipment;
    const shipments: any[] = shipmentTable?.findMany
      ? ((await shipmentTable.findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [])
      : [];

    interface Agg { shipments: number; expected: bigint; collected: bigint; discrepancies: number }
    const byProvider = new Map<string, Agg>();
    const aggFor = (provider: string): Agg => {
      const agg = byProvider.get(provider) ?? { shipments: 0, expected: 0n, collected: 0n, discrepancies: 0 };
      byProvider.set(provider, agg);
      return agg;
    };
    for (const s of shipments) {
      if (!orderIds.has(String(s.orderId))) continue;
      const agg = aggFor(String(s.provider ?? ""));
      agg.shipments += 1;
      if (DELIVERED_STATUSES.includes(String(s.status ?? ""))) {
        agg.expected += big(s.codAmountMinor ?? 0);
        if (s.codCollectedMinor !== null && s.codCollectedMinor !== undefined) {
          agg.collected += big(s.codCollectedMinor);
        }
      }
    }

    // Discrepancies: mismatch lines of imports created in period,
    // joined in memory (line.importId → import.courierIntegrationId
    // → integration.provider), in this service's in-memory style.
    const integrationTable = (this.prisma as any).integration;
    const integrations: any[] = integrationTable?.findMany
      ? ((await integrationTable.findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [])
      : [];
    const providerByIntegration = new Map(integrations.map((i: any) => [String(i.id), String(i.provider ?? "")]));
    const importTable = (this.prisma as any).reconciliationImport;
    const imports: any[] = importTable?.findMany
      ? ((await importTable.findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [])
      : [];
    const providerByImport = new Map<string, string>();
    for (const imp of imports) {
      const created = new Date(imp.createdAt);
      if (Number.isNaN(created.getTime()) || created < start || created > end) continue;
      const provider = providerByIntegration.get(String(imp.courierIntegrationId));
      if (provider) providerByImport.set(String(imp.id), provider);
    }
    const lineTable = (this.prisma as any).reconciliationLine;
    const mismatchLines: any[] = lineTable?.findMany
      ? ((await lineTable
          .findMany({ where: { organizationId: orgId, outcome: "amount_mismatch" } })
          .catch(() => [])) ?? [])
      : [];
    for (const line of mismatchLines) {
      const provider = providerByImport.get(String(line.importId));
      if (provider) aggFor(provider).discrepancies += 1;
    }

    const rows: unknown[][] = [];
    let totalShipments = 0;
    let totalExpected = 0n;
    let totalCollected = 0n;
    let totalDiscrepancies = 0;
    for (const provider of [...byProvider.keys()].sort()) {
      const agg = byProvider.get(provider)!;
      rows.push([
        provider,
        agg.shipments,
        String(agg.expected),
        String(agg.collected),
        String(agg.expected - agg.collected),
        agg.discrepancies,
      ]);
      totalShipments += agg.shipments;
      totalExpected += agg.expected;
      totalCollected += agg.collected;
      totalDiscrepancies += agg.discrepancies;
    }
    rows.push([
      "TOTAL",
      totalShipments,
      String(totalExpected),
      String(totalCollected),
      String(totalExpected - totalCollected),
      totalDiscrepancies,
    ]);
    return toCsv(
      ["provider", "shipments", "expected_cod_minor", "collected_minor", "outstanding_minor", "discrepancy_count"],
      rows,
    );
  }
}
