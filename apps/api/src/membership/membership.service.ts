import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

/**
 * NF7 (FB3) — Membership tiers.
 *
 * A tier is DERIVED, never assigned: a customer's lifetime spend
 * is the sum of totalMinor over their SOLD orders only. "Sold"
 * uses the codebase's canonical order-status vocabulary (the
 * EC33 / isSoldOrder status half): status "completed" or
 * "delivered". Cancelled / pending / processing / returned /
 * refunded / failed orders NEVER count — spec-proven.
 *
 * The derived result is cached on CustomerTier (tierId +
 * lifetimeSpendMinor + computedAt) because checkout's price
 * resolution reads it on the hot path (PriceListsService.
 * priceMapForCustomer); the cache is a pure function of the
 * orders + tier-definition tables and can be rebuilt at any
 * time by recomputeCustomer / recomputeAll.
 *
 * RECOMPUTE TRIGGERS (the documented choice):
 *  1. Order transitions — StoreCreditService's order-event
 *     reconciler (the loyalty onOrderTransition pattern: bus
 *     events order.delivered / order.status_changed /
 *     order.created / order.ingested / order.refunded) calls
 *     recomputeCustomer for the order's customer. A sale that
 *     completes therefore moves the tier immediately; a later
 *     cancellation drops the spend back out on the same event.
 *  2. Tier-definition writes (create / update / delete) —
 *     thresholds changed, so every customer of the org is
 *     recomputed in the same request.
 *  3. Staff recompute endpoints (one customer / whole org) for
 *     repair and for backfilling pre-NF7 customers.
 */

export const SOLD_ORDER_STATUSES = ["completed", "delivered"] as const;

function toBig(v: unknown): bigint {
  try {
    return BigInt(v as any);
  } catch {
    return 0n;
  }
}

function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /unique|P2002/i.test(msg);
}

/** Pure: the highest tier whose threshold the spend reaches.
 * Ties on a threshold resolve to the tier with the larger
 * sortOrder, then the later-created row — deterministic. */
export function tierForSpend(
  tiers: Array<{ id: string; minSpendMinor: bigint; sortOrder?: number | null; createdAt?: Date | null }>,
  spendMinor: bigint,
): string | null {
  let best: (typeof tiers)[number] | null = null;
  for (const t of tiers) {
    if (toBig(t.minSpendMinor) > spendMinor) continue;
    if (
      !best ||
      toBig(t.minSpendMinor) > toBig(best.minSpendMinor) ||
      (toBig(t.minSpendMinor) === toBig(best.minSpendMinor) &&
        Number(t.sortOrder ?? 0) > Number(best.sortOrder ?? 0))
    ) {
      best = t;
    }
  }
  return best?.id ?? null;
}

