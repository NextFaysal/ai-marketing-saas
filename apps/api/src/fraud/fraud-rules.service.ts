import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

/**
 * GB3 (GC9): basic merchant fraud rules (FraudRule) + their
 * firing ledger (FraudRuleHit). A rule fires when ALL present
 * conditions match. Condition vocabulary (known keys ONLY):
 *  - minTotalMinor: digit string, compared as BigInt
 *  - isCod: boolean equality
 *  - districtIn: string array (≤64), normalized compare
 *  - phoneOpenOrdersGte: int 1–100
 *  - minRiskScore: int 0–100 — POST-PLACEMENT ONLY; the
 *    checkout gate ignores it (no score exists yet there).
 * Actions: hold | tag | block_checkout (tag needs tagValue).
 */

export const FRAUD_RULE_ACTIONS = ["hold", "tag", "block_checkout"] as const;
const CONDITION_KEYS = ["minTotalMinor", "isCod", "districtIn", "phoneOpenOrdersGte", "minRiskScore"] as const;

export function normalizeDistrictName(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export interface FraudRuleFacts {
  totalMinor: bigint;
  isCod: boolean;
  district: string | null;
  openOrderCount: number;
  riskScore?: number | null;
}

/** ALL present conditions must match. At checkout
 * (atCheckout=true) minRiskScore is IGNORED — documented:
 * there is no risk score before placement, so a rule needs at
 * least one checkout-applicable condition present to match
 * there (a minRiskScore-only rule therefore never blocks a
 * checkout; it fires post-placement instead). A null district
 * never matches a districtIn condition. */
export function fraudRuleMatches(
  conditions: unknown,
  facts: FraudRuleFacts,
  opts: { atCheckout: boolean },
): boolean {
  const cond: any = conditions && typeof conditions === "object" && !Array.isArray(conditions)
    ? conditions
    : {};
  if (opts.atCheckout) {
    const applicable = CONDITION_KEYS.filter(
      (k) => k !== "minRiskScore" && cond[k] !== undefined && cond[k] !== null,
    );
    if (applicable.length === 0) return false;
  }
  if (cond.minTotalMinor !== undefined && cond.minTotalMinor !== null) {
    let min: bigint | null = null;
    try { min = BigInt(String(cond.minTotalMinor)); } catch { min = null; }
    if (min === null) return false;
    let total: bigint | null = null;
    try { total = BigInt(facts.totalMinor as any); } catch { total = null; }
    if (total === null || total < min) return false;
  }
  if (cond.isCod !== undefined && cond.isCod !== null) {
    if (Boolean(cond.isCod) !== Boolean(facts.isCod)) return false;
  }
  if (Array.isArray(cond.districtIn)) {
    if (!facts.district) return false;
    const wanted = cond.districtIn.map((d: unknown) => normalizeDistrictName(d)).filter(Boolean);
    if (!wanted.includes(normalizeDistrictName(facts.district))) return false;
  }
  if (cond.phoneOpenOrdersGte !== undefined && cond.phoneOpenOrdersGte !== null) {
    const n = Number(cond.phoneOpenOrdersGte);
    if (!Number.isFinite(n) || Number(facts.openOrderCount ?? 0) < n) return false;
  }
  if (!opts.atCheckout && cond.minRiskScore !== undefined && cond.minRiskScore !== null) {
    const n = Number(cond.minRiskScore);
    if (!Number.isFinite(n) || facts.riskScore === null || facts.riskScore === undefined) return false;
    if (Number(facts.riskScore) < n) return false;
  }
  return true;
}

/** Validate + normalize a conditions object; unknown keys and
 * malformed values are Bengali 400s. Returns a clean object
 * safe to store as Json. */
export function validateFraudRuleConditions(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequestException("শর্তগুলো একটি অবজেক্ট হতে হবে");
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(CONDITION_KEYS as readonly string[]).includes(key)) {
      throw new BadRequestException(`অজানা শর্ত: ${key}`);
    }
    if (value === undefined || value === null) continue;
    if (key === "minTotalMinor") {
      const s = typeof value === "number" && Number.isInteger(value) && value >= 0
        ? String(value)
        : String(value);
      if (!/^\d+$/.test(s)) {
        throw new BadRequestException("minTotalMinor সঠিক সংখ্যায় পাঠান (পয়সায়)");
      }
      out.minTotalMinor = s;
    } else if (key === "isCod") {
      if (typeof value !== "boolean") throw new BadRequestException("isCod boolean হতে হবে");
      out.isCod = value;
    } else if (key === "districtIn") {
      if (!Array.isArray(value) || value.length > 64) {
        throw new BadRequestException("districtIn সর্বোচ্চ ৬৪টি জেলার তালিকা হতে হবে");
      }
      const districts = value.map((d) => String(d ?? "").trim()).filter(Boolean);
      if (districts.some((d) => d.length > 80)) {
        throw new BadRequestException("districtIn-এর প্রতিটি জেলার নাম সর্বোচ্চ ৮০ অক্ষরের হতে হবে");
      }
      out.districtIn = districts;
    } else if (key === "phoneOpenOrdersGte") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        throw new BadRequestException("phoneOpenOrdersGte ১–১০০ এর মধ্যে পূর্ণসংখ্যা হতে হবে");
      }
      out.phoneOpenOrdersGte = n;
    } else if (key === "minRiskScore") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 100) {
        throw new BadRequestException("minRiskScore ০–১০০ এর মধ্যে পূর্ণসংখ্যা হতে হবে");
      }
      out.minRiskScore = n;
    }
  }
  return out;
}

