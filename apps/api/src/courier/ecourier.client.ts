/**
 * eCourier API client — GB5 (GC13), built from eCourier's OWN
 * versioned merchant API documents (the strongest official
 * source; full citations in docs/gb5-courier-research.md):
 *   - General merchant doc v5.2 (2022-06-06), labelled v5.5 on
 *     the Resources page: ecourier.com.bd/resources/
 *   - Reseller doc v5.5 (2024-01-25) for the later additions.
 *
 * Documented contract (PDF §1.0, §2.1, §2.2, §2.3, §4.0):
 *  - Base: https://backoffice.ecourier.com.bd/api (live);
 *    https://staging.ecourier.com.bd/api is the documented
 *    sandbox base (no sandbox credentials are published — a
 *    staging set still comes from eCourier).
 *  - EVERY operation is a POST with a JSON body.
 *  - Auth: three headers — API-KEY, API-SECRET, USER-ID
 *    (hyphenated, per §1.0). eCourier's web materials have also
 *    shown underscore spellings, so both spellings are sent;
 *    the hyphenated set is the documented one. Credentials are
 *    provider-issued for a merchant account — the docs do NOT
 *    evidence a self-serve generation screen.
 *  - Verify-before-save: POST /packages returns the packages
 *    ASSIGNED to the merchant (package_code, shipping_charge,
 *    weight band, coverage); 401 on bad credentials.
 *  - Booking: POST /order-place. Mandatory: recipient_name,
 *    recipient_mobile, recipient_city, recipient_thana,
 *    recipient_area, recipient_address, recipient_zip,
 *    package_code, product_price, payment_method
 *    (COD | POS | MPAY | CCRD). There is NO weight field
 *    (weight lives in the package_code) and NO cod_amount
 *    field: for COD, product_price IS the amount to collect
 *    (and must be > 0 for COD). Success returns a single ID
 *    (an ECR… identifier) = the tracking/consignment id.
 *  - The booking response carries NO charge/fee field (fees
 *    exist as shipping_charge on /packages and shipping_price
 *    on /track) -> chargeMinor stays null, never estimated.
 *  - Tracking: POST /track { ecr } -> query_data items whose
 *    `status` is an array of [status, note, timestamp] triples
 *    (newest first). The docs publish NO status enumeration;
 *    the only status strings evidenced in the documents are:
 *    Initiated, Initiated API, Picked Up, In Source Branch,
 *    In Transit, In Destination Branch, On the way to
 *    Delivery, Delivered. Status is polled — no webhooks are
 *    documented.
 */

export const ECOURIER_DEFAULT_BASE = "https://backoffice.ecourier.com.bd/api";
export const ECOURIER_SANDBOX_BASE = "https://staging.ecourier.com.bd/api";

export class EcourierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EcourierError";
  }
}

type FetchLike = typeof fetch;

export interface EcourierCredentials {
  baseUrl?: string;
  apiKey: string;
  apiSecret: string;
  userId: string;
}

/** Payment methods the place-order doc (§2.1) enumerates. */
export const ECOURIER_PAYMENT_METHODS = ["COD", "POS", "MPAY", "CCRD"] as const;

/**
 * The eight status strings evidenced in eCourier's own API
 * documents -> the internal vocabulary. Anything else the API
 * returns as free text degrades via the defensive fallbacks
 * below (returns/holds exist in eCourier's wider materials even
 * though the API doc never enumerates them) and finally to
 * in_transit — with the raw string always preserved by the
 * caller on the GC14 event log, never silently dropped.
 * "Return Pending"-style in-flight returns must NOT map to
 * "returned" (that would fire the stock restore + RTO count).
 */
export function mapEcourierStatus(raw: string): string {
  const s = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  // The eight documented strings first.
  if (s === "delivered") return "delivered";
  if (s === "on the way to delivery") return "out_for_delivery";
  if (s === "in transit" || s === "in source branch" || s === "in destination branch") return "in_transit";
  if (s === "picked up") return "picked_up";
  if (s === "initiated" || s === "initiated api") return "pending";
  // Defensive fallbacks for free-text statuses outside the doc's
  // examples (eCourier's consumer-facing vocabulary).
  if (s === "partial delivered" || s === "partially delivered") return "partial_delivered";
  if (s === "cancelled" || s === "canceled" || s === "cancel") return "cancelled";
  if (s === "return") return "returned";
  if (s === "return pending") return "in_transit";
  if (s === "on the way") return "in_transit";
  if (s === "ready") return "picked_up";
  if (s === "pending") return "pending";
  if (s === "hold") return "in_transit";
  if (s === "no delivery zone") return "delivery_failed";
  if (s === "paid") return "delivered";
  if (s === "unknown" || s === "") return "in_transit";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("return")) return s.includes("pending") ? "in_transit" : "returned";
  if (s.includes("cancel")) return "cancelled";
  return "in_transit";
}

