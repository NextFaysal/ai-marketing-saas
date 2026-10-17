import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OrdersService } from "../orders/orders.service";

/**
 * NF12 (FB4) — Dropship network.
 *
 * This is the ONLY cross-org feature in the product, and it is
 * built minimisation-first:
 *
 *  - NOTHING is shared before acceptance. An invite is created
 *    by SLUG and reveals only that the org exists + its display
 *    name. Offers, listings, product reads and order creation
 *    all require an ACCEPTED agreement (service-enforced,
 *    spec-proven for pending AND declined).
 *  - The seller sees, per accepted agreement, ONLY the source
 *    org's dropship-eligible offers: product name, floor price,
 *    and the source product's REAL stock — read live, labelled
 *    "পার্টনার স্টক" (partner stock) with the supplying org's
 *    name, NEVER merged into the seller's own stock counts
 *    (the seller-side Product row keeps stockQuantity = null).
 *  - The supplier sees, per dropship order, ONLY
 *    fulfilment-necessary data: items, quantities and the
 *    customer's delivery name/phone/address. The supplier
 *    order is created through the canonical path
 *    (OrdersService.createManual → IntegrationsService
 *    upsert) priced at the WHOLESALE floor value — the
 *    seller's retail price and margin NEVER appear on it.
 *  - Exactly-once rides two established mechanisms stacked:
 *    DropshipOrderLink is unique per (sellerOrderId,
 *    agreementId) — the claim row a replay finds and reuses —
 *    AND the supplier order's externalRef is the deterministic
 *    `dropship:<sellerOrderId>:<agreementId>`, so even a lost
 *    link write replays into the SAME order via createManual's
 *    upsert dedupe (the NF1/AB5 pattern). No second supplier
 *    order can be created by a retry.
 *  - Status mirror is a READ MODEL: the link stores the
 *    supplier order's latest status, refreshed on every staff
 *    read + an explicit sync endpoint. The seller order keeps
 *    its own lifecycle untouched.
 *  - Cancellation: when the seller order is cancelled, the
 *    sync propagates the cancellation to the supplier order
 *    through OrdersService.updateOrder — but ONLY while the
 *    supplier order is pre-fulfilment (pending/on-hold/
 *    processing). A completed/delivered supplier order refuses
 *    propagation with the reason recorded on the link.
 *  - The ledger is RECORDS ONLY. margin = retail − wholesale
 *    from the REAL line values snapshotted at fulfilment
 *    creation; one entry per link (unique), written when the
 *    supplier order first reaches a sold status. NO payout is
 *    executed, NO wallet is touched — payouts remain behind
 *    the OU11 legal gate.
 */

export const DROPSHIP_SOLD_STATUSES = ["completed", "delivered"] as const;
export const DROPSHIP_CANCELLABLE_STATUSES = ["pending", "on-hold", "processing"] as const;
export const PARTNER_STOCK_LABEL = "পার্টনার স্টক";
export const DROPSHIP_PAYOUT_NOTE =
  "এই লেজারটি শুধুমাত্র একটি রেকর্ড — এর মাধ্যমে কোনো পেআউট সম্পন্ন হয় না। পেআউট OU11 আইনি গেটের (legal gate) পেছনে রয়েছে। (Records only — no payout is executed; payouts remain behind the OU11 legal gate.)";

/** Partner stock from the source org's REAL stock truth: the
 * AX4 bin balances (Σ onHand − reserved) when bin rows exist
 * for the product, else the S1 global Product.stockQuantity
 * (null = untracked). Never the seller's numbers. */
export function computePartnerStock(product: any, balances: any[]): number | null {
  if (Array.isArray(balances) && balances.length) {
    return balances.reduce((s, b) => s + (Number(b.onHand) || 0) - (Number(b.reserved) || 0), 0);
  }
  return product?.stockQuantity ?? null;
}

