import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CourierService, PrintTemplateOptions } from "../courier/courier.service";

/**
 * ON10 — Print & Document Center.
 *
 * One place to bulk-print order documents: invoices, shipping
 * labels, packing slips and delivery challans, 1–100 orders per
 * job. Every job leaves a PrintJob row — done (with the
 * per-order failures named in failedOrderIds) or failed (with
 * the Bengali generation error) — and the PDF itself is
 * streamed to the caller, never stored.
 *
 * Placement: the service + controller live in OrdersModule
 * (controller registered FIRST, before OrdersController, so the
 * literal "print-jobs" / "print-template" segments win over
 * ":orderId" — the ON9 pattern). PDF generation itself stays in
 * CourierService (the ONE home of the PDF builders). OrdersModule
 * cannot import CourierModule — Courier → Inbox → Orders would
 * close a module cycle (the same reason ON1 bulk lives in
 * FulfillmentModule) — so the CourierService instance is
 * resolved lazily through ModuleRef (strict:false = the app's
 * single CourierModule instance) on first use and cached.
 *
 * Template: the org's PrintTemplateSetting row (lazy-upserted)
 * is loaded per job and passed into the builders; the legacy
 * direct courier PDF endpoints pass no template and keep the
 * pre-ON10 output byte-for-byte.
 *
 * Failure honesty:
 * - Caller errors (unknown type, 0 or >100 ids, foreign /
 *   nonexistent order ids) fail the WHOLE request with a 400
 *   BEFORE any job row exists — the bad ids are listed.
 * - Per-order generation problems (a label for an order whose
 *   latest shipment does not exist or has no tracking code yet)
 *   never fail the job: the order lands in failedOrderIds and
 *   the PDF carries the rest.
 * - A generation throw fails the job: a PrintJob row with
 *   status "failed" + the error, and the controller answers
 *   422 with no PDF.
 * - When EVERY label order is unprintable there is nothing to
 *   stream, so that is a failed job too (error says why).
 */

export const PRINT_JOB_TYPES = ["invoices", "labels", "packing_slips", "challans"] as const;
export type PrintJobType = (typeof PRINT_JOB_TYPES)[number];

const MAX_ORDERS_PER_JOB = 100;
const TEMPLATE_CAPS = { logoUrl: 500, footerText: 200, termsText: 1000, invoiceNote: 500 } as const;

export interface PrintJobResult {
  job: any;
  pdf: Buffer | null;
  /** Per-order failure reasons for THIS run (the row stores
   * only the ids); the ON1 bulk reroute surfaces these. */
  failedReasons: Record<string, string>;
}

@Injectable()
export class PrintCenterService {
  private courierCache: CourierService | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private t(name: string): any { return (this.prisma as any)[name]; }

  /** The app's single CourierService, resolved lazily (see the
   * header for why this is not a constructor dependency). Tests
   * may assign `courierCache` directly. */
  private courier(): CourierService {
    if (this.courierCache) return this.courierCache;
    if (!this.moduleRef) throw new Error("CourierService unavailable (no ModuleRef)");
    const resolved: CourierService | null = this.moduleRef.get(CourierService, { strict: false });
    if (!resolved) throw new Error("CourierService unavailable (not registered)");
    this.courierCache = resolved;
    return this.courierCache;
  }

  // ---------- template settings ----------

  private pubTemplate(row: any) {
    return {
      logoUrl: row?.logoUrl ?? null,
      footerText: row?.footerText ?? null,
      termsText: row?.termsText ?? null,
      invoiceNote: row?.invoiceNote ?? null,
      updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    };
  }

  async getTemplate(organizationId: string) {
    const table = this.t("printTemplateSetting");
    const row = table?.findUnique
      ? await table.findUnique({ where: { organizationId } }).catch(() => null)
      : table?.findFirst
        ? await table.findFirst({ where: { organizationId } }).catch(() => null)
        : null;
    return this.pubTemplate(row);
  }

  /** The template as the builders consume it — null when the
   * org has no row or every field is empty (the builders then
   * produce the pre-ON10 default documents). */
  async templateForPrint(organizationId: string): Promise<PrintTemplateOptions | null> {
    const tpl = await this.getTemplate(organizationId);
    const clean = (v: string | null) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const out: PrintTemplateOptions = {
      logoUrl: clean(tpl.logoUrl), footerText: clean(tpl.footerText),
      termsText: clean(tpl.termsText), invoiceNote: clean(tpl.invoiceNote),
    };
    return out.logoUrl || out.footerText || out.termsText || out.invoiceNote ? out : null;
  }

