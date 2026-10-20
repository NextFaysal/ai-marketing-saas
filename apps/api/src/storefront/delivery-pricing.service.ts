import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type {
  CreatePickupPointDto,
  CreateShippingRateRuleDto,
  UpdatePickupPointDto,
  UpdateShippingRateRuleDto,
} from "./storefront.dto";
import { badRequest, notFound } from "../i18n";

/**
 * EC30 — weight-based shipping rate rules + pickup points.
 *
 * Honesty discipline (same as the rest of the EC package):
 *  - A cart weight is NEVER invented: when any shipped product
 *    lacks Product.weightGrams the cart weight is unknown (null),
 *    and a rule carrying any weight bound cannot match an unknown
 *    weight. Only a boundless rule matches an unknown weight.
 *  - Money is integer minor units end to end; charges travel as
 *    decimal strings on the wire (the zone DTO convention).
 *  - matchRule / pickup lookups are failure-isolated: a missing
 *    table (older deploy) reads as "no rule / no point", never a
 *    500 into the public quote path.
 */

/** Cart weight of built quote lines. `lines` are the priced lines
 * ({ product, quantity }) — bundle component lines included (they
 * are real shipped products); bump pseudo-lines are not quote
 * lines and never reach this helper. */
export function cartWeightOf(
  lines: Array<{ product: { weightGrams?: number | null }; quantity: number }>,
): { totalGrams: number | null; allKnown: boolean } {
  let total = 0;
  for (const line of lines) {
    const w = line.product?.weightGrams;
    if (w === null || w === undefined) return { totalGrams: null, allKnown: false };
    total += Number(w) * Number(line.quantity ?? 0);
  }
  return { totalGrams: total, allKnown: true };
}

/** Pure rule match: zone scope + INCLUSIVE weight bounds. */
export function ruleMatches(
  rule: { shippingZoneId?: string | null; minWeightGrams?: number | null; maxWeightGrams?: number | null },
  zoneId: string,
  weightGrams: number | null,
): boolean {
  if (rule.shippingZoneId !== null && rule.shippingZoneId !== undefined && rule.shippingZoneId !== zoneId) {
    return false;
  }
  const hasMin = rule.minWeightGrams !== null && rule.minWeightGrams !== undefined;
  const hasMax = rule.maxWeightGrams !== null && rule.maxWeightGrams !== undefined;
  if ((hasMin || hasMax) && (weightGrams === null || weightGrams === undefined)) return false;
  if (hasMin && (weightGrams as number) < Number(rule.minWeightGrams)) return false;
  if (hasMax && (weightGrams as number) > Number(rule.maxWeightGrams)) return false;
  return true;
}

/** Mirror of parseMinorField in storefront.service.ts (the zone
 * money parser): decimal string of a non-negative integer, else a
 * Bengali 400. Returns null for null/undefined input. */
function parseMinorField(value: string | null | undefined, field: string): bigint | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) {
    throw badRequest("storefront.fieldNonNegativeMinor", { field: field });
  }
  return BigInt(raw);
}

function parseWeightField(value: number | null | undefined, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw badRequest("storefront.fieldNonNegativeGrams", { field: field });
  }
  return Number(value);
}

function assertWeightRange(min: number | null, max: number | null) {
  if (min !== null && max !== null && min > max) {
    throw badRequest("storefront.minWeightExceedsMax");
  }
}

