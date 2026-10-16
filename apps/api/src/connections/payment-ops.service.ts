import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toCsv } from "../imports/csv";

/**
 * GC12 — Payment Ops (staff reads over TenantPaymentTransaction,
 * which IS the first-class payment-attempt record — no parallel
 * attempt table exists, by design).
 *
 * Honesty rules:
 * - "expired" is a DERIVED display label only (initiated and
 *   older than 24h). It is NEVER written back to the row: the
 *   stored status stays "initiated" because a late verified
 *   IPN/callback can still legitimately confirm that attempt —
 *   persisting a derived guess would corrupt the payment truth.
 * - Fee/net sums are null-aware: a group where NO row carries a
 *   fee (no gateway fee rate was configured) reports fee/net as
 *   null ("ফি হার সেট করা হয়নি"), never as a fabricated 0.
 * - Date ranges are Asia/Dhaka calendar days (YYYY-MM-DD),
 *   judged on the transaction's updatedAt (the moment it reached
 *   verified_paid). Dhaka is UTC+6 year-round.
 */

const DAY_MS = 86400_000;
const EXPIRED_AFTER_MS = 24 * 3600 * 1000;

function fmtDhakaDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(d);
}

function dhakaDayBounds(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00+06:00`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function parseDay(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${label} তারিখটি সঠিক নয় — YYYY-MM-DD ফরম্যাটে দিন`);
  }
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new BadRequestException(`${label} তারিখটি সঠিক নয় — YYYY-MM-DD ফরম্যাটে দিন`);
  }
  return value;
}

/** Range [start, end) in UTC for Dhaka days from..to inclusive.
 * Default: the last 30 Dhaka days ending today. */
export function paymentRange(from?: string, to?: string, now: Date = new Date()) {
  const toDay = to ? parseDay(String(to), "to") : fmtDhakaDay(now);
  let fromDay: string;
  if (from) {
    fromDay = parseDay(String(from), "from");
  } else {
    const toStart = dhakaDayBounds(toDay).start;
    fromDay = fmtDhakaDay(new Date(toStart.getTime() - 29 * DAY_MS));
  }
  if (fromDay > toDay) {
    throw new BadRequestException("শুরুর তারিখ (from) শেষ তারিখের (to) পরে হতে পারবে না");
  }
  return { from: fromDay, to: toDay, start: dhakaDayBounds(fromDay).start, end: dhakaDayBounds(toDay).end };
}

function money(v: any): bigint {
  try { return BigInt(v ?? 0); } catch { return 0n; }
}

@Injectable()
export class PaymentOpsService {
  constructor(private readonly prisma: PrismaService) {}

  private t(name: string): any { return (this.prisma as any)[name]; }

  private displayStatus(txn: any, now: Date): string {
    // Derived only — never persisted (see class doc).
    if (String(txn.status) === "initiated" && txn.createdAt && now.getTime() - new Date(txn.createdAt).getTime() > EXPIRED_AFTER_MS) {
      return "expired";
    }
    return String(txn.status ?? "");
  }

  private attemptView(txn: any, orderNumber: string | null, now: Date) {
    return {
      id: txn.id,
      orderId: txn.orderId,
      orderNumber,
      provider: txn.provider,
      source: txn.source ?? "own",
      amountMinor: String(txn.amountMinor ?? "0"),
      currency: txn.currency ?? "BDT",
      status: txn.status,
      displayStatus: this.displayStatus(txn, now),
      providerTxnId: txn.providerTxnId ?? null,
      failureReason: txn.failureReason ?? null,
      feeMinor: txn.feeMinor != null ? String(txn.feeMinor) : null,
      netMinor: txn.netMinor != null ? String(txn.netMinor) : null,
      createdAt: txn.createdAt,
      updatedAt: txn.updatedAt,
    };
  }

  private async orderNumbers(organizationId: string, orderIds: string[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    const ids = [...new Set(orderIds.filter(Boolean))];
    if (!ids.length) return map;
    try {
      const rows: any[] = (await this.t("order").findMany({ where: { organizationId, id: { in: ids } } })) ?? [];
      for (const o of rows) map.set(String(o.id), o.externalNumber ?? null);
    } catch { /* numbers are display-only; a join failure never breaks the list */ }
    return map;
  }

  async listAttempts(organizationId: string, q: { status?: string; provider?: string; source?: string; orderId?: string; page?: string | number; pageSize?: string | number } = {}, now: Date = new Date()) {
    const page = Math.max(1, Math.floor(Number(q.page) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(q.pageSize) || 20)));
    const where: any = { organizationId };
    if (q.provider) where.provider = String(q.provider);
    if (q.source) where.source = String(q.source);
    if (q.orderId) where.orderId = String(q.orderId);
    if (q.status && String(q.status) !== "expired") where.status = String(q.status);
    let rows: any[] = [];
    try {
      rows = (await this.t("tenantPaymentTransaction").findMany({ where })) ?? [];
    } catch { rows = []; }
    let filtered = [...rows].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    if (q.status && String(q.status) === "expired") {
      filtered = filtered.filter((r) => this.displayStatus(r, now) === "expired");
    }
    const total = filtered.length;
    const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
    const numbers = await this.orderNumbers(organizationId, slice.map((r) => String(r.orderId)));
    return {
      items: slice.map((r) => this.attemptView(r, numbers.get(String(r.orderId)) ?? null, now)),
      total,
      page,
      pageSize,
    };
  }

