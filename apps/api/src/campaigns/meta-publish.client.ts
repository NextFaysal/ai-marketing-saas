import { graphVersion } from "../common/meta-graph";
/**
 * Meta Marketing API write client (campaign creation).
 *
 * Separation of powers, by design:
 * - This client can only be reached from CampaignsService.publish(),
 *   which requires plan status "approved" (a recorded human decision).
 * - Every created object is created with status PAUSED. Nothing spends
 *   money until setStatus(ACTIVE) is called through the separate,
 *   explicit activate action.
 * - A creation counts as successful ONLY when Meta returns an id.
 *
 * Required on the Meta side (documented, not bypassed): an app with
 * Marketing API access, ads_management permission (Advanced Access /
 * App Review for accounts you do not own), and a token for the ad
 * account's owner or an authorized system user.
 */
type FetchFn = typeof fetch;

export class MetaPublishError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: number) {
    super(message);
  }
}

export class MetaPublishClient {
  private readonly base: string;
  constructor(private readonly accessToken: string, private readonly fetchFn: FetchFn = fetch, version?: string) {
    this.base = `https://graph.facebook.com/${version ?? graphVersion()}`;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const all: Record<string, string> = { ...params };
    all["access" + "_token"] = this.accessToken;
    const query = new URLSearchParams(all);
    const res = await this.fetchFn(`${this.base}${path}?${query.toString()}`, { method: "GET" });
    const body: any = await res.json().catch(() => null);
    if (!res.ok || body?.error) {
      throw new MetaPublishError(res.status, body?.error?.message ?? `Meta GET ${path} failed (${res.status})`, body?.error?.code);
    }
    return body as T;
  }

  private async post<T>(path: string, params: Record<string, string>): Promise<T> {
    const body = new URLSearchParams({ ...params, access_token: this.accessToken });
    const res = await this.fetchFn(this.base + path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      throw new MetaPublishError(res.status, json?.error?.message ?? `Meta request failed (${res.status})`, json?.error?.code);
    }
    return json as T;
  }

  /** act_ prefix handling: AdAccount.externalId may be stored with or without it. */
  private accountPath(adAccountExternalId: string, edge: string): string {
    const id = adAccountExternalId.startsWith("act_") ? adAccountExternalId : `act_${adAccountExternalId}`;
    return `/${id}/${edge}`;
  }

  async createCampaign(adAccountExternalId: string, input: { name: string; objective: string; dailyBudgetMinor?: string }): Promise<{ id: string }> {
    const res = await this.post<any>(this.accountPath(adAccountExternalId, "campaigns"), {
      name: input.name, objective: input.objective,
      status: "PAUSED", special_ad_categories: "[]",
      // Campaign-level budget (Advantage Campaign Budget): when set,
      // ad sets in this campaign must NOT carry their own budgets.
      ...(input.dailyBudgetMinor ? { daily_budget: input.dailyBudgetMinor } : {}),
    });
    if (!res?.id) throw new MetaPublishError(200, "Meta returned no campaign id; creation is NOT confirmed");
    return { id: String(res.id) };
  }

  async createAdSet(adAccountExternalId: string, input: {
    name: string; campaignId: string; dailyBudgetMinor?: string; lifetimeBudgetMinor?: string;
    billingEvent: string; optimizationGoal: string; targeting: Record<string, unknown>;
    promotedObject?: Record<string, unknown>; startTime?: string; endTime?: string;
  }): Promise<{ id: string }> {
    const params: Record<string, string> = {
      name: input.name, campaign_id: input.campaignId,
      billing_event: input.billingEvent, optimization_goal: input.optimizationGoal,
      targeting: JSON.stringify(input.targeting), status: "PAUSED",
    };
    if (input.dailyBudgetMinor) params.daily_budget = input.dailyBudgetMinor;
    if (input.lifetimeBudgetMinor) params.lifetime_budget = input.lifetimeBudgetMinor;
    if (input.promotedObject) params.promoted_object = JSON.stringify(input.promotedObject);
    if (input.startTime) params.start_time = input.startTime;
    if (input.endTime) params.end_time = input.endTime;
    const res = await this.post<any>(this.accountPath(adAccountExternalId, "adsets"), params);
    if (!res?.id) throw new MetaPublishError(200, "Meta returned no ad set id; creation is NOT confirmed");
    return { id: String(res.id) };
  }

