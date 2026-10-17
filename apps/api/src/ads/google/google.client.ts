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

  /** Light-weight connectivity check: fetch the customer resource.
   * The same resource genuinely carries `status` (CustomerStatus)
   * and `timeZone`; both are returned verbatim when present and
   * left undefined when Google does not send them (AD3). */
  async verifyCustomer(customerId: string): Promise<{ id: string; descriptiveName?: string; currencyCode?: string; status?: string; timeZone?: string }> {
    const token = await this.getAccessToken();
    const id = customerId.replace(/-/g, "");
    const res = await this.fetchFn(`https://googleads.googleapis.com/${this.version}/customers/${id}`, {
      headers: this.headers(token),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Google Ads customer check failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    return {
      id: String(body.id ?? id), descriptiveName: body.descriptiveName, currencyCode: body.currencyCode,
      status: body.status ? String(body.status) : undefined,
      timeZone: body.timeZone ? String(body.timeZone) : undefined,
    };
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

  /** OU4 management companion (status/lifecycle/Customer Match),
   * sharing this client's secrets, fetch and OAuth token cache. */
  campaignManage(): GoogleCampaignManage {
    return new GoogleCampaignManage(this.secrets, this.fetchFn, this.version, () => this.getAccessToken());
  }
}

export interface GoogleCampaignStatus {
  campaignExternalId: string;
  name?: string;
  /** Verbatim Google enum: ENABLED | PAUSED | REMOVED (or whatever Google sends). */
  status: string;
}

/**
 * OU4: campaign status read + lifecycle mutate + Customer Match.
 * Same auth/header discipline as the reporting paths above; Google's
 * own errors surface verbatim. Status changes use the documented
 * campaigns:mutate update operation with an explicit updateMask —
 * nothing is reported changed unless Google accepts the mutate.
 */
export class GoogleCampaignManage {
  constructor(
    private readonly secrets: GoogleAdsSecrets,
    private readonly fetchFn: FetchFn,
    private readonly version: string,
    private readonly tokenProvider: () => Promise<string>,
  ) {}

  private async headers(): Promise<Record<string, string>> {
    const token = await this.tokenProvider();
    return {
      Authorization: `Bearer ${token}`,
      "developer-token": this.secrets.developerToken,
      "Content-Type": "application/json",
      ...(this.secrets.loginCustomerId ? { "login-customer-id": this.secrets.loginCustomerId.replace(/-/g, "") } : {}),
    };
  }

  async getCampaignStatus(customerId: string, campaignId: string): Promise<GoogleCampaignStatus | null> {
    const id = customerId.replace(/-/g, "");
    const query = `SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.id = ${campaignId}`;
    const res = await this.fetchFn(`https://googleads.googleapis.com/${this.version}/customers/${id}/googleAds:search`, {
      method: "POST", headers: await this.headers(), body: JSON.stringify({ query }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = body?.error?.details?.[0]?.errors?.[0]?.message ?? body?.error?.message ?? "unknown error";
      throw new Error(`Google Ads campaign status failed (${res.status}): ${detail}`);
    }
    const row = body.results?.[0];
    if (!row) return null;
    return { campaignExternalId: String(row.campaign?.id ?? campaignId), name: row.campaign?.name ?? undefined, status: String(row.campaign?.status ?? "") };
  }

  async setCampaignStatus(customerId: string, campaignId: string, status: "ENABLED" | "PAUSED"): Promise<void> {
    const id = customerId.replace(/-/g, "");
    const resourceName = `customers/${id}/campaigns/${campaignId}`;
    const res = await this.fetchFn(`https://googleads.googleapis.com/${this.version}/customers/${id}/campaigns:mutate`, {
      method: "POST", headers: await this.headers(),
      body: JSON.stringify({ operations: [{ update: { resourceName, status }, updateMask: "status" }] }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      throw new Error(`Google Ads campaign status change failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    }
    if (!body.results?.[0]?.resourceName) throw new Error("Google returned no result for the status change; the change is NOT confirmed");
  }

  /** Create an empty CRM-based (Customer Match) user list. */
  async createCustomerMatchList(customerId: string, name: string, description?: string): Promise<{ resourceName: string; userListId: string }> {
    const id = customerId.replace(/-/g, "");
    const res = await this.fetchFn(`https://googleads.googleapis.com/${this.version}/customers/${id}/userLists:mutate`, {
      method: "POST", headers: await this.headers(),
      body: JSON.stringify({ operations: [{ create: {
        name, description: description ?? "Built by Qosprey AI Marketing SaaS (Customer Match)",
        crmBasedUserList: { uploadKeyType: "CONTACT_INFO", dataSourceType: "DATA_SOURCE_TYPE_FIRST_PARTY" },
      } }] }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) throw new Error(`Google Customer Match list creation failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    const resourceName = body.results?.[0]?.resourceName as string | undefined;
    if (!resourceName) throw new Error("Google returned no user list resource name; creation is NOT confirmed");
    return { resourceName, userListId: resourceName.split("/").pop() as string };
  }

  /**
   * Upload hashed identifiers to a Customer Match list through an
   * OfflineUserDataJob: create → addOperations (chunks of 5,000
   * users, Google's recommended size) → run. Identifiers arrive
   * ALREADY SHA-256 hashed (the audiences service's contactsFor
   * output — the same hashes Meta receives); raw contacts never
   * enter this client. The job resource name is returned as the
   * provider receipt; Google processes asynchronously afterwards.
   */
  async uploadCustomerMatch(customerId: string, userListResourceName: string, identifiers: { hashedEmail?: string; hashedPhone?: string }[]): Promise<{ jobResourceName: string; operations: number }> {
    const id = customerId.replace(/-/g, "");
    const headers = await this.headers();
    const jobRes = await this.fetchFn(`https://googleads.googleapis.com/${this.version}/customers/${id}/offlineUserDataJobs`, {
      method: "POST", headers,
      body: JSON.stringify({ type: "CUSTOMER_MATCH_USER_LIST", customerMatchUserListMetadata: { userList: userListResourceName } }),
    });
    const jobBody: any = await jobRes.json().catch(() => ({}));
    if (!jobRes.ok || jobBody?.error) throw new Error(`Google offline job creation failed (${jobRes.status}): ${jobBody?.error?.message ?? "unknown error"}`);
    const jobResourceName = jobBody.resourceName as string | undefined;
    if (!jobResourceName) throw new Error("Google returned no offline job resource name; upload is NOT confirmed");
    let operations = 0;
    for (let i = 0; i < identifiers.length; i += 5000) {
      const chunk = identifiers.slice(i, i + 5000);
      const ops = chunk.map((u) => ({ create: { userIdentifiers: [
        ...(u.hashedEmail ? [{ hashedEmail: u.hashedEmail }] : []),
        ...(u.hashedPhone ? [{ hashedPhoneNumber: u.hashedPhone }] : []),
      ] } }));
      const addRes = await this.fetchFn(`https://googleads.googleapis.com/${this.version}/${jobResourceName}:addOperations`, {
        method: "POST", headers, body: JSON.stringify({ operations: ops }),
      });
      const addBody: any = await addRes.json().catch(() => ({}));
      if (!addRes.ok || addBody?.error) throw new Error(`Google offline job addOperations failed (${addRes.status}): ${addBody?.error?.message ?? "unknown error"}`);
      operations += ops.length;
    }
    const runRes = await this.fetchFn(`https://googleads.googleapis.com/${this.version}/${jobResourceName}:run`, {
      method: "POST", headers, body: JSON.stringify({}),
    });
    const runBody: any = await runRes.json().catch(() => ({}));
    if (!runRes.ok || runBody?.error) throw new Error(`Google offline job run failed (${runRes.status}): ${runBody?.error?.message ?? "unknown error"}`);
    return { jobResourceName, operations };
  }

  /** Provider-reported list info (GAQL on user_list). size_for_display
   * is Google's display range string — returned verbatim; a plain
   * numeric value is also parsed for approximateCount when present. */
  async getUserList(customerId: string, userListId: string): Promise<{ name?: string; sizeForDisplay?: string; approximateCount: number | null }> {
    const id = customerId.replace(/-/g, "");
    const query = `SELECT user_list.id, user_list.name, user_list.size_for_display FROM user_list WHERE user_list.id = ${userListId}`;
    const res = await this.fetchFn(`https://googleads.googleapis.com/${this.version}/customers/${id}/googleAds:search`, {
      method: "POST", headers: await this.headers(), body: JSON.stringify({ query }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Google user list read failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
    const row = body.results?.[0]?.userList;
    if (!row) throw new Error("Google returned no such user list");
    const size = row.sizeForDisplay != null ? String(row.sizeForDisplay) : undefined;
    const parsed = size && /^\d+$/.test(size.replace(/,/g, "")) ? Number(size.replace(/,/g, "")) : null;
    return { name: row.name ?? undefined, sizeForDisplay: size, approximateCount: parsed };
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
