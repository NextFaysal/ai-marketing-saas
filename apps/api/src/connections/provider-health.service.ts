import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson } from "../integrations/crypto";
import { graphGet, metaTokenForAccount } from "../common/meta-graph";
import { IntegrationsService } from "../integrations/integrations.service";
import { ShopifyService } from "../integrations/shopify/shopify.service";
import { SHOPIFY_REQUIRED_SCOPES } from "../integrations/commerce/health.service";

/**
 * CC14/CC15/CC16 (Connect Center Advanced) — provider-reported
 * health, asset completeness and commerce repair.
 *
 * Every value in a snapshot is copied VERBATIM from a real
 * provider response: a field the provider did not return stays
 * ABSENT from the snapshot (never 0, never estimated, never
 * defaulted to false). providerHealthAt moves ONLY on a
 * successful fetch; a failed fetch records providerHealthError
 * and leaves the previous snapshot + timestamp untouched, so
 * stale values can never masquerade as fresh.
 *
 * Probes are the injectable seam (the CC11 pattern): production
 * probes call the EXISTING Graph helper and the existing Shopify
 * GraphQL machinery — no new protocol code lives here. Webhook
 * repair dispatches to the EXISTING EC2 registrars
 * (IntegrationsService.repairWooWebhooks /
 * ShopifyService.repairWebhooks) exactly as the integrations
 * controller does; there is no parallel registrar.
 */

export interface ProviderHealthProbes {
  graphGet(token: string, path: string): Promise<any>;
  shopifyAccessScopes(integration: any): Promise<string[]>;
}

/** WhatsApp quality_rating ordering — only these three values
 * carry a documented order; anything else Meta might return is
 * stored verbatim but has no rank, so it can never trigger (or
 * clear) a drop alert by guessing. */
export const WHATSAPP_QUALITY_RANK: Record<string, number> = { GREEN: 3, YELLOW: 2, RED: 1 };

export function whatsappQualityRank(rating: unknown): number | null {
  if (typeof rating !== "string") return null;
  return WHATSAPP_QUALITY_RANK[rating] ?? null;
}

const WHATSAPP_PHONE_FIELDS = "display_phone_number,verified_name,quality_rating,messaging_limit,status,name_status,code_verification_status";

/** Copy a provider field into the snapshot ONLY when the
 * provider actually returned it — absence stays absence. */
function copyIfPresent(target: Record<string, any>, key: string, value: unknown) {
  if (value !== undefined && value !== null) target[key] = value;
}

