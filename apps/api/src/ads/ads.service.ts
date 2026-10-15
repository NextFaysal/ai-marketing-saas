import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { isMemberConnectionDenied } from "../common/permission-catalog";
import { AuditService } from "../audit/audit.service";
import { dhakaDayStartUtc } from "../crm/lead-followups";
import { CreateAdAccountDto, ManualMetricDto, ImportAdCsvDto, MetaConnectDto, MetaSyncDto } from "./ads.dto";
import { parseAdSpendCsv } from "./ads.csv";
import { encryptJson, decryptJson } from "../integrations/crypto";
import { MetaClient } from "./meta/meta.client";
import { resolveTenantAppConfig } from "../connections/tenant-app-config";
import { GoogleAdsClient, GoogleAdsSecrets } from "./google/google.client";
import { TikTokAdsClient } from "./tiktok/tiktok.client";
import { computeCreativeLeaderboard } from "./creative-fatigue";
import { normalizeMetaInsight, normalizeMetaAdInsight } from "./meta/normalize";
import { parseMoneyToMinor } from "@repo/contracts";
import { metaStatusInfo, googleStatusInfo, tiktokStatusInfo, bucketLabelBn, PlatformStatusInfo } from "./platform-status";
import { computeSpendWatch } from "./spend-watch";
import { computeAdAccountHealth } from "./ad-health";

export function utcDate(dateOnly: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) throw new BadRequestException(`Invalid date: ${dateOnly} (expected YYYY-MM-DD)`);
  return new Date(`${dateOnly}T00:00:00.000Z`);
}
function money(value: string | undefined, field: string): bigint {
  if (!value) return 0n;
  try { return parseMoneyToMinor(value); } catch { throw new BadRequestException(`Invalid ${field}: ${value}`); }
}
function intField(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new BadRequestException(`Invalid number: ${value}`);
  return n;
}

