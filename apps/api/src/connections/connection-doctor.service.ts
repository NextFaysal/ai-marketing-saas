import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import { ImapFlow } from "imapflow";
import * as nodemailer from "nodemailer";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson } from "../integrations/crypto";
import { graphGet } from "../common/meta-graph";
import { MetaMessagingClient } from "../inbox/meta-messaging.client";
import { TelegramClient } from "../inbox/channels/telegram.service";
import { WooClient } from "../integrations/woocommerce/woo.client";
import { ShopifyClient } from "../integrations/shopify/shopify.client";
import { ShopifyService } from "../integrations/shopify/shopify.service";
import { SteadfastClient } from "../courier/steadfast.client";
import { PathaoClient } from "../courier/pathao.client";
import { RedxClient } from "../courier/redx.client";
import { TikTokClient } from "../social/tiktok.client";
import { YouTubeClient } from "../social/youtube.client";
import { LinkedInClient } from "../social/linkedin.client";
import { GoogleConnectService, GOOGLE_PROVIDER_KIND } from "./google-connect.service";
import { EmailProvider, type TenantSmtpConfig } from "../messaging/email.provider";
import { tenantSmtpFromRow } from "../messaging/sender-config";
import { TenantGatewayClient, type TenantBkashCreds } from "./tenant-gateway.client";
import { LlmVerifyClient } from "./llm-verify.client";
import { ConnectionsService } from "./connections.service";
import { ApiException, badRequest, notFound, renderMessage } from "../i18n";

/**
 * CC11 (Connect Center Advanced) — the Connection Doctor.
 *
 * A diagnosis is a list of steps. Every step reports ONLY what a
 * REAL provider call returned — the provider's own message rides
 * along verbatim on failure. A connection kind for which no real
 * check exists gets `not_checkable` steps with the reason spelled
 * out; the Doctor NEVER upgrades an absence of evidence into a
 * pass. Overall: fail = any real step failed (a proven breakage
 * dominates); pass = every step was checkable and passed;
 * partial = everything else (some steps uncheckable, or nothing
 * was checkable at all).
 *
 * Probes are the injectable seam (the MetaAppClient pattern):
 * production probes call the EXISTING clients (MetaMessagingClient,
 * WooClient, ShopifyClient, the courier clients, TelegramClient,
 * TenantGatewayClient, LlmVerifyClient, TikTokClient,
 * YouTubeClient, EmailProvider's MS4 SMTP verify, and the same
 * ImapFlow/nodemailer construction EmailChannelService uses) —
 * no new protocol code lives here.
 */

export interface DoctorStep {
  key: string;
  label: string;
  /** ML10 (MB4, a2/D-MB4-8): English companions for the
   * dashboard's locale rendering; bn fields stay canonical. */
  labelEn?: string;
  status: "pass" | "fail" | "not_checkable";
  message: string;
  messageEn?: string;
}

/** A catalog text reference for a Doctor step (connections
 * namespace); a plain string is provider-verbatim text that
 * reads the same in every locale. */
type DoctorText = string | { code: string; params?: Record<string, string | number> };

export interface DoctorTarget {
  targetType: string; // == overview account.source
  targetId: string; // == overview account.id
  provider: string;
  category: string;
  displayName: string;
}