@Injectable()
export class DropshipService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly orders?: OrdersService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  private parseMinor(value: unknown, label: string): bigint {
    if (typeof value === "bigint" && value >= 0n) return value;
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
    throw new BadRequestException(`${label} অবশ্যই ০ বা তার বেশি পূর্ণসংখ্যা (পয়সায়) হতে হবে`);
  }

  // ---------------- agreements ----------------

  /** Invite by slug: the lookup returns existence + display
   * name ONLY (id is used internally to write the agreement;
   * the response carries name + slug of the counterparty). */
  async invite(orgId: string, actorId: string, dto: { slug?: unknown; role?: unknown }) {
    const slug = String(dto.slug ?? "").trim();
    if (!slug) throw new BadRequestException("অন্য প্রতিষ্ঠানের স্লাগ (slug) আবশ্যক");
    const role = String(dto.role ?? "");
    if (role !== "supplier" && role !== "seller") {
      throw new BadRequestException("role অবশ্যই supplier অথবা seller হতে হবে — অন্য প্রতিষ্ঠানটি আপনার supplier না seller?");
    }
    const other = await this.t("organization").findFirst({ where: { slug } });
    if (!other) throw new NotFoundException("এই স্লাগে কোনো প্রতিষ্ঠান পাওয়া যায়নি");
    if (other.id === orgId) throw new BadRequestException("নিজের প্রতিষ্ঠানকেই আমন্ত্রণ জানানো যাবে না");
    const supplierOrgId = role === "supplier" ? other.id : orgId;
    const sellerOrgId = role === "seller" ? other.id : orgId;
    const existing = await this.t("dropshipAgreement").findFirst({
      where: { supplierOrgId, sellerOrgId },
    });
    if (existing && existing.status === "pending") {
      throw new BadRequestException("এই প্রতিষ্ঠান জুটির মধ্যে ইতিমধ্যে একটি অপেক্ষমাণ আমন্ত্রণ আছে");
    }
    if (existing && existing.status === "accepted") {
      throw new BadRequestException("এই প্রতিষ্ঠান জুটির মধ্যে ইতিমধ্যে একটি সক্রিয় চুক্তি আছে");
    }
    const data = {
      supplierOrgId, sellerOrgId, invitedByOrgId: orgId,
      status: "pending", createdById: actorId,
      respondedById: null, respondedAt: null, revokedByOrgId: null, revokedAt: null,
    };
    const agreement = existing
      ? await this.t("dropshipAgreement").update({ where: { id: existing.id }, data })
      : await this.t("dropshipAgreement").create({ data });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "dropship.agreement_invited",
      entityType: "DropshipAgreement", entityId: agreement.id,
      metadata: { counterpartyName: other.name, role },
    }).catch(() => undefined);
    return this.agreementView(orgId, agreement);
  }

  private async agreementView(orgId: string, a: any) {
    const supplierOrg = await this.t("organization").findFirst({ where: { id: a.supplierOrgId } });
    const sellerOrg = await this.t("organization").findFirst({ where: { id: a.sellerOrgId } });
    const mine = orgId === a.supplierOrgId ? "supplier" : "seller";
    const counterparty = mine === "supplier" ? sellerOrg : supplierOrg;
    return {
      id: a.id,
      status: a.status,
      myRole: mine,
      invitedByMe: a.invitedByOrgId === orgId,
      supplierOrg: { id: a.supplierOrgId, name: supplierOrg?.name ?? null, slug: supplierOrg?.slug ?? null },
      sellerOrg: { id: a.sellerOrgId, name: sellerOrg?.name ?? null, slug: sellerOrg?.slug ?? null },
      counterpartyName: counterparty?.name ?? null,
      createdAt: a.createdAt,
      respondedAt: a.respondedAt ?? null,
    };
  }

  async listAgreements(orgId: string) {
    const rows = ((await this.t("dropshipAgreement").findMany({
      where: { OR: [{ supplierOrgId: orgId }, { sellerOrgId: orgId }] },
      orderBy: { createdAt: "desc" },
    })) ?? []) as any[];
    const items = await Promise.all(rows.map((a: any) => this.agreementView(orgId, a)));
    return { items };
  }

  private async agreementOr404(orgId: string, agreementId: string) {
    const a = await this.t("dropshipAgreement").findFirst({
      where: { id: agreementId, OR: [{ supplierOrgId: orgId }, { sellerOrgId: orgId }] },
    });
    if (!a) throw new NotFoundException("চুক্তিটি পাওয়া যায়নি");
    return a;
  }

  private async acceptedAgreementOrRefuse(orgId: string, agreementId: string) {
    const a = await this.agreementOr404(orgId, agreementId);
    if (a.status !== "accepted") {
      throw new ForbiddenException("চুক্তিটি এখনো সক্রিয় নয় — গ্রহণ (accepted) না হওয়া পর্যন্ত কিছুই শেয়ার করা হয় না");
    }
    return a;
  }

  /** OWNER/ADMIN of the INVITED org accepts or declines (the
   * controller enforces the role; here the side + state are
   * enforced). The inviter cannot respond to their own invite. */
  async respond(orgId: string, actorId: string, agreementId: string, accept: boolean) {
    const a = await this.agreementOr404(orgId, agreementId);
    if (a.status !== "pending") throw new BadRequestException("এই আমন্ত্রণটির উত্তর ইতিমধ্যে দেওয়া হয়েছে");
    if (a.invitedByOrgId === orgId) {
      throw new ForbiddenException("নিজের পাঠানো আমন্ত্রণের উত্তর নিজে দেওয়া যাবে না — অন্য প্রতিষ্ঠানের মালিক/অ্যাডমিন উত্তর দেবেন");
    }
    const updated = await this.t("dropshipAgreement").update({
      where: { id: a.id },
      data: { status: accept ? "accepted" : "declined", respondedById: actorId, respondedAt: new Date() },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId,
      action: accept ? "dropship.agreement_accepted" : "dropship.agreement_declined",
      entityType: "DropshipAgreement", entityId: a.id,
    }).catch(() => undefined);
    return this.agreementView(orgId, updated);
  }

  /** Either side revokes. Revocation stops NEW listings and
   * NEW fulfilment orders; existing order links keep their
   * status mirror (their supplier orders are real orders with
   * their own lifecycle — documented in the acceptance doc). */
  async revoke(orgId: string, actorId: string, agreementId: string) {
    const a = await this.agreementOr404(orgId, agreementId);
    if (a.status === "revoked") throw new BadRequestException("চুক্তিটি ইতিমধ্যে বাতিল করা হয়েছে");
    if (a.status === "declined") throw new BadRequestException("প্রত্যাখ্যাত আমন্ত্রণ বাতিল করার কিছু নেই");
    const updated = await this.t("dropshipAgreement").update({
      where: { id: a.id },
      data: { status: "revoked", revokedByOrgId: orgId, revokedAt: new Date() },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "dropship.agreement_revoked",
      entityType: "DropshipAgreement", entityId: a.id,
    }).catch(() => undefined);
    return this.agreementView(orgId, updated);
  }

  // ---------------- offers (source side) ----------------

  /** The SOURCE org marks one of ITS OWN products eligible for
   * this agreement + sets the floor (wholesale) price. Only on
   * an ACCEPTED agreement — while pending, nothing is shared,
   * so nothing can be offered either. */
  async setOffer(orgId: string, actorId: string, agreementId: string, dto: { productId?: unknown; floorPriceMinor?: unknown; active?: unknown }) {
    const a = await this.acceptedAgreementOrRefuse(orgId, agreementId);
    if (a.supplierOrgId !== orgId) {
      throw new ForbiddenException("শুধুমাত্র source (supplier) প্রতিষ্ঠানই পণ্য অফার করতে পারে");
    }
    const product = await this.t("product").findFirst({
      where: { id: String(dto.productId ?? ""), organizationId: orgId },
    });
    if (!product) throw new NotFoundException("Product not found in this organization");
    const floor = this.parseMinor(dto.floorPriceMinor, "ফ্লোর মূল্য (floorPriceMinor)");
    const table = this.t("dropshipOffer");
    const existing = await table.findFirst({ where: { agreementId: a.id, productId: product.id } });
    const data = {
      agreementId: a.id, organizationId: orgId, productId: product.id,
      floorPriceMinor: floor, active: dto.active === undefined ? true : Boolean(dto.active),
    };
    const offer = existing
      ? await table.update({ where: { id: existing.id }, data })
      : await table.create({ data });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "dropship.offer_set",
      entityType: "DropshipOffer", entityId: offer.id,
      metadata: { agreementId: a.id, productId: product.id, floorPriceMinor: String(floor) },
    }).catch(() => undefined);
    return this.offerView(offer, product);
  }

  private async partnerStock(sourceOrgId: string, product: any): Promise<number | null> {
    let balances: any[] = [];
    try {
      balances = ((await this.t("stockBalance").findMany({
        where: { organizationId: sourceOrgId, productId: product.id, variantId: null },
      })) ?? []) as any[];
    } catch { balances = []; }
    return computePartnerStock(product, balances);
  }

  private async offerView(offer: any, product?: any) {
    const p = product ?? (await this.t("product").findFirst({ where: { id: offer.productId, organizationId: offer.organizationId } }));
    const stock = p ? await this.partnerStock(offer.organizationId, p) : null;
    return {
      id: offer.id,
      agreementId: offer.agreementId,
      productId: offer.productId,
      productName: p?.name ?? null,
      floorPriceMinor: String(offer.floorPriceMinor),
      active: offer.active,
      // Partner stock: the source org's REAL stock, labelled —
      // never a seller-side number.
      partnerStock: stock,
      partnerStockLabel: PARTNER_STOCK_LABEL,
    };
  }

  /** Offers visible to ONE side of an agreement. The seller
   * side sees eligible offers ONLY while accepted (the gate is
   * acceptedAgreementOrRefuse) and ONLY the minimised view
   * above — no cost, no other products, nothing else. */
  async listOffers(orgId: string, agreementId: string) {
    const a = await this.acceptedAgreementOrRefuse(orgId, agreementId);
    const where: any = { agreementId: a.id };
    if (a.sellerOrgId === orgId) where.active = true;
    const rows = ((await this.t("dropshipOffer").findMany({ where, orderBy: { createdAt: "desc" } })) ?? []) as any[];
    const items = await Promise.all(rows.map((o: any) => this.offerView(o)));
    return { items };
  }

  // ---------------- listings (seller side) ----------------

  async createListing(orgId: string, actorId: string, dto: { agreementId?: unknown; offerId?: unknown; priceMinor?: unknown }) {
    const a = await this.acceptedAgreementOrRefuse(orgId, String(dto.agreementId ?? ""));
    if (a.sellerOrgId !== orgId) {
      throw new ForbiddenException("শুধুমাত্র seller প্রতিষ্ঠানই তাদের দোকানে লিস্টিং তৈরি করতে পারে");
    }
    const offer = await this.t("dropshipOffer").findFirst({
      where: { id: String(dto.offerId ?? ""), agreementId: a.id, active: true },
    });
    if (!offer) throw new NotFoundException("অফারটি পাওয়া যায়নি অথবা সক্রিয় নয়");
    const price = this.parseMinor(dto.priceMinor, "বিক্রয় মূল্য (priceMinor)");
    if (price < BigInt(offer.floorPriceMinor)) {
      throw new BadRequestException(
        `বিক্রয় মূল্য ফ্লোর মূল্যের (${String(offer.floorPriceMinor)}) চেয়ে কম হতে পারবে না`,
      );
    }
    const existing = await this.t("dropshipListing").findFirst({
      where: { agreementId: a.id, sourceProductId: offer.productId },
    });
    if (existing) throw new BadRequestException("এই পণ্যের লিস্টিং ইতিমধ্যে আছে");
    const source = await this.t("product").findFirst({
      where: { id: offer.productId, organizationId: a.supplierOrgId },
    });
    if (!source) throw new NotFoundException("Source পণ্যটি পাওয়া যায়নি");
    // The listing IS a real Product in the SELLER org (so the
    // shop, cart and order paths treat it like any product) —
    // with stockQuantity = null: partner stock is read live
    // from the source and NEVER merged into seller stock.
    const sellerProduct = await this.t("product").create({
      data: {
        organizationId: orgId,
        name: source.name,
        description: source.description ?? null,
        priceMinor: price,
        currency: source.currency ?? "BDT",
        stockQuantity: null,
        status: "ACTIVE",
        source: "dropship",
        imageUrl: source.imageUrl ?? null,
      },
    });
    const listing = await this.t("dropshipListing").create({
      data: {
        sellerOrgId: orgId, agreementId: a.id, offerId: offer.id,
        sourceProductId: offer.productId, sellerProductId: sellerProduct.id,
        priceMinor: price, active: true, createdById: actorId,
      },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "dropship.listing_created",
      entityType: "DropshipListing", entityId: listing.id,
      metadata: { agreementId: a.id, sourceProductId: offer.productId, priceMinor: String(price) },
    }).catch(() => undefined);
    return this.listingView(listing);
  }

  private async listingView(l: any) {
    const agreement = await this.t("dropshipAgreement").findFirst({ where: { id: l.agreementId } });
    const src = agreement
      ? await this.t("product").findFirst({ where: { id: l.sourceProductId, organizationId: agreement.supplierOrgId } })
      : null;
    const supplierOrg = agreement
      ? await this.t("organization").findFirst({ where: { id: agreement.supplierOrgId } })
      : null;
    const stock = src && agreement ? await this.partnerStock(agreement.supplierOrgId, src) : null;
    return {
      id: l.id,
      agreementId: l.agreementId,
      sourceProductId: l.sourceProductId,
      sourceProductName: src?.name ?? null,
      sellerProductId: l.sellerProductId,
      priceMinor: String(l.priceMinor),
      active: l.active,
      partnerStock: stock,
      partnerStockLabel: PARTNER_STOCK_LABEL,
      suppliedBy: supplierOrg?.name ?? null,
    };
  }

  async listListings(orgId: string) {
    const rows = ((await this.t("dropshipListing").findMany({
      where: { sellerOrgId: orgId }, orderBy: { createdAt: "desc" },
    })) ?? []) as any[];
    const items = await Promise.all(rows.map((l: any) => this.listingView(l)));
    return { items };
  }

  async setListingActive(orgId: string, actorId: string, listingId: string, active: boolean) {
    const l = await this.t("dropshipListing").findFirst({ where: { id: listingId, sellerOrgId: orgId } });
    if (!l) throw new NotFoundException("লিস্টিংটি পাওয়া যায়নি");
    const updated = await this.t("dropshipListing").update({ where: { id: l.id }, data: { active } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: active ? "dropship.listing_activated" : "dropship.listing_deactivated",
      entityType: "DropshipListing", entityId: l.id,
    }).catch(() => undefined);
    return this.listingView(updated);
  }

  // ---------------- dropship order flow ----------------

  /**
   * Create the supplier-side fulfilment order(s) for a seller
   * order that contains dropship listing items. Exactly-once
   * per (sellerOrder, agreement) — see the header. Revoked /
   * non-accepted agreements create NOTHING new (existing links
   * are returned as-is).
   */
  async processSellerOrder(sellerOrgId: string, actorId: string, sellerOrderId: string) {
    if (!this.orders?.createManual) {
      throw new BadRequestException("Dropship অর্ডার সুবিধা এই deployment-এ নেই");
    }
    const sellerOrder = await this.t("order").findFirst({
      where: { id: sellerOrderId, organizationId: sellerOrgId },
    });
    if (!sellerOrder) throw new NotFoundException("Order not found in this organization");
    const items = ((await this.t("orderItem").findMany({ where: { orderId: sellerOrder.id } })) ?? []) as any[];
    const customer = sellerOrder.customerId
      ? await this.t("customer").findFirst({ where: { id: sellerOrder.customerId, organizationId: sellerOrgId } })
      : null;
    const customerName =
      [customer?.firstName, customer?.lastName].filter(Boolean).join(" ").trim() || customer?.phone || "Customer";
    const customerPhone = customer?.phone ?? "";
    if (!customerPhone) {
      throw new BadRequestException("ক্রেতার ফোন নম্বর ছাড়া সরবরাহকারীর কাছে ফুলফিলমেন্ট অর্ডার পাঠানো যাবে না");
    }
    const custAddr = customer?.address && typeof customer.address === "object" ? customer.address : null;
    const address = sellerOrder.address ?? custAddr?.address_1 ?? custAddr?.address ?? null;

    // Resolve this order's dropship lines: item.productId → an
    // ACTIVE listing of THIS seller org → its offer (floor).
    const groups = new Map<string, { agreement: any; lines: any[] }>();
    for (const item of items) {
      if (!item.productId) continue;
      const listing = await this.t("dropshipListing").findFirst({
        where: { sellerOrgId, sellerProductId: item.productId, active: true },
      });
      if (!listing) continue;
      const agreement = await this.t("dropshipAgreement").findFirst({ where: { id: listing.agreementId } });
      if (!agreement) continue;
      const offer = await this.t("dropshipOffer").findFirst({ where: { id: listing.offerId } });
      if (!offer) continue;
      const g = groups.get(agreement.id) ?? { agreement, lines: [] };
      g.lines.push({ item, listing, offer });
      groups.set(agreement.id, g);
    }

    const results: any[] = [];
    for (const { agreement, lines } of groups.values()) {
      const linkTable = this.t("dropshipOrderLink");
      const existing = await linkTable.findFirst({
        where: { sellerOrderId: sellerOrder.id, agreementId: agreement.id },
      });
      if (existing) {
        await this.syncLink(existing).catch(() => undefined);
        results.push({ agreementId: agreement.id, linkId: existing.id, supplierOrderId: existing.supplierOrderId, reused: true });
        continue;
      }
      if (agreement.status !== "accepted") {
        results.push({ agreementId: agreement.id, skipped: "agreement_not_accepted" });
        continue;
      }
      // Supplier order lines: WHOLESALE (floor) prices + source
      // product names ONLY. Retail never crosses.
      const supplierItems = await Promise.all(lines.map(async ({ listing, offer }: any) => {
        const source = await this.t("product").findFirst({
          where: { id: listing.sourceProductId, organizationId: agreement.supplierOrgId },
        });
        return {
          name: source?.name ?? "Dropship item",
          sku: source?.sku ?? undefined,
          quantity: 0, // filled by caller below
          unitPriceMinor: String(BigInt(offer.floorPriceMinor)),
          _line: null as any,
        };
      }));
      lines.forEach((l: any, i: number) => { supplierItems[i].quantity = Number(l.item.quantity) || 0; supplierItems[i]._line = l; });
      const created: any = await this.orders.createManual(agreement.supplierOrgId, actorId, {
        customerName,
        customerPhone,
        address: address ?? undefined,
        isCod: sellerOrder.isCod !== false,
        status: "processing",
        externalRef: `dropship:${sellerOrder.id}:${agreement.id}`,
        items: supplierItems.map(({ name, sku, quantity, unitPriceMinor }: any) => ({ name, sku, quantity, unitPriceMinor })),
      } as any);
      const snapshot = lines.map((l: any) => ({
        listingId: l.listing.id,
        sourceProductId: l.listing.sourceProductId,
        qty: Number(l.item.quantity) || 0,
        retailUnitMinor: String(BigInt(l.listing.priceMinor)),
        wholesaleUnitMinor: String(BigInt(l.offer.floorPriceMinor)),
      }));
      let link: any;
      try {
        link = await linkTable.create({
          data: {
            sellerOrgId, supplierOrgId: agreement.supplierOrgId, agreementId: agreement.id,
            sellerOrderId: sellerOrder.id, supplierOrderId: created.id,
            supplierStatus: created.status ?? "processing", itemsSnapshot: snapshot,
          },
        });
      } catch {
        // The claim was lost to a concurrent create — the
        // supplier order itself deduped on externalRef, so the
        // existing link IS the fulfilment record.
        link = await linkTable.findFirst({
          where: { sellerOrderId: sellerOrder.id, agreementId: agreement.id },
        });
        results.push({ agreementId: agreement.id, linkId: link?.id ?? null, supplierOrderId: link?.supplierOrderId ?? created.id, reused: true });
        continue;
      }
      await this.audit?.log({
        organizationId: sellerOrgId, userId: actorId, action: "dropship.fulfilment_created",
        entityType: "DropshipOrderLink", entityId: link.id,
        metadata: { agreementId: agreement.id, supplierOrderId: created.id, sellerOrderId: sellerOrder.id },
      }).catch(() => undefined);
      results.push({ agreementId: agreement.id, linkId: link.id, supplierOrderId: created.id, reused: false });
    }
    return { sellerOrderId: sellerOrder.id, results };
  }

  // ---------------- status mirror + ledger + cancellation ----------------

  /** Refresh one link's mirror from the REAL supplier order.
   * Also: seller-cancel propagation and ledger-on-completion.
   * Returns the fresh link row. */
  async syncLink(link: any, actorId = "system:dropship") {
    if (!link?.supplierOrderId) return link;
    const supplierOrder = await this.t("order").findFirst({
      where: { id: link.supplierOrderId, organizationId: link.supplierOrgId },
    });
    if (!supplierOrder) return link;
    const sellerOrder = await this.t("order").findFirst({
      where: { id: link.sellerOrderId, organizationId: link.sellerOrgId },
    });
    const data: Record<string, any> = {};
    let status = String(supplierOrder.status ?? "");

    // Cancellation propagation (seller → supplier), only
    // pre-fulfilment; a sold supplier order refuses and the
    // reason is recorded on the link.
    if (sellerOrder?.status === "cancelled" && status !== "cancelled") {
      if ((DROPSHIP_CANCELLABLE_STATUSES as readonly string[]).includes(status)) {
        try {
          await this.orders?.updateOrder(link.supplierOrgId, actorId, supplierOrder.id, { status: "cancelled" } as any);
          status = "cancelled";
          data.cancelNote = "Seller order cancelled — supplier fulfilment cancelled through the normal order path.";
        } catch (e: any) {
          data.cancelNote = `Seller order cancelled, but supplier cancellation failed: ${e?.message ?? "unknown"}`;
        }
      } else {
        data.cancelNote = `Seller order cancelled, but the supplier order is already "${status}" — cancellation refused (fulfilment already completed/shipped).`;
      }
    }
    if (status !== link.supplierStatus) data.supplierStatus = status;
    let fresh = link;
    if (Object.keys(data).length) {
      fresh = await this.t("dropshipOrderLink").update({ where: { id: link.id }, data });
    }
    if ((DROPSHIP_SOLD_STATUSES as readonly string[]).includes(status)) {
      await this.ensureLedger(fresh).catch(() => undefined);
    }
    return fresh;
  }

  /** Ledger exactly-once: unique dropshipOrderLinkId + a
   * pre-check; totals from the link's REAL line snapshot. */
  private async ensureLedger(link: any) {
    const table = this.t("dropshipLedgerEntry");
    const existing = await table.findFirst({ where: { dropshipOrderLinkId: link.id } });
    if (existing) return existing;
    const lines = Array.isArray(link.itemsSnapshot) ? link.itemsSnapshot : [];
    let retail = 0n;
    let wholesale = 0n;
    for (const l of lines) {
      const qty = BigInt(Number(l.qty) || 0);
      retail += qty * BigInt(l.retailUnitMinor ?? 0);
      wholesale += qty * BigInt(l.wholesaleUnitMinor ?? 0);
    }
    try {
      return await table.create({
        data: {
          agreementId: link.agreementId, dropshipOrderLinkId: link.id,
          sellerOrgId: link.sellerOrgId, supplierOrgId: link.supplierOrgId,
          retailTotalMinor: retail, wholesaleTotalMinor: wholesale,
          marginMinor: retail - wholesale,
        },
      });
    } catch {
      return table.findFirst({ where: { dropshipOrderLinkId: link.id } });
    }
  }

  /** Side-aware link view. The SUPPLIER side never sees retail
   * unit prices or retail totals (minimisation); the SELLER
   * side sees both + the ledger state. */
  private linkView(orgId: string, link: any, ledger: any) {
    const isSeller = orgId === link.sellerOrgId;
    const lines = Array.isArray(link.itemsSnapshot) ? link.itemsSnapshot : [];
    return {
      id: link.id,
      agreementId: link.agreementId,
      sellerOrderId: link.sellerOrderId,
      supplierOrderId: link.supplierOrderId ?? null,
      supplierStatus: link.supplierStatus ?? null,
      cancelNote: link.cancelNote ?? null,
      myRole: isSeller ? "seller" : "supplier",
      items: lines.map((l: any) => ({
        listingId: l.listingId,
        sourceProductId: l.sourceProductId,
        qty: l.qty,
        wholesaleUnitMinor: l.wholesaleUnitMinor,
        ...(isSeller ? { retailUnitMinor: l.retailUnitMinor } : {}),
      })),
      ledger: ledger
        ? {
            id: ledger.id,
            retailTotalMinor: String(ledger.retailTotalMinor),
            wholesaleTotalMinor: String(ledger.wholesaleTotalMinor),
            marginMinor: String(ledger.marginMinor),
            payoutNote: DROPSHIP_PAYOUT_NOTE,
          }
        : null,
      createdAt: link.createdAt,
    };
  }

  async listDropshipOrders(orgId: string) {
    const rows = ((await this.t("dropshipOrderLink").findMany({
      where: { OR: [{ sellerOrgId: orgId }, { supplierOrgId: orgId }] },
      orderBy: { createdAt: "desc" },
    })) ?? []) as any[];
    const items: any[] = [];
    for (const row of rows) {
      const fresh = await this.syncLink(row).catch(() => row);
      const ledger = await this.t("dropshipLedgerEntry").findFirst({
        where: { dropshipOrderLinkId: fresh.id },
      }).catch(() => null);
      items.push(this.linkView(orgId, fresh, ledger));
    }
    return { items, payoutNote: DROPSHIP_PAYOUT_NOTE };
  }

  /** Staff-initiated cancellation of the supplier fulfilment:
   * refused once the supplier order is sold (completed /
   * delivered); otherwise routed through the normal order
   * path. The seller order itself is NOT force-cancelled —
   * its lifecycle belongs to the seller's own order actions;
   * the link mirror shows the outcome. */
  async cancelFulfilment(orgId: string, actorId: string, linkId: string) {
    const link = await this.t("dropshipOrderLink").findFirst({
      where: { id: linkId, OR: [{ sellerOrgId: orgId }, { supplierOrgId: orgId }] },
    });
    if (!link) throw new NotFoundException("Dropship অর্ডার লিংকটি পাওয়া যায়নি");
    if (!link.supplierOrderId) throw new BadRequestException("এই লিংকের কোনো supplier অর্ডার নেই");
    const supplierOrder = await this.t("order").findFirst({
      where: { id: link.supplierOrderId, organizationId: link.supplierOrgId },
    });
    if (!supplierOrder) throw new NotFoundException("Supplier অর্ডারটি পাওয়া যায়নি");
    const status = String(supplierOrder.status ?? "");
    if ((DROPSHIP_SOLD_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException(
        `Supplier অর্ডারটি ইতিমধ্যে "${status}" — সরবরাহ সম্পন্ন হয়ে গেছে, তাই বাতিল করা যাবে না`,
      );
    }
    if (status === "cancelled") return this.linkView(orgId, link, null);
    if (!this.orders?.updateOrder) throw new BadRequestException("অর্ডার বাতিলের সুবিধা এই deployment-এ নেই");
    await this.orders.updateOrder(link.supplierOrgId, actorId, supplierOrder.id, { status: "cancelled" } as any);
    const fresh = await this.t("dropshipOrderLink").update({
      where: { id: link.id },
      data: { supplierStatus: "cancelled", cancelNote: "Cancelled by staff through the normal order path." },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "dropship.fulfilment_cancelled",
      entityType: "DropshipOrderLink", entityId: link.id,
      metadata: { supplierOrderId: link.supplierOrderId },
    }).catch(() => undefined);
    return this.linkView(orgId, fresh, null);
  }

  async listLedger(orgId: string) {
    const rows = ((await this.t("dropshipLedgerEntry").findMany({
      where: { OR: [{ sellerOrgId: orgId }, { supplierOrgId: orgId }] },
      orderBy: { createdAt: "desc" },
    })) ?? []) as any[];
    return {
      items: rows.map((r: any) => ({
        id: r.id,
        agreementId: r.agreementId,
        dropshipOrderLinkId: r.dropshipOrderLinkId,
        sellerOrgId: r.sellerOrgId,
        supplierOrgId: r.supplierOrgId,
        retailTotalMinor: String(r.retailTotalMinor),
        wholesaleTotalMinor: String(r.wholesaleTotalMinor),
        marginMinor: String(r.marginMinor),
        createdAt: r.createdAt,
      })),
      payoutNote: DROPSHIP_PAYOUT_NOTE,
    };
  }
}