function validateName(raw: unknown): string {
  const name = String(raw ?? "").trim();
  if (name.length < 1 || name.length > 120) {
    throw new BadRequestException("নিয়মের নাম ১–১২০ অক্ষরের হতে হবে");
  }
  return name;
}

function validateAction(raw: unknown): string {
  const action = String(raw ?? "");
  if (!(FRAUD_RULE_ACTIONS as readonly string[]).includes(action)) {
    throw new BadRequestException("action হতে হবে hold, tag অথবা block_checkout");
  }
  return action;
}

function validateTagValue(action: string, raw: unknown): string | null {
  if (action !== "tag") return null;
  const tag = String(raw ?? "").trim();
  if (tag.length < 1 || tag.length > 30) {
    throw new BadRequestException("tag অ্যাকশনের জন্য tagValue ১–৩০ অক্ষরের হতে হবে");
  }
  return tag;
}

@Injectable()
export class FraudRulesService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private table(): any {
    return (this.prisma as any).fraudRule;
  }

  private hitTable(): any {
    return (this.prisma as any).fraudRuleHit;
  }

  /** Enabled rules for an evaluation pass ([] on any error —
   * rule evaluation is failure-isolated by its callers). */
  async listEnabled(orgId: string, actions?: string[]) {
    try {
      const table = this.table();
      if (!table?.findMany) return [];
      const rows = (await table.findMany({
        where: { organizationId: orgId, enabled: true },
        orderBy: { createdAt: "asc" },
      }).catch(() => [])) ?? [];
      return actions ? rows.filter((r: any) => actions.includes(String(r.action))) : rows;
    } catch {
      return [];
    }
  }

  async list(orgId: string) {
    const table = this.table();
    if (!table?.findMany) return [];
    const rows = (await table.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    }).catch(() => [])) ?? [];
    // Hit counts: DB groupBy when available, JS count fallback.
    const counts = new Map<string, number>();
    try {
      const hits = this.hitTable();
      if (hits?.groupBy) {
        const grouped = await hits.groupBy({
          by: ["ruleId"],
          where: { organizationId: orgId },
          _count: { _all: true },
        }).catch(() => null);
        if (Array.isArray(grouped)) {
          for (const g of grouped) {
            counts.set(String(g.ruleId), Number(g?._count?._all ?? g?._count ?? 0));
          }
        }
      }
      if (counts.size === 0 && hits?.findMany) {
        const all = (await hits.findMany({
          where: { organizationId: orgId },
          take: 5000,
        }).catch(() => [])) ?? [];
        for (const h of all) counts.set(String(h.ruleId), (counts.get(String(h.ruleId)) ?? 0) + 1);
      }
    } catch { /* counts degrade to 0 */ }
    return rows.map((r: any) => ({ ...r, hitCount: counts.get(String(r.id)) ?? 0 }));
  }

  async create(orgId: string, actorId: string, dto: any) {
    const name = validateName(dto?.name);
    const action = validateAction(dto?.action);
    const tagValue = validateTagValue(action, dto?.tagValue);
    const conditions = validateFraudRuleConditions(dto?.conditions ?? {});
    const table = this.table();
    if (!table?.create) throw new BadRequestException("ফ্রড নিয়ম সুবিধাটি এই ডিপ্লয়মেন্টে নেই");
    const row = await table.create({
      data: {
        organizationId: orgId,
        name,
        enabled: dto?.enabled === undefined ? true : Boolean(dto.enabled),
        conditions,
        action,
        tagValue,
        createdById: actorId ?? null,
      },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "orders.fraud_rule_created",
      entityType: "FraudRule", entityId: row.id, metadata: { action },
    }).catch(() => undefined);
    return row;
  }

  private async findOwned(orgId: string, id: string) {
    const table = this.table();
    const row = table?.findFirst
      ? await table.findFirst({ where: { id, organizationId: orgId } }).catch(() => null)
      : null;
    if (!row) throw new NotFoundException("Fraud rule not found in this organization");
    return row;
  }

  async update(orgId: string, actorId: string, id: string, dto: any) {
    const row = await this.findOwned(orgId, id);
    const data: Record<string, unknown> = {};
    if (dto?.name !== undefined) data.name = validateName(dto.name);
    if (dto?.enabled !== undefined) {
      if (typeof dto.enabled !== "boolean") throw new BadRequestException("enabled boolean হতে হবে");
      data.enabled = dto.enabled;
    }
    if (dto?.conditions !== undefined) data.conditions = validateFraudRuleConditions(dto.conditions);
    const action = dto?.action !== undefined ? validateAction(dto.action) : String(row.action);
    if (dto?.action !== undefined) data.action = action;
    if (dto?.action !== undefined || dto?.tagValue !== undefined) {
      data.tagValue = validateTagValue(action, dto?.tagValue !== undefined ? dto.tagValue : row.tagValue);
    }
    const updated = await this.table().update({ where: { id: row.id }, data });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "orders.fraud_rule_updated",
      entityType: "FraudRule", entityId: row.id, metadata: { action },
    }).catch(() => undefined);
    return updated;
  }

  async delete(orgId: string, actorId: string, id: string) {
    const row = await this.findOwned(orgId, id);
    await this.table().delete({ where: { id: row.id } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "orders.fraud_rule_deleted",
      entityType: "FraudRule", entityId: row.id, metadata: { action: String(row.action) },
    }).catch(() => undefined);
    return { deleted: true, id: row.id };
  }

  /** Record a firing. NEVER throws. */
  async recordHit(orgId: string, ruleId: string, orderId: string | null, action: string): Promise<void> {
    try {
      const table = this.hitTable();
      if (!table?.create) return;
      await table.create({
        data: { organizationId: orgId, ruleId, orderId: orderId ?? null, action: String(action) },
      }).catch(() => undefined);
    } catch {
      /* never throws */
    }
  }

  /** Hits for one order (timeline builder); [] on error. */
  async listHitsForOrder(orgId: string, orderId: string) {
    try {
      const table = this.hitTable();
      if (!table?.findMany) return [];
      const rows = (await table.findMany({
        where: { organizationId: orgId, orderId },
        orderBy: { createdAt: "desc" },
      }).catch(() => [])) ?? [];
      return rows;
    } catch {
      return [];
    }
  }
}
