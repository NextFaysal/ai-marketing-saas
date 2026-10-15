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
  status: "pass" | "fail" | "not_checkable";
  message: string;
}

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
    if (!target) throw new NotFoundException("Connection target not found");
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

  private async step(key: string, label: string, run: () => Promise<string>): Promise<DoctorStep> {
    try {
      const message = await run();
      return { key, label, status: "pass", message };
    } catch (e) {
      return { key, label, status: "fail", message: e instanceof Error ? e.message : String(e) };
    }
  }

  private notCheckable(key: string, label: string, message: string): DoctorStep {
    return { key, label, status: "not_checkable", message };
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
        if (!integration) return { steps: [this.notCheckable("target", "লক্ষ্য", "Integration রেকর্ডটি পাওয়া যায়নি।")] };
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
          return { steps: [this.notCheckable("credential", "Credential যাচাই", "এই সোশ্যাল অ্যাকাউন্টের কোনো Integration credential পাওয়া যায়নি — সরাসরি যাচাইয়ের পথ নেই।")] };
        }
        return { steps: await this.checkIntegration(integration), integrationId: integration.id };
      }
      case "store": {
        const integration = await (this.prisma as any).integration.findFirst({
          where: { organizationId, storeId: target.targetId },
        }).catch(() => null);
        if (!integration) {
          return { steps: [this.notCheckable("integration", "স্টোর সংযোগ", "এই স্টোরের কোনো Integration রেকর্ড নেই — যাচাইয়ের জন্য কোনো credential নেই।")] };
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
        return { steps: [this.notCheckable("platform_gateway", "প্ল্যাটফর্ম গেটওয়ে", "প্ল্যাটফর্মের credential শুধু platform admin config-এ থাকে — tenant পাশ থেকে সরাসরি যাচাইয়ের কোনো পথ নেই।")] };
      case "business_profile":
        return { steps: [this.notCheckable("manual_payment", "ম্যানুয়াল পেমেন্ট তথ্য", "ম্যানুয়াল নম্বর/তথ্যের কোনো provider যাচাই হয় না — এটি যাচাইয়ের বিষয় নয়।")] };
      default:
        return { steps: [this.notCheckable("target", "লক্ষ্য", `এই ধরনের কানেকশনের (${target.targetType}) জন্য Doctor-এ কোনো যাচাই সংজ্ঞায়িত নেই।`)] };
    }
  }

  private async checkIntegration(integration: any): Promise<DoctorStep[]> {
    const provider = String(integration.provider ?? "");
    if (String(integration.status) === "DISCONNECTED") {
      return [this.notCheckable("connection", "কানেকশনের অবস্থা", "কানেকশনটি DISCONNECTED অবস্থায় আছে — আবার কানেক্ট করার পর পরীক্ষা করা যাবে।")];
    }
    const creds = await this.credentialFor(integration.id);
    const missingCreds: DoctorStep = { key: "credential", label: "Credential", status: "fail", message: "সংরক্ষিত credential পাওয়া যায়নি — কানেকশনটি আবার করুন।" };

    switch (provider) {
      case "whatsapp": {
        if (!creds?.accessToken) return [missingCreds];
        const steps: DoctorStep[] = [
          await this.step("token", "Meta টোকেন", async () => {
            const me = await this.probes.metaVerifyToken(creds);
            return `Meta টোকেন নিশ্চিত করেছে (${me.name ?? me.id})`;
          }),
        ];
        if (creds.phoneNumberId) {
          steps.push(await this.step("phone_number", "WhatsApp নম্বর", async () => {
            const info = await this.probes.graphGet(creds.accessToken, `/${creds.phoneNumberId}?fields=display_phone_number,verified_name`);
            return `নম্বর নিশ্চিত: ${info?.display_phone_number ?? creds.phoneNumberId}${info?.verified_name ? ` (${info.verified_name})` : ""}`;
          }));
        } else {
          steps.push(this.notCheckable("phone_number", "WhatsApp নম্বর", "এই কানেকশনে phoneNumberId সংরক্ষিত নেই — নম্বর-ভিত্তিক যাচাই সম্ভব নয়।"));
        }
        return steps;
      }
      case "messenger":
      case "instagram": {
        if (!creds?.accessToken) return [missingCreds];
        const steps: DoctorStep[] = [
          await this.step("token", "Meta টোকেন", async () => {
            const me = await this.probes.metaVerifyToken(creds);
            return `Meta টোকেন নিশ্চিত করেছে (${me.name ?? me.id})`;
          }),
        ];
        if (creds.pageId) {
          steps.push(await this.step("page", "Facebook Page", async () => {
            const page = await this.probes.graphGet(creds.accessToken, `/${creds.pageId}?fields=name`);
            return `Page নিশ্চিত: ${page?.name ?? creds.pageId}`;
          }));
        } else {
          steps.push(this.notCheckable("page", "Facebook Page", "এই কানেকশনে Page ID সংরক্ষিত নেই — Page-ভিত্তিক যাচাই সম্ভব নয়।"));
        }
        return steps;
      }
      case "meta": {
        if (!creds?.accessToken) return [missingCreds];
        return [await this.step("token", "Meta টোকেন", async () => {
          const me = await this.probes.graphGet(creds.accessToken, "/me?fields=id,name");
          return `Meta টোকেন নিশ্চিত করেছে (${me?.name ?? me?.id})`;
        })];
      }
      case "meta_social": {
        if (!creds?.accessToken) return [missingCreds];
        const pageId = creds.pageId ?? integration.externalAccountId;
        return [await this.step("page", "Facebook Page", async () => {
          const page = await this.probes.graphGet(creds.accessToken, `/${pageId}?fields=name`);
          return `Page নিশ্চিত: ${page?.name ?? pageId}`;
        })];
      }
      case "tiktok_social": {
        if (!creds?.accessToken) return [missingCreds];
        return [await this.step("user", "TikTok অ্যাকাউন্ট", async () => {
          const user = await this.probes.tiktokUserInfo(creds.accessToken);
          return `TikTok অ্যাকাউন্ট নিশ্চিত: ${user.displayName}`;
        })];
      }
      case "youtube_social": {
        if (!creds?.accessToken) return [missingCreds];
        return [await this.step("channel", "YouTube চ্যানেল", async () => {
          const channels = await this.probes.youtubeChannels(creds.accessToken);
          if (!channels.length) throw new Error("YouTube কোনো চ্যানেল ফেরত দেয়নি এই টোকেনের জন্য");
          return `চ্যানেল নিশ্চিত: ${channels[0].title}`;
        })];
      }
      case "google_analytics":
      case "google_merchant":
      case "google_business": {
        // CC20: the real check is one authenticated list call
        // with a freshly-refreshed token — GoogleConnectService
        // owns the Google token lifecycle, the Doctor borrows it.
        if (!creds?.accessToken) return [missingCreds];
        if (!this.googleConnect) return [this.notCheckable("google", "Google যাচাই", "Google যাচাই সার্ভিস এই পরিবেশে পাওয়া যাচ্ছে না।")];
        const kind = GOOGLE_PROVIDER_KIND[provider]!;
        const noun = provider === "google_analytics" ? "GA4 property" : provider === "google_merchant" ? "Merchant account" : "Business location";
        const googleConnect = this.googleConnect;
        return [await this.step("google_list", `Google ${noun} তালিকা`, async () => {
          const r = await googleConnect.doctorList(kind, { id: integration.id, organizationId: integration.organizationId });
          return `Google token কাজ করছে — এই অ্যাকাউন্টে ${r.count}টি ${noun} দেখা যাচ্ছে${r.names.length ? ` (যেমন: ${r.names.join(", ")})` : ""}।`;
        })];
      }
      case "linkedin_social": {
        // CC20: the stored LinkedIn token lists the Pages it
        // administrates — the count IS the real signal (zero is
        // a reportable result, not a failure).
        if (!creds?.accessToken) return [missingCreds];
        return [await this.step("organizations", "LinkedIn Page তালিকা", async () => {
          const orgs = await this.probes.linkedinOrgs(creds.accessToken);
          if (!orgs.length) return "LinkedIn token কাজ করছে, কিন্তু এই অ্যাকাউন্ট কোনো Page-এর admin নয় — ০টি Page পাওয়া গেছে।";
          return `LinkedIn token কাজ করছে — ${orgs.length}টি Page-এর admin (যেমন: ${orgs.slice(0, 3).map((o) => o.name).join(", ")})।`;
        })];
      }
      case "telegram": {
        if (!creds?.botToken) return [missingCreds];
        return [await this.step("bot", "Telegram Bot", async () => {
          const me = await this.probes.telegramGetMe(creds.botToken);
          return `Bot নিশ্চিত: ${me.username ? `@${me.username}` : me.first_name ?? me.id}`;
        })];
      }
      case "email": {
        if (!creds?.imapHost) return [missingCreds];
        return [
          await this.step("imap", "IMAP লগইন", async () => { await this.probes.emailImapLogin(creds); return `IMAP লগইন সফল (${creds.user})`; }),
          await this.step("smtp", "SMTP যাচাই", async () => { await this.probes.emailSmtpVerify(creds); return "SMTP সার্ভার হ্যান্ডশেক সফল"; }),
        ];
      }
      case "woocommerce": {
        if (!creds?.consumerKey) return [missingCreds];
        const storeUrl = integration.store?.url;
        if (!storeUrl) return [{ key: "store", label: "স্টোর", status: "fail", message: "স্টোরের URL পাওয়া যায়নি।" }];
        return [await this.step("store", "WooCommerce স্টোর", async () => {
          const info = await this.probes.wooTest(storeUrl, { consumerKey: creds.consumerKey, consumerSecret: creds.consumerSecret });
          return `স্টোর সাড়া দিয়েছে${info.storeName ? `: ${info.storeName}` : ""}${info.version ? ` (WooCommerce ${info.version})` : ""}`;
        })];
      }
      case "shopify": {
        if (!creds) return [missingCreds];
        const storeUrl = integration.store?.url;
        if (!storeUrl) return [{ key: "store", label: "স্টোর", status: "fail", message: "স্টোরের URL পাওয়া যায়নি।" }];
        return [await this.step("shop", "Shopify শপ", async () => {
          let secrets = creds;
          // Client-credentials integrations mint short-lived
          // tokens; the EC2 refresh path (ShopifyService) is the
          // existing machinery for resolving usable secrets.
          if (this.shopify) {
            secrets = await this.shopify.refreshTokenIfNeeded({ ...integration, credential: { encryptedData: (await (this.prisma as any).integrationCredential.findUnique({ where: { integrationId: integration.id } }))?.encryptedData }, store: integration.store });
          }
          if (!secrets?.accessToken) throw new Error("Shopify access token সংরক্ষিত নেই (client-credentials token sync-এর সময় তৈরি হয়)");
          const shop = await this.probes.shopifyTest(storeUrl, { accessToken: secrets.accessToken, apiSecret: secrets.apiSecret });
          return `শপ নিশ্চিত: ${shop.name} (${shop.domain})`;
        })];
      }
      case "steadfast": {
        if (!creds?.apiKey) return [missingCreds];
        return [await this.step("balance", "Steadfast ব্যালেন্স", async () => {
          const bal = await this.probes.steadfastBalance({ apiKey: creds.apiKey, secretKey: creds.secretKey });
          return `Steadfast সাড়া দিয়েছে${bal?.current_balance !== undefined ? ` — বর্তমান ব্যালেন্স: ${bal.current_balance}` : ""}`;
        })];
      }
      case "pathao": {
        if (!creds?.clientId) return [missingCreds];
        return [await this.step("stores", "Pathao স্টোর", async () => {
          const { stores } = await this.probes.pathaoVerify(creds);
          return `Pathao টোকেন ও স্টোর সফল — ${stores}টি স্টোর পাওয়া গেছে`;
        })];
      }
      case "redx": {
        if (!creds?.accessToken) return [missingCreds];
        return [await this.step("areas", "RedX এলাকা", async () => {
          const { areas } = await this.probes.redxVerify(creds);
          return `RedX সাড়া দিয়েছে — ${areas}টি এলাকা পাওয়া গেছে`;
        })];
      }
      case "google_ads":
      case "tiktok":
        return [this.notCheckable("token", "টোকেন যাচাই", "এই প্রোভাইডারের Integration-স্তরের টোকেন Doctor সরাসরি যাচাই করে না — Ad Account-এর প্ল্যাটফর্ম স্ট্যাটাস রিফ্রেশই এর আসল যাচাই পথ।")];
      case "webchat":
        return [this.notCheckable("provider", "ওয়েবচ্যাট", "ওয়েবচ্যাটের কোনো বাইরের প্রোভাইডার নেই — যাচাইয়ের কিছু নেই।")];
      default:
        return [this.notCheckable("provider", "প্রোভাইডার যাচাই", `এই প্রোভাইডারের (${provider}) জন্য Doctor-এ কোনো যাচাই সংজ্ঞায়িত নেই।`)];
    }
  }

  private async checkAdAccount(organizationId: string, accountId: string): Promise<DoctorStep[]> {
    const account = await (this.prisma as any).adAccount.findFirst({
      where: { id: accountId, organizationId },
    }).catch(() => null);
    if (!account) return [this.notCheckable("target", "Ad Account", "Ad Account রেকর্ডটি পাওয়া যায়নি।")];
    if (account.sourceType !== "api" || !account.integrationId || !account.externalId) {
      return [this.notCheckable("platform_status", "প্ল্যাটফর্ম স্ট্যাটাস", "এই Ad Account-এর কোনো API সংযোগ নেই (CSV/Manual) — প্ল্যাটফর্ম যাচাইয়ের পথ নেই।")];
    }
    if (account.platform !== "meta") {
      return [this.notCheckable("platform_status", "প্ল্যাটফর্ম স্ট্যাটাস", "Doctor এই প্ল্যাটফর্মের Ad Account সরাসরি যাচাই করে না — Ad Accounts পেজের স্ট্যাটাস রিফ্রেশই এর আসল যাচাই পথ।")];
    }
    return [await this.step("account", "Meta Ad Account", async () => {
      const { metaTokenForAccount } = await import("../common/meta-graph");
      const { token } = await metaTokenForAccount(this.prisma as any, organizationId, account.id);
      const info = await this.probes.graphGet(token, `/act_${account.externalId}?fields=name,account_status,currency`);
      return `Ad Account নিশ্চিত: ${info?.name ?? account.externalId} (account_status: ${info?.account_status ?? "অজানা"})`;
    })];
  }

  private async checkSenderConfig(organizationId: string, targetId: string): Promise<DoctorStep[]> {
    const [rowId, kind] = targetId.split(":");
    const row = await (this.prisma as any).messagingSenderConfig.findUnique({
      where: { organizationId },
    }).catch(() => null);
    if (!row || row.id !== rowId) return [this.notCheckable("target", "প্রেরক কনফিগ", "MessagingSenderConfig রেকর্ডটি পাওয়া যায়নি।")];
    if (kind === "sms") {
      return [this.notCheckable("sms", "SMS গেটওয়ে", "SMS গেটওয়ের কোনো প্রাক-যাচাই (pre-verification) পথ নেই (MS4) — প্রথম আসল পাঠানোই এর যাচাই।")];
    }
    const cfg = tenantSmtpFromRow(row);
    if (!cfg) return [{ key: "smtp", label: "SMTP হ্যান্ডশেক", status: "fail", message: "SMTP কনফিগ অসম্পূর্ণ বা পাসওয়ার্ড পড়া যায়নি — Messaging সেটিংসে আবার সেভ করুন।" }];
    return [await this.step("smtp", "SMTP হ্যান্ডশেক", async () => {
      await this.probes.smtpVerify(cfg);
      return `SMTP হ্যান্ডশেক সফল (${cfg.host}:${cfg.port})`;
    })];
  }

  private async checkLlmConfig(organizationId: string, configId: string): Promise<DoctorStep[]> {
    const row = await (this.prisma as any).orgLlmConfig.findFirst({
      where: { id: configId, organizationId },
    }).catch(() => null);
    if (!row) return [this.notCheckable("target", "LLM কনফিগ", "OrgLlmConfig রেকর্ডটি পাওয়া যায়নি।")];
    let apiKey: string | undefined;
    try { apiKey = decryptJson<any>(row.encryptedData)?.apiKey; } catch { apiKey = undefined; }
    if (!apiKey) return [{ key: "key", label: "LLM Key", status: "fail", message: "সংরক্ষিত API key পড়া যায়নি — keyটি আবার সেভ করুন।" }];
    return [await this.step("completion", "LLM যাচাই (আসল completion)", async () => {
      const { model } = await this.probes.llmVerify(String(row.provider), apiKey!, row.model ?? undefined);
      return `Provider সাড়া দিয়েছে (মডেল: ${model})`;
    })];
  }

  private async checkPaymentGateway(organizationId: string, gatewayId: string): Promise<DoctorStep[]> {
    const row = await (this.prisma as any).tenantPaymentGateway.findFirst({
      where: { id: gatewayId, organizationId },
    }).catch(() => null);
    if (!row) return [this.notCheckable("target", "পেমেন্ট গেটওয়ে", "TenantPaymentGateway রেকর্ডটি পাওয়া যায়নি।")];
    const provider = String(row.provider);
    if (provider === "bkash") {
      let creds: TenantBkashCreds | null = null;
      try { creds = decryptJson<TenantBkashCreds>(row.encryptedData); } catch { creds = null; }
      if (!creds?.appKey) return [{ key: "credential", label: "Credential", status: "fail", message: "সংরক্ষিত bKash credential পড়া যায়নি — গেটওয়েটি আবার সেভ করুন।" }];
      return [await this.step("grant", "bKash টোকেন যাচাই", async () => {
        await this.probes.bkashGrant(creds!);
        return "bKash grant-token সফল — credential সঠিক";
      })];
    }
    if (provider === "sslcommerz") {
      return [this.notCheckable("gateway", "SSLCommerz যাচাই", `SSLCommerz-এর কোনো pre-transaction credential check নেই (CC9) — কনফিগের অবস্থা: ${row.status}। প্রথম আসল লেনদেনের IPN যাচাইই এর প্রমাণ।`)];
    }
    return [this.notCheckable("gateway", "গেটওয়ে যাচাই", `এই গেটওয়ের (${provider}) কোনো credential-check এই codebase-এ wired নেই — কনফিগের অবস্থা: ${row.status}।`)];
  }
}
