import { createHmac } from "node:crypto";

/**
 * Daraz — DEVELOPMENT ADAPTER ONLY. NOT A LIVE INTEGRATION.
 *
 * OU3 (One-Umbrella OB4), verify-first spike:
 * docs/one-umbrella-ou3-daraz-spike.md.
 *
 * What IS evidenced (official Lazada Open Platform docs — Daraz
 * runs the same Alibaba stack through open.daraz.com):
 *  - the request-signing contract (HMAC-SHA256 over the
 *    ASCII-sorted, concatenated parameters prefixed with the API
 *    path), implemented below as `signDarazRequest` — a pure
 *    function, unit-tested against a hand-computed vector;
 *  - the app model: a developer app (App Key + App Secret) must
 *    be created and partner-approved first, and each seller must
 *    authorize it via an OAuth2 code-for-token flow before any
 *    seller data can be read.
 *
 * What is NOT evidenced, and therefore NOT built as live calls:
 *  - any Daraz-venture production REST base URL (the official
 *    endpoint list names only the six Lazada ventures);
 *  - the Daraz product create/update and order get payload
 *    contracts.
 *
 * Behaviour (Paperfly OU6 precedent): EVERY network operation
 * refuses with the real reason. Credentials a merchant saves are
 * sealed per-org by DarazService and are NEVER sent anywhere by
 * this client. Replace the refusals with real calls ONLY when a
 * merchant app is approved AND the Daraz endpoint contract is
 * evidenced (OU3 live-proof checklist in the spike doc).
 */
export class DarazDevAdapterError extends Error {}

export interface DarazCredentials {
  appKey?: string;
  appSecret?: string;
  accessToken?: string;
  refreshToken?: string;
}

export const DARAZ_NOT_LIVE_MESSAGE =
  "Daraz এখনো লাইভ নয় — এটি একটি Development Adapter: Daraz API ব্যবহারের জন্য আগে open.daraz.com-এ একটি app তৈরি করে partner approval নিতে হয় এবং প্রতিটি বিক্রেতাকে সেই app OAuth দিয়ে authorize করতে হয়; Daraz-এর অফিসিয়াল ডকুমেন্টেশনে Daraz (BD) endpoint ও product/order API চুক্তি যাচাই করা যায়নি, তাই কোনো আসল Daraz কল করা হয়নি। Merchant app অনুমোদিত হলে ও চুক্তি প্রমাণিত হলে এই adapter আসল client দিয়ে বদলানো হবে।";

/**
 * The evidenced shared-stack signature: sort all parameters
 * (except `sign` and byte-array values) by name in ASCII order,
 * concatenate `name`+`value`, prefix the API path, digest with
 * HMAC-SHA256 keyed by the app secret, uppercase hex.
 * Source: docs/one-umbrella-ou3-daraz-spike.md §2 (S2).
 */
export function signDarazRequest(
  apiPath: string,
  params: Record<string, string>,
  appSecret: string,
  body?: string,
): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "sign" && params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort();
  let base = apiPath;
  for (const k of keys) base += `${k}${params[k]}`;
  if (body) base += body;
  return createHmac("sha256", appSecret).update(base, "utf8").digest("hex").toUpperCase();
}

export class DarazDevAdapterClient {
  /** Marker read by the registry/UI: development adapter,
   * never a live marketplace connection. */
  readonly developmentAdapter = true as const;
  readonly live = false as const;

  constructor(
    private readonly creds: DarazCredentials = {},
    // Accepted only so the class shape matches the other
    // clients' (creds, fetchFn) construction in specs — the dev
    // adapter NEVER calls it. There is no evidenced Daraz
    // endpoint to call.
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    void this.creds;
    void this.fetchFn;
  }

  private refuse(): never {
    throw new DarazDevAdapterError(DARAZ_NOT_LIVE_MESSAGE);
  }

  /** No verify-before-save can PASS for Daraz today: credential
   * verification would need a call to an evidenced Daraz endpoint
   * with an approved app + a seller access token. DarazService
   * therefore stores saved credentials as honestly-labelled
   * "configured_not_verified" (CC3 pattern), never "connected". */
  async verify(): Promise<never> {
    return this.refuse();
  }

  async getProducts(_params: Record<string, unknown> = {}): Promise<never> {
    return this.refuse();
  }

  async createProduct(_payload: Record<string, unknown>): Promise<never> {
    return this.refuse();
  }

  async updateProduct(_payload: Record<string, unknown>): Promise<never> {
    return this.refuse();
  }

  async getOrders(_params: Record<string, unknown> = {}): Promise<never> {
    return this.refuse();
  }
}
