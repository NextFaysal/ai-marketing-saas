import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { isSoldOrder } from "../storefront/ec27-discovery";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * GB6 (GC15) — CRM segments + the shared customer statistics
 * both the customers list and segment membership use.
 *
 * Facts discipline (one computation, two consumers):
 *  - orderCount / totalSpentMinor keep the C3 labelled meaning
 *    ("orders excluding cancelled") — computed with ONE
 *    order.groupBy over the customer id set, with the
 *    approvedSumsByOrder-style findMany fallback for delegates
 *    without groupBy (partial deployments / spec fakes).
 *  - soldOrderCount / lifetimeValueMinor / aovMinor / isRepeat
 *    use the canonical EC33 sold definition (isSoldOrder from
 *    ec27-discovery): not dead AND (completed/delivered status
 *    OR a delivered-family CourierShipment). Practice orders
 *    never count as sold.
 */

export interface CustomerOrderStats {
  orderCount: number;
  totalSpentMinor: bigint;
  soldOrderCount: number;
  lifetimeValueMinor: bigint;
  aovMinor: string | null;
  isRepeat: boolean;
}

const EMPTY_STATS: CustomerOrderStats = {
  orderCount: 0, totalSpentMinor: 0n, soldOrderCount: 0,
  lifetimeValueMinor: 0n, aovMinor: null, isRepeat: false,
};

function bigOrZero(v: unknown): bigint {
  try { return BigInt(v as any); } catch { return 0n; }
}

/** Stored customer tags (Json string array) normalized to a
 * plain string array — anything else reads as no tags. */
export function customerTagsOf(customer: any): string[] {
  const raw = customer?.tags;
  if (!Array.isArray(raw)) return [];
  return raw.map((t: any) => String(t ?? "").trim()).filter((t: string) => t.length > 0);
}

/** The facts a segment criterion (and the list filters) read. */
export interface SegmentFacts {
  tags: string[];
  isVip: boolean;
  isRepeat: boolean;
  lifetimeValueMinor: bigint;
  district: string | null;
}

export function segmentFactsOf(customer: any, stats?: CustomerOrderStats | null): SegmentFacts {
  const s = stats ?? EMPTY_STATS;
  const address = customer?.address && typeof customer.address === "object" ? customer.address : null;
  const districtRaw = address?.district != null ? String(address.district).trim() : "";
  return {
    tags: customerTagsOf(customer),
    isVip: !!customer?.isVip,
    isRepeat: s.isRepeat,
    lifetimeValueMinor: s.lifetimeValueMinor,
    district: districtRaw || null,
  };
}

/**
 * Grouped + sold-bucket statistics for a set of customers:
 * ONE groupBy (fallback: ONE findMany), ONE sold-scan findMany
 * and ONE shipment findMany — never per-customer queries.
 * Failure-isolated: any failing leg degrades to zeroes for
 * that leg instead of breaking the customers list.
 */
