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
 * AB5 (AX7) — B2B customer groups + explicit price lists.
 *
 * A CustomerGroup carries at most ONE PriceList (PriceList.groupId
 * is unique). The list holds MATERIALIZED prices only — a bulk
 * %-off helper writes explicit rows; nothing is computed at read
 * time. At checkout line-build the list is a PRICE SOURCE with
 * this precedence (mirrored at every application site):
 *
 *   gift-card lines keep face value
 *   → an explicit price-list price REPLACES catalog/variant price
 *     AND beats wholesale-tier math (a negotiated price is more
 *     specific than a quantity tier)
 *   → wholesale tier applies only to lines with NO list price
 *   → catalog price otherwise.
 *
 * priceMapForCustomer is failure-isolated BY CONTRACT: any error
 * resolves to null so group pricing can never break a checkout.
 */

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

/** Validate a non-negative integer-minor amount (decimal string
 * over the wire, like every other money field in commerce). */
export function parsePriceMinor(raw: unknown): bigint {
  const s = raw === null || raw === undefined ? "" : String(raw).trim();
  if (!/^\d+$/.test(s)) {
    throw new BadRequestException("দাম সঠিক নয় — priceMinor অবশ্যই শূন্য বা তার বেশি একটি পূর্ণসংখ্যা (পয়সায়) হতে হবে");
  }
  return BigInt(s);
}

export function priceKey(productId: string, variantId?: string | null): string {
  return `${productId}::${variantId ?? ""}`;
}

/**
 * Pure precedence helper: a variant-specific row beats the
 * product-level row; no row (or no map) ⇒ null (caller falls
 * back to tier / catalog pricing).
 */
export function pickGroupPrice(
  map: Map<string, bigint> | null | undefined,
  productId: string,
  variantId?: string | null,
): bigint | null {
  if (!map) return null;
  if (variantId) {
    const v = map.get(priceKey(productId, variantId));
    if (v !== undefined) return v;
  }
  const p = map.get(priceKey(productId, null));
  return p !== undefined ? p : null;
}

@Injectable()
export class PriceListsService {
  private readonly logger = new Logger(PriceListsService.name);

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

  // ---------- groups ----------

  private async loadGroupOr404(orgId: string, groupId: string): Promise<any> {
    const row = await this.t("customerGroup").findFirst({
      where: { id: groupId, organizationId: orgId },
    });
    if (!row) throw new NotFoundException("কাস্টমার গ্রুপটি পাওয়া যায়নি");
    return row;
  }

