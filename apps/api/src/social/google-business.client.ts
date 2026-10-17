import { Injectable, Optional } from "@nestjs/common";

/**
 * OU9 — Google Business Profile (GBP) client: location
 * discovery + LocalPost creation, ONLY in the shapes Google's
 * official documentation defines (cited in
 * docs/one-umbrella-ou9-section.md):
 *
 * - Accounts: GET https://mybusinessaccountmanagement
 *   .googleapis.com/v1/accounts (Account Management API).
 * - Locations: GET https://mybusinessbusinessinformation
 *   .googleapis.com/v1/{account}/locations?readMask=name,title
 *   (Business Information API; readMask is required). A v1
 *   location's `name` is "locations/{id}".
 * - LocalPost create: POST https://mybusiness.googleapis.com
 *   /v4/{parent=accounts/*\/locations/*}/localPosts with a
 *   LocalPost body { languageCode, summary, topicType,
 *   callToAction?, media? } — the v4 Google My Business API is
 *   still the ONLY localPosts surface. The response's `name`
 *   is the created post's resource id and `searchUrl` is its
 *   public link (both output-only).
 *
 * The v4 parent needs the ACCOUNT resource, which the v1
 * location list alone does not carry — so listLocations keeps
 * account + location together and composes the parent
 * ("accounts/{a}/locations/{l}"); that composed parent is what
 * the SocialAccount stores as its externalId.
 *
 * Error discipline (GoogleClient precedent): Google's own
 * error message propagates VERBATIM ({ error: { message } }),
 * with the HTTP status attached. Nothing is logged here and no
 * token ever enters an error or a return value.
 *
 * API-access honesty: every call above needs Google's
 * per-project Business Profile API approval — an unapproved
 * project has a 0 QPM quota and Google refuses the call. This
 * client does not hide that: the refusal propagates verbatim,
 * and the approval GATE (the operator's declaration in
 * platform-config) is enforced by the callers, not here.
 */

export type GbpFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface GbpLocation {
  /** The v4 localPosts parent: "accounts/{a}/locations/{l}". */
  parent: string;
  /** The v1 location resource: "locations/{l}". */
  locationName: string;
  /** The v1 account resource: "accounts/{a}". */
  accountName: string;
  title: string;
  /** The owning account's display name, when Google gave one. */
  accountLabel: string | null;
}

export interface GbpLocalPostInput {
  /** The post body text (LocalPost.summary). */
  summary: string;
  /** BCP-47 language of the post; defaults to "en" — the
   * composer carries no per-post language, so the client never
   * invents a tenant-specific one. */
  languageCode?: string;
  /** The post's link (LocalPost.callToAction, actionType
   * LEARN_MORE — the documented generic website action). */
  linkUrl?: string | null;
  /** At most ONE public image URL in v1 (LocalPost.media[]
   * carries { mediaFormat: "PHOTO", sourceUrl } — sourceUrl
   * is the only supported MediaItem data field for a post). */
  imageUrl?: string | null;
}

export interface GbpCreatedPost {
  /** The created LocalPost resource name (output-only). */
  name: string;
  /** The public search URL Google returned, or null when the
   * response carried none — never fabricated. */
  searchUrl: string | null;
}

const ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const LOCATIONS_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const LOCAL_POSTS_BASE = "https://mybusiness.googleapis.com/v4";
const MAX_ACCOUNTS = 20;
const MAX_LOCATION_PAGES = 3;

@Injectable()
export class GoogleBusinessClient {
  private readonly fetchFn: GbpFetch;

  // @Optional (union boot fix, 2026-10-17): same undecorated-Function-param
  // bug class as TelegramClient/ThreadsClient (nf b6dcc457) — without it
  // Nest cannot resolve the param and any graph containing SocialModule
  // fails to BOOT. Nest passes undefined; the fallback below applies;
  // direct construction in specs passes the fetch explicitly.
  constructor(@Optional() fetchFn?: GbpFetch) {
    this.fetchFn = fetchFn ?? ((url, init) => fetch(url, init as any) as any);
  }

