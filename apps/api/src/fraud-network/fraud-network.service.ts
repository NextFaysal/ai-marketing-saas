import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { normalizeBdPhone, phoneDigits } from "../orders/phone-utils";
import { classifyOutcome } from "../orders/risk-score";

/**
 * NF13 (FB5) — Platform Fraud Network. PRIVACY IS THE PRODUCT.
 *
 * What crosses orgs: ONLY an HMAC-SHA256 hash of a phone number
 * plus aggregate counters (delivered / returned-failed / COD
 * refusals + how many DISTINCT orgs contributed). Never a raw
 * phone, never a name, order detail or message. The shared
 * aggregate table (FraudNetworkPhoneStat) carries no org id at
 * all; the org-side ledger (FraudNetworkContribution) stores
 * the hash only, never a raw phone.
 *
 * KEY DISCIPLINE: the hash key is process.env
 * .FRAUD_NETWORK_HMAC_KEY, read on EVERY call (never cached).
 * If the key is ABSENT the whole feature is inert: the settings
 * view reports available:false, enabling REFUSES with an honest
 * Bengali BadRequest, and contribute/lookup return
 * "unavailable". There is NEVER a fallback to plain SHA or a
 * hardcoded key.
 *
 * CONSENT DISCIPLINE: contribution happens only for orgs whose
 * FraudNetworkSetting.enabled is true AND only for orders
 * created at/after setting.enabledAt — NO pre-consent backfill,
 * ever: an order created before opt-in never contributes, even
 * if it terminates after opt-in. Disabling stops future
 * contributions immediately; re-enabling stamps a NEW
 * enabledAt, so orders created during the disabled window never
 * contribute either (the createdAt rule).
 *
 * EXACTLY-ONCE: FraudNetworkContribution is unique per
 * (organizationId, orderId); a second contribute/sweep for the
 * same order moves no counter. contributingOrgCount increments
 * ONLY when this org has no prior contribution row for the
 * phone hash (DISTINCT orgs, not orders).
 *
 * SUPPRESSION FLOOR: a lookup exposes counts only when at
 * least 3 distinct orgs contributed for that phone; below the
 * floor it returns insufficient_data with the org count only —
 * NEVER the delivered/returned counts.
 *
 * TRIGGER: the fraud_network_sweep automation job is the ONLY
 * trigger (plus direct service calls in specs / staff tooling).
 * No order/courier flow is forked to call this.
 */

export const FRAUD_NETWORK_MIN_ORGS = 3;

export const FRAUD_NETWORK_UNAVAILABLE_BN =
  "এই সুবিধাটি সার্ভারে এখনো চালু হয়নি — সার্ভারে প্রয়োজনীয় কী (HMAC key) সেট করা হয়নি, তাই ফ্রড নেটওয়ার্ক চালু করা যাচ্ছে না।";

export type FraudNetworkLookupResult =
  | { status: "unavailable" }
  | { status: "not_opted_in" }
  | { status: "insufficient_data"; contributingOrgCount: number }
  | {
      status: "ok";
      delivered: number;
      returnedFailed: number;
      codRefusals: number;
      contributingOrgCount: number;
      total: number;
    };

export type ContributeResult =
  | { contributed: true; outcome: string }
  | { contributed: false; reason: string };

/** Canonical phone for hashing: the strict BD normal form when
 * the number parses as one; otherwise the digit string when it
 * carries at least 10 digits; otherwise null (no contribution /
 * lookup is possible for such a value). */
export function canonicalFraudPhone(raw: unknown): string | null {
  const normalized = normalizeBdPhone(raw);
  if (normalized) return normalized;
  const digits = phoneDigits(raw);
  if (digits.length >= 10) return digits;
  return null;
}

/** HMAC-SHA256 hex of the canonical phone. Returns null when
 * the key is absent or the phone has no canonical form. The
 * key is read from the environment on every call. */
export function hashFraudPhone(raw: unknown, key?: string): string | null {
  const k = key ?? process.env.FRAUD_NETWORK_HMAC_KEY;
  if (!k) return null;
  const canonical = canonicalFraudPhone(raw);
  if (!canonical) return null;
  return createHmac("sha256", k).update(canonical).digest("hex");
}

/** Outcome → counter deltas. Terminal outcomes only; "open"
 * contributes nothing (handled by the caller). refunded counts
 * as returned/failed, exactly like returned; a COD
 * cancelledOrFailed additionally counts as a COD refusal (it is
 * a subset of returnedFailed, never an extra total). */
