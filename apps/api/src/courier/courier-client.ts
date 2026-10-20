import { BadRequestException } from "@nestjs/common";
import { SteadfastClient, SteadfastError } from "./steadfast.client";
import { PathaoClient, PATHAO_PROD_BASE } from "./pathao.client";
import { RedxClient, REDX_DEFAULT_BASE } from "./redx.client";
import { EcourierClient, ECOURIER_DEFAULT_BASE, ECOURIER_PAYMENT_METHODS } from "./ecourier.client";
import { PaperflyDevAdapterClient, PaperflyDevAdapterError } from "./paperfly.client";
import { badRequest } from "../i18n";

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
 *   COURIER_CAPABILITIES       per-provider capability map
 *                              (OU6 — see below)
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
 *
 * OU6 (One-Umbrella OB2) — capabilities + Paperfly:
 * COURIER_CAPABILITIES is the ONE descriptor a new courier
 * plugs into: book / label / track / cancel / balance /
 * codReconcile / quote as evidenced by that provider's client
 * IN THIS REPO (never aspirational — a capability is true only
 * when the code path exists), plus `live` (a real, evidenced
 * API contract backs the provider).
 * Paperfly was researched in GB5 and deliberately NOT built:
 * its API is partner-gated with no published developer
 * documentation (docs/gb5-courier-research.md) and OU6's
 * Step-0 search found no contract anywhere in-repo. OU6
 * therefore registers Paperfly on this framework as a clearly
 * labelled DEVELOPMENT adapter (paperfly.client.ts) whose
 * every operation refuses honestly — it is in the registry so
 * settings/balance surfaces can show its true state, and it
 * can never book, verify, track or report a balance.
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

export const COURIER_PROVIDERS = ["steadfast", "pathao", "redx", "ecourier", "paperfly"] as const;
export type CourierProviderKey = (typeof COURIER_PROVIDERS)[number];

/**
 * OU6: what a provider can actually do, as evidenced by its
 * client code in this repo. Field meanings:
 *  book         a real booking call exists (adapter book()).
 *  label        a shipping-label PDF can be produced for this
 *               provider's booked shipments (the platform PDF
 *               builder in pdf.ts, fed by the booked shipment).
 *  track        a real status/tracking read exists (statusOf()).
 *  cancel       a provider-side cancellation call exists.
 *               NONE of the in-repo clients implements one —
 *               false everywhere, never aspirational.
 *  balance      a real account-balance read exists on the
 *               provider's own API (client code evidence:
 *               SteadfastClient.getBalance -> GET /get_balance;
 *               no other in-repo client has a balance call).
 *  codReconcile this provider's shipments can enter the COD
 *               disbursement reconciliation (courier-
 *               reconciliation.service.ts documents its upload
 *               flow for Steadfast / Pathao / RedX only).
 *  quote        a real pre-booking charge quote exists
 *               (Pathao price plan, RedX charge calculator —
 *               see CourierService.quote).
 *  live         a real, evidenced API contract backs this
 *               provider. Paperfly: false — development
 *               adapter only (see paperfly.client.ts).
 */
export interface CourierCapabilities {
  book: boolean;
  label: boolean;
  track: boolean;
  cancel: boolean;
  balance: boolean;
  codReconcile: boolean;
  quote: boolean;
  live: boolean;
}

export const COURIER_CAPABILITIES: Record<CourierProviderKey, CourierCapabilities> = {
  steadfast: { book: true, label: true, track: true, cancel: false, balance: true, codReconcile: true, quote: false, live: true },
  pathao: { book: true, label: true, track: true, cancel: false, balance: false, codReconcile: true, quote: true, live: true },
  redx: { book: true, label: true, track: true, cancel: false, balance: false, codReconcile: true, quote: true, live: true },
  ecourier: { book: true, label: true, track: true, cancel: false, balance: false, codReconcile: false, quote: false, live: true },
  paperfly: { book: false, label: false, track: false, cancel: false, balance: false, codReconcile: false, quote: false, live: false },
};

export function courierCapabilities(provider: CourierProviderKey): CourierCapabilities {
  return COURIER_CAPABILITIES[provider];
}

/** OU6: a REAL account balance as returned by the provider's
 * own API — minor units, never estimated or fabricated. Only
 * adapters whose provider evidences a balance read implement
 * CourierClient.balance(). */
export interface CourierBalanceResult {
  balanceMinor: number;
  currency: "BDT";
}

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

/** The provider-neutral client contract. OU6: every adapter
 * also carries its COURIER_CAPABILITIES descriptor; balance()
 * is OPTIONAL and present only where the provider's own API
 * evidences a balance read (capabilities.balance === true). */
export interface CourierClient {
  readonly provider: CourierProviderKey;
  readonly capabilities: CourierCapabilities;
  /** True only for the Paperfly development adapter. */
  readonly developmentAdapter?: boolean;
  book(req: CourierBookingRequest): Promise<CourierBookingResult>;
  statusOf(ref: { consignmentId: string | null; trackingCode: string | null }): Promise<CourierStatusResult>;
  balance?(): Promise<CourierBalanceResult>;
}

