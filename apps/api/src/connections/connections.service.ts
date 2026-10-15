import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ensurePlatformConfig, getPlatformConfigSync, socialOAuthRedirectUri } from "../common/platform-config";
import { normalizeDeniedConnections } from "../common/permission-catalog";
import { decryptJson, encryptJson } from "../integrations/crypto";
import { MetaAppClient } from "./meta-app.client";
import { LlmVerifyClient } from "./llm-verify.client";
import { StepUpService, stepUpMarker } from "./step-up.service";

/**
 * CC1/CC2 — Connect Center.
 *
 * The overview is an AGGREGATION over the rows that already exist
 * (Integration / SocialAccount / AdAccount / Store /
 * MessagingSenderConfig / BusinessProfile). It creates NO new
 * source of truth: a category with no backing store today (tenant
 * online gateway, per-org LLM key) reports `not_configured` (or,
 * for AI, `platform_managed` when the operator's platform LLM is
 * configured) instead of inventing rows.
 *
 * Health is DERIVED from stored fields only (status, lastError,
 * tokenExpiresAt) — it is not a live ping; B3 may add live checks.
 * Secrets are never read here, so they can never leak through this
 * API: credential rows are not even queried.
 */

export type ConnectionHealth = "ok" | "error" | "disconnected" | "expiring" | "unknown";

export interface ConnectionAccount {
  id: string;
  source: "integration" | "social_account" | "ad_account" | "store" | "sender_config" | "business_profile" | "org_llm_config" | "tenant_payment_gateway" | "platform_payment_enablement";
  category: string;
  provider: string;
  displayName: string;
  externalAccountId: string | null;
  status: string;
  lastSyncAt: Date | null;
  lastError: string | null;
  tokenExpiresAt: Date | null;
  expiringSoon: boolean;
  health: ConnectionHealth;
  isDefault: boolean;
  /** CC3/CC4: "platform" | "own" — which app this connection was
   * made through. Present on integration / social-account rows. */
  appSource?: string;
  /** CC3: true when appSource is "own" but the org's
   * TenantAppConfig for that platform has since been deleted —
   * the stored connection tokens keep working, but webhook
   * verification fallbacks / token refresh can no longer resolve
   * the own-app secret. Surfaced, never hidden. */
  ownAppConfigMissing?: boolean;
  /** CC11: the latest Connection Doctor run for this account,
   * if any — { overall, at, trigger }. Null = never diagnosed;
   * the stored-field health above stays the fallback truth. */
  lastCheck?: { overall: string; at: Date; trigger: string } | null;
  /** CC14/CC15: the provider's OWN health snapshot, stored
   * verbatim on the backing row (WhatsApp quality/limit + WABA
   * status; Meta Page completeness; ad-account payment-on-file
   * boolean). A field the provider did not return is absent from
   * the snapshot. providerHealthAt moves only on a successful
   * fetch; providerHealthError records the last failed attempt
   * without touching the snapshot. */
  providerHealth?: any | null;
  providerHealthAt?: Date | null;
  providerHealthError?: string | null;
  /** AD3 (surfaced beside the CC15 payment boolean): the
   * platform's verbatim status + normalized bucket for ad
   * accounts; null when the platform never reported one. */
  platformStatusBucket?: string | null;
  platformStatusRaw?: string | null;
  /** CC17: tenant-chosen display label (AD6 semantics) — the
   * displayName already prefers it; null = provider/name
   * fallback. groupName is the tenant's free-text grouping
   * (brand/branch); null = ungrouped. */
  label?: string | null;
  groupName?: string | null;
  /** CC18: sync paused for this connection (Integration rows).
   * Ad accounts surface their pre-existing AD5 syncDisabled
   * instead — the two flags are never both presented. */
  syncPaused?: boolean;
  syncDisabled?: boolean;
  /** CC30: per-connection SCHEDULED-sync cadence in minutes
   * (Integration rows); null/absent = no cadence. Manual syncs
   * ignore it; CC18's pause wins over it. */
  syncIntervalMinutes?: number | null;
  /** CC21: auto-healing opt-out state (Integration rows only).
   * Absent/false distinction: `false` means the tenant opted
   * OUT of sweep auto-repair for this connection; detection and
   * alerts still run. */
  autoHealEnabled?: boolean;
  deepLink: string;
}

export interface ConnectionCategory {
  key: string;
  label: string;
  deepLink: string;
  status: string; // connected | disconnected | not_configured | platform_managed
  note: string | null;
  connectedCount: number;
  totalCount: number;
  accounts: ConnectionAccount[];
}

const EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Integration.provider (in the wild) -> Connect Center category. */
export const INTEGRATION_CATEGORY_PROVIDERS: Record<string, string[]> = {
  messaging: ["whatsapp", "messenger", "instagram", "telegram", "email", "webchat"],
  // CC20: linkedin_social (SocialAccounts) + google_business
  // (Integrations) are both social surfaces.
  social: ["meta_social", "tiktok_social", "youtube_social", "linkedin_social", "google_business"],
  ads: ["meta", "google_ads", "tiktok"],
  // CC20: a Merchant Center account exists to feed commerce
  // surfaces, so google_merchant groups with the stores.
  commerce: ["woocommerce", "shopify", "google_merchant"],
  courier: ["steadfast", "pathao", "redx"],
  // CC20: GA4 measures the business; it is neither a store nor
  // a channel, so it gets its own honest category.
  analytics: ["google_analytics"],
};

export const CATEGORY_DEFS: { key: string; label: string; deepLink: string }[] = [
  { key: "messaging", label: "মেসেজিং চ্যানেল", deepLink: "/dashboard/inbox" },
  { key: "social", label: "সোশ্যাল অ্যাকাউন্ট", deepLink: "/dashboard/social-posts" },
  { key: "ads", label: "বিজ্ঞাপন অ্যাকাউন্ট", deepLink: "/dashboard/ad-accounts" },
  { key: "commerce", label: "কমার্স / স্টোর", deepLink: "/dashboard/integrations" },
  { key: "courier", label: "কুরিয়ার", deepLink: "/dashboard/integrations" },
  { key: "senders", label: "মেসেজিং প্রেরক (SMTP/SMS)", deepLink: "/dashboard/messaging" },
  { key: "ai", label: "AI / LLM", deepLink: "/dashboard/ai" },
  { key: "payment", label: "পেমেন্ট", deepLink: "/dashboard/settings#hub-payment" },
  // CC20: GA4 rows live in this category in the Center; the
  // deep link is the existing analytics dashboard where their
  // data is consumed.
  { key: "analytics", label: "অ্যানালিটিক্স", deepLink: "/dashboard/analytics" },
  { key: "other", label: "অন্যান্য", deepLink: "/dashboard/integrations" },
];

