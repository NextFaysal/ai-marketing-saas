import { BadRequestException } from "@nestjs/common";
import { SteadfastClient } from "./steadfast.client";
import { PathaoClient, PATHAO_PROD_BASE } from "./pathao.client";
import { RedxClient, REDX_DEFAULT_BASE } from "./redx.client";
import { EcourierClient, ECOURIER_DEFAULT_BASE, ECOURIER_PAYMENT_METHODS } from "./ecourier.client";

/**
 * GB5 (GC13) — the courier adapter framework.
 *
 * Before GB5 the three provider clients were constructed and
 * driven by an if-chain inside CourierService, with each
 * provider's booking translation (payload shape, validations,
 * status mapping) inlined in bookShipment. This module makes
 * the contract explicit:
 *
 *   COURIER_PROVIDERS          the provider registry keys
 *   createCourierClient()      provider key + decrypted creds
 *                              -> the concrete provider client
 *                              (the ONE construction site)
 *   courierAdapter()           concrete client -> CourierClient
 *   CourierClient              the provider-neutral contract
 *                              CourierService books + syncs
 *                              through: book() / statusOf()
 *
 * Adding a provider after GB5 = one client class + one
 * registry entry in each factory below + one credentials-form
 * entry (see docs/completion-gb5-acceptance.md for the recipe).
 * Paperfly was researched in GB5 and is deliberately NOT in
 * the registry: its API is partner-gated with no published
 * developer documentation (docs/gb5-courier-research.md).
 * Provider-specific extras (Pathao store/city pickers, price
 * plans, RedX areas, charge calculators) stay on the concrete
 * classes and are reached through createCourierClient — the
 * adapter contract covers only what every provider shares:
 * verify-before-save lives in CourierService.connect (it calls
 * each concrete client's own real check), book, and status.
 *
 * Multi-account note (this tree): CourierService resolves ONE
 * Integration row per (org, provider) — the registry factory
 * therefore takes the credentials of that resolved row. There
 * is no second account-selection model here.
 */

export const COURIER_PROVIDERS = ["steadfast", "pathao", "redx", "ecourier"] as const;
export type CourierProviderKey = (typeof COURIER_PROVIDERS)[number];

/** The internal shipment-status vocabulary — every provider's
 * statuses are mapped INTO this set (unknown provider strings
 * degrade to a normalized form, never an invented status), and
 * this is the set the GC14 manual-status endpoint accepts. */
export const COURIER_STATUSES = [
  "in_review", "pending", "picked_up", "in_transit", "out_for_delivery",
  "delivered", "partial_delivered", "cancelled", "returned", "delivery_failed",
] as const;

/** Normalize a Bangladeshi phone to the 01XXXXXXXXX form couriers require. */
export function normalizeBdPhone(raw: string): string {
  const bengali = "০১২৩৪৫৬৭৮৯";
  let digits = String(raw ?? "").replace(/[০-৯]/g, (d) => String(bengali.indexOf(d))).replace(/\D/g, "");
  if (digits.startsWith("880") && digits.length === 13) digits = "0" + digits.slice(3);
  return digits;
}

/** Provider-neutral booking request, built ONCE by
 * CourierService from the order + recipient facts. Provider
 * sections (pathao/redx/ecourier/paperfly) ride through so each
 * adapter reads only its own. */
export interface CourierBookingRequest {
  invoice: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  /** COD amount to collect, major units (0 for prepaid). */
  codAmountMajor: number;
  /** Order total, major units (RedX parcel value). */
  orderTotalMajor: number;
  itemCount: number;
  /** "Name xQty, ..." item summary (service-truncated). */
  itemDescription: string;
  items: { name: string; quantity: number; totalMinor?: unknown }[];
  note?: string;
  pathao?: {
    storeId?: number; cityId?: number; zoneId?: number; areaId?: number;
    deliveryType?: number; itemType?: number; itemWeightKg?: number; itemDescription?: string;
  };
  redx?: { deliveryAreaId?: number; deliveryArea?: string; pickupStoreId?: number; parcelWeightKg?: number };
  ecourier?: { city?: string; thana?: string; area?: string; zip?: string; packageCode?: string; paymentMethod?: string };
}

