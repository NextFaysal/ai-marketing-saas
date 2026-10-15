import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ProviderHealthService } from "./provider-health.service";
import { dayBucket, webhookSummary } from "./connection-monitor.service";
import { MetaTokenExchangeClient } from "./meta-token-exchange.client";
import { resolveTenantAppConfig } from "./tenant-app-config";
import { decryptJson, encryptJson } from "../integrations/crypto";
import { ensurePlatformConfig, getPlatformConfigSync } from "../common/platform-config";

/**
 * CC21 (Connect Center Next) — auto-healing inside the
 * monitoring sweep.
 *
 * Scope, deliberately narrow. Two repairs are attempted:
 *
 * (b) Commerce webhook re-registration (WooCommerce / Shopify)
 * through the EXISTING EC2/CC16 registrars
 * (ProviderHealthService.repairWebhooks) when the store's
 * STORED webhook record (Integration.webhookStatus) shows a
 * topic failed / error / missing / not_registered. Healing
 * happens only on that real detected breakage — never
 * speculatively, never on a schedule of its own.
 *
 * (a) Meta long-lived-token exchange (B10.5) — see
 * autoHealMetaTokens below. As originally shipped in B10 this
 * half was NOT attempted: the tree had no fb_exchange_token
 * seam (see the B10 acceptance gap analysis, kept verbatim
 * there). B10.5 builds that seam properly
 * (MetaTokenExchangeClient) and wires it here with the same
 * attempt/result recording discipline.
 *
 * NOT attempted, by design (see the B10 acceptance doc):
 * - Meta app-level webhook subscriptions: those belong to the
 *   operator's Meta app, not to a tenant connection — there
 *   is no per-connection registrar to call.
 * - Anything whose "repair" would be a guess (password
 *   changes, revoked apps, scope loss): detection + alert
 *   only, exactly as CC12 left it.
 *
 * Discipline:
 * - Caps: at most ONE attempt per target per sweep (this
 *   method visits each target once) and at most 3 attempts
 *   per target per day, counted from the REAL attempt audit
 *   rows — not from an in-memory counter.
 * - Every attempt and its outcome are audit rows
 *   (connection.auto_heal.webhook_attempt / _result) against
 *   the Integration, so they appear in the CC13 timeline.
 * - Opt-out: Integration.autoHealEnabled === false skips the
 *   connection entirely (detection/alerts are unaffected —
 *   they live in the monitor, not here).
 * - A failed repair never throws into the sweep: the outcome
 *   is recorded and the normal CC12 alert machine reports the
 *   still-broken state.
 */

export const HEAL_MAX_ATTEMPTS_PER_DAY = 3;
export const HEAL_ATTEMPT_ACTION = "connection.auto_heal.webhook_attempt";

/** CC21a (B10.5): Meta token exchange discipline. ONE attempt
 * per target per day — an exchange is cheap for Meta to refuse
 * and pointless to repeat within a day; the count comes from
 * the real recorded attempt rows, exactly like the webhook cap. */
export const META_TOKEN_HEAL_MAX_ATTEMPTS_PER_DAY = 1;
export const META_TOKEN_ATTEMPT_ACTION = "connection.auto_heal.meta_token_attempt";
export const META_TOKEN_RESULT_ACTION = "connection.auto_heal.meta_token_result";

/** Messaging providers whose Integration credential carries a
 * Meta token (the connectMessaging channels). Ads ("meta") and
 * social ("meta_social") integrations are NOT sweep targets in
 * their own right — social tokens are reached through their
 * SocialAccount below. */
const META_MESSAGING_PROVIDERS = new Set(["whatsapp", "messenger", "instagram"]);
/** SocialAccount platforms whose token is a Meta token. (The
 * task brief said "facebook_page"; this tree's platform name
 * for a Facebook Page account is "meta_page" —
 * SOCIAL_ACCOUNT_PLATFORMS in social/social.constants.ts.) */
const META_SOCIAL_PLATFORMS = new Set(["meta_page", "instagram"]);

export interface MetaTokenHealTargetResult {
  targetType: "integration" | "social_account";
  targetId: string;
  provider: string;
  outcome: "healed" | "error" | "skipped_opt_out" | "skipped_daily_cap" | "skipped_no_app_credentials" | "skipped_no_token" | "skipped_no_longer_expiring";
  detail?: string;
}