export async function computeCustomerOrderStats(
  prisma: any,
  organizationId: string,
  customerIds: string[],
): Promise<Map<string, CustomerOrderStats>> {
  const out = new Map<string, CustomerOrderStats>();
  const ids = [...new Set(customerIds.map(String))];
  for (const id of ids) out.set(id, { ...EMPTY_STATS });
  if (!ids.length) return out;
  const orderTable = prisma?.order;
  if (!orderTable) return out;

  // --- Labelled figures: orders excluding cancelled (groupBy).
  let groupedDone = false;
  try {
    if (typeof orderTable.groupBy === "function") {
      const rows = await orderTable.groupBy({
        by: ["customerId"],
        where: { organizationId, customerId: { in: ids }, status: { not: "cancelled" } },
        _count: { _all: true },
        _sum: { totalMinor: true },
      });
      for (const r of rows ?? []) {
        if (r?.customerId == null) continue;
        const entry = out.get(String(r.customerId));
        if (!entry) continue;
        entry.orderCount = typeof r._count === "number" ? r._count : Number(r._count?._all ?? 0);
        entry.totalSpentMinor = bigOrZero(r._sum?.totalMinor ?? 0);
      }
      groupedDone = true;
    }
  } catch { /* fall through to the findMany path */ }
  if (!groupedDone) {
    try {
      const rows: any[] = ((await orderTable.findMany({
        where: { organizationId, customerId: { in: ids } },
      }).catch(() => [])) ?? []);
      const wanted = new Set(ids);
      for (const o of rows) {
        if (o?.customerId == null || !wanted.has(String(o.customerId))) continue;
        if (String(o.status) === "cancelled") continue;
        const entry = out.get(String(o.customerId));
        if (!entry) continue;
        entry.orderCount += 1;
        entry.totalSpentMinor += bigOrZero(o.totalMinor ?? 0);
      }
    } catch { /* advisory math only */ }
  }

  // --- Sold bucket (EC33 definition via isSoldOrder).
  try {
    const orders: any[] = ((await orderTable.findMany({
      where: { organizationId, customerId: { in: ids }, isPractice: false },
      select: { id: true, customerId: true, status: true, totalMinor: true },
      take: 5000,
    }).catch(() => [])) ?? []);
    const wanted = new Set(ids);
    const mine = orders.filter((o: any) => o?.customerId != null && wanted.has(String(o.customerId)));
    const statusesByOrder = new Map<string, string[]>();
    const shipmentTable = prisma?.courierShipment;
    if (mine.length && shipmentTable?.findMany) {
      const shipments: any[] = ((await shipmentTable.findMany({
        where: { organizationId, orderId: { in: mine.map((o: any) => String(o.id)) } },
        select: { orderId: true, status: true },
      }).catch(() => [])) ?? []);
      for (const s of shipments) {
        if (s?.orderId == null) continue;
        const key = String(s.orderId);
        const list = statusesByOrder.get(key) ?? [];
        list.push(String(s.status ?? ""));
        statusesByOrder.set(key, list);
      }
    }
    for (const o of mine) {
      if (!isSoldOrder(o, statusesByOrder.get(String(o.id)) ?? [])) continue;
      const entry = out.get(String(o.customerId));
      if (!entry) continue;
      entry.soldOrderCount += 1;
      entry.lifetimeValueMinor += bigOrZero(o.totalMinor ?? 0);
    }
    for (const entry of out.values()) {
      entry.isRepeat = entry.soldOrderCount >= 2;
      entry.aovMinor = entry.soldOrderCount > 0
        ? String(entry.lifetimeValueMinor / BigInt(entry.soldOrderCount))
        : null;
    }
  } catch { /* sold bucket degrades to zeroes */ }
  return out;
}

// ================= Segment criteria =================

export const SEGMENT_CRITERIA_KEYS = ["tagsAny", "isVip", "isRepeat", "minSpentMinor", "district"] as const;

export interface SegmentCriteria {
  tagsAny?: string[];
  isVip?: boolean;
  isRepeat?: boolean;
  minSpentMinor?: string;
  district?: string;
}

/**
 * Validate + normalize raw segment criteria. Unknown top-level
 * keys are refused (a typo must never silently widen a segment);
 * tagsAny mirrors the customer-tag discipline (≤10, each
 * trimmed 1..30 chars, deduped); minSpentMinor must be a
 * non-negative integer string (minor units). Returns the
 * normalized criteria to store.
 */