@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /**
   * AD4: account rows carry dailyCapMinor as BigInt — JSON.stringify
   * throws on BigInt, so every HTTP-facing account return goes through
   * here (the minor value becomes a string; null stays null). Internal
   * callers (getAccount) keep the raw row.
   */
  private serializeAccount<T extends Record<string, any>>(account: T): T {
    if (account == null) return account;
    return {
      ...account,
      dailyCapMinor:
        (account as any).dailyCapMinor == null ? null : String((account as any).dailyCapMinor),
    };
  }

  async createAccount(organizationId: string, actorId: string, dto: CreateAdAccountDto) {
    const account = await (this.prisma as any).adAccount.create({
      data: {
        organizationId, platform: dto.platform, sourceType: dto.sourceType ?? "manual",
        externalId: dto.externalId ?? null, name: dto.name.trim(), currency: dto.currency ?? "BDT",
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "ad_account.create", entityType: "AdAccount", entityId: account.id });
    return this.serializeAccount(account);
  }

  async listAccounts(organizationId: string) {
    const accounts = await (this.prisma as any).adAccount.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
    const integrationIds = [...new Set((accounts as any[]).map((a) => a.integrationId).filter(Boolean))] as string[];
    let integrations: any[] = [];
    if (integrationIds.length > 0) {
      // Select ONLY the health fields — never include the credential
      // relation, so no credential material can leak into the response.
      try {
        integrations = await (this.prisma as any).integration.findMany({
          where: { id: { in: integrationIds }, organizationId },
          select: { id: true, status: true, lastSyncAt: true, lastError: true, createdAt: true },
        });
      } catch {
        // Fallback for fakes/clients that reject `select`: fetch
        // without it — the connection block below is still built
        // field-by-field, so nothing extra is ever spread.
        try {
          integrations = await (this.prisma as any).integration.findMany({ where: { id: { in: integrationIds }, organizationId } });
        } catch { integrations = []; }
      }
      if (!Array.isArray(integrations)) integrations = [];
    }
    const byId = new Map((integrations as any[]).map((i) => [i.id as string, i]));
    const now = Date.now();
    return (accounts as any[]).map((account) => {
      const integration = account.integrationId ? byId.get(account.integrationId) : undefined;
      // AA5: the band itself comes from the shared pure function
      // (ads/ad-health.ts) so the tenant list and the admin
      // operator board can never drift. The connection block is
      // still built field-by-field here — present exactly when
      // the account points at an integration row that exists
      // (including for sync_disabled accounts, whose stored
      // lastError stays visible regardless — AD5).
      const health = computeAdAccountHealth(account, integration ?? null, now);
      const connection: { integrationId: string; status: string; lastSyncAt: any; lastError: any; connectedAt: any } | null =
        account.integrationId && integration
          ? {
              integrationId: integration.id ?? account.integrationId,
              status: integration.status,
              lastSyncAt: integration.lastSyncAt ?? null,
              lastError: integration.lastError ?? null,
              connectedAt: integration.createdAt,
            }
          : null;
      return { ...this.serializeAccount(account), connection, health };
    });
  }

  // ---------- AD1: uniform sync health writes + failure notice ----------

  private async markSyncSuccess(integrationId: string): Promise<void> {
    if (!integrationId) return;
    await (this.prisma as any).integration.update({
      where: { id: integrationId },
      data: { status: "CONNECTED", lastSyncAt: new Date(), lastError: null },
    });
  }

  /**
   * Record a sync failure on the Integration (status ERROR +
   * lastError) and, on a genuine transition into ERROR, notify
   * the org's ACTIVE OWNER/ADMIN members (see notifySyncFailure).
   * `integration` may be the Integration row fetched before the
   * sync attempt (its `status` is the PREVIOUS status) or just
   * an integration id string — in the latter case the previous
   * status is read back before the update is written.
   * Notification problems never escape this helper.
   */
  private async markSyncFailure(
    integration: any,
    errorMessage: string,
    ctx?: { organizationId?: string; account?: any },
  ): Promise<void> {
    const integrationId: string | undefined = typeof integration === "string" ? integration : integration?.id;
    if (!integrationId) return;
    const organizationId: string | undefined = ctx?.organizationId ?? (typeof integration === "object" && integration ? integration.organizationId : undefined);
    const account: any = ctx?.account;
    let previousStatus: string | undefined = typeof integration === "object" && integration ? integration.status : undefined;
    if (previousStatus === undefined) {
      try {
        const row = await (this.prisma as any).integration.findFirst({
          where: { id: integrationId, ...(organizationId ? { organizationId } : {}) },
        });
        previousStatus = row?.status;
      } catch { /* unknown previous status: treat as a transition */ }
    }
    await (this.prisma as any).integration.update({
      where: { id: integrationId },
      data: { status: "ERROR", lastError: errorMessage },
    });
    if (previousStatus === "ERROR") return;
    if (!organizationId || !account) return;
    await this.notifySyncFailure(organizationId, integrationId, account, errorMessage).catch(() => undefined);
  }

  /**
   * AD1 failure notification — the AutomationService
   * notifyDeadLettered shape: ACTIVE OWNER/ADMIN members get an
   * AgentNotification (type "ad_account_sync_failed"), at most
   * once per integration per Asia/Dhaka day via an AuditLog
   * marker ("ad_account.sync_failed_notified" on the
   * Integration). Fully failure-isolated: never throws.
   */
  private async notifySyncFailure(organizationId: string, integrationId: string, account: any, errorMessage: string): Promise<void> {
    try {
      const marker = await (this.prisma as any).auditLog.findFirst({
        where: {
          organizationId, action: "ad_account.sync_failed_notified",
          entityType: "Integration", entityId: integrationId,
          createdAt: { gte: dhakaDayStartUtc(new Date()) },
        },
      }).catch(() => null);
      if (marker) return;
      const memberships = await (this.prisma as any).membership.findMany({
        where: { organizationId, status: "ACTIVE" }, take: 200,
      }).catch(() => []);
      const recipients = [...new Set((memberships as any[])
        .filter((m) => ["OWNER", "ADMIN"].includes(m.role))
        .map((m) => m.userId as string))];
      if (recipients.length === 0) return;
      const errorText = String(errorMessage ?? "");
      const excerpt = errorText.length > 200 ? `${errorText.slice(0, 200)}…` : errorText;
      const title = `Ad Account Sync ব্যর্থ: ${account.name} (${account.platform})`;
      const body = `“${account.name}” (${account.platform}) Ad Account-এর Sync ব্যর্থ হয়েছে। ত্রুটি: ${excerpt} Ad Accounts পেজ থেকে “পুনরায় কানেক্ট করুন” দিয়ে আবার কানেক্ট করে Sync চেষ্টা করুন — Token-এর মেয়াদ শেষ হয়ে গেলে নতুন Token লাগতে পারে।`;
      for (const userId of recipients) {
        await (this.prisma as any).agentNotification.create({
          data: { organizationId, userId, type: "ad_account_sync_failed", title, body, conversationId: null },
        }).catch(() => undefined);
      }
      await this.audit.log({
        organizationId, userId: undefined, action: "ad_account.sync_failed_notified",
        entityType: "Integration", entityId: integrationId,
        metadata: { accountId: account.id, platform: account.platform, recipients: recipients.length },
      });
    } catch (e) {
      this.logger.warn(`ad account sync-failure notification failed for integration ${integrationId}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  async getAccount(organizationId: string, accountId: string) {
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: accountId, organizationId } });
    if (!account) throw new NotFoundException("Ad account not found in this organization");
    return account;
  }

  // ---------------------------------------------------------------
  // AD5 — Meta discover→picker connect + per-account sync switch.
  // ---------------------------------------------------------------

  /**
   * AD5 sync gate: when an account's syncDisabled flag is set,
   * every platform-data sync path for it (manual insights /
   * breakdown / refresh-status sync + the scheduled insights jobs)
   * stops here with this honest Bengali error. Publishing paths do
   * NOT consult this flag — pausing data sync and pausing ads are
   * different concerns.
   */
  private assertSyncEnabled(account: any): void {
    if (account?.syncDisabled) {
      throw new BadRequestException("এই Ad Account-এর Sync বন্ধ রাখা হয়েছে (Sync Disabled) — Sync চালাতে আগে Account কার্ড থেকে Sync চালু করুন।");
    }
  }

  /**
   * PATCH ad-accounts/:id/sync — flip the per-account sync switch.
   * Audited; the response echoes the stored flag.
   */
  async updateAccountSettings(
    organizationId: string,
    actorId: string,
    accountId: string,
    dto: { syncDisabled?: boolean; label?: string | null },
  ) {
    const account = await this.getAccount(organizationId, accountId);
    const data: Record<string, unknown> = {};
    if (dto.syncDisabled !== undefined) data.syncDisabled = Boolean(dto.syncDisabled);
    // AD6 label: free text, trimmed; null/empty clears it back to
    // the platform name. The cap applies to the TRIMMED value.
    if (dto.label !== undefined) {
      const trimmed = dto.label === null ? "" : String(dto.label).trim();
      if (trimmed.length > 60) {
        throw new BadRequestException("লেবেল সর্বোচ্চ ৬০ অক্ষরের হতে পারবে।");
      }
      data.label = trimmed === "" ? null : trimmed;
    }
    if (Object.keys(data).length === 0) {
      return { id: account.id, syncDisabled: Boolean(account.syncDisabled), label: account.label ?? null };
    }
    const updated = await (this.prisma as any).adAccount.update({ where: { id: account.id }, data });
    await this.audit.log({
      organizationId, userId: actorId,
      action: "ad_account.settings_update",
      entityType: "AdAccount", entityId: account.id,
      metadata: { syncDisabled: Boolean(updated.syncDisabled), label: updated.label ?? null },
    });
    return { id: updated.id, syncDisabled: Boolean(updated.syncDisabled), label: updated.label ?? null };
  }

  /**
   * Scheduled-job entry point for the three insights job types
   * (meta_insights / google_insights / tiktok_insights). A
   * sync-disabled account is SKIPPED — the returned marker becomes
   * the job run's result, so the skip is visible in run history
   * instead of surfacing as a job failure. Any other account runs
   * exactly the manual sync path.
   */
  async syncInsightsJob(platform: "meta" | "google" | "tiktok", organizationId: string, actorId: string, accountId: string) {
    const account = await this.getAccount(organizationId, accountId);
    if (account.syncDisabled) {
      return { skipped: true, reason: "sync_disabled", accountId: account.id, platform };
    }
    // CC27: the scheduled job path is deliberately NOT deny-gated
    // (fromJob) — it is a system sweep, not a member's manual
    // action; the manual triggers below are the gated surface.
    // Documented in docs/connect-center-b12-acceptance.md.
    if (platform === "meta") return this.syncMetaInsights(organizationId, actorId, accountId, {}, { fromJob: true });
    if (platform === "google") return this.syncGoogleInsights(organizationId, actorId, accountId, {}, { fromJob: true });
    return this.syncTikTokInsights(organizationId, actorId, accountId, {}, { fromJob: true });
  }

  /**
   * CC27: AdAccount deny gate for MANUAL sync triggers — a member
   * denied this ad account in the Connect Center matrix cannot
   * pull its data. Refused BEFORE any platform client is built.
   * OWNER is never denied (helper semantics); the scheduled job
   * path never calls this (see syncInsightsJob).
   */
  private async assertAdAccountAccess(organizationId: string, actorId: string, accountId: string) {
    if (await isMemberConnectionDenied(this.prisma as any, organizationId, actorId, accountId)) {
      throw new ForbiddenException("এই বিজ্ঞাপন অ্যাকাউন্টের ডেটা Sync করার অনুমতি আপনাকে দেওয়া হয়নি — Connect Center-এর অ্যাক্সেস সেটিংস দেখুন বা OWNER/ADMIN-কে বলুন।");
    }
  }

  /** CC27: boolean form for the sync-all loop's per-account
   * skipped_denied outcome (its native result record). */
  private async isAdAccountDenied(organizationId: string, actorId: string, accountId: string): Promise<boolean> {
    return isMemberConnectionDenied(this.prisma as any, organizationId, actorId, accountId);
  }

  /**
   * AD6 bulk sync ("সব Sync করুন"). Runs the SAME per-account
   * campaign-insights sync the card's primary Sync button runs —
   * Meta syncMetaInsights / Google syncGoogleInsights / TikTok
   * syncTikTokInsights (30d default) — for every account of the org.
   * The Meta ad-level + breakdown syncs deliberately stay per-account
   * (they are heavier, secondary views; the card's Sync button is the
   * parity target).
   *
   * Execution is SEQUENTIAL on purpose — platform politeness: one
   * account's platform calls finish before the next account starts,
   * so a bulk click never hammers Meta/Google/TikTok in parallel.
   *
   * Per-account outcome: success | failed (the sync's verbatim error
   * message; one failure NEVER fails the batch) | skipped_disabled
   * (AD5 flag — checked here first so the result names the reason;
   * the sync methods would refuse anyway) | skipped_no_connection
   * (non-api account, or no integration attached — nothing can sync).
   * The batch is audited ONCE with the counts.
   */
  async syncAllAccounts(organizationId: string, actorId: string) {
    const accounts = await (this.prisma as any).adAccount.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, platform: true, sourceType: true, integrationId: true, syncDisabled: true },
    });
    type SyncAllResult = { accountId: string; status: "success" | "failed" | "skipped_disabled" | "skipped_no_connection" | "skipped_denied"; error?: string };
    const results: SyncAllResult[] = [];
    for (const account of accounts as Array<{ id: string; platform: string; sourceType: string; integrationId: string | null; syncDisabled: boolean }>) {
      if (account.sourceType !== "api" || !account.integrationId) {
        results.push({ accountId: account.id, status: "skipped_no_connection" });
        continue;
      }
      if (account.syncDisabled) {
        results.push({ accountId: account.id, status: "skipped_disabled" });
        continue;
      }
      // CC27: sync-all is a MANUAL trigger — an account denied to
      // the acting member is skipped with its own named outcome
      // (the per-account sync methods would refuse anyway; here
      // the batch records the reason instead of a generic fail).
      if (await this.isAdAccountDenied(organizationId, actorId, account.id)) {
        results.push({ accountId: account.id, status: "skipped_denied" });
        continue;
      }
      try {
        if (account.platform === "meta") await this.syncMetaInsights(organizationId, actorId, account.id, {});
        else if (account.platform === "google") await this.syncGoogleInsights(organizationId, actorId, account.id, {});
        else if (account.platform === "tiktok") await this.syncTikTokInsights(organizationId, actorId, account.id, {});
        else {
          results.push({ accountId: account.id, status: "skipped_no_connection" });
          continue;
        }
        results.push({ accountId: account.id, status: "success" });
      } catch (e) {
        results.push({ accountId: account.id, status: "failed", error: e instanceof Error ? e.message : String(e) });
      }
    }
    const summary = {
      total: results.length,
      success: results.filter((r) => r.status === "success").length,
      failed: results.filter((r) => r.status === "failed").length,
      skipped: results.filter((r) => r.status === "skipped_disabled" || r.status === "skipped_no_connection" || r.status === "skipped_denied").length,
    };
    await this.audit.log({
      organizationId, userId: actorId,
      action: "ad_accounts.sync_all",
      entityType: "Organization", entityId: organizationId,
      metadata: { ...summary },
    });
    return { ...summary, results };
  }

  /**
   * AD5 picker step 1: verify a Meta token and list the ad
   * accounts under it — WITHOUT storing anything. No Integration
   * is created, no credential is written, no audit row is made,
   * and the token is never echoed back, logged, or persisted; it
   * lives only in this call. A bad token surfaces Meta's own
   * error verbatim (same wording as connect) before any listing.
   *
   * alreadyConnected semantics (deliberately simple): an
   * API-sourced AdAccount row with this externalId already exists
   * in THIS organization. The row may currently be disconnected
   * (AD2) — connecting it again revives the same row — so the
   * picker pre-checks these and labels them as already known.
   */
  async discoverMetaAccounts(organizationId: string, dto: { accessToken: string }) {
    const client = new MetaClient(dto.accessToken);
    try {
      await client.verifyToken();
    } catch (e) {
      throw new BadRequestException(`Meta token verification failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    const discovered = await client.listAdAccounts().catch((e) => {
      throw new BadRequestException(`Could not list Meta ad accounts: ${e instanceof Error ? e.message : "unknown error"}`);
    });
    const existing = await (this.prisma as any).adAccount.findMany({
      where: { organizationId, platform: "meta" },
    }).catch(() => []);
    const byExternal = new Map<string, any>(
      (Array.isArray(existing) ? existing : []).filter((r: any) => r.externalId).map((r: any) => [r.externalId as string, r]),
    );
    return {
      accounts: discovered.map((a) => {
        const info = metaStatusInfo(a.status, a.timezone);
        const found = byExternal.get(a.externalId);
        return {
          externalId: a.externalId,
          name: a.name,
          currency: a.currency,
          platformStatusRaw: info.raw,
          platformStatusBucket: info.bucket,
          timezone: info.timezone,
          alreadyConnected: Boolean(found && found.sourceType === "api"),
          accountId: found ? (found.id as string) : null,
        };
      }),
    };
  }

  /**
   * Shared recipient fan-out for AD3/AD4 account alerts: the org's
   * ACTIVE OWNER/ADMIN members each get one AgentNotification.
   * Returns the recipient count. Individual create failures are
   * swallowed per-recipient; membership lookup problems yield 0.
   */
  private async createAdminNotifications(organizationId: string, type: string, title: string, body: string): Promise<number> {
    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId, status: "ACTIVE" }, take: 200,
    }).catch(() => []);
    const recipients = [...new Set((memberships as any[])
      .filter((m) => ["OWNER", "ADMIN"].includes(m.role))
      .map((m) => m.userId as string))];
    for (const userId of recipients) {
      await (this.prisma as any).agentNotification.create({
        data: { organizationId, userId, type, title, body, conversationId: null },
      }).catch(() => undefined);
    }
    return recipients.length;
  }

  // ---------- AD3: platform account status + timezone ----------

  /**
   * Notify ACTIVE OWNER/ADMIN when an account's platform-status
   * bucket TRANSITIONS into disabled or restricted. At most once
   * per account per Asia/Dhaka day (AuditLog marker
   * "ad_account.platform_status_notified" on the AdAccount — the
   * AD1 marker discipline). Fully failure-isolated: never throws.
   */
  private async maybeNotifyPlatformStatus(
    organizationId: string, account: any,
    prevBucket: string | null | undefined, info: PlatformStatusInfo,
  ): Promise<void> {
    try {
      if (!info.bucket || (info.bucket !== "disabled" && info.bucket !== "restricted")) return;
      if (prevBucket === info.bucket) return;
      const marker = await (this.prisma as any).auditLog.findFirst({
        where: {
          organizationId, action: "ad_account.platform_status_notified",
          entityType: "AdAccount", entityId: account.id,
          createdAt: { gte: dhakaDayStartUtc(new Date()) },
        },
      }).catch(() => null);
      if (marker) return;
      const title = `Ad Account-এর প্ল্যাটফর্ম স্ট্যাটাস বদলেছে: ${account.name}`;
      const body = `“${account.name}” (${account.platform}) Ad Account-এর প্ল্যাটফর্ম স্ট্যাটাস এখন ${bucketLabelBn(info.bucket)} (প্ল্যাটফর্মের মান: ${info.raw})। Account বন্ধ/সীমাবদ্ধ থাকলে নতুন বিজ্ঞাপন চলবে না এবং Sync-এ নতুন Spend আসবে না। বিস্তারিত প্ল্যাটফর্মের Ads Manager-এ যাচাই করুন; এখানে “স্ট্যাটাস যাচাই” বোতামে সর্বশেষ অবস্থা আবার দেখা যাবে।`;
      const sent = await this.createAdminNotifications(organizationId, "ad_account_platform_status", title, body);
      if (sent === 0) return;
      await this.audit.log({
        organizationId, userId: undefined, action: "ad_account.platform_status_notified",
        entityType: "AdAccount", entityId: account.id,
        metadata: { platform: account.platform, bucket: info.bucket, raw: info.raw, previousBucket: prevBucket ?? null, recipients: sent },
      });
    } catch (e) {
      this.logger.warn(`ad account platform-status notification failed for account ${account?.id}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  /**
   * Ask the platform (with the STORED credential — it never leaves
   * the server) for this account's current status + timezone.
   * BadRequestException = a local precondition failed (no
   * credential, account no longer visible to the token) and is
   * rethrown by the caller WITHOUT health marking; any other error
   * is a platform-call failure.
   */
  private async fetchPlatformStatus(organizationId: string, account: any): Promise<PlatformStatusInfo> {
    if (account.platform === "meta") {
      const { accessToken } = await this.integrationSecrets<{ accessToken: string }>(organizationId, account, "Meta");
      const client = new MetaClient(accessToken);
      const list = await client.listAdAccounts();
      const found = list.find((a) => a.externalId === account.externalId);
      if (!found) {
        throw new BadRequestException(`Meta এই Token দিয়ে “${account.externalId}” Accountটি আর দেখাচ্ছে না — সম্ভবত Token-এর Access তালিকা থেকে Accountটি সরে গেছে। পুনরায় কানেক্ট করে দেখুন।`);
      }
      return metaStatusInfo(found.status, found.timezone);
    }
    if (account.platform === "google") {
      const secrets = await this.integrationSecrets<GoogleAdsSecrets>(organizationId, account, "Google Ads");
      const client = new GoogleAdsClient(secrets);
      const customer = await client.verifyCustomer(account.externalId);
      return googleStatusInfo(customer.status, customer.timeZone);
    }
    if (account.platform === "tiktok") {
      const { accessToken } = await this.integrationSecrets<{ accessToken: string }>(organizationId, account, "TikTok");
      const client = new TikTokAdsClient(accessToken);
      const advertiser = await client.verifyAdvertiser(account.externalId);
      return tiktokStatusInfo(advertiser.status, advertiser.timezone);
    }
    throw new BadRequestException(`এই প্ল্যাটফর্মের (${account.platform}) স্ট্যাটাস যাচাই সমর্থিত নয়।`);
  }

  /**
   * POST ad-accounts/:id/refresh-status — re-read the account's
   * platform status + timezone with the stored credential and
   * persist them (raw + bucket + timezone + checkedAt), audit the
   * check, and notify on a transition into disabled/restricted.
   *
   * Failure semantics (decided, documented in the AD3 acceptance
   * doc): a platform-CALL failure is the same failure class the
   * sync paths record, so it goes through markSyncFailure — the
   * integration flips to ERROR with the verbatim error (and the
   * AD1 transition notification can fire). Local preconditions
   * (no credential / account no longer visible) surface as honest
   * 400s WITHOUT health marking — no platform call failed there.
   * A successful refresh deliberately does NOT clear an existing
   * sync ERROR: connection health is about syncs; the next
   * successful sync clears it (AD1 semantics, unchanged).
   */
  async refreshAccountStatus(organizationId: string, actorId: string, accountId: string) {
    const account = await this.getAccount(organizationId, accountId);
    if (!account.integrationId || !account.externalId || account.sourceType !== "api") {
      throw new BadRequestException("এই Ad Account-এর কোনো API সংযোগ নেই — প্ল্যাটফর্ম স্ট্যাটাস যাচাই করা যাবে না (CSV/Manual Account)।");
    }
    // AD5: the status refresh is a platform-data sync too — a
    // sync-disabled account skips it with the same honest error
    // (a local precondition, so NO health marking, like AD3's
    // other local 400s).
    this.assertSyncEnabled(account);
    const platformLabel = account.platform === "meta" ? "Meta" : account.platform === "google" ? "Google Ads" : account.platform === "tiktok" ? "TikTok" : account.platform;
    let info: PlatformStatusInfo;
    try {
      info = await this.fetchPlatformStatus(organizationId, account);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      const message = e instanceof Error ? e.message : "unknown error";
      const integration = account.integrationId
        ? await (this.prisma as any).integration.findFirst({ where: { id: account.integrationId, organizationId } }).catch(() => null)
        : null;
      await this.markSyncFailure(integration ?? account.integrationId, message, { organizationId, account }).catch(() => undefined);
      throw new BadRequestException(`${platformLabel} স্ট্যাটাস যাচাই ব্যর্থ: ${message}`);
    }
    const prevBucket: string | null = account.platformStatusBucket ?? null;
    const data: Record<string, unknown> = { platformStatusCheckedAt: new Date() };
    // A platform that reports nothing leaves the stored status
    // untouched — absence of a report never erases a known status,
    // and never invents one either.
    if (info.raw !== null) { data.platformStatusRaw = info.raw; data.platformStatusBucket = info.bucket; }
    if (info.timezone !== null) data.timezone = info.timezone;
    const updated = await (this.prisma as any).adAccount.update({ where: { id: account.id }, data });
    await this.audit.log({
      organizationId, userId: actorId, action: "ad_account.platform_status_refresh",
      entityType: "AdAccount", entityId: account.id,
      metadata: { platform: account.platform, raw: info.raw, bucket: info.bucket, previousBucket: prevBucket, timezone: info.timezone },
    });
    if (info.bucket) await this.maybeNotifyPlatformStatus(organizationId, updated, prevBucket, info);
    return {
      id: updated.id, platform: updated.platform,
      platformStatusRaw: updated.platformStatusRaw ?? null,
      platformStatusBucket: updated.platformStatusBucket ?? null,
      timezone: updated.timezone ?? null,
      platformStatusCheckedAt: updated.platformStatusCheckedAt ?? null,
      previousBucket: prevBucket,
    };
  }

  // ---------------------------------------------------------------
  // AD4 — account-level spend watchdog (ALERTING ONLY).
  // The computation lives in spend-watch.ts and is shared verbatim by
  // the job below and GET ad-accounts/:id/spend-watch — the UI and
  // the alerts can never drift. Nothing here pauses or stops any
  // campaign: there is no account-level kill switch, and v1 builds
  // no enforcement — the alerts say so explicitly.
  // ---------------------------------------------------------------

  /** Live spend-watch computation for one account (UI + debugging). */
  async getSpendWatch(organizationId: string, accountId: string) {
    const account = await this.getAccount(organizationId, accountId);
    return computeSpendWatch(this.prisma as any, account);
  }

  /**
   * Update the watch settings (OWNER/ADMIN at the controller).
   * dailyCap arrives as a decimal string in the account's currency
   * ("5000" / "5000.50") and is stored as minor units; null clears.
   * anomalyPct must be an integer 1..1000; null clears (alert off).
   */
  async updateSpendWatch(
    organizationId: string,
    actorId: string,
    accountId: string,
    dto: { enabled?: boolean; dailyCap?: string | null; anomalyPct?: number | null },
  ) {
    const account = await this.getAccount(organizationId, accountId);
    const data: Record<string, unknown> = {};
    if (dto.enabled !== undefined) data.spendWatchEnabled = Boolean(dto.enabled);
    if (dto.dailyCap !== undefined) {
      if (dto.dailyCap === null) {
        data.dailyCapMinor = null;
      } else {
        const cap = money(dto.dailyCap, "dailyCap");
        if (cap <= 0n) throw new BadRequestException("দৈনিক ক্যাপ ০-এর বেশি হতে হবে");
        data.dailyCapMinor = cap;
      }
    }
    if (dto.anomalyPct !== undefined) {
      if (dto.anomalyPct === null) {
        data.anomalyPct = null;
      } else {
        const pct = Number(dto.anomalyPct);
        if (!Number.isInteger(pct) || pct < 1 || pct > 1000) {
          throw new BadRequestException("Anomaly % ১ থেকে ১০০০-এর মধ্যে পূর্ণ সংখ্যা হতে হবে");
        }
        data.anomalyPct = pct;
      }
    }
    const updated = await (this.prisma as any).adAccount.update({ where: { id: account.id }, data });
    await this.audit.log({
      organizationId, userId: actorId,
      action: "ad_account.spend_watch_update",
      entityType: "AdAccount", entityId: account.id,
      metadata: {
        enabled: updated.spendWatchEnabled,
        dailyCapMinor: updated.dailyCapMinor == null ? null : String(updated.dailyCapMinor),
        anomalyPct: updated.anomalyPct ?? null,
      },
    });
    return {
      id: updated.id,
      spendWatchEnabled: Boolean(updated.spendWatchEnabled),
      dailyCapMinor: updated.dailyCapMinor == null ? null : String(updated.dailyCapMinor),
      anomalyPct: updated.anomalyPct ?? null,
    };
  }

  /**
   * The watchdog job body: for every watch-enabled account in the
   * org, compute today's spend (Dhaka day, partial) and fire the cap
   * and/or anomaly alerts. Deduped per account per Dhaka day PER
   * ALERT KIND via AuditLog markers; fully failure-isolated per
   * account so one bad account never blocks the rest.
   */
  async runSpendWatchdog(organizationId: string): Promise<{ checked: number; capAlerts: number; anomalyAlerts: number }> {
    const accounts = await (this.prisma as any).adAccount.findMany({
      where: { organizationId, spendWatchEnabled: true },
    });
    let capAlerts = 0;
    let anomalyAlerts = 0;
    for (const account of accounts as any[]) {
      try {
        const c = await computeSpendWatch(this.prisma as any, account);
        if (c.capCrossed && (await this.notifySpendAlert(organizationId, account, "cap", c))) capAlerts += 1;
        if (c.anomalyTriggered && (await this.notifySpendAlert(organizationId, account, "anomaly", c))) anomalyAlerts += 1;
      } catch (error) {
        this.logger.warn(
          `spend watchdog failed for account ${account?.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { checked: (accounts as any[]).length, capAlerts, anomalyAlerts };
  }

  /**
   * Fires one spend alert (kind: "cap" | "anomaly") to ACTIVE
   * OWNER/ADMIN, at most once per account per Dhaka day per kind
   * (AuditLog marker, AD1 discipline). Returns true when a
   * notification was created. Never throws.
   */
  private async notifySpendAlert(
    organizationId: string,
    account: any,
    kind: "cap" | "anomaly",
    c: Awaited<ReturnType<typeof computeSpendWatch>>,
  ): Promise<boolean> {
    try {
      const markerAction =
        kind === "cap" ? "ad_account.spend_cap_notified" : "ad_account.spend_anomaly_notified";
      const already = await (this.prisma as any).auditLog.findFirst({
        where: {
          organizationId,
          action: markerAction,
          entityType: "AdAccount",
          entityId: account.id,
          createdAt: { gte: dhakaDayStartUtc(new Date()) },
        },
      });
      if (already) return false;
      const title =
        kind === "cap"
          ? `Ad Spend ক্যাপ অ্যালার্ট: ${account.name}`
          : `অস্বাভাবিক Ad Spend অ্যালার্ট: ${account.name}`;
      const body =
        kind === "cap"
          ? `“${account.name}” (${account.platform}) Ad Account-এর আজকের খরচ এখন পর্যন্ত (সর্বশেষ Sync পর্যন্ত) ${c.todaySpendFormatted} — সেট করা দৈনিক ক্যাপ ${c.dailyCapFormatted} ছুঁয়েছে বা পেরিয়ে গেছে। এটি শুধু সতর্কবার্তা — কোনো Campaign স্বয়ংক্রিয়ভাবে বন্ধ বা Pause করা হয়নি।`
          : `“${account.name}” (${account.platform}) Ad Account-এর আজকের খরচ এখন পর্যন্ত (সর্বশেষ Sync পর্যন্ত) ${c.todaySpendFormatted}। ভিত্তি: ${c.avgBasis} ${c.avgDailySpendFormatted} — সেট করা সীমা (+${c.anomalyPct}%, অর্থাৎ ${c.anomalyThresholdFormatted}) পেরিয়ে গেছে। এটি শুধু সতর্কবার্তা — কোনো Campaign স্বয়ংক্রিয়ভাবে বন্ধ বা Pause করা হয়নি।`;
      const created = await this.createAdminNotifications(organizationId, "ad_account_spend_alert", title, body);
      if (created === 0) return false;
      await this.audit.log({
        organizationId,
        action: markerAction,
        entityType: "AdAccount",
        entityId: account.id,
        metadata: {
          todaySpendMinor: c.todaySpendMinor,
          dailyCapMinor: c.dailyCapMinor,
          anomalyPct: c.anomalyPct,
          avgDaysUsed: c.avgDaysUsed,
        },
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `spend alert failed for account ${account?.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  // ---------- AD2: disconnect & reconnect lifecycle ----------

  /**
   * Detach ONE ad account from its API integration. The account
   * row, its campaigns and all metrics always stay — only the
   * connection is severed (integrationId=null, status
   * DISCONNECTED), so Sync/Publish stop honestly instead of
   * failing against a dead token.
   *
   * If this account is the ONLY one on its integration, the full
   * disconnect semantics of IntegrationsService.disconnect apply:
   * credential rows deleted + integration DISCONNECTED. If the
   * integration is SHARED (Meta: one token, many accounts) the
   * integration and its credential are left untouched — the
   * other accounts keep working.
   */
  async disconnectAccount(organizationId: string, actorId: string, accountId: string) {
    const account = await this.getAccount(organizationId, accountId);
    if (!account.integrationId) {
      throw new BadRequestException("এই Ad Account-এর কোনো API সংযোগ নেই — বিচ্ছিন্ন করার মতো সংযোগ নেই (CSV/Manual Account)।");
    }
    const integrationId: string = account.integrationId;
    const sharing = await (this.prisma as any).adAccount.findMany({
      where: { organizationId, integrationId },
    });
    const shared = Array.isArray(sharing) && sharing.length > 1;
    if (!shared) {
      await (this.prisma as any).integrationCredential.deleteMany({ where: { integrationId } });
      await (this.prisma as any).integration.update({
        where: { id: integrationId }, data: { status: "DISCONNECTED" },
      }).catch(() => undefined); // a dangling integrationId still detaches cleanly
    }
    const updated = await (this.prisma as any).adAccount.update({
      where: { id: account.id },
      data: { integrationId: null, status: "DISCONNECTED" },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "ad_account.disconnect",
      entityType: "AdAccount", entityId: account.id,
      metadata: { shared, integrationId },
    });
    return { ...this.serializeAccount(updated), connection: null, health: "disconnected" };
  }

  /**
   * AD2 reconnect hygiene: after a successful connect has
   * upserted/repointed the discovered accounts onto the NEW
   * integration, supersede the same platform identity's previous
   * CONNECTED integrations (credential rows deleted + status
   * DISCONNECTED + audit), so reconnects stop piling up phantom
   * CONNECTED integrations with live credentials.
   *
   * An old integration is superseded ONLY when zero AdAccounts
   * still reference it after the connect upserts. For Meta, an
   * account that was NOT re-discovered this time (e.g. deselected
   * via adAccountExternalIds) keeps pointing at the old
   * integration — that integration and its credential therefore
   * stay fully alive; accounts are never silently repointed and
   * never left credential-less.
   */
  private async supersedePreviousIntegrations(
    organizationId: string, actorId: string,
    provider: string, externalAccountId: string | undefined | null,
    newIntegrationId: string,
  ): Promise<void> {
    if (!externalAccountId) return;
    let olds: any[] = [];
    try {
      olds = await (this.prisma as any).integration.findMany({
        where: { organizationId, provider, externalAccountId, status: "CONNECTED" },
      });
    } catch { return; }
    if (!Array.isArray(olds)) return;
    for (const old of olds) {
      if (!old?.id || old.id === newIntegrationId) continue;
      const remaining = await (this.prisma as any).adAccount.findMany({
        where: { organizationId, integrationId: old.id },
      }).catch(() => null);
      if (!Array.isArray(remaining) || remaining.length > 0) continue;
      await (this.prisma as any).integrationCredential.deleteMany({ where: { integrationId: old.id } });
      await (this.prisma as any).integration.update({
        where: { id: old.id }, data: { status: "DISCONNECTED" },
      });
      await this.audit.log({
        organizationId, userId: actorId, action: "integration.superseded",
        entityType: "Integration", entityId: old.id,
        metadata: { byIntegrationId: newIntegrationId, provider },
      });
    }
  }

  /**
   * Upsert one daily metric. The unique key is
   * (org, account, campaignExternalId, date, source).
   * Re-importing or re-syncing RESTATES the row (platforms correct their
   * numbers), unlike product CSV where re-uploads are skipped.
   */
  async upsertMetric(organizationId: string, input: {
    adAccountId: string; adCampaignId?: string | null; platform: string; source: string;
    campaignExternalId: string; campaignName?: string; date: Date; currency: string;
    spendMinor: bigint; impressions: number; clicks: number; conversions: number; conversionValueMinor: bigint;
    adSetExternalId?: string; adSetName?: string; adExternalId?: string; adName?: string;
    reach?: number; videoViews?: number;
  }): Promise<"created" | "updated"> {
    const where = {
      organizationId_adAccountId_campaignExternalId_adSetExternalId_adExternalId_date_source: {
        organizationId, adAccountId: input.adAccountId,
        campaignExternalId: input.campaignExternalId,
        adSetExternalId: input.adSetExternalId ?? "", adExternalId: input.adExternalId ?? "",
        date: input.date, source: input.source,
      },
    };
    const data = {
      organizationId, adAccountId: input.adAccountId, adCampaignId: input.adCampaignId ?? null,
      platform: input.platform, source: input.source, campaignExternalId: input.campaignExternalId,
      campaignName: input.campaignName ?? null, date: input.date, currency: input.currency,
      spendMinor: input.spendMinor, impressions: input.impressions, clicks: input.clicks,
      platformConversions: input.conversions, platformConversionValueMinor: input.conversionValueMinor,
      adSetExternalId: input.adSetExternalId ?? "", adSetName: input.adSetName ?? null,
      adExternalId: input.adExternalId ?? "", adName: input.adName ?? null,
      reach: input.reach ?? 0, videoViews: input.videoViews ?? 0,
    };
    const existing = await (this.prisma as any).dailyAdMetric.findUnique({ where });
    if (existing) {
      await (this.prisma as any).dailyAdMetric.update({ where, data });
      return "updated";
    }
    await (this.prisma as any).dailyAdMetric.create({ data });
    return "created";
  }

  async manualEntry(organizationId: string, actorId: string, accountId: string, dto: ManualMetricDto) {
    const account = await this.getAccount(organizationId, accountId);
    const result = await this.upsertMetric(organizationId, {
      adAccountId: account.id, platform: account.platform, source: "manual",
      campaignExternalId: "", campaignName: dto.campaignName, date: utcDate(dto.date),
      currency: account.currency, spendMinor: money(dto.spend, "spend"),
      impressions: intField(dto.impressions), clicks: intField(dto.clicks),
      conversions: intField(dto.conversions), conversionValueMinor: money(dto.conversionValue, "conversionValue"),
    });
    await this.audit.log({ organizationId, userId: actorId, action: "ad_metric.manual", entityType: "AdAccount", entityId: account.id, metadata: { date: dto.date, result } });
    return { result };
  }

  async importCsv(organizationId: string, actorId: string, accountId: string, dto: ImportAdCsvDto) {
    const account = await this.getAccount(organizationId, accountId);
    const { rows, errors, totalRows } = parseAdSpendCsv(dto.csvText, account.currency);
    let created = 0, updated = 0;
    for (const row of rows) {
      // Link or create the AdCampaign record when the CSV carries an id.
      let campaignId: string | null = null;
      if (row.campaignExternalId) {
        const campaign = await (this.prisma as any).adCampaign.upsert({
          where: { adAccountId_externalId: { adAccountId: account.id, externalId: row.campaignExternalId } },
          update: { name: row.campaignName ?? undefined },
          create: { organizationId, adAccountId: account.id, externalId: row.campaignExternalId, name: row.campaignName ?? row.campaignExternalId },
        });
        campaignId = campaign.id;
      }
      const result = await this.upsertMetric(organizationId, {
        adAccountId: account.id, adCampaignId: campaignId, platform: account.platform, source: "csv",
        campaignExternalId: row.campaignExternalId, campaignName: row.campaignName,
        date: utcDate(row.date), currency: row.currency, spendMinor: row.spendMinor,
        impressions: row.impressions, clicks: row.clicks, conversions: row.conversions,
        conversionValueMinor: row.conversionValueMinor,
      });
      if (result === "created") created++; else updated++;
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "ad_metric.import_csv", entityType: "AdAccount",
      entityId: account.id, metadata: { totalRows, created, updated, failed: errors.length },
    });
    return { totalRows, created, updated, failed: errors.length, errors: errors.slice(0, 200) };
  }

  // ---------- Meta ----------
  async connectMeta(organizationId: string, actorId: string, dto: MetaConnectDto) {
    // CC28: record WHICH Meta app the pasted token belongs to.
    // "own" requires the tenant's Meta app config to exist (the
    // CC4 require-config discipline). Recorded on the Integration
    // row; AdAccount has no appSource column.
    const appSource = dto.appSource === "own" ? "own" : "platform";
    if (appSource === "own") {
      const own = await resolveTenantAppConfig(this.prisma as any, organizationId, "meta");
      if (!own) {
        throw new BadRequestException("নিজের Meta অ্যাপ কনফিগার করা নেই — আগে কানেক্ট সেন্টারে (কানেক্ট সেন্টার → নিজের অ্যাপ) আপনার Meta অ্যাপটি যোগ করুন, অথবা প্ল্যাটফর্মের অ্যাপ হিসেবে কানেক্ট করুন।");
      }
    }
    const client = new MetaClient(dto.accessToken);
    let me: { id: string; name?: string };
    try {
      me = await client.verifyToken();
    } catch (e) {
      throw new BadRequestException(`Meta token verification failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    let discovered = await client.listAdAccounts().catch((e) => {
      throw new BadRequestException(`Could not list Meta ad accounts: ${e instanceof Error ? e.message : "unknown error"}`);
    });
    // AD5 picker semantics: adAccountExternalIds ABSENT keeps the
    // legacy connect-everything behaviour, but a PRESENT selection
    // is authoritative — an empty selection is a client mistake
    // (never a silent connect-all), and a selection that matches
    // nothing under this token is an honest error. Accounts not in
    // the selection are untouched below: they are not upserted, and
    // the AD2 hygiene only supersedes integrations no account
    // references any more, so their integrations stay alive.
    if (dto.adAccountExternalIds !== undefined) {
      if (!Array.isArray(dto.adAccountExternalIds) || dto.adAccountExternalIds.length === 0) {
        throw new BadRequestException("কোনো Ad Account নির্বাচন করা হয়নি — অন্তত একটি Account বেছে নিন।");
      }
      discovered = discovered.filter((a) => dto.adAccountExternalIds!.includes(a.externalId));
      if (discovered.length === 0) {
        throw new BadRequestException("নির্বাচিত Ad Accountগুলো এই Token-এর অধীনে পাওয়া যায়নি — Tokenটি ওই Accountগুলোতে Access পায় কিনা যাচাই করুন।");
      }
    }
    if (discovered.length === 0) throw new BadRequestException("No Meta ad accounts found for this token");

    const integration = await (this.prisma as any).integration.create({
      data: { organizationId, provider: "meta", status: "CONNECTED", externalAccountId: me.id, appSource },
    });
    await (this.prisma as any).integrationCredential.create({
      data: { integrationId: integration.id, encryptedData: encryptJson({ accessToken: dto.accessToken }) },
    });
    // AD3: capture the platform status + timezone Meta already
    // returned in discovery (previously parsed, then discarded).
    const prevRows = await (this.prisma as any).adAccount.findMany({ where: { organizationId, platform: "meta" } }).catch(() => []);
    const prevByExternal = new Map<string, any>((Array.isArray(prevRows) ? prevRows : []).map((r: any) => [r.externalId, r]));
    const accounts = [];
    for (const a of discovered) {
      const info = metaStatusInfo(a.status, a.timezone);
      const prev = prevByExternal.get(a.externalId);
      const account = await (this.prisma as any).adAccount.upsert({
        where: { organizationId_platform_externalId: { organizationId, platform: "meta", externalId: a.externalId } },
        update: {
          name: a.name, currency: a.currency, integrationId: integration.id, sourceType: "api", status: "ACTIVE",
          ...(info.raw !== null ? { platformStatusRaw: info.raw, platformStatusBucket: info.bucket } : {}),
          ...(info.timezone !== null ? { timezone: info.timezone } : {}),
          platformStatusCheckedAt: new Date(),
        },
        create: {
          organizationId, platform: "meta", sourceType: "api", externalId: a.externalId,
          name: a.name, currency: a.currency, integrationId: integration.id,
          platformStatusRaw: info.raw, platformStatusBucket: info.bucket, timezone: info.timezone,
          platformStatusCheckedAt: new Date(),
        },
      });
      accounts.push(account);
      if (info.bucket) await this.maybeNotifyPlatformStatus(organizationId, account, prev?.platformStatusBucket ?? null, info);
    }
    // AD2: accounts are on the NEW integration now — supersede this
    // Meta identity's (token user id) previous CONNECTED integrations
    // that no account references any more.
    await this.supersedePreviousIntegrations(organizationId, actorId, "meta", me.id, integration.id);
    await this.audit.log({ organizationId, userId: actorId, action: "integration.connect", entityType: "Integration", entityId: integration.id, metadata: { provider: "meta", accounts: accounts.length, appSource } });
    return { integrationId: integration.id, connectedAccounts: accounts.map((a: any) => this.serializeAccount(a)) };
  }

  async syncMetaInsights(organizationId: string, actorId: string, accountId: string, dto: MetaSyncDto, opts?: { fromJob?: boolean }) {
    // CC27: manual triggers are deny-gated; the scheduled job
    // path passes fromJob and is not (see syncInsightsJob).
    if (!opts?.fromJob) await this.assertAdAccountAccess(organizationId, actorId, accountId);
    const account = await this.getAccount(organizationId, accountId);
    if (account.platform !== "meta" || !account.integrationId || !account.externalId) {
      throw new BadRequestException("This ad account is not connected to Meta via API");
    }
    this.assertSyncEnabled(account);
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: account.integrationId, organizationId }, include: { credential: true },
    });
    if (!integration?.credential) throw new BadRequestException("Meta credentials are missing; reconnect the account");
    const { accessToken } = decryptJson<{ accessToken: string }>(integration.credential.encryptedData);
    const until = dto.until ?? new Date().toISOString().slice(0, 10);
    const since = dto.since ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const client = new MetaClient(accessToken);
    let rawRows: any[];
    try {
      rawRows = await client.getCampaignInsights(account.externalId, since, until);
    } catch (e) {
      await this.markSyncFailure(integration, e instanceof Error ? e.message : "Meta sync failed", { organizationId, account });
      throw new BadRequestException(`Meta insights sync failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    let created = 0, updated = 0;
    for (const raw of rawRows) {
      const n = normalizeMetaInsight(raw);
      let campaignId: string | null = null;
      if (n.campaignExternalId) {
        const campaign = await (this.prisma as any).adCampaign.upsert({
          where: { adAccountId_externalId: { adAccountId: account.id, externalId: n.campaignExternalId } },
          update: { name: n.campaignName ?? undefined },
          create: { organizationId, adAccountId: account.id, externalId: n.campaignExternalId, name: n.campaignName ?? n.campaignExternalId },
        });
        campaignId = campaign.id;
      }
      const result = await this.upsertMetric(organizationId, {
        adAccountId: account.id, adCampaignId: campaignId, platform: "meta", source: "api",
        campaignExternalId: n.campaignExternalId, campaignName: n.campaignName,
        date: utcDate(n.date), currency: account.currency, spendMinor: n.spendMinor,
        impressions: n.impressions, clicks: n.clicks, conversions: n.conversions,
        conversionValueMinor: n.conversionValueMinor, reach: n.reach ?? 0,
      });
      if (result === "created") created++; else updated++;
    }
    await this.markSyncSuccess(integration.id);
    await this.audit.log({ organizationId, userId: actorId, action: "sync.meta_insights", entityType: "AdAccount", entityId: account.id, metadata: { since, until, rows: rawRows.length, created, updated } });
    return { since, until, rows: rawRows.length, created, updated };
  }
  // ---------- Shared daily-rows upsert for API adapters ----------
  private async upsertDailyRows(organizationId: string, account: any, platform: string, rows: {
    date: string; campaignExternalId: string; campaignName?: string; spendMinor: bigint;
    impressions: number; clicks: number; conversions: number; conversionValueMinor: bigint; currency: string;
  }[]): Promise<{ created: number; updated: number }> {
    let created = 0, updated = 0;
    for (const n of rows) {
      let campaignId: string | null = null;
      if (n.campaignExternalId) {
        const campaign = await (this.prisma as any).adCampaign.upsert({
          where: { adAccountId_externalId: { adAccountId: account.id, externalId: n.campaignExternalId } },
          update: { name: n.campaignName ?? undefined },
          create: { organizationId, adAccountId: account.id, externalId: n.campaignExternalId, name: n.campaignName ?? n.campaignExternalId },
        });
        campaignId = campaign.id;
      }
      const result = await this.upsertMetric(organizationId, {
        adAccountId: account.id, adCampaignId: campaignId, platform, source: "api",
        campaignExternalId: n.campaignExternalId, campaignName: n.campaignName,
        date: new Date(`${n.date}T00:00:00.000Z`), currency: n.currency,
        spendMinor: n.spendMinor, impressions: n.impressions, clicks: n.clicks,
        conversions: n.conversions, conversionValueMinor: n.conversionValueMinor,
      });
      if (result === "created") created++; else updated++;
    }
    return { created, updated };
  }

  private async integrationSecrets<T>(organizationId: string, account: any, providerLabel: string): Promise<T> {
    if (!account.integrationId || !account.externalId) {
      throw new BadRequestException(`This ad account is not connected to ${providerLabel} via API`);
    }
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: account.integrationId, organizationId }, include: { credential: true },
    });
    if (!integration?.credential) throw new BadRequestException(`${providerLabel} credentials are missing; reconnect the account`);
    return decryptJson<T>(integration.credential.encryptedData);
  }

  private dateRange(dto: { since?: string; until?: string }): { since: string; until: string } {
    return {
      until: dto.until ?? new Date().toISOString().slice(0, 10),
      since: dto.since ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
    };
  }

  // ---------- Ad-level + breakdown sync (Phase G) ----------
  private async metaClientFor(organizationId: string, accountId: string) {
    const account = await this.getAccount(organizationId, accountId);
    if (account.platform !== "meta" || !account.integrationId || !account.externalId) {
      throw new BadRequestException("This ad account is not connected to Meta via API");
    }
    // AD5: ad-insights + breakdown syncs share this loader, so the
    // sync-disabled gate here covers both.
    this.assertSyncEnabled(account);
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: account.integrationId, organizationId }, include: { credential: true },
    });
    if (!integration?.credential) throw new BadRequestException("Meta credentials are missing; reconnect the account");
    const { accessToken } = decryptJson<{ accessToken: string }>(integration.credential.encryptedData);
    return { account, integration, client: new MetaClient(accessToken) };
  }

  async syncMetaAdInsights(organizationId: string, actorId: string, accountId: string, dto: MetaSyncDto) {
    // CC27: manual-only trigger (no job path) — deny-gated.
    await this.assertAdAccountAccess(organizationId, actorId, accountId);
    const { account, integration, client } = await this.metaClientFor(organizationId, accountId);
    const until = dto.until ?? new Date().toISOString().slice(0, 10);
    const since = dto.since ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    let rawRows: any[];
    try {
      rawRows = await client.getAdInsights(account.externalId, since, until);
    } catch (e) {
      await this.markSyncFailure(integration, e instanceof Error ? e.message : "Meta sync failed", { organizationId, account });
      throw new BadRequestException(`Meta ad-insights sync failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    let created = 0, updated = 0;
    for (const raw of rawRows) {
      const n = normalizeMetaAdInsight(raw);
      let campaignId: string | null = null;
      if (n.campaignExternalId) {
        const campaign = await (this.prisma as any).adCampaign.upsert({
          where: { adAccountId_externalId: { adAccountId: account.id, externalId: n.campaignExternalId } },
          update: { name: n.campaignName ?? undefined },
          create: { organizationId, adAccountId: account.id, externalId: n.campaignExternalId, name: n.campaignName ?? n.campaignExternalId },
        });
        campaignId = campaign.id;
      }
      const result = await this.upsertMetric(organizationId, {
        adAccountId: account.id, adCampaignId: campaignId, platform: "meta", source: "api",
        campaignExternalId: n.campaignExternalId, campaignName: n.campaignName,
        adSetExternalId: n.adSetExternalId, adSetName: n.adSetName,
        adExternalId: n.adExternalId, adName: n.adName,
        reach: n.reach, videoViews: n.videoViews,
        date: utcDate(n.date), currency: account.currency, spendMinor: n.spendMinor,
        impressions: n.impressions, clicks: n.clicks, conversions: n.conversions,
        conversionValueMinor: n.conversionValueMinor,
      });
      if (result === "created") created++; else updated++;
    }
    await this.markSyncSuccess(integration.id);
    await this.audit.log({ organizationId, userId: actorId, action: "sync.meta_ad_insights", entityType: "AdAccount", entityId: account.id, metadata: { since, until, rows: rawRows.length, created, updated } });
    return { since, until, rows: rawRows.length, created, updated };
  }

  async syncMetaBreakdowns(organizationId: string, actorId: string, accountId: string, dto: MetaSyncDto) {
    // CC27: manual-only trigger (no job path) — deny-gated.
    await this.assertAdAccountAccess(organizationId, actorId, accountId);
    const { account, integration, client } = await this.metaClientFor(organizationId, accountId);
    const until = dto.until ?? new Date().toISOString().slice(0, 10);
    const since = dto.since ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const jobs: { dimension: string; breakdowns: string; keyOf: (r: any) => string }[] = [
      { dimension: "age_gender", breakdowns: "age,gender", keyOf: (r) => `${r.age ?? "unknown"}:${r.gender ?? "unknown"}` },
      { dimension: "placement", breakdowns: "publisher_platform,platform_position", keyOf: (r) => `${r.publisher_platform ?? "unknown"}:${r.platform_position ?? "unknown"}` },
      { dimension: "device", breakdowns: "impression_device", keyOf: (r) => String(r.impression_device ?? "unknown") },
      { dimension: "region", breakdowns: "region", keyOf: (r) => String(r.region ?? "unknown") },
      { dimension: "hourly", breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone", keyOf: (r) => String(r.hourly_stats_aggregated_by_advertiser_time_zone ?? "?").slice(0, 2) },
    ];
    let rows = 0;
    for (const job of jobs) {
      let rawRows: any[];
      try {
        rawRows = await client.getBreakdownInsights(account.externalId, since, until, job.breakdowns);
      } catch (e) {
        await this.markSyncFailure(integration, e instanceof Error ? e.message : "Meta sync failed", { organizationId, account });
        throw new BadRequestException(`Meta breakdown sync (${job.dimension}) failed: ${e instanceof Error ? e.message : "unknown error"}`);
      }
      for (const raw of rawRows) {
        const n = normalizeMetaInsight(raw);
        const where = {
          organizationId_adAccountId_date_dimension_key_campaignExternalId_source: {
            organizationId, adAccountId: account.id, date: utcDate(n.date), dimension: job.dimension,
            key: job.keyOf(raw), campaignExternalId: n.campaignExternalId, source: "api",
          },
        };
        const data = {
          organizationId, adAccountId: account.id, platform: "meta", source: "api",
          date: utcDate(n.date), dimension: job.dimension, key: job.keyOf(raw),
          campaignExternalId: n.campaignExternalId, spendMinor: n.spendMinor,
          impressions: n.impressions, clicks: n.clicks, platformConversions: n.conversions,
        };
        const existing = await (this.prisma as any).dailyAdBreakdown.findUnique({ where });
        if (existing) await (this.prisma as any).dailyAdBreakdown.update({ where, data });
        else await (this.prisma as any).dailyAdBreakdown.create({ data });
        rows++;
      }
    }
    await this.markSyncSuccess(integration.id);
    await this.audit.log({ organizationId, userId: actorId, action: "sync.meta_breakdowns", entityType: "AdAccount", entityId: account.id, metadata: { since, until, rows } });
    return { since, until, rows };
  }

  /** Creative performance: ad-level rows aggregated over the window. */
  async getAdMetrics(organizationId: string, accountId: string, days = 30) {
    const account = await this.getAccount(organizationId, accountId);
    const since = new Date(Date.now() - (days - 1) * 86400000);
    since.setUTCHours(0, 0, 0, 0);
    const rows = await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, adAccountId: account.id, date: { gte: since } }, take: 5000,
    });
    const adRows = rows.filter((r: any) => r.adExternalId);
    const byAd = new Map<string, any>();
    for (const r of adRows) {
      const cur = byAd.get(r.adExternalId) ?? {
        adExternalId: r.adExternalId, adName: r.adName, adSetName: r.adSetName, campaignName: r.campaignName,
        spendMinor: 0n, impressions: 0, clicks: 0, reach: 0, videoViews: 0, conversions: 0, conversionValueMinor: 0n, currency: r.currency,
      };
      cur.spendMinor += BigInt(r.spendMinor); cur.impressions += r.impressions; cur.clicks += r.clicks;
      cur.reach += r.reach; cur.videoViews += r.videoViews; cur.conversions += r.platformConversions;
      cur.conversionValueMinor += BigInt(r.platformConversionValueMinor);
      byAd.set(r.adExternalId, cur);
    }
    return [...byAd.values()].map((a) => ({
      ...a,
      spendMinor: String(a.spendMinor), conversionValueMinor: String(a.conversionValueMinor),
      ctr: a.impressions > 0 ? Math.round((a.clicks / a.impressions) * 10000) / 100 : null,
      cpaMinor: a.conversions > 0 ? String(a.spendMinor / BigInt(a.conversions)) : null,
      frequency: a.reach > 0 ? Math.round((a.impressions / a.reach) * 100) / 100 : null,
    })).sort((x, y) => Number(BigInt(y.spendMinor) - BigInt(x.spendMinor)));
  }

  /** Click-to-WhatsApp report: conversations Meta told us started
   * from an ad (referral source id = ad id), grouped per ad, with the
   * campaign name resolved from ad-level metrics when available. */
  async ctwaReport(organizationId: string, days = 30) {
    const since = new Date(Date.now() - (days - 1) * 86400000);
    const conversations = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, channel: "whatsapp", ctwaSourceId: { not: null }, lastMessageAt: { gte: since } },
      take: 5000,
    }).catch(() => []);
    const byAd = new Map<string, number>();
    for (const c of conversations) byAd.set(c.ctwaSourceId, (byAd.get(c.ctwaSourceId) ?? 0) + 1);
    const out = [];
    for (const [sourceId, chats] of byAd.entries()) {
      const metric = await (this.prisma as any).dailyAdMetric.findFirst({
        where: { organizationId, adExternalId: sourceId },
      }).catch(() => null);
      out.push({ sourceId, campaignName: metric?.campaignName ?? null, adName: metric?.adName ?? null, chats });
    }
    return out.sort((a, b) => b.chats - a.chats);
  }

  /** Creative leaderboard (Phase K): per-ad performance from the
   * synced ad-level rows, with an HONEST fatigue signal: frequency
   * >= 3.5 AND CTR down >= 30% vs the previous equal window. Both
   * inputs come from Meta's rows; nothing is predicted. */
  async creativeLeaderboard(organizationId: string, days = 14) {
    const now = new Date();
    const prevSince = new Date(now.getTime() - 2 * days * 86400000);
    const rows = await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, source: "meta", date: { gte: prevSince } }, take: 20000,
    });
    // NB4/CN7: the aggregation itself lives in
    // creative-fatigue.ts, shared verbatim with the Campaign
    // Builder's per-plan creative insights — one fatigue rule.
    return computeCreativeLeaderboard(rows, days, now);
  }

  /** Budget pacing (Phase K): month-to-date spend vs an optional
   * monthly budget the owner sets, plus cross-plan shift suggestions
   * computed from this month's first-party + platform numbers.
   * Suggestions are information only — nothing moves automatically. */
  async pacing(organizationId: string, monthlyBudgetMajor?: number) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const dayOfMonth = now.getUTCDate();
    const rows = await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, date: { gte: monthStart } }, take: 20000,
    });
    let spend = 0n;
    const perCampaign = new Map<string, { name: string; spend: bigint; conversions: bigint }>();
    for (const r of rows as any[]) {
      if ((r.adExternalId ?? "") !== "") continue; // campaign-level rows only
      spend += BigInt(r.spendMinor ?? 0);
      const key = String(r.campaignExternalId);
      const c = perCampaign.get(key) ?? { name: r.campaignName ?? key, spend: 0n, conversions: 0n };
      c.spend += BigInt(r.spendMinor ?? 0); c.conversions += BigInt(r.conversions ?? 0);
      perCampaign.set(key, c);
    }
    const dailyAvg = dayOfMonth > 0 ? Number(spend) / dayOfMonth : 0;
    const projected = Math.round(dailyAvg * daysInMonth);
    const budgetMinor = monthlyBudgetMajor && monthlyBudgetMajor > 0 ? Math.round(monthlyBudgetMajor * 100) : null;
    const expectedByNow = budgetMinor !== null ? Math.round(budgetMinor * dayOfMonth / daysInMonth) : null;
    const campaigns = [...perCampaign.values()].map((c) => ({
      name: c.name, spendMinor: c.spend.toString(), conversions: Number(c.conversions),
      cpaMinor: c.conversions > 0n ? (c.spend / c.conversions).toString() : null,
    })).sort((a, b) => Number(BigInt(b.spendMinor) - BigInt(a.spendMinor)));
    const suggestions: string[] = [];
    const withCpa = campaigns.filter((c) => c.cpaMinor !== null && BigInt(c.spendMinor) > 0n);
    if (withCpa.length >= 2) {
      const best = [...withCpa].sort((a, b) => Number(BigInt(a.cpaMinor!) - BigInt(b.cpaMinor!)))[0];
      const worst = [...withCpa].sort((a, b) => Number(BigInt(b.cpaMinor!) - BigInt(a.cpaMinor!)))[0];
      if (best !== worst && BigInt(worst.cpaMinor!) >= 2n * BigInt(best.cpaMinor!)) {
        suggestions.push(`"${worst.name}" এর CPA "${best.name}" এর দ্বিগুণেরও বেশি — বাজেটের কিছু অংশ "${best.name}" এ সরানোর কথা বিবেচনা করুন (স্বয়ংক্রিয়ভাবে কিছু সরানো হয়নি)।`);
      }
    }
    if (budgetMinor !== null && projected > budgetMinor) {
      suggestions.push(`এই গতিতে মাস শেষে খরচ বাজেট ছাড়িয়ে যাবে (আনুমানিক ${Math.round(projected / 100)} বনাম বাজেট ${monthlyBudgetMajor}) — দৈনিক বাজেট কমানো বা ক্যাপ রুল ভাবুন।`);
    }
    return {
      monthSpendMinor: spend.toString(), dayOfMonth, daysInMonth,
      projectedMonthSpendMinor: String(projected),
      monthlyBudgetMinor: budgetMinor !== null ? String(budgetMinor) : null,
      expectedSpendByNowMinor: expectedByNow !== null ? String(expectedByNow) : null,
      pacePercent: expectedByNow !== null && expectedByNow > 0 ? Math.round(Number(spend) / expectedByNow * 100) : null,
      campaigns, suggestions,
    };
  }

  async getBreakdowns(organizationId: string, accountId: string, dimension: string, days = 30) {
    const account = await this.getAccount(organizationId, accountId);
    if (!["age_gender", "placement", "device", "region", "hourly"].includes(dimension)) throw new BadRequestException("dimension must be age_gender, placement, device, region or hourly");
    const since = new Date(Date.now() - (days - 1) * 86400000);
    since.setUTCHours(0, 0, 0, 0);
    const rows = await (this.prisma as any).dailyAdBreakdown.findMany({
      where: { organizationId, adAccountId: account.id, dimension, date: { gte: since } }, take: 5000,
    });
    const byKey = new Map<string, any>();
    for (const r of rows) {
      const cur = byKey.get(r.key) ?? { key: r.key, spendMinor: 0n, impressions: 0, clicks: 0, conversions: 0 };
      cur.spendMinor += BigInt(r.spendMinor); cur.impressions += r.impressions; cur.clicks += r.clicks; cur.conversions += r.platformConversions;
      byKey.set(r.key, cur);
    }
    return [...byKey.values()].map((b) => ({
      ...b, spendMinor: String(b.spendMinor),
      ctr: b.impressions > 0 ? Math.round((b.clicks / b.impressions) * 10000) / 100 : null,
    })).sort((x, y) => Number(BigInt(y.spendMinor) - BigInt(x.spendMinor)));
  }

  // ---------- Google Ads ----------
  async connectGoogle(organizationId: string, actorId: string, dto: {
    customerId: string; clientId: string; clientSecret: string; refreshToken: string; developerToken: string; loginCustomerId?: string;
  }) {
    const secrets: GoogleAdsSecrets = {
      clientId: dto.clientId, clientSecret: dto.clientSecret, refreshToken: dto.refreshToken,
      developerToken: dto.developerToken, loginCustomerId: dto.loginCustomerId,
    };
    const client = new GoogleAdsClient(secrets);
    let customer: { id: string; descriptiveName?: string; currencyCode?: string; status?: string; timeZone?: string };
    try {
      customer = await client.verifyCustomer(dto.customerId);
    } catch (e) {
      throw new BadRequestException(`Google Ads verification failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    const integration = await (this.prisma as any).integration.create({
      data: { organizationId, provider: "google_ads", status: "CONNECTED", externalAccountId: customer.id },
    });
    await (this.prisma as any).integrationCredential.create({
      data: { integrationId: integration.id, encryptedData: encryptJson(secrets) },
    });
    // AD3: the customer resource's own status + timeZone, captured
    // at connect (null when Google does not return them).
    const gInfo = googleStatusInfo(customer.status, customer.timeZone);
    const gPrev = await (this.prisma as any).adAccount.findFirst({ where: { organizationId, platform: "google", externalId: customer.id } }).catch(() => null);
    const account = await (this.prisma as any).adAccount.upsert({
      where: { organizationId_platform_externalId: { organizationId, platform: "google", externalId: customer.id } },
      update: {
        name: customer.descriptiveName ?? `Google Ads ${customer.id}`, currency: customer.currencyCode ?? "USD", integrationId: integration.id, sourceType: "api", status: "ACTIVE",
        ...(gInfo.raw !== null ? { platformStatusRaw: gInfo.raw, platformStatusBucket: gInfo.bucket } : {}),
        ...(gInfo.timezone !== null ? { timezone: gInfo.timezone } : {}),
        platformStatusCheckedAt: new Date(),
      },
      create: {
        organizationId, platform: "google", sourceType: "api", externalId: customer.id, name: customer.descriptiveName ?? `Google Ads ${customer.id}`, currency: customer.currencyCode ?? "USD", integrationId: integration.id,
        platformStatusRaw: gInfo.raw, platformStatusBucket: gInfo.bucket, timezone: gInfo.timezone, platformStatusCheckedAt: new Date(),
      },
    });
    if (gInfo.bucket) await this.maybeNotifyPlatformStatus(organizationId, account, gPrev?.platformStatusBucket ?? null, gInfo);
    // AD2: supersede this Google customer identity's previous
    // CONNECTED integrations that no account references any more.
    await this.supersedePreviousIntegrations(organizationId, actorId, "google_ads", customer.id, integration.id);
    await this.audit.log({ organizationId, userId: actorId, action: "integration.connect", entityType: "Integration", entityId: integration.id, metadata: { provider: "google_ads" } });
    return { integrationId: integration.id, connectedAccounts: [this.serializeAccount(account)] };
  }

  async syncGoogleInsights(organizationId: string, actorId: string, accountId: string, dto: { since?: string; until?: string }, opts?: { fromJob?: boolean }) {
    // CC27: manual triggers are deny-gated; the scheduled job
    // path passes fromJob and is not (see syncInsightsJob).
    if (!opts?.fromJob) await this.assertAdAccountAccess(organizationId, actorId, accountId);
    const account = await this.getAccount(organizationId, accountId);
    if (account.platform !== "google") throw new BadRequestException("This is not a Google Ads account");
    this.assertSyncEnabled(account);
    const integration = account.integrationId
      ? await (this.prisma as any).integration.findFirst({ where: { id: account.integrationId, organizationId } }).catch(() => null)
      : null;
    const secrets = await this.integrationSecrets<GoogleAdsSecrets>(organizationId, account, "Google Ads");
    const { since, until } = this.dateRange(dto);
    const client = new GoogleAdsClient(secrets);
    let rows;
    try {
      rows = await client.getCampaignDaily(account.externalId, since, until);
    } catch (e) {
      await this.markSyncFailure(integration ?? account.integrationId, e instanceof Error ? e.message : "Google sync failed", { organizationId, account });
      throw new BadRequestException(`Google Ads sync failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    const { created, updated } = await this.upsertDailyRows(organizationId, account, "google", rows);
    await this.markSyncSuccess(account.integrationId);
    return { rows: rows.length, created, updated, since, until };
  }

  // ---------- TikTok Ads ----------
  async connectTikTok(organizationId: string, actorId: string, dto: { advertiserId: string; accessToken: string }) {
    const client = new TikTokAdsClient(dto.accessToken);
    let advertiser: { id: string; name?: string; currency?: string; status?: string; timezone?: string };
    try {
      advertiser = await client.verifyAdvertiser(dto.advertiserId);
    } catch (e) {
      throw new BadRequestException(`TikTok verification failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    const integration = await (this.prisma as any).integration.create({
      data: { organizationId, provider: "tiktok", status: "CONNECTED", externalAccountId: advertiser.id },
    });
    await (this.prisma as any).integrationCredential.create({
      data: { integrationId: integration.id, encryptedData: encryptJson({ accessToken: dto.accessToken }) },
    });
    // AD3: the advertiser/info status + timezone, captured at
    // connect (null when TikTok does not return them).
    const tInfo = tiktokStatusInfo(advertiser.status, advertiser.timezone);
    const tPrev = await (this.prisma as any).adAccount.findFirst({ where: { organizationId, platform: "tiktok", externalId: advertiser.id } }).catch(() => null);
    const account = await (this.prisma as any).adAccount.upsert({
      where: { organizationId_platform_externalId: { organizationId, platform: "tiktok", externalId: advertiser.id } },
      update: {
        name: advertiser.name ?? `TikTok ${advertiser.id}`, currency: advertiser.currency ?? "USD", integrationId: integration.id, sourceType: "api", status: "ACTIVE",
        ...(tInfo.raw !== null ? { platformStatusRaw: tInfo.raw, platformStatusBucket: tInfo.bucket } : {}),
        ...(tInfo.timezone !== null ? { timezone: tInfo.timezone } : {}),
        platformStatusCheckedAt: new Date(),
      },
      create: {
        organizationId, platform: "tiktok", sourceType: "api", externalId: advertiser.id, name: advertiser.name ?? `TikTok ${advertiser.id}`, currency: advertiser.currency ?? "USD", integrationId: integration.id,
        platformStatusRaw: tInfo.raw, platformStatusBucket: tInfo.bucket, timezone: tInfo.timezone, platformStatusCheckedAt: new Date(),
      },
    });
    if (tInfo.bucket) await this.maybeNotifyPlatformStatus(organizationId, account, tPrev?.platformStatusBucket ?? null, tInfo);
    // AD2: supersede this TikTok advertiser identity's previous
    // CONNECTED integrations that no account references any more.
    await this.supersedePreviousIntegrations(organizationId, actorId, "tiktok", advertiser.id, integration.id);
    await this.audit.log({ organizationId, userId: actorId, action: "integration.connect", entityType: "Integration", entityId: integration.id, metadata: { provider: "tiktok" } });
    return { integrationId: integration.id, connectedAccounts: [this.serializeAccount(account)] };
  }

  async syncTikTokInsights(organizationId: string, actorId: string, accountId: string, dto: { since?: string; until?: string }, opts?: { fromJob?: boolean }) {
    // CC27: manual triggers are deny-gated; the scheduled job
    // path passes fromJob and is not (see syncInsightsJob).
    if (!opts?.fromJob) await this.assertAdAccountAccess(organizationId, actorId, accountId);
    const account = await this.getAccount(organizationId, accountId);
    if (account.platform !== "tiktok") throw new BadRequestException("This is not a TikTok Ads account");
    this.assertSyncEnabled(account);
    const integration = account.integrationId
      ? await (this.prisma as any).integration.findFirst({ where: { id: account.integrationId, organizationId } }).catch(() => null)
      : null;
    const secrets = await this.integrationSecrets<{ accessToken: string }>(organizationId, account, "TikTok");
    const { since, until } = this.dateRange(dto);
    const client = new TikTokAdsClient(secrets.accessToken);
    let rows;
    try {
      rows = await client.getCampaignDaily(account.externalId, since, until);
    } catch (e) {
      await this.markSyncFailure(integration ?? account.integrationId, e instanceof Error ? e.message : "TikTok sync failed", { organizationId, account });
      throw new BadRequestException(`TikTok sync failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    const { created, updated } = await this.upsertDailyRows(organizationId, account, "tiktok", rows);
    await this.markSyncSuccess(account.integrationId);
    return { rows: rows.length, created, updated, since, until };
  }
}