@Injectable()
export class ProviderHealthService {
  private readonly probes: ProviderHealthProbes;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() probes?: ProviderHealthProbes,
    @Optional() private readonly shopify?: ShopifyService,
    @Optional() private readonly integrations?: IntegrationsService,
  ) {
    this.probes = probes ?? {
      graphGet: (token, path) => graphGet(token, path),
      shopifyAccessScopes: async (integration) => {
        if (!this.shopify) throw new Error("Shopify service unavailable");
        const client = await this.shopify.buildGraphQLClient(integration);
        return client.accessScopes();
      },
    };
  }

  // ---------- shared helpers ----------

  private async credentialFor(integrationId: string): Promise<any | null> {
    const row = await (this.prisma as any).integrationCredential.findUnique({
      where: { integrationId },
    }).catch(() => null);
    if (!row?.encryptedData) return null;
    try { return decryptJson<any>(row.encryptedData); } catch { return null; }
  }

  private async integrationRow(organizationId: string, integrationId: string): Promise<any | null> {
    return (this.prisma as any).integration.findFirst({
      where: { id: integrationId, organizationId },
    }).catch(() => null);
  }

  private healthView(row: any) {
    return {
      providerHealth: row?.providerHealth ?? null,
      providerHealthAt: row?.providerHealthAt ?? null,
      providerHealthError: row?.providerHealthError ?? null,
    };
  }

  /** Success: snapshot + timestamp move, error clears. */
  private async storeSnapshot(table: string, row: any, snapshot: any) {
    const updated = await (this.prisma as any)[table].update({
      where: { id: row.id },
      data: { providerHealth: snapshot, providerHealthAt: new Date(), providerHealthError: null },
    }).catch(() => null);
    return updated ?? { ...row, providerHealth: snapshot, providerHealthAt: new Date(), providerHealthError: null };
  }

  /** Failure: ONLY the error is recorded — snapshot and its
   * timestamp stay exactly as they were. */
  private async storeError(table: string, row: any, message: string) {
    await (this.prisma as any)[table].update({
      where: { id: row.id }, data: { providerHealthError: message },
    }).catch(() => undefined);
    return { ...row, providerHealthError: message };
  }

  private async auditRefresh(organizationId: string, actorId: string | null, entityType: string, entityId: string, kind: string) {
    await this.audit.log({
      organizationId, userId: actorId ?? undefined, action: "connection.provider_health_refreshed",
      entityType, entityId, metadata: { kind },
    }).catch(() => undefined);
  }

  // ---------- CC14: WhatsApp deep health ----------

  /**
   * Fetch the WhatsApp phone-number node (+ the WABA node when a
   * WABA id is stored) exactly as Meta reports them. Returns the
   * previous and new quality ratings so the CC12 sweep can run
   * its drop machine; never throws — a failed fetch is a result
   * ({ ok: false }) with the error recorded on the row.
   */
  async refreshWhatsAppHealth(organizationId: string, integrationId: string): Promise<{
    ok: boolean; error?: string; snapshot?: any;
    previousQualityRating: string | null; qualityRating: string | null;
  }> {
    const integration = await this.integrationRow(organizationId, integrationId);
    if (!integration) return { ok: false, error: "Integration not found", previousQualityRating: null, qualityRating: null };
    const previousQualityRating = typeof integration.providerHealth?.qualityRating === "string"
      ? integration.providerHealth.qualityRating : null;
    if (integration.provider !== "whatsapp") {
      return { ok: false, error: "Not a WhatsApp integration", previousQualityRating, qualityRating: null };
    }
    const creds = await this.credentialFor(integration.id);
    if (!creds?.accessToken) {
      const message = "সংরক্ষিত credential পাওয়া যায়নি — কানেকশনটি আবার করুন।";
      await this.storeError("integration", integration, message);
      return { ok: false, error: message, previousQualityRating, qualityRating: null };
    }
    const phoneNumberId = creds.phoneNumberId ?? integration.externalAccountId;
    if (!phoneNumberId) {
      const message = "এই কানেকশনে phoneNumberId সংরক্ষিত নেই — নম্বর-ভিত্তিক health আনা সম্ভব নয়।";
      await this.storeError("integration", integration, message);
      return { ok: false, error: message, previousQualityRating, qualityRating: null };
    }
    let phone: any;
    try {
      phone = await this.probes.graphGet(creds.accessToken, `/${phoneNumberId}?fields=${WHATSAPP_PHONE_FIELDS}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.storeError("integration", integration, message);
      return { ok: false, error: message, previousQualityRating, qualityRating: null };
    }
    const snapshot: Record<string, any> = { kind: "whatsapp", phoneNumberId: String(phoneNumberId) };
    copyIfPresent(snapshot, "displayPhoneNumber", phone?.display_phone_number);
    copyIfPresent(snapshot, "verifiedName", phone?.verified_name);
    copyIfPresent(snapshot, "qualityRating", phone?.quality_rating);
    copyIfPresent(snapshot, "messagingLimit", phone?.messaging_limit);
    copyIfPresent(snapshot, "status", phone?.status);
    copyIfPresent(snapshot, "nameStatus", phone?.name_status);
    copyIfPresent(snapshot, "codeVerificationStatus", phone?.code_verification_status);
    // The WABA review status is a second, separate node — its
    // failure degrades only its own entry, transparently.
    if (creds.wabaId) {
      try {
        const waba = await this.probes.graphGet(creds.accessToken, `/${creds.wabaId}?fields=name,account_review_status`);
        const entry: Record<string, any> = { id: String(creds.wabaId) };
        copyIfPresent(entry, "name", waba?.name);
        copyIfPresent(entry, "accountReviewStatus", waba?.account_review_status);
        snapshot.waba = entry;
      } catch (e) {
        snapshot.wabaError = e instanceof Error ? e.message : String(e);
      }
    } else {
      snapshot.wabaError = "WABA ID সংরক্ষিত নেই — WhatsApp Business Account-এর review status আনা যায়নি।";
    }
    await this.storeSnapshot("integration", integration, snapshot);
    return {
      ok: true, snapshot,
      previousQualityRating,
      qualityRating: typeof snapshot.qualityRating === "string" ? snapshot.qualityRating : null,
    };
  }

  // ---------- CC15: Meta Page asset completeness ----------

  /** Pixel/Catalog association is a BUSINESS-level fact: Meta
   * exposes pixels and catalogs on the ad account, not on the
   * Page node. The entries say so (scope) and stay `associated:
   * null` (unknown) whenever Meta gives no answer — no connected
   * Meta ad account, or the call failed. */
  private async businessAssets(organizationId: string): Promise<{ pixel: any; catalog: any }> {
    const account = await (this.prisma as any).adAccount.findFirst({
      where: { organizationId, platform: "meta", sourceType: "api" },
      orderBy: { createdAt: "asc" },
    }).catch(() => null);
    const unknown = (error: string) => ({ associated: null, scope: "meta_ad_account", error });
    if (!account?.integrationId || !account?.externalId) {
      const error = "কোনো Meta Ad Account কানেক্ট করা নেই — Pixel/Catalog যাচাইয়ের পথ নেই।";
      return { pixel: unknown(error), catalog: unknown(error) };
    }
    let token: string;
    try {
      ({ token } = await metaTokenForAccount(this.prisma as any, organizationId, account.id));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return { pixel: unknown(error), catalog: unknown(error) };
    }
    const probe = async (edge: string) => {
      try {
        const res = await this.probes.graphGet(token, `/act_${account.externalId}/${edge}?fields=id,name&limit=100`);
        const items = Array.isArray(res?.data) ? res.data : null;
        if (!items) return unknown("Meta তালিকা আকারে উত্তর দেয়নি");
        return { associated: items.length > 0, count: items.length, scope: "meta_ad_account" };
      } catch (e) {
        return unknown(e instanceof Error ? e.message : String(e));
      }
    };
    const [pixel, catalog] = await Promise.all([probe("adspixels"), probe("productcatalogs")]);
    return { pixel, catalog };
  }

  /**
   * CC30 — the account's OWNING Meta business + its
   * verification_status, read from the account's OWN Graph node
   * in a separate, failure-isolated call. This tree stores NO
   * business id on SocialAccount / AdAccount / Integration rows
   * (the only stored businessId is CatalogRecord's, which
   * belongs to a catalog, not to this account), so the business
   * is never taken from another record and never guessed: if
   * the account's own node does not report a business, the
   * snapshot simply has no `business` key (unknown stays
   * unknown). A FAILED business call also stores nothing — the
   * error rides the refresh RESULT (businessError), because the
   * snapshot's own fetch succeeded and mislabelling it failed
   * would falsely stale good data.
   */
  private async fetchBusinessEntry(token: string, nodePath: string): Promise<{ business?: Record<string, any>; businessError?: string }> {
    try {
      const res = await this.probes.graphGet(token, `${nodePath}?fields=business{id,verification_status}`);
      const biz = res?.business;
      if (!biz?.id) return {};
      const entry: Record<string, any> = { id: String(biz.id) };
      copyIfPresent(entry, "verificationStatus", biz.verification_status);
      return { business: entry };
    } catch (e) {
      return { businessError: e instanceof Error ? e.message : String(e) };
    }
  }

  private async fetchPageSnapshot(organizationId: string, token: string, pageId: string) {
    const page = await this.probes.graphGet(token, `/${pageId}?fields=instagram_business_account{id,username}`);
    const ig = page?.instagram_business_account;
    const instagram: Record<string, any> = ig?.id
      ? { linked: true, id: String(ig.id), ...(ig.username ? { username: String(ig.username) } : {}) }
      : { linked: false };
    const { pixel, catalog } = await this.businessAssets(organizationId);
    const snapshot: Record<string, any> = { kind: "meta_page", pageId: String(pageId), instagram, pixel, catalog };
    const { business, businessError } = await this.fetchBusinessEntry(token, `/${pageId}`);
    if (business) snapshot.business = business;
    return { snapshot, businessError: businessError ?? null };
  }

  /** CC15 for a SocialAccount meta_page row. */
  async refreshMetaPageHealth(organizationId: string, socialAccountId: string) {
    const account = await (this.prisma as any).socialAccount.findFirst({
      where: { id: socialAccountId, organizationId },
    }).catch(() => null);
    if (!account) throw new NotFoundException("Social account not found");
    if (account.platform !== "meta_page") {
      throw new BadRequestException("শুধু Facebook Page (meta_page) অ্যাকাউন্টের completeness আনা যায়।");
    }
    const integration = account.integrationId
      ? await this.integrationRow(organizationId, account.integrationId)
      : await (this.prisma as any).integration.findFirst({
          where: { organizationId, externalAccountId: account.externalId },
        }).catch(() => null);
    const creds = integration ? await this.credentialFor(integration.id) : null;
    if (!creds?.accessToken) {
      const message = "এই Page-এর কোনো Integration credential পাওয়া যায়নি — completeness আনা যায়নি।";
      const row = await this.storeError("socialAccount", account, message);
      return { ok: false, error: message, targetType: "social_account", targetId: account.id, ...this.healthView(row) };
    }
    let fetched: { snapshot: any; businessError: string | null };
    try {
      fetched = await this.fetchPageSnapshot(organizationId, creds.accessToken, account.externalId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const row = await this.storeError("socialAccount", account, message);
      return { ok: false, error: message, targetType: "social_account", targetId: account.id, ...this.healthView(row) };
    }
    const row = await this.storeSnapshot("socialAccount", account, fetched.snapshot);
    return { ok: true, targetType: "social_account", targetId: account.id, ...(fetched.businessError ? { businessError: fetched.businessError } : {}), ...this.healthView(row) };
  }

  /** CC15 for a messaging/meta_social Integration carrying a Page. */
  async refreshMetaPageIntegrationHealth(organizationId: string, integrationId: string) {
    const integration = await this.integrationRow(organizationId, integrationId);
    if (!integration) throw new NotFoundException("Integration not found");
    if (!["messenger", "meta_social"].includes(String(integration.provider))) {
      throw new BadRequestException("শুধু Messenger / Meta Social কানেকশনের Page completeness আনা যায়।");
    }
    const creds = await this.credentialFor(integration.id);
    const pageId = creds?.pageId ?? integration.externalAccountId;
    if (!creds?.accessToken || !pageId) {
      const message = "এই কানেকশনে Page credential/ID সংরক্ষিত নেই — completeness আনা যায়নি।";
      const row = await this.storeError("integration", integration, message);
      return { ok: false, error: message, targetType: "integration", targetId: integration.id, ...this.healthView(row) };
    }
    let fetched: { snapshot: any; businessError: string | null };
    try {
      fetched = await this.fetchPageSnapshot(organizationId, creds.accessToken, pageId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const row = await this.storeError("integration", integration, message);
      return { ok: false, error: message, targetType: "integration", targetId: integration.id, ...this.healthView(row) };
    }
    const row = await this.storeSnapshot("integration", integration, fetched.snapshot);
    return { ok: true, targetType: "integration", targetId: integration.id, ...(fetched.businessError ? { businessError: fetched.businessError } : {}), ...this.healthView(row) };
  }

  // ---------- CC15: Ad Account completeness ----------

  /**
   * Payment-method-on-file as a BOOLEAN, exactly as Meta's
   * funding_source_details answer supports: a successful
   * response carrying a funding source means true; a successful
   * response without one means false; a failed call means
   * NOTHING is stored as fact — the error is recorded and the
   * previous snapshot stays. Card data is never requested.
   * Platforms other than Meta have no such surface in this
   * codebase: unsupported, honestly, with nothing stored.
   */
  async refreshAdAccountHealth(organizationId: string, adAccountId: string) {
    const account = await (this.prisma as any).adAccount.findFirst({
      where: { id: adAccountId, organizationId },
    }).catch(() => null);
    if (!account) throw new NotFoundException("Ad account not found");
    const beside = {
      platformStatusBucket: account.platformStatusBucket ?? null,
      platformStatusRaw: account.platformStatusRaw ?? null,
    };
    if (account.platform !== "meta" || account.sourceType !== "api" || !account.integrationId || !account.externalId) {
      return {
        ok: false, supported: false, targetType: "ad_account", targetId: account.id, ...beside,
        error: "এই Ad Account-এর জন্য Meta funding যাচাইয়ের পথ নেই (শুধু API-কানেক্টেড Meta অ্যাকাউন্টে সম্ভব)।",
        ...this.healthView(account),
      };
    }
    let token: string;
    try {
      ({ token } = await metaTokenForAccount(this.prisma as any, organizationId, account.id));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const row = await this.storeError("adAccount", account, message);
      return { ok: false, supported: true, targetType: "ad_account", targetId: account.id, ...beside, error: message, ...this.healthView(row) };
    }
    let snapshot: any;
    let businessError: string | null = null;
    try {
      const res = await this.probes.graphGet(token, `/act_${account.externalId}?fields=funding_source_details`);
      const fs = res?.funding_source_details;
      const onFile = Boolean(fs && (fs.id ?? fs.type ?? fs.display_string));
      snapshot = { kind: "ad_account", paymentMethodOnFile: onFile };
      // CC30: the owning business + verification_status ride
      // the same refresh (see fetchBusinessEntry) — stored
      // verbatim when the account's own node reports one.
      const biz = await this.fetchBusinessEntry(token, `/act_${account.externalId}`);
      if (biz.business) snapshot.business = biz.business;
      businessError = biz.businessError ?? null;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const row = await this.storeError("adAccount", account, message);
      return { ok: false, supported: true, targetType: "ad_account", targetId: account.id, ...beside, error: message, ...this.healthView(row) };
    }
    const row = await this.storeSnapshot("adAccount", account, snapshot);
    return { ok: true, supported: true, targetType: "ad_account", targetId: account.id, ...beside, ...(businessError ? { businessError } : {}), ...this.healthView(row) };
  }

  // ---------- manual refresh dispatch (CC14/CC15) ----------

  async refreshTarget(organizationId: string, actorId: string, targetType: string, targetId: string) {
    let result: any;
    if (targetType === "integration") {
      const integration = await this.integrationRow(organizationId, targetId);
      if (!integration) throw new NotFoundException("Integration not found");
      if (integration.provider === "whatsapp") {
        const r = await this.refreshWhatsAppHealth(organizationId, targetId);
        const row = await this.integrationRow(organizationId, targetId);
        result = { ok: r.ok, ...(r.error ? { error: r.error } : {}), targetType, targetId, ...this.healthView(row) };
      } else if (["messenger", "meta_social"].includes(String(integration.provider))) {
        result = await this.refreshMetaPageIntegrationHealth(organizationId, targetId);
      } else {
        throw new BadRequestException("এই কানেকশনের জন্য provider health refresh সংজ্ঞায়িত নেই।");
      }
    } else if (targetType === "social_account") {
      result = await this.refreshMetaPageHealth(organizationId, targetId);
    } else if (targetType === "ad_account") {
      result = await this.refreshAdAccountHealth(organizationId, targetId);
    } else {
      throw new BadRequestException("এই ধরনের কানেকশনের জন্য provider health refresh সংজ্ঞায়িত নেই।");
    }
    if (result?.ok) {
      await this.auditRefresh(organizationId, actorId,
        targetType === "ad_account" ? "AdAccount" : targetType === "social_account" ? "SocialAccount" : "Integration",
        targetId, String(result.providerHealth?.kind ?? targetType));
    }
    return result;
  }

  // ---------- CC16: commerce diagnostics + repair ----------

  /**
   * The Center's commerce view for one store integration: the
   * STORED EC2 webhook record per topic, the Shopify scope diff
   * (granted scopes fetched live through the existing GraphQL
   * machinery vs SHOPIFY_REQUIRED_SCOPES — the same list the
   * store-health service uses), Woo tracker freshness from the
   * real abandoned-checkout records the tracker produced, and
   * the latest Doctor run as the reachability evidence.
   */
  async commerceDiagnostics(organizationId: string, integrationId: string) {
    const integration = this.integrations
      ? await this.integrations.getIntegration(organizationId, integrationId)
      : await (this.prisma as any).integration.findFirst({
          where: { id: integrationId, organizationId }, include: { store: true, credential: true },
        }).catch(() => null);
    if (!integration) throw new NotFoundException("Integration not found");
    if (!["woocommerce", "shopify"].includes(String(integration.provider))) {
      throw new BadRequestException("Commerce diagnostics শুধু WooCommerce/Shopify কানেকশনের জন্য।");
    }
    let shopifyScopes: { granted: string[]; required: string[]; missing: string[] } | null = null;
    let shopifyScopesError: string | null = null;
    if (integration.provider === "shopify") {
      try {
        const granted = await this.probes.shopifyAccessScopes(integration);
        shopifyScopes = {
          granted,
          required: [...SHOPIFY_REQUIRED_SCOPES],
          missing: SHOPIFY_REQUIRED_SCOPES.filter((s) => !granted.includes(s)),
        };
      } catch (e) {
        // Granted scopes cannot be fetched for this store (auth
        // mode / token state) — the diff stays unknown, shown as
        // an error note, never assumed complete or incomplete.
        shopifyScopesError = e instanceof Error ? e.message : String(e);
      }
    }
    let tracker: { lastEventAt: Date | null; label: string } | null = null;
    if (integration.storeId) {
      const latest = await (this.prisma as any).abandonedStoreCheckout.findFirst({
        where: { organizationId, storeId: integration.storeId },
        orderBy: { createdAt: "desc" },
      }).catch(() => null);
      tracker = {
        lastEventAt: latest?.createdAt ?? null,
        label: "শেষ tracker event (abandoned checkout)",
      };
    }
    const lastRun = await (this.prisma as any).connectionHealthCheck.findFirst({
      where: { organizationId, targetType: "integration", targetId: integrationId },
      orderBy: { createdAt: "desc" },
    }).catch(() => null);
    return {
      integrationId: integration.id,
      provider: integration.provider,
      storeId: integration.storeId ?? null,
      // CC21: the auto-healing opt-out state, shown beside the
      // webhook record it governs (absent on pre-CC21 rows =
      // enabled, the column default).
      autoHealEnabled: integration.autoHealEnabled !== false,
      webhookStatus: integration.webhookStatus ?? null,
      shopifyScopes,
      shopifyScopesError,
      tracker,
      lastCheck: lastRun ? { overall: lastRun.overall, at: lastRun.createdAt, trigger: lastRun.trigger } : null,
    };
  }

  /**
   * Webhook repair through the EXISTING EC2 machinery — the same
   * dispatch the integrations controller performs. The machinery
   * records its real per-topic outcome back into
   * integration.webhookStatus; the response carries that outcome
   * verbatim (re-read from the row).
   */
  async repairWebhooks(organizationId: string, actorId: string, integrationId: string) {
    if (!this.integrations) throw new BadRequestException("Integrations service unavailable");
    const integration = await this.integrations.getIntegration(organizationId, integrationId);
    let result: any;
    if (integration.provider === "shopify") {
      if (!this.shopify) throw new BadRequestException("Shopify service unavailable");
      result = await this.shopify.repairWebhooks(organizationId, actorId, integrationId);
    } else if (integration.provider === "woocommerce") {
      result = await this.integrations.repairWooWebhooks(organizationId, actorId, integrationId);
    } else {
      throw new BadRequestException("Webhook repair is only available for WooCommerce/Shopify integrations");
    }
    const fresh = await this.integrationRow(organizationId, integrationId);
    return {
      integrationId,
      webhookRegistration: result?.webhookRegistration ?? null,
      webhookStatus: fresh?.webhookStatus ?? result?.webhookStatus ?? null,
    };
  }
}
