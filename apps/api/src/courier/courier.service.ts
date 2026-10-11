import { BadGatewayException, BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { encryptJson, decryptJson } from "../integrations/crypto";
import { SteadfastClient, SteadfastError } from "./steadfast.client";
import { PathaoClient, PathaoError, pathaoClientTokens, PATHAO_PROD_BASE } from "./pathao.client";
import { RedxClient, RedxError, REDX_DEFAULT_BASE } from "./redx.client";
import { InboxService } from "../inbox/inbox.service";
import { buildPdf, shippingLabelPage, invoicePage } from "./pdf";

/** Courier failures reach the user as readable errors, never bare 500s. */
function courierError(e: unknown): Error {
  if (e instanceof SteadfastError || e instanceof PathaoError || e instanceof RedxError) {
    return new BadRequestException(e.message);
  }
  return new BadGatewayException(`Courier API তে সংযোগ করা যাচ্ছে না: ${e instanceof Error ? e.message : "network error"}`);
}

const PROVIDERS = ["steadfast", "pathao", "redx"] as const;
type Provider = (typeof PROVIDERS)[number];

const TERMINAL = ["delivered", "partial_delivered", "cancelled", "returned"];
const NOTIFY: Record<string, string> = {
  delivered: "আপনার পার্সেলটি ডেলিভারি সম্পন্ন হয়েছে। ধন্যবাদ আমাদের সাথে কেনাকাটা করার জন্য!",
  partial_delivered: "আপনার পার্সেলের একটি অংশ ডেলিভারি হয়েছে। বাকি তথ্যের জন্য আমাদের জানান।",
  cancelled: "দুঃখিত, আপনার পার্সেলের ডেলিভারি বাতিল হয়েছে। বিস্তারিত জানতে আমাদের মেসেজ করুন।",
  returned: "আপনার পার্সেলটি ফেরত পাঠানো হয়েছে। বিস্তারিত জানতে আমাদের মেসেজ করুন।",
};

/** Normalize a Bangladeshi phone to the 01XXXXXXXXX form couriers require. */
export function normalizeBdPhone(raw: string): string {
  const bengali = "০১২৩৪৫৬৭৮৯";
  let digits = String(raw ?? "").replace(/[০-৯]/g, (d) => String(bengali.indexOf(d))).replace(/\D/g, "");
  if (digits.startsWith("880") && digits.length === 13) digits = "0" + digits.slice(3);
  return digits;
}

@Injectable()
export class CourierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly inbox?: InboxService,
  ) {}

  private providerOf(value?: string): Provider {
    const p = (value ?? "steadfast") as Provider;
    if (!PROVIDERS.includes(p)) throw new BadRequestException(`Unknown courier provider: ${value}`);
    return p;
  }

  private async integration(organizationId: string, provider: Provider) {
    return (this.prisma as any).integration.findFirst({
      where: { organizationId, provider }, include: { credential: true },
    });
  }

  private async saveIntegration(organizationId: string, provider: Provider, secrets: Record<string, unknown>) {
    const encrypted = encryptJson(secrets);
    const existing = await this.integration(organizationId, provider);
    if (existing) {
      await (this.prisma as any).integration.update({ where: { id: existing.id }, data: { status: "CONNECTED", lastError: null } });
      if (existing.credential) {
        await (this.prisma as any).integrationCredential.update({ where: { integrationId: existing.id }, data: { encryptedData: encrypted } });
      } else {
        await (this.prisma as any).integrationCredential.create({ data: { integrationId: existing.id, encryptedData: encrypted } });
      }
      return existing;
    }
    const created = await (this.prisma as any).integration.create({
      data: { organizationId, provider, status: "CONNECTED" },
    });
    await (this.prisma as any).integrationCredential.create({ data: { integrationId: created.id, encryptedData: encrypted } });
    return created;
  }

  /** Build the provider client for an org, or throw a clear "not connected". */
  private async clientFor(organizationId: string, provider: Provider) {
    const integration = await this.integration(organizationId, provider);
    if (!integration || integration.status !== "CONNECTED" || !integration.credential) {
      throw new BadRequestException(`${provider} যুক্ত নেই। আগে Courier Connect করুন।`);
    }
    const creds = decryptJson<any>(integration.credential.encryptedData);
    if (provider === "steadfast") return new SteadfastClient({ apiKey: creds.apiKey, secretKey: creds.secretKey });
    if (provider === "redx") return new RedxClient({ baseUrl: creds.baseUrl || REDX_DEFAULT_BASE, accessToken: creds.accessToken });
    const client = new PathaoClient({
      baseUrl: creds.baseUrl || PATHAO_PROD_BASE,
      clientId: creds.clientId, clientSecret: creds.clientSecret,
      username: creds.username, password: creds.password,
      accessToken: creds.accessToken, refreshToken: creds.refreshToken,
      tokenIssuedAt: creds.tokenIssuedAt, expiresIn: creds.expiresIn,
    });
    // Persist refreshed tokens back into the encrypted credential.
    client.onTokens = async (tokens) => {
      const merged = { ...creds, ...tokens };
      await (this.prisma as any).integrationCredential.update({
        where: { integrationId: integration.id }, data: { encryptedData: encryptJson(merged) },
      }).catch(() => undefined);
    };
    return client;
  }

  async getConnection(organizationId: string, providerValue?: string) {
    const provider = this.providerOf(providerValue);
    const integration = await this.integration(organizationId, provider);
    if (!integration) return { provider, connected: false };
    return { provider, connected: integration.status === "CONNECTED", status: integration.status, connectedAt: integration.createdAt };
  }

  async getConnections(organizationId: string) {
    const out = [];
    for (const provider of PROVIDERS) out.push(await this.getConnection(organizationId, provider));
    return out;
  }

  /** Credentials are verified against the provider's REAL API before saving. */
  async connect(organizationId: string, actorId: string, dto: {
    provider?: string; apiKey?: string; secretKey?: string;
    clientId?: string; clientSecret?: string; username?: string; password?: string;
    accessToken?: string; baseUrl?: string;
  }) {
    const provider = this.providerOf(dto.provider);
    try {
      if (provider === "steadfast") {
        if (!dto.apiKey?.trim() || !dto.secretKey?.trim()) throw new BadRequestException("apiKey and secretKey are required");
        const client = new SteadfastClient({ apiKey: dto.apiKey.trim(), secretKey: dto.secretKey.trim() });
        await client.getBalance();
        await this.saveIntegration(organizationId, provider, { apiKey: dto.apiKey.trim(), secretKey: dto.secretKey.trim() });
      } else if (provider === "pathao") {
        const required = ["clientId", "clientSecret", "username", "password"] as const;
        for (const field of required) if (!dto[field]?.trim()) throw new BadRequestException(`${field} is required for Pathao`);
        const creds = {
          baseUrl: dto.baseUrl?.trim() || PATHAO_PROD_BASE,
          clientId: dto.clientId!.trim(), clientSecret: dto.clientSecret!.trim(),
          username: dto.username!.trim(), password: dto.password!,
        };
        const client = new PathaoClient(creds);
        const { stores } = await client.verify(); // real token issue + stores read
        await this.saveIntegration(organizationId, provider, { ...creds, ...pathaoClientTokens(client) });
        await this.audit.log({ organizationId, userId: actorId, action: "courier.connected", entityType: "Integration", metadata: { provider, stores } });
        return this.getConnection(organizationId, provider);
      } else {
        if (!dto.accessToken?.trim()) throw new BadRequestException("accessToken is required for RedX");
        const baseUrl = dto.baseUrl?.trim() || REDX_DEFAULT_BASE;
        const client = new RedxClient({ baseUrl, accessToken: dto.accessToken.trim() });
        const { areas } = await client.verify(); // real areas list from RedX
        await this.saveIntegration(organizationId, provider, { baseUrl, accessToken: dto.accessToken.trim() });
        await this.audit.log({ organizationId, userId: actorId, action: "courier.connected", entityType: "Integration", metadata: { provider, areas } });
        return this.getConnection(organizationId, provider);
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw courierError(e);
    }
    await this.audit.log({ organizationId, userId: actorId, action: "courier.connected", entityType: "Integration", metadata: { provider } });
    return this.getConnection(organizationId, provider);
  }

  async disconnect(organizationId: string, actorId: string, providerValue?: string) {
    const provider = this.providerOf(providerValue);
    const integration = await this.integration(organizationId, provider);
    if (!integration) return { connected: false };
    await (this.prisma as any).integration.update({ where: { id: integration.id }, data: { status: "DISCONNECTED" } });
    await this.audit.log({ organizationId, userId: actorId, action: "courier.disconnected", entityType: "Integration", entityId: integration.id, metadata: { provider } });
    return { connected: false };
  }

  // ---------- Provider lookups (booking form pickers) ----------
  async pathaoStores(organizationId: string) {
    const client = await this.clientFor(organizationId, "pathao") as PathaoClient;
    return client.getStores().catch((e) => { throw courierError(e); });
  }
  async pathaoCities(organizationId: string) {
    const client = await this.clientFor(organizationId, "pathao") as PathaoClient;
    return client.getCities().catch((e) => { throw courierError(e); });
  }
  async pathaoZones(organizationId: string, cityId: number) {
    const client = await this.clientFor(organizationId, "pathao") as PathaoClient;
    return client.getZones(cityId).catch((e) => { throw courierError(e); });
  }
  async pathaoAreas(organizationId: string, zoneId: number) {
    const client = await this.clientFor(organizationId, "pathao") as PathaoClient;
    return client.getAreas(zoneId).catch((e) => { throw courierError(e); });
  }
  async redxAreas(organizationId: string) {
    const client = await this.clientFor(organizationId, "redx") as RedxClient;
    return client.getAreas().catch((e) => { throw courierError(e); });
  }
  async redxStores(organizationId: string) {
    const client = await this.clientFor(organizationId, "redx") as RedxClient;
    return client.getPickupStores().catch((e) => { throw courierError(e); });
  }

  private serialize(shipment: any) {
    return { ...shipment, codAmountMinor: String(shipment.codAmountMinor) };
  }

  /**
   * Milestone 52: delivery-charge quotation BEFORE booking, from
   * each provider's OWN pricing surface:
   *  - Pathao: merchant price-plan API (final_price as returned).
   *  - RedX: charge calculator API (total as returned).
   *  - Steadfast: NO quote API exists - the honest answer is an
   *    explicit quotable:false state, never an invented number.
   * A quote writes nothing; provider errors surface verbatim.
   */
  async quote(organizationId: string, dto: {
    provider?: string; orderId?: string; weightKg?: number; weightGrams?: number;
    pathao?: { storeId?: number; cityId?: number; zoneId?: number; deliveryType?: number; itemType?: number; itemWeightKg?: number };
    redx?: { deliveryAreaId?: number; pickupAreaId?: number; parcelWeightKg?: number };
  }) {
    const provider = this.providerOf(dto.provider);
    const client = await this.clientFor(organizationId, provider); // throws "যুক্ত নেই" when unconnected
    if (provider === "steadfast") {
      return {
        provider, quotable: false, chargeMinor: null, currency: "BDT",
        reason: "বুকিংয়ের পরে চার্জ জানা যাবে — Steadfast বুকিংয়ের আগে ডেলিভারি চার্জ জানার কোনো API দেয় না, তাই আন্দাজি সংখ্যা দেখানো হয় না।",
      };
    }
    const weightKg = dto.pathao?.itemWeightKg ?? dto.redx?.parcelWeightKg ?? dto.weightKg
      ?? (dto.weightGrams ? dto.weightGrams / 1000 : undefined) ?? 0.5;
    try {
      if (provider === "pathao") {
        const c = client as PathaoClient;
        const cityId = dto.pathao?.cityId;
        const zoneId = dto.pathao?.zoneId;
        if (!cityId || !zoneId) {
          throw new BadRequestException("Pathao তে চার্জ জানতে প্রাপকের শহর ও জোন বেছে নিতে হবে — price plan API শহর/জোন ছাড়া দাম দিতে পারে না");
        }
        if (!(weightKg >= 0.5 && weightKg <= 10)) throw new BadRequestException("Pathao তে ওজন ০.৫–১০ কেজির মধ্যে হতে হয়");
        let storeId = dto.pathao?.storeId;
        if (!storeId) {
          const stores = await c.getStores();
          const first = stores.find((s: any) => s.is_active === 1 || s.is_active === true) ?? stores[0];
          if (!first) throw new BadRequestException("Pathao অ্যাকাউন্টে কোনো স্টোর পাওয়া যায়নি — আগে Pathao Merchant Panel এ স্টোর তৈরি করুন");
          storeId = Number(first.store_id);
        }
        const plan = await c.pricePlan({
          store_id: storeId,
          item_type: dto.pathao?.itemType ?? 2,
          delivery_type: dto.pathao?.deliveryType ?? 48,
          item_weight: weightKg,
          recipient_city: cityId,
          recipient_zone: zoneId,
        });
        return {
          provider, quotable: true, chargeMinor: Math.round(plan.finalPrice * 100), currency: "BDT",
          source: "pathao_price_plan",
          detail: {
            priceBdt: plan.price, discountBdt: plan.discount, promoDiscountBdt: plan.promoDiscount,
            additionalChargeBdt: plan.additionalCharge, finalPriceBdt: plan.finalPrice,
            codEnabled: plan.codEnabled, codPercentage: plan.codPercentage, planId: plan.planId,
            storeId, weightKg,
          },
        };
      }
      // redx
      const c = client as RedxClient;
      if (!dto.redx?.deliveryAreaId) {
        throw new BadRequestException("RedX এ চার্জ জানতে ডেলিভারি এলাকা (Area) বেছে নিতে হবে");
      }
      if (!(weightKg > 0 && weightKg <= 30)) throw new BadRequestException("RedX তে ওজন ০–৩০ কেজির মধ্যে হতে হয়");
      let codMajor = 0;
      if (dto.orderId) {
        const order = await (this.prisma as any).order.findFirst({ where: { id: dto.orderId, organizationId } });
        if (!order) throw new NotFoundException("Order not found in this organization");
        codMajor = order.isCod ? Number(BigInt(order.totalMinor)) / 100 : 0;
      }
      const charge = await c.calculateCharge({
        delivery_area_id: dto.redx.deliveryAreaId,
        pickup_area_id: dto.redx.pickupAreaId,
        cash_collection_amount: Math.round(codMajor),
        weight: Math.round(weightKg * 1000), // RedX expects grams
      });
      return {
        provider, quotable: true, chargeMinor: Math.round(charge.totalCharge * 100), currency: "BDT",
        source: "redx_charge_calculator",
        detail: {
          deliveryChargeBdt: charge.deliveryCharge, codChargeBdt: charge.codCharge, totalChargeBdt: charge.totalCharge,
          deliveryAreaId: dto.redx.deliveryAreaId, weightGrams: Math.round(weightKg * 1000),
        },
      };
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) throw e;
      throw courierError(e);
    }
  }

  async bookShipment(organizationId: string, actorId: string, dto: {
    provider?: string;
    orderId: string; recipientName?: string; recipientPhone?: string; recipientAddress: string; note?: string;
    pathao?: { storeId?: number; cityId?: number; zoneId?: number; areaId?: number; deliveryType?: number; itemType?: number; itemWeightKg?: number; itemDescription?: string };
    redx?: { deliveryAreaId?: number; deliveryArea?: string; pickupStoreId?: number; parcelWeightKg?: number };
  }) {
    const provider = this.providerOf(dto.provider);
    const order = await (this.prisma as any).order.findFirst({ where: { id: dto.orderId, organizationId } });
    if (!order) throw new NotFoundException("Order not found in this organization");
    const active = await (this.prisma as any).courierShipment.findFirst({
      where: { organizationId, orderId: order.id, provider },
    });
    if (active && !["cancelled", "returned"].includes(active.status)) {
      throw new BadRequestException(`এই অর্ডারের পার্সেল ${provider} তে ইতিমধ্যে বুক করা আছে (Tracking: ${active.trackingCode}, স্ট্যাটাস: ${active.status})`);
    }
    const customer = order.customerId
      ? await (this.prisma as any).customer.findFirst({ where: { id: order.customerId, organizationId } })
      : null;
    const recipientName = dto.recipientName?.trim() || [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || "";
    const recipientPhone = dto.recipientPhone?.trim() || customer?.phone || "";
    const recipientAddress = dto.recipientAddress?.trim() ?? "";
    if (!recipientName || !recipientPhone || recipientAddress.length < 8) {
      throw new BadRequestException("প্রাপকের নাম, ফোন ও পূর্ণ ঠিকানা (কমপক্ষে ৮ অক্ষর) দরকার");
    }
    const items = ((await (this.prisma as any).orderItem?.findMany({ where: { orderId: order.id } })?.catch(() => [])) ?? []) as any[];
    const codMajor = order.isCod ? Number(BigInt(order.totalMinor)) / 100 : 0;
    const invoice = String(order.externalNumber ?? order.id);
    const client = await this.clientFor(organizationId, provider);

    let consignmentId: string | null = null;
    let trackingCode: string;
    let status: string;
    let deliveryFeeMajor: number | null = null;

    try {
      if (provider === "steadfast") {
        const consignment = await (client as SteadfastClient).createOrder({
          invoice, recipient_name: recipientName, recipient_phone: recipientPhone,
          recipient_address: recipientAddress, cod_amount: codMajor, note: dto.note?.trim() || undefined,
        });
        consignmentId = String(consignment.consignment_id);
        trackingCode = String(consignment.tracking_code);
        status = String(consignment.status ?? "in_review");
      } else if (provider === "pathao") {
        const c = client as PathaoClient;
        const phone = normalizeBdPhone(recipientPhone);
        if (!/^01\d{9}$/.test(phone)) throw new BadRequestException("Pathao এর জন্য প্রাপকের ফোন 01 দিয়ে শুরু হওয়া ১১ ডিজিটের নম্বর হতে হবে");
        let storeId = dto.pathao?.storeId;
        if (!storeId) {
          const stores = await c.getStores();
          const first = stores.find((s: any) => s.is_active === 1 || s.is_active === true) ?? stores[0];
          if (!first) throw new BadRequestException("Pathao অ্যাকাউন্টে কোনো স্টোর পাওয়া যায়নি — আগে Pathao Merchant Panel এ স্টোর তৈরি করুন");
          storeId = Number(first.store_id);
        }
        const weight = dto.pathao?.itemWeightKg ?? 0.5;
        if (!(weight >= 0.5 && weight <= 10)) throw new BadRequestException("Pathao তে ওজন ০.৫–১০ কেজির মধ্যে হতে হয়");
        const description = dto.pathao?.itemDescription
          ?? items.map((i: any) => `${i.name} x${i.quantity}`).join(", ").slice(0, 200)
          ?? "";
        const booked = await c.createOrder({
          store_id: storeId, merchant_order_id: invoice,
          recipient_name: recipientName, recipient_phone: phone, recipient_address: recipientAddress,
          recipient_city: dto.pathao?.cityId, recipient_zone: dto.pathao?.zoneId, recipient_area: dto.pathao?.areaId,
          delivery_type: dto.pathao?.deliveryType ?? 48, item_type: dto.pathao?.itemType ?? 2,
          item_quantity: items.reduce((s: number, i: any) => s + (i.quantity ?? 1), 0) || 1,
          item_weight: weight, item_description: description || undefined,
          special_instruction: dto.note?.trim() || undefined,
          amount_to_collect: Math.round(codMajor),
        });
        consignmentId = booked.consignmentId;
        trackingCode = booked.consignmentId;
        status = booked.status;
        deliveryFeeMajor = booked.deliveryFee;
      } else {
        const c = client as RedxClient;
        if (!dto.redx?.deliveryAreaId || !dto.redx?.deliveryArea) {
          throw new BadRequestException("RedX বুকিংয়ের জন্য ডেলিভারি এলাকা (Area) বেছে নিতে হবে");
        }
        const weightKg = dto.redx?.parcelWeightKg ?? 0.5;
        if (!(weightKg > 0 && weightKg <= 30)) throw new BadRequestException("RedX তে ওজন ০–৩০ কেজির মধ্যে হতে হয়");
        const booked = await c.createParcel({
          customer_name: recipientName, customer_phone: normalizeBdPhone(recipientPhone),
          delivery_area: dto.redx.deliveryArea, delivery_area_id: dto.redx.deliveryAreaId,
          customer_address: recipientAddress, merchant_invoice_id: invoice,
          cash_collection_amount: String(Math.round(codMajor)),
          parcel_weight: Math.round(weightKg * 1000), // RedX expects grams
          instruction: dto.note?.trim() || undefined,
          value: Math.max(1, Math.round(Number(BigInt(order.totalMinor)) / 100)),
          pickup_store_id: dto.redx?.pickupStoreId,
          parcel_details_json: items.map((i: any) => ({
            name: i.name, value: Math.round(Number(BigInt(i.totalMinor ?? 0)) / 100),
          })),
        });
        consignmentId = booked.trackingId;
        trackingCode = booked.trackingId;
        status = booked.status;
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw courierError(e);
    }

    const shipment = await (this.prisma as any).courierShipment.create({
      data: {
        organizationId, orderId: order.id, provider,
        consignmentId, trackingCode, invoice, status,
        codAmountMinor: BigInt(Math.round(codMajor * 100)),
        recipientName, recipientPhone, recipientAddress, lastCheckedAt: new Date(),
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "courier.shipment.booked", entityType: "CourierShipment",
      entityId: shipment.id, metadata: { provider, orderId: order.id, trackingCode, deliveryFeeMajor },
    });
    return { ...this.serialize(shipment), deliveryFeeMajor };
  }

  /**
   * Milestone 53: bulk booking through the EXISTING single-booking
   * path. Every order gets its own result; a failure never stops
   * the rest; an order that already has an active shipment for the
   * provider is SKIPPED (never double-booked); the batch is capped
   * at 50 and audit-logged as a whole (each booking also audits
   * itself inside bookShipment).
   */
  async bookBulk(organizationId: string, actorId: string, dto: {
    provider?: string; orderIds: string[];
    recipientName?: string; recipientPhone?: string; recipientAddress?: string; note?: string;
    pathao?: { storeId?: number; cityId?: number; zoneId?: number; areaId?: number; deliveryType?: number; itemType?: number; itemWeightKg?: number; itemDescription?: string };
    redx?: { deliveryAreaId?: number; deliveryArea?: string; pickupStoreId?: number; parcelWeightKg?: number };
  }) {
    const provider = this.providerOf(dto.provider);
    const orderIds = [...new Set((dto.orderIds ?? []).filter(Boolean))];
    if (orderIds.length === 0) throw new BadRequestException("কমপক্ষে একটি অর্ডার বেছে নিন");
    if (orderIds.length > 50) throw new BadRequestException("একবারে সর্বোচ্চ ৫০টি অর্ডার বুক করা যায়");
    const results: { orderId: string; ok: boolean; skipped?: boolean; shipmentId?: string; trackingCode?: string; status?: string; error?: string }[] = [];
    for (const orderId of orderIds) {
      const order = await (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId } });
      if (!order) { results.push({ orderId, ok: false, error: "Order not found in this organization" }); continue; }
      const existing = await (this.prisma as any).courierShipment.findFirst({ where: { organizationId, orderId, provider } });
      if (existing && !["cancelled", "returned"].includes(existing.status)) {
        results.push({
          orderId, ok: false, skipped: true, shipmentId: existing.id, trackingCode: existing.trackingCode ?? undefined,
          status: existing.status,
          error: `ইতিমধ্যে বুক করা আছে (Tracking: ${existing.trackingCode}, স্ট্যাটাস: ${existing.status})`,
        });
        continue;
      }
      try {
        const shipment = await this.bookShipment(organizationId, actorId, {
          provider, orderId,
          recipientName: dto.recipientName, recipientPhone: dto.recipientPhone,
          recipientAddress: dto.recipientAddress ?? order.address ?? "",
          note: dto.note, pathao: dto.pathao, redx: dto.redx,
        });
        results.push({ orderId, ok: true, shipmentId: shipment.id, trackingCode: shipment.trackingCode, status: shipment.status });
      } catch (e) {
        results.push({ orderId, ok: false, error: e instanceof Error ? e.message : "Booking failed" });
      }
    }
    const booked = results.filter((r) => r.ok).length;
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.length - booked - skipped;
    await this.audit.log({
      organizationId, userId: actorId, action: "courier.shipments.bulk_booked", entityType: "CourierShipment",
      metadata: { provider, requested: results.length, booked, skipped, failed },
    });
    return { provider, requested: results.length, booked, skipped, failed, results };
  }

  private async orgSender(organizationId: string) {
    const org = await (this.prisma as any).organization.findFirst({ where: { id: organizationId } });
    const profile = await (this.prisma as any).businessProfile?.findUnique({ where: { organizationId } }).catch(() => null);
    // Milestone 59: white-label — the brand/display name wins over
    // the legal org name on customer-facing print, and the primary
    // colour becomes the PDF accent. Absent branding = pre-M59 output.
    return {
      name: org?.brandName ?? org?.name ?? "Store", phone: profile?.contactPhone ?? null,
      currency: org?.currency ?? "BDT", brandColor: org?.primaryColor ?? null,
    };
  }

  private labelPageFor(shipment: any, sender: { name: string; phone: string | null; currency: string; brandColor?: string | null }) {
    return shippingLabelPage({
      orgName: sender.name, orgPhone: sender.phone, provider: shipment.provider,
      recipientName: shipment.recipientName, recipientPhone: shipment.recipientPhone,
      recipientAddress: shipment.recipientAddress, invoice: shipment.invoice,
      trackingCode: String(shipment.trackingCode ?? shipment.consignmentId ?? ""),
      codAmountMinor: shipment.codAmountMinor, currency: sender.currency,
      brandColor: sender.brandColor ?? null,
    });
  }

  /** Milestone 53: one shipment's shipping label as a real PDF. */
  async labelPdf(organizationId: string, shipmentId: string): Promise<Buffer> {
    const shipment = await (this.prisma as any).courierShipment.findFirst({ where: { id: shipmentId, organizationId } });
    if (!shipment) throw new NotFoundException("Shipment not found");
    if (!shipment.trackingCode && !shipment.consignmentId) throw new BadRequestException("Shipment has no tracking code yet");
    const sender = await this.orgSender(organizationId);
    return buildPdf([this.labelPageFor(shipment, sender)]);
  }

  /** Milestone 53: many shipments' labels in ONE PDF (one page each). */
  async labelsPdf(organizationId: string, shipmentIds: string[]): Promise<Buffer> {
    const ids = [...new Set((shipmentIds ?? []).filter(Boolean))];
    if (ids.length === 0) throw new BadRequestException("কমপক্ষে একটি পার্সেল বেছে নিন");
    if (ids.length > 50) throw new BadRequestException("একবারে সর্বোচ্চ ৫০টি লেবেল ডাউনলোড করা যায়");
    const sender = await this.orgSender(organizationId);
    const pages = [];
    for (const id of ids) {
      const shipment = await (this.prisma as any).courierShipment.findFirst({ where: { id, organizationId } });
      if (!shipment) throw new NotFoundException(`Shipment not found: ${id}`);
      if (!shipment.trackingCode && !shipment.consignmentId) throw new BadRequestException("Shipment has no tracking code yet");
      pages.push(this.labelPageFor(shipment, sender));
    }
    return buildPdf(pages);
  }

  /** Milestone 53: per-order invoice as a real PDF (stored order data). */
  async invoicePdf(organizationId: string, orderId: string): Promise<Buffer> {
    const order = await (this.prisma as any).order.findFirst({ where: { id: orderId, organizationId } });
    if (!order) throw new NotFoundException("Order not found in this organization");
    const items = ((await (this.prisma as any).orderItem?.findMany({ where: { orderId: order.id } }).catch(() => [])) ?? []) as any[];
    const customer = order.customerId
      ? await (this.prisma as any).customer.findFirst({ where: { id: order.customerId, organizationId } })
      : null;
    const sender = await this.orgSender(organizationId);
    return buildPdf([invoicePage({
      orgName: sender.name, orgPhone: sender.phone,
      invoiceNo: String(order.externalNumber ?? order.id),
      date: (order.placedAt ?? order.createdAt ?? new Date()).toISOString().slice(0, 10),
      customerName: [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || "Customer",
      customerPhone: customer?.phone ?? null,
      items: items.map((i: any) => ({ name: i.name, quantity: i.quantity, totalMinor: i.totalMinor })),
      subtotalMinor: order.subtotalMinor, shippingMinor: order.shippingMinor,
      discountMinor: order.discountMinor, totalMinor: order.totalMinor,
      paymentLabel: order.isCod ? "Cash on Delivery (COD)" : (order.paymentMethod ?? "Prepaid"),
      currency: order.currency ?? sender.currency,
      brandColor: sender.brandColor,
    })]);
  }

  async listShipments(organizationId: string, orderId?: string) {
    const rows = await (this.prisma as any).courierShipment.findMany({
      where: { organizationId, ...(orderId ? { orderId } : {}) }, orderBy: { createdAt: "desc" }, take: 100,
    });
    return rows.map((r: any) => this.serialize(r));
  }

  async syncShipment(organizationId: string, shipmentId: string) {
    const shipment = await (this.prisma as any).courierShipment.findFirst({ where: { id: shipmentId, organizationId } });
    if (!shipment) throw new NotFoundException("Shipment not found");
    if (!shipment.trackingCode) throw new BadRequestException("Shipment has no tracking code yet");
    const provider = this.providerOf(shipment.provider);
    const client = await this.clientFor(organizationId, provider);
    let status: string;
    try {
      if (provider === "steadfast") status = await (client as SteadfastClient).statusByTrackingCode(shipment.trackingCode);
      else if (provider === "pathao") status = await (client as PathaoClient).orderStatus(shipment.consignmentId ?? shipment.trackingCode);
      else status = await (client as RedxClient).parcelStatus(shipment.trackingCode);
    } catch (e) { throw courierError(e); }
    const changed = status !== shipment.status;
    const updated = await (this.prisma as any).courierShipment.update({
      where: { id: shipmentId }, data: { status, lastCheckedAt: new Date() },
    });
    if (changed) await this.notifyCustomer(organizationId, updated).catch(() => undefined);
    return this.serialize(updated);
  }

  async syncAll(organizationId: string) {
    const rows = await (this.prisma as any).courierShipment.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: 200,
    });
    const open = rows.filter((r: any) => !TERMINAL.includes(r.status) || r.status === "partial_delivered");
    let synced = 0; let changed = 0; const errors: string[] = [];
    for (const shipment of open) {
      try {
        const before = shipment.status;
        const out = await this.syncShipment(organizationId, shipment.id);
        synced++;
        if (out.status !== before) changed++;
      } catch (e) {
        errors.push(`${shipment.trackingCode}: ${e instanceof Error ? e.message : "sync failed"}`);
      }
    }
    return { checked: open.length, synced, changed, errors };
  }

  /** Send courier status back into the originating chat thread, once per status. */
  private async notifyCustomer(organizationId: string, shipment: any) {
    if (!this.inbox) return;
    const order = await (this.prisma as any).order.findFirst({ where: { id: shipment.orderId, organizationId } });
    if (!order?.conversationId) return;
    const notable = NOTIFY[shipment.status];
    const shippedOnce = !notable && shipment.lastNotifiedStatus == null && !["in_review", "pending"].includes(shipment.status);
    if (!notable && !shippedOnce) return;
    if (shipment.lastNotifiedStatus === shipment.status) return;
    const text = notable
      ? `${notable} অর্ডার: ${order.externalNumber ?? ""}, Tracking: ${shipment.trackingCode}`
      : `আপনার পার্সেলটি কুরিয়ারে দেওয়া হয়েছে। অর্ডার: ${order.externalNumber ?? ""}, Tracking: ${shipment.trackingCode} — এই কোড দিয়ে ডেলিভারি স্ট্যাটাস জানতে পারবেন।`;
    await this.inbox.sendAutomatedMessage(organizationId, order.conversationId, text, "courier_update");
    await (this.prisma as any).courierShipment.update({
      where: { id: shipment.id }, data: { lastNotifiedStatus: shipment.status },
    });
  }
}