export interface CourierBookingResult {
  consignmentId: string | null;
  trackingCode: string;
  /** Internal-vocabulary status. */
  status: string;
  /** The provider's verbatim status string (GC14 event log). */
  rawStatus: string | null;
  /** GB5 (GC14): the charge the provider returned AT BOOKING,
   * minor units — null when it returned none. Never estimated. */
  chargeMinor: number | null;
}

export interface CourierStatusResult {
  /** Internal-vocabulary status. */
  status: string;
  /** The provider's verbatim status string. */
  rawStatus: string | null;
}

/** The provider-neutral client contract. */
export interface CourierClient {
  readonly provider: CourierProviderKey;
  book(req: CourierBookingRequest): Promise<CourierBookingResult>;
  statusOf(ref: { consignmentId: string | null; trackingCode: string | null }): Promise<CourierStatusResult>;
}

export type CourierConcreteClient = SteadfastClient | PathaoClient | RedxClient | EcourierClient;

/** The ONE construction site for concrete provider clients.
 * `hooks.onPathaoTokens` preserves CourierService's behaviour of
 * persisting Pathao's refreshed tokens back into the sealed
 * credential row. Credentials arrive DECRYPTED from the caller
 * and are never logged or returned anywhere. */
export function createCourierClient(
  provider: CourierProviderKey,
  creds: Record<string, any>,
  hooks?: { onPathaoTokens?: (tokens: any) => Promise<void> | void },
): CourierConcreteClient {
  switch (provider) {
    case "steadfast":
      return new SteadfastClient({ apiKey: creds.apiKey, secretKey: creds.secretKey });
    case "pathao": {
      const client = new PathaoClient({
        baseUrl: creds.baseUrl || PATHAO_PROD_BASE,
        clientId: creds.clientId, clientSecret: creds.clientSecret,
        username: creds.username, password: creds.password,
        accessToken: creds.accessToken, refreshToken: creds.refreshToken,
        tokenIssuedAt: creds.tokenIssuedAt, expiresIn: creds.expiresIn,
      });
      if (hooks?.onPathaoTokens) client.onTokens = hooks.onPathaoTokens;
      return client;
    }
    case "redx":
      return new RedxClient({ baseUrl: creds.baseUrl || REDX_DEFAULT_BASE, accessToken: creds.accessToken });
    case "ecourier":
      return new EcourierClient({
        baseUrl: creds.baseUrl || ECOURIER_DEFAULT_BASE,
        apiKey: creds.apiKey, apiSecret: creds.apiSecret, userId: creds.userId,
      });
    default:
      throw new BadRequestException(`Unknown courier provider: ${provider}`);
  }
}

/** Wrap a concrete client in the provider-neutral contract. The
 * booking translations below are the EXACT payload builds +
 * validations CourierService.bookShipment used to inline —
 * moved, not changed. */
export function courierAdapter(provider: CourierProviderKey, client: CourierConcreteClient): CourierClient {
  switch (provider) {
    case "steadfast": return new SteadfastCourierAdapter(client as SteadfastClient);
    case "pathao": return new PathaoCourierAdapter(client as PathaoClient);
    case "redx": return new RedxCourierAdapter(client as RedxClient);
    case "ecourier": return new EcourierCourierAdapter(client as EcourierClient);
    default:
      throw new BadRequestException(`Unknown courier provider: ${provider}`);
  }
}

class SteadfastCourierAdapter implements CourierClient {
  readonly provider = "steadfast" as const;
  constructor(private readonly inner: SteadfastClient) {}

  async book(req: CourierBookingRequest): Promise<CourierBookingResult> {
    const consignment = await this.inner.createOrder({
      invoice: req.invoice, recipient_name: req.recipientName, recipient_phone: req.recipientPhone,
      recipient_address: req.recipientAddress, cod_amount: req.codAmountMajor, note: req.note,
    });
    // Steadfast's own status strings are used verbatim as the
    // internal status (pre-GB5 behaviour), so raw == mapped.
    // Its create-order response carries no charge in the
    // documented shape -> chargeMinor stays null.
    const status = String(consignment.status ?? "in_review");
    return {
      consignmentId: String(consignment.consignment_id),
      trackingCode: String(consignment.tracking_code),
      status, rawStatus: status, chargeMinor: null,
    };
  }

