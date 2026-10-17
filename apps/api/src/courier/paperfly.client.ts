/**
 * Paperfly — DEVELOPMENT ADAPTER ONLY. NOT A LIVE INTEGRATION.
 *
 * OU6 (One-Umbrella OB2): Paperfly is registered in the courier
 * adapter framework (courier-client.ts) through this class so the
 * provider has an honest presence in the registry, the connect
 * settings surface and the capability/balance views — but it
 * performs NO network call and can NEVER book, verify, track or
 * report a balance.
 *
 * Why no real client exists (in-repo evidence, GB5 research):
 *  - docs/gb5-courier-research.md + docs/completion-gb5-acceptance.md:
 *    no developer documentation exists on any Paperfly-owned
 *    domain; Paperfly's own material frames API access as a
 *    per-enterprise partner arrangement ("Paperfly Go" is a
 *    token-gated partner API); the staging host public material
 *    names answers 401 behind a Cloudflare wall and publishes
 *    no auth model, endpoints or payload shapes.
 *  - A repo-wide search (OU6 Step-0, 2026-10-16) found NO
 *    Paperfly base URL, endpoint, auth header or payload shape
 *    anywhere in code, docs or plans — only the GB5 NO-BUILD
 *    verdict above. Building a "real" client would mean
 *    fabricating an integration, which the product rules forbid.
 *
 * Behaviour (following the TikTok partner-gated precedent in
 * inbox/channels/channel-adapter.ts): EVERY operation refuses
 * with the real reason. Credentials a merchant types into the
 * settings form are accepted by the form only so the surface
 * follows the existing per-org courier config pattern — this
 * adapter never sends them anywhere, and CourierService refuses
 * to save them as a verified connection (see courier.service.ts
 * connect()).
 *
 * Replace this class with a real client ONLY when Paperfly
 * publishes developer documentation or the owner obtains
 * partner API access + documentation (OU6 live-proof item).
 */
export class PaperflyDevAdapterError extends Error {}

export interface PaperflyDevCredentials {
  apiKey?: string;
  apiSecret?: string;
}

export const PAPERFLY_DEV_NOT_LIVE_MESSAGE =
  "Paperfly এখনো লাইভ নয় — এটি একটি Development Adapter: Paperfly তাদের API-র কোনো developer documentation প্রকাশ করেনি (API partner-gated), তাই কোনো বুকিং/যাচাই/ট্র্যাকিং আসল Paperfly দিয়ে হয়নি। Paperfly ডকুমেন্টেশন বা partner API access পাওয়া গেলে এই adapter আসল client দিয়ে বদলানো হবে।";

export class PaperflyDevAdapterClient {
  /** Marker read by the registry/UI: this provider is a
   * development adapter, never a live courier. */
  readonly developmentAdapter = true as const;
  readonly live = false as const;

  constructor(
    private readonly creds: PaperflyDevCredentials = {},
    // Accepted only so the class shape matches the other
    // clients' (creds, fetchFn) construction in specs — the dev
    // adapter NEVER calls it. There is no evidenced Paperfly
    // endpoint to call.
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    void this.creds;
    void this.fetchFn;
  }

  private refuse(): never {
    throw new PaperflyDevAdapterError(PAPERFLY_DEV_NOT_LIVE_MESSAGE);
  }

  /** No verify-before-save exists for Paperfly: there is no
   * documented endpoint to verify credentials against. */
  async verify(): Promise<never> {
    return this.refuse();
  }

  async createOrder(_payload: Record<string, unknown>): Promise<never> {
    return this.refuse();
  }

  async statusByTrackingCode(_trackingCode: string): Promise<never> {
    return this.refuse();
  }

  /** Paperfly exposes NO evidenced balance endpoint in-repo —
   * the balance surface reports "not supported", never a number.
   * This method exists only so an accidental call refuses
   * honestly instead of inventing a figure. */
  async getBalance(): Promise<never> {
    return this.refuse();
  }
}