  private serializeGroup(group: any, memberCount: number, hasPriceList: boolean) {
    return {
      id: group.id,
      organizationId: group.organizationId,
      name: group.name,
      memberCount,
      hasPriceList,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }

  async listGroups(orgId: string) {
    const rows =
      (await this.t("customerGroup")
        .findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } })
        .catch(() => [])) ?? [];
    const items: any[] = [];
    for (const g of rows) {
      let memberCount = 0;
      try {
        const custTable = this.t("customer");
        if (typeof custTable?.count === "function") {
          memberCount = await custTable.count({ where: { organizationId: orgId, groupId: g.id } });
        } else if (custTable?.findMany) {
          const members = await custTable.findMany({ where: { organizationId: orgId, groupId: g.id } });
          memberCount = (members ?? []).length;
        }
      } catch {
        memberCount = 0;
      }
      let hasPriceList = false;
      try {
        const list = await this.t("priceList").findFirst({ where: { groupId: g.id } });
        hasPriceList = !!list;
      } catch {
        hasPriceList = false;
      }
      items.push(this.serializeGroup(g, memberCount, hasPriceList));
    }
    return { items };
  }

  async createGroup(orgId: string, actorId: string, dto: { name?: string } | string) {
    const name = String(typeof dto === "string" ? dto : dto?.name ?? "").trim();
    if (!name) throw new BadRequestException("গ্রুপের নাম আবশ্যক");
    const existing = await this.t("customerGroup")
      .findFirst({ where: { organizationId: orgId, name } })
      .catch(() => null);
    if (existing) {
      throw new BadRequestException("এই নামে ইতিমধ্যে একটি কাস্টমার গ্রুপ আছে — অন্য নাম দিন");
    }
    let row: any;
    try {
      row = await this.t("customerGroup").create({
        data: { organizationId: orgId, name },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new BadRequestException("এই নামে ইতিমধ্যে একটি কাস্টমার গ্রুপ আছে — অন্য নাম দিন");
      }
      throw e;
    }
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "customer_group.created",
      entityType: "CustomerGroup", entityId: row.id, metadata: { name },
    });
    return { group: this.serializeGroup(row, 0, false) };
  }

  async updateGroup(orgId: string, actorId: string, groupId: string, dto: { name?: string }) {
    const group = await this.loadGroupOr404(orgId, groupId);
    const name = String(dto?.name ?? "").trim();
    if (!name) throw new BadRequestException("গ্রুপের নাম আবশ্যক");
    if (name !== group.name) {
      const clash = await this.t("customerGroup")
        .findFirst({ where: { organizationId: orgId, name } })
        .catch(() => null);
      if (clash && clash.id !== groupId) {
        throw new BadRequestException("এই নামে ইতিমধ্যে একটি কাস্টমার গ্রুপ আছে — অন্য নাম দিন");
      }
    }
    let updated: any;
    try {
      updated = await this.t("customerGroup").update({ where: { id: groupId }, data: { name } });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new BadRequestException("এই নামে ইতিমধ্যে একটি কাস্টমার গ্রুপ আছে — অন্য নাম দিন");
      }
      throw e;
    }
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "customer_group.updated",
      entityType: "CustomerGroup", entityId: groupId, metadata: { name },
    });
    return { group: updated };
  }

  async deleteGroup(orgId: string, actorId: string, groupId: string) {
    await this.loadGroupOr404(orgId, groupId);
    // Members are detached first (Customer.groupId is a scalar —
    // there is no FK cascade to rely on); the price list itself
    // cascades from the group delete on a real database, and is
    // removed explicitly here so the behaviour is identical
    // everywhere.
    try {
      await this.t("customer").updateMany({
        where: { organizationId: orgId, groupId },
        data: { groupId: null },
      });
    } catch {
      /* member detach is best-effort before the delete itself */
    }
    try {
      const list = await this.t("priceList").findFirst({ where: { groupId } });
      if (list) {
        await this.t("priceListItem")?.deleteMany?.({ where: { priceListId: list.id } }).catch(() => undefined);
        await this.t("priceList")?.delete?.({ where: { id: list.id } }).catch(() => undefined);
      }
    } catch {
      /* the DB cascade covers this on a real deployment */
    }
    await this.t("customerGroup").delete({ where: { id: groupId } });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "customer_group.deleted",
      entityType: "CustomerGroup", entityId: groupId,
    });
    return { deleted: true };
  }

  // ---------- price list ----------

  /** The group's price list, created lazily on first touch. */
  private async ensurePriceList(orgId: string, group: any): Promise<any> {
    const table = this.t("priceList");
    const existing = await table.findFirst({ where: { groupId: group.id } });
    if (existing) return existing;
    try {
      return await table.create({ data: { organizationId: orgId, groupId: group.id } });
    } catch (e) {
      if (isUniqueViolation(e)) {
        const winner = await table.findFirst({ where: { groupId: group.id } });
        if (winner) return winner;
      }
      throw e;
    }
  }

  private async findList(orgId: string, groupId: string): Promise<any | null> {
    return this.t("priceList").findFirst({ where: { groupId, organizationId: orgId } }).catch(() => null);
  }

  async getPriceList(orgId: string, groupId: string) {
    const group = await this.loadGroupOr404(orgId, groupId);
    const list = await this.ensurePriceList(orgId, group);
    const rows =
      (await this.t("priceListItem")
        .findMany({ where: { priceListId: list.id }, orderBy: { createdAt: "asc" } })
        .catch(() => [])) ?? [];
    const items: any[] = [];
    for (const r of rows) {
      const product = await this.t("product")
        .findFirst({ where: { id: r.productId, organizationId: orgId } })
        .catch(() => null);
      let variant: any = null;
      if (r.variantId) {
        variant = await this.t("productVariant")
          .findFirst({ where: { id: r.variantId, productId: r.productId } })
          .catch(() => null);
      }
      items.push({
        id: r.id,
        productId: r.productId,
        variantId: r.variantId ?? null,
        priceMinor: toBig(r.priceMinor).toString(),
        productName: product?.name ?? null,
        variantName: variant?.name ?? null,
      });
    }
    return {
      group: {
        id: group.id, organizationId: group.organizationId, name: group.name,
        createdAt: group.createdAt, updatedAt: group.updatedAt,
      },
      priceListId: list.id,
      items,
    };
  }

  /** Find-first-then-write for one (product, variant) row —
   * Postgres treats NULL variantId as distinct in the unique
   * index, so a blind upsert could duplicate product-level rows. */
  private async writeItemRow(priceListId: string, productId: string, variantId: string | null, priceMinor: bigint): Promise<any> {
    const table = this.t("priceListItem");
    const existing = await table.findFirst({
      where: { priceListId, productId, variantId },
    });
    if (existing) {
      return table.update({ where: { id: existing.id }, data: { priceMinor } });
    }
    return table.create({ data: { priceListId, productId, variantId, priceMinor } });
  }

  async setItem(
    orgId: string,
    actorId: string,
    groupId: string,
    dto: { productId?: string; variantId?: string | null; priceMinor?: unknown },
  ) {
    const group = await this.loadGroupOr404(orgId, groupId);
    const productId = String(dto?.productId ?? "").trim();
    if (!productId) throw new BadRequestException("পণ্যের আইডি দিতে হবে");
    const product = await this.t("product").findFirst({
      where: { id: productId, organizationId: orgId },
    });
    if (!product) {
      throw new BadRequestException(`পণ্য পাওয়া যায়নি (এই সংস্থার নয়): ${productId}`);
    }
    let variantId: string | null = null;
    if (dto?.variantId !== undefined && dto?.variantId !== null && dto?.variantId !== "") {
      variantId = String(dto.variantId);
      const variant = await this.t("productVariant").findFirst({
        where: { id: variantId, productId },
      });
      if (!variant) {
        throw new BadRequestException("ভ্যারিয়েন্টটি এই পণ্যের নয়");
      }
    }
    const priceMinor = parsePriceMinor(dto?.priceMinor);
    const list = await this.ensurePriceList(orgId, group);
    const row = await this.writeItemRow(list.id, productId, variantId, priceMinor);
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "price_list.item_set",
      entityType: "PriceList", entityId: list.id,
      metadata: { groupId, productId, variantId, priceMinor: priceMinor.toString() },
    });
    return {
      item: {
        id: row.id, productId: row.productId, variantId: row.variantId ?? null,
        priceMinor: toBig(row.priceMinor).toString(),
        productName: product.name ?? null,
        variantName: null,
      },
    };
  }

  async removeItem(orgId: string, actorId: string, groupId: string, itemId: string) {
    await this.loadGroupOr404(orgId, groupId);
    const list = await this.findList(orgId, groupId);
    if (!list) throw new NotFoundException("প্রাইস লিস্টের আইটেমটি পাওয়া যায়নি");
    const item = await this.t("priceListItem").findFirst({
      where: { id: itemId, priceListId: list.id },
    });
    if (!item) throw new NotFoundException("প্রাইস লিস্টের আইটেমটি পাওয়া যায়নি");
    await this.t("priceListItem").delete({ where: { id: itemId } });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "price_list.item_removed",
      entityType: "PriceList", entityId: list.id,
      metadata: { groupId, itemId, productId: item.productId, variantId: item.variantId ?? null },
    });
    return { deleted: true };
  }

  /**
   * MATERIALIZE a %-off as explicit product-level rows: every
   * target product gets price = floor(catalog × (100−off)/100)
   * written over its product-level row. Nothing is computed at
   * read time afterwards — the rows ARE the prices.
   */
  async bulkPercentOff(
    orgId: string,
    actorId: string,
    groupId: string,
    dto: { percentOff?: number; productIds?: string[] },
  ) {
    const group = await this.loadGroupOr404(orgId, groupId);
    const percentOff = Number(dto?.percentOff);
    if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 99) {
      throw new BadRequestException("ছাড়ের হার ১–৯৯ শতাংশের মধ্যে হতে হবে");
    }
    let products: any[];
    if (Array.isArray(dto?.productIds) && dto.productIds.length > 0) {
      products = [];
      for (const pid of dto.productIds.slice(0, 500)) {
        const product = await this.t("product").findFirst({
          where: { id: String(pid), organizationId: orgId },
        });
        if (!product) {
          throw new BadRequestException(`পণ্য পাওয়া যায়নি (এই সংস্থার নয়): ${String(pid)}`);
        }
        products.push(product);
      }
    } else {
      products =
        (await this.t("product")
          .findMany({ where: { organizationId: orgId, status: "ACTIVE" }, take: 500 })
          .catch(() => [])) ?? [];
      products = products.slice(0, 500);
    }
    const list = await this.ensurePriceList(orgId, group);
    let written = 0;
    for (const product of products) {
      const catalog = toBig(product.priceMinor);
      const price = (catalog * BigInt(100 - percentOff)) / 100n;
      await this.writeItemRow(list.id, product.id, null, price);
      written++;
    }
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "price_list.bulk_percent",
      entityType: "PriceList", entityId: list.id,
      metadata: { groupId, percentOff, written },
    });
    return { written };
  }

  // ---------- resolution (checkout price source) ----------

  // ---------- NF7 (FB3): tier-bound price lists ----------
  // The SAME PriceList / PriceListItem machinery, bound to a
  // TierDefinition instead of a CustomerGroup (PriceList.tierId).
  // Nothing about pricing is forked: items are written through
  // the same writeItemRow, and resolution below returns the same
  // map shape through the same priceMapForCustomer door.

  private async loadTierOr404(orgId: string, tierId: string): Promise<any> {
    const row = await this.t("tierDefinition").findFirst({
      where: { id: tierId, organizationId: orgId },
    });
    if (!row) throw new NotFoundException("মেম্বারশিপ টিয়ারটি পাওয়া যায়নি");
    return row;
  }

  private async ensureTierPriceList(orgId: string, tier: any): Promise<any> {
    const table = this.t("priceList");
    const existing = await table.findFirst({ where: { tierId: tier.id } });
    if (existing) return existing;
    try {
      return await table.create({ data: { organizationId: orgId, tierId: tier.id } });
    } catch (e) {
      if (isUniqueViolation(e)) {
        const winner = await table.findFirst({ where: { tierId: tier.id } });
        if (winner) return winner;
      }
      throw e;
    }
  }

  private async serializeListItems(orgId: string, listId: string) {
    const rows =
      (await this.t("priceListItem")
        .findMany({ where: { priceListId: listId }, orderBy: { createdAt: "asc" } })
        .catch(() => [])) ?? [];
    const items: any[] = [];
    for (const r of rows) {
      const product = await this.t("product")
        .findFirst({ where: { id: r.productId, organizationId: orgId } })
        .catch(() => null);
      let variant: any = null;
      if (r.variantId) {
        variant = await this.t("productVariant")
          .findFirst({ where: { id: r.variantId, productId: r.productId } })
          .catch(() => null);
      }
      items.push({
        id: r.id,
        productId: r.productId,
        variantId: r.variantId ?? null,
        priceMinor: toBig(r.priceMinor).toString(),
        productName: product?.name ?? null,
        variantName: variant?.name ?? null,
      });
    }
    return items;
  }

  async getTierPriceList(orgId: string, tierId: string) {
    const tier = await this.loadTierOr404(orgId, tierId);
    const list = await this.ensureTierPriceList(orgId, tier);
    const items = await this.serializeListItems(orgId, list.id);
    return {
      tier: {
        id: tier.id, organizationId: tier.organizationId, name: tier.name,
        minSpendMinor: toBig(tier.minSpendMinor).toString(), sortOrder: tier.sortOrder ?? 0,
      },
      priceListId: list.id,
      items,
    };
  }

  async setTierItem(
    orgId: string,
    actorId: string,
    tierId: string,
    dto: { productId?: string; variantId?: string | null; priceMinor?: unknown },
  ) {
    const tier = await this.loadTierOr404(orgId, tierId);
    const productId = String(dto?.productId ?? "").trim();
    if (!productId) throw new BadRequestException("পণ্যের আইডি দিতে হবে");
    const product = await this.t("product").findFirst({
      where: { id: productId, organizationId: orgId },
    });
    if (!product) {
      throw new BadRequestException(`পণ্য পাওয়া যায়নি (এই সংস্থার নয়): ${productId}`);
    }
    let variantId: string | null = null;
    if (dto?.variantId !== undefined && dto?.variantId !== null && dto?.variantId !== "") {
      variantId = String(dto.variantId);
      const variant = await this.t("productVariant").findFirst({
        where: { id: variantId, productId },
      });
      if (!variant) {
        throw new BadRequestException("ভ্যারিয়েন্টটি এই পণ্যের নয়");
      }
    }
    const priceMinor = parsePriceMinor(dto?.priceMinor);
    const list = await this.ensureTierPriceList(orgId, tier);
    const row = await this.writeItemRow(list.id, productId, variantId, priceMinor);
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "price_list.tier_item_set",
      entityType: "PriceList", entityId: list.id,
      metadata: { tierId, productId, variantId, priceMinor: priceMinor.toString() },
    });
    return {
      item: {
        id: row.id, productId: row.productId, variantId: row.variantId ?? null,
        priceMinor: toBig(row.priceMinor).toString(),
        productName: product.name ?? null,
        variantName: null,
      },
    };
  }

  async removeTierItem(orgId: string, actorId: string, tierId: string, itemId: string) {
    await this.loadTierOr404(orgId, tierId);
    const list = await this.t("priceList")
      .findFirst({ where: { tierId, organizationId: orgId } })
      .catch(() => null);
    if (!list) throw new NotFoundException("প্রাইস লিস্টের আইটেমটি পাওয়া যায়নি");
    const item = await this.t("priceListItem").findFirst({
      where: { id: itemId, priceListId: list.id },
    });
    if (!item) throw new NotFoundException("প্রাইস লিস্টের আইটেমটি পাওয়া যায়নি");
    await this.t("priceListItem").delete({ where: { id: itemId } });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "price_list.tier_item_removed",
      entityType: "PriceList", entityId: list.id,
      metadata: { tierId, itemId, productId: item.productId, variantId: item.variantId ?? null },
    });
    return { deleted: true };
  }

  /**
   * The customer's price map, or null when the customer has no
   * applicable list. Resolution order (NF7 documented): a
   * CustomerGroup list wins first (a negotiated group price is
   * more specific than a membership tier); when the customer has
   * no group list, the list bound to the customer's current
   * membership tier (CustomerTier) applies. Keys are
   * `${productId}::${variantId ?? ""}`. FAILURE-ISOLATED: any
   * error resolves to null — list pricing must never break a
   * checkout.
   */
  async priceMapForCustomer(orgId: string, customerId: string | null | undefined): Promise<Map<string, bigint> | null> {
    try {
      if (!customerId) return null;
      const customer = await this.t("customer").findFirst({
        where: { id: customerId, organizationId: orgId },
      });
      if (!customer) return null;
      let list: any = null;
      if (customer.groupId) {
        list = await this.t("priceList").findFirst({
          where: { groupId: customer.groupId, organizationId: orgId },
        });
      }
      if (!list) {
        // NF7: tier-bound list for the customer's current tier.
        const ct = await this.t("customerTier")
          .findFirst({ where: { customerId: customer.id, organizationId: orgId } })
          .catch(() => null);
        if (ct?.tierId) {
          list = await this.t("priceList").findFirst({
            where: { tierId: ct.tierId, organizationId: orgId },
          });
        }
      }
      if (!list) return null;
      const rows =
        (await this.t("priceListItem").findMany({ where: { priceListId: list.id } }).catch(() => [])) ?? [];
      const map = new Map<string, bigint>();
      for (const r of rows) {
        map.set(priceKey(String(r.productId), r.variantId ?? null), toBig(r.priceMinor));
      }
      return map;
    } catch (e) {
      this.logger.warn(
        `group price resolution failed for customer ${customerId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }
}