const PROVIDER_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram",
  telegram: "Telegram", email: "Email", webchat: "ওয়েবচ্যাট",
  meta_social: "Facebook Page (Social)", tiktok_social: "TikTok (Social)", youtube_social: "YouTube",
  meta: "Meta Ads", google_ads: "Google Ads", tiktok: "TikTok Ads",
  woocommerce: "WooCommerce", shopify: "Shopify",
  steadfast: "Steadfast", pathao: "Pathao", redx: "RedX",
  smtp: "SMTP (Email)", sms: "SMS Gateway",
  sslcommerz: "SSLCommerz", bkash: "বিকাশ (bKash)", nagad: "নগদ (Nagad)",
  meta_page: "Facebook Page", youtube: "YouTube",
  woocommerce_store: "WooCommerce", shopify_store: "Shopify",
  // CC20: the Google pack + LinkedIn Page — without entries
  // here the overview would fall back to the raw provider id.
  google_analytics: "Google Analytics (GA4)",
  google_merchant: "Google Merchant Center",
  google_business: "Google Business Profile",
  linkedin_social: "LinkedIn Page",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function categoryForProvider(provider: string): string {
  for (const [category, providers] of Object.entries(INTEGRATION_CATEGORY_PROVIDERS)) {
    if (providers.includes(provider)) return category;
  }
  return "other";
}

export function providersForCategory(category: string): string[] {
  return INTEGRATION_CATEGORY_PROVIDERS[category] ?? [];
}

/**
 * CC28: the redirect URIs a tenant must register in their OWN
 * Google Cloud console for the own-app Google pack to work —
 * the platform's existing callback URLs, one per Google surface
 * (YouTube rides the social OAuth callback; GA4 / Merchant /
 * Business Profile ride the Google pack callbacks). Derived
 * from the deployment's API_PUBLIC_URL exactly like the OAuth
 * flows themselves derive them, so what the UI shows is what
 * the flows use.
 */
export function googleOwnAppRedirectUris(): string[] {
  return [
    socialOAuthRedirectUri("youtube"),
    socialOAuthRedirectUri("google-ga4"),
    socialOAuthRedirectUri("google-merchant"),
    socialOAuthRedirectUri("google-business"),
  ];
}

const CONNECTED_STATUSES = new Set(["CONNECTED", "connected", "ACTIVE", "active"]);

/**
 * Health from stored fields only. An expired token is an error; a
 * token expiring within 7 days is `expiring`; a stored lastError on
 * a connected row is an error; anything not connected is
 * `disconnected`; a connected row we know nothing else about is ok.
 */
export function deriveHealth(input: {
  status?: string | null; lastError?: string | null; tokenExpiresAt?: Date | string | null;
}, now = new Date()): { health: ConnectionHealth; expiringSoon: boolean } {
  const status = input.status ?? "";
  if (status && !CONNECTED_STATUSES.has(status)) return { health: "disconnected", expiringSoon: false };
  if (!status) return { health: "unknown", expiringSoon: false };
  if (input.lastError) return { health: "error", expiringSoon: false };
  const expires = input.tokenExpiresAt ? new Date(input.tokenExpiresAt) : null;
  if (expires && !Number.isNaN(expires.getTime())) {
    const ms = expires.getTime() - now.getTime();
    if (ms <= 0) return { health: "error", expiringSoon: true };
    if (ms <= EXPIRING_WINDOW_MS) return { health: "expiring", expiringSoon: true };
  }
  return { health: "ok", expiringSoon: false };
}

function isConnectedStatus(status?: string | null): boolean {
  return Boolean(status && CONNECTED_STATUSES.has(status));
}

/** CC3: the TenantAppConfig platform behind a connection
 * provider, or null when the provider has no own-app path in
 * CC3 scope (YouTube/Google own-app was not in the plan). */
export function appPlatformForProvider(provider: string): "meta" | "tiktok" | null {
  if (["whatsapp", "messenger", "instagram", "meta", "meta_social", "meta_page"].includes(provider)) return "meta";
  if (["tiktok", "tiktok_social"].includes(provider)) return "tiktok";
  return null;
}

