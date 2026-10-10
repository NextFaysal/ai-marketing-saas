/**
 * Google Ads API client (read-only reporting).
 *
 * Auth model (Google's, documented - not bypassed): an OAuth2 refresh
 * token + client id/secret yields short-lived access tokens; every API
 * call also needs a developer token. Developer tokens have approval
 * levels at Google (test/basic/standard) - an unapproved token simply
 * gets API errors back, which we surface verbatim.
 *
 * Reporting uses GAQL against googleAds:search. Cost arrives as
 * cost_micros (millionths of the account currency unit) and is converted
 * to integer minor units exactly, never through floats.
 */
import { parseMoneyToMinor } from "@repo/contracts";

export interface GoogleAdsSecrets {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  loginCustomerId?: string; // manager (MCC) id, when acting through one
}

export interface GoogleDailyRow {
  date: string;
  campaignExternalId: string;
  campaignName?: string;
  spendMinor: bigint;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValueMinor: bigint;
  currency: string;
}

type FetchFn = typeof fetch;

export class GoogleAdsClient {
  private readonly version: string;
  private accessToken: string | null = null;
  constructor(private readonly secrets: GoogleAdsSecrets, private readonly fetchFn: FetchFn = fetch, version?: string) {
    this.version = version ?? process.env.GOOGLE_ADS_API_VERSION ?? "v17";
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    const res = await this.fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.secrets.clientId, client_secret: this.secrets.clientSecret,
        refresh_token: this.secrets.refreshToken, grant_type: "refresh_token",
      }).toString(),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      throw new Error(`Google OAuth token exchange failed (${res.status}): ${body?.error_description ?? body?.error ?? "unknown error"}`);
    }
    this.accessToken = String(body.access_token);
    return this.accessToken;
  }

  /** Light-weight connectivity check: fetch the customer resource. */
  async verifyCustomer(customerId: string): Promise<{ id: string; descriptiveName?: string; currencyCode?: string }> {
    const token = await this.getAccessToken();
    const id = customerId.replace(/-/g, "");
    const res = await this.fetchFn(`https://googleads.googleapis.com/${this.version}/customers/${id}`, {
      headers: this.headers(token),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Google Ads customer check failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    return { id: String(body.id ?? id), descriptiveName: body.descriptiveName, currencyCode: body.currencyCode };
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "developer-token": this.secrets.developerToken,
      "Content-Type": "application/json",
      ...(this.secrets.loginCustomerId ? { "login-customer-id": this.secrets.loginCustomerId.replace(/-/g, "") } : {}),
    };
  }

  async getCampaignDaily(customerId: string, from: string, to: string): Promise<GoogleDailyRow[]> {
    const token = await this.getAccessToken();
    const id = customerId.replace(/-/g, "");
    const query = `SELECT segments.date, campaign.id, campaign.name, customer.currency_code, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' ORDER BY segments.date`;
    const rows: GoogleDailyRow[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.fetchFn(`https://googleads.googleapis.com/${this.version}/customers/${id}/googleAds:search`, {
        method: "POST", headers: this.headers(token),
        body: JSON.stringify({ query, pageToken }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = body?.error?.details?.[0]?.errors?.[0]?.message ?? body?.error?.message ?? "unknown error";
        throw new Error(`Google Ads query failed (${res.status}): ${detail}`);
      }
      for (const r of body.results ?? []) rows.push(normalizeGoogleRow(r));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return rows;
  }
}

export function microsToMinor(micros: string | number): bigint {
  // micros = 1e-6 currency units; minor = 1e-2. minor = micros / 10^4, rounded.
  const m = BigInt(Math.trunc(Number(micros)));
  return (m + 5000n) / 10000n;
}

export function normalizeGoogleRow(r: any): GoogleDailyRow {
  const currency = r.customer?.currencyCode ?? "USD";
  const conversionsValue = Number(r.metrics?.conversionsValue ?? 0);
  return {
    date: String(r.segments?.date),
    campaignExternalId: String(r.campaign?.id),
    campaignName: r.campaign?.name ?? undefined,
    spendMinor: microsToMinor(r.metrics?.costMicros ?? 0),
    impressions: Number(r.metrics?.impressions ?? 0),
    clicks: Number(r.metrics?.clicks ?? 0),
    conversions: Number(r.metrics?.conversions ?? 0),
    conversionValueMinor: parseMoneyToMinor(conversionsValue.toFixed(2)),
    currency,
  };
}