@Injectable()
export class DeliveryPricingService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  private async auditSafe(entry: {
    organizationId: string;
    userId: string;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  }) {
    // Failure-isolated: an audit problem never fails the mutation.
    await this.audit?.log(entry as any)?.catch(() => undefined);
  }

  // ================= Matching / lookups (public path) =================

  /**
   * First matching ACTIVE rule of the org: priority DESC, then
   * createdAt ASC. Failure-isolated — any table problem reads as
   * no rule (the caller falls back to the zone's flat charge).
   */
  async matchRule(orgId: string, zoneId: string, weightGrams: number | null): Promise<any | null> {
    try {
      const table = this.t("shippingRateRule");
      if (!table?.findMany) return null;
      const rows: any[] =
        (await table
          .findMany({
            where: { organizationId: orgId, active: true },
            orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
          })
          .catch(() => [])) ?? [];
      // Re-sort in memory so the winner does not depend on the
      // store honouring a compound orderBy.
      const sorted = [...rows].sort((a, b) => {
        const pa = Number(a.priority ?? 0);
        const pb = Number(b.priority ?? 0);
        if (pb !== pa) return pb - pa;
        return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
      });
      return sorted.find((r) => ruleMatches(r, zoneId, weightGrams)) ?? null;
    } catch {
      return null;
    }
  }

  /** Org-scoped ACTIVE pickup point (checkout path), else null. */
  async getActivePickupPoint(orgId: string, pointId: string): Promise<any | null> {
    try {
      const table = this.t("pickupPoint");
      if (!table?.findFirst || !pointId) return null;
      return (
        (await table
          .findFirst({ where: { id: pointId, organizationId: orgId, active: true } })
          .catch(() => null)) ?? null
      );
    } catch {
      return null;
    }
  }

  /** Org-scoped pickup point of ANY status (display path — a
   * point deactivated after an order was placed still shows). */
  async getPickupPointById(orgId: string, pointId: string): Promise<any | null> {
    try {
      const table = this.t("pickupPoint");
      if (!table?.findFirst || !pointId) return null;
      return (
        (await table
          .findFirst({ where: { id: pointId, organizationId: orgId } })
          .catch(() => null)) ?? null
      );
    } catch {
      return null;
    }
  }

  // ================= Staff: rate rules =================

  private serializeRule(r: any) {
    return {
      id: r.id,
      shippingZoneId: r.shippingZoneId ?? null,
      minWeightGrams: r.minWeightGrams ?? null,
      maxWeightGrams: r.maxWeightGrams ?? null,
      chargeMinor: String(r.chargeMinor ?? 0),
      priority: r.priority ?? 0,
      active: r.active !== false,
    };
  }

  async listRules(orgId: string) {
    let rows: any[] = [];
    try {
      const table = this.t("shippingRateRule");
      rows = table?.findMany
        ? ((await table
            .findMany({
              where: { organizationId: orgId },
              orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
            })
            .catch(() => [])) ?? [])
        : [];
    } catch {
      rows = [];
    }
    return { rules: rows.map((r) => this.serializeRule(r)) };
  }

  private async assertZoneOfOrg(orgId: string, zoneId: string) {
    const zone = await this.t("shippingZone")
      .findFirst({ where: { id: zoneId, organizationId: orgId } })
      .catch(() => null);
    if (!zone) throw notFound("storefront.shippingZoneNotFound");
  }

  async createRule(orgId: string, actorId: string, dto: CreateShippingRateRuleDto) {
    const charge = parseMinorField(dto.chargeMinor, "chargeMinor");
    if (charge === null) {
      throw badRequest("storefront.chargeMinorInvalid");
    }
    const minWeightGrams = parseWeightField(dto.minWeightGrams, "minWeightGrams");
    const maxWeightGrams = parseWeightField(dto.maxWeightGrams, "maxWeightGrams");
    assertWeightRange(minWeightGrams, maxWeightGrams);
    if (dto.priority !== undefined && dto.priority !== null && !Number.isInteger(dto.priority)) {
      throw badRequest("courier.priorityMustBeInteger");
    }
    if (dto.shippingZoneId) await this.assertZoneOfOrg(orgId, dto.shippingZoneId);
    const rule = await this.t("shippingRateRule").create({
      data: {
        organizationId: orgId,
        shippingZoneId: dto.shippingZoneId ?? null,
        minWeightGrams,
        maxWeightGrams,
        chargeMinor: charge,
        priority: dto.priority ?? 0,
        active: dto.active ?? true,
      },
    });
    await this.auditSafe({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.shipping_rate_rule_created",
      entityType: "ShippingRateRule",
      entityId: rule.id,
      metadata: { shippingZoneId: rule.shippingZoneId ?? null },
    });
    return { rule: this.serializeRule(rule) };
  }

  private async requireRule(orgId: string, ruleId: string): Promise<any> {
    const rule = await this.t("shippingRateRule").findFirst({
      where: { id: ruleId, organizationId: orgId },
    });
    if (!rule) throw notFound("storefront.shippingRateRuleNotFound");
    return rule;
  }

  async updateRule(orgId: string, actorId: string, ruleId: string, dto: UpdateShippingRateRuleDto) {
    const rule = await this.requireRule(orgId, ruleId);
    const data: Record<string, any> = {};
    if (dto.shippingZoneId !== undefined) {
      if (dto.shippingZoneId) await this.assertZoneOfOrg(orgId, dto.shippingZoneId);
      data.shippingZoneId = dto.shippingZoneId ?? null;
    }
    if (dto.minWeightGrams !== undefined) data.minWeightGrams = parseWeightField(dto.minWeightGrams, "minWeightGrams");
    if (dto.maxWeightGrams !== undefined) data.maxWeightGrams = parseWeightField(dto.maxWeightGrams, "maxWeightGrams");
    assertWeightRange(
      data.minWeightGrams !== undefined ? data.minWeightGrams : (rule.minWeightGrams ?? null),
      data.maxWeightGrams !== undefined ? data.maxWeightGrams : (rule.maxWeightGrams ?? null),
    );
    if (dto.chargeMinor !== undefined) {
      const charge = parseMinorField(dto.chargeMinor, "chargeMinor");
      if (charge === null) {
        throw badRequest("storefront.chargeMinorInvalid");
      }
      data.chargeMinor = charge;
    }
    if (dto.priority !== undefined) {
      if (dto.priority !== null && !Number.isInteger(dto.priority)) {
        throw badRequest("courier.priorityMustBeInteger");
      }
      data.priority = dto.priority ?? 0;
    }
    if (dto.active !== undefined) data.active = dto.active;
    const saved = await this.t("shippingRateRule").update({ where: { id: rule.id }, data });
    await this.auditSafe({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.shipping_rate_rule_updated",
      entityType: "ShippingRateRule",
      entityId: rule.id,
      metadata: { fields: Object.keys(data) },
    });
    return { rule: this.serializeRule(saved) };
  }

  async deleteRule(orgId: string, actorId: string, ruleId: string) {
    const rule = await this.requireRule(orgId, ruleId);
    await this.t("shippingRateRule").delete({ where: { id: rule.id } });
    await this.auditSafe({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.shipping_rate_rule_deleted",
      entityType: "ShippingRateRule",
      entityId: rule.id,
      metadata: {},
    });
    return { deleted: true, ruleId: rule.id };
  }

  // ================= Staff: pickup points =================

  private serializePoint(p: any) {
    return {
      id: p.id,
      name: p.name,
      address: p.address,
      district: p.district,
      phone: p.phone ?? null,
      feeMinor: String(p.feeMinor ?? 0),
      active: p.active !== false,
    };
  }

  async listPoints(orgId: string) {
    let rows: any[] = [];
    try {
      const table = this.t("pickupPoint");
      rows = table?.findMany
        ? ((await table
            .findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } })
            .catch(() => [])) ?? [])
        : [];
    } catch {
      rows = [];
    }
    return { points: rows.map((p) => this.serializePoint(p)) };
  }

  private requirePointField(value: string | undefined, label: string): string {
    const v = String(value ?? "").trim();
    if (!v) throw badRequest("storefront.labelRequired", { label: label });
    return v;
  }

  async createPoint(orgId: string, actorId: string, dto: CreatePickupPointDto) {
    const name = this.requirePointField(dto.name, "পিকআপ পয়েন্টের নাম");
    const address = this.requirePointField(dto.address, "পিকআপ পয়েন্টের ঠিকানা");
    const district = this.requirePointField(dto.district, "পিকআপ পয়েন্টের জেলা");
    const fee = parseMinorField(dto.feeMinor ?? "0", "feeMinor") ?? 0n;
    const point = await this.t("pickupPoint").create({
      data: {
        organizationId: orgId,
        name,
        address,
        district,
        phone: dto.phone?.trim() ? dto.phone.trim() : null,
        feeMinor: fee,
        active: dto.active ?? true,
      },
    });
    await this.auditSafe({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.pickup_point_created",
      entityType: "PickupPoint",
      entityId: point.id,
      metadata: { name: point.name, district: point.district },
    });
    return { point: this.serializePoint(point) };
  }

  private async requirePoint(orgId: string, pointId: string): Promise<any> {
    const point = await this.t("pickupPoint").findFirst({
      where: { id: pointId, organizationId: orgId },
    });
    if (!point) throw notFound("storefront.pickupPointNotFound");
    return point;
  }

  async updatePoint(orgId: string, actorId: string, pointId: string, dto: UpdatePickupPointDto) {
    const point = await this.requirePoint(orgId, pointId);
    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = this.requirePointField(dto.name, "পিকআপ পয়েন্টের নাম");
    if (dto.address !== undefined) data.address = this.requirePointField(dto.address, "পিকআপ পয়েন্টের ঠিকানা");
    if (dto.district !== undefined) data.district = this.requirePointField(dto.district, "পিকআপ পয়েন্টের জেলা");
    if (dto.phone !== undefined) data.phone = dto.phone?.trim() ? dto.phone.trim() : null;
    if (dto.feeMinor !== undefined) {
      const fee = parseMinorField(dto.feeMinor, "feeMinor");
      if (fee === null) {
        throw badRequest("storefront.feeMinorInvalid");
      }
      data.feeMinor = fee;
    }
    if (dto.active !== undefined) data.active = dto.active;
    const saved = await this.t("pickupPoint").update({ where: { id: point.id }, data });
    await this.auditSafe({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.pickup_point_updated",
      entityType: "PickupPoint",
      entityId: point.id,
      metadata: { fields: Object.keys(data) },
    });
    return { point: this.serializePoint(saved) };
  }

  async deletePoint(orgId: string, actorId: string, pointId: string) {
    const point = await this.requirePoint(orgId, pointId);
    await this.t("pickupPoint").delete({ where: { id: point.id } });
    await this.auditSafe({
      organizationId: orgId,
      userId: actorId,
      action: "storefront.pickup_point_deleted",
      entityType: "PickupPoint",
      entityId: point.id,
      metadata: { name: point.name },
    });
    return { deleted: true, pointId: point.id };
  }
}
