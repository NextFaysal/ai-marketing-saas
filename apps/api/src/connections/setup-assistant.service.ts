/**
 * CC20 — Smart Setup Assistant.
 *
 * A findings panel computed from REAL ROWS ONLY, on every read.
 * Every rule below names the exact records it reads; a rule
 * fires only when its evidence check passes, and the finding
 * carries the real counts/ids as its evidence text. Nothing is
 * inferred, predicted or recommended from behaviour — this is
 * the CX12a setup-guide spirit (real-row state) applied to the
 * Connect Center's own tables, reusing the CC1 overview as the
 * connection source instead of re-deriving connection state.
 *
 * Rules deliberately NOT implemented (documented, auditable):
 * - "Ad account present but no Page linked for ads": AdAccount
 *   has NO Page-linkage field anywhere in the schema (checked:
 *   no pageId / linkedPage column, no relation) — there is no
 *   real record to check, so the rule cannot fire honestly and
 *   is omitted rather than approximated.
 *
 * Dismissals are the only persisted state: one row per
 * (org, user, findingKey) — see SetupFindingDismissal. A
 * dismissal suppresses a finding that STILL fires; when the
 * underlying facts change the finding stops firing on its own.
 */

import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ConnectionsService } from "./connections.service";
import { WalletService } from "./wallet.service";

export type FindingSeverity = "blocker" | "improvement" | "info";

export interface SetupFinding {
  key: string;
  severity: FindingSeverity;
  title: string;
  /** The named feature this gap blocks or weakens. */
  feature: string;
  /** Evidence text built from the real counts/ids checked. */
  evidence: string;
  actionLabel: string;
  href: string;
}

const COURIER_PROVIDERS = ["steadfast", "pathao", "redx"];
const STORE_PROVIDERS = ["woocommerce", "shopify"];

/** The rule keys a dismissal may target (per-id findings carry
 * a ":<id>" suffix under one of these bases). */
export const ASSISTANT_FINDING_KEYS = [
  "whatsapp_no_approved_template",
  "meta_page_without_messaging",
  "messaging_page_without_social",
  "store_without_courier",
  "store_without_payment_path",
  "platform_gateway_not_configured",
  "bkash_gateway_unverified",
  "courier_never_used",
  "llm_platform_fallback",
] as const;

const SEVERITY_ORDER: Record<FindingSeverity, number> = { blocker: 0, improvement: 1, info: 2 };