export function validateSegmentCriteria(raw: unknown): SegmentCriteria {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw badRequest("customers.theSegmentCriteriaMustBeAn");
  }
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!(SEGMENT_CRITERIA_KEYS as readonly string[]).includes(key)) {
      throw badRequest("customers.unknownSegmentCriteriaAllowed", { key: key, p2: SEGMENT_CRITERIA_KEYS.join(", ") });
    }
  }
  const out: SegmentCriteria = {};
  if (input.tagsAny !== undefined) {
    if (!Array.isArray(input.tagsAny)) throw badRequest("customers.tagsanyMustBeAListArray");
    if (input.tagsAny.length > 10) throw badRequest("customers.atMost10TagsCanBe");
    const tags: string[] = [];
    for (const rawTag of input.tagsAny) {
      const tag = String(rawTag ?? "").trim();
      if (tag.length < 1 || tag.length > 30) throw badRequest("customers.eachTagInTagsanyMustBe");
      if (!tags.includes(tag)) tags.push(tag);
    }
    out.tagsAny = tags;
  }
  if (input.isVip !== undefined) {
    if (typeof input.isVip !== "boolean") throw badRequest("customers.isvipMustBeBoolean");
    out.isVip = input.isVip;
  }
  if (input.isRepeat !== undefined) {
    if (typeof input.isRepeat !== "boolean") throw badRequest("customers.isrepeatMustBeBoolean");
    out.isRepeat = input.isRepeat;
  }
  if (input.minSpentMinor !== undefined) {
    const rawMinor = String(input.minSpentMinor).trim();
    if (!/^\d+$/.test(rawMinor)) {
      throw badRequest("customers.minspentminorMustBeAnIntegerOf");
    }
    out.minSpentMinor = rawMinor;
  }
  if (input.district !== undefined) {
    const district = String(input.district ?? "").trim();
    if (!district || district.length > 100) throw badRequest("customers.districtMustBe1100Characters");
    out.district = district;
  }
  return out;
}

/** Pure evaluator: EVERY present criterion must match. */
export function segmentMatches(criteria: SegmentCriteria | null | undefined, facts: SegmentFacts): boolean {
  const c = (criteria ?? {}) as SegmentCriteria;
  if (c.tagsAny !== undefined) {
    if (!c.tagsAny.some((t) => facts.tags.includes(t))) return false;
  }
  if (c.isVip !== undefined && facts.isVip !== c.isVip) return false;
  if (c.isRepeat !== undefined && facts.isRepeat !== c.isRepeat) return false;
  if (c.minSpentMinor !== undefined) {
    let min: bigint;
    try { min = BigInt(c.minSpentMinor); } catch { return false; }
    if (facts.lifetimeValueMinor < min) return false;
  }
  if (c.district !== undefined) {
    if (!facts.district) return false;
    if (facts.district.trim().toLowerCase() !== String(c.district).trim().toLowerCase()) return false;
  }
  return true;
}

