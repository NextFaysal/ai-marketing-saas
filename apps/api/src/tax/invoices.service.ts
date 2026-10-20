import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { notFound } from "../i18n/api-exception";

/**
 * EC23: BD fiscal year (Jul–Jun) for a date, judged in Asia/Dhaka.
 * Oct 2026 → "2026-27"; Jun 2027 → "2026-27"; Jul 2027 → "2027-28".
 */
export function fiscalYearFor(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return month >= 7 ? `${year}-${String(year + 1).slice(2)}` : `${year - 1}-${String(year).slice(2)}`;
}

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  fiscalYearFor(date: Date): string {
    return fiscalYearFor(date);
  }

  private async loadOrder(orgId: string, orderId: string, tx?: any): Promise<any> {
    const db = tx ?? this.prisma;
    const order = await (db as any).order.findFirst({
      where: { id: orderId, organizationId: orgId },
    });
    if (!order) throw notFound("tax.orderNotFoundInThisOrganization");
    return order;
  }

  /**
   * Return the order's fiscal invoice number, assigning one on
   * first call. Race-safety: the sequence lives on the
   * (organizationId, fiscalYear) InvoiceCounter row and is bumped
   * with an atomic `increment` inside a transaction, so concurrent
   * issuers can never draw the same seq; the number is then
   * written with updateMany guarded on `invoiceNumber: null`, so
   * if a racing issuer already stamped this order, the second
   * writer writes nothing (count 0) and re-reads the winner's
   * number instead of overwriting it. The
   * @@unique([organizationId, invoiceNumber]) constraint is the
   * final backstop.
   */
  async ensureInvoiceNumber(orgId: string, orderId: string, now: Date = new Date()): Promise<string> {
    const order = await this.loadOrder(orgId, orderId);
    if (order.invoiceNumber) return String(order.invoiceNumber);
    const fiscalYear = fiscalYearFor(now);
    const run = async (tx: any): Promise<string> => {
      const counterTable = tx.invoiceCounter;
      await counterTable.upsert({
        where: { organizationId_fiscalYear: { organizationId: orgId, fiscalYear } },
        create: { organizationId: orgId, fiscalYear, lastSeq: 0 },
        update: {},
      });
      const updated = await counterTable.update({
        where: { organizationId_fiscalYear: { organizationId: orgId, fiscalYear } },
        data: { lastSeq: { increment: 1 } },
      });
      const seq = Number(updated.lastSeq);
      const candidate = `INV-${fiscalYear}-${String(seq).padStart(5, "0")}`;
      const stamped = await tx.order.updateMany({
        where: { id: orderId, organizationId: orgId, invoiceNumber: null },
        data: { invoiceNumber: candidate },
      });
      if (!stamped || stamped.count === 0) {
        const winner = await this.loadOrder(orgId, orderId, tx);
        if (winner.invoiceNumber) return String(winner.invoiceNumber);
        throw new Error("Invoice number assignment raced and no number was recorded");
      }
      return candidate;
    };
    const prismaAny = this.prisma as any;
    return typeof prismaAny.$transaction === "function" ? prismaAny.$transaction(run) : run(prismaAny);
  }

  /** Invoice payload for the print page: the (ensured) fiscal
   * number, the seller identity from TaxSetting (nulls when unset —
   * never fabricated), and the order serialized exactly like the
   * orders getOne shape (BigInt money as strings). */
  async getInvoice(orgId: string, orderId: string) {
    const invoiceNumber = await this.ensureInvoiceNumber(orgId, orderId);
    const order = await (this.prisma as any).order.findFirst({
      where: { id: orderId, organizationId: orgId },
      include: { customer: true, items: true, store: true },
    });
    if (!order) throw notFound("tax.orderNotFoundInThisOrganization");
    const settingTable = (this.prisma as any).taxSetting;
    const setting = settingTable?.findFirst
      ? await settingTable.findFirst({ where: { organizationId: orgId } }).catch(() => null)
      : null;
    const serialized: any = {
      ...order,
      subtotalMinor: order.subtotalMinor?.toString(),
      shippingMinor: order.shippingMinor?.toString(),
      discountMinor: order.discountMinor?.toString(),
      taxMinor: order.taxMinor?.toString(),
      promotionDiscountMinor: order.promotionDiscountMinor?.toString() ?? "0",
      referralDiscountMinor: order.referralDiscountMinor?.toString() ?? "0",
      totalMinor: order.totalMinor?.toString(),
      refundedMinor: order.refundedMinor?.toString(),
      items: (order.items ?? []).map((i: any) => ({
        ...i,
        priceMinor: i.priceMinor?.toString(),
        totalMinor: i.totalMinor?.toString(),
      })),
    };
    const issuedSource = order.updatedAt ?? order.placedAt ?? order.createdAt ?? new Date();
    return {
      ...serialized,
      invoiceNumber,
      issuedAt: new Date(issuedSource).toISOString(),
      seller: {
        legalName: setting?.legalName ?? null,
        tin: setting?.tin ?? null,
        binVatNo: setting?.binVatNo ?? null,
      },
    };
  }
}