export interface DoctorProbes {
  metaVerifyToken(secrets: any): Promise<{ id: string; name?: string }>;
  graphGet(token: string, path: string): Promise<any>;
  telegramGetMe(botToken: string): Promise<{ id: number; username?: string; first_name?: string }>;
  wooTest(storeUrl: string, creds: { consumerKey: string; consumerSecret: string }): Promise<{ storeName?: string; version?: string }>;
  shopifyTest(storeUrl: string, secrets: { accessToken: string; apiSecret: string }): Promise<{ id: number; name: string; currency: string; domain: string }>;
  steadfastBalance(creds: { apiKey: string; secretKey: string }): Promise<any>;
  pathaoVerify(creds: any): Promise<{ stores: number }>;
  redxVerify(creds: any): Promise<{ areas: number }>;
  emailImapLogin(creds: any): Promise<void>;
  emailSmtpVerify(creds: any): Promise<void>;
  smtpVerify(cfg: TenantSmtpConfig): Promise<{ ok: true }>;
  llmVerify(provider: string, apiKey: string, model?: string): Promise<{ model: string }>;
  bkashGrant(creds: TenantBkashCreds): Promise<string>;
  tiktokUserInfo(accessToken: string): Promise<{ openId: string; displayName: string }>;
  youtubeChannels(accessToken: string): Promise<{ id: string; title: string }[]>;
  /** CC20: the Pages a LinkedIn token administrates — the
   * doctor's LinkedIn check (a token that lists zero Pages it
   * admins is a real, reportable result, not a failure). */
  linkedinOrgs(accessToken: string): Promise<{ id: string; name: string }[]>;
}

export function defaultDoctorProbes(): DoctorProbes {
  const gateway = new TenantGatewayClient();
  const llm = new LlmVerifyClient();
  const emailProvider = new EmailProvider();
  return {
    metaVerifyToken: (secrets) => new MetaMessagingClient(secrets).verifyToken(),
    graphGet: (token, path) => graphGet(token, path),
    telegramGetMe: (botToken) => new TelegramClient(botToken).getMe(),
    wooTest: (storeUrl, creds) => new WooClient(storeUrl, creds).testConnection(),
    shopifyTest: (storeUrl, secrets) => new ShopifyClient(storeUrl, secrets).testConnection(),
    steadfastBalance: (creds) => new SteadfastClient(creds).getBalance(),
    pathaoVerify: (creds) => new PathaoClient(creds).verify(),
    redxVerify: (creds) => new RedxClient(creds).verify(),
    emailImapLogin: async (creds) => {
      // The same ImapFlow construction EmailChannelService uses
      // for its connect-time verify (buildImapClient).
      const imap = new ImapFlow({
        host: creds.imapHost, port: Number(creds.imapPort) || 993, secure: Number(creds.imapPort) === 993,
        auth: { user: creds.user, pass: creds.password }, logger: false,
      });
      try { await imap.connect(); await imap.logout(); }
      catch (e) { try { await (imap as any).close?.(); } catch { /* already closed */ } throw e; }
    },
    emailSmtpVerify: async (creds) => {
      // The same nodemailer transport EmailChannelService builds
      // for its connect-time verify (buildTransport).
      const transport = nodemailer.createTransport({
        host: creds.smtpHost, port: Number(creds.smtpPort) || 587, secure: Number(creds.smtpPort) === 465,
        auth: { user: creds.user, pass: creds.password },
      });
      await transport.verify();
    },
    smtpVerify: (cfg) => emailProvider.verifyTenantSmtp(cfg),
    llmVerify: (provider, apiKey, model) => llm.verifyKey(provider, apiKey, model),
    bkashGrant: (creds) => gateway.bkashGrantToken(creds),
    tiktokUserInfo: (accessToken) => new TikTokClient().getUserInfo(accessToken),
    youtubeChannels: (accessToken) => new YouTubeClient().listChannels(accessToken),
    linkedinOrgs: (accessToken) => new LinkedInClient().listAdminOrganizations(accessToken),
  };
}

export const DIAGNOSE_ALL_CAP = 25;

export function overallFromSteps(steps: DoctorStep[]): "pass" | "fail" | "partial" {
  const passed = steps.filter((s) => s.status === "pass").length;
  const failed = steps.filter((s) => s.status === "fail").length;
  if (failed > 0) return "fail";
  if (passed > 0 && passed === steps.length) return "pass";
  return "partial";
}

