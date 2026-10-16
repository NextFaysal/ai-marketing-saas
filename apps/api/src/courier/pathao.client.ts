/**
 * Pathao Courier Merchant API client (Hermes).
 * Shape verified 2026-10 from Pathao's published merchant API
 * documentation (merchant.pathao.com -> Developer API):
 *   Base (production): https://api-hermes.pathao.com
 *   Base (sandbox):    https://courier-api-sandbox.pathao.com
 *   POST /aladdin/api/v1/issue-token {client_id, client_secret,
 *     grant_type: "password", username, password}
 *     -> { access_token, refresh_token, expires_in (432000 = 5 days) }
 *     Refresh: same endpoint with grant_type "refresh_token".
 *   GET  /aladdin/api/v1/stores            -> data.data[] {store_id...}
 *   GET  /aladdin/api/v1/city-list         -> data.data[] {city_id, city_name}
 *   GET  /aladdin/api/v1/cities/:id/zone-list
 *   GET  /aladdin/api/v1/zones/:id/area-list
 *   POST /aladdin/api/v1/orders {...}      -> data {consignment_id,
 *          merchant_order_id, order_status, delivery_fee}
 *   POST /aladdin/api/v1/merchant/price-plan {store_id, item_type,
 *          delivery_type, item_weight (kg), recipient_city,
 *          recipient_zone} -> data {price, discount, promo_discount,
 *          plan_id, cod_enabled, cod_percentage, additional_charge,
 *          final_price}  (pre-booking price calculation)
 *   GET  /aladdin/api/v1/orders/:consignmentId/info
 *          -> data {order_status, order_status_slug, ...}
 * A booking counts ONLY when the response carries a consignment_id.
 * Pathao statuses are mapped into the shared courier vocabulary
 * (pending / in_transit / delivered / partial_delivered / cancelled /
 * returned) so notifications and terminal logic stay provider-neutral.
 */
export class PathaoError extends Error {}

export interface PathaoCredentials {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  accessToken?: string;
  refreshToken?: string;
  tokenIssuedAt?: number; // epoch ms
  expiresIn?: number; // seconds
}

export const PATHAO_PROD_BASE = "https://api-hermes.pathao.com";
export const PATHAO_SANDBOX_BASE = "https://courier-api-sandbox.pathao.com";

export function mapPathaoStatus(raw: string | null | undefined): string {
  const s = String(raw ?? "").toLowerCase();
  if (!s) return "pending";
  if (s.includes("partial") && s.includes("deliver")) return "partial_delivered";
  if (s.includes("delivered") || s === "delivery_complete") return "delivered";
  if (s.includes("return")) return "returned";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("transit") || s.includes("picked") || s.includes("on the way") || s.includes("out for delivery") || s.includes("hub")) return "in_transit";
  if (s.includes("pending") || s.includes("pickup")) return "pending";
  return s.replace(/\s+/g, "_");
}

export class PathaoClient {
  /** Called whenever tokens change so the service can persist them (encrypted). */
  onTokens?: (tokens: { accessToken: string; refreshToken?: string; tokenIssuedAt: number; expiresIn: number }) => Promise<void> | void;

  constructor(private creds: PathaoCredentials, private readonly fetchFn: typeof fetch = fetch) {}

  private get base() { return (this.creds.baseUrl || PATHAO_PROD_BASE).replace(/\/$/, ""); }