  async statusOf(ref: { consignmentId: string | null; trackingCode: string | null }): Promise<CourierStatusResult> {
    const status = await this.inner.statusByTrackingCode(ref.trackingCode ?? "");
    return { status, rawStatus: status };
  }
}

class PathaoCourierAdapter implements CourierClient {
  readonly provider = "pathao" as const;
  constructor(private readonly inner: PathaoClient) {}

  async book(req: CourierBookingRequest): Promise<CourierBookingResult> {
    const c = this.inner;
    const phone = normalizeBdPhone(req.recipientPhone);
    if (!/^01\d{9}$/.test(phone)) throw new BadRequestException("Pathao এর জন্য প্রাপকের ফোন 01 দিয়ে শুরু হওয়া ১১ ডিজিটের নম্বর হতে হবে");
    let storeId = req.pathao?.storeId;
    if (!storeId) {
      const stores = await c.getStores();
      const first = stores.find((s: any) => s.is_active === 1 || s.is_active === true) ?? stores[0];
      if (!first) throw new BadRequestException("Pathao অ্যাকাউন্টে কোনো স্টোর পাওয়া যায়নি — আগে Pathao Merchant Panel এ স্টোর তৈরি করুন");
      storeId = Number(first.store_id);
    }
    const weight = req.pathao?.itemWeightKg ?? 0.5;
    if (!(weight >= 0.5 && weight <= 10)) throw new BadRequestException("Pathao তে ওজন ০.৫–১০ কেজির মধ্যে হতে হয়");
    const booked = await c.createOrder({
      store_id: storeId, merchant_order_id: req.invoice,
      recipient_name: req.recipientName, recipient_phone: phone, recipient_address: req.recipientAddress,
      recipient_city: req.pathao?.cityId, recipient_zone: req.pathao?.zoneId, recipient_area: req.pathao?.areaId,
      delivery_type: req.pathao?.deliveryType ?? 48, item_type: req.pathao?.itemType ?? 2,
      item_quantity: req.itemCount,
      item_weight: weight, item_description: req.itemDescription || undefined,
      special_instruction: req.note,
      amount_to_collect: Math.round(req.codAmountMajor),
    });
    return {
      consignmentId: booked.consignmentId,
      trackingCode: booked.consignmentId,
      status: booked.status,
      rawStatus: booked.rawStatus,
      // Pathao's booking response carries delivery_fee — the
      // one real booking-time charge among the original three.
      chargeMinor: booked.deliveryFee != null ? Math.round(booked.deliveryFee * 100) : null,
    };
  }

  async statusOf(ref: { consignmentId: string | null; trackingCode: string | null }): Promise<CourierStatusResult> {
    return this.inner.orderStatusDetail(ref.consignmentId ?? ref.trackingCode ?? "");
  }
}

class RedxCourierAdapter implements CourierClient {
  readonly provider = "redx" as const;
  constructor(private readonly inner: RedxClient) {}

  async book(req: CourierBookingRequest): Promise<CourierBookingResult> {
    const c = this.inner;
    if (!req.redx?.deliveryAreaId || !req.redx?.deliveryArea) {
      throw new BadRequestException("RedX বুকিংয়ের জন্য ডেলিভারি এলাকা (Area) বেছে নিতে হবে");
    }
    const weightKg = req.redx?.parcelWeightKg ?? 0.5;
    if (!(weightKg > 0 && weightKg <= 30)) throw new BadRequestException("RedX তে ওজন ০–৩০ কেজির মধ্যে হতে হয়");
    const booked = await c.createParcel({
      customer_name: req.recipientName, customer_phone: normalizeBdPhone(req.recipientPhone),
      delivery_area: req.redx.deliveryArea, delivery_area_id: req.redx.deliveryAreaId,
      customer_address: req.recipientAddress, merchant_invoice_id: req.invoice,
      cash_collection_amount: String(Math.round(req.codAmountMajor)),
      parcel_weight: Math.round(weightKg * 1000), // RedX expects grams
      instruction: req.note,
      value: Math.max(1, Math.round(req.orderTotalMajor)),
      pickup_store_id: req.redx?.pickupStoreId,
      parcel_details_json: req.items.map((i) => ({
        name: i.name, value: Math.round(Number(BigInt((i.totalMinor ?? 0) as string | number | bigint)) / 100),
      })),
    });
    return {
      consignmentId: booked.trackingId,
      trackingCode: booked.trackingId,
      status: booked.status,
      rawStatus: booked.rawStatus,
      // RedX's create response carries no charge in its
      // documented shape -> null (its charge is knowable only
      // via the pre-booking calculator, which is a quote).
      chargeMinor: null,
    };
  }

