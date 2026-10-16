import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { seal, unseal } from "../common/platform-config";

/**
 * AB5 (AX9) — LicenseKeysService: the per-product pool of vendor
 * license keys for digital products whose digitalDeliveryType is
 * "license" or "both".
 *
 * Key hygiene (the GiftCard pattern, with ONE deliberate
 * difference):
 *  - The canonical key is the EXACT trimmed string, CASE-SENSITIVE.
 *    Vendor license keys are case-sensitive bearer secrets —
 *    "AbC-123" and "abc-123" are DIFFERENT keys — unlike gift-card
 *    codes, which this codebase canonicalises case-insensitively
 *    because they are generated in a grouped, human-typed format.
 *    Normalising case here would silently collide distinct vendor
 *    keys and hand a buyer someone else's key.
 *  - keyHash = SHA-256 hex of the canonical key — the lookup /
 *    dedupe key. keySealed = seal(canonical) via
 *    common/platform-config (the only recoverable copy, unsealed
 *    ONLY for the entitled buyer's reveal). keyLast4 is the only
 *    fragment staff surfaces ever see; no response from this
 *    service ever carries keyHash or keySealed.
 *  - Assignment is exactly-once per (assignedItemId, unitIndex)
 *    (the schema carries a unique constraint on that pair as the
 *    backstop): claiming goes through a conditional updateMany
 *    (status "available" -> "assigned") so two concurrent reveals
 *    can never claim the same pool row for two buyers.
 *  - There is no separate delivery event choke point for native
 *    digital orders, so assignment happens in StorefrontService's
 *    digitalAccess reveal — the digitalDelivered gate there IS
 *    the delivery proof, exactly where AB2's gift-card reveal
 *    also lives (see ensureAssignedForOrder's caller comment).
 */

const MAX_IMPORT_LINES = 500;
const LICENSE_DELIVERY_TYPES = new Set(["license", "both"]);

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /unique|P2002/i.test(msg);
}

/** The staff-safe wire shape — NEVER keyHash / keySealed. */
function serializeKey(row: any) {
  return {
    id: row.id,
    productId: row.productId,
    keyLast4: row.keyLast4,
    status: row.status,
    assignedOrderId: row.assignedOrderId ?? null,
    assignedItemId: row.assignedItemId ?? null,
    unitIndex: row.unitIndex ?? null,
    assignedAt: row.assignedAt ?? null,
    revokedAt: row.revokedAt ?? null,
    importBatch: row.importBatch ?? null,
    createdAt: row.createdAt ?? null,
  };
}