  async getAttempt(organizationId: string, attemptId: string, now: Date = new Date()) {
    let txn: any = null;
    try {
      txn = await this.t("tenantPaymentTransaction").findFirst({ where: { id: attemptId, organizationId } });
    } catch { txn = null; }
    if (!txn) throw new NotFoundException("Payment attempt not found");
    const numbers = await this.orderNumbers(organizationId, [String(txn.orderId)]);
    return {
      ...this.attemptView(txn, numbers.get(String(txn.orderId)) ?? null, now),
      valId: txn.valId ?? null,
      ipnPayload: txn.ipnPayload ?? null,
    };
  }

  private async verifiedInRange(organizationId: string, from?: string, to?: string, now: Date = new Date()) {
    const range = paymentRange(from, to, now);
    let rows: any[] = [];
    try {
      rows = (await this.t("tenantPaymentTransaction").findMany({
        where: { organizationId, status: "verified_paid" },
      })) ?? [];
    } catch { rows = []; }
    const inRange = rows.filter((r) => {
      const t = r.updatedAt ? new Date(r.updatedAt).getTime() : NaN;
      return Number.isFinite(t) && t >= range.start.getTime() && t < range.end.getTime();
    });
    return { range, rows: inRange };
  }

  private aggregate(rows: any[]) {
    let gross = 0n;
    let fee = 0n;
    let net = 0n;
    let withFeeCount = 0;
    for (const r of rows) {
      gross += money(r.amountMinor);
      if (r.feeMinor != null) {
        withFeeCount += 1;
        fee += money(r.feeMinor);
        if (r.netMinor != null) net += money(r.netMinor);
      }
    }
    return {
      count: rows.length,
      grossMinor: gross.toString(),
      withFeeCount,
      feeMinor: withFeeCount === 0 ? null : fee.toString(),
      netMinor: withFeeCount === 0 ? null : net.toString(),
    };
  }

  async feeReport(organizationId: string, from?: string, to?: string, now: Date = new Date()) {
    const { rows } = await this.verifiedInRange(organizationId, from, to, now);
    const groups = new Map<string, { provider: string; source: string; rows: any[] }>();
    for (const r of rows) {
      const provider = String(r.provider ?? "");
      const source = String(r.source ?? "own");
      const key = `${provider} ${source}`;
      if (!groups.has(key)) groups.set(key, { provider, source, rows: [] });
      groups.get(key)!.rows.push(r);
    }
    const out = [...groups.values()].map((g) => ({
      provider: g.provider, source: g.source, ...this.aggregate(g.rows),
    }));
    out.sort((a, b) => (a.provider === b.provider ? (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) : a.provider < b.provider ? -1 : 1));
    return { rows: out };
  }

  async feeReportCsv(organizationId: string, from?: string, to?: string, now: Date = new Date()): Promise<string> {
    const { rows } = await this.feeReport(organizationId, from, to, now);
    const headers = ["provider", "source", "count", "grossMinor", "withFeeCount", "feeMinor", "netMinor"];
    const body = rows.map((r) => [r.provider, r.source, r.count, r.grossMinor, r.withFeeCount, r.feeMinor ?? "", r.netMinor ?? ""]);
    return toCsv(headers, body);
  }

  async settlements(organizationId: string, from?: string, to?: string, now: Date = new Date()) {
    const { rows } = await this.verifiedInRange(organizationId, from, to, now);
    const own = rows.filter((r) => String(r.source ?? "own") === "own");
    const groups = new Map<string, { provider: string; day: string; rows: any[] }>();
    for (const r of own) {
      const provider = String(r.provider ?? "");
      const day = fmtDhakaDay(new Date(r.updatedAt));
      const key = `${day} ${provider}`;
      if (!groups.has(key)) groups.set(key, { provider, day, rows: [] });
      groups.get(key)!.rows.push(r);
    }
    const out = [...groups.values()].map((g) => ({
      provider: g.provider, day: g.day, ...this.aggregate(g.rows),
    }));
    out.sort((a, b) => (a.day === b.day ? (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0) : a.day < b.day ? 1 : -1));
    return { rows: out };
  }
}
