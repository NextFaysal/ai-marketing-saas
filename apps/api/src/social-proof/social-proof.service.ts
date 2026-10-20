import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { isSoldOrder } from "../storefront/ec27-discovery";
import { parseBdAddress } from "../orders/bd-address";
import type { UpdateSocialProofSettingDto } from "./social-proof.dto";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * AB7 (AX17) — social-proof popups fed by REAL orders only.
 *
 * Privacy by construction: the public feed is built field by
 * field and can only ever emit { buyerFirstName, district,
 * productName, hoursAgo } per item. Amounts, order numbers/ids,
 * phone numbers and customer ids are never read into the payload
 * shape, so they cannot leak. The buyer's name is reduced to the
 * FIRST whitespace token of the customer's first name (shop
 * checkout stores the shopper's full name in Customer.firstName,
 * so the token split is load-bearing, not cosmetic).
 *
 * "Sold" is the canonical EC33 definition — isSoldOrder from
 * storefront/ec27-discovery, the same predicate ON2 / EC33 / GB6
 * surfaces use: not a dead status (cancelled / refunded /
 * failed) AND delivered-proven (status completed / delivered, or
 * a CourierShipment in delivered / partial_delivered). No new
 * status set is invented here.
 *
 * Failure isolation (deliberate): once the org slug has resolved
 * and the setting is enabled, ANY error while building the feed
 * degrades to { enabled: true, config, items: [] } instead of a
 * 500 — a marketing popup must never break the shop page. The
 * only 404 is an unknown slug, raised before the isolation
 * boundary.
 */

const SETTING_DEFAULTS = {
  enabled: false,
  lookbackHours: 24,
  intervalSec: 25,
  displaySec: 6,
  maxPerSession: 5,
  minTotalMinor: null as string | null,
  impressions: 0,
};

const FEED_CAP = 10;

function intInRange(v: unknown, min: number, max: number, label: string): number {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) {
    throw badRequest("socialProof.mustBeAnIntegerBetweenAnd", { label: label, min: min, max: max });
  }
  return v as number;
}

function parseMinTotalMinor(v: unknown): bigint | null {
  if (v === null) return null;
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^\d+$/.test(s)) {
    throw badRequest("socialProof.theMinimumOrderValueMintotalminorMust");
  }
  return BigInt(s);
}

function totalMinorOf(order: any): bigint {
  try {
    return BigInt(String(order?.totalMinor ?? 0));
  } catch {
    return 0n;
  }
}