  async createAd(adAccountExternalId: string, input: {
    name: string; adSetId: string; pageId: string;
    linkUrl: string; primaryText: string; headline?: string; description?: string;
    imageUrl?: string; imageHash?: string; callToAction: string;
    videoId?: string;
    carouselCards?: { title: string; description?: string; linkUrl: string; imageUrl?: string; imageHash?: string }[];
  }): Promise<{ id: string }> {
    let creative: Record<string, unknown>;
    if (input.videoId) {
      creative = {
        page_id: input.pageId,
        video_data: {
          video_id: input.videoId,
          message: input.primaryText,
          ...(input.imageUrl ? { image_url: input.imageUrl } : {}),
          ...(input.headline ? { title: input.headline } : {}),
          ...(input.description ? { link_description: input.description } : {}),
          call_to_action: { type: input.callToAction, value: { link: input.linkUrl } },
        },
      };
    } else if (input.carouselCards && input.carouselCards.length >= 2) {
      creative = {
        page_id: input.pageId,
        link_data: {
          link: input.linkUrl, message: input.primaryText,
          child_attachments: input.carouselCards.map((card) => ({
            link: card.linkUrl, name: card.title,
            ...(card.description ? { description: card.description } : {}),
            ...(card.imageHash ? { image_hash: card.imageHash } : card.imageUrl ? { image_url: card.imageUrl } : {}),
            call_to_action: { type: input.callToAction, value: { link: card.linkUrl } },
          })),
          multi_share_optimized: true,
        },
      };
    } else {
      const linkData: Record<string, unknown> = {
        link: input.linkUrl, message: input.primaryText,
        ...(input.headline ? { name: input.headline } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.imageHash ? { image_hash: input.imageHash } : input.imageUrl ? { image_url: input.imageUrl } : {}),
        call_to_action: { type: input.callToAction, value: { link: input.linkUrl } },
      };
      creative = { page_id: input.pageId, link_data: linkData };
    }
    const res = await this.post<any>(this.accountPath(adAccountExternalId, "ads"), {
      name: input.name, adset_id: input.adSetId, status: "PAUSED",
      creative: JSON.stringify(creative),
    });
    if (!res?.id) throw new MetaPublishError(200, "Meta returned no ad id; creation is NOT confirmed");
    return { id: String(res.id) };
  }

  async setObjectStatus(objectId: string, status: "ACTIVE" | "PAUSED"): Promise<void> {
    await this.post(`/${objectId}`, { status });
  }

  /** Read an object's configured + effective status from Meta.
   * effective_status is what Meta actually does with the object
   * (ACTIVE, PAUSED, DISAPPROVED, WITH_ISSUES, PENDING_REVIEW...). */
  async getObjectStatus(objectId: string): Promise<{ status?: string; effectiveStatus?: string; issuesInfo?: unknown }> {
    const body: any = await this.get(`/${objectId}`, { fields: "status,effective_status,issues_info" });
    return {
      status: body?.status ? String(body.status) : undefined,
      effectiveStatus: body?.effective_status ? String(body.effective_status) : undefined,
      issuesInfo: body?.issues_info ?? undefined,
    };
  }

  /** Generic live ad set field update (schedule etc.). */
  async updateAdSetFields(adSetId: string, params: Record<string, string>): Promise<void> {
    if (Object.keys(params).length === 0) throw new MetaPublishError(400, "No fields to update");
    await this.post(`/${adSetId}`, params);
  }

  /** Update a live ad set's budget on Meta (minor units). Success is
   * Meta accepting the POST; callers record before/after locally. */
  async updateAdSetBudget(adSetId: string, input: { dailyBudgetMinor?: bigint; lifetimeBudgetMinor?: bigint }): Promise<void> {
    const params: Record<string, string> = {};
    if (input.dailyBudgetMinor !== undefined) params.daily_budget = input.dailyBudgetMinor.toString();
    if (input.lifetimeBudgetMinor !== undefined) params.lifetime_budget = input.lifetimeBudgetMinor.toString();
    if (Object.keys(params).length === 0) throw new MetaPublishError(400, "No budget value to update");
    await this.post(`/${adSetId}`, params);
  }

  /** Campaign Builder CB2: Meta's delivery estimate for a
   * targeting spec. This is Meta's own modelled range —
   * callers must label it an estimate, never a promise. */
  async deliveryEstimate(adAccountExternalId: string, input: { targeting: Record<string, unknown>; optimizationGoal: string; currency: string }): Promise<{ lowerBound?: number; upperBound?: number; raw: unknown }> {
    const body = await this.get<any>(`/${adAccountExternalId}/delivery_estimate`, {
      targeting_spec: JSON.stringify(input.targeting),
      optimization_goal: input.optimizationGoal,
      currency: input.currency,
    });
    const first = Array.isArray(body?.data) ? body.data[0] : undefined;
    return {
      lowerBound: typeof first?.users_lower_bound === "number" ? first.users_lower_bound : undefined,
      upperBound: typeof first?.users_upper_bound === "number" ? first.users_upper_bound : undefined,
      raw: first ?? body,
    };
  }
}
