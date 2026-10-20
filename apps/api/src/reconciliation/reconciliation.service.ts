import {
  Injectable,
  Optional,
} from "@nestjs/common";
import { createHash } from "crypto";
import Papa from "papaparse";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { createAgentNotification } from "../common/agent-notify";
import type {
  ColumnMappingDto,
  ImportSheetDto,
  ResolveLineDto,
  SaveProfileDto,
} from "./reconciliation.dto";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * EC26 — Courier COD Reconciliation.
 *
 * The courier's settlement sheet (the merchant's own CSV export
 * from Steadfast / Pathao / RedX) is the ONLY source of collected
 * COD truth — no courier API reports collections, and a delivered
 * shipment status alone never proved the cash arrived (the EC23
 * finding). Importing a sheet stamps CourierShipment
 * .codCollectedMinor / codCollectedAt / codCollectionSource for
 * every matched row; mismatched amounts still stamp (the sheet is
 * the money truth) and are flagged for staff review.
 *
 * Match-key order (first hit wins):
 *   1. tracking column value → CourierShipment.trackingCode
 *   2. tracking column value → CourierShipment.consignmentId
 *      (Pathao/RedX use the consignment id AS the tracking id)
 *   3. order-ref column value → CourierShipment.invoice (the
 *      merchant order ref sent to the courier at booking time)
 *   4. order-ref column value → Order.externalNumber / externalId
 *      → that order's LATEST shipment for this provider.
 *
 * expectedMinor is always the shipment's booked codAmountMinor
 * snapshot — never recomputed from order totals, so a later order
 * edit cannot rewrite what the courier was told to collect.
 */

export const COURIER_PROVIDERS = ["steadfast", "pathao", "redx"] as const;
const MAX_ROWS = 5000;

export interface ColumnMapping {
  trackingColumn: string;
  amountColumn: string;
  chargeColumn?: string;
  orderRefColumn?: string;
  statusColumn?: string;
}

/** Robust sheet-money parse. Sheet exports are inconsistent:
 * "1,250.00", "1250", "1250.5", "BDT 1250", "৳1,250" all occur.
 * Strips commas / spaces / currency tokens, then accepts a plain
 * decimal with at most 2 fraction digits. Anything else is null
 * (the caller turns a non-empty raw cell into a row_error carrying
 * the raw value — a number is never guessed). */
export function parseSheetMoney(raw: unknown): bigint | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s
    .replace(/^(?:bdt|tk\.?|taka|৳)\s*/i, "")
    .replace(/\s*(?:bdt|tk\.?|taka|৳)$/i, "")
    .replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
}

function big(v: unknown): bigint {
  try {
    return BigInt(v as any);
  } catch {
    return 0n;
  }
}

