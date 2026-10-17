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

  async createCampaign(adAccountExternalId: string, input: { name: string; objective: string; dailyBudgetMinor?: string; lifetimeBudgetMinor?: string; bidStrategy?: string; bidAmountMinor?: string; bidConstraints?: Record<string, unknown>; isAdsetBudgetSharingEnabled?: boolean }): Promise<{ id: string }> {
    const res = await this.post<any>(this.accountPath(adAccountExternalId, "campaigns"), {
      name: input.name, objective: input.objective,
      status: "PAUSED", special_ad_categories: "[]",
      // Campaign-level budget (Advantage Campaign Budget): when set,
      // ad sets in this campaign must NOT carry their own budgets.
      ...(input.dailyBudgetMinor ? { daily_budget: input.dailyBudgetMinor } : {}),
      ...(input.lifetimeBudgetMinor ? { lifetime_budget: input.lifetimeBudgetMinor } : {}),
      // CA23: the Advantage+ budget lever. Meta's unified
      // Advantage+ guide requires the campaign budget to ride
      // a SUPPORTED bid_strategy at campaign level; the bid
      // amount / ROAS constraints move up with it. Sent only
      // when the caller derived them (Advantage+ plans).
      ...(input.bidStrategy ? { bid_strategy: input.bidStrategy } : {}),
      ...(input.bidAmountMinor ? { bid_amount: input.bidAmountMinor } : {}),
      ...(input.bidConstraints ? { bid_constraints: JSON.stringify(input.bidConstraints) } : {}),
      ...(input.isAdsetBudgetSharingEnabled !== undefined ? { is_adset_budget_sharing_enabled: input.isAdsetBudgetSharingEnabled ? "true" : "false" } : {}),
    });
    if (!res?.id) throw new MetaPublishError(200, "Meta returned no campaign id; creation is NOT confirmed");
    return { id: String(res.id) };
  }

  /** CA23: Meta's own verdict on whether a campaign IS an
   * Advantage+ campaign — GET /{campaign}?fields=
   * advantage_state_info,smart_promotion_type. There is no
   * settable "make it Advantage+" field in the current API:
   * the state follows from the budget/audience/placement
   * levers, and this read-back is the only confirmation.
   * A failed read returns null (unconfirmed), never a guess. */
  async getCampaignAdvantageState(campaignId: string): Promise<{
    advantageState?: string; budgetState?: string; audienceState?: string; placementState?: string;
    smartPromotionType?: string; raw: unknown;
  } | null> {
    try {
      const body: any = await this.get(`/${campaignId}`, { fields: "advantage_state_info,smart_promotion_type" });
      const info = body?.advantage_state_info ?? null;
      if (!info && !body?.smart_promotion_type) return null;
      return {
        advantageState: info?.advantage_state ? String(info.advantage_state) : undefined,
        budgetState: info?.advantage_budget_state ? String(info.advantage_budget_state) : undefined,
        audienceState: info?.advantage_audience_state ? String(info.advantage_audience_state) : undefined,
        placementState: info?.advantage_placement_state ? String(info.advantage_placement_state) : undefined,
        smartPromotionType: body?.smart_promotion_type ? String(body.smart_promotion_type) : undefined,
        raw: info ?? body,
      };
    } catch {
      return null;
    }
  }

  async createAdSet(adAccountExternalId: string, input: {
    name: string; campaignId: string; dailyBudgetMinor?: string; lifetimeBudgetMinor?: string;
    billingEvent: string; optimizationGoal: string; targeting: Record<string, unknown>;
    promotedObject?: Record<string, unknown>; startTime?: string; endTime?: string;
    // CN2: bidding (Meta field names per the Ad Set
    // reference: bid_strategy enum, bid_amount in minor
    // units, bid_constraints.roas_average_floor).
    bidStrategy?: string; bidAmountMinor?: string; bidConstraints?: Record<string, unknown>;
    // CN4: lead ad sets with an Instant Form carry
    // destination_type ON_AD (Meta's lead ads guide).
    destinationType?: string;
  }): Promise<{ id: string }> {
    const params: Record<string, string> = {
      name: input.name, campaign_id: input.campaignId,
      billing_event: input.billingEvent, optimization_goal: input.optimizationGoal,
      targeting: JSON.stringify(input.targeting), status: "PAUSED",
    };
    if (input.destinationType) params.destination_type = input.destinationType;
    if (input.dailyBudgetMinor) params.daily_budget = input.dailyBudgetMinor;
    if (input.lifetimeBudgetMinor) params.lifetime_budget = input.lifetimeBudgetMinor;
    if (input.bidStrategy) params.bid_strategy = input.bidStrategy;
    if (input.bidAmountMinor) params.bid_amount = input.bidAmountMinor;
    if (input.bidConstraints) params.bid_constraints = JSON.stringify(input.bidConstraints);
    if (input.promotedObject) params.promoted_object = JSON.stringify(input.promotedObject);
    if (input.startTime) params.start_time = input.startTime;
    if (input.endTime) params.end_time = input.endTime;
    const res = await this.post<any>(this.accountPath(adAccountExternalId, "adsets"), params);
    if (!res?.id) throw new MetaPublishError(200, "Meta returned no ad set id; creation is NOT confirmed");
    return { id: String(res.id) };
  }

  /** Frontier CN13 (NB6): the CTWA page_welcome_message
   *  (Meta's Click-to-WhatsApp guide: a VISUAL_EDITOR v2
   *  block on the creative's link_data). Two documented
   *  shapes only: ice_breakers (greeting text + up to 3
   *  ice-breaker titles) when ice breakers are present —
   *  the prefill message is NOT part of that documented
   *  shape and is not sent with it — otherwise
   *  autofill_message (greeting text + the pre-filled
   *  message the customer's WhatsApp opens with). Returns
   *  undefined when nothing was authored. */
  static buildPageWelcomeMessage(welcome?: { greetingText?: string; prefillMessage?: string; iceBreakers?: string[] } | null): Record<string, unknown> | undefined {
    if (!welcome) return undefined;
    const greeting = welcome.greetingText?.trim() || undefined;
    const prefill = welcome.prefillMessage?.trim() || undefined;
    const ice = (welcome.iceBreakers ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 3);
    if (!greeting && !prefill && !ice.length) return undefined;
    if (ice.length) {
      return {
        type: "VISUAL_EDITOR", version: 2, landing_screen_type: "welcome_message", media_type: "text",
        text_format: { customer_action_type: "ice_breakers", message: { ...(greeting ? { text: greeting } : {}), ice_breakers: ice.map((title) => ({ title })) } },
      };
    }
    return {
      type: "VISUAL_EDITOR", version: 2, landing_screen_type: "welcome_message", media_type: "text",
      text_format: { customer_action_type: "autofill_message", message: { ...(greeting ? { text: greeting } : {}), ...(prefill ? { autofill_message: { content: prefill } } : {}) } },
    };
  }

  /** CN13: read a WhatsApp phone-number node back from
   *  Meta (display digits + verified name) with the
   *  number's own messaging token. Used at ad-set save
   *  time so the stored whatsapp_phone_number is Meta's
   *  own read-back of the CONNECTED number — never typed
   *  in, never guessed. Callers treat a failure as "digits
   *  unknown" (the field is optional in promoted_object). */
  async getWhatsAppPhoneNumber(phoneNumberId: string): Promise<{ displayPhoneNumber?: string; verifiedName?: string }> {
    const body: any = await this.get(`/${phoneNumberId}`, { fields: "display_phone_number,verified_name" });
    return {
      displayPhoneNumber: body?.display_phone_number ? String(body.display_phone_number) : undefined,
      verifiedName: body?.verified_name ? String(body.verified_name) : undefined,
    };
  }

  /** CN4: create an Instant Form on a Page
   *  (POST /{pageId}/leadgen_forms — Meta's Lead Ads guide).
   *  The payload is built by CampaignsService
   *  (buildLeadFormPayload). Counts as created ONLY with
   *  Meta's returned form id. */
  async createLeadForm(pageId: string, payload: Record<string, string>): Promise<{ id: string }> {
    const res = await this.post<any>(`/${pageId}/leadgen_forms`, payload);
    if (!res?.id) throw new MetaPublishError(200, "Meta returned no lead form id; creation is NOT confirmed");
    return { id: String(res.id) };
  }

  /** CN5: stored enhancement toggles -> Meta's
   *  degrees_of_freedom_spec. Only explicitly-set features
   *  are sent (unset = Meta default, never an invented
   *  OPT_OUT). Per Meta's Advantage creative docs (v22+),
   *  enrollment is per feature via creative_features_spec,
   *  each { enroll_status: OPT_IN | OPT_OUT }. */
  static enhancementsToDof(enhancements?: Record<string, boolean> | null): Record<string, unknown> | undefined {
    const entries = Object.entries(enhancements ?? {}).filter(([, v]) => typeof v === "boolean");
    if (!entries.length) return undefined;
    const spec: Record<string, unknown> = {};
    for (const [k, v] of entries) spec[k] = { enroll_status: v ? "OPT_IN" : "OPT_OUT" };
    return { creative_features_spec: spec };
  }

  /** CN5: the asset-feed creative (Meta's documented
   *  asset_feed_spec). Used when an ad carries MULTIPLE
   *  text options (Meta rotates combinations —
   *  optimization_type DEGREES_OF_FREEDOM) and/or
   *  PLACEMENT asset overrides (labelled assets +
   *  asset_customization_rules, optimization_type
   *  PLACEMENT, with a final empty-spec fallback rule to
   *  the base asset, the documented pattern). Returns null
   *  when neither applies so the caller keeps the legacy
   *  object_story_spec paths byte-identical. */
  static buildAssetFeedCreative(input: {
    pageId: string; linkUrl: string; callToAction: string;
    primaryText: string; headline?: string; description?: string;
    imageUrl?: string; imageHash?: string; videoId?: string;
    textOptions?: { primaryTexts: string[]; headlines: string[]; descriptions: string[] } | null;
    placementMedia?: { feed?: { imageHash?: string; imageUrl?: string; videoId?: string }; vertical?: { imageHash?: string; imageUrl?: string; videoId?: string } } | null;
  }): Record<string, unknown> | null {
    const opts = input.textOptions ?? null;
    const multiText = !!opts && (opts.primaryTexts.length > 1 || opts.headlines.length > 1 || opts.descriptions.length > 1);
    const pm = input.placementMedia ?? null;
    const hasPlacement = !!(pm && (pm.feed || pm.vertical));
    if (!multiText && !hasPlacement) return null;
    const isVideo = !!input.videoId;
    const label = { base: "cn5_base", feed: "cn5_feed", vertical: "cn5_vertical" };
    const mediaEntry = (m: { imageHash?: string; imageUrl?: string; videoId?: string }, lbl: string) => isVideo
      ? { video_id: m.videoId, adlabels: [{ name: lbl }] }
      : { ...(m.imageHash ? { hash: m.imageHash } : { url: m.imageUrl }), adlabels: [{ name: lbl }] };
    const media: Record<string, unknown>[] = [mediaEntry(input, label.base)];
    if (pm?.feed) media.push(mediaEntry(pm.feed, label.feed));
    if (pm?.vertical) media.push(mediaEntry(pm.vertical, label.vertical));
    const feed: Record<string, unknown> = {
      bodies: (opts?.primaryTexts?.length ? opts.primaryTexts : [input.primaryText]).map((text) => ({ text })),
      link_urls: [{ website_url: input.linkUrl }],
      call_to_action_types: [input.callToAction],
      ad_formats: [isVideo ? "SINGLE_VIDEO" : "SINGLE_IMAGE"],
    };
    const titles = opts?.headlines?.length ? opts.headlines : (input.headline ? [input.headline] : []);
    if (titles.length) feed.titles = titles.map((text) => ({ text }));
    const descriptions = opts?.descriptions?.length ? opts.descriptions : (input.description ? [input.description] : []);
    if (descriptions.length) feed.descriptions = descriptions.map((text) => ({ text }));
    if (isVideo) feed.videos = media; else feed.images = media;
    if (hasPlacement) {
      const rules: Record<string, unknown>[] = [];
      const labelKey = isVideo ? "video_label" : "image_label";
      if (pm?.feed) rules.push({
        customization_spec: { publisher_platforms: ["facebook", "instagram"], facebook_positions: ["feed"], instagram_positions: ["stream"] },
        [labelKey]: { name: label.feed },
      });
      if (pm?.vertical) rules.push({
        customization_spec: { publisher_platforms: ["facebook", "instagram"], facebook_positions: ["story"], instagram_positions: ["story", "reels"] },
        [labelKey]: { name: label.vertical },
      });
      // Fallback: every other placement keeps the base asset.
      rules.push({ customization_spec: {}, [labelKey]: { name: label.base } });
      feed.asset_customization_rules = rules;
      feed.optimization_type = "PLACEMENT";
    } else {
      feed.optimization_type = "DEGREES_OF_FREEDOM";
    }
    return { page_id: input.pageId, asset_feed_spec: feed };
  }

  async createAd(adAccountExternalId: string, input: {
    name: string; adSetId: string; pageId: string;
    linkUrl: string; primaryText: string; headline?: string; description?: string;
    imageUrl?: string; imageHash?: string; callToAction: string;
    videoId?: string;
    carouselCards?: { title: string; description?: string; linkUrl: string; imageUrl?: string; imageHash?: string }[];
    // NB2 (CN4): a lead-form creative — link_data points at
    // https://fb.me/ and the call-to-action value carries
    // lead_gen_form_id (Meta's lead ads guide).
    leadGenFormId?: string;
    // NB2 (CN3): a catalog ad creative — object_story_spec
    // template_data with product template tags; Meta fills
    // name/link/image from the product set's items.
    catalogTemplate?: boolean;
    // CA17 (CB4): Meta url_tags — the plan's UTM params,
    // sent on the AD (Meta appends them to the destination
    // URL at click time). Optional: absent = the pre-CA17
    // payload, byte-identical.
    urlTags?: string;
    // NB3 (CN5): multiple text options, per-placement media
    // (already resolved to Meta ids) and Advantage creative
    // enhancement toggles. Asset-feed carries the first two;
    // catalog/lead creatives never receive them (the
    // service warns in readiness and logs at publish).
    textOptions?: { primaryTexts: string[]; headlines: string[]; descriptions: string[] } | null;
    placementMedia?: { feed?: { imageHash?: string; imageUrl?: string; videoId?: string }; vertical?: { imageHash?: string; imageUrl?: string; videoId?: string } } | null;
    enhancements?: Record<string, boolean> | null;
    // Frontier CN13 (NB6): a Click-to-WhatsApp creative
    // (Meta's CTWA guide): link_data whose link is
    // https://api.whatsapp.com/send and whose CTA is
    // WHATSAPP_MESSAGE with app_destination WHATSAPP,
    // plus the optional page_welcome_message. Takes
    // precedence over every other creative shape — a
    // WhatsApp destination defines the ad; text options /
    // placement assets do not ride it (the service warns
    // in readiness and logs the fallback at publish).
    whatsApp?: { welcome?: { greetingText?: string; prefillMessage?: string; iceBreakers?: string[] } | null } | null;
  }): Promise<{ id: string }> {
    let creative: Record<string, unknown>;
    const dof = MetaPublishClient.enhancementsToDof(input.enhancements);
    const assetFeed = (!input.whatsApp && !input.catalogTemplate && !input.leadGenFormId && !(input.carouselCards && input.carouselCards.length >= 2))
      ? MetaPublishClient.buildAssetFeedCreative(input)
      : null;
    if (input.whatsApp) {
      const welcome = MetaPublishClient.buildPageWelcomeMessage(input.whatsApp.welcome);
      creative = {
        page_id: input.pageId,
        link_data: {
          link: "https://api.whatsapp.com/send", message: input.primaryText,
          ...(input.headline ? { name: input.headline } : {}),
          ...(input.description ? { description: input.description } : {}),
          ...(input.imageHash ? { image_hash: input.imageHash } : input.imageUrl ? { image_url: input.imageUrl } : {}),
          call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } },
          ...(welcome ? { page_welcome_message: welcome } : {}),
        },
      };
    } else if (assetFeed) {
      creative = { ...assetFeed, ...(dof ? { degrees_of_freedom_spec: dof } : {}) };
    } else if (input.catalogTemplate) {
      creative = {
        page_id: input.pageId,
        template_data: {
          message: input.primaryText,
          name: input.headline ?? "{{product.name}}",
          description: input.description ?? "{{product.description}}",
          link: "{{product.url}}",
          call_to_action: { type: input.callToAction },
        },
      };
    } else if (input.leadGenFormId) {
      const linkData: Record<string, unknown> = {
        link: "https://fb.me/", message: input.primaryText,
        ...(input.headline ? { name: input.headline } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.imageHash ? { image_hash: input.imageHash } : input.imageUrl ? { image_url: input.imageUrl } : {}),
        call_to_action: { type: input.callToAction, value: { lead_gen_form_id: input.leadGenFormId } },
      };
      creative = { page_id: input.pageId, link_data: linkData };
    } else if (input.videoId) {
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
    // CN5: enhancement toggles ride the legacy single-image /
    // video / carousel creatives too. Catalog template and
    // lead-form creatives never receive them (readiness says
    // so, publish logs it) — never a silent claim otherwise.
    if (!assetFeed && dof && !input.catalogTemplate && !input.leadGenFormId) {
      creative = { ...creative, degrees_of_freedom_spec: dof };
    }
    const res = await this.post<any>(this.accountPath(adAccountExternalId, "ads"), {
      name: input.name, adset_id: input.adSetId, status: "PAUSED",
      creative: JSON.stringify(creative),
      ...(input.urlTags ? { url_tags: input.urlTags } : {}),
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

  /** CA24: live ad-account state for pre-flight — Meta's
   * own account_status code + disable_reason, read fresh
   * (the stored platformStatusBucket can be stale). Throws
   * MetaPublishError when Meta cannot be read; callers turn
   * that into a not_checked result, never an "ok". */
  async getAdAccountState(adAccountExternalId: string): Promise<{ accountStatus?: number; disableReason?: string | null; name?: string }> {
    const id = adAccountExternalId.startsWith("act_") ? adAccountExternalId : `act_${adAccountExternalId}`;
    const body: any = await this.get(`/${id}`, { fields: "name,account_status,disable_reason" });
    return {
      accountStatus: body?.account_status !== undefined ? Number(body.account_status) : undefined,
      disableReason: body?.disable_reason ? String(body.disable_reason) : null,
      name: body?.name ? String(body.name) : undefined,
    };
  }

  /** CA24: is this Page still fetchable by the token?
   * Returns Meta's own id/name; throws when Meta refuses
   * (deleted page, lost access) — the error is the evidence. */
  async getPageNode(pageId: string): Promise<{ id?: string; name?: string }> {
    const body: any = await this.get(`/${pageId}`, { fields: "id,name" });
    return { id: body?.id ? String(body.id) : undefined, name: body?.name ? String(body.name) : undefined };
  }

  /** CA24: pixel/dataset health — Meta's last_fired_time
   * on the AdsPixel node (the platform's own record of the
   * last event it received). Absent/null means Meta
   * reports no fire time; the caller states exactly that
   * instead of inventing a health verdict. */
  async getPixelNode(pixelId: string): Promise<{ id?: string; name?: string; lastFiredTime?: string | null }> {
    const body: any = await this.get(`/${pixelId}`, { fields: "id,name,last_fired_time" });
    return {
      id: body?.id ? String(body.id) : undefined,
      name: body?.name ? String(body.name) : undefined,
      lastFiredTime: body?.last_fired_time ? String(body.last_fired_time) : null,
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

  /** Campaign Builder Next CN1: Meta targeting search
   * (the ad account's targetingsearch edge). Returns
   * Meta's raw rows — callers decide what a match means;
   * an error here is a real error, never an empty list
   * dressed up as "no results". */
  async targetingSearch(adAccountExternalId: string, input: { type: string; query: string }): Promise<any[]> {
    const body = await this.get<any>(this.accountPath(adAccountExternalId, "targetingsearch"), {
      type: input.type, q: input.query, limit: "25",
    });
    return Array.isArray(body?.data) ? body.data : [];
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

  /** Campaign Builder Frontier CN15: the Meta business that
   * owns this ad account. Ad Studies are created on the
   * BUSINESS node (POST /{business_id}/ad_studies), not on
   * the ad account — the documented create path in Meta's
   * Ad Study reference. Returns null when Meta's account
   * node carries no business; callers refuse honestly
   * rather than guess a business id. */
  async getAdAccountBusinessId(adAccountExternalId: string): Promise<string | null> {
    const id = adAccountExternalId.startsWith("act_") ? adAccountExternalId : `act_${adAccountExternalId}`;
    const body = await this.get<any>(`/${id}`, { fields: "business{id}" });
    const businessId = body?.business?.id;
    return businessId ? String(businessId) : null;
  }

  /** CN15: create a Meta Experiment (Ad Study) of type
   * SPLIT_TEST on the business node — cells carry
   * treatment_percentage + the campaigns they test, and
   * objectives carry the success metric (the documented
   * shape: Ad Study guide + Graph API Reference for
   * Business/ad_studies). A creation counts ONLY when Meta
   * returns the study id; Meta's refusal propagates
   * verbatim as a MetaPublishError. Creating a study does
   * not create, publish or activate any campaign. */
  async createAdStudy(businessId: string, input: {
    name: string; description?: string;
    startTimeSec: number; endTimeSec: number;
    cells: unknown[]; objectives: unknown[];
  }): Promise<{ id: string; raw: unknown }> {
    const res = await this.post<any>(`/${businessId}/ad_studies`, {
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      type: "SPLIT_TEST",
      start_time: String(input.startTimeSec),
      end_time: String(input.endTimeSec),
      cells: JSON.stringify(input.cells),
      objectives: JSON.stringify(input.objectives),
    });
    if (!res?.id) throw new MetaPublishError(200, "Meta returned no study id; experiment creation is NOT confirmed");
    return { id: String(res.id), raw: res };
  }

  /** CN15: read a study back — the study node plus its
   * cells edge, returned VERBATIM (Meta's own fields,
   * including any winner/confidence data Meta chooses to
   * return; this codebase never computes significance).
   * A Meta refusal propagates verbatim. */
  async getAdStudy(studyId: string): Promise<{ study: unknown; cells: unknown[] }> {
    const study = await this.get<any>(`/${studyId}`, {
      fields: "id,name,description,type,start_time,end_time,cooldown_start_time,observation_end_time,results_first_available_date,creation_time,updated_time",
    });
    const cellsBody = await this.get<any>(`/${studyId}/cells`, {
      fields: "id,name,treatment_percentage,adsets,campaigns,ads,adaccounts",
    }).catch(() => null);
    return { study, cells: Array.isArray(cellsBody?.data) ? cellsBody.data : [] };
  }
}