@Injectable()
export class LicenseKeysService {
  private readonly logger = new Logger(LicenseKeysService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  private async safeAudit(
    input: Parameters<AuditService["log"]>[0],
  ): Promise<void> {
    try {
      await this.audit?.log(input);
    } catch {
      /* audit is best-effort, like the neighbouring services */
    }
  }

  private async countWhere(table: any, where: any): Promise<number> {
    if (table?.count) {
      const n = await table.count({ where }).catch(() => 0);
      return Number(n) || 0;
    }
    if (table?.findMany) {
      const rows = (await table.findMany({ where }).catch(() => [])) ?? [];
      return rows.length;
    }
    return 0;
  }

  // ================= staff: import =================

  async importKeys(
    orgId: string,
    actorId: string,
    productId: string,
    dto: { text: string; batch?: string },
  ) {
    const product = await this.t("product")
      .findFirst({ where: { id: productId, organizationId: orgId } })
      .catch(() => null);
    if (!product) {
      throw new BadRequestException("পণ্যটি পাওয়া যায়নি");
    }
    if (!product.digital) {
      throw new BadRequestException(
        "শুধুমাত্র ডিজিটাল পণ্যের জন্য লাইসেন্স কী ইমপোর্ট করা যায়",
      );
    }

    const rawLines = String(dto?.text ?? "").split(/\r?\n/);
    const entries: Array<{ lineNo: number; canonical: string }> = [];
    const invalidLines: number[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const canonical = rawLines[i].trim();
      if (!canonical) continue; // blank lines are skipped, not invalid
      // Minimum length 4: keyLast4 must be a real fragment and a
      // shorter string is not a plausible vendor key.
      if (canonical.length < 4) {
        invalidLines.push(i + 1); // 1-based line in the submission
        continue;
      }
      entries.push({ lineNo: i + 1, canonical });
    }
    if (entries.length + invalidLines.length > MAX_IMPORT_LINES) {
      throw new BadRequestException(
        `একবারে সর্বোচ্চ ${MAX_IMPORT_LINES}টি কী ইমপোর্ট করা যায়`,
      );
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const autoBatch = `IMP-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const importBatch = String(dto?.batch ?? "").trim() || autoBatch;

    // Duplicates WITHIN the submission (exact canonical match).
    const seen = new Set<string>();
    const duplicatesLast4: string[] = [];
    let duplicateCount = 0;
    const noteDuplicate = (canonical: string) => {
      duplicateCount += 1;
      if (duplicatesLast4.length < 20) {
        duplicatesLast4.push(canonical.slice(-4));
      }
    };
    const uniqueEntries: Array<{ lineNo: number; canonical: string }> = [];
    for (const entry of entries) {
      if (seen.has(entry.canonical)) {
        noteDuplicate(entry.canonical);
        continue;
      }
      seen.add(entry.canonical);
      uniqueEntries.push(entry);
    }

    // Duplicates AGAINST the pool: ONE findMany on the hash list.
    const hashes = uniqueEntries.map((e) => sha256Hex(e.canonical));
    const existingRows: any[] =
      hashes.length && this.t("licenseKey")?.findMany
        ? ((await this.t("licenseKey")
            .findMany({
              where: {
                organizationId: orgId,
                productId,
                keyHash: { in: hashes },
              },
            })
            .catch(() => [])) ?? [])
        : [];
    const existingHashes = new Set(
      existingRows.map((r: any) => String(r.keyHash)),
    );

    let imported = 0;
    for (const entry of uniqueEntries) {
      const keyHash = sha256Hex(entry.canonical);
      if (existingHashes.has(keyHash)) {
        noteDuplicate(entry.canonical);
        continue;
      }
      try {
        await this.t("licenseKey").create({
          data: {
            organizationId: orgId,
            productId,
            keyHash,
            keySealed: seal(entry.canonical),
            keyLast4: entry.canonical.slice(-4),
            status: "available",
            importBatch,
            createdById: actorId,
          },
        });
        imported += 1;
      } catch (e) {
        // A concurrent import won the (org, product, keyHash)
        // unique race — that is a duplicate, not a failure.
        if (isUniqueViolation(e)) {
          noteDuplicate(entry.canonical);
          continue;
        }
        throw e;
      }
    }

    await this.safeAudit({
      organizationId: orgId,
      userId: actorId,
      action: "license_keys.imported",
      entityType: "Product",
      entityId: productId,
      metadata: { productId, imported, duplicates: duplicateCount },
    });

    return {
      imported,
      duplicateCount,
      invalidCount: invalidLines.length,
      batch: importBatch,
      duplicatesLast4,
      invalidLines: invalidLines.slice(0, 20),
    };
  }

  // ================= staff: list / summary / revoke =================

  async listKeys(
    orgId: string,
    opts: { productId?: string; status?: string; take?: number } = {},
  ) {
    const takeRaw = Number(opts.take);
    const take =
      Number.isFinite(takeRaw) && takeRaw > 0
        ? Math.min(Math.floor(takeRaw), 500)
        : 100;
    const where: Record<string, unknown> = { organizationId: orgId };
    if (opts.productId) where.productId = opts.productId;
    if (opts.status) where.status = opts.status;
    const table = this.t("licenseKey");
    const rows: any[] =
      (table?.findMany
        ? ((await table
            .findMany({
              where,
              orderBy: [{ createdAt: "desc" }],
              take,
            })
            .catch(() => [])) ?? [])
        : []);
    // Masked by construction: serializeKey picks fields, so the
    // hash / sealed columns can never leak through this surface.
    return { keys: rows.map(serializeKey) };
  }

  async poolSummary(orgId: string, productId: string) {
    const table = this.t("licenseKey");
    const [available, assigned, revoked] = await Promise.all([
      this.countWhere(table, {
        organizationId: orgId,
        productId,
        status: "available",
      }),
      this.countWhere(table, {
        organizationId: orgId,
        productId,
        status: "assigned",
      }),
      this.countWhere(table, {
        organizationId: orgId,
        productId,
        status: "revoked",
      }),
    ]);
    return { available, assigned, revoked };
  }

  async revokeKey(orgId: string, actorId: string, keyId: string) {
    const row = await this.t("licenseKey")
      .findFirst({ where: { id: keyId, organizationId: orgId } })
      .catch(() => null);
    if (!row) throw new NotFoundException("লাইসেন্স কীটি পাওয়া যায়নি");
    if (row.status === "revoked") return serializeKey(row);
    // Revoking an ASSIGNED key removes it from the buyer reveal
    // (the reveal reads status="assigned" only) — it cannot
    // un-see a key the buyer already copied, and we say so:
    // revocation stops FUTURE reveals, it is not a recall of a
    // key already in the buyer's hands.
    const updated = await this.t("licenseKey").update({
      where: { id: row.id },
      data: { status: "revoked", revokedAt: new Date() },
    });
    await this.safeAudit({
      organizationId: orgId,
      userId: actorId,
      action: "license_key.revoked",
      entityType: "LicenseKey",
      entityId: row.id,
      metadata: { productId: row.productId, wasStatus: row.status },
    });
    return serializeKey(updated ?? { ...row, status: "revoked" });
  }

  // ================= buyer assignment / reveal =================

  /**
   * Claim (or re-read) the keys for every license-delivering line
   * of an order. Idempotent: an existing assignment for
   * (item, unitIndex) is returned as-is, so a second reveal hands
   * the buyer the SAME keys and drains nothing further.
   *
   * A key that fails to unseal is skipped from the reveal (warn
   * logged, no key material in it) and does NOT count as assigned
   * for the buyer — the gift-card buyerReveal posture.
   */
  async ensureAssignedForOrder(orgId: string, order: any) {
    let items: any[] = Array.isArray(order?.items) ? order.items : [];
    if (!Array.isArray(order?.items)) {
      try {
        const table = this.t("orderItem");
        if (table?.findMany) {
          items =
            (await table
              .findMany({ where: { orderId: order.id } })
              .catch(() => [])) ?? [];
        }
      } catch {
        items = [];
      }
    }

    const byItem: Array<{
      itemId: string;
      productName: string;
      keys: Array<{ unitIndex: number; key: string; keyLast4: string }>;
    }> = [];
    const shortages: Array<{
      itemId: string;
      productName: string;
      needed: number;
      assigned: number;
    }> = [];

    for (const item of items) {
      if (!item?.productId) continue;
      const product = await this.t("product")
        .findFirst({ where: { id: item.productId, organizationId: orgId } })
        .catch(() => null);
      if (!product?.digital) continue;
      const deliveryType = String(product.digitalDeliveryType ?? "file");
      if (!LICENSE_DELIVERY_TYPES.has(deliveryType)) continue;

      const productName = String(product.name ?? item.name ?? "");
      const needed = Math.max(0, Number(item.quantity ?? 1) || 0);
      const keys: Array<{
        unitIndex: number;
        key: string;
        keyLast4: string;
      }> = [];

      for (let unitIndex = 0; unitIndex < needed; unitIndex++) {
        const existing = await this.t("licenseKey")
          .findFirst({
            where: {
              organizationId: orgId,
              assignedItemId: item.id,
              unitIndex,
              status: "assigned",
            },
          })
          .catch(() => null);
        let row: any = existing;

        if (!row) {
          const candidates: any[] =
            (await this.t("licenseKey")
              .findMany({
                where: {
                  organizationId: orgId,
                  productId: product.id,
                  status: "available",
                },
                take: 5,
                orderBy: [{ createdAt: "asc" }],
              })
              .catch(() => [])) ?? [];
          for (const candidate of candidates) {
            try {
              const claimed = await this.t("licenseKey").updateMany({
                where: { id: candidate.id, status: "available" },
                data: {
                  status: "assigned",
                  assignedOrderId: order.id,
                  assignedItemId: item.id,
                  unitIndex,
                  assignedAt: new Date(),
                },
              });
              if (Number(claimed?.count ?? 0) === 1) {
                row = {
                  ...candidate,
                  status: "assigned",
                  assignedOrderId: order.id,
                  assignedItemId: item.id,
                  unitIndex,
                };
                break;
              }
            } catch (e) {
              // The (assignedItemId, unitIndex) unique backstop
              // fired: another reveal claimed this unit first.
              // Re-read it below via the reveal loop's next call;
              // for THIS call the unit counts as unclaimed here.
              if (isUniqueViolation(e)) break;
              throw e;
            }
          }
        }

        if (!row) continue; // pool shortage for this unit
        const key = unseal(row.keySealed);
        if (!key) {
          this.logger.warn(
            `license key unseal failed for key ${row.id} — skipped from buyer reveal`,
          );
          continue;
        }
        keys.push({
          unitIndex,
          key,
          keyLast4: row.keyLast4 ?? key.slice(-4),
        });
      }

      byItem.push({ itemId: item.id, productName, keys });
      if (keys.length < needed) {
        shortages.push({
          itemId: item.id,
          productName,
          needed,
          assigned: keys.length,
        });
      }
    }

    return { byItem, shortages };
  }

  /**
   * Read-only variant of ensureAssignedForOrder: existing
   * assignments only, no claiming. (The buyer reveal itself uses
   * ensureAssignedForOrder — assignment happens at the
   * delivery-gated reveal; this variant exists for read surfaces
   * that must not mutate the pool.)
   */
  async assignedForOrder(orgId: string, orderId: string) {
    const rows: any[] =
      (await this.t("licenseKey")
        .findMany({
          where: {
            organizationId: orgId,
            assignedOrderId: orderId,
            status: "assigned",
          },
          orderBy: [{ unitIndex: "asc" }, { createdAt: "asc" }],
        })
        .catch(() => [])) ?? [];

    const itemTable = this.t("orderItem");
    const byItemMap = new Map<string, any>();
    for (const row of rows) {
      const key = unseal(row.keySealed);
      if (!key) {
        this.logger.warn(
          `license key unseal failed for key ${row.id} — skipped from buyer reveal`,
        );
        continue;
      }
      const itemId = String(row.assignedItemId ?? "");
      if (!byItemMap.has(itemId)) {
        let productName = "";
        try {
          const item = itemTable?.findFirst
            ? await itemTable
                .findFirst({ where: { id: itemId } })
                .catch(() => null)
            : null;
          productName = String(item?.name ?? "");
          if (item?.productId) {
            const product = await this.t("product")
              .findFirst({
                where: { id: item.productId, organizationId: orgId },
              })
              .catch(() => null);
            if (product?.name) productName = String(product.name);
          }
        } catch {
          /* name is cosmetic on this read shape */
        }
        byItemMap.set(itemId, { itemId, productName, keys: [] });
      }
      byItemMap.get(itemId).keys.push({
        unitIndex: row.unitIndex ?? 0,
        key,
        keyLast4: row.keyLast4 ?? key.slice(-4),
      });
    }
    return { byItem: [...byItemMap.values()], shortages: [] as any[] };
  }
}
