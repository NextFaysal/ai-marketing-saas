import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SyncOutboxService } from "./sync-outbox.service";
import {
  normalizeDiscountCode,
  parseShopifyDiscountNode,
  parseWooCoupon,
  validateDiscount,
  type DiscountValidation,
} from "./discounts";
import { decryptJson } from "../integrations/crypto";
import { WooClient } from "../integrations/woocommerce/woo.client";
import { resolveShopifyClient } from "../integrations/commerce/shopify-catalog";
import { errMsg, markDiscountSync } from "../integrations/commerce/discount-content";
import { badRequest, conflict, notFound } from "../i18n";

export interface DiscountDto {
  code?: string;
  kind?: string;
  value?: number;
  minOrderMinor?: string | null;
  scopeType?: string;
  scopeIds?: string[] | null;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
  usageLimit?: number | null;
  active?: boolean;
  storeIds?: string[];
  // GB7 (GC17)
  firstOrderOnly?: boolean;
  repeatCustomerOnly?: boolean;
  perCustomerLimit?: number | null;
  maxOrderMinor?: string | null;
  excludedProductIds?: string[] | null;
  excludedCategoryIds?: string[] | null;
  sourceRef?: string | null;
  // NF14 (FB5): app-only offer — display rule only.
  appOnly?: boolean;
}

const KINDS = ["percent", "fixed", "free_shipping"];
const SCOPE_TYPES = ["all", "products", "categories"];

/** Inline copy of adapters.platformKeyForStore (avoids an import cycle). */
function platformKeyForStore(storePlatform: string): string {
  switch (storePlatform) {
    case "WOOCOMMERCE": return "woocommerce";
    case "SHOPIFY": return "shopify";
    case "CUSTOM": return "native";
    default: return String(storePlatform ?? "").toLowerCase();
  }
}

function validateKindValue(kind: string, value: number | undefined): number {
  if (kind === "free_shipping") return 0;
  if (kind === "percent") {
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 90) {
      throw badRequest("commerce.discountPercentRange");
    }
    return value as number;
  }
  // fixed
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw badRequest("commerce.discountFixedMin");
  }
  return value as number;
}

function toDateOrNull(v: string | Date | null | undefined): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const SHOPIFY_DISCOUNT_NODES_QUERY = `query ecDiscountNodes($first: Int!, $after: String) {
  discountNodes(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        discount {
          __typename
          ... on DiscountCodeBasic {
            title startsAt endsAt usageLimit status
            codes(first: 1) { edges { node { code } } }
            customerGets {
              value {
                __typename
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } }
              }
            }
            minimumRequirement {
              __typename
              ... on DiscountMinimumSubtotal { subtotal { greaterThanOrEqualToSubtotal { amount currencyCode } } }
            }
          }
        }
      }
    }
  }
}`;

/** The parser expects greaterThanOrEqualToSubtotal as a major-unit
 *  string; the real GraphQL shape nests it as MoneyV2 — flatten it. */
function normalizeShopifyNode(node: any): any {
  try {
    const gt = node?.discount?.minimumRequirement?.subtotal?.greaterThanOrEqualToSubtotal;
    if (gt && typeof gt === "object") {
      const copy = JSON.parse(JSON.stringify(node));
      copy.discount.minimumRequirement.subtotal.greaterThanOrEqualToSubtotal = gt.amount;
      return copy;
    }
  } catch { /* fall through with the original node */ }
  return node;
}