  /** Google's error shape: { error: { message, status } }.
   * The message propagates verbatim; the HTTP status rides
   * along for callers that distinguish refusal kinds. */
  private async parse(res: { ok: boolean; status: number; json: () => Promise<any> }): Promise<any> {
    const json = await res.json().catch(() => null);
    const googleError = json?.error;
    if (googleError || !res.ok || json == null) {
      const message = typeof googleError?.message === "string" && googleError.message
        ? googleError.message
        : `Google Business Profile API error (HTTP ${res.status})`;
      const err = new Error(message) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return json;
  }

  private async get(path: string, accessToken: string): Promise<any> {
    return this.parse(await this.fetchFn(path, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    }));
  }

  /**
   * Every location under every account the token can see,
   * flattened to one pick list (the CC20 GoogleClient
   * listBusinessLocations walk, extended to keep the account
   * resource — the v4 parent cannot be composed without it).
   * A Google refusal (e.g. the API-access gate) propagates
   * verbatim from whichever call Google refused.
   */
  async listLocations(accessToken: string): Promise<GbpLocation[]> {
    const accountsBody: any = await this.get(ACCOUNTS_URL, accessToken);
    const accounts: any[] = Array.isArray(accountsBody?.accounts) ? accountsBody.accounts.slice(0, MAX_ACCOUNTS) : [];
    const out: GbpLocation[] = [];
    for (const account of accounts) {
      const accountName = String(account?.name ?? "");
      if (!accountName) continue;
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_LOCATION_PAGES; page++) {
        const qs = new URLSearchParams({ readMask: "name,title", pageSize: "100" });
        if (pageToken) qs.set("pageToken", pageToken);
        const body: any = await this.get(`${LOCATIONS_BASE}/${accountName}/locations?${qs.toString()}`, accessToken);
        for (const loc of body?.locations ?? []) {
          const locationName = String(loc?.name ?? "");
          if (!locationName) continue;
          out.push({
            parent: `${accountName}/${locationName}`,
            locationName,
            accountName,
            title: String(loc?.title ?? locationName),
            accountLabel: account?.accountName ? String(account.accountName) : null,
          });
        }
        pageToken = body?.nextPageToken ? String(body.nextPageToken) : undefined;
        if (!pageToken) break;
      }
    }
    return out;
  }

  /**
   * Create ONE local post on the location named by `parent`
   * ("accounts/{a}/locations/{l}"). The body is EXACTLY the
   * documented LocalPost create shape for a STANDARD post:
   * languageCode + summary + topicType, the optional
   * callToAction (LEARN_MORE + url) when the post carries a
   * link, and at most one PHOTO media item by sourceUrl.
   * EVENT/OFFER/alert posts need their own documented
   * sub-objects and are NOT built in v1.
   */
  async createLocalPost(accessToken: string, parent: string, input: GbpLocalPostInput): Promise<GbpCreatedPost> {
    const body: Record<string, unknown> = {
      languageCode: input.languageCode || "en",
      summary: input.summary,
      topicType: "STANDARD",
    };
    if (input.linkUrl) {
      body.callToAction = { actionType: "LEARN_MORE", url: input.linkUrl };
    }
    if (input.imageUrl) {
      body.media = [{ mediaFormat: "PHOTO", sourceUrl: input.imageUrl }];
    }
    const json = await this.parse(await this.fetchFn(`${LOCAL_POSTS_BASE}/${parent}/localPosts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    const name = typeof json?.name === "string" ? json.name : "";
    if (!name) throw new Error("Google Business Profile পোস্ট তৈরি হয়েছে কিন্তু কোনো Post ID পাওয়া যায়নি।");
    return {
      name,
      searchUrl: typeof json?.searchUrl === "string" && json.searchUrl ? json.searchUrl : null,
    };
  }
}