export type CourierConcreteClient = SteadfastClient | PathaoClient | RedxClient | EcourierClient | PaperflyDevAdapterClient;

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
    case "paperfly":
      // OU6 DEVELOPMENT ADAPTER: the credentials are carried
      // only so the construction shape matches the other
      // providers — the adapter never sends them anywhere and
      // every operation refuses (paperfly.client.ts).
      return new PaperflyDevAdapterClient({ apiKey: creds.apiKey, apiSecret: creds.apiSecret });
    default:
      throw badRequest("courier.unknownCourierProvider", { provider: provider });
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
    case "paperfly": return new PaperflyCourierAdapter(client as PaperflyDevAdapterClient);
    default:
      throw badRequest("courier.unknownCourierProvider", { provider: provider });
  }
}

class SteadfastCourierAdapter implements CourierClient {
  readonly provider = "steadfast" as const;
  readonly capabilities = COURIER_CAPABILITIES.steadfast;
  constructor(private readonly inner: SteadfastClient) {}

  /** OU6: the ONE evidenced balance read in the courier layer
   * — Steadfast GET /get_balance -> { current_balance } (major
   * units). A response without a numeric balance is a provider
   * error, never a fabricated 0. */
  async balance(): Promise<CourierBalanceResult> {
    const body = await this.inner.getBalance();
    const major = Number(body?.current_balance);
    if (!Number.isFinite(major)) {
      throw new SteadfastError("Steadfast balance response had no numeric current_balance");
    }
    return { balanceMinor: Math.round(major * 100), currency: "BDT" };
  }

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
  readonly capabilities = COURIER_CAPABILITIES.pathao;
  constructor(private readonly inner: PathaoClient) {}

  async book(req: CourierBookingRequest): Promise<CourierBookingResult> {
    const c = this.inner;
    const phone = normalizeBdPhone(req.recipientPhone);
    if (!/^01\d{9}$/.test(phone)) throw badRequest("courier.pathaoPhoneFormat");
    let storeId = req.pathao?.storeId;
    if (!storeId) {
      const stores = await c.getStores();
      const first = stores.find((s: any) => s.is_active === 1 || s.is_active === true) ?? stores[0];
      if (!first) throw badRequest("courier.pathaoNoStore");
      storeId = Number(first.store_id);
    }
    const weight = req.pathao?.itemWeightKg ?? 0.5;
    if (!(weight >= 0.5 && weight <= 10)) throw badRequest("courier.pathaoWeightRange");
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
  readonly capabilities = COURIER_CAPABILITIES.redx;
  constructor(private readonly inner: RedxClient) {}

  async book(req: CourierBookingRequest): Promise<CourierBookingResult> {
    const c = this.inner;
    if (!req.redx?.deliveryAreaId || !req.redx?.deliveryArea) {
      throw badRequest("courier.redxAreaRequired");
    }
    const weightKg = req.redx?.parcelWeightKg ?? 0.5;
    if (!(weightKg > 0 && weightKg <= 30)) throw badRequest("courier.redxWeightRange");
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
  readonly capabilities = COURIER_CAPABILITIES.ecourier;
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
      throw badRequest("courier.ecourierFieldsRequired");
    }
    // payment_method (COD | POS | MPAY | CCRD): staff's choice
    // wins; the default is COD exactly when money is collected
    // at the door. For a prepaid order there is no documented
    // default, so staff must choose — never guessed here.
    let paymentMethod = req.ecourier?.paymentMethod?.trim().toUpperCase() || "";
    if (!paymentMethod) {
      if (req.codAmountMajor > 0) paymentMethod = "COD";
      else throw badRequest("courier.ecourierPrepaidMethodRequired");
    }
    if (!(ECOURIER_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
      throw badRequest("courier.ecourierPaymentMethods", { methods: ECOURIER_PAYMENT_METHODS.join(" / ") });
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

/**
 * OU6 — Paperfly DEVELOPMENT adapter on the framework. Every
 * operation refuses with the not-live reason (surfaced to
 * staff as a BadRequest, exactly like a provider refusal — a
 * booking attempt can never create a shipment or claim a
 * tracking code). No balance() is implemented: capabilities
 * .balance is false and the balance surface reports
 * not-supported for Paperfly.
 */
class PaperflyCourierAdapter implements CourierClient {
  readonly provider = "paperfly" as const;
  readonly capabilities = COURIER_CAPABILITIES.paperfly;
  readonly developmentAdapter = true as const;
  constructor(private readonly inner: PaperflyDevAdapterClient) {}

  async book(_req: CourierBookingRequest): Promise<CourierBookingResult> {
    try {
      await this.inner.createOrder({});
    } catch (e) {
      if (e instanceof PaperflyDevAdapterError) throw badRequest("courier.paperflyDevNotLive");
      throw e;
    }
    // Unreachable — the dev adapter always refuses. Kept as a
    // guard so a future edit can never fall through to a
    // fabricated booking result.
    throw badRequest("courier.paperflyDevCannotBook");
  }

  async statusOf(_ref: { consignmentId: string | null; trackingCode: string | null }): Promise<CourierStatusResult> {
    try {
      await this.inner.statusByTrackingCode("");
    } catch (e) {
      if (e instanceof PaperflyDevAdapterError) throw badRequest("courier.paperflyDevNotLive");
      throw e;
    }
    throw badRequest("courier.paperflyDevCannotTrack");
  }
}
