/**
 * RedX Courier Open API client.
 * Shape verified 2026-10 from RedX's published open API documentation:
 *   Base (open API): https://openapi.redx.com.bd/v1.0.0-beta
 *   (legacy accounts: https://api.redx.com.bd/v1 — configurable)
 *   Auth header: API-ACCESS-TOKEN: Bearer <token from merchant panel>
 *   POST /parcel                 -> { tracking_id, ... } (create parcel)
 *   GET  /parcel/info/:id        -> parcel detail incl. status
 *   GET  /parcel/track/:id       -> tracking detail
 *   GET  /areas                  -> delivery areas [{id, name, ...}]
 *   GET  /pickup/stores          -> pickup stores
 *   POST /charge/charge_calculator {delivery_area_id, pickup_area_id,
 *          cash_collection_amount, weight (grams)}
 * parcel_weight is in GRAMS. A booking counts ONLY when the response
 * carries a tracking id. Statuses map into the shared vocabulary.
 */
export class RedxError extends Error {}

export interface RedxCredentials { baseUrl: string; accessToken: string }

export const REDX_DEFAULT_BASE = "https://openapi.redx.com.bd/v1.0.0-beta";

export function mapRedxStatus(raw: string | null | undefined): string {
  const s = String(raw ?? "").toLowerCase();
  if (!s) return "pending";
  if (s.includes("delivered") && s.includes("partial")) return "partial_delivered";
  if (s.includes("delivered")) return "delivered";
  if (s.includes("return")) return "returned";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("transit") || s.includes("picked") || s.includes("on-the-way") || s.includes("on the way") || s.includes("delivery in progress")) return "in_transit";
  if (s.includes("pending") || s.includes("created") || s.includes("received")) return "pending";
  return s.replace(/[\s-]+/g, "_");
}

export class RedxClient {
  constructor(private readonly creds: RedxCredentials, private readonly fetchFn: typeof fetch = fetch) {}

  private get base() { return (this.creds.baseUrl || REDX_DEFAULT_BASE).replace(/\/$/, ""); }

  private async call(path: string, init: RequestInit = {}): Promise<any> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      ...init,
      headers: {
        "API-ACCESS-TOKEN": `Bearer ${this.creds.accessToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok) {
      throw new RedxError(`RedX request failed (${res.status}): ${body?.message ?? body?.error?.message ?? res.statusText}`);
    }
    return body;
  }

  /** Connect verification: the areas list must come back from the real API. */
  async verify(): Promise<{ areas: number }> {
    const areas = await this.getAreas();
    return { areas: areas.length };
  }

  async getAreas(): Promise<any[]> {
    const body = await this.call("/areas");
    const list = body?.areas ?? body?.data ?? body;
    if (!Array.isArray(list)) throw new RedxError("RedX areas response was not a list");
    return list;
  }

  async getPickupStores(): Promise<any[]> {
    const body = await this.call("/pickup/stores");
    const list = body?.pickup_stores ?? body?.stores ?? body?.data ?? body;
    return Array.isArray(list) ? list : [];
  }

  async createParcel(payload: {
    customer_name: string; customer_phone: string;
    delivery_area: string; delivery_area_id: number;
    customer_address: string; merchant_invoice_id: string;
    cash_collection_amount: string; parcel_weight: number; // grams
    instruction?: string; value: number; pickup_store_id?: number;
    parcel_details_json?: { name: string; category?: string; value: number }[];
  }): Promise<{ trackingId: string; status: string }> {
    const body = await this.call("/parcel", { method: "POST", body: JSON.stringify(payload) });
    const data = body?.data ?? body;
    const trackingId = data?.tracking_id ?? data?.trackingId;
    if (!trackingId) {
      throw new RedxError(`RedX did not return a tracking id: ${body?.message ?? "unknown response"}`);
    }
    return { trackingId: String(trackingId), status: mapRedxStatus(data?.status ?? "pending") };
  }

  async parcelStatus(trackingId: string): Promise<string> {
    const body = await this.call(`/parcel/info/${encodeURIComponent(trackingId)}`);
    const data = body?.data ?? body?.parcel ?? body;
    const status = data?.status ?? data?.parcel_status;
    if (!status) throw new RedxError("RedX parcel info response had no status");
    return mapRedxStatus(status);
  }
}