@Injectable()
export class CrmSegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private table(): any {
    return (this.prisma as any).crmSegment;
  }

  /** Org-scoped segment load; a foreign or missing id is a 404. */
  async findSegment(organizationId: string, segmentId: string): Promise<any> {
    const table = this.table();
    const row = table?.findFirst
      ? await table.findFirst({ where: { id: segmentId, organizationId } }).catch(() => null)
      : null;
    if (!row) throw notFound("customers.segmentNotFoundInThisOrganization");
    return row;
  }

  /** The org's customer window (same discipline as the
   * customers list: non-merged, newest first, bounded 500)
   * with stats + facts attached, keyed by customer id. */
  async factsByCustomer(organizationId: string, customers?: any[]): Promise<Map<string, SegmentFacts>> {
    const rows = customers ?? ((await (this.prisma as any).customer.findMany({
      where: { organizationId, mergedIntoId: null }, orderBy: { createdAt: "desc" }, take: 500,
    }).catch(() => [])) ?? []);
    const stats = await computeCustomerOrderStats(this.prisma as any, organizationId, rows.map((c: any) => String(c.id)));
    const out = new Map<string, SegmentFacts>();
    for (const c of rows) out.set(String(c.id), segmentFactsOf(c, stats.get(String(c.id))));
    return out;
  }

  /** Ids of the customers in the window matching the criteria
   * — THE shared evaluation behind list(segmentId) filtering
   * and segment memberCount. */
  async evaluateSegmentMembers(organizationId: string, criteria: SegmentCriteria, customers?: any[]): Promise<string[]> {
    const facts = await this.factsByCustomer(organizationId, customers);
    const matched: string[] = [];
    for (const [id, f] of facts.entries()) {
      if (segmentMatches(criteria, f)) matched.push(id);
    }
    return matched;
  }

  private serialize(segment: any, memberCount: number) {
    return {
      id: segment.id,
      organizationId: segment.organizationId,
      name: segment.name,
      criteria: segment.criteria ?? {},
      createdById: segment.createdById ?? null,
      createdAt: segment.createdAt,
      updatedAt: segment.updatedAt,
      memberCount,
    };
  }

  async listSegments(organizationId: string) {
    const table = this.table();
    if (!table?.findMany) return [];
    const rows: any[] = ((await table.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" },
    }).catch(() => [])) ?? []);
    if (!rows.length) return [];
    // Facts computed ONCE for the window, reused for every count.
    const facts = await this.factsByCustomer(organizationId);
    return rows.map((s: any) => {
      let count = 0;
      for (const f of facts.values()) if (segmentMatches(s.criteria ?? {}, f)) count++;
      return this.serialize(s, count);
    });
  }

  async createSegment(organizationId: string, actorId: string, dto: { name?: unknown; criteria?: unknown }) {
    const name = String(dto?.name ?? "").trim();
    if (!name || name.length > 120) throw badRequest("customers.theSegmentNameMustBe1");
    const criteria = validateSegmentCriteria(dto?.criteria ?? {});
    const table = this.table();
    if (!table?.create) throw badRequest("customers.segmentsAreNotAvailableInThis");
    const row = await table.create({ data: { organizationId, name, criteria, createdById: actorId } });
    const memberCount = (await this.evaluateSegmentMembers(organizationId, criteria)).length;
    await this.audit?.log({
      organizationId, userId: actorId, action: "customer.segment_created", entityType: "CrmSegment", entityId: row.id,
      metadata: { keys: Object.keys(criteria) },
    }).catch(() => undefined);
    return this.serialize(row, memberCount);
  }

  async updateSegment(organizationId: string, actorId: string, segmentId: string, dto: { name?: unknown; criteria?: unknown }) {
    const existing = await this.findSegment(organizationId, segmentId);
    const data: Record<string, unknown> = {};
    if (dto?.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name || name.length > 120) throw badRequest("customers.theSegmentNameMustBe1");
      data.name = name;
    }
    let criteria: SegmentCriteria = (existing.criteria ?? {}) as SegmentCriteria;
    if (dto?.criteria !== undefined) {
      criteria = validateSegmentCriteria(dto.criteria);
      data.criteria = criteria;
    }
    const row = Object.keys(data).length
      ? await this.table().update({ where: { id: existing.id }, data })
      : existing;
    const memberCount = (await this.evaluateSegmentMembers(organizationId, criteria)).length;
    await this.audit?.log({
      organizationId, userId: actorId, action: "customer.segment_updated", entityType: "CrmSegment", entityId: existing.id,
      metadata: { keys: Object.keys(criteria) },
    }).catch(() => undefined);
    return this.serialize(row, memberCount);
  }

  async deleteSegment(organizationId: string, actorId: string, segmentId: string) {
    const existing = await this.findSegment(organizationId, segmentId);
    const table = this.table();
    if (table?.delete) await table.delete({ where: { id: existing.id } });
    else if (table?.deleteMany) await table.deleteMany({ where: { id: existing.id, organizationId } });
    await this.audit?.log({
      organizationId, userId: actorId, action: "customer.segment_deleted", entityType: "CrmSegment", entityId: existing.id,
      metadata: { keys: Object.keys(existing.criteria ?? {}) },
    }).catch(() => undefined);
    return { deleted: true, id: existing.id };
  }
}