  async statusOf(ref: { consignmentId: string | null; trackingCode: string | null }): Promise<CourierStatusResult> {
    return this.inner.parcelStatusDetail(ref.trackingCode ?? "");
  }
}

class EcourierCourierAdapter implements CourierClient {
  readonly provider = "ecourier" as const;
  constructor(private readonly inner: EcourierClient) {}

  async book(req: CourierBookingRequest): Promise<CourierBookingResult> {
    // eCourier's documented order call (API doc §2.1) makes
    // city, thana, area, zip and an ASSIGNED package_code all
    // mandatory, plus a payment_method — staff supply them on
    // the booking form (city/thana/package come from eCourier's
    // own lists; nothing is invented silently here).
    const city = req.ecourier?.city?.trim();
    const thana = req.ecourier?.thana?.trim();
    const area = req.ecourier?.area?.trim();
    const zip = req.ecourier?.zip?.trim();
    const packageCode = req.ecourier?.packageCode?.trim();
    if (!city || !thana || !area || !zip || !packageCode) {
      throw new BadRequestException("eCourier বুকিংয়ের জন্য প্রাপকের শহর (City), থানা, এলাকা (Area), পোস্টকোড (Zip) ও Package Code — সবগুলোই দরকার");
    }
    // payment_method (COD | POS | MPAY | CCRD): staff's choice
    // wins; the default is COD exactly when money is collected
    // at the door. For a prepaid order there is no documented
    // default, so staff must choose — never guessed here.
    let paymentMethod = req.ecourier?.paymentMethod?.trim().toUpperCase() || "";
    if (!paymentMethod) {
      if (req.codAmountMajor > 0) paymentMethod = "COD";
      else throw new BadRequestException("প্রিপেইড অর্ডারের জন্য eCourier পেমেন্ট মেথড (POS / MPAY / CCRD) বেছে নিন — ডকুমেন্টে প্রিপেইডের কোনো ডিফল্ট মান নেই");
    }
    if (!(ECOURIER_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
      throw new BadRequestException(`eCourier পেমেন্ট মেথড হতে হবে: ${ECOURIER_PAYMENT_METHODS.join(" / ")}`);
    }
    const booked = await this.inner.placeOrder({
      recipient_name: req.recipientName,
      recipient_mobile: normalizeBdPhone(req.recipientPhone),
      recipient_city: city,
      recipient_thana: thana,
      recipient_area: area,
      recipient_address: req.recipientAddress,
      recipient_zip: zip,
      package_code: packageCode,
      // For COD, product_price IS the amount to collect (the
      // doc ties the > 0 rule to it); for door-payment methods
      // it is likewise the amount the customer pays on delivery;
      // a prepaid order collects 0.
      product_price: Math.round(req.codAmountMajor),
      payment_method: paymentMethod,
    });
    return {
      consignmentId: booked.trackingId,
      trackingCode: booked.trackingId,
      status: booked.status,
      rawStatus: booked.rawStatus,
      // The booking response carries no charge field (fees live
      // on /packages + /track) -> null, never estimated.
      chargeMinor: null,
    };
  }

  async statusOf(ref: { consignmentId: string | null; trackingCode: string | null }): Promise<CourierStatusResult> {
    return this.inner.trackParcel(ref.trackingCode ?? ref.consignmentId ?? "");
  }
}
