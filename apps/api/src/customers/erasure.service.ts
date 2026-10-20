import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { notFound } from "../i18n/api-exception";

export interface ErasureReport {
  customerId: string;
  ordersAnonymized: number;
  identitiesDeleted: number;
  reviewsRedacted: number;
  abandonedCheckoutsDeleted: number;
}

export const ERASED_LABEL = "মুছে ফেলা হয়েছে";

/**
 * CP6: GDPR-style deep erasure for ONE customer, shared by the
 * staff endpoint (CustomersService.eraseCustomer delegates here)
 * and the Shopify GDPR customers/redact webhook (ShopifyService
 * injects this service directly — CustomersModule cannot be
 * imported by IntegrationsModule: Customers -> Orders ->
 * Integrations would close a module cycle, while this service
 * depends only on the global Prisma/Audit modules).
 *
 * What is erased vs kept, deliberately:
 *  - Orders keep their FINANCIAL fields (totals, refunds, status)
 *    — accounting records survive; only the delivery address
 *    (PII) is nulled.
 *  - The Customer row itself is KEPT (orders reference it) with
 *    every PII field wiped: name -> the erased label, email /
 *    phone / address / customFields / referralCode -> null.
 *  - CustomerStoreIdentity rows are deleted outright (they exist
 *    only to link this person to store accounts).
 *  - ExternalReview has NO customerId / orderId / email / photo
 *    field (verified against the schema) — the only link it
 *    carries to a person is authorName, so rows whose authorName
 *    exactly equals the customer's full name are redacted to the
 *    erased label. imageUrls on that model are review-attached
 *    product photos, not reviewer PII, and are left alone.
 *  - AbandonedStoreCheckout rows DO carry email/phone — rows
 *    matching this customer's email or phone are deleted.
 */
@Injectable()
export class ErasureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async eraseCustomer(organizationId: string, actorId: string, customerId: string): Promise<ErasureReport> {
    const customer = await (this.prisma as any).customer.findFirst({ where: { id: customerId, organizationId } });
    if (!customer) throw notFound("customers.customerNotFoundInThisOrganization");

    // Captured BEFORE the wipe — steps 3/4 match on them.
    const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
    const email: string | null = customer.email ?? null;
    const phone: string | null = customer.phone ?? null;

    // 1) Orders: address (PII) nulled; money fields untouched.
    const orders: any[] = (await (this.prisma as any).order.findMany({
      where: { organizationId, customerId },
    }).catch(() => [])) ?? [];
    let ordersAnonymized = 0;
    for (const o of orders) {
      await (this.prisma as any).order.update({ where: { id: o.id }, data: { address: null } });
      ordersAnonymized++;
    }

    // 2) Store identities: deleted.
    let identitiesDeleted = 0;
    const idTable = (this.prisma as any).customerStoreIdentity;
    if (idTable?.deleteMany) {
      const r = await idTable.deleteMany({ where: { customerId, organizationId } }).catch(() => null);
      identitiesDeleted = r?.count ?? 0;
    } else if (idTable?.findMany && idTable?.delete) {
      const rows = (await idTable.findMany({ where: { customerId, organizationId } }).catch(() => [])) ?? [];
      for (const row of rows) {
        await idTable.delete({ where: { id: row.id } });
        identitiesDeleted++;
      }
    }

    // 3) External reviews linked by authorName (see class note).
    let reviewsRedacted = 0;
    const revTable = (this.prisma as any).externalReview;
    if (revTable?.findMany && revTable?.update && fullName) {
      const rows = (await revTable.findMany({ where: { organizationId } }).catch(() => [])) ?? [];
      for (const row of rows) {
        if (row.authorName === fullName) {
          await revTable.update({ where: { id: row.id }, data: { authorName: ERASED_LABEL } });
          reviewsRedacted++;
        }
      }
    }

    // 4) Abandoned store checkouts matching email/phone.
    let abandonedCheckoutsDeleted = 0;
    const abTable = (this.prisma as any).abandonedStoreCheckout;
    if (abTable?.findMany && (email || phone)) {
      const rows = (await abTable.findMany({ where: { organizationId } }).catch(() => [])) ?? [];
      for (const row of rows) {
        const hit = (email && row.email === email) || (phone && row.phone === phone);
        if (!hit) continue;
        if (typeof abTable.delete === "function") await abTable.delete({ where: { id: row.id } });
        else if (typeof abTable.deleteMany === "function") await abTable.deleteMany({ where: { id: row.id } });
        else continue;
        abandonedCheckoutsDeleted++;
      }
    }

    // 5) The customer row: PII wiped, row kept for order references.
    await (this.prisma as any).customer.update({
      where: { id: customerId },
      data: {
        firstName: ERASED_LABEL,
        lastName: null,
        email: null,
        phone: null,
        address: null,
        customFields: null,
        referralCode: null,
      },
    });

    // 6) Report + audit.
    const report: ErasureReport = {
      customerId,
      ordersAnonymized,
      identitiesDeleted,
      reviewsRedacted,
      abandonedCheckoutsDeleted,
    };
    await this.audit.log({
      organizationId, userId: actorId, action: "customers.erase",
      entityType: "Customer", entityId: customerId, metadata: { ...report },
    }).catch(() => undefined);
    return report;
  }
}
