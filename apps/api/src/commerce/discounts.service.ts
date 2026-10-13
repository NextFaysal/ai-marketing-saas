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
      throw new BadRequestException("শতাংশ ডিসকাউন্টের মান 1 থেকে 90-এর মধ্যে হতে হবে");
    }
    return value as number;
  }
  // fixed
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new BadRequestException("নির্দিষ্ট পরিমাণ ডিসকাউন্টের মান কমপক্ষে 1 হতে হবে");
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
    return { ...d, minOrderMinor: d.minOrderMinor == null ? null : String(d.minOrderMinor) };
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
    if (!row) throw new NotFoundException("Discount not found in this organization");
    return row;
  }

  async list(orgId: string) {
    const rows = (await this.table().findMany({
      where: { organizationId: orgId },
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
    if (!code) throw new BadRequestException("কুপন কোড আবশ্যক");
    const kind = dto.kind ?? "";
    if (!KINDS.includes(kind)) throw new BadRequestException("ডিসকাউন্টের ধরন সঠিক নয়");
    const value = validateKindValue(kind, dto.value);
    const scopeType = dto.scopeType ?? "all";
    if (!SCOPE_TYPES.includes(scopeType)) throw new BadRequestException("ডিসকাউন্টের scope সঠিক নয়");
    const dup = await this.table().findFirst({ where: { organizationId: orgId, code } });
    if (dup) throw new ConflictException("এই কোডে ইতিমধ্যে একটি ডিসকাউন্ট আছে");
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
      if (!code) throw new BadRequestException("কুপন কোড আবশ্যক");
      if (code !== existing.code) {
        const dup = await this.table().findFirst({ where: { organizationId: orgId, code } });
        if (dup && dup.id !== id) throw new ConflictException("এই কোডে ইতিমধ্যে একটি ডিসকাউন্ট আছে");
      }
      data.code = code;
    }
    if (dto.kind !== undefined || dto.value !== undefined) {
      const kind = dto.kind ?? existing.kind;
      if (!KINDS.includes(kind)) throw new BadRequestException("ডিসকাউন্টের ধরন সঠিক নয়");
      data.kind = kind;
      data.value = validateKindValue(kind, dto.value !== undefined ? dto.value : existing.value);
    }
    if (dto.minOrderMinor !== undefined) {
      data.minOrderMinor =
        dto.minOrderMinor === null || dto.minOrderMinor === "" ? null : BigInt(dto.minOrderMinor);
    }
    if (dto.scopeType !== undefined) {
      if (!SCOPE_TYPES.includes(dto.scopeType)) throw new BadRequestException("ডিসকাউন্টের scope সঠিক নয়");
      data.scopeType = dto.scopeType;
    }
    if (dto.scopeIds !== undefined) data.scopeIds = dto.scopeIds;
    if (dto.startsAt !== undefined) data.startsAt = toDateOrNull(dto.startsAt);
    if (dto.endsAt !== undefined) data.endsAt = toDateOrNull(dto.endsAt);
    if (dto.usageLimit !== undefined) data.usageLimit = dto.usageLimit;
    if (dto.active !== undefined) data.active = dto.active;
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
    if (!store) throw new NotFoundException("Store not found in this organization");
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
      throw new BadRequestException("এই স্টোরের কোনো সক্রিয় integration পাওয়া যায়নি");
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
        throw new BadRequestException("woo_credentials_missing");
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
      throw new BadRequestException("এই স্টোরের platform থেকে ডিসকাউন্ট টানা যায় না");
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
      throw new BadRequestException("count 1 থেকে 500-এর মধ্যে হতে হবে");
    }
    const prefix = normalizeDiscountCode(dto.prefix ?? "").replace(/[^A-Z0-9-]/g, "");
    if (!prefix || prefix.length > 16) {
      throw new BadRequestException("prefix সঠিক নয় (সর্বোচ্চ 16 অক্ষর)");
    }
    const kind = dto.kind ?? "";
    if (!KINDS.includes(kind)) throw new BadRequestException("ডিসকাউন্টের ধরন সঠিক নয়");
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
    ctx: { subtotalMinor: bigint; items: Array<{ productId?: string | null; categoryId?: string | null; totalMinor: bigint }> },
  ): Promise<DiscountValidation> {
    const row = await this.table().findFirst({
      where: { organizationId: orgId, code: normalizeDiscountCode(code) },
    });
    if (!row) return { valid: false, reason: "not_found", discountMinor: 0n, freeShipping: false };
    return validateDiscount(row, ctx);
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
