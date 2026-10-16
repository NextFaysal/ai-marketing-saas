import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { BundleItemInput } from "./ec29-bundles";
import type { BundleDto } from "./commerce.dto";

/**
 * EC29 — staff Bundles CRUD + the public/storefront read models.
 * A bundle is a named SET of existing products (stored as a Json
 * items array on the Bundle row) sold for one bundlePriceMinor.
 * Components are always resolved against CURRENT product/variant
 * rows — a bundle never stores prices for its components.
 */
@Injectable()
export class BundlesService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private table(): any {
    return (this.prisma as any).bundle;
  }

  private slotTable(): any {
    return (this.prisma as any).bundleSlot;
  }

  /**
   * AB5 (AX8): slots of a bundle, in display order. `bundle` may
   * be a bundle id or a bundle row; a row carrying an embedded
   * `slots` array (an include-shaped read) is the fallback when
   * the slot table yields nothing.
   */
  async loadSlots(orgId: string, bundle: any): Promise<any[]> {
    const bundleId = typeof bundle === "string" ? bundle : bundle?.id;
    if (!bundleId) return [];
    const table = this.slotTable();
    if (table?.findMany) {
      const rows = await table
        .findMany({
          where: { bundleId, organizationId: orgId },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        })
        .catch(() => null);
      if (Array.isArray(rows) && rows.length > 0) return rows;
      if (Array.isArray(rows)) {
        // Table answered (possibly empty) — only fall back to an
        // embedded array when the table is genuinely absent.
        if (!Array.isArray(bundle?.slots)) return rows;
        if (rows.length === 0 && bundle.slots.length === 0) return rows;
      }
    }
    return Array.isArray(bundle?.slots) ? bundle.slots : [];
  }

  /**
   * AB5 (AX8): the CURRENT option pool of one slot.
   * - "category": ACTIVE products of the org with that
   *   categoryId, capped at 60.
   * - "products": the listed products that still exist in the
   *   org AND are ACTIVE, in listed order.
   * Picks are product-level in v1: variantSku is always null —
   * a pick names a PRODUCT; if the product has variants the
   * pick resolves the product itself at the product price.
   */
  async slotPool(orgId: string, slot: any): Promise<any[]> {
    if (slot?.sourceType === "category") {
      const categoryId = slot?.sourceRef?.categoryId;
      if (typeof categoryId !== "string" || !categoryId) return [];
      const table = (this.prisma as any).product;
      if (!table?.findMany) return [];
      const rows = await table
        .findMany({
          where: { organizationId: orgId, categoryId, status: "ACTIVE" },
          orderBy: [{ createdAt: "asc" }],
          take: 60,
        })
        .catch(() => []);
      return rows ?? [];
    }
    if (slot?.sourceType === "products") {
      const ids: any[] = Array.isArray(slot?.sourceRef?.productIds)
        ? slot.sourceRef.productIds
        : [];
      const out: any[] = [];
      for (const productId of ids) {
        const product = await (this.prisma as any).product
          .findFirst({ where: { id: productId, organizationId: orgId } })
          .catch(() => null);
        if (product && product.status === "ACTIVE") out.push(product);
      }
      return out;
    }
    return [];
  }

  /** One slot in the wire shape shared by staff + shop payloads. */
  async serializeSlot(orgId: string, slot: any): Promise<any> {
    const pool = await this.slotPool(orgId, slot).catch(() => []);
    return {
      id: slot.id ?? null,
      label: slot.label,
      chooseQty: Number(slot.chooseQty ?? 1),
      sourceType: slot.sourceType,
      sourceRef: slot.sourceRef ?? null,
      options: pool.map((p: any) => ({
        productId: p.id,
        name: p.name ?? null,
        imageUrl: p.imageUrl ?? null,
        variantSku: null,
        regularUnitMinor: p.priceMinor != null ? String(p.priceMinor) : "0",
      })),
    };
  }

  async serializeSlots(orgId: string, bundle: any): Promise<any[]> {
    const slots = await this.loadSlots(orgId, bundle).catch(() => []);
    const out: any[] = [];
    for (const slot of slots) out.push(await this.serializeSlot(orgId, slot));
    return out;
  }

  /**
   * AB5 (AX8): validate + normalize raw slots. Each slot:
   * { label (required, ≤120), chooseQty int 1..20,
   *   sourceType "category"|"products", sourceRef } —
   * category → { categoryId } must be an org Category row;
   * products → { productIds } 1..50 ids, all org products.
   * A bundle's total slots ≤ 6. `bundleId` is accepted for
   * call-site symmetry (create passes null — no row exists yet).
   */
  async validateSlots(orgId: string, bundleId: string | null, rawSlots: unknown): Promise<any[]> {
    void bundleId;
    if (!Array.isArray(rawSlots)) {
      throw new BadRequestException("বান্ডলের স্লটের তালিকা দিতে হবে");
    }
    if (rawSlots.length > 6) {
      throw new BadRequestException("বান্ডলে সর্বোচ্চ ৬টি স্লট থাকতে পারবে");
    }
    const out: any[] = [];
    for (let i = 0; i < rawSlots.length; i++) {
      const entry: any = (rawSlots as any[])[i] ?? {};
      const label = typeof entry.label === "string" ? entry.label.trim() : "";
      if (!label) throw new BadRequestException("প্রতিটি স্লটের লেবেল আবশ্যক");
      if (label.length > 120) {
        throw new BadRequestException("স্লটের লেবেল সর্বোচ্চ ১২০ অক্ষরের হতে পারবে");
      }
      const chooseQty = entry.chooseQty;
      if (!Number.isInteger(chooseQty) || chooseQty < 1 || chooseQty > 20) {
        throw new BadRequestException(`"${label}" স্লটে বেছে নেওয়ার সংখ্যা ১–২০ হতে হবে`);
      }
      const sourceType = entry.sourceType;
      if (sourceType !== "category" && sourceType !== "products") {
        throw new BadRequestException(`"${label}" স্লটের ধরন সঠিক নয়`);
      }
      let sourceRef: any;
      if (sourceType === "category") {
        const categoryId = entry.sourceRef?.categoryId;
        if (typeof categoryId !== "string" || !categoryId) {
          throw new BadRequestException(`"${label}" স্লটের জন্য ক্যাটাগরি বেছে নিন`);
        }
        const catTable = (this.prisma as any).category ?? (this.prisma as any).productCategory;
        const cat = catTable?.findFirst
          ? await catTable
              .findFirst({ where: { id: categoryId, organizationId: orgId } })
              .catch(() => null)
          : null;
        if (!cat) {
          throw new BadRequestException(`"${label}" স্লটের ক্যাটাগরি পাওয়া যায়নি (এই সংস্থার নয়)`);
        }
        sourceRef = { categoryId };
      } else {
        const rawIds = entry.sourceRef?.productIds;
        if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > 50) {
          throw new BadRequestException(`"${label}" স্লটে ১–৫০টি পণ্য দিতে হবে`);
        }
        const productIds: string[] = [];
        for (const pid of rawIds) {
          if (typeof pid !== "string" || !pid) {
            throw new BadRequestException(`"${label}" স্লটের প্রতিটি পণ্যের আইডি দিতে হবে`);
          }
          if (!productIds.includes(pid)) productIds.push(pid);
        }
        for (const pid of productIds) {
          const product = await (this.prisma as any).product
            .findFirst({ where: { id: pid, organizationId: orgId } })
            .catch(() => null);
          if (!product) {
            throw new BadRequestException(`"${label}" স্লটের পণ্য পাওয়া যায়নি (এই সংস্থার নয়): ${pid}`);
          }
        }
        sourceRef = { productIds };
      }
      out.push({ label, chooseQty, sourceType, sourceRef, sortOrder: i });
    }
    return out;
  }

  /** Wholesale-replace a bundle's slots with normalized rows. */
  private async replaceSlots(orgId: string, bundleId: string, normalized: any[]): Promise<void> {
    const table = this.slotTable();
    if (!table?.create) return;
    if (table.deleteMany) {
      await table.deleteMany({ where: { bundleId, organizationId: orgId } });
    } else if (table.findMany && table.delete) {
      const existing = await table
        .findMany({ where: { bundleId, organizationId: orgId } })
        .catch(() => []);
      for (const row of existing ?? []) {
        await table.delete({ where: { id: row.id } }).catch(() => undefined);
      }
    }
    for (let i = 0; i < normalized.length; i++) {
      const s = normalized[i];
      await table.create({
        data: {
          organizationId: orgId,
          bundleId,
          label: s.label,
          chooseQty: s.chooseQty,
          sourceType: s.sourceType,
          sourceRef: s.sourceRef,
          sortOrder: s.sortOrder ?? i,
        },
      });
    }
  }

  /**
   * AB5 (AX8): validate a buyer's picks against the bundle's
   * CURRENT slots + pools. Returns normalized picks
   * [{ slotId, productId }] in slot order, or throws a Bengali
   * BadRequest. Rules: a slotted bundle REQUIRES every slot be
   * satisfied exactly (picks per slot == chooseQty, each product
   * in that slot's current pool and ACTIVE, no duplicate
   * product within one slot, unknown slots refused); a slotless
   * bundle refuses any picks.
   */
  async validatePicks(orgId: string, bundle: any, picks: unknown): Promise<any[]> {
    const slots = await this.loadSlots(orgId, bundle).catch(() => []);
    const hasPicks = Array.isArray(picks) ? picks.length > 0 : picks != null;
    if (slots.length === 0) {
      if (hasPicks) {
        throw new BadRequestException("এই বান্ডলে কোনো স্লট নেই — এতে পিক দেওয়া যাবে না");
      }
      return [];
    }
    if (!Array.isArray(picks) || picks.length === 0) {
      throw new BadRequestException(
        `বান্ডলের "${slots[0].label}" স্লটের জন্য পণ্য বেছে নিন`,
      );
    }
    const slotById = new Map<string, any>(slots.map((s: any) => [String(s.id), s]));
    const bySlot = new Map<string, any[]>();
    for (const raw of picks as any[]) {
      const slotId = raw?.slotId;
      const productId = raw?.productId;
      if (typeof slotId !== "string" || !slotId || typeof productId !== "string" || !productId) {
        throw new BadRequestException("প্রতিটি পিকের স্লট ও পণ্যের আইডি দিতে হবে");
      }
      const slot = slotById.get(slotId);
      if (!slot) {
        throw new BadRequestException("পিকে অজানা স্লট দেওয়া হয়েছে — এই বান্ডলে সেই স্লট নেই");
      }
      const list = bySlot.get(slotId) ?? [];
      list.push({ slotId, productId });
      bySlot.set(slotId, list);
    }
    const normalized: any[] = [];
    for (const slot of slots) {
      const list = bySlot.get(String(slot.id)) ?? [];
      if (list.length !== Number(slot.chooseQty ?? 1)) {
        throw new BadRequestException(
          `"${slot.label}" স্লট থেকে ঠিক ${Number(slot.chooseQty ?? 1)}টি পণ্য বেছে নিন`,
        );
      }
      const seen = new Set<string>();
      for (const pick of list) {
        if (seen.has(pick.productId)) {
          throw new BadRequestException(`"${slot.label}" স্লটে একই পণ্য দুবার বেছে নেওয়া যাবে না`);
        }
        seen.add(pick.productId);
      }
      // Pool membership is the ACTIVE check too: slotPool only
      // ever returns ACTIVE products of this org.
      const pool = await this.slotPool(orgId, slot);
      const poolIds = new Set(pool.map((p: any) => String(p.id)));
      for (const pick of list) {
        if (!poolIds.has(pick.productId)) {
          throw new BadRequestException(
            `"${slot.label}" স্লটে এই পণ্যটি বেছে নেওয়া যাবে না (পণ্যটি পাওয়া যাচ্ছে না বা সক্রিয় নয়)`,
          );
        }
        normalized.push(pick);
      }
    }
    return normalized;
  }

  /**
   * AB5 (AX8): fixed components PLUS one component per pick.
   * PRICING RULE: the bundle price stays the merchant-set
   * bundlePriceMinor REGARDLESS of picks — slots are
   * choice-within-price. Each pick contributes ONE component
   * unit (qty 1) to the same allocateBundle expansion,
   * weighted by its regular price like a fixed item.
   */
  async resolveComponentsWithPicks(orgId: string, bundle: any, picks: unknown): Promise<any[]> {
    const fixed = await this.resolveComponents(orgId, bundle);
    if (!Array.isArray(picks) || picks.length === 0) return fixed;
    const slots = await this.loadSlots(orgId, bundle).catch(() => []);
    const slotById = new Map<string, any>(slots.map((s: any) => [String(s.id), s]));
    const out = [...fixed];
    for (const pick of picks as any[]) {
      const product = await (this.prisma as any).product
        .findFirst({ where: { id: pick?.productId, organizationId: orgId } })
        .catch(() => null);
      const regularUnitMinor =
        product?.priceMinor != null ? BigInt(product.priceMinor) : 0n;
      const slot = slotById.get(String(pick?.slotId ?? ""));
      out.push({
        productId: pick?.productId,
        name: product?.name ?? null,
        product: product ?? null,
        variant: null,
        variantSku: null,
        qty: 1,
        regularUnitMinor,
        slotId: pick?.slotId ?? null,
        slotLabel: slot?.label ?? null,
      });
    }
    return out;
  }

  private async loadOr404(orgId: string, id: string): Promise<any> {
    const row = await this.table().findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException("Bundle not found in this organization");
    return row;
  }

  /**
   * Validate + normalize raw bundle items. 2..10 entries; every
   * product must exist in THIS org; a given variantSku must
   * resolve to a variant of that product; the same
   * (productId, variantSku) pair may not repeat.
   */
  async validateItems(orgId: string, raw: unknown): Promise<BundleItemInput[]> {
    if (!Array.isArray(raw)) {
      throw new BadRequestException("বান্ডলে পণ্যের তালিকা দিতে হবে");
    }
    if (raw.length < 2) {
      throw new BadRequestException("বান্ডলে কমপক্ষে ২টি পণ্য থাকতে হবে");
    }
    if (raw.length > 10) {
      throw new BadRequestException("বান্ডলে সর্বোচ্চ ১০টি পণ্য থাকতে পারবে");
    }
    const seen = new Set<string>();
    const out: BundleItemInput[] = [];
    for (const entry of raw as any[]) {
      const productId = entry?.productId;
      if (typeof productId !== "string" || !productId) {
        throw new BadRequestException("বান্ডলের প্রতিটি পণ্যের আইডি দিতে হবে");
      }
      const qty = entry?.qty;
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        throw new BadRequestException("বান্ডলের প্রতিটি পণ্যের পরিমাণ ১–৯৯ হতে হবে");
      }
      let variantSku: string | null = null;
      if (entry?.variantSku !== null && entry?.variantSku !== undefined && entry?.variantSku !== "") {
        if (typeof entry.variantSku !== "string" || entry.variantSku.length > 100) {
          throw new BadRequestException("বান্ডলের ভ্যারিয়েন্ট SKU সঠিক নয়");
        }
        variantSku = entry.variantSku;
      }
      const pairKey = `${productId}::${variantSku ?? ""}`;
      if (seen.has(pairKey)) {
        throw new BadRequestException("একই পণ্য/ভ্যারিয়েন্ট বান্ডলে দুবার দেওয়া যাবে না");
      }
      seen.add(pairKey);
      const product = await (this.prisma as any).product.findFirst({
        where: { id: productId, organizationId: orgId },
      });
      if (!product) {
        throw new BadRequestException(`পণ্য পাওয়া যায়নি (এই সংস্থার নয়): ${productId}`);
      }
      if (variantSku) {
        const variantTable = (this.prisma as any).productVariant;
        const variant = variantTable?.findFirst
          ? await variantTable
              .findFirst({ where: { productId, sku: variantSku } })
              .catch(() => null)
          : null;
        if (!variant) {
          throw new BadRequestException("বান্ডলের ভ্যারিয়েন্ট SKU পাওয়া যায়নি");
        }
      }
      out.push({ productId, variantSku, qty });
    }
    return out;
  }

  /**
   * Resolve a bundle's stored items against CURRENT rows.
   * regularUnitMinor = variant price when a variant resolves,
   * else the product price, else 0 (unresolvable component).
   */
  async resolveComponents(orgId: string, bundle: any): Promise<any[]> {
    const items: any[] = Array.isArray(bundle?.items) ? bundle.items : [];
    const out: any[] = [];
    for (const item of items) {
      const product = await (this.prisma as any).product
        .findFirst({ where: { id: item.productId, organizationId: orgId } })
        .catch(() => null);
      let variant: any = null;
      if (item.variantSku) {
        const variantTable = (this.prisma as any).productVariant;
        variant = variantTable?.findFirst
          ? await variantTable
              .findFirst({ where: { productId: item.productId, sku: item.variantSku } })
              .catch(() => null)
          : null;
      }
      const regularUnitMinor =
        variant?.priceMinor != null
          ? BigInt(variant.priceMinor)
          : product?.priceMinor != null
            ? BigInt(product.priceMinor)
            : 0n;
      out.push({
        productId: item.productId,
        name: product?.name ?? null,
        product: product ?? null,
        variant: variant ?? null,
        variantSku: item.variantSku ?? null,
        qty: Number(item.qty ?? 0),
        regularUnitMinor,
      });
    }
    return out;
  }

  private async serialize(bundle: any): Promise<any> {
    const comps = await this.resolveComponents(bundle.organizationId, bundle);
    const regularTotalMinor = comps.reduce(
      (s, c) => s + c.regularUnitMinor * BigInt(c.qty),
      0n,
    );
    return {
      ...bundle,
      bundlePriceMinor: bundle.bundlePriceMinor != null ? String(bundle.bundlePriceMinor) : "0",
      items: Array.isArray(bundle.items) ? bundle.items : [],
      regularTotalMinor: regularTotalMinor.toString(),
      hasMissingComponents: comps.some((c) => !c.product),
      // AB5 (AX8): slots with their CURRENT pools resolved, so
      // the shop/staff UI never re-derives pools.
      slots: await this.serializeSlots(bundle.organizationId, bundle).catch(() => []),
    };
  }

  private parseBundlePrice(raw: unknown): bigint {
    const s = raw === null || raw === undefined ? "" : String(raw).trim();
    if (!/^\d+$/.test(s) || BigInt(s) <= 0n) {
      throw new BadRequestException("বান্ডলের দাম সঠিক ধনাত্মক সংখ্যা হতে হবে");
    }
    return BigInt(s);
  }

  async list(orgId: string) {
    const rows =
      (await this.table().findMany({
        where: { organizationId: orgId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      })) ?? [];
    const items = [];
    for (const r of rows) items.push(await this.serialize(r));
    return { items };
  }

  async getOne(orgId: string, id: string) {
    // Mirrors PromotionsService.getOne: the serialized row itself.
    return this.serialize(await this.loadOr404(orgId, id));
  }

  async create(orgId: string, actorId: string, dto: BundleDto) {
    const name = String(dto.name ?? "").trim();
    if (!name) throw new BadRequestException("বান্ডলের নাম আবশ্যক");
    const bundlePriceMinor = this.parseBundlePrice(dto.bundlePriceMinor);
    const items = await this.validateItems(orgId, dto.items);
    // AB5 (AX8): slots present (incl. []) are validated BEFORE
    // any write, then created with the bundle.
    const hasSlots = (dto as any).slots !== undefined;
    const normalizedSlots = hasSlots
      ? await this.validateSlots(orgId, null, (dto as any).slots)
      : null;
    const row = await this.table().create({
      data: {
        organizationId: orgId,
        name,
        description: dto.description ?? null,
        imageUrl: dto.imageUrl ?? null,
        items,
        bundlePriceMinor,
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    if (normalizedSlots) await this.replaceSlots(orgId, row.id, normalizedSlots);
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "bundle.created",
      entityType: "Bundle", entityId: row.id, metadata: { name },
    });
    return { bundle: await this.serialize(row) };
  }

  async update(orgId: string, actorId: string, id: string, dto: BundleDto) {
    const existing = await this.loadOr404(orgId, id);
    const data: Record<string, any> = {};
    if (dto.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) throw new BadRequestException("বান্ডলের নাম আবশ্যক");
      data.name = name;
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.items !== undefined) data.items = await this.validateItems(orgId, dto.items);
    if (dto.bundlePriceMinor !== undefined) data.bundlePriceMinor = this.parseBundlePrice(dto.bundlePriceMinor);
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    void existing;
    // AB5 (AX8): slots present (incl. []) REPLACE the bundle's
    // slots wholesale in the same call, validated first; when
    // absent, slots are untouched.
    const hasSlots = (dto as any).slots !== undefined;
    const normalizedSlots = hasSlots
      ? await this.validateSlots(orgId, id, (dto as any).slots)
      : null;
    const updated = await this.table().update({ where: { id }, data });
    if (normalizedSlots) await this.replaceSlots(orgId, id, normalizedSlots);
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "bundle.updated",
      entityType: "Bundle", entityId: id,
    });
    return { bundle: await this.serialize(updated) };
  }

  async setActive(orgId: string, actorId: string, id: string, active: boolean) {
    await this.loadOr404(orgId, id);
    const updated = await this.table().update({ where: { id }, data: { active } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "bundle.toggled",
      entityType: "Bundle", entityId: id, metadata: { active },
    });
    return { bundle: await this.serialize(updated) };
  }

  async remove(orgId: string, actorId: string, id: string) {
    await this.loadOr404(orgId, id);
    await this.table().delete({ where: { id } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "bundle.deleted",
      entityType: "Bundle", entityId: id,
    });
    return { deleted: true };
  }

  /**
   * Public shop payload: ACTIVE bundles whose EVERY component
   * resolves to an ACTIVE product (a bundle with any missing /
   * inactive component is excluded entirely — never shown
   * half-broken).
   */
  async publicBundles(orgId: string): Promise<any[]> {
    const rows =
      (await this.table()
        .findMany({
          where: { organizationId: orgId, active: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        })
        .catch(() => [])) ?? [];
    const out: any[] = [];
    for (const bundle of rows) {
      const comps = await this.resolveComponents(orgId, bundle);
      // AB5 (AX8): the same slots shape as the staff serialize.
      const slots = await this.serializeSlots(orgId, bundle).catch(() => []);
      // A slots-only bundle (no fixed items) is still a real
      // bundle — only a bundle with NEITHER is empty.
      if (comps.length === 0 && slots.length === 0) continue;
      if (comps.some((c) => !c.product || c.product.status !== "ACTIVE")) continue;
      const regularTotalMinor = comps.reduce(
        (s, c) => s + c.regularUnitMinor * BigInt(c.qty),
        0n,
      );
      const bundlePriceMinor = BigInt(bundle.bundlePriceMinor ?? 0);
      out.push({
        id: bundle.id,
        name: bundle.name,
        description: bundle.description ?? null,
        imageUrl: bundle.imageUrl ?? null,
        bundlePriceMinor: bundlePriceMinor.toString(),
        regularTotalMinor: regularTotalMinor.toString(),
        savingsMinor:
          regularTotalMinor > bundlePriceMinor
            ? (regularTotalMinor - bundlePriceMinor).toString()
            : null,
        components: comps.map((c) => ({
          productId: c.productId,
          name: c.product.name,
          variantSku: c.variantSku,
          qty: c.qty,
          unitPriceMinor: c.regularUnitMinor.toString(),
        })),
        slots,
      });
    }
    return out;
  }
}