@Injectable()
export class ConnectionsService {
  private readonly metaApp: MetaAppClient;
  private readonly llmVerify: LlmVerifyClient;
  private readonly stepUp: StepUpService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() metaAppClient?: MetaAppClient,
    @Optional() llmVerifyClient?: LlmVerifyClient,
    @Optional() stepUpService?: StepUpService,
  ) {
    this.metaApp = metaAppClient ?? new MetaAppClient();
    this.llmVerify = llmVerifyClient ?? new LlmVerifyClient();
    this.stepUp = stepUpService ?? new StepUpService(prisma as any);
  }

  /** Defensive read: a missing/not-yet-migrated table degrades to
   * no rows instead of breaking the whole overview. */
  private async safeFindMany(table: string, args: any): Promise<any[]> {
    try {
      const rows = await (this.prisma as any)[table]?.findMany?.(args);
      return Array.isArray(rows) ? rows : [];
    } catch { return []; }
  }

  private async safeFindUnique(table: string, args: any): Promise<any> {
    try {
      return await (this.prisma as any)[table]?.findUnique?.(args);
    } catch { return null; }
  }

  async getOverview(organizationId: string) {
    const now = new Date();
    const [integrations, socialAccounts, adAccounts, stores, senderConfig, businessProfile, tenantAppConfigs, orgLlmConfig, paymentGateways, platformEnablements] = await Promise.all([
      this.safeFindMany("integration", { where: { organizationId }, orderBy: { createdAt: "asc" } }),
      this.safeFindMany("socialAccount", { where: { organizationId }, orderBy: { createdAt: "asc" } }),
      this.safeFindMany("adAccount", { where: { organizationId }, orderBy: { createdAt: "asc" } }),
      this.safeFindMany("store", { where: { organizationId }, orderBy: { createdAt: "asc" } }),
      this.safeFindUnique("messagingSenderConfig", { where: { organizationId } }),
      this.safeFindUnique("businessProfile", { where: { organizationId } }),
      this.safeFindMany("tenantAppConfig", { where: { organizationId } }),
      this.safeFindUnique("orgLlmConfig", { where: { organizationId } }),
      this.safeFindMany("tenantPaymentGateway", { where: { organizationId }, orderBy: { createdAt: "asc" } }),
      this.safeFindMany("platformPaymentEnablement", { where: { organizationId }, orderBy: { createdAt: "asc" } }),
    ]);
    // CC3: which own-app configs currently exist — an appSource
    // "own" connection whose config was deleted is flagged, since
    // its secret can no longer be resolved for verification /
    // refresh (its stored tokens themselves are untouched).
    const ownAppPlatforms = new Set<string>(tenantAppConfigs.map((c: any) => String(c.platform)));
    const ownFlag = (appSource: unknown, provider: string): { appSource: string; ownAppConfigMissing: boolean } => {
      const source = appSource === "own" ? "own" : "platform";
      const appPlatform = appPlatformForProvider(provider);
      return {
        appSource: source,
        ownAppConfigMissing: source === "own" && appPlatform !== null && !ownAppPlatforms.has(appPlatform),
      };
    };
    await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
    const platformLlm = getPlatformConfigSync().llm;

    const storeNameById = new Map<string, string>(stores.map((s: any) => [s.id, s.name]));
    const byCategory = new Map<string, ConnectionAccount[]>();
    const push = (account: ConnectionAccount) => {
      const list = byCategory.get(account.category) ?? [];
      list.push(account);
      byCategory.set(account.category, list);
    };

    for (const row of integrations) {
      const category = categoryForProvider(row.provider);
      const def = CATEGORY_DEFS.find((d) => d.key === category)!;
      const { health, expiringSoon } = deriveHealth(row, now);
      const storeName = row.storeId ? storeNameById.get(row.storeId) : undefined;
      push({
        id: row.id, source: "integration", category, provider: row.provider,
        displayName: row.label || (storeName ? `${storeName} (${providerLabel(row.provider)})` : providerLabel(row.provider)),
        externalAccountId: row.externalAccountId ?? null,
        status: row.status, lastSyncAt: row.lastSyncAt ?? null, lastError: row.lastError ?? null,
        tokenExpiresAt: row.tokenExpiresAt ?? null, expiringSoon, health,
        isDefault: row.isDefault === true, ...ownFlag(row.appSource, row.provider),
        label: row.label ?? null, groupName: row.groupName ?? null,
        syncPaused: row.syncPaused === true,
        syncIntervalMinutes: typeof row.syncIntervalMinutes === "number" ? row.syncIntervalMinutes : null,
        autoHealEnabled: row.autoHealEnabled !== false,
        providerHealth: row.providerHealth ?? null,
        providerHealthAt: row.providerHealthAt ?? null,
        providerHealthError: row.providerHealthError ?? null,
        deepLink: def.deepLink,
      });
    }

    for (const row of socialAccounts) {
      const { health, expiringSoon } = deriveHealth(row, now);
      push({
        id: row.id, source: "social_account", category: "social", provider: row.platform,
        displayName: row.label || row.name || providerLabel(row.platform),
        externalAccountId: row.externalId ?? null,
        status: row.status, lastSyncAt: null, lastError: row.lastError ?? null,
        tokenExpiresAt: null, expiringSoon, health, isDefault: false,
        ...ownFlag(row.appSource, row.platform),
        label: row.label ?? null, groupName: row.groupName ?? null,
        providerHealth: row.providerHealth ?? null,
        providerHealthAt: row.providerHealthAt ?? null,
        providerHealthError: row.providerHealthError ?? null,
        deepLink: "/dashboard/social-posts",
      });
    }

    for (const row of adAccounts) {
      // AD3: the platform-reported bucket wins when present — it is
      // the platform's own word, never guessed. Absent a bucket, a
      // plain ACTIVE row with no check yet is honestly `unknown`.
      let health: ConnectionHealth;
      if (row.platformStatusBucket === "active") health = "ok";
      else if (row.platformStatusBucket === "disabled" || row.platformStatusBucket === "restricted") health = "error";
      else if (row.platformStatusBucket) health = "unknown";
      else if (row.status && !isConnectedStatus(row.status)) health = "disconnected";
      else health = "unknown";
      push({
        id: row.id, source: "ad_account", category: "ads", provider: row.platform,
        displayName: row.label || row.name || providerLabel(row.platform),
        externalAccountId: row.externalId ?? null,
        status: row.status, lastSyncAt: row.platformStatusCheckedAt ?? null, lastError: null,
        tokenExpiresAt: null, expiringSoon: false, health, isDefault: false,
        providerHealth: row.providerHealth ?? null,
        providerHealthAt: row.providerHealthAt ?? null,
        providerHealthError: row.providerHealthError ?? null,
        platformStatusBucket: row.platformStatusBucket ?? null,
        platformStatusRaw: row.platformStatusRaw ?? null,
        label: row.label ?? null, groupName: row.groupName ?? null,
        syncDisabled: row.syncDisabled === true,
        deepLink: "/dashboard/ad-accounts",
      });
    }

    for (const row of stores) {
      push({
        id: row.id, source: "store", category: "commerce",
        provider: String(row.platform ?? "").toLowerCase(),
        displayName: row.name || providerLabel(String(row.platform ?? "").toLowerCase()),
        externalAccountId: row.url ?? null,
        status: row.isActive === false ? "INACTIVE" : "ACTIVE",
        lastSyncAt: null, lastError: null, tokenExpiresAt: null,
        expiringSoon: false, health: row.isActive === false ? "disconnected" : "ok",
        isDefault: false, deepLink: "/dashboard/integrations",
      });
    }

    if (senderConfig) {
      if (senderConfig.smtpHost) {
        push({
          id: `${senderConfig.id}:smtp`, source: "sender_config", category: "senders", provider: "smtp",
          displayName: senderConfig.fromAddress ? `SMTP · ${senderConfig.fromAddress}` : `SMTP · ${senderConfig.smtpHost}`,
          externalAccountId: senderConfig.smtpHost, status: "CONFIGURED",
          lastSyncAt: null, lastError: null, tokenExpiresAt: null,
          expiringSoon: false, health: "ok", isDefault: false, deepLink: "/dashboard/messaging",
        });
      }
      if (senderConfig.smsGateway) {
        push({
          id: `${senderConfig.id}:sms`, source: "sender_config", category: "senders", provider: "sms",
          displayName: senderConfig.smsSenderId ? `SMS · ${senderConfig.smsSenderId}` : `SMS · ${senderConfig.smsGateway}`,
          externalAccountId: senderConfig.smsGateway, status: "CONFIGURED",
          lastSyncAt: null, lastError: null, tokenExpiresAt: null,
          expiringSoon: false, health: "ok", isDefault: false, deepLink: "/dashboard/messaging",
        });
      }
    }

    // CC8: the tenant's OWN LLM config is a real account in the
    // AI category — when it exists, the org's AI calls that carry
    // an organizationId resolve through it (LlmFactory.forOrg).
    if (orgLlmConfig) {
      const enabled = orgLlmConfig.isEnabled !== false;
      push({
        id: orgLlmConfig.id, source: "org_llm_config", category: "ai", provider: String(orgLlmConfig.provider),
        displayName: `নিজের LLM (${String(orgLlmConfig.provider)})${orgLlmConfig.model ? ` · ${String(orgLlmConfig.model)}` : ""}`,
        externalAccountId: orgLlmConfig.model ?? null,
        status: !enabled ? "DISCONNECTED" : orgLlmConfig.status === "verified" ? "CONNECTED" : "CONFIGURED",
        lastSyncAt: orgLlmConfig.lastVerifiedAt ?? null, lastError: orgLlmConfig.lastError ?? null,
        tokenExpiresAt: null, expiringSoon: false,
        health: !enabled ? "disconnected" : orgLlmConfig.lastError ? "error" : "ok",
        isDefault: false, deepLink: "/dashboard/connections",
      });
    }

    // CC9: the tenant's OWN payment gateways are real accounts in
    // the payment category. The display name carries the honest
    // verification state: "verified" means a real gateway check
    // (bKash grant token); "configured" means stored without a
    // pre-transaction check (SSLCommerz/Nagad offer none).
    for (const gw of paymentGateways) {
      const enabled = gw.isEnabled !== false;
      push({
        id: gw.id, source: "tenant_payment_gateway", category: "payment", provider: String(gw.provider),
        displayName: `${providerLabel(String(gw.provider))} — নিজের গেটওয়ে (${gw.status === "verified" ? "যাচাইকৃত" : "কনফিগার করা"})`,
        externalAccountId: null,
        status: !enabled ? "DISCONNECTED" : gw.status === "verified" ? "CONNECTED" : "CONFIGURED",
        lastSyncAt: gw.lastVerifiedAt ?? null, lastError: gw.lastError ?? null,
        tokenExpiresAt: null, expiringSoon: false,
        health: !enabled ? "disconnected" : gw.lastError ? "error" : "ok",
        isDefault: false, deepLink: "/dashboard/connections",
      });
    }

    // CC10: platform-payment enablement rows are real accounts
    // in the payment category too — the tenant accepts payments
    // through the PLATFORM's gateway and the net lands in their
    // Wallet (see WalletService).
    for (const en of platformEnablements) {
      const enabled = en.isEnabled === true;
      push({
        id: en.id, source: "platform_payment_enablement", category: "payment", provider: String(en.provider),
        displayName: `${providerLabel(String(en.provider))} — প্ল্যাটফর্ম গেটওয়ে (${enabled ? "চালু" : "বন্ধ"})`,
        externalAccountId: null,
        status: enabled ? "CONFIGURED" : "DISCONNECTED",
        lastSyncAt: null, lastError: null,
        tokenExpiresAt: null, expiringSoon: false,
        health: enabled ? "ok" : "disconnected",
        isDefault: false, deepLink: "/dashboard/connections",
      });
    }

    const paymentMethods: string[] = [];
    if (businessProfile?.bkashNumber) paymentMethods.push("বিকাশ");
    if (businessProfile?.nagadNumber) paymentMethods.push("নগদ");
    if (businessProfile?.codAvailable) paymentMethods.push("COD");
    if (businessProfile && paymentMethods.length > 0) {
      push({
        id: businessProfile.id, source: "business_profile", category: "payment", provider: "manual",
        displayName: `ম্যানুয়াল পেমেন্ট (${paymentMethods.join(", ")})`,
        externalAccountId: null, status: "CONFIGURED",
        lastSyncAt: null, lastError: null, tokenExpiresAt: null,
        expiringSoon: false, health: "ok", isDefault: false,
        deepLink: "/dashboard/settings#hub-payment",
      });
    }

    const categories: ConnectionCategory[] = CATEGORY_DEFS.map((def) => {
      const accounts = byCategory.get(def.key) ?? [];
      const connectedCount = accounts.filter((a) => isConnectedStatus(a.status) || a.status === "CONFIGURED").length;
      let status: string;
      let note: string | null = null;
      if (def.key === "ai" && accounts.length === 0) {
        // No per-org LLM config (CC8): the tenant's AI runs on
        // the operator's platform LLM config when present.
        status = platformLlm ? "platform_managed" : "not_configured";
        note = platformLlm ? "ai_platform_managed" : "ai_not_configured";
      } else if (accounts.length === 0) {
        status = "not_configured";
        note = def.key === "payment" ? "payment_manual_not_configured" : "no_accounts";
      } else {
        status = connectedCount > 0 ? "connected" : "disconnected";
      }
      return {
        key: def.key, label: def.label, deepLink: def.deepLink,
        status, note, connectedCount, totalCount: accounts.length, accounts,
      };
    });

    // CC11/CC12: attach each account's latest Doctor run (the
    // first row per target in a createdAt-desc scan) and count
    // unread connection alerts for the header badge. Both reads
    // degrade to empty pre-migration, like every overview source.
    const [healthChecks, unreadAlerts] = await Promise.all([
      this.safeFindMany("connectionHealthCheck", {
        where: { organizationId }, orderBy: { createdAt: "desc" }, take: 500,
      }),
      this.safeFindMany("connectionAlert", { where: { organizationId, readAt: null } }),
    ]);
    const lastCheckByTarget = new Map<string, any>();
    for (const run of healthChecks) {
      const key = `${run.targetType}:${run.targetId}`;
      if (!lastCheckByTarget.has(key)) lastCheckByTarget.set(key, run);
    }

    const allAccounts = categories.flatMap((c) => c.accounts);
    for (const account of allAccounts) {
      const run = lastCheckByTarget.get(`${account.source}:${account.id}`);
      account.lastCheck = run ? { overall: run.overall, at: run.createdAt, trigger: run.trigger } : null;
    }
    return {
      organizationId,
      generatedAt: now,
      summary: {
        totalAccounts: allAccounts.length,
        connectedAccounts: categories.reduce((sum, c) => sum + c.connectedCount, 0),
        errorAccounts: allAccounts.filter((a) => a.health === "error").length,
        unreadAlerts: unreadAlerts.length,
        byCategory: Object.fromEntries(categories.map((c) => [c.key, { connected: c.connectedCount, total: c.totalCount }])),
      },
      categories,
    };
  }

  /**
   * CC2: mark one Integration as the org's default within its
   * category group; the flag is cleared on every sibling row of
   * the same org + category. Audit-logged like other integration
   * changes.
   */
  async setDefault(organizationId: string, actorId: string, integrationId: string) {
    const target = await (this.prisma as any).integration.findFirst({
      where: { id: integrationId, organizationId },
    });
    if (!target) throw new NotFoundException("Integration not found");
    const category = categoryForProvider(target.provider);
    const siblingProviders = category === "other" ? [target.provider] : providersForCategory(category);
    const siblings = await this.safeFindMany("integration", {
      where: { organizationId, provider: { in: siblingProviders } },
    });
    const cleared: string[] = [];
    for (const sibling of siblings) {
      if (sibling.id !== target.id && sibling.isDefault === true) {
        await (this.prisma as any).integration.update({ where: { id: sibling.id }, data: { isDefault: false } });
        cleared.push(sibling.id);
      }
    }
    const updated = await (this.prisma as any).integration.update({
      where: { id: target.id }, data: { isDefault: true },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "integration.default_set",
      entityType: "Integration", entityId: target.id,
      metadata: { provider: target.provider, category, clearedDefaults: cleared },
    });
    return { id: target.id, provider: target.provider, category, isDefault: updated?.isDefault ?? true, clearedDefaults: cleared };
  }

  /**
   * CC2: disconnect ONE integration row — its credential is removed
   * and its status flips to DISCONNECTED (the same end state as
   * IntegrationsService.disconnect). Sibling accounts, including
   * other accounts of the same provider, are untouched.
   */
  async disconnect(organizationId: string, actorId: string, integrationId: string) {
    const target = await (this.prisma as any).integration.findFirst({
      where: { id: integrationId, organizationId },
    });
    if (!target) throw new NotFoundException("Integration not found");
    await (this.prisma as any).integrationCredential.deleteMany({ where: { integrationId: target.id } });
    const updated = await (this.prisma as any).integration.update({
      where: { id: target.id }, data: { status: "DISCONNECTED", isDefault: false },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "integration.disconnect",
      entityType: "Integration", entityId: target.id,
      metadata: { provider: target.provider, via: "connections" },
    });
    return { id: target.id, provider: target.provider, status: updated?.status ?? "DISCONNECTED" };
  }

  // ---------- CC17/CC18: labels, groups, member access, sync ----------

  /** AD6's exact discipline, shared by label + groupName: free
   * text, trimmed; null/empty clears; the 60-char cap applies to
   * the TRIMMED value and rejects (never silently truncates). */
  private cleanShortText(value: unknown, fieldBn: string): string | null {
    if (value === undefined) return undefined as never;
    if (value === null) return null;
    const trimmed = String(value).trim();
    if (trimmed.length > 60) throw new BadRequestException(`${fieldBn} সর্বোচ্চ ৬০ অক্ষরের হতে পারবে।`);
    return trimmed === "" ? null : trimmed;
  }

  private accountTable(source: string): string | null {
    if (source === "integration") return "integration";
    if (source === "social_account") return "socialAccount";
    if (source === "ad_account") return "adAccount";
    return null;
  }

  /**
   * CC17: set/clear an account's display label and/or group
   * name. Applies to the three connection row kinds that carry
   * the fields (Integration, SocialAccount, AdAccount — the last
   * via this same endpoint so the Center has ONE meta editor;
   * the AD6 ads-page editor keeps working on the same column).
   */
  async setAccountMeta(organizationId: string, actorId: string, source: string, targetId: string, dto: { label?: string | null; groupName?: string | null }) {
    const table = this.accountTable(source);
    if (!table) throw new BadRequestException("এই ধরনের অ্যাকাউন্টে লেবেল/গ্রুপ দেওয়া যায় না।");
    const row = await (this.prisma as any)[table].findFirst({ where: { id: targetId, organizationId } });
    if (!row) throw new NotFoundException("Account not found");
    const data: Record<string, unknown> = {};
    if (dto.label !== undefined) data.label = this.cleanShortText(dto.label, "লেবেল");
    if (dto.groupName !== undefined) data.groupName = this.cleanShortText(dto.groupName, "গ্রুপের নাম");
    if (Object.keys(data).length === 0) {
      return { id: row.id, source, label: row.label ?? null, groupName: row.groupName ?? null };
    }
    const updated = await (this.prisma as any)[table].update({ where: { id: row.id }, data });
    await this.audit.log({
      organizationId, userId: actorId, action: "connection.meta_updated",
      entityType: table === "integration" ? "Integration" : table === "socialAccount" ? "SocialAccount" : "AdAccount",
      entityId: row.id,
      metadata: { label: updated.label ?? null, groupName: updated.groupName ?? null },
    });
    return { id: row.id, source, label: updated.label ?? null, groupName: updated.groupName ?? null };
  }

  /** CC18: pause/resume sync for ONE integration. The flag is
   * honoured by the sync entry points (IntegrationsService +
   * ShopifyService skip + record; the manual HTTP triggers
   * refuse with a clear message). */
  async setSyncPaused(organizationId: string, actorId: string, integrationId: string, paused: boolean) {
    const target = await (this.prisma as any).integration.findFirst({
      where: { id: integrationId, organizationId },
    });
    if (!target) throw new NotFoundException("Integration not found");
    const updated = await (this.prisma as any).integration.update({
      where: { id: target.id }, data: { syncPaused: Boolean(paused) },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: paused ? "integration.sync_paused" : "integration.sync_resumed",
      entityType: "Integration", entityId: target.id,
      metadata: { provider: target.provider },
    });
    return { id: target.id, provider: target.provider, syncPaused: updated?.syncPaused ?? Boolean(paused) };
  }

  /** CC30: set/clear ONE integration's scheduled-sync cadence.
   * Only SCHEDULED store syncs honour it (see
   * integrations/sync-cadence.ts); manual triggers ignore it and
   * CC18's pause still wins over it. null clears. */
  async setSyncInterval(organizationId: string, actorId: string, integrationId: string, minutes: number | null) {
    const target = await (this.prisma as any).integration.findFirst({
      where: { id: integrationId, organizationId },
    });
    if (!target) throw new NotFoundException("Integration not found");
    let value: number | null = null;
    if (minutes !== null && minutes !== undefined) {
      const n = Number(minutes);
      if (!Number.isInteger(n) || n < 5 || n > 10080) {
        throw new BadRequestException("Sync ব্যবধান ৫ থেকে ১০০৮০ মিনিটের মধ্যে হতে হবে (বা বন্ধ করতে খালি পাঠান)।");
      }
      value = n;
    }
    const updated = await (this.prisma as any).integration.update({
      where: { id: target.id }, data: { syncIntervalMinutes: value },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: value === null ? "integration.sync_interval_cleared" : "integration.sync_interval_set",
      entityType: "Integration", entityId: target.id,
      metadata: { provider: target.provider, syncIntervalMinutes: value },
    });
    return { id: target.id, provider: target.provider, syncIntervalMinutes: updated?.syncIntervalMinutes ?? value };
  }

  /** CC21 (Connect Center Next): the tenant's auto-healing
   * opt-out for ONE connection. Detection and alerts are NOT
   * affected — only the sweep's repair attempts skip a
   * connection whose tenant turned this off. */
  async setAutoHealEnabled(organizationId: string, actorId: string, integrationId: string, enabled: boolean) {
    const target = await (this.prisma as any).integration.findFirst({
      where: { id: integrationId, organizationId },
    });
    if (!target) throw new NotFoundException("Integration not found");
    const updated = await (this.prisma as any).integration.update({
      where: { id: target.id }, data: { autoHealEnabled: Boolean(enabled) },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: enabled ? "integration.auto_heal_enabled" : "integration.auto_heal_disabled",
      entityType: "Integration", entityId: target.id,
      metadata: { provider: target.provider },
    });
    return { id: target.id, provider: target.provider, autoHealEnabled: updated?.autoHealEnabled ?? Boolean(enabled) };
  }

  /** CC18: recent SyncJob rows for one integration (the real
   * sync history — including CC18's recorded paused skips, whose
   * error field carries the "sync_paused" reason). */
  async listSyncHistory(organizationId: string, integrationId: string, limit = 20) {
    const target = await (this.prisma as any).integration.findFirst({
      where: { id: integrationId, organizationId },
    });
    if (!target) throw new NotFoundException("Integration not found");
    const take = Math.min(100, Math.max(1, Math.round(Number(limit) || 20)));
    const rows = await this.safeFindMany("syncJob", {
      where: { integrationId: target.id }, orderBy: { startedAt: "desc" }, take,
    });
    return {
      integrationId: target.id, provider: target.provider, syncPaused: target.syncPaused === true,
      syncIntervalMinutes: typeof target.syncIntervalMinutes === "number" ? target.syncIntervalMinutes : null,
      jobs: rows.map((j: any) => ({
        id: j.id, kind: j.kind, status: j.status,
        fetched: j.fetched ?? 0, created: j.created ?? 0, updated: j.updated ?? 0, skipped: j.skipped ?? 0,
        error: j.error ?? null, startedAt: j.startedAt, completedAt: j.completedAt ?? null,
      })),
    };
  }

  /**
   * CC17: the member × account restriction matrix for the
   * Center: every ACTIVE member with their stored deny-list,
   * plus the org's deniable targets (Integration + SocialAccount
   * rows — the things a member SENDS/POSTS through).
   * CC27 (Connect Center Next): AdAccount rows are deniable
   * targets too — the ads module's manual sync triggers and the
   * campaigns module's publish/activate actions enforce them
   * for the acting member (AD5's per-account syncDisabled is a
   * different, account-level switch and stays as it was).
   */
  async getMemberAccessMatrix(organizationId: string) {
    const p: any = this.prisma as any;
    const [members, integrations, socialAccounts, adAccounts] = await Promise.all([
      this.safeFindMany("membership", { where: { organizationId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } }),
      this.safeFindMany("integration", { where: { organizationId }, orderBy: { createdAt: "asc" } }),
      this.safeFindMany("socialAccount", { where: { organizationId }, orderBy: { createdAt: "asc" } }),
      this.safeFindMany("adAccount", { where: { organizationId }, orderBy: { createdAt: "asc" } }),
    ]);
    const userIds = [...new Set(members.map((m: any) => m.userId))];
    const users = userIds.length
      ? await this.safeFindMany("user", { where: { id: { in: userIds } } })
      : [];
    const userById = new Map(users.map((u: any) => [u.id, u]));
    const targets = [
      ...integrations.map((r: any) => ({
        id: r.id, source: "integration", category: categoryForProvider(r.provider), provider: r.provider,
        displayName: r.label || providerLabel(r.provider), groupName: r.groupName ?? null,
      })),
      ...socialAccounts.map((r: any) => ({
        id: r.id, source: "social_account", category: "social", provider: r.platform,
        displayName: r.label || r.name || providerLabel(r.platform), groupName: r.groupName ?? null,
      })),
      ...adAccounts.map((r: any) => ({
        id: r.id, source: "ad_account", category: "ads", provider: r.platform,
        displayName: r.label || r.name || providerLabel(r.platform), groupName: r.groupName ?? null,
      })),
    ];
    return {
      targets,
      members: members.map((m: any) => {
        const u: any = userById.get(m.userId);
        return {
          userId: m.userId, role: m.role,
          name: u?.name ?? null, email: u?.email ?? null,
          // The OWNER's list is reported empty by definition —
          // M72 semantics: restrictions never apply to the owner.
          deniedConnectionIds: m.role === "OWNER" ? [] : normalizeDeniedConnections(m.deniedConnections),
        };
      }),
    };
  }

  /**
   * CC17: replace one member's connection deny-list. OWNER/
   * ADMIN only (controller); the OWNER member's own list can
   * never be set (same refusal as M72's updateMemberAccess).
   * Every id must be a real connection target of THIS org —
   * unknown ids are refused, never stored.
   */
  async setMemberDeniedConnections(organizationId: string, actorId: string, targetUserId: string, deniedIdsRaw: unknown) {
    const p: any = this.prisma as any;
    const target = await p.membership.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId } },
    });
    if (!target) throw new NotFoundException("That user is not a member of this organization");
    if (target.role === "OWNER") {
      throw new BadRequestException("Owner-এর অ্যাক্সেস সীমাবদ্ধ করা যায় না — owner সবসময় সব কানেকশন ব্যবহার করতে পারবেন।");
    }
    const denied = normalizeDeniedConnections(deniedIdsRaw);
    if (denied.length > 0) {
      const [integrations, socialAccounts, adAccounts] = await Promise.all([
        this.safeFindMany("integration", { where: { organizationId, id: { in: denied } } }),
        this.safeFindMany("socialAccount", { where: { organizationId, id: { in: denied } } }),
        this.safeFindMany("adAccount", { where: { organizationId, id: { in: denied } } }),
      ]);
      const known = new Set([...integrations, ...socialAccounts, ...adAccounts].map((r: any) => r.id));
      const unknown = denied.filter((id) => !known.has(id));
      if (unknown.length) {
        throw new BadRequestException(`এই কানেকশনগুলো পাওয়া যায়নি: ${unknown.join(", ")}`);
      }
    }
    const before = normalizeDeniedConnections(target.deniedConnections);
    await p.membership.update({ where: { id: target.id }, data: { deniedConnections: denied } });
    await this.audit.log({
      organizationId, userId: actorId, action: "connections.member_access_updated",
      entityType: "Membership", entityId: target.id,
      metadata: { targetUserId, deniedAdded: denied.filter((d) => !before.includes(d)), deniedRemoved: before.filter((d) => !denied.includes(d)), deniedConnectionIds: denied },
    });
    return { userId: targetUserId, role: target.role, deniedConnectionIds: denied };
  }

  // ---------- CC3: the tenant's OWN app configs ----------

  /** The only shape an app config ever leaves this API in: the
   * app id and verification state — the secret is not even read. */
  private appConfigView(row: any) {
    return {
      platform: row.platform,
      appId: row.appId,
      status: row.status,
      lastVerifiedAt: row.lastVerifiedAt ?? null,
      lastError: row.lastError ?? null,
      // Honest verification semantics per platform: a Meta row
      // exists only after a REAL Graph API confirmation, while
      // TikTok/Google/LinkedIn offer no credential check usable
      // before OAuth — their rows are "configured" and are first
      // truly verified when the OAuth token exchange succeeds.
      verificationNote: row.platform === "meta" ? "verified_with_meta" : "verified_at_first_connect",
      // CC28: for google/linkedin the tenant must register these
      // EXACT redirect URIs in their own provider console, or
      // OAuth against their app cannot complete — the view
      // carries them so the UI can show them next to the form.
      ...(row.platform === "google" ? { redirectUris: googleOwnAppRedirectUris() } : {}),
      ...(row.platform === "linkedin" ? { redirectUris: [socialOAuthRedirectUri("linkedin")] } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async listAppConfigs(organizationId: string) {
    const rows = await this.safeFindMany("tenantAppConfig", {
      where: { organizationId }, orderBy: { createdAt: "asc" },
    });
    return {
      configs: rows.map((r: any) => this.appConfigView(r)),
      // CC28: the own-app registration guides are returned even
      // before any config exists, so a tenant setting up their
      // own Google/LinkedIn app sees the redirect URIs they must
      // register FIRST (an unregistered URI fails OAuth).
      ownAppGuides: {
        google: { redirectUris: googleOwnAppRedirectUris() },
        linkedin: { redirectUris: [socialOAuthRedirectUri("linkedin")] },
      },
    };
  }

  /**
   * Verify-before-save, per platform:
   * - meta: a REAL Graph API app lookup with the app access token
   *   (appId|appSecret) must succeed first. Meta's own error is
   *   surfaced as a clean 400 and NOTHING is saved.
   * - tiktok: TikTok has NO credential-check endpoint usable
   *   without a user authorization code (its token endpoint
   *   requires a code or a refresh token — see tiktok.client.ts),
   *   so the config is saved as "configured", honestly unverified;
   *   the first OAuth connect is its real verification.
   * - google (CC28): an OAuth client's credentials likewise
   *   cannot be checked before an authorization flow exists, so
   *   the same honesty pattern applies: client-id FORMAT (every
   *   Google OAuth client id ends .apps.googleusercontent.com)
   *   + secret presence are validated, the row is saved as
   *   "configured", and the first OAuth connect is the real
   *   verification. The response carries the redirect URIs the
   *   tenant must register in Google Cloud (appConfigView).
   * - linkedin (CC28): same pattern — presence only, "configured",
   *   verified at first connect; the view carries the callback
   *   URL to register in the LinkedIn app.
   * The secret is sealed (encryptJson, { appSecret }) at rest.
   *
   * CC28 META SECRET ROTATION: saving meta with the SAME appId
   * as the existing config but a DIFFERENT secret is a rotation.
   * The new secret is verified with Meta first (a bad secret
   * saves nothing, exactly like a first save), then ONLY the
   * config's sealed secret is replaced — no Integration or
   * SocialAccount row is touched, because app-secret rotation
   * does not invalidate page/user access tokens (they are not
   * derived from the app secret), and webhook signature checks
   * resolve the CURRENT config secret, so they follow the
   * rotation automatically. Recorded as the distinct audit
   * action app_config.secret_rotated and flagged `rotated` in
   * the response so the UI can say reconnect is not needed.
   */
  async putAppConfig(organizationId: string, actorId: string, platform: string, dto: { appId: string; appSecret: string }) {
    if (!["meta", "tiktok", "google", "linkedin"].includes(platform)) {
      throw new BadRequestException("platform must be meta, tiktok, google or linkedin");
    }
    const appId = (dto?.appId ?? "").trim();
    const appSecret = (dto?.appSecret ?? "").trim();
    if (!appId || !appSecret) {
      throw new BadRequestException("App ID (বা Client Key) ও App Secret দুটোই প্রয়োজন।");
    }
    if (platform === "google" && !appId.endsWith(".apps.googleusercontent.com")) {
      throw new BadRequestException("Google Client ID-এর ফরম্যাট সঠিক নয় — Google Cloud Console-এর OAuth Client ID সাধারণত '.apps.googleusercontent.com' দিয়ে শেষ হয়। সঠিক Client ID টি কপি করে আবার চেষ্টা করুন।");
    }

    const existing = await (this.prisma as any).tenantAppConfig.findFirst({
      where: { organizationId, platform },
    });

    let status = "configured";
    let lastVerifiedAt: Date | null = null;
    let rotated = false;
    if (platform === "meta") {
      await this.metaApp.verifyApp(appId, appSecret).catch((e) => {
        throw new BadRequestException(e instanceof Error ? e.message : "Meta app verification failed");
      });
      status = "verified";
      lastVerifiedAt = new Date();
      if (existing && existing.appId === appId) {
        const before = decryptJson<{ appSecret?: string }>(existing.encryptedSecret);
        rotated = !!before?.appSecret && before.appSecret !== appSecret;
      }
    }

    const data = {
      appId, encryptedSecret: encryptJson({ appSecret }),
      status, lastVerifiedAt, lastError: null,
    };
    const row = existing
      ? await (this.prisma as any).tenantAppConfig.update({ where: { id: existing.id }, data })
      : await (this.prisma as any).tenantAppConfig.create({ data: { organizationId, platform, ...data } });
    await this.audit.log({
      organizationId, userId: actorId,
      action: rotated ? "app_config.secret_rotated" : "tenant_app_config.saved",
      entityType: "TenantAppConfig", entityId: row.id,
      metadata: { platform, status, ...(rotated ? { rotated: true } : {}) },
    });
    return { ...this.appConfigView(row), ...(rotated ? { rotated: true } : {}) };
  }

  /**
   * Remove an own-app config. Connections already made with it
   * keep their stored tokens and keep working; the overview flags
   * those rows (ownAppConfigMissing) because verification /
   * refresh can no longer resolve this app's secret.
   */
  async deleteAppConfig(organizationId: string, actorId: string, platform: string, totpCode?: string | null) {
    if (!["meta", "tiktok", "google", "linkedin"].includes(platform)) {
      throw new BadRequestException("platform must be meta, tiktok, google or linkedin");
    }
    // CC23: deleting the tenant's own app config is a sensitive
    // action — TOTP step-up runs BEFORE anything is deleted
    // (a refused check changes nothing).
    const stepUp = await this.stepUp.check(actorId, totpCode);
    const existing = await (this.prisma as any).tenantAppConfig.findFirst({
      where: { organizationId, platform },
    });
    if (!existing) throw new NotFoundException("App config not found");
    await (this.prisma as any).tenantAppConfig.delete({ where: { id: existing.id } });
    await this.audit.log({
      organizationId, userId: actorId, action: "tenant_app_config.deleted",
      entityType: "TenantAppConfig", entityId: existing.id,
      metadata: { platform, stepUp },
    });
    return { platform, deleted: true, ...stepUpMarker(stepUp) };
  }

  // ---------- CC8: the tenant's OWN LLM key ----------

  /** The only shape an LLM config ever leaves this API in: the
   * provider/model and verification state — the key is not even
   * read here (only its sealed presence is known from the row). */
  private llmConfigView(row: any) {
    return {
      provider: row.provider,
      model: row.model ?? null,
      status: row.status,
      isEnabled: row.isEnabled !== false,
      lastVerifiedAt: row.lastVerifiedAt ?? null,
      lastError: row.lastError ?? null,
      verificationNote: "verified_with_provider",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async getLlmConfig(organizationId: string) {
    const row = await this.safeFindUnique("orgLlmConfig", { where: { organizationId } });
    return { config: row ? this.llmConfigView(row) : null };
  }

  /**
   * Verify-before-save: a REAL minimal completion through the
   * chosen provider must succeed first. The provider's own error
   * is surfaced as a clean 400 and NOTHING is saved. On success
   * the row is "verified" and the key is sealed (encryptJson,
   * { apiKey }) at rest.
   */
  async putLlmConfig(organizationId: string, actorId: string, dto: { provider: string; apiKey: string; model?: string }) {
    const provider = String(dto?.provider ?? "").trim().toLowerCase();
    const apiKey = String(dto?.apiKey ?? "").trim();
    const model = dto?.model?.trim() ? dto.model.trim() : null;
    if (!["openai", "anthropic", "gemini"].includes(provider)) {
      throw new BadRequestException("provider must be openai | anthropic | gemini");
    }
    if (!apiKey) throw new BadRequestException("API Key প্রয়োজন।");
    await this.llmVerify.verifyKey(provider, apiKey, model ?? undefined).catch((e) => {
      throw new BadRequestException(e instanceof Error ? e.message : "LLM key verification failed");
    });
    const data = {
      provider, model, encryptedData: encryptJson({ apiKey }),
      status: "verified", isEnabled: true, lastVerifiedAt: new Date(), lastError: null,
    };
    const existing = await (this.prisma as any).orgLlmConfig.findUnique({ where: { organizationId } }).catch(() => null);
    const row = existing
      ? await (this.prisma as any).orgLlmConfig.update({ where: { id: existing.id }, data })
      : await (this.prisma as any).orgLlmConfig.create({ data: { organizationId, ...data } });
    await this.audit.log({
      organizationId, userId: actorId, action: "org_llm_config.saved",
      entityType: "OrgLlmConfig", entityId: row.id,
      metadata: { provider, status: "verified" },
    });
    return this.llmConfigView(row);
  }

  /**
   * Remove the own LLM key: the org's AI calls fall back to the
   * platform LLM resolution, exactly as before CC8.
   */
  async deleteLlmConfig(organizationId: string, actorId: string) {
    const existing = await this.safeFindUnique("orgLlmConfig", { where: { organizationId } });
    if (!existing) throw new NotFoundException("LLM config not found");
    await (this.prisma as any).orgLlmConfig.delete({ where: { id: existing.id } });
    await this.audit.log({
      organizationId, userId: actorId, action: "org_llm_config.deleted",
      entityType: "OrgLlmConfig", entityId: existing.id,
      metadata: { provider: existing.provider },
    });
    return { deleted: true };
  }
}