function effectiveDateOf(order: any): Date | null {
  const d = new Date(order?.placedAt ?? order?.createdAt ?? 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Injectable()
export class SocialProofService {
  private readonly logger = new Logger(SocialProofService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  // ================= Staff: setting =================

  private serializeSetting(row: any | null, organizationId: string) {
    return {
      organizationId,
      enabled: row?.enabled ?? SETTING_DEFAULTS.enabled,
      lookbackHours: row?.lookbackHours ?? SETTING_DEFAULTS.lookbackHours,
      intervalSec: row?.intervalSec ?? SETTING_DEFAULTS.intervalSec,
      displaySec: row?.displaySec ?? SETTING_DEFAULTS.displaySec,
      maxPerSession: row?.maxPerSession ?? SETTING_DEFAULTS.maxPerSession,
      minTotalMinor:
        row?.minTotalMinor !== null && row?.minTotalMinor !== undefined
          ? String(row.minTotalMinor)
          : null,
      impressions: row?.impressions ?? SETTING_DEFAULTS.impressions,
    };
  }

  private async settingRow(orgId: string): Promise<any | null> {
    try {
      const table = this.t("socialProofSetting");
      if (!table?.findFirst) return null;
      return (await table.findFirst({ where: { organizationId: orgId } }).catch(() => null)) ?? null;
    } catch {
      return null;
    }
  }

  /** The org's setting; schema defaults when no row exists yet. */
  async getSetting(orgId: string) {
    const row = await this.settingRow(orgId);
    return { setting: this.serializeSetting(row, orgId) };
  }

  async updateSetting(orgId: string, actorId: string, dto: UpdateSocialProofSettingDto) {
    const data: Record<string, any> = {};
    if (dto.enabled !== undefined) {
      if (typeof dto.enabled !== "boolean") {
        throw badRequest("socialProof.enabledMustBeTrueOrFalse");
      }
      data.enabled = dto.enabled;
    }
    if (dto.lookbackHours !== undefined) data.lookbackHours = intInRange(dto.lookbackHours, 1, 168, "lookbackHours");
    if (dto.intervalSec !== undefined) data.intervalSec = intInRange(dto.intervalSec, 5, 300, "intervalSec");
    if (dto.displaySec !== undefined) data.displaySec = intInRange(dto.displaySec, 2, 30, "displaySec");
    if (dto.maxPerSession !== undefined) data.maxPerSession = intInRange(dto.maxPerSession, 1, 20, "maxPerSession");
    if (dto.minTotalMinor !== undefined) data.minTotalMinor = parseMinTotalMinor(dto.minTotalMinor);

    const existing = await this.settingRow(orgId);
    const saved = existing
      ? await this.t("socialProofSetting").update({ where: { id: existing.id }, data })
      : await this.t("socialProofSetting").create({ data: { organizationId: orgId, ...data } });
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "social_proof.setting_updated",
      entityType: "SocialProofSetting",
      entityId: saved.id,
      metadata: { fields: Object.keys(data) },
    });
    return { setting: this.serializeSetting(saved, orgId) };
  }

  // ================= Public: feed =================

  private async findOrgBySlug(orgSlug: string): Promise<any | null> {
    if (!orgSlug) return null;
    return this.t("organization").findFirst({ where: { slug: orgSlug } });
  }

  /**
   * The order's district, derived exactly like
   * inventory.service's districtOfOrder (itself mirroring
   * fulfillment-excellence): structured Customer.address.district
   * first, else parseBdAddress over the address text (customer
   * address, falling back to the text Order.address captured in
   * chat). parseBdAddress only returns a district on a high /
   * medium confidence match, so an unknown district stays null —
   * never guessed.
   */
  private districtOfOrder(order: any): string | null {
    try {
      const customer = order?.customer ?? null;
      const address = customer?.address ?? null;
      if (address && typeof address === "object" && address.district) return String(address.district);
      let text = "";
      if (typeof address === "string") text = address;
      else if (address && typeof address === "object") text = String(address.address_1 ?? address.address1 ?? "");
      if (!text) {
        const own = order?.address;
        if (typeof own === "string") text = own;
        else if (own && typeof own === "object") {
          if (own.district) return String(own.district);
          text = String(own.address_1 ?? own.address1 ?? "");
        }
      }
      if (!text) return null;
      return parseBdAddress(text).district;
    } catch {
      return null;
    }
  }

  /** First token of the customer's first name; null when the
   * order has no resolvable buyer name (the item is then skipped
   * — a name is never fabricated). */
  private buyerFirstNameOf(customer: any): string | null {
    const first = typeof customer?.firstName === "string" ? customer.firstName.trim() : "";
    if (!first) return null;
    return first.split(/\s+/)[0] || null;
  }

  private async buildItems(orgId: string, setting: any): Promise<any[]> {
    const lookbackHours = setting.lookbackHours ?? SETTING_DEFAULTS.lookbackHours;
    const sinceMs = Date.now() - lookbackHours * 3600 * 1000;
    const minTotal: bigint | null =
      setting.minTotalMinor !== null && setting.minTotalMinor !== undefined
        ? (() => { try { return BigInt(String(setting.minTotalMinor)); } catch { return null; } })()
        : null;

    // Non-practice orders of the org; the lookback window is
    // applied on the effective date (placedAt ?? createdAt) in
    // JS — the same load shape as storefront's soldOrderItems.
    const orders: any[] =
      (await this.t("order").findMany({ where: { organizationId: orgId, isPractice: false } })) ?? [];
    const candidates = orders
      .map((o) => ({ order: o, at: effectiveDateOf(o) }))
      .filter((c) => c.at !== null && c.at.getTime() >= sinceMs)
      .filter((c) => minTotal === null || totalMinorOf(c.order) >= minTotal)
      .sort((a, b) => (b.at as Date).getTime() - (a.at as Date).getTime());
    if (candidates.length === 0) return [];

    // Courier-shipment statuses for the EC33 sold predicate.
    let shipments: any[] = [];
    try {
      const table = this.t("courierShipment");
      if (table?.findMany) {
        shipments =
          (await table.findMany({ where: { orderId: { in: candidates.map((c) => c.order.id) } } }).catch(() => [])) ?? [];
      }
    } catch { shipments = []; }
    const statusesByOrder = new Map<string, string[]>();
    for (const s of shipments) {
      const arr = statusesByOrder.get(String(s.orderId)) ?? [];
      arr.push(String(s.status));
      statusesByOrder.set(String(s.orderId), arr);
    }

    const sold = candidates
      .filter((c) => isSoldOrder(c.order, statusesByOrder.get(String(c.order.id)) ?? []))
      .slice(0, FEED_CAP);
    if (sold.length === 0) return [];

    // First order item per sold order (snapshot name).
    let itemRows: any[] = [];
    try {
      const table = this.t("orderItem");
      if (table?.findMany) {
        itemRows =
          (await table.findMany({ where: { orderId: { in: sold.map((c) => c.order.id) } } }).catch(() => [])) ?? [];
      }
    } catch { itemRows = []; }
    const firstItemByOrder = new Map<string, any>();
    for (const item of itemRows) {
      const key = String(item.orderId);
      if (!firstItemByOrder.has(key)) firstItemByOrder.set(key, item);
    }

    // Customers for the sold orders (inline relation when the
    // row carries one, else a batch load by customerId).
    const missingCustomerIds = [
      ...new Set(
        sold
          .filter((c) => !c.order.customer && c.order.customerId)
          .map((c) => String(c.order.customerId)),
      ),
    ];
    const customerById = new Map<string, any>();
    if (missingCustomerIds.length > 0) {
      try {
        const table = this.t("customer");
        if (table?.findMany) {
          const rows: any[] =
            (await table.findMany({ where: { id: { in: missingCustomerIds }, organizationId: orgId } }).catch(() => [])) ?? [];
          for (const row of rows) customerById.set(String(row.id), row);
        }
      } catch { /* names then resolve as missing → items skipped */ }
    }

    const now = Date.now();
    const items: any[] = [];
    for (const c of sold) {
      const customer = c.order.customer ?? (c.order.customerId ? customerById.get(String(c.order.customerId)) : null);
      const buyerFirstName = this.buyerFirstNameOf(customer);
      const firstItem = firstItemByOrder.get(String(c.order.id));
      const productName = typeof firstItem?.name === "string" && firstItem.name.trim() ? firstItem.name : null;
      // An item without a real buyer first name or a real first
      // product name is skipped — never padded with filler.
      if (!buyerFirstName || !productName) continue;
      items.push({
        buyerFirstName,
        district: this.districtOfOrder({ ...c.order, customer }),
        productName,
        hoursAgo: Math.max(0, Math.floor((now - (c.at as Date).getTime()) / 3600000)),
      });
    }
    return items;
  }

  async getPublicFeed(orgSlug: string) {
    const org = await this.findOrgBySlug(orgSlug);
    if (!org) throw notFound("socialProof.theShopWasNotFound");
    const setting = await this.settingRow(org.id);
    if (!setting || setting.enabled !== true) return { enabled: false };
    const config = {
      intervalSec: setting.intervalSec ?? SETTING_DEFAULTS.intervalSec,
      displaySec: setting.displaySec ?? SETTING_DEFAULTS.displaySec,
      maxPerSession: setting.maxPerSession ?? SETTING_DEFAULTS.maxPerSession,
    };
    // Failure isolation (see class doc): a broken feed read must
    // never 500 the shop — the popup simply shows nothing.
    let items: any[] = [];
    try {
      items = await this.buildItems(org.id, setting);
    } catch (e) {
      this.logger.warn(`social-proof feed failed for org ${org.id}: ${(e as Error)?.message ?? e}`);
      items = [];
    }
    return { enabled: true, config, items };
  }

  /**
   * Impression counter. DESIGN DECISION: a DEDICATED lightweight
   * counter endpoint on SocialProofSetting.impressions — not the
   * GC1 popup-event recorder (StorefrontService.recordPopupEvent),
   * whose StorePopup row/kinds ("impression" | "click" on the
   * offer popup) belong to a different setting model; reusing it
   * would count social-proof views against the wrong popup. The
   * posture is the same as recordPopupEvent: ALWAYS { ok: true }
   * — unknown slug, missing row or a failed increment never
   * surface as an error to a shopper.
   */
  async recordImpression(orgSlug: string) {
    try {
      const org = await this.findOrgBySlug(orgSlug);
      if (org) {
        const row = await this.settingRow(org.id);
        if (row) {
          await this.t("socialProofSetting")
            .update({ where: { id: row.id }, data: { impressions: { increment: 1 } } })
            .catch(() => null);
        }
      }
    } catch { /* swallowed by design */ }
    return { ok: true };
  }
}