  private cleanTemplateField(field: keyof typeof TEMPLATE_CAPS, value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") throw new BadRequestException(`${field} লেখা (string) হতে হবে`);
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > TEMPLATE_CAPS[field]) {
      throw new BadRequestException(`${field} সর্বোচ্চ ${TEMPLATE_CAPS[field]} অক্ষর হতে পারবে`);
    }
    return trimmed;
  }

  async updateTemplate(organizationId: string, actorId: string, dto: {
    logoUrl?: unknown; footerText?: unknown; termsText?: unknown; invoiceNote?: unknown;
  }) {
    if (!dto || typeof dto !== "object") throw new BadRequestException("টেমপ্লেট সেটিংস দরকার");
    const logoUrl = this.cleanTemplateField("logoUrl", dto.logoUrl);
    if (logoUrl !== null && !/^https?:\/\/\S+$/.test(logoUrl)) {
      throw new BadRequestException("লোগোর URL অবশ্যই http:// বা https:// দিয়ে শুরু হতে হবে");
    }
    const data = {
      logoUrl,
      footerText: this.cleanTemplateField("footerText", dto.footerText),
      termsText: this.cleanTemplateField("termsText", dto.termsText),
      invoiceNote: this.cleanTemplateField("invoiceNote", dto.invoiceNote),
    };
    const table = this.t("printTemplateSetting");
    if (!table) throw new Error("PrintTemplateSetting unavailable");
    const existing = table.findUnique
      ? await table.findUnique({ where: { organizationId } }).catch(() => null)
      : await table.findFirst({ where: { organizationId } }).catch(() => null);
    const row = existing
      ? await table.update({ where: { id: existing.id }, data })
      : await table.create({ data: { organizationId, ...data } });
    try {
      await this.audit?.log({
        organizationId, userId: actorId, action: "orders.print_template_updated",
        entityType: "PrintTemplateSetting", entityId: row?.id,
        // Which fields are set — never the merchant's text itself.
        metadata: {
          logoUrl: data.logoUrl !== null, footerText: data.footerText !== null,
          termsText: data.termsText !== null, invoiceNote: data.invoiceNote !== null,
        },
      });
    } catch { /* audit is failure-isolated */ }
    return this.pubTemplate(row);
  }

  // ---------- print jobs ----------

  private pubJob(row: any) {
    if (!row) return row;
    return {
      id: row.id,
      organizationId: row.organizationId,
      type: row.type,
      orderIds: Array.isArray(row.orderIds) ? row.orderIds.map((x: any) => String(x)) : [],
      orderCount: row.orderCount,
      failedOrderIds: Array.isArray(row.failedOrderIds) ? row.failedOrderIds.map((x: any) => String(x)) : [],
      status: row.status,
      error: row.error ?? null,
      createdById: row.createdById ?? null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    };
  }

  private async writeJob(organizationId: string, actorId: string, input: {
    type: PrintJobType; orderIds: string[]; failedOrderIds: string[]; status: "done" | "failed"; error?: string | null;
  }) {
    const row = await this.t("printJob").create({
      data: {
        organizationId, type: input.type, orderIds: input.orderIds,
        orderCount: input.orderIds.length,
        failedOrderIds: input.failedOrderIds.length ? input.failedOrderIds : null,
        status: input.status, error: input.error ?? null, createdById: actorId,
      },
    });
    try {
      await this.audit?.log({
        organizationId, userId: actorId, action: "orders.print_job_created",
        entityType: "PrintJob", entityId: row?.id,
        metadata: {
          type: input.type, orderCount: input.orderIds.length,
          failedCount: input.failedOrderIds.length, status: input.status,
        },
      });
    } catch { /* audit is failure-isolated */ }
    return this.pubJob(row);
  }

  /** Latest shipment per order for labels (the ON1 bulk rule):
   * newest by createdAt; a shipment without a tracking code /
   * consignment id cannot produce a label yet. */
  private async resolveLabelShipments(organizationId: string, orderIds: string[]) {
    const shipmentIds: string[] = [];
    const failedReasons: Record<string, string> = {};
    for (const orderId of orderIds) {
      const rows: any[] = ((await this.t("courierShipment")?.findMany({
        where: { organizationId, orderId }, orderBy: { createdAt: "desc" },
      }).catch(() => [])) ?? [])
        .filter((s: any) => String(s.orderId) === String(orderId) && String(s.organizationId) === String(organizationId))
        .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
      const latest = rows[0];
      if (!latest) { failedReasons[orderId] = "কুরিয়ার বুকিং নেই"; continue; }
      if (!latest.trackingCode && !latest.consignmentId) { failedReasons[orderId] = "শিপমেন্টে এখনো ট্র্যাকিং কোড আসেনি"; continue; }
      shipmentIds.push(String(latest.id));
    }
    return { shipmentIds, failedReasons };
  }

  async createJob(organizationId: string, actorId: string, dto: {
    type?: unknown; orderIds?: unknown;
  }): Promise<PrintJobResult> {
    // ---- whole-request validation (BEFORE any job row) ----
    const type = String(dto?.type ?? "") as PrintJobType;
    if (!(PRINT_JOB_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException(`অজানা প্রিন্ট ধরন "${String(dto?.type ?? "")}" — সঠিক ধরন: ${PRINT_JOB_TYPES.join(", ")}`);
    }
    if (!Array.isArray(dto?.orderIds)) throw new BadRequestException("১–১০০টি অর্ডার বেছে নিন");
    const orderIds = [...new Set(dto.orderIds.map((x) => String(x ?? "").trim()).filter(Boolean))];
    if (orderIds.length < 1 || orderIds.length > MAX_ORDERS_PER_JOB) {
      throw new BadRequestException("১–১০০টি অর্ডার বেছে নিন");
    }
    const found: any[] = ((await this.t("order")?.findMany({
      where: { id: { in: orderIds }, organizationId }, select: { id: true },
    }).catch(() => null)) ?? null) as any;
    // findMany may be unavailable on a partial fake — fall back
    // to per-id findFirst so the existence rule never weakens.
    let foundIds: Set<string>;
    if (Array.isArray(found)) {
      foundIds = new Set(found.map((r: any) => String(r.id)));
    } else {
      foundIds = new Set<string>();
      for (const id of orderIds) {
        const row = await this.t("order")?.findFirst({ where: { id, organizationId }, select: { id: true } }).catch(() => null);
        if (row) foundIds.add(id);
      }
    }
    const missing = orderIds.filter((id) => !foundIds.has(id));
    if (missing.length) {
      throw new BadRequestException(`এই অর্ডারগুলো এই সংস্থায় পাওয়া যায়নি: ${missing.join(", ")}`);
    }

    // ---- per-order preparation (labels resolve shipments) ----
    const failedReasons: Record<string, string> = {};
    let labelShipmentIds: string[] = [];
    if (type === "labels") {
      const resolved = await this.resolveLabelShipments(organizationId, orderIds);
      labelShipmentIds = resolved.shipmentIds;
      Object.assign(failedReasons, resolved.failedReasons);
      if (labelShipmentIds.length === 0) {
        const job = await this.writeJob(organizationId, actorId, {
          type, orderIds, failedOrderIds: orderIds, status: "failed",
          error: "কোনো অর্ডারেরই লেবেল ছাপানো যায়নি — কোনোটিরই ব্যবহারযোগ্য কুরিয়ার শিপমেন্ট নেই",
        });
        return { job, pdf: null, failedReasons };
      }
    }
    const failedOrderIds = Object.keys(failedReasons);

    // ---- generation ----
    try {
      const template = await this.templateForPrint(organizationId);
      const courier = this.courier();
      let pdf: Buffer;
      if (type === "invoices") pdf = await courier.invoicesPdf(organizationId, orderIds, { template, maxOrders: MAX_ORDERS_PER_JOB });
      else if (type === "labels") pdf = await courier.labelsPdf(organizationId, labelShipmentIds, { maxLabels: MAX_ORDERS_PER_JOB });
      else if (type === "challans") pdf = await courier.challansPdf(organizationId, orderIds, template);
      else pdf = await courier.packingSlipsPdf(organizationId, orderIds, template);
      const job = await this.writeJob(organizationId, actorId, { type, orderIds, failedOrderIds, status: "done" });
      return { job, pdf, failedReasons };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const job = await this.writeJob(organizationId, actorId, {
        type, orderIds, failedOrderIds, status: "failed", error: message,
      });
      return { job, pdf: null, failedReasons };
    }
  }

  async listJobs(organizationId: string, pageInput?: number | string, pageSizeInput?: number | string) {
    const page = Math.max(1, Math.floor(Number(pageInput ?? 1)) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(pageSizeInput ?? 20)) || 20));
    const table = this.t("printJob");
    const rows: any[] = ((await table?.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize, take: pageSize,
    }).catch(() => [])) ?? [])
      .filter((r: any) => String(r.organizationId) === String(organizationId))
      .sort((a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .slice(0, pageSize);
    let total = rows.length;
    if (table?.count) {
      const counted = await table.count({ where: { organizationId } }).catch(() => null);
      if (typeof counted === "number") total = counted;
    }
    return { items: rows.map((r: any) => this.pubJob(r)), total, page, pageSize };
  }

  async getJob(organizationId: string, jobId: string) {
    const row = await this.t("printJob")?.findFirst({ where: { id: jobId, organizationId } }).catch(() => null);
    if (!row || String(row.organizationId) !== String(organizationId)) {
      throw new NotFoundException("প্রিন্ট জব পাওয়া যায়নি");
    }
    return this.pubJob(row);
  }
}
