import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { badRequest, notFound } from "../i18n";

/**
 * EC22 — Courier auto-selection rules.
 *
 * A rule says: "orders that look like THIS go to THAT courier
 * account". Conditions are validated Json stored on CourierRule:
 *   { districts?: string[], minWeightGrams?, maxWeightGrams?,
 *     minOrderMinor? (decimal string), maxOrderMinor? (decimal
 *     string), paymentType?: "cod" | "prepaid" | "any" }
 *
 * Facts are ALWAYS derived from the real order (items + linked
 * products + customer address) — a weight is only ever reported
 * when EVERY line's product carries a stored weightGrams; any gap
 * makes the total weight null and weight-conditioned rules simply
 * do not match. Nothing is ever estimated or invented.
 */

export const COURIER_PROVIDERS = ["steadfast", "pathao", "redx"] as const;

export interface CourierRuleDto {
  name?: string;
  conditions?: unknown;
  courierAccountId?: string;
  priority?: number;
  active?: boolean;
}

export interface OrderFacts {
  district: string | null;
  totalWeightGrams: number | null;
  totalMinor: bigint;
  paymentType: "cod" | "prepaid";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Validate a conditions object; every violation is a 400 that NAMES the field (Bengali-first). */
export function validateConditions(conditions: unknown): Record<string, unknown> {
  if (!isPlainObject(conditions)) {
    throw badRequest("courier.conditionsMustBeObject");
  }
  const c = conditions as Record<string, unknown>;

  if (c.districts !== undefined) {
    if (!Array.isArray(c.districts) || c.districts.some((d) => typeof d !== "string" || d.trim() === "")) {
      throw badRequest("courier.conditionsDistrictsInvalid");
    }
  }
  for (const field of ["minWeightGrams", "maxWeightGrams"] as const) {
    if (c[field] !== undefined && (!Number.isInteger(c[field]) || (c[field] as number) <= 0)) {
      throw badRequest("courier.conditionsWeightInvalid", { field: field });
    }
  }
  if (
    c.minWeightGrams !== undefined && c.maxWeightGrams !== undefined &&
    (c.minWeightGrams as number) > (c.maxWeightGrams as number)
  ) {
    throw badRequest("courier.conditionsWeightOrder");
  }
  for (const field of ["minOrderMinor", "maxOrderMinor"] as const) {
    if (c[field] !== undefined) {
      if (typeof c[field] !== "string" || !/^\d+$/.test(c[field] as string)) {
        throw badRequest("courier.conditionsAmountInvalid", { field: field });
      }
    }
  }
  if (
    c.minOrderMinor !== undefined && c.maxOrderMinor !== undefined &&
    BigInt(c.minOrderMinor as string) > BigInt(c.maxOrderMinor as string)
  ) {
    throw badRequest("courier.conditionsAmountOrder");
  }
  if (c.paymentType !== undefined && !["cod", "prepaid", "any"].includes(c.paymentType as string)) {
    throw badRequest("courier.conditionsPaymentTypeInvalid");
  }
  return c;
}

@Injectable()
export class CourierRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Resolve + validate the courier account a rule points at; stores nothing. */
  private async courierAccountOrThrow(organizationId: string, courierAccountId: string) {
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: courierAccountId, organizationId },
    });
    if (!integration) throw notFound("courier.courierAccountNotFoundInOrg");
    if (!COURIER_PROVIDERS.includes(integration.provider)) {
      throw badRequest("courier.notACourierAccount");
    }
    return integration;
  }

  private async ruleOr404(organizationId: string, ruleId: string) {
    const rule = await (this.prisma as any).courierRule.findFirst({
      where: { id: ruleId, organizationId },
    });
    if (!rule) throw notFound("courier.courierRuleNotFound");
    return rule;
  }

  async list(organizationId: string) {
    return (this.prisma as any).courierRule.findMany({
      where: { organizationId },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
  }

  async create(organizationId: string, actorId: string, dto: CourierRuleDto) {
    const name = dto.name?.trim();
    if (!name) throw badRequest("courier.ruleNameNeeded");
    const conditions = validateConditions(dto.conditions);
    if (!dto.courierAccountId) throw badRequest("courier.ruleAccountNeeded");
    if (dto.priority !== undefined && !Number.isInteger(dto.priority)) {
      throw badRequest("courier.priorityMustBeInteger");
    }
    const integration = await this.courierAccountOrThrow(organizationId, dto.courierAccountId);
    const rule = await (this.prisma as any).courierRule.create({
      data: {
        organizationId,
        name,
        conditions,
        courierAccountId: integration.id,
        // Provider snapshot: the rule keeps naming its courier even
        // if the account row is later re-purposed.
        provider: integration.provider,
        priority: dto.priority ?? 0,
        active: dto.active ?? true,
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "courier_rule.created", entityType: "CourierRule",
      entityId: rule.id, metadata: { name, provider: integration.provider, courierAccountId: integration.id },
    });
    return rule;
  }

  async update(organizationId: string, actorId: string, ruleId: string, dto: CourierRuleDto) {
    const existing = await this.ruleOr404(organizationId, ruleId);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw badRequest("courier.ruleNameEmpty");
      data.name = name;
    }
    if (dto.conditions !== undefined) data.conditions = validateConditions(dto.conditions);
    if (dto.courierAccountId !== undefined) {
      const integration = await this.courierAccountOrThrow(organizationId, dto.courierAccountId);
      data.courierAccountId = integration.id;
      data.provider = integration.provider;
    }
    if (dto.priority !== undefined) {
      if (!Number.isInteger(dto.priority)) throw badRequest("courier.priorityMustBeInteger");
      data.priority = dto.priority;
    }
    if (dto.active !== undefined) data.active = Boolean(dto.active);
    const rule = await (this.prisma as any).courierRule.update({ where: { id: existing.id }, data });
    await this.audit.log({
      organizationId, userId: actorId, action: "courier_rule.updated", entityType: "CourierRule",
      entityId: rule.id, metadata: { fields: Object.keys(data) },
    });
    return rule;
  }

  /** Hard delete — a rule is configuration, not a record anyone audits against later. */
  async remove(organizationId: string, actorId: string, ruleId: string) {
    const existing = await this.ruleOr404(organizationId, ruleId);
    await (this.prisma as any).courierRule.delete({ where: { id: existing.id } });
    await this.audit.log({
      organizationId, userId: actorId, action: "courier_rule.deleted", entityType: "CourierRule",
      entityId: existing.id, metadata: { name: existing.name, provider: existing.provider },
    });
    return { deleted: true, id: existing.id };
  }

  /**
   * The real facts of an order, for rule matching. `order` is the
   * already-loaded order row; items, products and the customer are
   * loaded here so every caller judges the same facts.
   */
  async factsForOrder(organizationId: string, order: any): Promise<OrderFacts> {
    const items = (((await (this.prisma as any).orderItem?.findMany({ where: { orderId: order.id } })?.catch(() => [])) ?? []) as any[]);

    let totalWeightGrams: number | null = 0;
    for (const item of items) {
      if (totalWeightGrams === null) break;
      if (!item.productId) { totalWeightGrams = null; break; }
      const product = await (this.prisma as any).product.findFirst({
        where: { id: item.productId, organizationId },
      });
      if (!product || product.weightGrams === null || product.weightGrams === undefined) {
        totalWeightGrams = null;
        break;
      }
      totalWeightGrams += product.weightGrams * (item.quantity ?? 1);
    }
    // An order with no items at all has no measurable weight either.
    if (items.length === 0) totalWeightGrams = null;

    let district: string | null = null;
    if (order.customerId) {
      const customer = await (this.prisma as any).customer.findFirst({
        where: { id: order.customerId, organizationId },
      }).catch(() => null);
      let address: any = customer?.address ?? null;
      if (typeof address === "string") {
        try { address = JSON.parse(address); } catch { address = null; }
      }
      if (address && typeof address === "object" && typeof address.district === "string" && address.district.trim() !== "") {
        district = address.district;
      }
    }

    let totalMinor = 0n;
    try { totalMinor = BigInt(order.totalMinor ?? 0); } catch { totalMinor = 0n; }

    return {
      district,
      totalWeightGrams,
      totalMinor,
      paymentType: order.isCod ? "cod" : "prepaid",
    };
  }

  /** Does one rule's conditions hold for these facts? Returns the matched-condition labels, or null. */
  private matchLabels(conditions: any, facts: OrderFacts): string[] | null {
    const c = (conditions ?? {}) as Record<string, any>;
    const labels: string[] = [];

    if (c.districts !== undefined) {
      if (facts.district === null || !c.districts.includes(facts.district)) return null;
      labels.push(`জেলা: ${facts.district}`);
    }
    if (c.minWeightGrams !== undefined || c.maxWeightGrams !== undefined) {
      if (facts.totalWeightGrams === null) return null;
      if (c.minWeightGrams !== undefined && facts.totalWeightGrams < c.minWeightGrams) return null;
      if (c.maxWeightGrams !== undefined && facts.totalWeightGrams > c.maxWeightGrams) return null;
      labels.push(`ওজন: ${facts.totalWeightGrams} গ্রাম`);
    }
    if (c.minOrderMinor !== undefined || c.maxOrderMinor !== undefined) {
      if (c.minOrderMinor !== undefined && facts.totalMinor < BigInt(c.minOrderMinor)) return null;
      if (c.maxOrderMinor !== undefined && facts.totalMinor > BigInt(c.maxOrderMinor)) return null;
      labels.push("অর্ডারের মূল্য নির্ধারিত সীমার মধ্যে");
    }
    if (c.paymentType !== undefined && c.paymentType !== "any") {
      if (facts.paymentType !== c.paymentType) return null;
      labels.push(facts.paymentType === "cod" ? "পেমেন্ট: ক্যাশ অন ডেলিভারি" : "পেমেন্ট: প্রিপেইড");
    }
    return labels;
  }

  /**
   * First matching ACTIVE rule wins — highest priority first,
   * oldest first on a tie (stable, explainable order).
   */
  async evaluate(organizationId: string, facts: OrderFacts) {
    const rules = await (this.prisma as any).courierRule.findMany({
      where: { organizationId, active: true },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    for (const rule of rules as any[]) {
      const labels = this.matchLabels(rule.conditions, facts);
      if (labels) {
        const reason = labels.length > 0
          ? `নিয়ম “${rule.name}” মিলেছে — ${labels.join("; ")}`
          : `নিয়ম “${rule.name}” মিলেছে — কোনো শর্ত নেই, সব অর্ডারে প্রযোজ্য`;
        return { rule, provider: rule.provider, courierAccountId: rule.courierAccountId, reason };
      }
    }
    return null;
  }

  /** Booking-form helper: which courier WOULD this order go to? */
  async suggestion(organizationId: string, orderId: string) {
    const order = await (this.prisma as any).order.findFirst({
      where: { id: orderId, organizationId },
    });
    if (!order) throw notFound("commerce.orderNotFoundInOrg");
    const facts = await this.factsForOrder(organizationId, order);
    const match = await this.evaluate(organizationId, facts);
    if (!match) {
      return {
        ruleId: null, ruleName: null, provider: null, courierAccountId: null,
        reason: "কোনো সক্রিয় নিয়ম এই অর্ডারের সঙ্গে মেলেনি",
      };
    }
    return {
      ruleId: match.rule.id, ruleName: match.rule.name,
      provider: match.provider, courierAccountId: match.courierAccountId,
      reason: match.reason,
    };
  }
}
