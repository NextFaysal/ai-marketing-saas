import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ensurePlatformConfig, getPlatformConfigSync } from "../common/platform-config";
import { encryptJson } from "../integrations/crypto";
import { MetaAppClient } from "./meta-app.client";
import { LlmVerifyClient } from "./llm-verify.client";

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
  social: ["meta_social", "tiktok_social", "youtube_social"],
  ads: ["meta", "google_ads", "tiktok"],
  commerce: ["woocommerce", "shopify"],
  courier: ["steadfast", "pathao", "redx"],
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() metaAppClient?: MetaAppClient,
    @Optional() llmVerifyClient?: LlmVerifyClient,
  ) {
    this.metaApp = metaAppClient ?? new MetaAppClient();
    this.llmVerify = llmVerifyClient ?? new LlmVerifyClient();
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
        displayName: storeName ? `${storeName} (${providerLabel(row.provider)})` : providerLabel(row.provider),
        externalAccountId: row.externalAccountId ?? null,
        status: row.status, lastSyncAt: row.lastSyncAt ?? null, lastError: row.lastError ?? null,
        tokenExpiresAt: row.tokenExpiresAt ?? null, expiringSoon, health,
        isDefault: row.isDefault === true, ...ownFlag(row.appSource, row.provider), deepLink: def.deepLink,
      });
    }

    for (const row of socialAccounts) {
      const { health, expiringSoon } = deriveHealth(row, now);
      push({
        id: row.id, source: "social_account", category: "social", provider: row.platform,
        displayName: row.name || providerLabel(row.platform),
        externalAccountId: row.externalId ?? null,
        status: row.status, lastSyncAt: null, lastError: row.lastError ?? null,
        tokenExpiresAt: null, expiringSoon, health, isDefault: false,
        ...ownFlag(row.appSource, row.platform), deepLink: "/dashboard/social-posts",
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

    const allAccounts = categories.flatMap((c) => c.accounts);
    return {
      organizationId,
      generatedAt: now,
      summary: {
        totalAccounts: allAccounts.length,
        connectedAccounts: categories.reduce((sum, c) => sum + c.connectedCount, 0),
        errorAccounts: allAccounts.filter((a) => a.health === "error").length,
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
      // TikTok offers no credential check usable before OAuth —
      // its rows are "configured" and are first truly verified
      // when the OAuth token exchange succeeds.
      verificationNote: row.platform === "tiktok" ? "verified_at_first_connect" : "verified_with_meta",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async listAppConfigs(organizationId: string) {
    const rows = await this.safeFindMany("tenantAppConfig", {
      where: { organizationId }, orderBy: { createdAt: "asc" },
    });
    return { configs: rows.map((r: any) => this.appConfigView(r)) };
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
   * The secret is sealed (encryptJson, { appSecret }) at rest.
   */
  async putAppConfig(organizationId: string, actorId: string, platform: string, dto: { appId: string; appSecret: string }) {
    if (!["meta", "tiktok"].includes(platform)) {
      throw new BadRequestException("platform must be meta or tiktok");
    }
    const appId = (dto?.appId ?? "").trim();
    const appSecret = (dto?.appSecret ?? "").trim();
    if (!appId || !appSecret) {
      throw new BadRequestException("App ID (বা Client Key) ও App Secret দুটোই প্রয়োজন।");
    }

    let status = "configured";
    let lastVerifiedAt: Date | null = null;
    if (platform === "meta") {
      await this.metaApp.verifyApp(appId, appSecret).catch((e) => {
        throw new BadRequestException(e instanceof Error ? e.message : "Meta app verification failed");
      });
      status = "verified";
      lastVerifiedAt = new Date();
    }

    const data = {
      appId, encryptedSecret: encryptJson({ appSecret }),
      status, lastVerifiedAt, lastError: null,
    };
    const existing = await (this.prisma as any).tenantAppConfig.findFirst({
      where: { organizationId, platform },
    });
    const row = existing
      ? await (this.prisma as any).tenantAppConfig.update({ where: { id: existing.id }, data })
      : await (this.prisma as any).tenantAppConfig.create({ data: { organizationId, platform, ...data } });
    await this.audit.log({
      organizationId, userId: actorId, action: "tenant_app_config.saved",
      entityType: "TenantAppConfig", entityId: row.id,
      metadata: { platform, status },
    });
    return this.appConfigView(row);
  }

  /**
   * Remove an own-app config. Connections already made with it
   * keep their stored tokens and keep working; the overview flags
   * those rows (ownAppConfigMissing) because verification /
   * refresh can no longer resolve this app's secret.
   */
  async deleteAppConfig(organizationId: string, actorId: string, platform: string) {
    if (!["meta", "tiktok"].includes(platform)) {
      throw new BadRequestException("platform must be meta or tiktok");
    }
    const existing = await (this.prisma as any).tenantAppConfig.findFirst({
      where: { organizationId, platform },
    });
    if (!existing) throw new NotFoundException("App config not found");
    await (this.prisma as any).tenantAppConfig.delete({ where: { id: existing.id } });
    await this.audit.log({
      organizationId, userId: actorId, action: "tenant_app_config.deleted",
      entityType: "TenantAppConfig", entityId: existing.id,
      metadata: { platform },
    });
    return { platform, deleted: true };
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