@Injectable()
export class SetupAssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ConnectionsService,
    @Optional() private readonly wallet?: WalletService,
  ) {}

  /** Defensive read in the overview's own spirit: a table that
   * is missing pre-migration degrades to no rows, never a 500. */
  private async safeFindMany(table: string, args: any): Promise<any[]> {
    try {
      const rows = await (this.prisma as any)[table]?.findMany?.(args);
      return Array.isArray(rows) ? rows : [];
    } catch { return []; }
  }

  private async safeCount(table: string, args: any): Promise<number> {
    try {
      const n = await (this.prisma as any)[table]?.count?.(args);
      return typeof n === "number" ? n : 0;
    } catch { return 0; }
  }

  private async safeFindUnique(table: string, args: any): Promise<any> {
    try {
      return await (this.prisma as any)[table]?.findUnique?.(args);
    } catch { return null; }
  }

  async getFindings(organizationId: string, userId: string): Promise<{ findings: SetupFinding[] }> {
    const overview: any = await this.connections.getOverview(organizationId);
    const accounts: any[] = (overview?.categories ?? []).flatMap((c: any) => c.accounts ?? []);
    const connected = (a: any) => ["CONNECTED", "connected", "ACTIVE", "active"].includes(String(a?.status ?? ""));
    const findings: SetupFinding[] = [];

    // ---- shared real-row facts ----
    const whatsappAccounts = accounts.filter((a) => a.source === "integration" && a.provider === "whatsapp" && connected(a));
    const storeConnected = accounts.some((a) =>
      (a.source === "store" && String(a.status) === "ACTIVE") ||
      (a.source === "integration" && STORE_PROVIDERS.includes(String(a.provider)) && connected(a)));
    const courierAccounts = accounts.filter((a) => a.source === "integration" && COURIER_PROVIDERS.includes(String(a.provider)) && connected(a));

    const [gateways, enablements, businessProfile, orgLlm] = await Promise.all([
      this.safeFindMany("tenantPaymentGateway", { where: { organizationId } }),
      this.safeFindMany("platformPaymentEnablement", { where: { organizationId } }),
      this.safeFindUnique("businessProfile", { where: { organizationId } }),
      this.safeFindUnique("orgLlmConfig", { where: { organizationId } }),
    ]);

    // ---- Rule 1: WhatsApp connected, zero APPROVED templates ----
    if (whatsappAccounts.length > 0) {
      const [approved, total] = await Promise.all([
        this.safeCount("whatsAppTemplate", { where: { organizationId, status: "APPROVED" } }),
        this.safeCount("whatsAppTemplate", { where: { organizationId } }),
      ]);
      if (approved === 0) {
        findings.push({
          key: "whatsapp_no_approved_template",
          severity: "blocker",
          title: "WhatsApp কানেক্ট আছে, কিন্তু কোনো অনুমোদিত টেমপ্লেট নেই",
          feature: "WhatsApp টেমপ্লেট ব্রডকাস্ট ও utility মেসেজ পাঠানো",
          evidence: `WhatsApp কানেকশন সক্রিয় (${whatsappAccounts.length}টি), কিন্তু APPROVED স্ট্যাটাসের টেমপ্লেট ০টি (মোট টেমপ্লেট রেকর্ড: ${total}টি)। Meta-অনুমোদিত টেমপ্লেট ছাড়া ব্রডকাস্ট/utility মেসেজ পাঠানো যায় না।`,
          actionLabel: "টেমপ্লেট তৈরি/সিঙ্ক করুন",
          href: "/dashboard/messaging",
        });
      }
    }

    // ---- Rule 2: Meta Page social ↔ messaging mismatch (real external ids) ----
    const socialPages = accounts.filter((a) => a.source === "social_account" && a.provider === "meta_page" && connected(a) && a.externalAccountId);
    const messagingPageIds = new Set<string>(
      accounts
        .filter((a) => a.source === "integration" && (a.provider === "messenger" || a.provider === "meta_social") && connected(a) && a.externalAccountId)
        .map((a) => String(a.externalAccountId)),
    );
    const socialPageIds = new Set<string>(socialPages.map((a) => String(a.externalAccountId)));
    for (const page of socialPages) {
      const pageId = String(page.externalAccountId);
      if (!messagingPageIds.has(pageId)) {
        findings.push({
          key: `meta_page_without_messaging:${pageId}`,
          severity: "blocker",
          title: "Page সোশ্যালে আছে, মেসেজিং চ্যানেল নেই",
          feature: "ইনবক্সে এই Page-এর Messenger মেসেজ পাওয়া ও উত্তর দেওয়া",
          evidence: `“${page.displayName}” (Page ID: ${pageId}) সোশ্যাল অ্যাকাউন্ট হিসেবে কানেক্ট আছে, কিন্তু একই Page ID-র কোনো Messenger চ্যানেল কানেকশন নেই — মেসেজ ইনবক্সে আসবে না।`,
          actionLabel: "Messenger চ্যানেল কানেক্ট করুন",
          href: "/dashboard/connections#cat-messaging",
        });
      }
    }
    const messagingOnly = accounts.filter((a) =>
      a.source === "integration" && a.provider === "messenger" && connected(a) && a.externalAccountId && !socialPageIds.has(String(a.externalAccountId)));
    for (const ch of messagingOnly) {
      const pageId = String(ch.externalAccountId);
      findings.push({
        key: `messaging_page_without_social:${pageId}`,
        severity: "improvement",
        title: "Messenger চ্যানেল আছে, সোশ্যাল Page নেই",
        feature: "একই Page-এ সোশ্যাল পোস্ট প্রকাশ",
        evidence: `Page ID ${pageId}-এর Messenger চ্যানেল কানেক্ট আছে, কিন্তু একই Page ID-র কোনো সোশ্যাল অ্যাকাউন্ট নেই — এই Page-এ পোস্ট প্রকাশ করা যাবে না।`,
        actionLabel: "সোশ্যাল Page কানেক্ট করুন",
        href: "/dashboard/connections#cat-social",
      });
    }

    // ---- Rules 3 + 4: store connected — courier / payment path ----
    if (storeConnected && courierAccounts.length === 0) {
      findings.push({
        key: "store_without_courier",
        severity: "blocker",
        title: "স্টোর কানেক্ট আছে, কোনো কুরিয়ার নেই",
        feature: "অর্ডারের কুরিয়ার বুকিং ও ডেলিভারি",
        evidence: "WooCommerce/Shopify স্টোর সক্রিয়, কিন্তু Steadfast/Pathao/RedX — কোনো কুরিয়ার কানেকশন সক্রিয় নেই (০টি)। কুরিয়ার ছাড়া অর্ডার পাঠানো যাবে না।",
        actionLabel: "কুরিয়ার কানেক্ট করুন",
        href: "/dashboard/connections#cat-courier",
      });
    }
    if (storeConnected) {
      const ownLiveGateway = gateways.some((g) => g.isEnabled !== false && String(g.environment ?? "live") === "live");
      const platformEnabled = enablements.some((e) => e.isEnabled === true);
      const manualMethods = businessProfile
        ? [businessProfile.bkashNumber ? "বিকাশ নম্বর" : null, businessProfile.nagadNumber ? "নগদ নম্বর" : null, businessProfile.codAvailable ? "COD" : null].filter(Boolean)
        : [];
      if (!ownLiveGateway && !platformEnabled && manualMethods.length === 0) {
        findings.push({
          key: "store_without_payment_path",
          severity: "blocker",
          title: "স্টোর আছে, কোনো পেমেন্ট পথ নেই",
          feature: "ক্রেতার কাছ থেকে অনলাইন/ম্যানুয়াল পেমেন্ট গ্রহণ",
          evidence: "স্টোর সক্রিয়, কিন্তু যাচাই করা হয়েছে: নিজের live গেটওয়ে ০টি, প্ল্যাটফর্ম গেটওয়ে চালু ০টি, Business Profile-এ ম্যানুয়াল পেমেন্ট তথ্যও নেই — কোনোভাবেই পেমেন্ট নেওয়ার পথ খোলা নেই।",
          actionLabel: "পেমেন্ট পদ্ধতি যোগ করুন",
          href: "/dashboard/connections#cat-payment",
        });
      }
    }

    // ---- Rule 5: platform gateway enabled by tenant, not
    // configured by the PLATFORM (CC10's offer check) ----
    if (this.wallet) {
      const offered = new Map(this.wallet.platformProviders().map((p) => [p.provider, p.offered]));
      for (const en of enablements) {
        if (en.isEnabled !== true) continue;
        const provider = String(en.provider);
        if (offered.get(provider) !== true) {
          findings.push({
            key: `platform_gateway_not_configured:${provider}`,
            severity: "blocker",
            title: "প্ল্যাটফর্ম গেটওয়ে চালু, কিন্তু প্ল্যাটফর্মই configure করেনি",
            feature: `${provider === "bkash" ? "বিকাশ" : "SSLCommerz"} দিয়ে প্ল্যাটফর্ম গেটওয়ে পেমেন্ট`,
            evidence: `আপনি ${provider} প্ল্যাটফর্ম গেটওয়ে চালু করেছেন, কিন্তু প্ল্যাটফর্ম অ্যাডমিন এই provider-এর credential এখনো configure করেননি — এই পথে পেমেন্ট নেওয়া যাবে না। প্ল্যাটফর্ম অ্যাডমিনের সঙ্গে যোগাযোগ করুন, অথবা নিজের গেটওয়ে ব্যবহার করুন।`,
            actionLabel: "পেমেন্ট সেকশন দেখুন",
            href: "/dashboard/connections#cat-payment",
          });
        }
      }
    }

    // ---- Rule 6: own bKash gateway still "configured" ----
    // bKash is the one gateway with a REAL pre-save verification
    // (grant-token) — so a persisted bKash row stuck at
    // "configured" means its credentials were never verified.
    // SSLCommerz/Nagad have no such check and honestly stay
    // "configured" — this rule never fires for them.
    for (const gw of gateways) {
      if (String(gw.provider) !== "bkash" || gw.isEnabled === false) continue;
      if (String(gw.status) !== "configured") continue;
      const env = String(gw.environment ?? "live");
      findings.push({
        key: `bkash_gateway_unverified:${env}`,
        severity: "improvement",
        title: "বিকাশ গেটওয়ে যাচাই ছাড়াই সেভ করা আছে",
        feature: "বিকাশ দিয়ে নির্ভরযোগ্য পেমেন্ট গ্রহণ",
        evidence: `আপনার বিকাশ গেটওয়ে (${env}) “configured” অবস্থায় আছে — bKash-এর ক্ষেত্রে সেভের সময় আসল যাচাই (grant token) হয়, তাই এই রেকর্ডটি যাচাই পেরিয়ে আসেনি। credential আবার সেভ করলে যাচাই হয়ে যাবে।`,
        actionLabel: "গেটওয়ে আবার যাচাই করুন",
        href: "/dashboard/connections#cat-payment",
      });
    }

    // ---- Rule 7: courier connected but never used ----
    if (courierAccounts.length > 0) {
      const shipments = await this.safeCount("courierShipment", { where: { organizationId } });
      if (shipments === 0) {
        findings.push({
          key: "courier_never_used",
          severity: "improvement",
          title: "কুরিয়ার কানেক্ট আছে, এখনো কোনো শিপমেন্ট হয়নি",
          feature: "কুরিয়ার ডেলিভারি ব্যবহার শুরু করা",
          evidence: `${courierAccounts.length}টি কুরিয়ার কানেকশন সক্রিয়, কিন্তু শিপমেন্ট রেকর্ড ০টি — কানেকশনটি এখনো কোনো অর্ডারে ব্যবহৃত হয়নি।`,
          actionLabel: "অর্ডার থেকে শিপমেন্ট করুন",
          href: "/dashboard/orders",
        });
      }
    }

    // ---- Rule 8: LLM on platform fallback, no own key (info) ----
    const ownLlmActive = Boolean(orgLlm) && orgLlm.isEnabled !== false;
    const aiCategory: any = (overview?.categories ?? []).find((c: any) => c.key === "ai");
    if (!ownLlmActive && aiCategory?.status === "platform_managed") {
      findings.push({
        key: "llm_platform_fallback",
        severity: "info",
        title: "AI চলছে প্ল্যাটফর্মের LLM দিয়ে",
        feature: "নিজের LLM key দিয়ে AI ব্যবহার (নিজের খরচ/সীমা নিজের নিয়ন্ত্রণে)",
        evidence: "আপনার নিজের কোনো LLM config সক্রিয় নেই — সব AI ফিচার প্ল্যাটফর্মের LLM দিয়ে চলছে। এটি তথ্যমূলক নোটিস মাত্র; নিজের key যোগ করলে AI আপনার key দিয়েই চলবে।",
        actionLabel: "নিজের LLM key যোগ করুন",
        href: "/dashboard/connections#cat-ai",
      });
    }

    findings.sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) || a.key.localeCompare(b.key));

    // Dismissals: per (org, user) — another member's dismissal
    // never hides a finding from this user.
    const dismissals = await this.safeFindMany("setupFindingDismissal", {
      where: { organizationId, userId },
    });
    const dismissedKeys = new Set(dismissals.map((d: any) => String(d.findingKey)));
    return { findings: findings.filter((f) => !dismissedKeys.has(f.key)) };
  }

  async dismiss(organizationId: string, userId: string, findingKey: string) {
    const base = String(findingKey ?? "").split(":")[0];
    if (!(ASSISTANT_FINDING_KEYS as readonly string[]).includes(base ?? "")) {
      throw new BadRequestException("অজানা finding — এটি dismiss করা যাবে না।");
    }
    await (this.prisma as any).setupFindingDismissal.upsert({
      where: { organizationId_userId_findingKey: { organizationId, userId, findingKey } },
      create: { organizationId, userId, findingKey },
      update: {},
    });
    return { dismissed: true, findingKey };
  }
}