/** The expiry a Meta target's STORED records actually carry:
 * the credential's own expiresAt (epoch ms — the SocialOAuth
 * credential shape) wins; the Integration row's tokenExpiresAt
 * column is the fallback. Nothing else is a stored expiry —
 * when neither exists the token has no recorded expiry and is
 * never a healing target (no guessing, no probe calls). */
export function metaStoredTokenExpiry(integration: any, cred: Record<string, any> | null): Date | null {
  const raw = cred?.expiresAt;
  const ms = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (Number.isFinite(ms) && ms > 0) return new Date(ms);
  if (integration?.tokenExpiresAt) {
    const d = new Date(integration.tokenExpiresAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** In-window = the sweep's expiring_3 / expiring_1 buckets
 * (dayBucket ≤ 3) or already past (bucket ≤ 0 — "just expired";
 * whether a just-expired token can still be exchanged is for
 * the exchange call itself to decide, per Meta's rules). */
export function metaTokenInHealWindow(expiry: Date | null, now: Date): boolean {
  const bucket = dayBucket(expiry, now);
  return bucket !== null && bucket <= 3;
}

const COMMERCE_PROVIDERS = new Set(["woocommerce", "shopify"]);

export interface HealTargetResult {
  integrationId: string;
  provider: string;
  outcome: "healed" | "still_bad" | "error" | "skipped_opt_out" | "skipped_daily_cap";
  detail?: string;
}

@Injectable()
export class ConnectionHealingService {
  private readonly metaExchange: MetaTokenExchangeClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly providerHealth?: ProviderHealthService,
    @Optional() metaExchangeClient?: MetaTokenExchangeClient,
  ) {
    this.metaExchange = metaExchangeClient ?? new MetaTokenExchangeClient();
  }

  /** Attempts already recorded TODAY for one target (real
   * audit rows — the cap survives restarts and is auditable). */
  async attemptsToday(organizationId: string, integrationId: string, now = new Date()): Promise<number> {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const rows = await (this.prisma as any).auditLog.findMany({
      where: {
        organizationId, action: HEAL_ATTEMPT_ACTION, entityId: integrationId,
        createdAt: { gte: start },
      },
      select: { id: true },
    }).catch(() => []);
    return Array.isArray(rows) ? rows.length : 0;
  }

  /**
   * One healing pass over the org's commerce integrations.
   * Returns per-target outcomes + counts for the sweep summary.
   */
  async autoHealCommerceWebhooks(organizationId: string, now = new Date()): Promise<{
    attempted: number; healed: number; results: HealTargetResult[];
  }> {
    const integrations = await (this.prisma as any).integration.findMany({
      where: { organizationId },
    }).catch(() => []);
    const results: HealTargetResult[] = [];
    let attempted = 0;
    let healed = 0;

    for (const integration of integrations ?? []) {
      if (!COMMERCE_PROVIDERS.has(String(integration.provider))) continue;
      if (!webhookSummary(integration.webhookStatus).bad) continue;
      const base: HealTargetResult = { integrationId: integration.id, provider: String(integration.provider), outcome: "still_bad" };
      if (integration.autoHealEnabled === false) {
        results.push({ ...base, outcome: "skipped_opt_out" });
        continue;
      }
      const prior = await this.attemptsToday(organizationId, integration.id, now);
      if (prior >= HEAL_MAX_ATTEMPTS_PER_DAY) {
        results.push({ ...base, outcome: "skipped_daily_cap", detail: `${prior} attempts already recorded today` });
        continue;
      }
      if (!this.providerHealth) {
        results.push({ ...base, outcome: "error", detail: "Provider health service unavailable" });
        continue;
      }
      attempted++;
      await this.audit.log({
        organizationId, userId: "connection-sweep", action: HEAL_ATTEMPT_ACTION,
        entityType: "Integration", entityId: integration.id,
        metadata: { provider: integration.provider, attemptOfDay: prior + 1, maxPerDay: HEAL_MAX_ATTEMPTS_PER_DAY },
      }).catch(() => undefined);
      let outcome: HealTargetResult["outcome"] = "still_bad";
      let detail: string | undefined;
      try {
        const repair = await this.providerHealth.repairWebhooks(organizationId, "connection-sweep", integration.id);
        const fresh = await (this.prisma as any).integration.findFirst({
          where: { id: integration.id, organizationId },
        }).catch(() => null);
        const statusAfter = fresh?.webhookStatus ?? repair?.webhookStatus ?? null;
        if (!webhookSummary(statusAfter).bad) { outcome = "healed"; healed++; }
        else detail = `webhook record still reports: ${webhookSummary(statusAfter).summary ?? "unknown"}`;
      } catch (e) {
        outcome = "error";
        detail = e instanceof Error ? e.message : String(e);
      }
      await this.audit.log({
        organizationId, userId: "connection-sweep", action: "connection.auto_heal.webhook_result",
        entityType: "Integration", entityId: integration.id,
        metadata: { provider: integration.provider, outcome, ...(detail ? { detail } : {}) },
      }).catch(() => undefined);
      results.push({ ...base, outcome, ...(detail ? { detail } : {}) });
    }
    return { attempted, healed, results };
  }

  // ---------------------------------------------------------------
  // CC21a (B10.5) — Meta long-lived-token auto-refresh
  // ---------------------------------------------------------------

  /**
   * Resolve the Meta app credentials a target's exchange must
   * run under, through the EXISTING appSource machinery — the
   * same resolvers the connect paths use, no duplicated logic:
   * - appSource "own" → the tenant's TenantAppConfig (meta) via
   *   resolveTenantAppConfig (CC3's shared reader);
   * - otherwise → the platform metaAppConfig (M33) from the
   *   platform-config snapshot.
   * Returns null when neither side yields a complete
   * (appId, appSecret) pair — the caller then makes NO attempt.
   */
  private async resolveMetaAppCreds(organizationId: string, appSource: string): Promise<{ appId: string; appSecret: string; source: "own" | "platform" } | null> {
    if (appSource === "own") {
      const own = await resolveTenantAppConfig(this.prisma as any, organizationId, "meta").catch(() => null);
      if (own?.appId && own?.appSecret) return { appId: own.appId, appSecret: own.appSecret, source: "own" };
      return null;
    }
    await ensurePlatformConfig(this.prisma as any).catch(() => undefined);
    const metaApp = getPlatformConfigSync().metaApp;
    if (metaApp?.appId && metaApp?.appSecret) return { appId: metaApp.appId, appSecret: metaApp.appSecret, source: "platform" };
    return null;
  }

  /** Meta-token attempts already recorded TODAY for one target
   * entity (real audit rows — the 1/day cap). */
  private async metaTokenAttemptsToday(organizationId: string, entityId: string, now: Date): Promise<number> {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const rows = await (this.prisma as any).auditLog.findMany({
      where: {
        organizationId, action: META_TOKEN_ATTEMPT_ACTION, entityId,
        createdAt: { gte: start },
      },
      select: { id: true },
    }).catch(() => []);
    return Array.isArray(rows) ? rows.length : 0;
  }

  private decryptCredential(integration: any): Record<string, any> | null {
    const stored = integration?.credential?.encryptedData;
    if (!stored) return null;
    try {
      const cred = decryptJson<Record<string, any>>(stored);
      return cred && typeof cred === "object" ? cred : null;
    } catch {
      return null;
    }
  }

  /**
   * One Meta-token healing pass over the org's Meta targets.
   *
   * Targets (a target = the token's owner-facing identity, so
   * attempts/caps/audit land where the CC13 timeline reads them):
   * - messaging Integrations (whatsapp / messenger / instagram)
   *   in CONNECTED status — the token lives in the integration's
   *   own sealed credential;
   * - SocialAccounts on meta_page / instagram in "connected"
   *   status — the token lives in the LINKED integration's
   *   sealed credential (that is where every connect path wrote
   *   it; the account row itself carries no credential).
   *
   * A target is attempted ONLY when its STORED expiry
   * (metaStoredTokenExpiry) sits inside the expiring_3 /
   * expiring_1 window or is already past. No stored expiry = no
   * attempt: unlike commerce webhooks there is no stored
   * breakage record to act on, and inventing a probe-driven
   * trigger would make the sweep call Meta for every healthy
   * account on every run. (Practical consequence, stated
   * plainly: today's connect paths record a Meta token's expiry
   * only when the platform supplied one, so in practice this
   * pass maintains tokens whose expiry IS on record — including
   * every token this pass itself has exchanged, which is
   * written back with its fresh expiry.)
   *
   * Opt-out: SocialAccount has no autoHealEnabled column (CC21b
   * put the switch on Integration, and the Connect Center only
   * exposes it on integration cards). The token a social account
   * uses lives on its linked Integration, so THAT row's
   * autoHealEnabled governs the account too — setting it false
   * on the integration opts both identities out. Messaging
   * integrations are governed by their own row, exactly like
   * webhook healing. Detection/alerts are unaffected either way.
   *
   * On success the new token is sealed into the SAME credential
   * record, with every other stored field preserved verbatim,
   * and the stored expiry moves to now + expires_in (or to
   * "no expiry recorded" when Meta returns none — the Shopify
   * exchange precedent). On ANY failure nothing is written
   * before the exchange returns, so the stored credential stays
   * byte-identical and the normal CC12 alert flow reports the
   * still-expiring state; the failed attempt is recorded, never
   * hidden. A failure never throws into the sweep.
   */
  async autoHealMetaTokens(organizationId: string, now = new Date()): Promise<{
    attempted: number; healed: number; skippedNoAppCredentials: number; results: MetaTokenHealTargetResult[];
  }> {
    const prisma = this.prisma as any;
    const integrations = await prisma.integration.findMany({
      where: { organizationId }, include: { credential: true },
    }).catch(() => []);
    const integrationById = new Map<string, any>((integrations ?? []).map((i: any) => [i.id, i]));
    const socialAccounts = await prisma.socialAccount.findMany({
      where: { organizationId },
    }).catch(() => []);

    interface Candidate {
      targetType: "integration" | "social_account";
      targetId: string;
      provider: string;
      integration: any;
      account: any | null;
    }
    const candidates: Candidate[] = [];
    for (const integration of integrations ?? []) {
      if (!META_MESSAGING_PROVIDERS.has(String(integration.provider))) continue;
      if (String(integration.status) !== "CONNECTED") continue;
      candidates.push({ targetType: "integration", targetId: integration.id, provider: String(integration.provider), integration, account: null });
    }
    for (const account of socialAccounts ?? []) {
      if (!META_SOCIAL_PLATFORMS.has(String(account.platform))) continue;
      if (String(account.status) !== "connected") continue;
      const integration = account.integrationId ? integrationById.get(account.integrationId) : null;
      if (!integration) continue;
      candidates.push({ targetType: "social_account", targetId: account.id, provider: String(account.platform), integration, account });
    }

    const results: MetaTokenHealTargetResult[] = [];
    let attempted = 0;
    let healed = 0;
    let skippedNoAppCredentials = 0;

    for (const cand of candidates) {
      const base: MetaTokenHealTargetResult = { targetType: cand.targetType, targetId: cand.targetId, provider: cand.provider, outcome: "error" };
      // Opt-out lives on the Integration row (see the design
      // note above) — for a social account that is its linked
      // integration, the credential's owner.
      if (cand.integration.autoHealEnabled === false) {
        results.push({ ...base, outcome: "skipped_opt_out" });
        continue;
      }
      // Re-read the credential owner fresh: a sibling target
      // sharing this integration (a Page + its Instagram
      // account) may have just healed the same token.
      const fresh = await prisma.integration.findFirst({
        where: { id: cand.integration.id, organizationId }, include: { credential: true },
      }).catch(() => null);
      const integration = fresh ?? cand.integration;
      const cred = this.decryptCredential(integration);
      const expiry = metaStoredTokenExpiry(integration, cred);
      if (!metaTokenInHealWindow(expiry, now)) {
        // Only report the interesting skip: a candidate whose
        // stored expiry existed at enumeration time but moved
        // out of the window (a sibling heal). Targets that were
        // never in-window stay silent — they are the norm.
        if (metaTokenInHealWindow(metaStoredTokenExpiry(cand.integration, this.decryptCredential(cand.integration)), now)) {
          results.push({ ...base, outcome: "skipped_no_longer_expiring" });
        }
        continue;
      }
      const currentToken = typeof cred?.accessToken === "string" ? cred.accessToken : "";
      if (!cred || !currentToken) {
        results.push({ ...base, outcome: "skipped_no_token", detail: "সঞ্চিত credential-এ কোনো access token পাওয়া যায়নি" });
        continue;
      }
      const appSource = String(cand.account?.appSource ?? integration.appSource ?? "platform") === "own" ? "own" : "platform";
      const appCreds = await this.resolveMetaAppCreds(organizationId, appSource);
      if (!appCreds) {
        skippedNoAppCredentials++;
        results.push({
          ...base, outcome: "skipped_no_app_credentials",
          detail: appSource === "own"
            ? "নিজের Meta অ্যাপের কনফিগ পাওয়া যায়নি (TenantAppConfig নেই বা অসম্পূর্ণ)"
            : "প্ল্যাটফর্ম Meta অ্যাপ কনফিগার করা নেই (Admin metaAppConfig-এ appId/appSecret নেই)",
        });
        continue;
      }
      const prior = await this.metaTokenAttemptsToday(organizationId, cand.targetId, now);
      if (prior >= META_TOKEN_HEAL_MAX_ATTEMPTS_PER_DAY) {
        results.push({ ...base, outcome: "skipped_daily_cap", detail: `${prior} attempt(s) already recorded today` });
        continue;
      }

      attempted++;
      await this.audit.log({
        organizationId, userId: "connection-sweep", action: META_TOKEN_ATTEMPT_ACTION,
        entityType: cand.targetType === "integration" ? "Integration" : "SocialAccount", entityId: cand.targetId,
        metadata: {
          provider: cand.provider, appSource, appCredentialSource: appCreds.source,
          attemptOfDay: prior + 1, maxPerDay: META_TOKEN_HEAL_MAX_ATTEMPTS_PER_DAY,
          previousExpiresAt: expiry ? expiry.toISOString() : null,
        },
      }).catch(() => undefined);

      let outcome: MetaTokenHealTargetResult["outcome"] = "error";
      let detail: string | undefined;
      let newExpiresAt: string | undefined;
      try {
        const exchanged = await this.metaExchange.exchangeToken({
          appId: appCreds.appId, appSecret: appCreds.appSecret, currentToken,
        });
        const newExpiry = exchanged.expiresIn ? new Date(now.getTime() + exchanged.expiresIn * 1000) : null;
        // Seal the new token into the SAME credential record,
        // every other stored field preserved verbatim. The
        // credential's own expiresAt follows the SocialOAuth
        // shape (epoch ms); when Meta reported no expiry the
        // key is removed — "no expiry recorded", not invented.
        const nextCred: Record<string, any> = { ...cred, accessToken: exchanged.accessToken };
        if (newExpiry) nextCred.expiresAt = newExpiry.getTime();
        else delete nextCred.expiresAt;
        await prisma.integrationCredential.update({
          where: { integrationId: integration.id },
          data: { encryptedData: encryptJson(nextCred) },
        });
        await prisma.integration.update({
          where: { id: integration.id },
          data: { tokenExpiresAt: newExpiry },
        }).catch(() => undefined);
        outcome = "healed";
        healed++;
        newExpiresAt = newExpiry ? newExpiry.toISOString() : undefined;
      } catch (e) {
        outcome = "error";
        detail = e instanceof Error ? e.message : String(e);
      }
      await this.audit.log({
        organizationId, userId: "connection-sweep", action: META_TOKEN_RESULT_ACTION,
        entityType: cand.targetType === "integration" ? "Integration" : "SocialAccount", entityId: cand.targetId,
        metadata: { provider: cand.provider, outcome, ...(detail ? { detail } : {}), ...(newExpiresAt ? { newExpiresAt } : {}) },
      }).catch(() => undefined);
      results.push({ ...base, outcome, ...(detail ? { detail } : {}) });
    }
    return { attempted, healed, skippedNoAppCredentials, results };
  }
}