@Injectable()
export class ConnectionDoctorService {
  private readonly probes: DoctorProbes;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly connections: ConnectionsService,
    @Optional() probes?: DoctorProbes,
    @Optional() private readonly shopify?: ShopifyService,
    // CC20: the Google pack's token lifecycle lives in
    // GoogleConnectService (refresh + list) — the Doctor calls
    // it for the three google_* providers instead of duplicating
    // token handling here.
    @Optional() private readonly googleConnect?: GoogleConnectService,
  ) {
    this.probes = probes ?? defaultDoctorProbes();
  }

  // ---------- target enumeration (the overview IS the list) ----------

  async listTargets(organizationId: string): Promise<DoctorTarget[]> {
    const overview = await this.connections.getOverview(organizationId);
    return overview.categories.flatMap((c: any) =>
      (c.accounts ?? []).map((a: any) => ({
        targetType: a.source as string,
        targetId: a.id as string,
        provider: a.provider as string,
        category: a.category as string,
        displayName: a.displayName as string,
      })),
    );
  }

  async findTarget(organizationId: string, targetType: string, targetId: string): Promise<DoctorTarget> {
    const targets = await this.listTargets(organizationId);
    const target = targets.find((t) => t.targetType === targetType && t.targetId === targetId);
    if (!target) throw notFound("connections.connectionTargetNotFound");
    return target;
  }

  // ---------- runs ----------

  async diagnoseTarget(
    organizationId: string,
    target: DoctorTarget,
    opts: { runById?: string | null; trigger: "manual" | "sweep" },
  ) {
    const { steps, integrationId } = await this.checkTarget(organizationId, target);
    const overall = overallFromSteps(steps);
    const row = await (this.prisma as any).connectionHealthCheck.create({
      data: {
        organizationId, targetType: target.targetType, targetId: target.targetId,
        integrationId: integrationId ?? null, provider: target.provider,
        category: target.category, displayName: target.displayName,
        runById: opts.runById ?? null, trigger: opts.trigger, overall, steps,
      },
    });
    await this.audit.log({
      organizationId, userId: opts.runById ?? undefined, action: "connection.health_check",
      entityType: "ConnectionHealthCheck", entityId: row.id,
      metadata: { targetType: target.targetType, targetId: target.targetId, provider: target.provider, overall, trigger: opts.trigger },
    }).catch(() => undefined);
    return this.runView(row);
  }

  async diagnoseOne(organizationId: string, runById: string, targetType: string, targetId: string) {
    const target = await this.findTarget(organizationId, targetType, targetId);
    return this.diagnoseTarget(organizationId, target, { runById, trigger: "manual" });
  }

  /** Bounded: targets run SEQUENTIALLY (provider rate limits are
   * real), and anything past the cap is reported, never silently
   * dropped or silently run. */
  async diagnoseAll(organizationId: string, runById: string) {
    const targets = await this.listTargets(organizationId);
    const capped = targets.slice(0, DIAGNOSE_ALL_CAP);
    const runs: any[] = [];
    for (const target of capped) {
      runs.push(await this.diagnoseTarget(organizationId, target, { runById, trigger: "manual" }));
    }
    return {
      runs,
      totalTargets: targets.length,
      ranTargets: capped.length,
      skippedBeyondCap: targets.length - capped.length,
      cap: DIAGNOSE_ALL_CAP,
    };
  }

  async listHistory(organizationId: string, targetType: string, targetId: string, limit = 20) {
    const rows = await (this.prisma as any).connectionHealthCheck.findMany({
      where: { organizationId, targetType, targetId },
      orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 100),
    }).catch(() => []);
    return { runs: rows.map((r: any) => this.runView(r)) };
  }

  async listRecentRuns(organizationId: string, limit = 20) {
    const rows = await (this.prisma as any).connectionHealthCheck.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    }).catch(() => []);
    return { runs: rows.map((r: any) => this.runView(r)) };
  }

  private runView(row: any) {
    return {
      id: row.id, targetType: row.targetType, targetId: row.targetId,
      integrationId: row.integrationId ?? null, provider: row.provider ?? null,
      category: row.category ?? null, displayName: row.displayName ?? null,
      runById: row.runById ?? null, trigger: row.trigger, overall: row.overall,
      steps: row.steps ?? [], createdAt: row.createdAt,
    };
  }

  // ---------- step machinery ----------

  /** ML10 (MB4): step texts are catalog codes in the
   * connections namespace, rendered bn (canonical) + en
   * (companion). Provider failure messages still ride verbatim
   * (messageEn === message) per the Doctor's honesty rule. */
  private doctorTexts(t: DoctorText): { bn: string; en: string } {
    if (typeof t === "string") return { bn: t, en: t };
    const code = t.code.includes(".") ? t.code : `connections.${t.code}`;
    return { bn: renderMessage("bn", code, t.params), en: renderMessage("en", code, t.params) };
  }

  private async step(key: string, label: DoctorText, run: () => Promise<DoctorText>): Promise<DoctorStep> {
    const l = this.doctorTexts(label);
    try {
      const m = this.doctorTexts(await run());
      return { key, label: l.bn, labelEn: l.en, status: "pass", message: m.bn, messageEn: m.en };
    } catch (e) {
      if (e instanceof ApiException) {
        return { key, label: l.bn, labelEn: l.en, status: "fail", message: e.message, messageEn: renderMessage("en", e.code, e.params) };
      }
      const message = e instanceof Error ? e.message : String(e);
      return { key, label: l.bn, labelEn: l.en, status: "fail", message, messageEn: message };
    }
  }

  private notCheckable(key: string, label: DoctorText, message: DoctorText): DoctorStep {
    const l = this.doctorTexts(label);
    const m = this.doctorTexts(message);
    return { key, label: l.bn, labelEn: l.en, status: "not_checkable", message: m.bn, messageEn: m.en };
  }

  private fixedStep(key: string, label: DoctorText, status: "fail", message: DoctorText): DoctorStep {
    const l = this.doctorTexts(label);
    const m = this.doctorTexts(message);
    return { key, label: l.bn, labelEn: l.en, status, message: m.bn, messageEn: m.en };
  }

  private async credentialFor(integrationId: string): Promise<any | null> {
    const row = await (this.prisma as any).integrationCredential.findUnique({
      where: { integrationId },
    }).catch(() => null);
    if (!row?.encryptedData) return null;
    try { return decryptJson<any>(row.encryptedData); } catch { return null; }
  }

  private async integrationRow(organizationId: string, integrationId: string): Promise<any | null> {
    return (this.prisma as any).integration.findFirst({
      where: { id: integrationId, organizationId }, include: { store: true },
    }).catch(() => null);
  }

  // ---------- per-kind checks ----------

  private async checkTarget(organizationId: string, target: DoctorTarget): Promise<{ steps: DoctorStep[]; integrationId?: string | null }> {
    switch (target.targetType) {
      case "integration": {
        const integration = await this.integrationRow(organizationId, target.targetId);
        if (!integration) return { steps: [this.notCheckable("target", { code: "doctorLabelTarget" }, { code: "doctorNcIntegrationMissing" })] };
        return { steps: await this.checkIntegration(integration), integrationId: integration.id };
      }
      case "social_account": {
        const account = await (this.prisma as any).socialAccount.findFirst({
          where: { id: target.targetId, organizationId },
        }).catch(() => null);
        const integration = account?.integrationId
          ? await this.integrationRow(organizationId, account.integrationId)
          : await (this.prisma as any).integration.findFirst({
              where: { organizationId, externalAccountId: account?.externalId ?? "__none__" },
            }).catch(() => null);
        if (!integration) {
          return { steps: [this.notCheckable("credential", { code: "doctorLabelCredentialCheck" }, { code: "doctorNcSocialNoCredential" })] };
        }
        return { steps: await this.checkIntegration(integration), integrationId: integration.id };
      }
      case "store": {
        const integration = await (this.prisma as any).integration.findFirst({
          where: { organizationId, storeId: target.targetId },
        }).catch(() => null);
        if (!integration) {
          return { steps: [this.notCheckable("integration", { code: "doctorLabelStoreConnection" }, { code: "doctorNcStoreNoIntegration" })] };
        }
        return { steps: await this.checkIntegration(integration), integrationId: integration.id };
      }
      case "ad_account":
        return { steps: await this.checkAdAccount(organizationId, target.targetId) };
      case "sender_config":
        return { steps: await this.checkSenderConfig(organizationId, target.targetId) };
      case "org_llm_config":
        return { steps: await this.checkLlmConfig(organizationId, target.targetId) };
      case "tenant_payment_gateway":
        return { steps: await this.checkPaymentGateway(organizationId, target.targetId) };
      case "platform_payment_enablement":
        return { steps: [this.notCheckable("platform_gateway", { code: "doctorLabelPlatformGateway" }, { code: "doctorNcPlatformGateway" })] };
      case "business_profile":
        return { steps: [this.notCheckable("manual_payment", { code: "doctorLabelManualPaymentInfo" }, { code: "doctorNcManualPayment" })] };
      default:
        return { steps: [this.notCheckable("target", { code: "doctorLabelTarget" }, { code: "doctorNcUnknownTargetType", params: { type: target.targetType } })] };
    }
  }

  private async checkIntegration(integration: any): Promise<DoctorStep[]> {
    const provider = String(integration.provider ?? "");
    if (String(integration.status) === "DISCONNECTED") {
      return [this.notCheckable("connection", { code: "doctorLabelConnectionStatus" }, { code: "doctorNcDisconnected" })];
    }
    const creds = await this.credentialFor(integration.id);
    const missingCreds: DoctorStep = this.fixedStep("credential", { code: "doctorLabelCredential" }, "fail", { code: "doctorMissingCredential" });

    switch (provider) {
      case "whatsapp": {
        if (!creds?.accessToken) return [missingCreds];
        const steps: DoctorStep[] = [
          await this.step("token", { code: "doctorLabelMetaToken" }, async () => {
            const me = await this.probes.metaVerifyToken(creds);
            return { code: "doctorOkMetaToken", params: { name: me.name ?? me.id } };
          }),
        ];
        if (creds.phoneNumberId) {
          steps.push(await this.step("phone_number", { code: "doctorLabelWhatsappNumber" }, async (): Promise<DoctorText> => {
            const info = await this.probes.graphGet(creds.accessToken, `/${creds.phoneNumberId}?fields=display_phone_number,verified_name`);
            const number = info?.display_phone_number ?? creds.phoneNumberId;
            return info?.verified_name
              ? { code: "doctorOkWhatsappNumberNamed", params: { number, name: info.verified_name } }
              : { code: "doctorOkWhatsappNumber", params: { number } };
          }));
        } else {
          steps.push(this.notCheckable("phone_number", { code: "doctorLabelWhatsappNumber" }, { code: "doctorNcNoPhoneNumberId" }));
        }
        return steps;
      }
      case "messenger":
      case "instagram": {
        if (!creds?.accessToken) return [missingCreds];
        const steps: DoctorStep[] = [
          await this.step("token", { code: "doctorLabelMetaToken" }, async () => {
            const me = await this.probes.metaVerifyToken(creds);
            return { code: "doctorOkMetaToken", params: { name: me.name ?? me.id } };
          }),
        ];
        if (creds.pageId) {
          steps.push(await this.step("page", { code: "doctorLabelFacebookPage" }, async () => {
            const page = await this.probes.graphGet(creds.accessToken, `/${creds.pageId}?fields=name`);
            return { code: "doctorOkPage", params: { name: page?.name ?? creds.pageId } };
          }));
        } else {
          steps.push(this.notCheckable("page", { code: "doctorLabelFacebookPage" }, { code: "doctorNcNoPageId" }));
        }
        return steps;
      }
      case "meta": {
        if (!creds?.accessToken) return [missingCreds];
        return [await this.step("token", { code: "doctorLabelMetaToken" }, async () => {
          const me = await this.probes.graphGet(creds.accessToken, "/me?fields=id,name");
          return { code: "doctorOkMetaToken", params: { name: me?.name ?? me?.id } };
        })];
      }
      case "meta_social": {
        if (!creds?.accessToken) return [missingCreds];
        const pageId = creds.pageId ?? integration.externalAccountId;
        return [await this.step("page", { code: "doctorLabelFacebookPage" }, async () => {
          const page = await this.probes.graphGet(creds.accessToken, `/${pageId}?fields=name`);
          return { code: "doctorOkPage", params: { name: page?.name ?? pageId } };
        })];
      }
      case "tiktok_social": {
        if (!creds?.accessToken) return [missingCreds];
        return [await this.step("user", { code: "doctorLabelTiktokAccount" }, async () => {
          const user = await this.probes.tiktokUserInfo(creds.accessToken);
          return { code: "doctorOkTiktokUser", params: { name: user.displayName } };
        })];
      }
      case "youtube_social": {
        if (!creds?.accessToken) return [missingCreds];
        return [await this.step("channel", { code: "doctorLabelYoutubeChannel" }, async () => {
          const channels = await this.probes.youtubeChannels(creds.accessToken);
          if (!channels.length) throw badRequest("connections.doctorYoutubeNoChannel");
          return { code: "doctorOkYoutubeChannel", params: { name: channels[0].title } };
        })];
      }
      case "google_analytics":
      case "google_merchant":
      case "google_business": {
        // CC20: the real check is one authenticated list call
        // with a freshly-refreshed token — GoogleConnectService
        // owns the Google token lifecycle, the Doctor borrows it.
        if (!creds?.accessToken) return [missingCreds];
        if (!this.googleConnect) return [this.notCheckable("google", { code: "doctorLabelGoogleCheck" }, { code: "doctorNcGoogleServiceUnavailable" })];
        const kind = GOOGLE_PROVIDER_KIND[provider]!;
        const noun = provider === "google_analytics" ? "GA4 property" : provider === "google_merchant" ? "Merchant account" : "Business location";
        const googleConnect = this.googleConnect;
        return [await this.step("google_list", { code: "doctorLabelGoogleList", params: { noun } }, async (): Promise<DoctorText> => {
          const r = await googleConnect.doctorList(kind, { id: integration.id, organizationId: integration.organizationId });
          return r.names.length
            ? { code: "doctorOkGoogleListNamed", params: { count: r.count, noun, names: r.names.join(", ") } }
            : { code: "doctorOkGoogleList", params: { count: r.count, noun } };
        })];
      }
      case "linkedin_social": {
        // CC20: the stored LinkedIn token lists the Pages it
        // administrates — the count IS the real signal (zero is
        // a reportable result, not a failure).
        if (!creds?.accessToken) return [missingCreds];
        return [await this.step("organizations", { code: "doctorLabelLinkedinPages" }, async () => {
          const orgs = await this.probes.linkedinOrgs(creds.accessToken);
          if (!orgs.length) return { code: "doctorOkLinkedinNone" };
          return { code: "doctorOkLinkedinPages", params: { count: orgs.length, names: orgs.slice(0, 3).map((o) => o.name).join(", ") } };
        })];
      }
      case "telegram": {
        if (!creds?.botToken) return [missingCreds];
        return [await this.step("bot", { code: "doctorLabelTelegramBot" }, async () => {
          const me = await this.probes.telegramGetMe(creds.botToken);
          return { code: "doctorOkTelegramBot", params: { name: me.username ? `@${me.username}` : me.first_name ?? me.id } };
        })];
      }
      case "email": {
        if (!creds?.imapHost) return [missingCreds];
        return [
          await this.step("imap", { code: "doctorLabelImapLogin" }, async () => { await this.probes.emailImapLogin(creds); return { code: "doctorOkImapLogin", params: { user: creds.user } }; }),
          await this.step("smtp", { code: "doctorLabelSmtpVerify" }, async () => { await this.probes.emailSmtpVerify(creds); return { code: "doctorOkSmtpPlain" }; }),
        ];
      }
      case "woocommerce": {
        if (!creds?.consumerKey) return [missingCreds];
        const storeUrl = integration.store?.url;
        if (!storeUrl) return [this.fixedStep("store", { code: "doctorLabelStore" }, "fail", { code: "doctorFailStoreUrlMissing" })];
        return [await this.step("store", { code: "doctorLabelWooStore" }, async (): Promise<DoctorText> => {
          const info = await this.probes.wooTest(storeUrl, { consumerKey: creds.consumerKey, consumerSecret: creds.consumerSecret });
          if (info.storeName && info.version) return { code: "doctorOkWooStore", params: { name: info.storeName, version: info.version } };
          if (info.storeName) return { code: "doctorOkWooStoreName", params: { name: info.storeName } };
          if (info.version) return { code: "doctorOkWooStoreVersion", params: { version: info.version } };
          return { code: "doctorOkWooStorePlain" };
        })];
      }
      case "shopify": {
        if (!creds) return [missingCreds];
        const storeUrl = integration.store?.url;
        if (!storeUrl) return [this.fixedStep("store", { code: "doctorLabelStore" }, "fail", { code: "doctorFailStoreUrlMissing" })];
        return [await this.step("shop", { code: "doctorLabelShopifyShop" }, async () => {
          let secrets = creds;
          // Client-credentials integrations mint short-lived
          // tokens; the EC2 refresh path (ShopifyService) is the
          // existing machinery for resolving usable secrets.
          if (this.shopify) {
            secrets = await this.shopify.refreshTokenIfNeeded({ ...integration, credential: { encryptedData: (await (this.prisma as any).integrationCredential.findUnique({ where: { integrationId: integration.id } }))?.encryptedData }, store: integration.store });
          }
          if (!secrets?.accessToken) throw badRequest("connections.doctorShopifyTokenMissing");
          const shop = await this.probes.shopifyTest(storeUrl, { accessToken: secrets.accessToken, apiSecret: secrets.apiSecret });
          return { code: "doctorOkShopifyShop", params: { name: shop.name, domain: shop.domain } };
        })];
      }
      case "steadfast": {
        if (!creds?.apiKey) return [missingCreds];
        return [await this.step("balance", { code: "doctorLabelSteadfastBalance" }, async (): Promise<DoctorText> => {
          const bal = await this.probes.steadfastBalance({ apiKey: creds.apiKey, secretKey: creds.secretKey });
          return bal?.current_balance !== undefined
            ? { code: "doctorOkSteadfastBalance", params: { balance: bal.current_balance } }
            : { code: "doctorOkSteadfastPlain" };
        })];
      }
      case "pathao": {
        if (!creds?.clientId) return [missingCreds];
        return [await this.step("stores", { code: "doctorLabelPathaoStores" }, async () => {
          const { stores } = await this.probes.pathaoVerify(creds);
          return { code: "doctorOkPathaoStores", params: { count: stores } };
        })];
      }
      case "redx": {
        if (!creds?.accessToken) return [missingCreds];
        return [await this.step("areas", { code: "doctorLabelRedxAreas" }, async () => {
          const { areas } = await this.probes.redxVerify(creds);
          return { code: "doctorOkRedxAreas", params: { count: areas } };
        })];
      }
      case "google_ads":
      case "tiktok":
        return [this.notCheckable("token", { code: "doctorLabelTokenCheck" }, { code: "doctorNcTokenNotChecked" })];
      case "webchat":
        return [this.notCheckable("provider", { code: "doctorLabelWebchat" }, { code: "doctorNcWebchat" })];
      default:
        return [this.notCheckable("provider", { code: "doctorLabelProviderCheck" }, { code: "doctorNcProviderUnknown", params: { provider } })];
    }
  }

  private async checkAdAccount(organizationId: string, accountId: string): Promise<DoctorStep[]> {
    const account = await (this.prisma as any).adAccount.findFirst({
      where: { id: accountId, organizationId },
    }).catch(() => null);
    if (!account) return [this.notCheckable("target", { code: "doctorLabelAdAccount" }, { code: "doctorNcAdAccountMissing" })];
    if (account.sourceType !== "api" || !account.integrationId || !account.externalId) {
      return [this.notCheckable("platform_status", { code: "doctorLabelPlatformStatus" }, { code: "doctorNcAdAccountNoApi" })];
    }
    if (account.platform !== "meta") {
      return [this.notCheckable("platform_status", { code: "doctorLabelPlatformStatus" }, { code: "doctorNcAdAccountPlatform" })];
    }
    return [await this.step("account", { code: "doctorLabelMetaAdAccount" }, async (): Promise<DoctorText> => {
      const { metaTokenForAccount } = await import("../common/meta-graph");
      const { token } = await metaTokenForAccount(this.prisma as any, organizationId, account.id);
      const info = await this.probes.graphGet(token, `/act_${account.externalId}?fields=name,account_status,currency`);
      const name = info?.name ?? account.externalId;
      return info?.account_status != null
        ? { code: "doctorOkAdAccount", params: { name, status: info.account_status } }
        : { code: "doctorOkAdAccountUnknown", params: { name } };
    })];
  }

  private async checkSenderConfig(organizationId: string, targetId: string): Promise<DoctorStep[]> {
    const [rowId, kind] = targetId.split(":");
    const row = await (this.prisma as any).messagingSenderConfig.findUnique({
      where: { organizationId },
    }).catch(() => null);
    if (!row || row.id !== rowId) return [this.notCheckable("target", { code: "doctorLabelSenderConfig" }, { code: "doctorNcSenderConfigMissing" })];
    if (kind === "sms") {
      return [this.notCheckable("sms", { code: "doctorLabelSmsGateway" }, { code: "doctorNcSmsNoPreverify" })];
    }
    const cfg = tenantSmtpFromRow(row);
    if (!cfg) return [this.fixedStep("smtp", { code: "doctorLabelSmtpHandshake" }, "fail", { code: "doctorFailSmtpConfig" })];
    return [await this.step("smtp", { code: "doctorLabelSmtpHandshake" }, async () => {
      await this.probes.smtpVerify(cfg);
      return { code: "doctorOkSmtpHandshake", params: { host: cfg.host, port: cfg.port } };
    })];
  }

  private async checkLlmConfig(organizationId: string, configId: string): Promise<DoctorStep[]> {
    const row = await (this.prisma as any).orgLlmConfig.findFirst({
      where: { id: configId, organizationId },
    }).catch(() => null);
    if (!row) return [this.notCheckable("target", { code: "doctorLabelLlmConfig" }, { code: "doctorNcLlmConfigMissing" })];
    let apiKey: string | undefined;
    try { apiKey = decryptJson<any>(row.encryptedData)?.apiKey; } catch { apiKey = undefined; }
    if (!apiKey) return [this.fixedStep("key", { code: "doctorLabelLlmKey" }, "fail", { code: "doctorFailLlmKey" })];
    return [await this.step("completion", { code: "doctorLabelLlmVerify" }, async () => {
      const { model } = await this.probes.llmVerify(String(row.provider), apiKey!, row.model ?? undefined);
      return { code: "doctorOkLlmVerify", params: { model } };
    })];
  }

  private async checkPaymentGateway(organizationId: string, gatewayId: string): Promise<DoctorStep[]> {
    const row = await (this.prisma as any).tenantPaymentGateway.findFirst({
      where: { id: gatewayId, organizationId },
    }).catch(() => null);
    if (!row) return [this.notCheckable("target", { code: "doctorLabelPaymentGateway" }, { code: "doctorNcGatewayMissing" })];
    const provider = String(row.provider);
    if (provider === "bkash") {
      let creds: TenantBkashCreds | null = null;
      try { creds = decryptJson<TenantBkashCreds>(row.encryptedData); } catch { creds = null; }
      if (!creds?.appKey) return [this.fixedStep("credential", { code: "doctorLabelCredential" }, "fail", { code: "doctorFailBkashCredential" })];
      return [await this.step("grant", { code: "doctorLabelBkashGrant" }, async () => {
        await this.probes.bkashGrant(creds!);
        return { code: "doctorOkBkashGrant" };
      })];
    }
    if (provider === "sslcommerz") {
      return [this.notCheckable("gateway", { code: "doctorLabelSslcommerzCheck" }, { code: "doctorNcSslcommerz", params: { status: row.status } })];
    }
    return [this.notCheckable("gateway", { code: "doctorLabelGatewayCheck" }, { code: "doctorNcGatewayNotWired", params: { provider, status: row.status } })];
  }
}
