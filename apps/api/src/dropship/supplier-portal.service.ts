import {
  Injectable,
  Optional,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { badRequest, forbidden, notFound } from "../i18n/api-exception";

/**
 * NF12 (FB4) — Supplier portal.
 *
 * Token discipline = NF9 RiderShareLink / OrgInviteLink
 * verbatim: raw token `randomBytes(32)` base64url, returned
 * ONCE at issue/rotation; at rest only SHA-256 hex. One link
 * per supplier — rotation overwrites the hash (old token dies
 * immediately); revoke stamps revokedAt and is terminal until
 * staff issue again. Links expire 30 days after issue.
 *
 * MINIMISATION (the core requirement): the token resolves to
 * exactly ONE (organizationId, supplierId) pair. The portal
 * payload contains ONLY that supplier's own purchase orders
 * from that one org (number/id, items, amounts, status, dates)
 * plus the org's display NAME — nothing else: no customer
 * orders, no customers, no other suppliers, no other org data.
 * Every portal read/write is scoped by the link's pair; a PO id
 * from another supplier is indistinguishable from a missing PO
 * (404), so existence never leaks across suppliers.
 *
 * PO TRANSITION MAPPING (audited — purchasing.service.ts):
 * the PO vocabulary is draft | ordered | partially_received |
 * received | cancelled, and the ONLY manual transitions are
 * draft→ordered and draft|ordered→cancelled; received /
 * partially_received are driven exclusively by the buyer's
 * receive flow. The portal therefore maps:
 *   confirm      → the EXISTING draft→ordered transition
 *                  (+ supplierConfirmedAt stamp). Confirming an
 *                  already-ordered PO is an idempotent no-op
 *                  that only ensures the stamp.
 *   mark shipped → NO status change (no "shipped" status
 *                  exists and none is invented): stamps
 *                  supplierShippedAt + optional note on an
 *                  ordered / partially_received PO.
 * The portal can never cancel, edit items, or receive a PO.
 */

export const NF12_PORTAL_LINK_TTL_MS = 30 * 24 * 3600 * 1000;

export function hashSupplierPortalToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function newSupplierPortalToken(): string {
  return randomBytes(32).toString("base64url");
}

export function supplierPortalLinkFor(token: string): string {
  const base = (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/supplier/${token}`;
}

@Injectable()
export class SupplierPortalService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  // ---------------- staff: link management ----------------

  private async supplierOr404(orgId: string, supplierId: string) {
    const row = await this.t("supplier").findFirst({ where: { id: supplierId, organizationId: orgId } });
    if (!row) throw notFound("dropship.supplierNotFoundInThisOrganization");
    return row;
  }

  /** Issue a fresh link or ROTATE the existing one. The raw
   * token leaves the server exactly once, in this response. */
  async issueLink(orgId: string, actorId: string, supplierId: string) {
    const supplier = await this.supplierOr404(orgId, supplierId);
    if (!supplier.active) {
      throw badRequest("dropship.thisSupplierIsNotActiveActivate");
    }
    const raw = newSupplierPortalToken();
    const expiresAt = new Date(Date.now() + NF12_PORTAL_LINK_TTL_MS);
    const table = this.t("supplierPortalLink");
    const existing = await table.findFirst({ where: { organizationId: orgId, supplierId: supplier.id } });
    if (existing) {
      await table.update({
        where: { id: existing.id },
        data: { tokenHash: hashSupplierPortalToken(raw), revokedAt: null, expiresAt },
      });
    } else {
      await table.create({
        data: { organizationId: orgId, supplierId: supplier.id, tokenHash: hashSupplierPortalToken(raw), expiresAt },
      });
    }
    await this.audit?.log({
      organizationId: orgId, userId: actorId,
      action: existing ? "supplier.portal_link_rotated" : "supplier.portal_link_issued",
      entityType: "Supplier", entityId: supplier.id,
    }).catch(() => undefined);
    return {
      supplierId: supplier.id,
      token: raw,
      link: supplierPortalLinkFor(raw),
      expiresAt,
      rotated: Boolean(existing),
      note: "এই লিংকটি শুধুমাত্র একবারই দেখানো হচ্ছে — সরবরাহকারীকে নিরাপদে পাঠিয়ে দিন।",
    };
  }

  async revokeLink(orgId: string, actorId: string, supplierId: string) {
    const supplier = await this.supplierOr404(orgId, supplierId);
    const table = this.t("supplierPortalLink");
    const existing = await table.findFirst({ where: { organizationId: orgId, supplierId: supplier.id } });
    if (!existing) throw notFound("dropship.thisSupplierHasNoPortalLink");
    await table.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "supplier.portal_link_revoked",
      entityType: "Supplier", entityId: supplier.id,
    }).catch(() => undefined);
    return { supplierId: supplier.id, revoked: true };
  }

  async linkStatus(orgId: string, supplierId: string) {
    await this.supplierOr404(orgId, supplierId);
    const link = await this.t("supplierPortalLink").findFirst({
      where: { organizationId: orgId, supplierId },
    });
    if (!link) return { supplierId, hasLink: false, active: false, expiresAt: null, revokedAt: null };
    const active = !link.revokedAt && new Date(link.expiresAt).getTime() > Date.now();
    // The hash NEVER leaves the server.
    return { supplierId, hasLink: true, active, expiresAt: link.expiresAt, revokedAt: link.revokedAt ?? null, lastSeenAt: link.lastSeenAt ?? null };
  }

  // ---------------- public: token resolution ----------------

  /** Resolve a presented token to its link. Wrong token → 404
   * (no row, nothing leaks); revoked/expired → Bengali 403. */
  private async resolveLink(token: string) {
    const raw = String(token ?? "").trim();
    if (!raw) throw notFound("dropship.thePortalLinkWasNotFound");
    const link = await this.t("supplierPortalLink").findFirst({
      where: { tokenHash: hashSupplierPortalToken(raw) },
    });
    if (!link) throw notFound("dropship.thePortalLinkWasNotFound");
    if (link.revokedAt) throw forbidden("dropship.thisPortalLinkHasBeenRevoked");
    if (new Date(link.expiresAt).getTime() <= Date.now()) {
      throw forbidden("dropship.thisPortalLinkHasExpiredContact");
    }
    const supplier = await this.t("supplier").findFirst({
      where: { id: link.supplierId, organizationId: link.organizationId },
    });
    if (!supplier || !supplier.active) {
      throw forbidden("dropship.thisSupplierAccountIsNotActive");
    }
    return { link, supplier };
  }

  /** The portal home payload: ONLY this supplier's own POs from
   * this one org + the org's display name. */
  async publicResolve(token: string) {
    const { link, supplier } = await this.resolveLink(token);
    await this.t("supplierPortalLink")
      .update({ where: { id: link.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
    const org = await this.t("organization").findFirst({ where: { id: link.organizationId } });
    const pos = ((await this.t("purchaseOrder").findMany({
      where: { organizationId: link.organizationId, supplierId: supplier.id },
      orderBy: { createdAt: "desc" },
    })) ?? []) as any[];
    const purchaseOrders = await Promise.all(pos.map((po: any) => this.portalPoView(link.organizationId, po)));
    return {
      organizationName: org?.name ?? null,
      supplier: {
        id: supplier.id,
        name: supplier.name,
        leadTimeDays: supplier.leadTimeDays ?? null,
        leadTimeNote: supplier.leadTimeNote ?? null,
      },
      purchaseOrders,
      linkExpiresAt: link.expiresAt,
    };
  }

  /** One PO as the portal may see it: items with product names
   * (the supplier's OWN PO lines), amounts, status, dates, and
   * the portal stamps. No buyer-side internals. */
  private async portalPoView(orgId: string, po: any) {
    const lines = ((await this.t("purchaseOrderItem").findMany({
      where: { purchaseOrderId: po.id },
    })) ?? []) as any[];
    const items = await Promise.all(lines.map(async (item: any) => {
      const product = await this.t("product").findFirst({
        where: { id: item.productId, organizationId: orgId },
      });
      return {
        id: item.id,
        productName: product?.name ?? null,
        sku: item.sku ?? null,
        qtyOrdered: item.qtyOrdered,
        qtyReceived: item.qtyReceived,
        unitCostMinor: String(item.unitCostMinor),
        lineTotalMinor: String(BigInt(item.qtyOrdered) * BigInt(item.unitCostMinor)),
      };
    }));
    const totalMinor = lines.reduce((s: bigint, i: any) => s + BigInt(i.qtyOrdered) * BigInt(i.unitCostMinor), 0n);
    return {
      id: po.id,
      status: po.status,
      expectedDate: po.expectedDate ?? null,
      note: po.note ?? null,
      createdAt: po.createdAt,
      updatedAt: po.updatedAt,
      supplierConfirmedAt: po.supplierConfirmedAt ?? null,
      supplierShippedAt: po.supplierShippedAt ?? null,
      supplierShipNote: po.supplierShipNote ?? null,
      totalMinor: String(totalMinor),
      items,
    };
  }

  /** Load a PO strictly inside the link's (org, supplier) scope.
   * Another supplier's PO id → 404, exactly like a missing PO. */
  private async portalPoOr404(link: any, poId: string) {
    const po = await this.t("purchaseOrder").findFirst({
      where: { id: poId, organizationId: link.organizationId, supplierId: link.supplierId },
    });
    if (!po) throw notFound("dropship.thePurchaseOrderWasNotFound");
    return po;
  }

  /** Portal confirm → the EXISTING draft→ordered manual
   * transition (see header mapping). */
  async confirmPo(token: string, poId: string) {
    const { link } = await this.resolveLink(token);
    const po = await this.portalPoOr404(link, poId);
    if (po.status === "cancelled" || po.status === "received") {
      throw badRequest("dropship.aPurchaseOrderCannotBeConfirmed", { poStatus: po.status });
    }
    const data: Record<string, any> = {};
    if (po.status === "draft") data.status = "ordered";
    if (!po.supplierConfirmedAt) data.supplierConfirmedAt = new Date();
    if (Object.keys(data).length) {
      await this.t("purchaseOrder").update({ where: { id: po.id }, data });
    }
    const fresh = await this.portalPoOr404(link, poId);
    return this.portalPoView(link.organizationId, fresh);
  }

  /** Portal "mark shipped" → stamp only (see header mapping):
   * no status is invented; the buyer's receive flow remains
   * the only road to received / partially_received. */
  async shipPo(token: string, poId: string, dto: { note?: unknown } = {}) {
    const { link } = await this.resolveLink(token);
    const po = await this.portalPoOr404(link, poId);
    if (!["ordered", "partially_received"].includes(po.status)) {
      throw badRequest("dropship.onlyAConfirmedOrderedPurchaseOrder");
    }
    if (po.supplierShippedAt) {
      throw badRequest("dropship.thisPurchaseOrderIsAlreadyMarked");
    }
    const note = typeof dto.note === "string" ? dto.note.slice(0, 500) : null;
    await this.t("purchaseOrder").update({
      where: { id: po.id },
      data: { supplierShippedAt: new Date(), ...(note ? { supplierShipNote: note } : {}) },
    });
    const fresh = await this.portalPoOr404(link, poId);
    return this.portalPoView(link.organizationId, fresh);
  }

  /** The supplier maintains their own lead time on their own
   * supplier record — the only non-PO write the portal has. */
  async updateLeadTime(token: string, dto: { leadTimeDays?: unknown; leadTimeNote?: unknown }) {
    const { link, supplier } = await this.resolveLink(token);
    const data: Record<string, any> = {};
    if (dto.leadTimeDays !== undefined) {
      if (dto.leadTimeDays === null) data.leadTimeDays = null;
      else if (Number.isInteger(dto.leadTimeDays) && (dto.leadTimeDays as number) >= 0 && (dto.leadTimeDays as number) <= 365) {
        data.leadTimeDays = dto.leadTimeDays;
      } else {
        throw badRequest("dropship.theLeadTimeDaysMustBe");
      }
    }
    if (dto.leadTimeNote !== undefined) {
      data.leadTimeNote = dto.leadTimeNote === null ? null : String(dto.leadTimeNote).slice(0, 500);
    }
    if (!Object.keys(data).length) throw badRequest("dropship.nothingWasSent");
    const updated = await this.t("supplier").update({ where: { id: supplier.id }, data });
    return {
      supplier: {
        id: updated.id, name: updated.name,
        leadTimeDays: updated.leadTimeDays ?? null,
        leadTimeNote: updated.leadTimeNote ?? null,
      },
    };
  }
}
