/**
 * Steadfast Courier (Packzy) API client.
 * Verified against the published API shape (2026-10): base
 * https://portal.packzy.com/api/v1, headers Api-Key + Secret-Key.
 *   POST /create_order {invoice, recipient_name, recipient_phone,
 *     recipient_address, cod_amount, note}
 *     -> { status: 200, consignment: { consignment_id, tracking_code,
 *          status, ... } }
 *   GET /status_by_trackingcode/{code} -> { status: 200, delivery_status }
 *   GET /get_balance -> { status: 200, current_balance }
 * Any non-200 envelope or HTTP error raises SteadfastError carrying
 * the courier's own message - a booking counts only with a real
 * consignment in the response.
 */
export class SteadfastError extends Error {}

export interface SteadfastCredentials { apiKey: string; secretKey: string }

const BASE = process.env.STEADFAST_BASE_URL || "https://portal.packzy.com/api/v1";

export class SteadfastClient {
  constructor(private readonly creds: SteadfastCredentials, private readonly fetchFn: typeof fetch = fetch) {}

  private async call(path: string, init: RequestInit = {}): Promise<any> {
    const res = await this.fetchFn(`${BASE}${path}`, {
      ...init,
      headers: {
        "Api-Key": this.creds.apiKey,
        "Secret-Key": this.creds.secretKey,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok) {
      throw new SteadfastError(`Steadfast request failed (${res.status}): ${body?.message ?? res.statusText}`);
    }
    if (body && typeof body.status === "number" && body.status !== 200) {
      throw new SteadfastError(`Steadfast error: ${body.message ?? `status ${body.status}`}`);
    }
    return body;
  }

  async getBalance(): Promise<any> {
    return this.call("/get_balance");
  }

  async createOrder(payload: {
    invoice: string; recipient_name: string; recipient_phone: string;
    recipient_address: string; cod_amount: number; note?: string;
  }): Promise<any> {
    const body = await this.call("/create_order", { method: "POST", body: JSON.stringify(payload) });
    const consignment = body?.consignment;
    if (!consignment?.consignment_id || !consignment?.tracking_code) {
      throw new SteadfastError(`Steadfast did not return a consignment: ${body?.message ?? "unknown response"}`);
    }
    return consignment;
  }

  async statusByTrackingCode(trackingCode: string): Promise<string> {
    const body = await this.call(`/status_by_trackingcode/${encodeURIComponent(trackingCode)}`);
    if (!body?.delivery_status) throw new SteadfastError("Steadfast status response had no delivery_status");
    return String(body.delivery_status);
  }
}
