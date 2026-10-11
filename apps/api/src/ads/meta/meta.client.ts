export class MetaApiError extends Error {
  constructor(public status: number, message: string, public code?: number) { super(message); }
}

type FetchFn = typeof fetch;

/**
 * Meta Marketing API (Graph API) client.
 * Version is configurable via META_GRAPH_VERSION because Meta deprecates
 * versions on a schedule; default is pinned in code, not guessed per call.
 * The access token is sent as a query parameter, which is Meta's standard
 * for server-side Graph calls; it is never logged by this client.
 *
 * Required Meta app setup (by the platform owner, not this code):
 * a Meta app with Marketing API, ads_read permission (Advanced Access /
 * App Review for accounts the app user does not own), and a long-lived
 * user or system-user token.
 */
export class MetaClient {
  private readonly base: string;
  constructor(private readonly accessToken: string, private readonly fetchFn: FetchFn = fetch, version?: string) {
    this.base = `https://graph.facebook.com/${version ?? process.env.META_GRAPH_VERSION ?? "v21.0"}`;
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", this.accessToken);
    const res = await this.fetchFn(url.toString());
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      throw new MetaApiError(res.status, body?.error?.message ?? `Meta request failed (${res.status})`, body?.error?.code);
    }
    return body as T;
  }

  async verifyToken(): Promise<{ id: string; name?: string }> {
    const me = await this.get<any>("/me", { fields: "id,name" });
    return { id: String(me.id), name: me.name };
  }

  async listAdAccounts(): Promise<{ externalId: string; name: string; currency: string; status: number; timezone: string | null }[]> {
    const out: any[] = [];
    let next: string | null = null;
    let first = true;
    while (first || next) {
      first = false;
      const page: any = next
        ? await this.getAbsolute(next)
        : await this.get<any>("/me/adaccounts", { fields: "id,name,currency,account_status,timezone_name", limit: "100" });
      for (const a of page.data ?? []) {
        out.push({ externalId: String(a.id), name: String(a.name ?? a.id), currency: a.currency ?? "BDT", status: Number(a.account_status ?? 1), timezone: a.timezone_name ? String(a.timezone_name) : null });
      }
      next = page.paging?.next ?? null;
      if (next && !next.startsWith("https://graph.facebook.com/")) next = null; // never follow foreign URLs
    }
    return out;
  }

  /**
   * SP1: list the Pages this token can act on, with each Page's
   * linked Instagram business account. IMPORTANT: the per-page
   * `access_token` in the /me/accounts response IS the Page access
   * token (not the user token the client was constructed with) —
   * posting to a Page requires the Page token, so callers seal THAT
   * value as the credential at connect time.
   */
  async listPages(): Promise<{ pageId: string; name: string; pageAccessToken: string; pictureUrl: string | null; instagram: { externalId: string; username: string | null; pictureUrl: string | null } | null }[]> {
    const out: { pageId: string; name: string; pageAccessToken: string; pictureUrl: string | null; instagram: { externalId: string; username: string | null; pictureUrl: string | null } | null }[] = [];
    let next: string | null = null;
    let first = true;
    while (first || next) {
      first = false;
      const page: any = next
        ? await this.getAbsolute(next)
        : await this.get<any>("/me/accounts", { fields: "id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}", limit: "100" });
      for (const p of page.data ?? []) {
        const ig = p.instagram_business_account;
        out.push({
          pageId: String(p.id),
          name: String(p.name ?? p.id),
          pageAccessToken: String(p.access_token ?? ""),
          pictureUrl: p.picture?.url ? String(p.picture.url) : null,
          instagram: ig
            ? {
                externalId: String(ig.id),
                username: ig.username ? String(ig.username) : null,
                pictureUrl: ig.profile_picture_url ? String(ig.profile_picture_url) : null,
              }
            : null,
        });
      }
      next = page.paging?.next ?? null;
      if (next && !next.startsWith("https://graph.facebook.com/")) next = null; // never follow foreign URLs
    }
    return out;
  }

  private async getAbsolute(url: string): Promise<any> {
    const res = await this.fetchFn(url);
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) throw new MetaApiError(res.status, body?.error?.message ?? "Meta request failed");
    return body;
  }

  async getCampaignInsights(adAccountId: string, since: string, until: string): Promise<any[]> {
    const rows: any[] = [];
    let next: string | null = null;
    let first = true;
    while (first || next) {
      first = false;
      const page: any = next
        ? await this.getAbsolute(next)
        : await this.get<any>(`/${adAccountId}/insights`, {
            level: "campaign",
            time_increment: "1",
            time_range: JSON.stringify({ since, until }),
            fields: "campaign_id,campaign_name,spend,impressions,clicks,reach,actions,action_values,date_start",
            limit: "500",
          });
      rows.push(...(page.data ?? []));
      next = page.paging?.next ?? null;
      if (next && !next.startsWith("https://graph.facebook.com/")) next = null;
    }
    return rows;
  }

  async getAdInsights(adAccountId: string, since: string, until: string): Promise<any[]> {
    const rows: any[] = [];
    let next: string | null = null;
    let first = true;
    while (first || next) {
      first = false;
      const page: any = next
        ? await this.getAbsolute(next)
        : await this.get<any>(`/${adAccountId}/insights`, {
            level: "ad",
            time_increment: "1",
            time_range: JSON.stringify({ since, until }),
            fields: "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,reach,actions,action_values,date_start",
            limit: "500",
          });
      rows.push(...(page.data ?? []));
      next = page.paging?.next ?? null;
      if (next && !next.startsWith("https://graph.facebook.com/")) next = null;
    }
    return rows;
  }

  async getBreakdownInsights(adAccountId: string, since: string, until: string, breakdowns: string): Promise<any[]> {
    const rows: any[] = [];
    let next: string | null = null;
    let first = true;
    while (first || next) {
      first = false;
      const page: any = next
        ? await this.getAbsolute(next)
        : await this.get<any>(`/${adAccountId}/insights`, {
            level: "campaign",
            time_increment: "1",
            time_range: JSON.stringify({ since, until }),
            breakdowns,
            fields: "campaign_id,spend,impressions,clicks,actions,date_start",
            limit: "500",
          });
      rows.push(...(page.data ?? []));
      next = page.paging?.next ?? null;
      if (next && !next.startsWith("https://graph.facebook.com/")) next = null;
    }
    return rows;
  }
}
