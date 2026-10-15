import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OrdersService } from "../orders/orders.service";
import { CourierService } from "../courier/courier.service";
import { PrintCenterService } from "../orders/print-center.service";

/**
 * ON1 — bulk actions over a set of orders. Hosted in the
 * Fulfillment module because it is the one module that already
 * imports Orders + Courier without a cycle (Orders must NOT
 * import Courier: Inbox -> Orders and Courier -> Inbox).
 *
 * Honesty: per-order try/catch — one order's failure (a refused
 * status transition, a missing phone) never fails the batch and
 * never hides: its caught message ships verbatim in results.
 * Whole-request validation (bad action, missing/invalid params)
 * happens BEFORE any per-order work and is a single 400.
 */

export const BULK_ACTIONS = ["set_status", "add_tag", "remove_tag", "assign", "book_courier", "print_labels", "print_invoices"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export interface BulkDto {
  orderIds: string[];
  action: string;
  params?: {
    status?: string;
    tag?: string;
    assigneeId?: string | null;
    provider?: string;
  };
}

@Injectable()
export class OrdersBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly courier: CourierService,
    @Optional() private readonly audit?: AuditService,
    // ON10: appended LAST + @Optional (house discipline) — the
    // print actions reroute through the Print Center when it is
    // wired (FulfillmentModule imports OrdersModule, which
    // exports PrintCenterService); without it the legacy
    // id-collection behaviour below is kept.
    @Optional() private readonly printCenter?: PrintCenterService,
  ) {}

  private async loadOrder(organizationId: string, orderId: string) {
    const order = await (this.prisma as any).order.findFirst({
      where: { id: orderId, organizationId }, include: { customer: true },
    });
    if (!order) throw new Error("Order not found in this organization");
    return order;
  }

  private composedCustomerAddress(customer: any): string {
    const addr = customer?.address;
    if (!addr) return "";
    if (typeof addr === "string") return addr.trim();
    if (typeof addr === "object") {
      return [addr.address_1 ?? addr.addressLine ?? addr.line, addr.area, addr.district, addr.city, addr.note]
        .filter((v: any) => v != null && String(v).trim() !== "")
        .map((v: any) => String(v).trim())
        .join(", ");
    }
    return "";
  }

  async bulk(organizationId: string, actorId: string, dto: BulkDto) {
    // ---- whole-request validation (before ANY work) ----
    if (!dto || !Array.isArray(dto.orderIds) || dto.orderIds.length < 1 || dto.orderIds.length > 100) {
      throw new BadRequestException("১–১০০টি অর্ডার বেছে নিন");
    }
    if (!(BULK_ACTIONS as readonly string[]).includes(dto.action)) {
      throw new BadRequestException(`অজানা bulk action "${dto.action}" — সঠিক action: ${BULK_ACTIONS.join(", ")}`);
    }
    const action = dto.action as BulkAction;
    const params = dto.params ?? {};
    const orderIds = [...new Set(dto.orderIds.map((x) => String(x)).filter(Boolean))];
    if (orderIds.length === 0) throw new BadRequestException("১–১০০টি অর্ডার বেছে নিন");

    if (action === "set_status") {
      if (!params.status || typeof params.status !== "string" || !params.status.trim()) {
        throw new BadRequestException("অবস্থা (status) দরকার");
      }
    }
    if (action === "add_tag" || action === "remove_tag") {
      const tag = typeof params.tag === "string" ? params.tag.trim() : "";
      if (!tag) throw new BadRequestException("ট্যাগ দরকার");
      // Same 1..30 rule as the single-order tags endpoint.
      this.orders.validateTags([tag]);
    }
    if (action === "assign") {
      if (!("assigneeId" in params)) {
        throw new BadRequestException("দায়িত্বপ্রাপ্ত সদস্য (assigneeId) দরকার");
      }
      if (params.assigneeId !== null && params.assigneeId !== undefined) {
        // Validated ONCE up front: an invalid assignee fails the
        // whole request, not 100 per-order copies of the same 400.
        await this.orders.assertActiveMember(organizationId, String(params.assigneeId));
      }
    }
    if (action === "book_courier" && params.provider !== undefined && params.provider !== null) {
      if (!["steadfast", "pathao", "redx"].includes(String(params.provider))) {
        throw new BadRequestException(`অজানা কুরিয়ার প্রোভাইডার "${params.provider}"`);
      }
    }

    // ---- per-order work ----
    const results: { orderId: string; ok: boolean; error?: string; printJobId?: string }[] = [];
    const labelShipmentIds: string[] = [];
    const invoiceOrderIds: string[] = [];
    // ON10: orders that exist and are print candidates — their
    // final per-order outcome comes from the print job, below.
    const printCandidateIds: string[] = [];
    const isPrintAction = action === "print_labels" || action === "print_invoices";

    for (const orderId of orderIds) {
      try {
        if (action === "set_status") {
          await this.orders.updateOrder(organizationId, actorId, orderId, { status: params.status } as any);
        } else if (action === "add_tag" || action === "remove_tag") {
          const order = await this.loadOrder(organizationId, orderId);
          const current: string[] = Array.isArray(order.tags) ? order.tags.map((t: any) => String(t)) : [];
          const tag = String(params.tag).trim();
          const next = action === "add_tag"
            ? (current.includes(tag) ? current : [...current, tag])
            : current.filter((t) => t !== tag);
          await this.orders.setTags(organizationId, actorId, orderId, next);
        } else if (action === "assign") {
          await this.orders.assignOrder(organizationId, actorId, orderId, params.assigneeId ?? null);
        } else if (action === "book_courier") {
          const order = await this.loadOrder(organizationId, orderId);
          const customer = order.customer ?? null;
          const name = [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || "Customer";
          const phone = customer?.phone ? String(customer.phone).trim() : "";
          if (!phone) throw new Error("গ্রাহকের ফোন নম্বর নেই");
          const address = (typeof order.address === "string" && order.address.trim())
            ? order.address.trim()
            : this.composedCustomerAddress(customer);
          if (!address) throw new Error("ডেলিভারির ঠিকানা নেই");
          await this.courier.bookShipment(organizationId, actorId, {
            provider: params.provider, orderId,
            recipientName: name, recipientPhone: phone, recipientAddress: address,
          });
        } else if (action === "print_labels") {
          if (this.printCenter) {
            // ON10 reroute: existence is the only per-order
            // check here — shipment resolution (and its failure)
            // is the print job's failedOrderIds job, below.
            await this.loadOrder(organizationId, orderId);
            printCandidateIds.push(orderId);
          } else {
            const shipments: any[] = ((await (this.prisma as any).courierShipment?.findMany({
              where: { organizationId, orderId },
            }).catch(() => [])) ?? [])
              .filter((s: any) => String(s.orderId) === String(orderId));
            if (shipments.length === 0) throw new Error("কুরিয়ার বুকিং নেই");
            const latest = [...shipments].sort((a: any, b: any) =>
              new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())[0];
            labelShipmentIds.push(String(latest.id));
          }
        } else if (action === "print_invoices") {
          await this.loadOrder(organizationId, orderId);
          if (this.printCenter) printCandidateIds.push(orderId);
          else invoiceOrderIds.push(orderId);
        }
        results.push({ orderId, ok: true });
      } catch (e) {
        results.push({ orderId, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // ---- ON10: print actions create ONE print job ----
    // The per-order results shape is preserved: a done job
    // marks its orders ok (carrying the job id), the job's
    // failedOrderIds mark those orders failed with the job's
    // per-order reason, and a failed job fails every candidate
    // with the job's error. Nonexistent orders already failed
    // in the loop above and never reach the job.
    let printInfo: any = null;
    if (isPrintAction && this.printCenter && printCandidateIds.length > 0) {
      const type = action === "print_labels" ? "labels" : "invoices";
      try {
        const { job, failedReasons } = await this.printCenter.createJob(organizationId, actorId, {
          type, orderIds: printCandidateIds,
        });
        const failedSet = new Set<string>((job.failedOrderIds ?? []).map((x: any) => String(x)));
        for (const r of results) {
          if (!printCandidateIds.includes(r.orderId) || !r.ok) continue;
          if (job.status === "failed") {
            r.ok = false;
            r.error = job.error ?? "প্রিন্ট জব ব্যর্থ হয়েছে";
          } else if (failedSet.has(r.orderId)) {
            r.ok = false;
            r.error = failedReasons[r.orderId] ?? "ছাপানো যায়নি";
          } else {
            r.printJobId = job.id;
          }
        }
        printInfo = { jobId: job.id, type, status: job.status, failedOrderIds: job.failedOrderIds ?? [] };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        for (const r of results) {
          if (!printCandidateIds.includes(r.orderId) || !r.ok) continue;
          r.ok = false;
          r.error = message;
        }
        printInfo = { jobId: null, type, status: "failed", failedOrderIds: printCandidateIds };
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.length - succeeded;
    try {
      await this.audit?.log({
        organizationId, userId: actorId, action: "orders.bulk",
        entityType: "Order", metadata: { action, total: results.length, succeeded, failed },
      });
    } catch { /* audit is failure-isolated */ }

    const out: any = { results, succeeded, failed };
    if (printInfo) out.print = printInfo;
    else if (action === "print_labels") out.print = { labelShipmentIds };
    else if (action === "print_invoices") out.print = { invoiceOrderIds };
    return out;
  }
}
