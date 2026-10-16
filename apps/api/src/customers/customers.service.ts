import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RiskService } from "../orders/risk.service";
import { minorToMajor, toCsv } from "../imports/csv";
import { dhakaDayStartUtc } from "../crm/lead-followups";
import { CustomFieldsService, renderCustomFieldValue } from "../crm/custom-fields.service";
import { ErasureService } from "./erasure.service";
import {
  CrmSegmentsService, computeCustomerOrderStats, customerTagsOf, segmentFactsOf, segmentMatches,
} from "./crm-segments.service";

export interface CustomerListOptions {
  hasDue?: boolean;
  /** GB6 (GC15): all | first | repeat | vip | blocked. */
  customerType?: string;
  /** GB6 (GC15): exact stored-tag match. */
  tag?: string;
  /** GB6 (GC15): CrmSegment id — rows are filtered by the
   * segment's criteria (shared evaluator). */
  segmentId?: string;
}

const customerName = (c: any) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || null;

/** ON7 খাতা: statuses whose due is NOT open (never collected). */
const OPEN_DUE_EXCLUDED = ["cancelled", "refunded", "returned", "failed"];

function bigOrZero(v: unknown): bigint {
  try { return BigInt(v as any); } catch { return 0n; }
}

/**
 * Customer 360: one record per real person. Lists exclude merged
 * records; detail aggregates orders, conversations and shipments from
 * the real tables; merge moves relationships to the surviving record
 * and keeps the source as a marked, hidden shell (never deleted).
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly risk?: RiskService,
    @Optional() private readonly customFields?: CustomFieldsService,
    // CP6: shared erasure logic (also injected by ShopifyService
    // for GDPR customers/redact). Optional + fallback so existing
    // positional spec constructions keep working.
    @Optional() private readonly erasure?: ErasureService,
    // GB6 (GC15): segment storage + the SHARED criteria
    // evaluator. Optional + local fallback so existing positional
    // spec constructions keep working.
    @Optional() private readonly segments?: CrmSegmentsService,
  ) {}

  private segmentsSvc(): CrmSegmentsService {
    return this.segments ?? new CrmSegmentsService(this.prisma as any, this.audit);
  }

  /** CP6: GDPR deep erasure — see ErasureService for the exact
   *  erase-vs-keep contract. OWNER/ADMIN only at the route. */
  async eraseCustomer(organizationId: string, actorId: string, customerId: string) {
    const svc = this.erasure ?? new ErasureService(this.prisma as any, this.audit);
    return svc.eraseCustomer(organizationId, actorId, customerId);
  }

  async list(organizationId: string, q?: string, options?: CustomerListOptions) {
    return this.rowsWithStats(organizationId, q, 100, options);
  }

  /** ON7: APPROVED PaymentVerification sums per order — ONE
   * groupBy for the whole id set (the OrdersService pattern at
   * orders.service.ts approvedSumsByOrder), with a findMany
   * fallback for partial deployments / fakes without groupBy. */
  private async approvedSumsByOrder(organizationId: string, orderIds: string[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>();
    if (!orderIds.length) return out;
    const table = (this.prisma as any).paymentVerification;
    if (!table) return out;
    try {
      if (table.groupBy) {
        const rows = await table.groupBy({
          by: ["orderId"],
          where: { organizationId, status: "approved", orderId: { in: orderIds } },
          _sum: { amountMinor: true },
        });
        for (const r of rows ?? []) {
          if (r?.orderId == null) continue;
          out.set(String(r.orderId), bigOrZero(r._sum?.amountMinor ?? 0));
        }
        return out;
      }
    } catch { /* fall through to the findMany path */ }
    try {
      if (table.findMany) {
        const rows = (await table.findMany({ where: { organizationId, status: "approved" } }).catch(() => [])) ?? [];
        const wanted = new Set(orderIds.map(String));
        for (const r of rows) {
          if (r?.orderId == null || !wanted.has(String(r.orderId)) || r.amountMinor == null) continue;
          out.set(String(r.orderId), (out.get(String(r.orderId)) ?? 0n) + bigOrZero(r.amountMinor));
        }
      }
    } catch { /* advisory math only */ }
    return out;
  }

  /** EC19 due of ONE order: total − min(total, approved paid). */
  private dueOfOrder(order: any, sums: Map<string, bigint>): bigint {
    const total = bigOrZero(order.totalMinor ?? 0);
    const paidRaw = sums.get(String(order.id)) ?? 0n;
    const paid = paidRaw > total ? total : paidRaw;
    const due = total - paid;
    return due > 0n ? due : 0n;
  }

  /** ON7: open-due totals per customer for a set of customers —
   * TWO bulk queries total (open orders of those customers + one
   * grouped approved-PV sum), never per-customer queries. */
  private async dueMinorByCustomer(organizationId: string, customerIds: string[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>(customerIds.map((id) => [String(id), 0n]));
    if (!customerIds.length) return out;
    const orders: any[] = ((await (this.prisma as any).order.findMany({
      where: {
        organizationId, customerId: { in: customerIds }, isPractice: false,
        status: { notIn: OPEN_DUE_EXCLUDED },
      },
    }).catch(() => [])) ?? []);
    if (!orders.length) return out;
    const sums = await this.approvedSumsByOrder(organizationId, orders.map((o: any) => String(o.id)));
    for (const o of orders) {
      const key = String(o.customerId);
      out.set(key, (out.get(key) ?? 0n) + this.dueOfOrder(o, sums));
    }
    return out;
  }

  /** ON7 hasDue filter: the org's due>0 customer id set, computed
   * with the same two-query pattern (all open orders of the org +
   * ONE grouped approved-PV sum — the OB1 due_collection
   * approach), so list() can intersect BEFORE slicing its page.
   * The existing list is unpaginated-bounded (500 customers
   * fetched, 100 returned), so filtering inside that window is
   * the documented approach here. */
  private async dueCustomerIds(organizationId: string): Promise<Set<string>> {
    const dueByCustomer = await this.dueMinorByCustomerAll(organizationId);
    return new Set([...dueByCustomer.entries()].filter(([, v]) => v > 0n).map(([k]) => k));
  }

  private async dueMinorByCustomerAll(organizationId: string): Promise<Map<string, bigint>> {
    const orders: any[] = ((await (this.prisma as any).order.findMany({
      where: { organizationId, isPractice: false, status: { notIn: OPEN_DUE_EXCLUDED } }, take: 5000,
    }).catch(() => [])) ?? []);
    const out = new Map<string, bigint>();
    if (!orders.length) return out;
    const sums = await this.approvedSumsByOrder(organizationId, orders.map((o: any) => String(o.id)));
    for (const o of orders) {
      if (o.customerId == null) continue;
      const key = String(o.customerId);
      out.set(key, (out.get(key) ?? 0n) + this.dueOfOrder(o, sums));
    }
    return out;
  }

  /** The list computation, shared verbatim by list() (first 100)
   * and the C3 CSV export (the full fetched window of 500).
   * GB6 (GC15): the per-customer order scan became the SHARED
   * grouped computation in crm-segments.service.ts — orderCount /
   * totalSpentMinor keep the labelled "orders excluding
   * cancelled" meaning, and each row additionally carries the
   * EC33 sold-bucket figures. Staff notes are NEVER listed. */
  private async rowsWithStats(organizationId: string, q: string | undefined, limit: number, options?: CustomerListOptions) {
    const rows = await (this.prisma as any).customer.findMany({
      where: { organizationId, mergedIntoId: null }, orderBy: { createdAt: "desc" }, take: 500,
    });
    const needle = q?.trim().toLowerCase();
    let filtered = needle
      ? rows.filter((c: any) => [customerName(c), c.phone, c.email].filter(Boolean).some((v: string) => v.toLowerCase().includes(needle)))
      : rows;
    // ON7: hasDue filters BEFORE the page slice below.
    if (options?.hasDue) {
      const dueIds = await this.dueCustomerIds(organizationId);
      filtered = filtered.filter((c: any) => dueIds.has(String(c.id)));
    }
    // GB6: row-field filters (in memory, same window discipline).
    const type = String(options?.customerType ?? "all");
    if (type === "vip") filtered = filtered.filter((c: any) => !!c.isVip);
    if (type === "blocked") filtered = filtered.filter((c: any) => !!c.isBlocked);
    const tagNeedle = options?.tag?.trim();
    if (tagNeedle) filtered = filtered.filter((c: any) => customerTagsOf(c).includes(tagNeedle));
    // GB6: filters that need derived stats (first/repeat,
    // segment membership) compute stats for the WHOLE filtered
    // window (≤500) BEFORE slicing; every other case keeps the
    // cheap page-only stats path.
    let stats: Map<string, import("./crm-segments.service").CustomerOrderStats> | null = null;
    if (type === "first" || type === "repeat" || options?.segmentId) {
      stats = await computeCustomerOrderStats(this.prisma as any, organizationId, filtered.map((c: any) => String(c.id)));
    }
    if (options?.segmentId) {
      const segment = await this.segmentsSvc().findSegment(organizationId, options.segmentId);
      filtered = filtered.filter((c: any) =>
        segmentMatches(segment.criteria ?? {}, segmentFactsOf(c, stats?.get(String(c.id)))));
    }
    if (type === "first" || type === "repeat") {
      filtered = filtered.filter((c: any) => {
        const isRepeat = stats?.get(String(c.id))?.isRepeat ?? false;
        // first = NOT repeat (soldOrderCount < 2, incl. zero).
        return type === "repeat" ? isRepeat : !isRepeat;
      });
    }
    const page = filtered.slice(0, limit);
    if (!stats) {
      stats = await computeCustomerOrderStats(this.prisma as any, organizationId, page.map((c: any) => String(c.id)));
    }
    const withStats = page.map((c: any) => {
      const s = stats!.get(String(c.id));
      return {
        id: c.id, name: customerName(c), firstName: c.firstName, lastName: c.lastName,
        phone: c.phone, email: c.email, source: c.source, createdAt: c.createdAt,
        // CRM C4: carried through so the export can append def columns.
        customFields: c.customFields ?? null,
        // EC24d: wholesale flag for the customers list/toggle.
        isWholesale: !!c.isWholesale,
        // GB6 (GC15): CRM depth on the row — tags/VIP/block are
        // staff-facing list data; notes stay detail-only.
        tags: customerTagsOf(c),
        isVip: !!c.isVip,
        isBlocked: !!c.isBlocked,
        orderCount: s?.orderCount ?? 0,
        totalSpentMinor: String(s?.totalSpentMinor ?? 0n),
        // GB6: EC33 sold bucket (delivered-proven orders only).
        soldOrderCount: s?.soldOrderCount ?? 0,
        lifetimeValueMinor: String(s?.lifetimeValueMinor ?? 0n),
        aovMinor: s?.aovMinor ?? null,
        isRepeat: s?.isRepeat ?? false,
      };
    });
    // ON7 (additive): per-row due for the PAGE's customers (bulk,
    // two queries) + the credit limit, serialized as string|null.
    const dueByCustomer = await this.dueMinorByCustomer(organizationId, page.map((c: any) => String(c.id))).catch(() => new Map<string, bigint>());
    return withStats.map((row: any, i: number) => ({
      ...row,
      dueMinor: String(dueByCustomer.get(String(row.id)) ?? 0n),
      creditLimitMinor: page[i]?.creditLimitMinor != null ? String(page[i].creditLimitMinor) : null,
      // AB5 (AX7): B2B group + net terms on the list row.
      groupId: page[i]?.groupId ?? null,
      creditTermsDays: Number(page[i]?.creditTermsDays ?? 0) || 0,
    }));
  }

  /**
   * CRM C3: CSV export — strictly the caller's org, same rows and
   * lifetime figures as the list (orders excluding cancelled).
   * `total_spent` is in taka (major units). CRM C4 appends the
   * org's custom-field columns after the core columns.
   */
  async exportCsv(organizationId: string): Promise<string> {
    const rows = await this.rowsWithStats(organizationId, undefined, 500);
    const headers = ["id", "name", "first_name", "last_name", "phone", "email", "source", "order_count", "total_spent", "created_at"];
    const body = rows.map((c: any) => [
      c.id, c.name ?? "", c.firstName ?? "", c.lastName ?? "", c.phone ?? "", c.email ?? "",
      c.source, c.orderCount, minorToMajor(BigInt(c.totalSpentMinor)),
      c.createdAt ? new Date(c.createdAt).toISOString() : "",
    ]);
    // CRM C4: the org's non-archived customer custom fields are
    // appended as extra columns, headered by LABEL, in def order.
    if (this.customFields) {
      const defs = await this.customFields.activeDefs(organizationId, "customer");
      if (defs.length) {
        headers.push(...defs.map((d: any) => d.label));
        body.forEach((row: any[], i: number) => {
          const cf = (rows[i] as any).customFields ?? {};
          for (const d of defs as any[]) row.push(renderCustomFieldValue(cf[d.key]));
        });
      }
    }
    return toCsv(headers, body);
  }

  /**
   * CRM C4: the customer PATCH that did not exist before — contact
   * basics + custom fields, nothing else. Before C4 customers were
   * write-only-by-sync (orders/inbox/convert created them; the UI
   * could only merge). Custom-field values go through the same
   * validation gate as leads; required is NOT enforced here
   * (partial updates; customers are born from sync, not forms).
   * Audited as "customer.updated" with the changed field names.
   */
  async update(organizationId: string, actorId: string, customerId: string, dto: {
    firstName?: string | null; lastName?: string | null;
    email?: string | null; phone?: string | null;
    customFields?: Record<string, unknown> | null;
    /** EC24d: staff-set wholesale flag. */
    isWholesale?: boolean;
    /** ON7: credit limit in minor units. String = set, null = clear. */
    creditLimitMinor?: string | null;
    /** GB6 (GC15): staff tags — wholesale REPLACE (null clears). */
    tags?: string[] | null;
    /** GB6 (GC15): STAFF-ONLY internal note (null clears). */
    notes?: string | null;
    /** GB6 (GC15): VIP flag. */
    isVip?: boolean;
    /** GB6 (GC15): record-level block (checkout gate enforces). */
    isBlocked?: boolean;
    /** GB6 (GC15): staff-only block reason (null clears). */
    blockedReason?: string | null;
    /** AB5 (AX7): B2B customer group id (null clears). */
    groupId?: string | null;
    /** AB5 (AX7): net terms in days, 0..90. */
    creditTermsDays?: number;
  }) {
    const customer = await (this.prisma as any).customer.findFirst({ where: { id: customerId, organizationId } });
    if (!customer) throw new NotFoundException("Customer not found in this organization");
    const data: Record<string, unknown> = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName?.trim() || null;
    if (dto.lastName !== undefined) data.lastName = dto.lastName?.trim() || null;
    if (dto.email !== undefined) data.email = dto.email?.trim().toLowerCase() || null;
    if (dto.phone !== undefined) data.phone = dto.phone?.trim() || null;
    if (dto.isWholesale !== undefined) data.isWholesale = !!dto.isWholesale;
    // AB5 (AX7): B2B group + net terms. groupId must name a
    // group OF THIS ORG (null clears); creditTermsDays is any
    // integer 0..90 (UI vocabulary 0|7|14|30).
    if (dto.groupId !== undefined) {
      if (dto.groupId === null || dto.groupId === "") {
        data.groupId = null;
      } else {
        const groupTable = (this.prisma as any).customerGroup;
        const group = groupTable?.findFirst
          ? await groupTable.findFirst({ where: { id: String(dto.groupId), organizationId } }).catch(() => null)
          : null;
        if (!group) {
          throw new BadRequestException("কাস্টমার গ্রুপটি পাওয়া যায়নি — এই সংস্থার একটি গ্রুপ বেছে নিন");
        }
        data.groupId = String(dto.groupId);
      }
    }
    if (dto.creditTermsDays !== undefined) {
      const terms = Number(dto.creditTermsDays);
      if (!Number.isInteger(terms) || terms < 0 || terms > 90) {
        throw new BadRequestException("ক্রেডিটের মেয়াদ ০–৯০ দিনের মধ্যে একটি পূর্ণসংখ্যা হতে হবে");
      }
      data.creditTermsDays = terms;
    }
    if (dto.creditLimitMinor !== undefined) {
      if (dto.creditLimitMinor === null) {
        data.creditLimitMinor = null;
      } else {
        const raw = String(dto.creditLimitMinor).trim();
        if (!/^\d+$/.test(raw)) {
          throw new BadRequestException("ক্রেডিট লিমিট সঠিক নয় — creditLimitMinor অবশ্যই শূন্য বা তার বেশি একটি পূর্ণসংখ্যা (পয়সায়) হতে হবে, অথবা লিমিট মুছতে null দিন।");
        }
        data.creditLimitMinor = BigInt(raw);
      }
    }
    if (dto.customFields !== undefined) {
      if (dto.customFields === null) data.customFields = null;
      else if (this.customFields) {
        const sanitized = await this.customFields.validateAndSanitize(organizationId, "customer", dto.customFields, { forCreate: false });
        data.customFields = this.customFields.mergeValues(customer.customFields ?? null, sanitized);
      } else if (Object.keys(dto.customFields).length) {
        throw new BadRequestException("Custom fields are not available in this deployment");
      }
    }
    // GB6 (GC15): CRM depth. Each change gets its OWN audit
    // action, and the metadata NEVER carries content: tags log
    // only the count, notes only the length, the block only the
    // flag — never the note text or the block reason.
    const gb6Audits: { action: string; metadata: Record<string, unknown> }[] = [];
    if (dto.tags !== undefined) {
      if (dto.tags === null) {
        data.tags = [];
        gb6Audits.push({ action: "customer.tags_updated", metadata: { count: 0 } });
      } else {
        // Wholesale REPLACE with the OrdersService.setTags
        // discipline: array of at most 10 tags, each trimmed
        // 1..30 chars, deduped; anything else is a 400.
        if (!Array.isArray(dto.tags)) throw new BadRequestException("tags একটি তালিকা (array) হতে হবে");
        if (dto.tags.length > 10) throw new BadRequestException("সর্বোচ্চ ১০টি ট্যাগ দেওয়া যাবে");
        const tags: string[] = [];
        for (const raw of dto.tags) {
          const tag = String(raw ?? "").trim();
          if (tag.length < 1 || tag.length > 30) {
            throw new BadRequestException("প্রতিটি ট্যাগ ১–৩০ অক্ষরের হতে হবে");
          }
          if (!tags.includes(tag)) tags.push(tag);
        }
        data.tags = tags;
        gb6Audits.push({ action: "customer.tags_updated", metadata: { count: tags.length } });
      }
    }
    if (dto.notes !== undefined) {
      if (dto.notes === null) {
        data.notes = null;
        gb6Audits.push({ action: "customer.notes_updated", metadata: { length: 0 } });
      } else {
        const notes = String(dto.notes);
        if (notes.length > 10000) throw new BadRequestException("নোট সর্বোচ্চ ১০,০০০ অক্ষরের হতে হবে");
        data.notes = notes;
        gb6Audits.push({ action: "customer.notes_updated", metadata: { length: notes.length } });
      }
    }
    if (dto.isVip !== undefined) {
      data.isVip = !!dto.isVip;
      gb6Audits.push({ action: "customer.vip_updated", metadata: { isVip: data.isVip } });
    }
    if (dto.isBlocked !== undefined) {
      data.isBlocked = !!dto.isBlocked;
      // Clearing the block also clears the (staff-only) reason.
      if (!data.isBlocked) data.blockedReason = null;
      gb6Audits.push({ action: "customer.block_updated", metadata: { isBlocked: data.isBlocked } });
    }
    if (dto.blockedReason !== undefined && data.isBlocked !== false) {
      if (dto.blockedReason === null) {
        data.blockedReason = null;
      } else {
        const reason = String(dto.blockedReason).trim();
        if (reason.length > 300) throw new BadRequestException("ব্লকের কারণ সর্বোচ্চ ৩০০ অক্ষরের হতে হবে");
        data.blockedReason = reason || null;
      }
    }
    if (!Object.keys(data).length) return this.detail(organizationId, customerId);
    await (this.prisma as any).customer.update({ where: { id: customerId }, data });
    // The classic "customer.updated" audit covers only the
    // pre-GB6 fields; GB6 fields audit under their own actions.
    const classicFields = Object.keys(data).filter((k) => !["tags", "notes", "isVip", "isBlocked", "blockedReason"].includes(k));
    if (classicFields.length) {
      await this.audit.log({
        organizationId, userId: actorId, action: "customer.updated", entityType: "Customer", entityId: customerId,
        metadata: { fields: classicFields },
      });
    }
    for (const entry of gb6Audits) {
      await this.audit.log({
        organizationId, userId: actorId, action: entry.action, entityType: "Customer", entityId: customerId,
        metadata: entry.metadata,
      });
    }
    return this.detail(organizationId, customerId);
  }

  /**
   * ON7 — Customer খাতা (ledger): the customer's orders (newest
   * first, page of 100) with EC19 per-order paid/due, the total
   * OPEN due over ALL of the customer's orders (bounded scan of
   * 1000, honestly flagged when truncated), its aging buckets,
   * and the credit-limit view (limit / over-limit / available
   * credit — available may go negative; the true signed value is
   * returned, never floored).
   */
  async getKhata(organizationId: string, customerId: string, opts?: { overdueOnly?: boolean }) {
    const customer = await (this.prisma as any).customer.findFirst({ where: { id: customerId, organizationId } });
    if (!customer) throw new NotFoundException("এই সংগঠনে কাস্টমার পাওয়া যায়নি।");
    const effective = (o: any) => new Date(o.placedAt ?? o.createdAt ?? 0).getTime();

    // Page: newest first by effective date (placedAt, createdAt
    // fallback). Fetch 101 so the truncation flag is exact.
    const pageRaw: any[] = ((await (this.prisma as any).order.findMany({
      where: { organizationId, customerId, isPractice: false },
      orderBy: { placedAt: "desc" }, take: 101,
    }).catch(() => [])) ?? []);
    const sortedPage = [...pageRaw].sort((a: any, b: any) => effective(b) - effective(a));
    const ordersTruncated = sortedPage.length > 100;
    const page = sortedPage.slice(0, 100);

    // Total due: ALL open orders of the customer (not just the
    // page), bounded at 1000 with an honest truncation flag.
    const openRaw: any[] = ((await (this.prisma as any).order.findMany({
      where: {
        organizationId, customerId, isPractice: false,
        status: { notIn: OPEN_DUE_EXCLUDED },
      },
      take: 1001,
    }).catch(() => [])) ?? []);
    const duesTruncated = openRaw.length > 1000;
    const openOrders = openRaw.slice(0, 1000);

    // ONE grouped approved-PV sum covering page + open scan.
    const allIds = [...new Set([...page, ...openOrders].map((o: any) => String(o.id)))];
    const sums = await this.approvedSumsByOrder(organizationId, allIds);

    // AB5 (AX7): per-order credit due date + overdue flag. An
    // order is overdue when it still has due > 0 AND its
    // creditDueDate (the net-terms snapshot stamped at
    // placement) is before the START of today, Asia/Dhaka —
    // an order due today is not yet overdue.
    const dhakaTodayStart = dhakaDayStartUtc(new Date());
    const pageOrders = page.map((o: any) => {
      const total = bigOrZero(o.totalMinor ?? 0);
      const paidRaw = sums.get(String(o.id)) ?? 0n;
      const paid = paidRaw > total ? total : paidRaw;
      const due = total - paid;
      const creditDueDate = o.creditDueDate ? new Date(o.creditDueDate) : null;
      const overdue =
        due > 0n && creditDueDate != null && !Number.isNaN(creditDueDate.getTime()) && creditDueDate.getTime() < dhakaTodayStart.getTime();
      return {
        id: String(o.id),
        number: o.externalNumber ?? o.externalId ?? String(o.id),
        placedAt: o.placedAt ?? o.createdAt ?? null,
        status: o.status, source: o.source,
        totalMinor: String(total),
        paidMinor: String(paid),
        dueMinor: String(due),
        creditDueDate: creditDueDate && !Number.isNaN(creditDueDate.getTime()) ? creditDueDate.toISOString() : null,
        overdue,
      };
    });
    // AB5 (AX7): overdueOnly narrows the PAGE orders to the
    // overdue ones; totals/aging below stay over ALL orders.
    const orders = opts?.overdueOnly ? pageOrders.filter((o: any) => o.overdue) : pageOrders;

    let totalDue = 0n;
    const aging = { d0_7: 0n, d8_15: 0n, d16_30: 0n, d30plus: 0n };
    const now = Date.now();
    for (const o of openOrders) {
      const due = this.dueOfOrder(o, sums);
      if (due <= 0n) continue;
      totalDue += due;
      const ageDays = Math.max(0, Math.floor((now - effective(o)) / 86400000));
      if (ageDays <= 7) aging.d0_7 += due;
      else if (ageDays <= 15) aging.d8_15 += due;
      else if (ageDays <= 30) aging.d16_30 += due;
      else aging.d30plus += due;
    }

    const limit: bigint | null = customer.creditLimitMinor != null ? bigOrZero(customer.creditLimitMinor) : null;
    return {
      customerId: String(customer.id),
      // AB5 (AX7): the customer's net terms (days) — existing
      // fields below are unchanged.
      creditTermsDays: Number(customer.creditTermsDays ?? 0) || 0,
      orders,
      ordersTruncated,
      duesTruncated,
      totalDueMinor: String(totalDue),
      aging: {
        d0_7: String(aging.d0_7), d8_15: String(aging.d8_15),
        d16_30: String(aging.d16_30), d30plus: String(aging.d30plus),
      },
      creditLimitMinor: limit != null ? String(limit) : null,
      overLimit: limit != null && totalDue > limit,
      availableCreditMinor: limit != null ? String(limit - totalDue) : null,
    };
  }

  async detail(organizationId: string, customerId: string) {
    const customer = await (this.prisma as any).customer.findFirst({ where: { id: customerId, organizationId } });
    if (!customer) throw new NotFoundException("Customer not found in this organization");
    const orders = await (this.prisma as any).order.findMany({
      where: { organizationId, customerId }, orderBy: { createdAt: "desc" }, take: 50,
    });
    const conversations = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, customerId }, orderBy: { lastMessageAt: "desc" }, take: 20,
    }).catch(() => []);
    const shipments = orders.length ? await (this.prisma as any).courierShipment.findMany({
      where: { organizationId, orderId: { in: orders.map((o: any) => o.id) } }, take: 20,
    }).catch(() => []) : [];
    const lead = customer.id ? await (this.prisma as any).lead.findFirst({
      where: { organizationId, customerId },
    }).catch(() => null) : null;
    const activeOrders = orders.filter((o: any) => o.status !== "cancelled");
    // M50: return-risk summary for this customer (own org rows only).
    let risk: any = null;
    if (this.risk) {
      try { risk = await this.risk.forCustomer(organizationId, customer); } catch { risk = null; }
    }
    // CX1: courier delivery record (delivery success rate +
    // per-courier split) — an additive sibling of the risk block,
    // computed by the same RiskService from the same history. It
    // degrades to null exactly like the risk block does.
    let courierRecord: any = null;
    if (this.risk) {
      try { courierRecord = await this.risk.courierRecordForCustomer(organizationId, customer.id); } catch { courierRecord = null; }
    }
    // EC6: per-store identities for this customer (guarded — the
    // table is optional in older deployments / fakes).
    let storeIdentities: any[] = [];
    try {
      const table = (this.prisma as any).customerStoreIdentity;
      if (table?.findMany) {
        const rows = await table.findMany({ where: { customerId } });
        const ids = [...new Set((rows ?? []).map((r: any) => r.storeId).filter(Boolean))];
        const nameById = new Map<string, string | null>();
        if (ids.length) {
          const stores = await (this.prisma as any).store.findMany({ where: { organizationId, id: { in: ids } } });
          for (const s of stores ?? []) nameById.set(s.id, s.name ?? null);
        }
        storeIdentities = (rows ?? []).map((r: any) => ({ ...r, storeName: nameById.get(r.storeId) ?? null }));
      }
    } catch { storeIdentities = []; }
    return {
      risk,
      courierRecord,
      storeIdentities,
      customer: {
        ...customer, name: customerName(customer),
        // GB6 (GC15): CRM depth, explicit — tags normalized to
        // an array; notes/blockedReason are staff-only and live
        // ONLY on this staff detail payload.
        tags: customerTagsOf(customer),
        notes: customer.notes ?? null,
        isVip: !!customer.isVip,
        isBlocked: !!customer.isBlocked,
        blockedReason: customer.blockedReason ?? null,
        // ON7: BigInt serialized as string|null (additive field).
        creditLimitMinor: customer.creditLimitMinor != null ? String(customer.creditLimitMinor) : null,
        // AB5 (AX7): B2B group + net terms (also on the spread
        // above; made explicit so older rows read as null / 0).
        groupId: customer.groupId ?? null,
        creditTermsDays: Number(customer.creditTermsDays ?? 0) || 0,
      },
      orders: orders.map((o: any) => ({
        ...o,
        totalMinor: String(o.totalMinor), subtotalMinor: String(o.subtotalMinor ?? o.totalMinor),
        shippingMinor: String(o.shippingMinor ?? 0), discountMinor: String(o.discountMinor ?? 0),
        taxMinor: String(o.taxMinor ?? 0), refundedMinor: String(o.refundedMinor ?? 0),
      })),
      conversations: conversations.map((c: any) => ({
        id: c.id, channel: c.channel, status: c.status, contactName: c.contactName,
        lastMessagePreview: c.lastMessagePreview, lastMessageAt: c.lastMessageAt, unreadCount: c.unreadCount,
      })),
      shipments: shipments.map((s: any) => ({ ...s, codAmountMinor: String(s.codAmountMinor) })),
      lead: lead ? { id: lead.id, stage: lead.stage, source: lead.source } : null,
      lifetime: {
        orderCount: activeOrders.length,
        totalSpentMinor: String(activeOrders.reduce((s: bigint, o: any) => s + BigInt(o.totalMinor), 0n)),
        currency: activeOrders[0]?.currency ?? orders[0]?.currency ?? "BDT",
      },
    };
  }

  async merge(organizationId: string, actorId: string, dto: { sourceId: string; targetId: string }) {
    if (dto.sourceId === dto.targetId) throw new BadRequestException("Source and target must differ");
    const source = await (this.prisma as any).customer.findFirst({ where: { id: dto.sourceId, organizationId } });
    const target = await (this.prisma as any).customer.findFirst({ where: { id: dto.targetId, organizationId } });
    if (!source || !target) throw new NotFoundException("Customer not found in this organization");
    if (source.mergedIntoId) throw new BadRequestException("Source customer was already merged");
    if (target.mergedIntoId) throw new BadRequestException("Target customer was itself merged into another record");
    const orders = await (this.prisma as any).order.findMany({ where: { organizationId, customerId: source.id }, take: 1000 });
    for (const o of orders) {
      await (this.prisma as any).order.update({ where: { id: o.id }, data: { customerId: target.id } });
    }
    const conversations = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, customerId: source.id }, take: 200,
    }).catch(() => []);
    for (const c of conversations) {
      await (this.prisma as any).channelConversation.update({ where: { id: c.id }, data: { customerId: target.id } });
    }
    // EC6: carry store identities — move source rows to the target
    // unless the target already has an identity for the same store
    // (target's wins; the source row is removed). Guarded like
    // other optional tables: a missing table skips silently.
    let identitiesMoved = 0;
    let identityConflicts = 0;
    try {
      const table = (this.prisma as any).customerStoreIdentity;
      if (table?.findMany) {
        const rows = await table.findMany({ where: { customerId: source.id } });
        for (const row of rows ?? []) {
          let targetExisting: any = null;
          if (typeof table.findFirst === "function") {
            targetExisting = await table.findFirst({ where: { customerId: target.id, storeId: row.storeId } });
          } else {
            const targetRows = await table.findMany({ where: { customerId: target.id, storeId: row.storeId } });
            targetExisting = (targetRows ?? [])[0] ?? null;
          }
          if (targetExisting) {
            if (typeof table.delete === "function") await table.delete({ where: { id: row.id } });
            else if (typeof table.deleteMany === "function") await table.deleteMany({ where: { id: row.id } });
            identityConflicts++;
          } else {
            await table.update({ where: { id: row.id }, data: { customerId: target.id } });
            identitiesMoved++;
          }
        }
      }
    } catch { /* optional table — skip silently */ }
    // Fill gaps on the survivor from the source (never overwrite).
    const fill: any = {};
    if (!target.phone && source.phone) fill.phone = source.phone;
    if (!target.email && source.email) fill.email = source.email;
    if (!target.firstName && source.firstName) fill.firstName = source.firstName;
    if (!target.lastName && source.lastName) fill.lastName = source.lastName;
    // CRM C4: custom fields gap-fill per key, same discipline.
    if (this.customFields) {
      const filled = this.customFields.fillGaps(target.customFields ?? null, source.customFields ?? null);
      if (Object.keys(filled).length || target.customFields) fill.customFields = filled;
    }
    // IN2: remember, per filled field, the survivor's pre-merge
    // value and the value filled in — unmerge restores a field
    // only when it still holds exactly the filled value.
    const filledFields: Record<string, { before: unknown; filledWith: unknown }> = {};
    for (const field of Object.keys(fill)) {
      filledFields[field] = { before: (target as any)[field] ?? null, filledWith: fill[field] ?? null };
    }
    if (Object.keys(fill).length) await (this.prisma as any).customer.update({ where: { id: target.id }, data: fill });
    await (this.prisma as any).customer.update({ where: { id: source.id }, data: { mergedIntoId: target.id } });
    // IN2: the reversible merge record (moved row ids + the
    // gap-fill snapshot). Guarded: on a deployment whose IN2
    // migration has not run yet the delegate is absent/failing and
    // the merge keeps its pre-IN2 behaviour — but such a merge is
    // then honestly NOT unmergeable (no record exists).
    const mrt = (this.prisma as any).customerMergeRecord;
    if (mrt?.create) {
      await mrt.create({
        data: {
          organizationId, sourceCustomerId: source.id, targetCustomerId: target.id,
          movedOrderIds: orders.map((o: any) => o.id),
          movedConversationIds: conversations.map((c: any) => c.id),
          filledFields, createdByUserId: actorId,
        },
      }).catch(() => undefined);
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "customer.merged", entityType: "Customer", entityId: target.id,
      metadata: { sourceId: source.id, ordersMoved: orders.length, conversationsMoved: conversations.length, identitiesMoved, identityConflicts },
    });
    return this.detail(organizationId, target.id);
  }

  /**
   * IN2: non-reverted merge records where this customer was the
   * SURVIVOR — the inbox context panel's "merged records" list
   * with its undo affordance. Empty when the IN2 delegate is
   * unavailable (pre-migration deployment) — never an error.
   */
  async listMergeRecords(organizationId: string, targetCustomerId: string) {
    const mrt = (this.prisma as any).customerMergeRecord;
    if (!mrt?.findMany) return [];
    const rows = await mrt.findMany({
      where: { organizationId, targetCustomerId }, orderBy: { createdAt: "desc" }, take: 20,
    }).catch(() => []);
    const active = (rows as any[]).filter((r) => !r.revertedAt);
    const out: any[] = [];
    for (const r of active) {
      const source = await (this.prisma as any).customer.findFirst({
        where: { id: r.sourceCustomerId, organizationId },
      }).catch(() => null);
      out.push({
        id: r.id, sourceCustomerId: r.sourceCustomerId, targetCustomerId: r.targetCustomerId,
        sourceName: source ? customerName(source) : null, sourcePhone: source?.phone ?? null,
        ordersMoved: Array.isArray(r.movedOrderIds) ? r.movedOrderIds.length : 0,
        conversationsMoved: Array.isArray(r.movedConversationIds) ? r.movedConversationIds.length : 0,
        createdAt: r.createdAt, createdByUserId: r.createdByUserId,
      });
    }
    return out;
  }

  /**
   * IN2: undo an agent-confirmed merge — the exact inverse of
   * merge(), driven by the CustomerMergeRecord the merge wrote:
   *  - orders/conversations move back to the source ONLY when
   *    they still point at the survivor (a row a human has since
   *    re-pointed elsewhere is never stolen back);
   *  - a gap-filled survivor field is restored to its pre-merge
   *    value ONLY when it still holds the filled value (a later
   *    human edit is never clobbered);
   *  - the source's mergedIntoId clears and the record is marked
   *    reverted, so the same merge can never be reverted twice.
   * Nothing is deleted at any point. Audited both ways.
   * Merges made before IN2 (or while the IN2 migration had not
   * run) have no record and are honestly refused here — they
   * stay merged rather than being half-undone by guessing.
   */
  async unmerge(organizationId: string, actorId: string, dto: { sourceId: string }) {
    const source = await (this.prisma as any).customer.findFirst({ where: { id: dto.sourceId, organizationId } });
    if (!source) throw new NotFoundException("Customer not found in this organization");
    if (!source.mergedIntoId) throw new BadRequestException("এই Customer রেকর্ডটি কারো সাথে মার্জ করা নেই — undo করার কিছু নেই।");
    const mrt = (this.prisma as any).customerMergeRecord;
    if (!mrt?.findMany) throw new BadRequestException("এই মার্জটি IN2-এর আগের — কোনো merge record নেই, তাই স্বয়ংক্রিয়ভাবে undo করা যাবে না।");
    const records = await mrt.findMany({
      where: { organizationId, sourceCustomerId: source.id }, orderBy: { createdAt: "desc" }, take: 20,
    }).catch(() => []);
    const record = (records as any[]).find((r) => !r.revertedAt && r.targetCustomerId === source.mergedIntoId);
    if (!record) throw new BadRequestException("এই মার্জটি IN2-এর আগের — কোনো merge record নেই, তাই স্বয়ংক্রিয়ভাবে undo করা যাবে না।");
    const target = await (this.prisma as any).customer.findFirst({ where: { id: record.targetCustomerId, organizationId } });
    if (!target) throw new NotFoundException("Surviving customer not found in this organization");

    let ordersRestored = 0;
    for (const oid of (Array.isArray(record.movedOrderIds) ? record.movedOrderIds : [])) {
      const o = await (this.prisma as any).order.findFirst({ where: { id: oid, organizationId } }).catch(() => null);
      if (o && o.customerId === target.id) {
        await (this.prisma as any).order.update({ where: { id: o.id }, data: { customerId: source.id } });
        ordersRestored++;
      }
    }
    let conversationsRestored = 0;
    for (const cid of (Array.isArray(record.movedConversationIds) ? record.movedConversationIds : [])) {
      const c = await (this.prisma as any).channelConversation.findFirst({ where: { id: cid, organizationId } }).catch(() => null);
      if (c && c.customerId === target.id) {
        await (this.prisma as any).channelConversation.update({ where: { id: c.id }, data: { customerId: source.id } });
        conversationsRestored++;
      }
    }
    const filled = (record.filledFields && typeof record.filledFields === "object") ? record.filledFields : {};
    const restore: Record<string, unknown> = {};
    const fieldsRestored: string[] = [];
    for (const [field, snap] of Object.entries(filled as Record<string, any>)) {
      if (!snap || typeof snap !== "object" || !("filledWith" in snap)) continue;
      const current = (target as any)[field] ?? null;
      if (JSON.stringify(current) === JSON.stringify(snap.filledWith ?? null)) {
        restore[field] = snap.before ?? null;
        fieldsRestored.push(field);
      }
    }
    if (Object.keys(restore).length) {
      await (this.prisma as any).customer.update({ where: { id: target.id }, data: restore });
    }
    await (this.prisma as any).customer.update({ where: { id: source.id }, data: { mergedIntoId: null } });
    await mrt.update({
      where: { id: record.id },
      data: { revertedAt: new Date(), revertedByUserId: actorId },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "customer.unmerged", entityType: "Customer", entityId: source.id,
      metadata: { targetId: target.id, mergeRecordId: record.id, ordersRestored, conversationsRestored, fieldsRestored },
    });
    return {
      sourceId: source.id, targetId: target.id, mergeRecordId: record.id,
      ordersRestored, conversationsRestored, fieldsRestored,
    };
  }
}