export function fraudOutcomeDeltas(
  outcome: string,
  isCod: boolean,
): { delivered: number; returnedFailed: number; codRefusals: number } | null {
  switch (outcome) {
    case "delivered":
      return { delivered: 1, returnedFailed: 0, codRefusals: 0 };
    case "returned":
    case "refunded":
      return { delivered: 0, returnedFailed: 1, codRefusals: 0 };
    case "cancelledOrFailed":
      return { delivered: 0, returnedFailed: 1, codRefusals: isCod ? 1 : 0 };
    default:
      return null;
  }
}

@Injectable()
export class FraudNetworkService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private db(): any {
    return this.prisma as any;
  }

  isAvailable(): boolean {
    return Boolean(process.env.FRAUD_NETWORK_HMAC_KEY);
  }

  // ---------- settings ----------

  private async loadSettingRow(orgId: string): Promise<any | null> {
    const table = this.db().fraudNetworkSetting;
    if (!table) return null;
    if (table.findUnique) {
      const row = await table
        .findUnique({ where: { organizationId: orgId } })
        .catch(() => null);
      if (row) return row;
    }
    if (table.findFirst) {
      return table
        .findFirst({ where: { organizationId: orgId } })
        .catch(() => null);
    }
    return null;
  }

  /** Settings view. Never carries any phone data. explainerSeen
   * is derived: an org that has ever enabled (enabledAt set)
   * has been shown the explainer that the web card renders
   * before the toggle can be used. */
  async getSettings(orgId: string) {
    const row = await this.loadSettingRow(orgId);
    return {
      available: this.isAvailable(),
      enabled: row?.enabled === true,
      enabledAt: row?.enabledAt ?? null,
      enabledById: row?.enabledById ?? null,
      explainerSeen: Boolean(row?.enabledAt),
    };
  }

  async updateSettings(orgId: string, actorId: string, dto: { enabled?: unknown }) {
    if (typeof dto?.enabled !== "boolean") {
      throw new BadRequestException("enabled boolean হতে হবে");
    }
    const enabling = dto.enabled === true;
    if (enabling && !this.isAvailable()) {
      throw new BadRequestException(FRAUD_NETWORK_UNAVAILABLE_BN);
    }
    const table = this.db().fraudNetworkSetting;
    const current = await this.loadSettingRow(orgId);
    const now = new Date();
    // Enabling stamps a FRESH enabledAt (the consent moment the
    // createdAt rule rides). Disabling keeps the last enabledAt
    // as history but flips enabled off, which alone blocks every
    // future contribution until a re-enable stamps a new one.
    const data: Record<string, unknown> = enabling
      ? { enabled: true, enabledAt: now, enabledById: actorId }
      : { enabled: false };
    let row: any = current;
    if (table) {
      if (current && table.update) {
        // Real rows key by id; the org-scoped fake keys by
        // organizationId — try id first, then the unique key.
        row = await table
          .update({ where: { id: current.id }, data })
          .catch(async () =>
            table
              .update({ where: { organizationId: orgId }, data })
              .catch(() => ({ ...current, ...data })),
          );
      } else if (table.upsert) {
        row = await table
          .upsert({
            where: { organizationId: orgId },
            create: { organizationId: orgId, ...data },
            update: data,
          })
          .catch(() => ({ ...current, ...data }));
      } else if (table.create) {
        row = await table
          .create({ data: { organizationId: orgId, ...data } })
          .catch(() => ({ ...current, ...data }));
      }
    }
    await this.audit
      ?.log({
        organizationId: orgId,
        userId: actorId,
        action: enabling
          ? "fraud_network.enabled"
          : "fraud_network.disabled",
        entityType: "FraudNetworkSetting",
        entityId: row?.id ?? orgId,
        metadata: {},
      })
      .catch(() => undefined);
    return this.getSettings(orgId);
  }

  // ---------- phone resolution (RiskService.loadOrgData order) ----------

  /** customer.phone → first shipment recipientPhone →
   * conversation contactPhone. Returns the phone plus the
   * order's shipment statuses (for outcome classification). */
  private async resolveOrderFacts(
    orgId: string,
    order: any,
  ): Promise<{ phone: string | null; shipmentStatuses: string[] }> {
    let shipments: any[] = [];
    try {
      shipments =
        (await this.db().courierShipment?.findMany({
          where: { organizationId: orgId, orderId: order.id },
        }).catch(() => [])) ?? [];
    } catch {
      shipments = [];
    }
    const shipmentStatuses = (shipments ?? []).map((s: any) =>
      String(s.status),
    );
    try {
      let customer = order?.customer ?? null;
      if (!customer?.phone && order?.customerId) {
        customer = await this.db()
          .customer?.findFirst({
            where: { id: order.customerId, organizationId: orgId },
          })
          .catch(() => null);
      }
      if (customer?.phone) {
        return { phone: String(customer.phone), shipmentStatuses };
      }
    } catch {
      /* fall through */
    }
    const shipPhone = (shipments ?? [])
      .map((s: any) => s.recipientPhone)
      .find(Boolean);
    if (shipPhone) return { phone: String(shipPhone), shipmentStatuses };
    try {
      if (order?.conversationId) {
        const conv = await this.db()
          .channelConversation?.findFirst({
            where: { id: order.conversationId, organizationId: orgId },
          })
          .catch(() => null);
        if (conv?.contactPhone) {
          return { phone: String(conv.contactPhone), shipmentStatuses };
        }
      }
    } catch {
      /* fall through */
    }
    return { phone: null, shipmentStatuses };
  }

  // ---------- contribution ----------

  async contributeForOrder(
    orgId: string,
    orderId: string,
  ): Promise<ContributeResult> {
    if (!this.isAvailable()) {
      return { contributed: false, reason: "unavailable" };
    }
    const setting = await this.loadSettingRow(orgId);
    if (!setting || setting.enabled !== true) {
      return { contributed: false, reason: "not_opted_in" };
    }
    if (!setting.enabledAt) {
      return { contributed: false, reason: "not_opted_in" };
    }
    const enabledAt = new Date(setting.enabledAt).getTime();

    const contribTable = this.db().fraudNetworkContribution;
    if (contribTable?.findFirst) {
      const existing = await contribTable
        .findFirst({ where: { organizationId: orgId, orderId } })
        .catch(() => null);
      if (existing) {
        return { contributed: false, reason: "already_contributed" };
      }
    }

    const order = await this.db()
      .order?.findFirst({
        where: { id: orderId, organizationId: orgId },
        include: { customer: true },
      })
      .catch(() => null);
    if (!order) return { contributed: false, reason: "order_not_found" };

    const createdAt = new Date(order.createdAt ?? 0).getTime();
    if (Number.isNaN(createdAt) || createdAt < enabledAt) {
      // NO pre-consent backfill — an order created before the
      // org opted in never contributes, even if it terminates
      // after opt-in.
      return { contributed: false, reason: "pre_consent" };
    }

    const { phone, shipmentStatuses } = await this.resolveOrderFacts(
      orgId,
      order,
    );
    if (!phone) return { contributed: false, reason: "no_phone" };
    const phoneHash = hashFraudPhone(phone);
    if (!phoneHash) return { contributed: false, reason: "no_phone" };

    const outcome = classifyOutcome({
      status: String(order.status ?? ""),
      isCod: Boolean(order.isCod),
      shipmentStatuses,
    });
    const deltas = fraudOutcomeDeltas(outcome, Boolean(order.isCod));
    if (!deltas) return { contributed: false, reason: "open" };

    // DISTINCT-org check BEFORE this contribution lands: has
    // this org ever contributed for this phone hash before?
    let hasPriorForPhone = false;
    if (contribTable?.findFirst) {
      hasPriorForPhone = Boolean(
        await contribTable
          .findFirst({
            where: { organizationId: orgId, phoneHash },
          })
          .catch(() => null),
      );
    }

    // Claim the (org, order) exactly-once row first — the
    // unique constraint is the authority on a replay/race.
    try {
      await contribTable.create({
        data: {
          organizationId: orgId,
          orderId,
          phoneHash,
          outcome,
        },
      });
    } catch {
      return { contributed: false, reason: "already_contributed" };
    }

    // Merge into the shared aggregate (read-modify-write; the
    // sweep is serial per org and the claim row above already
    // guarantees this order is counted once).
    const statTable = this.db().fraudNetworkPhoneStat;
    let stat: any = null;
    if (statTable?.findUnique) {
      stat = await statTable
        .findUnique({ where: { phoneHash } })
        .catch(() => null);
    }
    if (!stat && statTable?.findFirst) {
      stat = await statTable
        .findFirst({ where: { phoneHash } })
        .catch(() => null);
    }
    const orgDelta = hasPriorForPhone ? 0 : 1;
    if (!stat) {
      await statTable.create({
        data: {
          phoneHash,
          contributingOrgCount: orgDelta,
          deliveredCount: deltas.delivered,
          returnedFailedCount: deltas.returnedFailed,
          codRefusalCount: deltas.codRefusals,
        },
      });
    } else {
      await statTable.update({
        where: { phoneHash },
        data: {
          contributingOrgCount:
            Number(stat.contributingOrgCount ?? 0) + orgDelta,
          deliveredCount: Number(stat.deliveredCount ?? 0) + deltas.delivered,
          returnedFailedCount:
            Number(stat.returnedFailedCount ?? 0) + deltas.returnedFailed,
          codRefusalCount:
            Number(stat.codRefusalCount ?? 0) + deltas.codRefusals,
        },
      });
    }
    return { contributed: true, outcome };
  }

  // ---------- consumption ----------

  async lookup(orgId: string, phone: unknown): Promise<FraudNetworkLookupResult> {
    if (!this.isAvailable()) return { status: "unavailable" };
    const setting = await this.loadSettingRow(orgId);
    if (!setting || setting.enabled !== true) {
      return { status: "not_opted_in" };
    }
    const phoneHash = hashFraudPhone(phone);
    if (!phoneHash) {
      return { status: "insufficient_data", contributingOrgCount: 0 };
    }
    const statTable = this.db().fraudNetworkPhoneStat;
    let stat: any = null;
    if (statTable?.findUnique) {
      stat = await statTable
        .findUnique({ where: { phoneHash } })
        .catch(() => null);
    }
    if (!stat && statTable?.findFirst) {
      stat = await statTable
        .findFirst({ where: { phoneHash } })
        .catch(() => null);
    }
    const orgCount = Number(stat?.contributingOrgCount ?? 0);
    if (!stat || orgCount < FRAUD_NETWORK_MIN_ORGS) {
      // Suppression floor: below 3 contributing orgs the counts
      // are NEVER returned — only how many orgs contributed.
      return { status: "insufficient_data", contributingOrgCount: orgCount };
    }
    const delivered = Number(stat.deliveredCount ?? 0);
    const returnedFailed = Number(stat.returnedFailedCount ?? 0);
    return {
      status: "ok",
      delivered,
      returnedFailed,
      codRefusals: Number(stat.codRefusalCount ?? 0),
      contributingOrgCount: orgCount,
      total: delivered + returnedFailed,
    };
  }

  /** Lookup for an order's own phone (FraudShield sibling
   * signal). Failure-isolated by the caller; returns the raw
   * lookup result — the caller decides opt-in visibility. */
  async lookupForOrder(orgId: string, order: any) {
    const { phone } = await this.resolveOrderFacts(orgId, order);
    if (!phone) {
      return { status: "insufficient_data", contributingOrgCount: 0 } as FraudNetworkLookupResult;
    }
    return this.lookup(orgId, phone);
  }

  // ---------- sweep (fraud_network_sweep — the ONLY trigger) ----------

  /**
   * Scans THIS org's terminal orders not yet contributed and
   * calls contributeForOrder for each. Per-order failures are
   * COLLECTED into the result (never silent, never aborting the
   * sweep). A non-opted-in org and an unavailable deployment
   * are honest skips, reported as such.
   */
  async runSweep(orgId: string) {
    const out = {
      checked: 0,
      contributed: 0,
      skipped: 0,
      failures: [] as { orderId: string; error: string }[],
    };
    if (!this.isAvailable()) {
      return { ...out, skippedReason: "unavailable" as const };
    }
    const setting = await this.loadSettingRow(orgId);
    if (!setting || setting.enabled !== true) {
      return { ...out, skippedReason: "not_opted_in" as const };
    }
    const orders: any[] =
      (await this.db()
        .order?.findMany({
          where: { organizationId: orgId },
          orderBy: { createdAt: "asc" },
          take: 5000,
        })
        .catch(() => [])) ?? [];
    const contributedRows: any[] =
      (await this.db()
        .fraudNetworkContribution?.findMany({
          where: { organizationId: orgId },
        })
        .catch(() => [])) ?? [];
    const done = new Set(contributedRows.map((r: any) => String(r.orderId)));
    const shipments: any[] =
      (await this.db()
        .courierShipment?.findMany({
          where: { organizationId: orgId },
          take: 5000,
        })
        .catch(() => [])) ?? [];
    const shipByOrder = new Map<string, string[]>();
    for (const s of shipments ?? []) {
      const list = shipByOrder.get(String(s.orderId)) ?? [];
      list.push(String(s.status));
      shipByOrder.set(String(s.orderId), list);
    }
    for (const order of orders) {
      if (done.has(String(order.id))) continue;
      const outcome = classifyOutcome({
        status: String(order.status ?? ""),
        isCod: Boolean(order.isCod),
        shipmentStatuses: shipByOrder.get(String(order.id)) ?? [],
      });
      if (outcome === "open") continue;
      out.checked += 1;
      try {
        const res = await this.contributeForOrder(orgId, String(order.id));
        if (res.contributed) out.contributed += 1;
        else out.skipped += 1;
      } catch (e) {
        out.failures.push({
          orderId: String(order.id),
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return out;
  }
}