  private async issue(grant: Record<string, string>): Promise<void> {
    const res = await this.fetchFn(`${this.base}/aladdin/api/v1/issue-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: this.creds.clientId, client_secret: this.creds.clientSecret, ...grant }),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok || !body?.access_token) {
      throw new PathaoError(`Pathao token issue failed (${res.status}): ${body?.message ?? body?.error ?? res.statusText}`);
    }
    this.creds.accessToken = body.access_token;
    if (body.refresh_token) this.creds.refreshToken = body.refresh_token;
    this.creds.tokenIssuedAt = Date.now();
    this.creds.expiresIn = Number(body.expires_in ?? 432000);
    await this.onTokens?.({
      accessToken: this.creds.accessToken!, refreshToken: this.creds.refreshToken,
      tokenIssuedAt: this.creds.tokenIssuedAt, expiresIn: this.creds.expiresIn,
    });
  }

  private tokenFresh(): boolean {
    if (!this.creds.accessToken || !this.creds.tokenIssuedAt) return false;
    const ttl = (this.creds.expiresIn ?? 432000) * 1000;
    return Date.now() - this.creds.tokenIssuedAt < ttl - 5 * 60 * 1000;
  }

  async ensureToken(): Promise<void> {
    if (this.tokenFresh()) return;
    if (this.creds.refreshToken) {
      try {
        await this.issue({ grant_type: "refresh_token", refresh_token: this.creds.refreshToken });
        return;
      } catch { /* fall through to a fresh password grant */ }
    }
    await this.issue({ grant_type: "password", username: this.creds.username, password: this.creds.password });
  }

  private async call(path: string, init: RequestInit = {}, retried = false): Promise<any> {
    await this.ensureToken();
    const res = await this.fetchFn(`${this.base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.creds.accessToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const body: any = await res.json().catch(() => null);
    if (res.status === 401 && !retried) {
      // Token rejected server-side: force a fresh password grant once.
      this.creds.accessToken = undefined;
      this.creds.tokenIssuedAt = undefined;
      return this.call(path, init, true);
    }
    if (!res.ok || (body && typeof body.code === "number" && body.code >= 400)) {
      const validation = body?.errors ? ` ${JSON.stringify(body.errors)}` : "";
      throw new PathaoError(`Pathao request failed (${res.status}): ${body?.message ?? res.statusText}${validation}`);
    }
    return body;
  }

  /** Connect verification: issue a token against the REAL API and read stores. */
  async verify(): Promise<{ stores: number }> {
    await this.issue({ grant_type: "password", username: this.creds.username, password: this.creds.password });
    const stores = await this.getStores();
    return { stores: stores.length };
  }

  async getStores(): Promise<any[]> {
    const body = await this.call("/aladdin/api/v1/stores");
    return body?.data?.data ?? [];
  }

  async getCities(): Promise<any[]> {
    const body = await this.call("/aladdin/api/v1/city-list");
    return body?.data?.data ?? body?.data ?? [];
  }

  async getZones(cityId: number): Promise<any[]> {
    const body = await this.call(`/aladdin/api/v1/cities/${cityId}/zone-list`);
    return body?.data?.data ?? body?.data ?? [];
  }

  async getAreas(zoneId: number): Promise<any[]> {
    const body = await this.call(`/aladdin/api/v1/zones/${zoneId}/area-list`);
    return body?.data?.data ?? body?.data ?? [];
  }

  async createOrder(payload: {
    store_id: number; merchant_order_id?: string;
    recipient_name: string; recipient_phone: string; recipient_address: string;
    recipient_city?: number; recipient_zone?: number; recipient_area?: number;
    delivery_type: number; item_type: number; item_quantity: number; item_weight: number;
    item_description?: string; special_instruction?: string; amount_to_collect: number;
  }): Promise<{ consignmentId: string; status: string; rawStatus: string | null; deliveryFee: number | null }> {
    // Pathao rejects null location fields - omit them entirely.
    const clean: Record<string, unknown> = { ...payload };
    for (const key of ["recipient_city", "recipient_zone", "recipient_area", "merchant_order_id", "item_description", "special_instruction"]) {
      if (clean[key] === undefined || clean[key] === null || clean[key] === "") delete clean[key];
    }
    const body = await this.call("/aladdin/api/v1/orders", { method: "POST", body: JSON.stringify(clean) });
    const data = body?.data;
    if (!data?.consignment_id) {
      throw new PathaoError(`Pathao did not return a consignment id: ${body?.message ?? "unknown response"}`);
    }
    return {
      consignmentId: String(data.consignment_id),
      status: mapPathaoStatus(data.order_status),
      // GB5: the provider's verbatim status, preserved for the
      // shipment event log (additive — existing readers ignore it).
      rawStatus: data.order_status != null ? String(data.order_status) : null,
      deliveryFee: data.delivery_fee !== undefined ? Number(data.delivery_fee) : null,
    };
  }

  /** Pre-booking price calculation from Pathao's OWN price-plan API.
   * The quoted charge is final_price exactly as Pathao returns it -
   * never a locally computed estimate. */
  async pricePlan(payload: {
    store_id: number; item_type: number; delivery_type: number;
    item_weight: number; recipient_city: number; recipient_zone: number;
  }): Promise<{
    price: number; discount: number; promoDiscount: number; planId: number | null;
    codEnabled: boolean; codPercentage: number; additionalCharge: number; finalPrice: number;
  }> {
    const body = await this.call("/aladdin/api/v1/merchant/price-plan", { method: "POST", body: JSON.stringify(payload) });
    const data = body?.data;
    if (!data || data.final_price === undefined || data.final_price === null) {
      throw new PathaoError(`Pathao price plan response had no final_price: ${body?.message ?? "unknown response"}`);
    }
    return {
      price: Number(data.price ?? 0),
      discount: Number(data.discount ?? 0),
      promoDiscount: Number(data.promo_discount ?? 0),
      planId: data.plan_id !== undefined && data.plan_id !== null ? Number(data.plan_id) : null,
      codEnabled: Number(data.cod_enabled ?? 0) === 1,
      codPercentage: Number(data.cod_percentage ?? 0),
      additionalCharge: Number(data.additional_charge ?? 0),
      finalPrice: Number(data.final_price),
    };
  }

  async orderStatus(consignmentId: string): Promise<string> {
    return (await this.orderStatusDetail(consignmentId)).status;
  }

  /** GB5: the same read as orderStatus, also returning the
   * provider's verbatim status string for the event log. */
  async orderStatusDetail(consignmentId: string): Promise<{ status: string; rawStatus: string | null }> {
    const body = await this.call(`/aladdin/api/v1/orders/${encodeURIComponent(consignmentId)}/info`);
    const data = body?.data;
    if (!data) throw new PathaoError("Pathao order info response was empty");
    const raw = data.order_status_slug ?? data.order_status;
    return { status: mapPathaoStatus(raw), rawStatus: raw != null ? String(raw) : null };
  }
}

/** Current token state (for the service to persist after verify/refresh). */
export function pathaoClientTokens(client: PathaoClient): { accessToken?: string; refreshToken?: string; tokenIssuedAt?: number; expiresIn?: number } {
  const c = (client as any).creds as PathaoCredentials;
  return { accessToken: c.accessToken, refreshToken: c.refreshToken, tokenIssuedAt: c.tokenIssuedAt, expiresIn: c.expiresIn };
}