@Injectable()
export class DiscountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: SyncOutboxService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private table(): any {
    return (this.prisma as any).storeDiscount;
  }

  serialize(d: any): any {
    if (!d) return d;
    return {
      ...d,
      minOrderMinor: d.minOrderMinor == null ? null : String(d.minOrderMinor),
      // GB7 (GC17)
      maxOrderMinor: d.maxOrderMinor == null ? null : String(d.maxOrderMinor),
      firstOrderOnly: d.firstOrderOnly ?? false,
      repeatCustomerOnly: d.repeatCustomerOnly ?? false,
      perCustomerLimit: d.perCustomerLimit ?? null,
      excludedProductIds: Array.isArray(d.excludedProductIds) ? d.excludedProductIds : [],
      excludedCategoryIds: Array.isArray(d.excludedCategoryIds) ? d.excludedCategoryIds : [],
      sourceRef: d.sourceRef ?? null,
      // NF14 (FB5): legacy rows predate the column — absent
      // reads as false (not app-only).
      appOnly: d.appOnly ?? false,
    };
  }

  /** GB7: validate exclusion ids against the org catalog at save.
   * Products must exist as Product rows of the org; categories as
   * Category rows of the org (the codebase's product-category
   * model — prisma.category, with productCategory as a fallback
   * accessor name). Unknown id → Bengali BadRequest naming the list. */
  private async validateExclusionIds(
    orgId: string,
    excludedProductIds?: string[] | null,
    excludedCategoryIds?: string[] | null,
  ): Promise<void> {
    if (excludedProductIds?.length) {
      for (const pid of excludedProductIds) {
        const p = await (this.prisma as any).product.findFirst({
          where: { id: pid, organizationId: orgId },
        });
        if (!p) {
          throw badRequest("commerce.excludedProductUnknown", { productId: pid });
        }
      }
    }
    if (excludedCategoryIds?.length) {
      const categoryTable = (this.prisma as any).category ?? (this.prisma as any).productCategory;
      for (const cid of excludedCategoryIds) {
        const c = categoryTable?.findFirst
          ? await categoryTable.findFirst({ where: { id: cid, organizationId: orgId } })
          : null;
        if (!c) {
          throw badRequest("commerce.excludedCategoryUnknown", { categoryId: cid });
        }
      }
    }
  }

  private async withSyncs(orgId: string, rows: any[]): Promise<any[]> {
    const serialized = rows.map((r) => this.serialize(r));
    if (serialized.length === 0) return serialized;
    let syncs: any[] = [];
    try {
      syncs =
        (await (this.prisma as any).storeDiscountSync.findMany({
          where: { organizationId: orgId, discountId: { in: serialized.map((s: any) => s.id) } },
        })) ?? [];
    } catch {
      syncs = [];
    }
    const storeNames = new Map<string, string>();
    try {
      const stores = (await (this.prisma as any).store.findMany({ where: { organizationId: orgId } })) ?? [];
      for (const s of stores) storeNames.set(s.id, s.name);
    } catch { /* store names are enrichment only */ }
    const byDiscount = new Map<string, any[]>();
    for (const s of syncs) {
      const arr = byDiscount.get(s.discountId) ?? [];
      arr.push({ ...s, storeName: storeNames.get(s.storeId) ?? null });
      byDiscount.set(s.discountId, arr);
    }
    for (const s of serialized) s.syncs = byDiscount.get(s.id) ?? [];
    return serialized;
  }

  private async loadOr404(orgId: string, id: string): Promise<any> {
    const row = await this.table().findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw notFound("commerce.discountNotFoundInOrg");
    return row;
  }

  async list(orgId: string, opts?: { origin?: string }) {
    const rows = (await this.table().findMany({
      where: { organizationId: orgId, ...(opts?.origin ? { origin: opts.origin } : {}) },
      orderBy: { createdAt: "desc" },
    })) ?? [];
    return { items: await this.withSyncs(orgId, rows) };
  }

  async getOne(orgId: string, id: string) {
    const row = await this.loadOr404(orgId, id);
    return (await this.withSyncs(orgId, [row]))[0];
  }

  async create(orgId: string, actorId: string, dto: DiscountDto) {
    const code = normalizeDiscountCode(dto.code ?? "");
    if (!code) throw badRequest("commerce.couponCodeRequired");
    const kind = dto.kind ?? "";
    if (!KINDS.includes(kind)) throw badRequest("commerce.discountTypeInvalid");
    const value = validateKindValue(kind, dto.value);
    const scopeType = dto.scopeType ?? "all";
    if (!SCOPE_TYPES.includes(scopeType)) throw badRequest("commerce.discountScopeInvalid");
    const dup = await this.table().findFirst({ where: { organizationId: orgId, code } });
    if (dup) throw conflict("commerce.discountCodeExists");
    await this.validateExclusionIds(orgId, dto.excludedProductIds, dto.excludedCategoryIds);
    const discount = await this.table().create({
      data: {
        organizationId: orgId,
        code,
        kind,
        value,
        minOrderMinor:
          dto.minOrderMinor !== undefined && dto.minOrderMinor !== null && dto.minOrderMinor !== ""
            ? BigInt(dto.minOrderMinor)
            : null,
        scopeType,
        scopeIds: dto.scopeIds ?? null,
        startsAt: toDateOrNull(dto.startsAt),
        endsAt: toDateOrNull(dto.endsAt),
        usageLimit: dto.usageLimit ?? null,
        usedCount: 0,
        active: true,
        origin: "manual",
        firstOrderOnly: dto.firstOrderOnly ?? false,
        repeatCustomerOnly: dto.repeatCustomerOnly ?? false,
        perCustomerLimit: dto.perCustomerLimit ?? null,
        maxOrderMinor:
          dto.maxOrderMinor !== undefined && dto.maxOrderMinor !== null && dto.maxOrderMinor !== ""
            ? BigInt(dto.maxOrderMinor)
            : null,
        excludedProductIds:
          dto.excludedProductIds && dto.excludedProductIds.length > 0 ? dto.excludedProductIds : null,
        excludedCategoryIds:
          dto.excludedCategoryIds && dto.excludedCategoryIds.length > 0 ? dto.excludedCategoryIds : null,
        sourceRef: dto.sourceRef ?? null,
        appOnly: dto.appOnly ?? false,
      },
    });
    const pushes = dto.storeIds?.length ? await this.enqueuePushes(orgId, discount, dto.storeIds) : [];
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "discount.created",
      entityType: "StoreDiscount", entityId: discount.id, metadata: { code },
    });
    return { discount: (await this.withSyncs(orgId, [discount]))[0], pushes };
  }

  async update(orgId: string, actorId: string, id: string, dto: DiscountDto) {
    const existing = await this.loadOr404(orgId, id);
    const data: Record<string, any> = {};
    if (dto.code !== undefined) {
      const code = normalizeDiscountCode(dto.code ?? "");
      if (!code) throw badRequest("commerce.couponCodeRequired");
      if (code !== existing.code) {
        const dup = await this.table().findFirst({ where: { organizationId: orgId, code } });
        if (dup && dup.id !== id) throw conflict("commerce.discountCodeExists");
      }
      data.code = code;
    }
    if (dto.kind !== undefined || dto.value !== undefined) {
      const kind = dto.kind ?? existing.kind;
      if (!KINDS.includes(kind)) throw badRequest("commerce.discountTypeInvalid");
      data.kind = kind;
      data.value = validateKindValue(kind, dto.value !== undefined ? dto.value : existing.value);
    }
    if (dto.minOrderMinor !== undefined) {
      data.minOrderMinor =
        dto.minOrderMinor === null || dto.minOrderMinor === "" ? null : BigInt(dto.minOrderMinor);
    }
    if (dto.scopeType !== undefined) {
      if (!SCOPE_TYPES.includes(dto.scopeType)) throw badRequest("commerce.discountScopeInvalid");
      data.scopeType = dto.scopeType;
    }
    if (dto.scopeIds !== undefined) data.scopeIds = dto.scopeIds;
    if (dto.startsAt !== undefined) data.startsAt = toDateOrNull(dto.startsAt);
    if (dto.endsAt !== undefined) data.endsAt = toDateOrNull(dto.endsAt);
    if (dto.usageLimit !== undefined) data.usageLimit = dto.usageLimit;
    if (dto.active !== undefined) data.active = dto.active;
    // GB7 (GC17)
    if (dto.firstOrderOnly !== undefined) data.firstOrderOnly = dto.firstOrderOnly;
    if (dto.repeatCustomerOnly !== undefined) data.repeatCustomerOnly = dto.repeatCustomerOnly;
    if (dto.perCustomerLimit !== undefined) data.perCustomerLimit = dto.perCustomerLimit;
    if (dto.maxOrderMinor !== undefined) {
      data.maxOrderMinor =
        dto.maxOrderMinor === null || dto.maxOrderMinor === "" ? null : BigInt(dto.maxOrderMinor);
    }
    if (dto.excludedProductIds !== undefined || dto.excludedCategoryIds !== undefined) {
      await this.validateExclusionIds(
        orgId,
        dto.excludedProductIds !== undefined ? dto.excludedProductIds : undefined,
        dto.excludedCategoryIds !== undefined ? dto.excludedCategoryIds : undefined,
      );
    }
    if (dto.excludedProductIds !== undefined) {
      data.excludedProductIds =
        dto.excludedProductIds && dto.excludedProductIds.length > 0 ? dto.excludedProductIds : null;
    }
    if (dto.excludedCategoryIds !== undefined) {
      data.excludedCategoryIds =
        dto.excludedCategoryIds && dto.excludedCategoryIds.length > 0 ? dto.excludedCategoryIds : null;
    }
    if (dto.sourceRef !== undefined) data.sourceRef = dto.sourceRef;
    // NF14 (FB5)
    if (dto.appOnly !== undefined) data.appOnly = dto.appOnly;
    const updated = await this.table().update({ where: { id }, data });
    const pushes = dto.storeIds?.length ? await this.enqueuePushes(orgId, updated, dto.storeIds) : [];
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "discount.updated",
      entityType: "StoreDiscount", entityId: id,
    });
    return { discount: (await this.withSyncs(orgId, [updated]))[0], pushes };
  }

  async setActive(orgId: string, actorId: string, id: string, active: boolean) {
    await this.loadOr404(orgId, id);
    const updated = await this.table().update({ where: { id }, data: { active } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "discount.toggled",
      entityType: "StoreDiscount", entityId: id, metadata: { active },
    });
    return { discount: (await this.withSyncs(orgId, [updated]))[0] };
  }

  private async enqueuePushes(orgId: string, discount: any, storeIds: string[]) {
    const results: Array<{ storeId: string; enqueued: boolean; reason?: string; outboxId?: string }> = [];
    for (const storeId of storeIds) {
      const store = await (this.prisma as any).store.findFirst({
        where: { id: storeId, organizationId: orgId },
      });
      if (!store) {
        results.push({ storeId, enqueued: false, reason: "store_not_found" });
        continue;
      }
      if (store.syncMode !== "co-manage" && store.syncMode !== "full-manage") {
        results.push({ storeId, enqueued: false, reason: "sync_mode_mirror" });
        continue;
      }
      await markDiscountSync(this.prisma as any, {
        organizationId: orgId, discountId: discount.id, storeId, syncStatus: "pending", lastError: null,
      });
      const row = await this.outbox.enqueue({
        organizationId: orgId,
        storeId,
        entityType: "discount",
        entityId: discount.id,
        operation: "push_discount",
        payload: { discountId: discount.id, storeId },
        idempotencyKey: `push_discount:${discount.id}:${storeId}:${randomUUID()}`,
      });
      results.push({ storeId, enqueued: true, outboxId: row?.id });
    }
    return results;
  }

  // ---------- pull (store -> SaaS) ----------

  private async upsertPulledDiscount(orgId: string, parsed: any, origin: string, storeId: string) {
    const existing = await this.table().findFirst({
      where: { organizationId: orgId, code: parsed.code },
    });
    let row: any;
    let action: "created" | "updated";
    if (existing) {
      row = await this.table().update({
        where: { id: existing.id },
        data: {
          kind: parsed.kind, value: parsed.value, minOrderMinor: parsed.minOrderMinor,
          endsAt: parsed.endsAt, usageLimit: parsed.usageLimit, active: parsed.active,
        },
      });
      action = "updated";
    } else {
      row = await this.table().create({
        data: {
          organizationId: orgId, code: parsed.code, kind: parsed.kind, value: parsed.value,
          minOrderMinor: parsed.minOrderMinor, endsAt: parsed.endsAt,
          usageLimit: parsed.usageLimit, active: parsed.active,
          scopeType: "all", usedCount: 0, origin,
        },
      });
      action = "created";
    }
    await markDiscountSync(this.prisma as any, {
      organizationId: orgId, discountId: row.id, storeId,
      externalId: parsed.externalId ? parsed.externalId : undefined,
      syncStatus: "synced", lastError: null,
    });
    return action;
  }

  async pullFromStore(orgId: string, actorId: string, storeId: string) {
    const store = await (this.prisma as any).store.findFirst({
      where: { id: storeId, organizationId: orgId },
    });
    if (!store) throw notFound("commerce.storeNotFoundInOrg");
    const provider = platformKeyForStore(store.platform);

    const integrationTable = (this.prisma as any).integration;
    let integration: any = null;
    if (integrationTable?.findMany) {
      const rows = (await integrationTable.findMany({
        where: { organizationId: orgId, storeId },
        include: { credential: true },
      })) ?? [];
      integration = rows.find((i: any) => i.provider === provider) ?? rows[0] ?? null;
    } else if (integrationTable?.findFirst) {
      integration = await integrationTable.findFirst({
        where: { organizationId: orgId, storeId },
        include: { credential: true },
      });
    }
    if (!integration) {
      throw badRequest("commerce.storeNoActiveIntegration");
    }

    let fetched = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    if (provider === "woocommerce") {
      const encrypted = integration?.credential?.encryptedData ?? integration?.credential?.encrypted_data ?? null;
      let creds: any = null;
      if (encrypted) {
        try { creds = decryptJson<any>(encrypted); } catch { creds = null; }
      }
      if (!creds?.consumerKey || !creds?.consumerSecret) {
        throw badRequest("commerce.wooCredentialsMissing");
      }
      const client = new WooClient(store.url, {
        consumerKey: creds.consumerKey, consumerSecret: creds.consumerSecret,
      });
      for (let page = 1; page <= 10; page++) {
        let items: any[] = [];
        try {
          const { data } = await client.get<any[]>("/coupons", { page, per_page: 100 });
          items = Array.isArray(data) ? data : [];
        } catch (e) {
          errors.push(errMsg(e));
          break;
        }
        fetched += items.length;
        for (const raw of items) {
          try {
            const parsed = parseWooCoupon(raw);
            if (!parsed.code) { skipped++; continue; }
            const action = await this.upsertPulledDiscount(orgId, parsed, "woocommerce", storeId);
            if (action === "created") created++; else updated++;
          } catch (e) {
            skipped++;
            errors.push(errMsg(e));
          }
        }
        if (items.length < 100) break;
      }
    } else if (provider === "shopify") {
      const resolved = await resolveShopifyClient({
        prisma: this.prisma as any, organizationId: orgId, store, integration, payload: {},
      });
      if ("error" in resolved) throw new BadRequestException(resolved.error);
      const client = resolved.client;
      let after: string | null = null;
      for (let page = 0; page < 10; page++) {
        let data: any;
        try {
          data = await client.request<any>(SHOPIFY_DISCOUNT_NODES_QUERY, { first: 50, after });
        } catch (e) {
          errors.push(errMsg(e));
          break;
        }
        const conn = data?.discountNodes;
        const edges: any[] = conn?.edges ?? [];
        for (const edge of edges) {
          fetched++;
          try {
            const parsed = parseShopifyDiscountNode(normalizeShopifyNode(edge?.node));
            if (!parsed) { skipped++; continue; } // automatic / BXGY etc. — not pulled, by design
            const action = await this.upsertPulledDiscount(orgId, parsed, "shopify", storeId);
            if (action === "created") created++; else updated++;
          } catch (e) {
            skipped++;
            errors.push(errMsg(e));
          }
        }
        if (!conn?.pageInfo?.hasNextPage || !conn?.pageInfo?.endCursor) break;
        after = conn.pageInfo.endCursor;
      }
    } else {
      throw badRequest("commerce.storeDiscountPullUnsupported");
    }

    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "discount.pulled",
      entityType: "Store", entityId: storeId,
      metadata: { provider, fetched, created, updated, skipped },
    });
    return { storeId, provider, fetched, created, updated, skipped, errors };
  }

  // ---------- campaign codes ----------

  async generateCampaignCodes(
    orgId: string,
    actorId: string,
    dto: {
      prefix: string; count: number; kind: string; value?: number;
      minOrderMinor?: string | null; startsAt?: string | Date | null;
      endsAt?: string | Date | null; usageLimit?: number | null;
    },
  ) {
    const count = dto.count;
    if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 500) {
      throw badRequest("commerce.countRange");
    }
    const prefix = normalizeDiscountCode(dto.prefix ?? "").replace(/[^A-Z0-9-]/g, "");
    if (!prefix || prefix.length > 16) {
      throw badRequest("commerce.prefixInvalid");
    }
    const kind = dto.kind ?? "";
    if (!KINDS.includes(kind)) throw badRequest("commerce.discountTypeInvalid");
    const value = validateKindValue(kind, dto.value);
    const minOrderMinor =
      dto.minOrderMinor !== undefined && dto.minOrderMinor !== null && dto.minOrderMinor !== ""
        ? BigInt(dto.minOrderMinor)
        : null;
    const codes: string[] = [];
    const inBatch = new Set<string>();
    let attempts = 0;
    while (codes.length < (count as number) && attempts < (count as number) * 12) {
      attempts++;
      const suffix = randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
      const code = `${prefix}-${suffix}`;
      if (inBatch.has(code)) continue;
      const existing = await this.table().findFirst({ where: { organizationId: orgId, code } });
      if (existing) continue;
      inBatch.add(code);
      await this.table().create({
        data: {
          organizationId: orgId, code, kind, value, minOrderMinor,
          scopeType: "all", scopeIds: null,
          startsAt: toDateOrNull(dto.startsAt), endsAt: toDateOrNull(dto.endsAt),
          usageLimit: dto.usageLimit ?? null, usedCount: 0, active: true, origin: "manual",
        },
      });
      codes.push(code);
    }
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "discount.campaign_generated",
      entityType: "StoreDiscount", metadata: { prefix, created: codes.length },
    });
    return { created: codes.length, codes };
  }

  // ---------- checkout ----------

  async validateForCheckout(
    orgId: string,
    code: string,
    ctx: {
      subtotalMinor: bigint;
      items: Array<{ productId?: string | null; categoryId?: string | null; totalMinor: bigint }>;
      priorOrderCount?: number | null;
      customerId?: string | null;
      excludeOrderId?: string | null;
    },
  ): Promise<DiscountValidation> {
    const row = await this.table().findFirst({
      where: { organizationId: orgId, code: normalizeDiscountCode(code) },
    });
    if (!row) return { valid: false, reason: "not_found", discountMinor: 0n, freeShipping: false };
    // GB7: per-customer usage is counted ONLY when this coupon
    // actually has a per-customer cap (stamped orders carrying
    // this code for this customer; counting set excludes
    // cancelled/failed/refunded and practice orders).
    let customerUsageCount: number | null | undefined = undefined;
    if (row.perCustomerLimit != null) {
      if (!ctx.customerId) {
        customerUsageCount = null;
      } else {
        const orderTable = (this.prisma as any).order;
        customerUsageCount = orderTable?.count
          ? await orderTable.count({
              where: {
                organizationId: orgId,
                customerId: ctx.customerId,
                couponCode: row.code,
                isPractice: false,
                status: { notIn: ["cancelled", "failed", "refunded"] },
                ...(ctx.excludeOrderId ? { id: { not: ctx.excludeOrderId } } : {}),
              },
            })
          : null;
      }
    }
    const parseIds = (v: any): string[] | null => {
      if (v == null) return null;
      if (Array.isArray(v)) return v.map((x: any) => String(x));
      if (typeof v === "string") {
        try {
          const parsed = JSON.parse(v);
          return Array.isArray(parsed) ? parsed.map((x: any) => String(x)) : null;
        } catch {
          return null;
        }
      }
      return null;
    };
    const discountForValidation = {
      ...row,
      firstOrderOnly: row.firstOrderOnly ?? false,
      repeatCustomerOnly: row.repeatCustomerOnly ?? false,
      perCustomerLimit: row.perCustomerLimit ?? null,
      maxOrderMinor: row.maxOrderMinor != null ? BigInt(row.maxOrderMinor) : null,
      excludedProductIds: parseIds(row.excludedProductIds),
      excludedCategoryIds: parseIds(row.excludedCategoryIds),
    };
    return validateDiscount(discountForValidation, {
      ...ctx,
      priorOrderCount: ctx.priorOrderCount,
      customerUsageCount,
    });
  }

  async redeem(orgId: string, discountId: string) {
    const row = await this.table().findFirst({ where: { id: discountId, organizationId: orgId } });
    if (!row) return null;
    return this.table().update({
      where: { id: discountId },
      data: { usedCount: (row.usedCount ?? 0) + 1 },
    });
  }
}