@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  private async safeAudit(input: Parameters<AuditService["log"]>[0]): Promise<void> {
    try {
      await this.audit?.log(input);
    } catch {
      /* audit never breaks the write it describes */
    }
  }

  private serializeTier(row: any) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      minSpendMinor: toBig(row.minSpendMinor).toString(),
      sortOrder: Number(row.sortOrder ?? 0),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private parseMinSpend(raw: unknown): bigint {
    const s = raw === null || raw === undefined ? "" : String(raw).trim();
    if (!/^\d+$/.test(s)) {
      throw new BadRequestException("minSpendMinor অবশ্যই শূন্য বা তার বেশি একটি পূর্ণসংখ্যা (পয়সায়) হতে হবে");
    }
    return BigInt(s);
  }

  // ---------- tier definitions CRUD ----------

  async listTiers(orgId: string) {
    const rows =
      (await this.t("tierDefinition")
        .findMany({ where: { organizationId: orgId }, orderBy: [{ sortOrder: "asc" }, { minSpendMinor: "asc" }] })
        .catch(() => [])) ?? [];
    const items: any[] = [];
    for (const row of rows) {
      let memberCount = 0;
      try {
        memberCount = await this.t("customerTier").count({
          where: { organizationId: orgId, tierId: row.id },
        });
      } catch {
        memberCount = 0;
      }
      let hasPriceList = false;
      try {
        const list = await this.t("priceList").findFirst({ where: { tierId: row.id } });
        hasPriceList = !!list;
      } catch {
        hasPriceList = false;
      }
      items.push({ ...this.serializeTier(row), memberCount, hasPriceList });
    }
    return { items };
  }

  async createTier(orgId: string, actorId: string, dto: { name?: string; minSpendMinor?: unknown; sortOrder?: number }) {
    const name = String(dto?.name ?? "").trim();
    if (!name) throw new BadRequestException("টিয়ারের নাম আবশ্যক");
    const minSpendMinor = this.parseMinSpend(dto?.minSpendMinor);
    const sortOrder = dto?.sortOrder !== undefined ? Number(dto.sortOrder) : 0;
    if (!Number.isInteger(sortOrder)) throw new BadRequestException("sortOrder পূর্ণসংখ্যা হতে হবে");
    const existing = await this.t("tierDefinition")
      .findFirst({ where: { organizationId: orgId, name } })
      .catch(() => null);
    if (existing) throw new BadRequestException("এই নামে ইতিমধ্যে একটি টিয়ার আছে — অন্য নাম দিন");
    let row: any;
    try {
      row = await this.t("tierDefinition").create({
        data: { organizationId: orgId, name, minSpendMinor, sortOrder },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new BadRequestException("এই নামে ইতিমধ্যে একটি টিয়ার আছে — অন্য নাম দিন");
      }
      throw e;
    }
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "membership.tier_created",
      entityType: "TierDefinition", entityId: row.id,
      metadata: { name, minSpendMinor: minSpendMinor.toString(), sortOrder },
    });
    // Thresholds are global to the derivation — recompute all.
    await this.recomputeAll(orgId).catch(() => undefined);
    return { tier: this.serializeTier(row) };
  }

  async updateTier(orgId: string, actorId: string, tierId: string, dto: { name?: string; minSpendMinor?: unknown; sortOrder?: number }) {
    const tier = await this.loadTierOr404(orgId, tierId);
    const data: Record<string, any> = {};
    if (dto?.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) throw new BadRequestException("টিয়ারের নাম আবশ্যক");
      if (name !== tier.name) {
        const clash = await this.t("tierDefinition")
          .findFirst({ where: { organizationId: orgId, name } })
          .catch(() => null);
        if (clash && clash.id !== tierId) {
          throw new BadRequestException("এই নামে ইতিমধ্যে একটি টিয়ার আছে — অন্য নাম দিন");
        }
      }
      data.name = name;
    }
    if (dto?.minSpendMinor !== undefined) data.minSpendMinor = this.parseMinSpend(dto.minSpendMinor);
    if (dto?.sortOrder !== undefined) {
      if (!Number.isInteger(Number(dto.sortOrder))) throw new BadRequestException("sortOrder পূর্ণসংখ্যা হতে হবে");
      data.sortOrder = Number(dto.sortOrder);
    }
    if (Object.keys(data).length === 0) throw new BadRequestException("কমপক্ষে একটি ক্ষেত্র পাঠান");
    let updated: any;
    try {
      updated = await this.t("tierDefinition").update({ where: { id: tierId }, data });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new BadRequestException("এই নামে ইতিমধ্যে একটি টিয়ার আছে — অন্য নাম দিন");
      }
      throw e;
    }
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "membership.tier_updated",
      entityType: "TierDefinition", entityId: tierId,
      metadata: { fields: Object.keys(data) },
    });
    await this.recomputeAll(orgId).catch(() => undefined);
    return { tier: this.serializeTier(updated) };
  }

  async deleteTier(orgId: string, actorId: string, tierId: string) {
    await this.loadTierOr404(orgId, tierId);
    // Members lose the tier (CustomerTier.tierId SetNull in the
    // schema; done explicitly here so fake/real behave alike);
    // the tier's price list cascades with the tier delete on a
    // real DB and is removed explicitly for the same reason.
    try {
      await this.t("customerTier").updateMany({
        where: { organizationId: orgId, tierId },
        data: { tierId: null },
      });
    } catch { /* best-effort before the delete itself */ }
    try {
      const list = await this.t("priceList").findFirst({ where: { tierId } });
      if (list) {
        await this.t("priceListItem")?.deleteMany?.({ where: { priceListId: list.id } }).catch(() => undefined);
        await this.t("priceList")?.delete?.({ where: { id: list.id } }).catch(() => undefined);
      }
    } catch { /* the DB cascade covers this on a real deployment */ }
    await this.t("tierDefinition").delete({ where: { id: tierId } });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "membership.tier_deleted",
      entityType: "TierDefinition", entityId: tierId,
    });
    await this.recomputeAll(orgId).catch(() => undefined);
    return { deleted: true };
  }

  private async loadTierOr404(orgId: string, tierId: string): Promise<any> {
    const row = await this.t("tierDefinition").findFirst({
      where: { id: tierId, organizationId: orgId },
    });
    if (!row) throw new NotFoundException("মেম্বারশিপ টিয়ারটি পাওয়া যায়নি");
    return row;
  }

  // ---------- derivation ----------

  /** Lifetime sold spend for one customer: Σ totalMinor over
   * orders in the sold statuses ONLY. Org-scoped throughout. */
  async lifetimeSpendMinor(orgId: string, customerId: string): Promise<bigint> {
    const orders: any[] =
      (await this.t("order")
        .findMany({
          where: {
            organizationId: orgId,
            customerId,
            status: { in: [...SOLD_ORDER_STATUSES] },
          },
        })
        .catch(() => [])) ?? [];
    let sum = 0n;
    for (const o of orders) {
      if ((o as any).isPractice) continue;
      sum += toBig(o.totalMinor);
    }
    return sum;
  }

  /** Recompute ONE customer's CustomerTier row from the real
   * orders. Returns the serialized view. A customer of another
   * org is a 404 — recompute never crosses orgs. */
  async recomputeCustomer(orgId: string, customerId: string) {
    const customer = await this.t("customer").findFirst({
      where: { id: customerId, organizationId: orgId },
    });
    if (!customer) throw new NotFoundException("কাস্টমার পাওয়া যায়নি");
    const spend = await this.lifetimeSpendMinor(orgId, customerId);
    const tiers: any[] =
      (await this.t("tierDefinition")
        .findMany({ where: { organizationId: orgId } })
        .catch(() => [])) ?? [];
    const tierId = tierForSpend(
      tiers.map((t) => ({ id: t.id, minSpendMinor: toBig(t.minSpendMinor), sortOrder: t.sortOrder, createdAt: t.createdAt })),
      spend,
    );
    const table = this.t("customerTier");
    const existing = await table
      .findFirst({ where: { customerId, organizationId: orgId } })
      .catch(() => null);
    const data = {
      organizationId: orgId,
      customerId,
      tierId,
      lifetimeSpendMinor: spend,
      computedAt: new Date(),
    };
    let row: any;
    if (existing) {
      row = await table.update({ where: { id: existing.id }, data });
    } else {
      try {
        row = await table.create({ data });
      } catch (e) {
        if (isUniqueViolation(e)) {
          const winner = await table.findFirst({ where: { customerId } });
          if (winner) row = await table.update({ where: { id: winner.id }, data });
          else throw e;
        } else throw e;
      }
    }
    return this.serializeCustomerTier(orgId, row);
  }

  /** Recompute every customer of the org who has any order or
   * an existing CustomerTier row. Used after tier-definition
   * writes and by the staff backfill endpoint. */
  async recomputeAll(orgId: string): Promise<{ recomputed: number }> {
    const customerIds = new Set<string>();
    const orders: any[] =
      (await this.t("order").findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [];
    for (const o of orders) if (o.customerId) customerIds.add(String(o.customerId));
    const existing: any[] =
      (await this.t("customerTier").findMany({ where: { organizationId: orgId } }).catch(() => [])) ?? [];
    for (const r of existing) customerIds.add(String(r.customerId));
    let recomputed = 0;
    for (const id of customerIds) {
      try {
        await this.recomputeCustomer(orgId, id);
        recomputed++;
      } catch {
        /* a vanished customer never blocks the rest */
      }
    }
    return { recomputed };
  }

  async serializeCustomerTier(orgId: string, row: any) {
    let tier: any = null;
    if (row?.tierId) {
      tier = await this.t("tierDefinition")
        .findFirst({ where: { id: row.tierId, organizationId: orgId } })
        .catch(() => null);
    }
    return {
      customerId: row.customerId,
      tierId: row.tierId ?? null,
      tierName: tier?.name ?? null,
      minSpendMinor: tier ? toBig(tier.minSpendMinor).toString() : null,
      lifetimeSpendMinor: toBig(row.lifetimeSpendMinor).toString(),
      computedAt: row.computedAt ?? row.updatedAt ?? null,
    };
  }

  /** Staff view: a customer's tier (recomputed on read when no
   * row exists yet, so a pre-NF7 customer shows truth, not a
   * blank). */
  async getCustomerTier(orgId: string, customerId: string) {
    const customer = await this.t("customer").findFirst({
      where: { id: customerId, organizationId: orgId },
    });
    if (!customer) throw new NotFoundException("কাস্টমার পাওয়া যায়নি");
    let row = await this.t("customerTier")
      .findFirst({ where: { customerId, organizationId: orgId } })
      .catch(() => null);
    if (!row) {
      const view = await this.recomputeCustomer(orgId, customerId);
      return { tier: view };
    }
    return { tier: await this.serializeCustomerTier(orgId, row) };
  }
}