export class EcourierClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly userId: string;
  /** Tests inject a fetch implementation; production uses global fetch. */
  fetchImpl: FetchLike = (...args: Parameters<FetchLike>) => fetch(...args);

  constructor(creds: EcourierCredentials) {
    this.baseUrl = (creds.baseUrl || ECOURIER_DEFAULT_BASE).replace(/\/$/, "");
    this.apiKey = creds.apiKey;
    this.apiSecret = creds.apiSecret;
    this.userId = creds.userId;
  }

  /** Every documented operation is a POST with a JSON body (§1.0). */
  private async call(path: string, payload: Record<string, unknown> = {}): Promise<any> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/${path.replace(/^\//, "")}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Documented spellings (§1.0 of the API documents).
          "API-KEY": this.apiKey,
          "API-SECRET": this.apiSecret,
          "USER-ID": this.userId,
          // eCourier's web materials have also rendered the
          // underscore spellings; sending both costs nothing and
          // covers whichever their gateway checks.
          API_KEY: this.apiKey,
          API_SECRET: this.apiSecret,
          USER_ID: this.userId,
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw new EcourierError(`eCourier request failed: ${e instanceof Error ? e.message : "network error"}`);
    }
    const text = await res.text().catch(() => "");
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!res.ok) {
      const message = body?.message ?? body?.error ?? (text ? text.slice(0, 200) : `HTTP ${res.status}`);
      throw new EcourierError(`eCourier API error (${res.status}): ${message}`);
    }
    // The documents' envelope carries response_code; an explicit
    // non-200 code in a 200 HTTP body is still a failure.
    const code = body?.response_code;
    if (code != null && Number(code) !== 200) {
      throw new EcourierError(`eCourier API error: ${body?.message ?? `response_code ${code}`}`);
    }
    if (body && (body.success === false || body.status === "error")) {
      throw new EcourierError(`eCourier API error: ${body.message ?? body.error ?? "request rejected"}`);
    }
    return body;
  }

  /** POST /packages (§2.3) — the packages ASSIGNED to this
   * merchant (code, shipping_charge, weight band, coverage). */
  async getPackages(): Promise<any[]> {
    const body = await this.call("/packages");
    const list = body?.data ?? body?.packages ?? body;
    return Array.isArray(list) ? list : [];
  }

  /** Verify-before-save: credentials are real iff the assigned
   * package list answers. Returns the count for audit metadata. */
  async verify(): Promise<{ packages: number }> {
    const packages = await this.getPackages();
    return { packages: packages.length };
  }

  /** POST /city-list (§2.6) — the documented city list. */
  async getCities(): Promise<any[]> {
    const body = await this.call("/city-list");
    const list = body?.data ?? body;
    return Array.isArray(list) ? list : [];
  }

  /** POST /thana-list (§2.7) — thanas for a city. */
  async getThanas(city: string): Promise<any[]> {
    const body = await this.call("/thana-list", { city });
    const list = body?.data ?? body;
    return Array.isArray(list) ? list : [];
  }

  /** POST /order-place (§2.1, General merchants). */
  async placeOrder(payload: {
    recipient_name: string;
    recipient_mobile: string;
    recipient_city: string;
    recipient_thana: string;
    recipient_area: string;
    recipient_address: string;
    recipient_zip: string;
    package_code: string;
    product_price: number;
    payment_method: string;
  }): Promise<{ trackingId: string; status: string; rawStatus: string | null }> {
    const body = await this.call("/order-place", { ...payload });
    const data = body?.data ?? body ?? {};
    // The documented success response carries a single ID (an
    // ECR… identifier). Accept the plausible documented-key
    // variants defensively, and REFUSE the booking without one
    // (the same discipline as the RedX/Pathao clients).
    const trackingId = data.ID ?? data.id ?? data.tracking_id ?? data.trackingId
      ?? data.ecourier_id ?? data.consignment_id ?? body?.ID;
    if (!trackingId) {
      throw new EcourierError(`eCourier did not return a tracking id: ${body?.message ?? "unknown response"}`);
    }
    const raw = data.status ?? data.tracking_status ?? null;
    return {
      trackingId: String(trackingId),
      // A fresh booking's own status per the documented
      // vocabulary starts at Initiated.
      status: raw != null ? mapEcourierStatus(String(raw)) : "pending",
      rawStatus: raw != null ? String(raw) : null,
    };
  }

  /** POST /track (§2.2) — query_data items carry `status` as
   * [status, note, timestamp] triples, newest first. */
  async trackParcel(trackingId: string): Promise<{ status: string; rawStatus: string | null }> {
    const body = await this.call("/track", { ecr: trackingId });
    const queryData = body?.query_data ?? body?.data ?? null;
    const item = Array.isArray(queryData) ? queryData[0] : queryData;
    if (!item || typeof item !== "object") {
      throw new EcourierError("eCourier tracking returned no data for this parcel");
    }
    let raw: unknown = null;
    if (Array.isArray(item.status)) {
      const first = item.status[0];
      raw = Array.isArray(first) ? first[0] : first;
    } else {
      raw = item.status ?? item.tracking_status ?? item.parcel_status ?? null;
    }
    if (raw == null || String(raw).trim() === "") {
      throw new EcourierError("eCourier tracking response had no status");
    }
    return { status: mapEcourierStatus(String(raw)), rawStatus: String(raw) };
  }
}