function serializeLine(line: any) {
  if (!line) return line;
  return {
    ...line,
    sheetAmountMinor: line.sheetAmountMinor != null ? String(line.sheetAmountMinor) : null,
    sheetChargeMinor: line.sheetChargeMinor != null ? String(line.sheetChargeMinor) : null,
    expectedMinor: line.expectedMinor != null ? String(line.expectedMinor) : null,
  };
}

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  // ---------- courier + profile ----------

  async resolveCourier(orgId: string, courierIntegrationId: string) {
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: courierIntegrationId, organizationId: orgId },
    });
    if (!integration) throw notFound("reconciliation.courierIntegrationNotFoundInThis");
    if (!(COURIER_PROVIDERS as readonly string[]).includes(integration.provider)) {
      throw badRequest("reconciliation.thisIntegrationIsNotACourier");
    }
    return { integration, provider: integration.provider as string };
  }

  private validateMapping(raw: unknown): ColumnMapping {
    const m = (raw ?? {}) as Record<string, unknown>;
    const req = (key: string): string => {
      const v = typeof m[key] === "string" ? (m[key] as string).trim() : "";
      if (!v) throw badRequest("reconciliation.isRequiredInColumnMappingIt", { key: key });
      return v;
    };
    const opt = (key: string): string | undefined => {
      if (m[key] === undefined || m[key] === null) return undefined;
      if (typeof m[key] !== "string") throw badRequest("reconciliation.columnMappingSMustBeA", { key: key });
      const v = (m[key] as string).trim();
      return v || undefined;
    };
    const mapping: ColumnMapping = {
      trackingColumn: req("trackingColumn"),
      amountColumn: req("amountColumn"),
    };
    const chargeColumn = opt("chargeColumn");
    const orderRefColumn = opt("orderRefColumn");
    const statusColumn = opt("statusColumn");
    if (chargeColumn) mapping.chargeColumn = chargeColumn;
    if (orderRefColumn) mapping.orderRefColumn = orderRefColumn;
    if (statusColumn) mapping.statusColumn = statusColumn;
    return mapping;
  }

  async getProfile(orgId: string, courierIntegrationId: string) {
    const { provider } = await this.resolveCourier(orgId, courierIntegrationId);
    const profile = await (this.prisma as any).reconciliationProfile.findFirst({
      where: { organizationId: orgId, courierIntegrationId },
    });
    return { courierIntegrationId, provider, mapping: profile?.mapping ?? null };
  }

  async saveProfile(orgId: string, dto: SaveProfileDto) {
    const { provider } = await this.resolveCourier(orgId, dto.courierIntegrationId);
    const mapping = this.validateMapping(dto.mapping);
    const saved = await this.upsertProfile(orgId, dto.courierIntegrationId, mapping);
    return { courierIntegrationId: dto.courierIntegrationId, provider, mapping: saved.mapping ?? mapping };
  }

  private async upsertProfile(orgId: string, courierIntegrationId: string, mapping: ColumnMapping) {
    const table = (this.prisma as any).reconciliationProfile;
    const existing = await table.findFirst({
      where: { organizationId: orgId, courierIntegrationId },
    });
    if (existing) {
      return table.update({ where: { id: existing.id }, data: { mapping } });
    }
    return table.create({ data: { organizationId: orgId, courierIntegrationId, mapping } });
  }

  private async savedMapping(orgId: string, courierIntegrationId: string): Promise<ColumnMapping | null> {
    const profile = await (this.prisma as any).reconciliationProfile.findFirst({
      where: { organizationId: orgId, courierIntegrationId },
    });
    return profile?.mapping ?? null;
  }

  // ---------- CSV ----------

  async readHeaders(csvText: string) {
    if (typeof csvText !== "string" || !csvText.trim()) {
      throw badRequest("reconciliation.noHeaderWasFoundInThe");
    }
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: "greedy" });
    const headers = ((parsed.meta.fields ?? []) as string[]).map((h) => h.trim()).filter(Boolean);
    if (!headers.length) throw badRequest("reconciliation.noHeaderWasFoundInThe");
    return { headers };
  }

  // ---------- import ----------

  async importSheet(orgId: string, actorId: string, dto: ImportSheetDto) {
    const { provider } = await this.resolveCourier(orgId, dto.courierIntegrationId);

    let mapping: ColumnMapping;
    if (dto.mapping) {
      mapping = this.validateMapping(dto.mapping);
      // A mapping sent with the import becomes the courier's saved
      // profile, so the next import of the same sheet is one click.
      await this.upsertProfile(orgId, dto.courierIntegrationId, mapping);
    } else {
      const saved = await this.savedMapping(orgId, dto.courierIntegrationId);
      if (!saved) {
        throw badRequest("reconciliation.columnMappingIsNotSetFor");
      }
      mapping = this.validateMapping(saved);
    }

    if (typeof dto.csvText !== "string" || !dto.csvText.trim()) {
      throw badRequest("reconciliation.noHeaderWasFoundInThe");
    }
    const fileHash = createHash("sha256").update(dto.csvText).digest("hex");
    if (!dto.force) {
      const prior = await (this.prisma as any).reconciliationImport.findFirst({
        where: { organizationId: orgId, courierIntegrationId: dto.courierIntegrationId, fileHash },
      });
      if (prior) throw badRequest("reconciliation.thisFileHasAlreadyBeenImported");
    }

    const parsed = Papa.parse<Record<string, string>>(dto.csvText, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
    });
    const headers = ((parsed.meta.fields ?? []) as string[]).map((h) => h.trim()).filter(Boolean);
    if (!headers.length) throw badRequest("reconciliation.noHeaderWasFoundInThe");
    const rows = (parsed.data ?? []).filter(
      (r) => r && Object.values(r).some((v) => String(v ?? "").trim() !== ""),
    );
    if (rows.length === 0) throw badRequest("reconciliation.thereIsNoDataRowIn");
    if (rows.length > MAX_ROWS) {
      throw badRequest("reconciliation.atMostRowsCanBeImported", { MAX_ROWS: MAX_ROWS });
    }
    for (const col of [mapping.trackingColumn, mapping.amountColumn, mapping.chargeColumn, mapping.orderRefColumn, mapping.statusColumn]) {
      if (col && !headers.includes(col)) {
        throw badRequest("reconciliation.theMappingColumnWasNotFound", { col: col });
      }
    }

    // The import row is created FIRST so lines (and the shipment
    // stamps' codCollectionSource) can reference its id. Counts are
    // written back once every line's outcome is known.
    const importRow = await (this.prisma as any).reconciliationImport.create({
      data: {
        organizationId: orgId,
        courierIntegrationId: dto.courierIntegrationId,
        fileName: dto.fileName ?? null,
        fileHash,
        rowCount: rows.length,
        status: "processed",
        createdBy: actorId,
      },
    });

    // Preload this provider's shipments + the org's orders once;
    // per-row lookups are then pure map hits.
    const shipments = (
      ((await (this.prisma as any).courierShipment.findMany({
        where: { organizationId: orgId, provider },
      })) ?? []) as any[]
    )
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const byTracking = new Map<string, any>();
    const byInvoice = new Map<string, any>();
    for (const s of shipments) {
      // Sorted newest-first; first writer wins = the LATEST
      // shipment carrying a duplicated key.
      if (s.trackingCode && !byTracking.has(String(s.trackingCode))) byTracking.set(String(s.trackingCode), s);
      if (s.consignmentId && !byTracking.has(String(s.consignmentId))) byTracking.set(String(s.consignmentId), s);
      if (s.invoice && !byInvoice.has(String(s.invoice))) byInvoice.set(String(s.invoice), s);
    }
    const orders = (((await (this.prisma as any).order.findMany({
      where: { organizationId: orgId },
    })) ?? []) as any[]);
    const orderByRef = new Map<string, any>();
    for (const o of orders) {
      if (o.externalNumber && !orderByRef.has(String(o.externalNumber))) orderByRef.set(String(o.externalNumber), o);
      if (o.externalId && !orderByRef.has(String(o.externalId))) orderByRef.set(String(o.externalId), o);
    }
    const shipmentForOrder = (orderId: string) => shipments.find((s) => s.orderId === orderId) ?? null;

    const counts = {
      matched: 0, amount_mismatch: 0, not_found: 0, duplicate: 0, already_collected: 0, row_error: 0,
    };
    // Normalized keys (tracking, else order ref) of rows that
    // MATCHED A SHIPMENT in this file. Only those dedupe: a repeat
    // of a not_found / keyless row_error row is evaluated fresh,
    // because nothing was applied for its first occurrence.
    const seenMatchedKeys = new Set<string>();
    // Shipments already stamped by THIS import. A sheet can carry
    // the same parcel under two different keys (tracking in one
    // row, invoice/order ref in another) — the key-based dedupe
    // above cannot see that, so the second hit on an
    // already-stamped shipment is a duplicate too, never a
    // second stamp with a possibly different amount.
    const seenShipmentIds = new Set<string>();
    const now = new Date();
    const cell = (row: Record<string, string>, col?: string): string =>
      col ? String(row[col] ?? "").trim() : "";

    const lines: any[] = [];
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const rowNumber = idx + 1;
      const rawTracking = cell(row, mapping.trackingColumn);
      const rawOrderRef = mapping.orderRefColumn ? cell(row, mapping.orderRefColumn) : "";
      const rawAmount = cell(row, mapping.amountColumn);
      const sheetAmountMinor = parseSheetMoney(rawAmount);
      const sheetChargeMinor = mapping.chargeColumn ? parseSheetMoney(cell(row, mapping.chargeColumn)) : null;
      const sheetStatus = mapping.statusColumn ? cell(row, mapping.statusColumn) || null : null;

      const line: any = {
        importId: importRow.id,
        organizationId: orgId,
        rowNumber,
        rawTrackingId: rawTracking || null,
        rawOrderRef: rawOrderRef || null,
        sheetAmountMinor,
        sheetChargeMinor,
        sheetStatus,
        matchedOrderId: null,
        matchedShipmentId: null,
        expectedMinor: null,
        outcome: "row_error",
        note: null,
      };

      // (a) nothing to match on.
      if (!rawTracking && !rawOrderRef) {
        line.outcome = "row_error";
        line.note = "tracking/order ref নেই";
        counts.row_error += 1;
        lines.push(line);
        continue;
      }

      // (b) duplicate within this file (applied once only).
      const dedupeKey = rawTracking || rawOrderRef;
      if (seenMatchedKeys.has(dedupeKey)) {
        line.outcome = "duplicate";
        line.note = "একই ফাইলে এই tracking/order ref আগের সারিতে মিলেছে";
        counts.duplicate += 1;
        lines.push(line);
        continue;
      }

      // (c) find the shipment, in the documented key order.
      let shipment: any = null;
      if (rawTracking) shipment = byTracking.get(rawTracking) ?? null;
      if (!shipment && rawOrderRef) shipment = byInvoice.get(rawOrderRef) ?? null;
      if (!shipment && rawOrderRef) {
        const order = orderByRef.get(rawOrderRef);
        if (order) shipment = shipmentForOrder(order.id);
      }
      if (!shipment) {
        line.outcome = "not_found";
        line.note = "কোনো shipment-এর সাথে মেলেনি";
        counts.not_found += 1;
        lines.push(line);
        continue;
      }
      if (seenShipmentIds.has(shipment.id)) {
        line.matchedShipmentId = shipment.id;
        line.matchedOrderId = shipment.orderId ?? null;
        line.outcome = "duplicate";
        line.note = "একই shipment এই ফাইলের আগের সারিতে মিলেছে (ভিন্ন key দিয়ে)";
        counts.duplicate += 1;
        lines.push(line);
        continue;
      }

      line.matchedShipmentId = shipment.id;
      line.matchedOrderId = shipment.orderId ?? null;
      line.expectedMinor = big(shipment.codAmountMinor ?? 0);
      seenMatchedKeys.add(dedupeKey);

      // (d) money already recorded by ANOTHER import (or by an
      // earlier import of this same file — codCollectionSource
      // points at that import, never at the current one) is never
      // overwritten by an import.
      if (shipment.codCollectedMinor != null && shipment.codCollectionSource !== importRow.id) {
        line.outcome = "already_collected";
        line.note = "এই shipment-এর COD আগেই সংগৃহীত হিসেবে রেকর্ড করা হয়েছে";
        counts.already_collected += 1;
        lines.push(line);
        continue;
      }

      // (e) amount validity — checked AFTER the match so the line
      // still records WHICH shipment the bad row claimed to be.
      if (sheetAmountMinor === null) {
        line.outcome = "row_error";
        line.note = rawAmount ? `অ্যামাউন্ট পড়া যায়নি: "${rawAmount}"` : "অ্যামাউন্ট খালি";
        counts.row_error += 1;
        lines.push(line);
        continue;
      }

      // (f)/(g) stamp the sheet amount — the sheet is the money
      // truth; equality decides matched vs amount_mismatch.
      await (this.prisma as any).courierShipment.update({
        where: { id: shipment.id },
        data: {
          codCollectedMinor: sheetAmountMinor,
          codCollectedAt: now,
          codCollectionSource: importRow.id,
        },
      });
      shipment.codCollectedMinor = sheetAmountMinor;
      shipment.codCollectedAt = now;
      shipment.codCollectionSource = importRow.id;
      seenShipmentIds.add(shipment.id);

      if (sheetAmountMinor === line.expectedMinor) {
        line.outcome = "matched";
        counts.matched += 1;
      } else {
        line.outcome = "amount_mismatch";
        line.note = `প্রত্যাশিত ${String(line.expectedMinor)} পয়সা, শিটে ${String(sheetAmountMinor)} পয়সা`;
        counts.amount_mismatch += 1;
      }
      lines.push(line);
    }

    for (const line of lines) {
      await (this.prisma as any).reconciliationLine.create({ data: line });
    }

    const updated = await (this.prisma as any).reconciliationImport.update({
      where: { id: importRow.id },
      data: {
        matchedCount: counts.matched,
        mismatchCount: counts.amount_mismatch,
        notFoundCount: counts.not_found,
        duplicateCount: counts.duplicate,
      },
    });

    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: "reconciliation.imported",
      entityType: "ReconciliationImport",
      entityId: importRow.id,
      metadata: {
        courierIntegrationId: dto.courierIntegrationId,
        provider,
        fileName: dto.fileName ?? null,
        counts: { rowCount: rows.length, ...counts },
      },
    }).catch(() => undefined);

    // GB8 (GC20.3): settlement mismatch alert — exactly once per
    // import, fully failure-isolated (never fails the import).
    if (counts.amount_mismatch > 0) {
      await this.notifySettlementMismatch(orgId, String(importRow.id), provider).catch(() => undefined);
    }

    return { ...(updated ?? importRow), counts: { rowCount: rows.length, ...counts } };
  }

  /**
   * GB8 (GC20.3) — when an import completes with amount_mismatch
   * lines, notify OWNER/ADMIN staff ONCE per import batch. The
   * batch's mismatchAlertedAt stamp is claimed with a conditional
   * updateMany BEFORE notifying, so a re-import of the same sheet
   * (a NEW batch row) alerts again but the same batch never
   * alerts twice. The notification links (in its body — the
   * AgentNotification model has no link column) to the Finance
   * page's courier-settlement mismatches list, which is computed
   * from these very lines.
   */
  private async notifySettlementMismatch(orgId: string, importId: string, provider: string): Promise<void> {
    try {
      const batch = await (this.prisma as any).reconciliationImport.findFirst({ where: { id: importId, organizationId: orgId } });
      if (!batch || batch.mismatchAlertedAt) return;
      const lines = await (this.prisma as any).reconciliationLine.findMany({
        where: { organizationId: orgId, importId, outcome: "amount_mismatch" },
        select: { sheetAmountMinor: true, expectedMinor: true },
        take: 5001,
      });
      if (!lines.length) return;
      const delta = lines.reduce((s: bigint, l: any) => {
        const sv = BigInt(String(l.sheetAmountMinor ?? 0));
        const ev = BigInt(String(l.expectedMinor ?? 0));
        return s + (sv - ev);
      }, 0n);
      // Claim the stamp first — exactly once per import.
      const claimed = await (this.prisma as any).reconciliationImport.updateMany({
        where: { id: importId, organizationId: orgId, mismatchAlertedAt: null },
        data: { mismatchAlertedAt: new Date() },
      }).catch(() => null);
      if (!claimed || claimed.count === 0) return;
      const memberships = await (this.prisma as any).membership.findMany({
        where: { organizationId: orgId, status: "ACTIVE" },
      }).catch(() => []);
      const recipients = [...new Set((memberships as any[])
        .filter((m) => ["OWNER", "ADMIN"].includes(String(m.role)))
        .map((m) => String(m.userId)))];
      const absDelta = delta < 0n ? -delta : delta;
      const deltaText = `${delta < 0n ? "−" : "+"}৳${absDelta / 100n}.${String(absDelta % 100n).padStart(2, "0")}`;
      for (const userId of recipients) {
        await createAgentNotification(this.prisma as any, {
          organizationId: orgId,
          userId,
          type: "billing",
          title: `কুরিয়ার সেটেলমেন্টে অমিল: ${lines.length}টি লাইন`,
          body: `${provider} সেটেলমেন্ট শিটে ${lines.length}টি লাইনে পরিমাণ মেলেনি (মোট পার্থক্য ${deltaText})। বিস্তারিত: Finance পেজের "কুরিয়ার সেটেলমেন্ট" অংশে (/dashboard/commerce/finance)`,
          conversationId: null,
        }).catch(() => null);
      }
    } catch {
      // Failure-isolated by design: alerting must never break an import.
    }
  }

  // ---------- reads ----------

  async listImports(orgId: string, courierIntegrationId?: string) {
    const where: any = { organizationId: orgId };
    if (courierIntegrationId) where.courierIntegrationId = courierIntegrationId;
    const rows = (((await (this.prisma as any).reconciliationImport.findMany({
      where,
      orderBy: { createdAt: "desc" },
    })) ?? []) as any[])
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { items: rows };
  }

  async getImport(orgId: string, importId: string) {
    const row = await (this.prisma as any).reconciliationImport.findFirst({
      where: { id: importId, organizationId: orgId },
    });
    if (!row) throw notFound("reconciliation.reconciliationImportNotFoundInThis");
    return row;
  }

  async listLines(orgId: string, importId: string, outcome?: string) {
    await this.getImport(orgId, importId);
    const where: any = { importId, organizationId: orgId };
    if (outcome) where.outcome = outcome;
    const rows = (((await (this.prisma as any).reconciliationLine.findMany({
      where,
      orderBy: { rowNumber: "asc" },
    })) ?? []) as any[])
      .slice()
      .sort((a, b) => (a.rowNumber ?? 0) - (b.rowNumber ?? 0));
    return { items: rows.map(serializeLine) };
  }

  // ---------- line resolution ----------

  async resolveLine(orgId: string, actorId: string, lineId: string, dto: ResolveLineDto) {
    const line = await (this.prisma as any).reconciliationLine.findFirst({
      where: { id: lineId, organizationId: orgId },
    });
    if (!line) throw notFound("reconciliation.reconciliationLineNotFoundInThis");
    const note = dto.note !== undefined ? dto.note : line.note ?? null;

    if (dto.action === "accept_sheet") {
      if (!line.matchedShipmentId || line.sheetAmountMinor == null) {
        throw badRequest("reconciliation.thisRowHasNoMatchedShipment");
      }
      const shipment = await (this.prisma as any).courierShipment.findFirst({
        where: { id: line.matchedShipmentId, organizationId: orgId },
      });
      if (!shipment) throw notFound("reconciliation.matchedShipmentNotFoundInThis");
      const oldCollectedMinor = shipment.codCollectedMinor != null ? String(shipment.codCollectedMinor) : null;
      const now = new Date();
      await (this.prisma as any).courierShipment.update({
        where: { id: shipment.id },
        data: {
          codCollectedMinor: big(line.sheetAmountMinor),
          codCollectedAt: now,
          codCollectionSource: line.importId,
        },
      });
      const updated = await (this.prisma as any).reconciliationLine.update({
        where: { id: line.id },
        data: { reviewedAt: now, reviewedBy: actorId, note },
      });
      await this.audit?.log({
        organizationId: orgId,
        userId: actorId,
        action: "reconciliation.line_accepted",
        entityType: "ReconciliationLine",
        entityId: line.id,
        metadata: {
          shipmentId: shipment.id,
          importId: line.importId,
          oldCollectedMinor,
          newCollectedMinor: String(line.sheetAmountMinor),
        },
      }).catch(() => undefined);
      return serializeLine(updated);
    }

    if (dto.action === "mark_reviewed") {
      const updated = await (this.prisma as any).reconciliationLine.update({
        where: { id: line.id },
        data: { reviewedAt: new Date(), reviewedBy: actorId, note },
      });
      return serializeLine(updated);
    }

    throw badRequest("reconciliation.unknownActionGiveAcceptSheetOr", { dtoAction: dto.action });
  }
}
