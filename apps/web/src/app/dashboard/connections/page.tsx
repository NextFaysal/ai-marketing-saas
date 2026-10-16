"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, publicApiBase } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import {
  UNGROUPED_FILTER, accountGroupNames, accountInGroup, appConfigStatusLabel, appSourceMeta, canEditAccountMeta,
  categoryStatusLabel, filterOverview, formatWhen, groupAccounts, healthMeta, overallMeta,
  qualityMeta, whatsappHealth,
  type ConnectionAccount, type ConnectionsOverview, type TenantAppConfigView, type OwnAppGuides,
} from "@/lib/connections";
import { AccountInsights } from "@/components/connect/account-insights";
import { AlertsPanel } from "@/components/connect/alerts-panel";
import { CommerceConnectPanel } from "@/components/connect/commerce-connect-panel";
import { CourierConnectPanel } from "@/components/connect/courier-connect-panel";
import { MessagingConnectPanel } from "@/components/connect/messaging-connect-panel";
import { SenderConnectPanel } from "@/components/connect/sender-connect-panel";
import { LlmConfigPanel } from "@/components/connect/llm-config-panel";
import { PaymentGatewayPanel } from "@/components/connect/payment-gateway-panel";
import { PaymentAttemptsPanel } from "@/components/connect/payment-attempts-panel";
import { MemberAccessPanel } from "@/components/connect/member-access-panel";
import { PaymentHistoryPanel } from "@/components/connect/payment-history-panel";
import { PaymentRefundsPanel } from "@/components/connect/payment-refunds-panel";
import { SettlementImportsPanel } from "@/components/connect/settlement-imports-panel";
import { PayoutAutomationPanel } from "@/components/connect/payout-automation-panel";
import { PaymentLinksPanel } from "@/components/connect/payment-links-panel";
import { SetupAssistantPanel } from "@/components/connect/setup-assistant-panel";
import { HealthAnalyticsPanel } from "@/components/connect/health-analytics-panel";
import { DeliverabilityPanel, UsageInsightsPanel } from "@/components/connect/usage-insights-panel";
import { GoogleLinkedInPanel, GooglePickCard, LinkedInPickCard } from "@/components/connect/google-linkedin-panel";
import { MARKETPLACE_NOTES, googleKindLabel } from "@/lib/connections";

/**
 * CC1 — Connect Center: সব অ্যাকাউন্ট এক জায়গায়।
 *
 * এই পেজটি বিদ্যমান আসল রোগুলোর (Integration / SocialAccount /
 * AdAccount / Store / sender config / BusinessProfile) সম্মিলিত
 * অবস্থা দেখায়। Default করা ও disconnect শুধু Integration-
 * ভিত্তিক অ্যাকাউন্টে এই পেজ থেকেই করা যায় (CC2)।
 *
 * B3 (CC5/CC6/CC7) — আসল connect ফর্মগুলো এখন এই পেজেই: Commerce
 * (shared CommerceConnectPanel — Integrations পেজের হুবহু একই
 * কম্পোনেন্ট), Courier ও Messaging প্যানেলগুলো বিদ্যমান API-ই
 * কল করে; কোনো সমান্তরাল connect পথ বানানো হয়নি।
 *
 * CC3/CC4 — "নিজের অ্যাপ" সেকশন: tenant-এর নিজের Meta/TikTok
 * অ্যাপ config (Meta যাচাই-পূর্বক সেভ, TikTok সৎ "কনফিগার করা")
 * এবং অ্যাপ-উৎস বেছে কানেক্টের প্রবেশদ্বার (মেসেজিং = Inbox
 * deep-link, TikTok = সরাসরি OAuth শুরু)।
 */

const CATEGORY_ICONS: Record<string, string> = {
  messaging: "💬", social: "📣", ads: "🎯", commerce: "🛒",
  courier: "🚚", senders: "✉️", ai: "🤖", payment: "💳", other: "🧩",
  analytics: "📊",
};

const CATEGORY_NOTES: Record<string, string> = {
  ai_platform_managed: "আপনার নিজের LLM key সেট করা হয়নি — AI চলছে প্ল্যাটফর্মের কনফিগার করা LLM দিয়ে। নিজের key দিতে নিচের AI সেকশনটি ব্যবহার করুন।",
  ai_not_configured: "প্ল্যাটফর্মের LLM-ও কনফিগার করা নেই — নিজের key দিতে নিচের AI সেকশনটি ব্যবহার করুন, না হলে AI ফিচার চলবে না।",
  payment_manual_not_configured: "কোনো পেমেন্ট তথ্য দেওয়া হয়নি। নিচের পেমেন্ট সেকশনে নিজের অনলাইন গেটওয়ে যোগ করতে পারেন, অথবা Settings-এ ম্যানুয়াল বিকাশ/নগদ নম্বর দিতে পারেন।",
  no_accounts: "এই ক্যাটাগরিতে এখনো কিছু কানেক্ট করা হয়নি।",
};

function AccountCard({ account, busy, onDefault, onDisconnect, onChanged }: {
  account: ConnectionAccount;
  busy: string;
  onDefault: (a: ConnectionAccount) => void;
  onDisconnect: (a: ConnectionAccount) => void;
  onChanged: () => void;
}) {
  const health = healthMeta(account.health);
  const appSource = appSourceMeta(account);
  const lastSync = formatWhen(account.lastSyncAt);
  const expires = formatWhen(account.tokenExpiresAt);
  const canAct = account.source === "integration";
  // CC17: label/group inline editor (OWNER/ADMIN-only on the API;
  // a refusal surfaces as the server's own message).
  const [editingMeta, setEditingMeta] = useState(false);
  const [labelDraft, setLabelDraft] = useState(account.label ?? "");
  const [groupDraft, setGroupDraft] = useState(account.groupName ?? "");
  const [metaBusy, setMetaBusy] = useState(false);
  const [metaError, setMetaError] = useState("");
  // CC21: auto-heal opt-out toggle (Integration accounts).
  const [healBusy, setHealBusy] = useState(false);
  const [healError, setHealError] = useState("");
  async function toggleAutoHeal() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setHealBusy(true); setHealError("");
    try {
      await apiFetch(`organizations/${orgId}/connections/${account.id}/auto-heal`, {
        method: "PATCH",
        body: JSON.stringify({ autoHealEnabled: account.autoHealEnabled === false }),
      });
      onChanged();
    } catch (e) {
      setHealError(e instanceof Error ? e.message : "Auto-heal সেটিং বদলানো যায়নি");
    } finally { setHealBusy(false); }
  }
  async function saveMeta() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setMetaBusy(true); setMetaError("");
    try {
      await apiFetch(`organizations/${orgId}/connections/targets/${encodeURIComponent(account.source)}/${encodeURIComponent(account.id)}/meta`, {
        method: "PATCH",
        body: JSON.stringify({ label: labelDraft.trim() ? labelDraft : null, groupName: groupDraft.trim() ? groupDraft : null }),
      });
      setEditingMeta(false);
      onChanged();
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : "লেবেল/গ্রুপ সেভ হয়নি");
    } finally { setMetaBusy(false); }
  }
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-800">{account.displayName}</div>
          <div className="mt-0.5 text-xs text-slate-400">
            {account.provider}{account.externalAccountId ? ` · ${account.externalAccountId}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {account.isDefault ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">⭐ ডিফল্ট</span> : null}
          {account.groupName ? <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-700">📁 {account.groupName}</span> : null}
          {account.syncPaused ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">⏸ Sync বিরতি</span> : null}
          {account.autoHealEnabled === false ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">🛠 Auto-heal বন্ধ</span> : null}
          {account.syncDisabled ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Sync বন্ধ (AD5)</span> : null}
          {appSource ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${appSource.cls}`}>{appSource.label}</span> : null}
          {(() => { const wa = whatsappHealth(account); return wa?.qualityRating ? (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${qualityMeta(wa.qualityRating).cls}`}>{qualityMeta(wa.qualityRating).label}</span>
          ) : null; })()}
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${health.cls}`}>{health.label}</span>
        </div>
      </div>
      <div className="mt-2 space-y-1 text-xs text-slate-500">
        <div>অবস্থা: <span className="font-medium text-slate-700">{account.status}</span></div>
        {lastSync ? <div>সর্বশেষ sync: {lastSync}</div> : null}
        {expires ? <div className={account.expiringSoon ? "font-medium text-amber-600" : undefined}>টোকেনের মেয়াদ: {expires}{account.expiringSoon ? " (শীঘ্রই শেষ হচ্ছে)" : ""}</div> : null}
        {account.ownAppConfigMissing ? <div className="rounded-lg bg-amber-50 px-2 py-1 font-medium text-amber-700">⚠️ এই কানেকশনটি নিজের অ্যাপ দিয়ে করা, কিন্তু সেই অ্যাপের কনফিগ সরানো হয়েছে — কানেকশনের টোকেন আছেই, তবে যাচাই/টোকেন রিফ্রেশের জন্য নিচে নিজের অ্যাপ আবার কনফিগার করুন।</div> : null}
        {account.lastError ? <div className="rounded-lg bg-red-50 px-2 py-1 font-medium text-red-600">⚠️ {account.lastError}</div> : null}
        {account.lastCheck ? (
          <div>
            সর্বশেষ live পরীক্ষা:{" "}
            <span className={`rounded-full px-1.5 py-0.5 font-semibold ${overallMeta(account.lastCheck.overall).cls}`}>{overallMeta(account.lastCheck.overall).label}</span>{" "}
            <span className="text-slate-400">{formatWhen(account.lastCheck.at)} · {account.lastCheck.trigger === "sweep" ? "স্বয়ংক্রিয়" : "ম্যানুয়াল"}</span>
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={account.deepLink} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">ম্যানেজ করুন</Link>
        {canAct && !account.isDefault ? (
          <button type="button" disabled={busy === account.id} onClick={() => onDefault(account)} className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
            {busy === account.id ? "হচ্ছে..." : "ডিফল্ট করুন"}
          </button>
        ) : null}
        {canAct && account.status !== "DISCONNECTED" ? (
          <button type="button" disabled={busy === account.id} onClick={() => onDisconnect(account)} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50">
            ডিসকানেক্ট
          </button>
        ) : null}
        {canEditAccountMeta(account) ? (
          <button type="button" onClick={() => { setLabelDraft(account.label ?? ""); setGroupDraft(account.groupName ?? ""); setMetaError(""); setEditingMeta((v) => !v); }} className="rounded-lg bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-100">
            🏷️ লেবেল/গ্রুপ
          </button>
        ) : null}
        {canAct ? (
          <button type="button" disabled={healBusy} onClick={() => void toggleAutoHeal()} title="মনিটরিং sweep ভাঙা commerce webhook নিজে থেকে আবার রেজিস্টার করার আর মেয়াদ শেষের পথে থাকা Meta টোকেন (WhatsApp/Messenger/Instagram/Page) নিজে থেকে রিফ্রেশ করার চেষ্টা করে — এটি বন্ধ রাখলে শুধু সতর্কবার্তা যাবে, মেরামত হবে না" className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
            {healBusy ? "হচ্ছে..." : account.autoHealEnabled === false ? "🛠 Auto-heal চালু করুন" : "🛠 Auto-heal বন্ধ করুন"}
          </button>
        ) : null}
        {account.syncDisabled ? (
          <Link href={account.deepLink} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100">
            Sync বন্ধ আছে — বিজ্ঞাপন পেজে চালু করুন
          </Link>
        ) : null}
      </div>
      {healError ? <p className="mt-2 text-xs font-medium text-red-600">{healError}</p> : null}
      {editingMeta ? (
        <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-100">
          <label className="block text-xs font-medium text-slate-600">লেবেল (কার্ডে এই নামটাই বড় করে দেখাবে; খালি রাখলে আসল নাম)
            <input value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} maxLength={120} placeholder="যেমন: মূল দোকান" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400" />
          </label>
          <label className="block text-xs font-medium text-slate-600">গ্রুপ (ব্র্যান্ড/শাখা অনুযায়ী ভাগ করতে; খালি = গ্রুপ ছাড়া)
            <input value={groupDraft} onChange={(e) => setGroupDraft(e.target.value)} maxLength={120} placeholder="যেমন: ঢাকা ব্রাঞ্চ" list="cc-group-names" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400" />
          </label>
          {metaError ? <p className="text-xs font-medium text-red-600">{metaError}</p> : null}
          <div className="flex gap-2">
            <button type="button" disabled={metaBusy} onClick={() => void saveMeta()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {metaBusy ? "সেভ হচ্ছে…" : "সেভ করুন"}
            </button>
            <button type="button" onClick={() => setEditingMeta(false)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200">বন্ধ করুন</button>
          </div>
        </div>
      ) : null}
      <div className="mt-3">
        <AccountInsights account={account} onChanged={onChanged} />
      </div>
    </div>
  );
}

const inputCls = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400";

/**
 * CC3/CC4 — "নিজের অ্যাপ" management: the tenant's own Meta app
 * and TikTok app. Meta সেভ হয় আসল Graph API যাচাইয়ের পরেই
 * (ব্যর্থ হলে সার্ভার কিছু সেভ করে না, Meta-র বার্তাই দেখায়);
 * TikTok-এর কোনো প্রাক-OAuth যাচাই পথ নেই, তাই সেটি সেভ হয়
 * "কনফিগার করা" হিসেবে — যাচাই হবে প্রথম কানেক্টে। Secret
 * কখনোই ফেরত আসে না — শুধু App ID ও অবস্থা দেখায়।
 */
function OwnAppCard({ anchorId, icon, title, idLabel, secretLabel, config, note, busy, onSave, onDelete, verifyBeforeSave = true }: {
  anchorId: string;
  icon: string;
  title: string;
  idLabel: string;
  secretLabel: string;
  config: TenantAppConfigView | null;
  note: string;
  busy: string;
  onSave: (appId: string, appSecret: string) => void;
  onDelete: () => void;
  /** CC28: only Meta verifies before save; TikTok/Google/
   * LinkedIn have no pre-OAuth credential check, so their
   * button must not promise a verification that never happens. */
  verifyBeforeSave?: boolean;
}) {
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const verifiedAt = formatWhen(config?.lastVerifiedAt);
  const saving = busy === anchorId;
  return (
    <div id={anchorId} className="card scroll-mt-24 space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="font-semibold text-slate-800">{icon} {title}</div>
        {config ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${config.status === "verified" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
            {appConfigStatusLabel(config)}
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">কনফিগার করা হয়নি</span>
        )}
      </div>
      {config ? (
        <div className="space-y-1 text-xs text-slate-500">
          <div>{idLabel}: <span className="font-medium text-slate-700">{config.appId}</span></div>
          {verifiedAt ? <div>সর্বশেষ যাচাই: {verifiedAt}</div> : null}
        </div>
      ) : null}
      <p className="text-xs leading-relaxed text-slate-500">{note}</p>
      {config?.redirectUris?.length ? (
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <div className="font-semibold">আপনার নিজের অ্যাপে এই Redirect URI-গুলো নিবন্ধন করুন (না করলে কানেক্ট সম্পূর্ণ হবে না):</div>
          <ul className="mt-1 list-inside list-disc break-all">
            {config.redirectUris.map((u) => <li key={u}>{u}</li>)}
          </ul>
        </div>
      ) : null}
      <form
        className="space-y-2"
        onSubmit={(e) => { e.preventDefault(); onSave(appId, appSecret); setAppSecret(""); }}
      >
        <label className="block text-sm">{idLabel}
          <input className={inputCls} value={appId} onChange={(e) => setAppId(e.target.value)} required placeholder={config?.appId ?? ""} autoComplete="off" />
        </label>
        <label className="block text-sm">{secretLabel}
          <input className={inputCls} type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} required autoComplete="new-password" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={saving} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "সেভ হচ্ছে..." : verifyBeforeSave ? (config ? "যাচাই করে আবার সেভ করুন" : "যাচাই করে সেভ করুন") : (config ? "আবার সেভ করুন" : "সেভ করুন")}
          </button>
          {config ? (
            <button type="button" disabled={saving} onClick={onDelete} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50">
              কনফিগ সরান
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

export default function ConnectionsPage() {
  const [overview, setOverview] = useState<ConnectionsOverview | null>(null);
  const [appConfigs, setAppConfigs] = useState<TenantAppConfigView[]>([]);
  // CC28: the redirect-URI guides for own Google/LinkedIn apps
  // (returned with the configs list; shown before any save).
  const [ownAppGuides, setOwnAppGuides] = useState<OwnAppGuides | null>(null);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  // CC20: Google/LinkedIn OAuth returns land on THIS page (the
  // callbacks redirect here) — pick states park until the user
  // chooses; results become the page's notice/error.
  const [googlePick, setGooglePick] = useState<{ kind: string; state: string } | null>(null);
  const [linkedinPick, setLinkedinPick] = useState<string | null>(null);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    try {
      const data = await apiFetch<ConnectionsOverview>(`organizations/${orgId}/connections/overview`);
      setOverview(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "কানেকশনের তালিকা লোড হয়নি");
    }
    // CC3: own-app configs (ids + status only; a failure here must
    // not take the whole overview down with it).
    try {
      const res = await apiFetch<{ configs: TenantAppConfigView[]; ownAppGuides?: OwnAppGuides }>(`organizations/${orgId}/connections/app-configs`);
      setAppConfigs(res.configs ?? []);
      setOwnAppGuides(res.ownAppGuides ?? null);
    } catch { /* the section simply shows "not configured" */ }
  }, []);

  const metaAppConfig = appConfigs.find((c) => c.platform === "meta") ?? null;
  const tiktokAppConfig = appConfigs.find((c) => c.platform === "tiktok") ?? null;
  // CC28: google + linkedin own-app configs.
  const googleAppConfig = appConfigs.find((c) => c.platform === "google") ?? null;
  const linkedinAppConfig = appConfigs.find((c) => c.platform === "linkedin") ?? null;
  // CC28: the redirect URIs to show in the google/linkedin card
  // notes — from the guides (available before any save), falling
  // back to the saved config's own list.
  const googleRedirectUris = ownAppGuides?.google.redirectUris ?? googleAppConfig?.redirectUris ?? [];
  const linkedinRedirectUris = ownAppGuides?.linkedin.redirectUris ?? linkedinAppConfig?.redirectUris ?? [];

  type OwnAppPlatform = "meta" | "tiktok" | "google" | "linkedin";
  const OWN_APP_ANCHORS: Record<OwnAppPlatform, string> = {
    meta: "own-meta-form", tiktok: "own-tiktok-form", google: "own-google-form", linkedin: "own-linkedin-form",
  };

  const saveAppConfig = useCallback(async (platform: OwnAppPlatform, appId: string, appSecret: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(OWN_APP_ANCHORS[platform]);
    setError(""); setNotice("");
    try {
      const saved = await apiFetch<TenantAppConfigView>(`organizations/${orgId}/connections/app-configs/${platform}`, {
        method: "PUT", body: JSON.stringify({ appId, appSecret }),
      });
      // CC28: a Meta save with the same App ID but a new secret is
      // a ROTATION — the API flags it; existing connections keep
      // working, no reconnect is needed, and the copy says so.
      setNotice(saved.rotated
        ? "Meta App Secret রোটেট হয়েছে — নতুন Secret-টি যাচাই হয়ে সেভ হয়েছে। আগের কানেকশনগুলো আবার কানেক্ট করার দরকার নেই; তাদের টোকেন আগের মতোই চলবে।"
        : platform === "meta"
          ? "আপনার Meta অ্যাপটি Meta-র কাছে যাচাই হয়ে সেভ হয়েছে — এখন নিচের 'নিজের অ্যাপ দিয়ে' কানেক্ট করা যাবে।"
          : platform === "tiktok"
            ? "আপনার TikTok অ্যাপটি সেভ হয়েছে (কনফিগার করা) — আসল যাচাই হবে প্রথম কানেক্টের সময়, TikTok-এর টোকেন বিনিময়ে।"
            : platform === "google"
              ? "আপনার Google অ্যাপটি সেভ হয়েছে (কনফিগার করা) — নিচে দেওয়া Redirect URI-গুলো আপনার Google Cloud Console-এ নিবন্ধন করেছেন কিনা নিশ্চিত করুন; আসল যাচাই হবে প্রথম কানেক্টে।"
              : "আপনার LinkedIn অ্যাপটি সেভ হয়েছে (কনফিগার করা) — নিচে দেওয়া Callback URL-টি আপনার LinkedIn অ্যাপে নিবন্ধন করেছেন কিনা নিশ্চিত করুন; আসল যাচাই হবে প্রথম কানেক্টে।");
      setAppConfigs((prev) => [...prev.filter((c) => c.platform !== platform), saved]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "অ্যাপ কনফিগ সেভ হয়নি");
    } finally { setBusy(""); }
  }, [load]);

  const deleteAppConfig = useCallback(async (platform: OwnAppPlatform) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!window.confirm("নিজের অ্যাপের কনফিগ সরাবেন? এই অ্যাপ দিয়ে করা কানেকশনগুলোর টোকেন থাকবে, তবে যাচাই/টোকেন রিফ্রেশের জন্য অ্যাপটি আবার লাগবে।")) return;
    // CC23: TOTP step-up — চালু থাকলে কোড বাধ্যতামূলক (সার্ভার
    // যাচাই করে); না থাকলে খালি রেখে এগোনো যাবে, তবে সার্ভার
    // stepUpUnavailable জানিয়ে দেবে।
    const code = window.prompt("Two-Factor (TOTP) চালু থাকলে Authenticator অ্যাপের ৬-সংখ্যার কোডটি দিন। চালু না থাকলে খালি রেখে OK করুন:");
    if (code === null) return;
    setBusy(OWN_APP_ANCHORS[platform]);
    try {
      const res = await apiFetch<{ stepUpUnavailable?: boolean }>(`organizations/${orgId}/connections/app-configs/${platform}${code.trim() ? `?totpCode=${encodeURIComponent(code.trim())}` : ""}`, { method: "DELETE" });
      setNotice(res?.stepUpUnavailable
        ? "নিজের অ্যাপের কনফিগ সরানো হয়েছে। (আপনার Two-Factor চালু নেই — সংবেদনশীল কাজে অতিরিক্ত সুরক্ষার জন্য Settings থেকে Two-Factor চালু করুন।)"
        : "নিজের অ্যাপের কনফিগ সরানো হয়েছে।");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "কনফিগ সরানো যায়নি");
    } finally { setBusy(""); }
  }, [load]);

  /** CC4: TikTok OAuth শুরু — প্ল্যাটফর্ম অ্যাপ বা নিজের অ্যাপ,
   * সার্ভারই authorize URL বানায়; ব্রাউজার সেখানেই যায়। */
  const tiktokConnect = useCallback(async (source: "platform" | "own") => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(`tiktok-${source}`); setError("");
    try {
      const res = await apiFetch<{ url: string }>(`organizations/${orgId}/social/accounts/tiktok/connect-url${source === "own" ? "?appSource=own" : ""}`);
      window.location.href = res.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "TikTok কানেক্ট শুরু হয়নি");
      setBusy("");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // CC20: consume the Google/LinkedIn OAuth return params ONCE
  // (the social-posts page's pattern): show the outcome, park a
  // pick state in its picker card, then strip the params so a
  // refresh never replays them.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const keys = ["google_connected", "google_error", "google_pick", "google_kind", "linkedin_connected", "linkedin_error", "linkedin_pick"];
    if (!keys.some((k) => params.has(k))) return;
    if (params.get("google_connected")) {
      setNotice(`${googleKindLabel(params.get("google_connected")!)} কানেক্ট হয়েছে।`);
      void load();
    }
    if (params.get("google_error")) setError(params.get("google_error")!);
    if (params.get("google_pick")) {
      setGooglePick({ kind: params.get("google_kind") ?? "ga4", state: params.get("google_pick")! });
    }
    if (params.get("linkedin_connected")) {
      setNotice("LinkedIn Page কানেক্ট হয়েছে।");
      void load();
    }
    if (params.get("linkedin_error")) setError(params.get("linkedin_error")!);
    if (params.get("linkedin_pick")) setLinkedinPick(params.get("linkedin_pick"));
    for (const k of keys) params.delete(k);
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = useCallback(async (account: ConnectionAccount, kind: "default" | "disconnect") => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (kind === "disconnect" && !window.confirm(`"${account.displayName}" ডিসকানেক্ট করবেন? শুধু এই অ্যাকাউন্টটিই বিচ্ছিন্ন হবে — একই প্রোভাইডারের অন্য অ্যাকাউন্ট অক্ষত থাকবে।`)) return;
    setBusy(account.id);
    try {
      if (kind === "default") {
        await apiFetch(`organizations/${orgId}/connections/${account.id}/default`, { method: "PATCH" });
        setNotice(`"${account.displayName}" এখন এই ক্যাটাগরির ডিফল্ট কানেকশন।`);
      } else {
        await apiFetch(`organizations/${orgId}/connections/${account.id}/disconnect`, { method: "POST" });
        setNotice(`"${account.displayName}" ডিসকানেক্ট হয়েছে।`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "কাজটি সম্পন্ন হয়নি");
    } finally {
      setBusy("");
    }
  }, [load]);

  const allAccounts = useMemo(
    () => (overview ? overview.categories.flatMap((c) => c.accounts) : []),
    [overview],
  );
  const groupNames = useMemo(() => accountGroupNames(allAccounts), [allAccounts]);

  const visible = useMemo(() => {
    if (!overview) return [];
    const searched = filterOverview(overview, query);
    if (!groupFilter) return searched;
    return searched
      .map((category) => ({ ...category, accounts: category.accounts.filter((a) => accountInGroup(a, groupFilter)) }))
      .filter((category) => category.accounts.length > 0);
  }, [overview, query, groupFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">🔗 কানেক্ট সেন্টার</h1>
        <p className="mt-1 text-sm text-slate-500">
          আপনার সব অ্যাকাউন্ট এক জায়গায় — Facebook Page, WhatsApp (একাধিক নম্বরও চলবে), বিজ্ঞাপন অ্যাকাউন্ট, WooCommerce/Shopify স্টোর,
          কুরিয়ার আর পেমেন্ট। প্রতিটি অ্যাকাউন্টের আসল অবস্থা এখানে দেখা যাবে; অবস্থা সেভ করা তথ্য থেকে দেখানো হয়, অনুমান করে নয়।
        </p>
      </div>

      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}
      {notice ? <div className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{notice}</div> : null}

      {googlePick ? (
        <GooglePickCard
          kind={googlePick.kind}
          state={googlePick.state}
          onDone={(message) => { setGooglePick(null); setNotice(message); void load(); }}
        />
      ) : null}
      {linkedinPick ? (
        <LinkedInPickCard
          state={linkedinPick}
          onDone={(message) => { setLinkedinPick(null); setNotice(message); void load(); }}
        />
      ) : null}

      {overview ? (
        <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
          <span>মোট অ্যাকাউন্ট: <b>{overview.summary.totalAccounts}</b></span>
          <span>কানেক্টেড: <b className="text-green-700">{overview.summary.connectedAccounts}</b></span>
          <span>সমস্যা আছে: <b className="text-red-600">{overview.summary.errorAccounts}</b></span>
          {(overview.summary.unreadAlerts ?? 0) > 0 ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">🔔 {overview.summary.unreadAlerts}টি অপঠিত অ্যালার্ট</span>
          ) : null}
          <span className="flex flex-wrap gap-1.5">
            {overview.categories.map((c) => (
              <span key={c.key} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {CATEGORY_ICONS[c.key] ?? "🧩"} {c.label}: {c.connectedCount}/{c.totalCount}
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {overview ? <SetupAssistantPanel /> : null}

      {overview ? <AlertsPanel onChanged={() => void load()} /> : null}

      {overview ? <HealthAnalyticsPanel /> : null}

      {overview ? <UsageInsightsPanel /> : null}

      {overview ? <DeliverabilityPanel /> : null}

      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="অ্যাকাউন্ট খুঁজুন — নাম, প্রোভাইডার বা অ্যাকাউন্ট আইডি লিখুন…"
          className="min-w-56 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-indigo-400"
        />
        <select
          aria-label="গ্রুপ অনুযায়ী ছাঁকুন"
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600 outline-none focus:border-indigo-400"
        >
          <option value="">📁 সব গ্রুপ</option>
          {groupNames.map((name) => (
            <option key={name} value={name}>📁 {name}</option>
          ))}
          <option value={UNGROUPED_FILTER}>গ্রুপ ছাড়া</option>
        </select>
        <datalist id="cc-group-names">
          {groupNames.map((name) => <option key={name} value={name} />)}
        </datalist>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">🛠️ নিজের অ্যাপ — অথবা আমাদের অ্যাপ</h2>
          <p className="mt-1 text-sm text-slate-500">
            প্রতিটি কানেকশন দুইভাবে করা যায়: আমাদের (প্ল্যাটফর্মের) অ্যাপ দিয়ে — কিছু সেট করা ছাড়াই — অথবা আপনার নিজের
            Developer অ্যাপ দিয়ে। নিজের অ্যাপ ব্যবহার করতে চাইলে আগে এখানে কনফিগার করুন; কোন কানেকশন কোন অ্যাপে হয়েছে
            তা প্রতিটি অ্যাকাউন্ট কার্ডে ব্যাজে দেখা যাবে।
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <OwnAppCard
            anchorId="own-meta-form"
            icon="🔷"
            title="নিজের Meta অ্যাপ (Facebook)"
            idLabel="Meta App ID"
            secretLabel="Meta App Secret"
            config={metaAppConfig}
            busy={busy}
            note="Meta-তে নিজের App তৈরি করে App ID ও App Secret দিন। সেভ করার আগে আসল Graph API দিয়ে যাচাই করা হয় — যাচাই ব্যর্থ হলে কিছুই সেভ হয় না এবং Meta-র নিজের ত্রুটির বার্তা দেখায়। App Secret বদলালে (রোটেশন) আগের কানেকশনগুলো আবার কানেক্ট করতে হবে না — একই App ID দিয়ে নতুন Secret সেভ করলেই টোকেনগুলো আগের মতো চলবে।"
            onSave={(appId, appSecret) => void saveAppConfig("meta", appId, appSecret)}
            onDelete={() => void deleteAppConfig("meta")}
          />
          <OwnAppCard
            anchorId="own-tiktok-form"
            icon="🎵"
            title="নিজের TikTok অ্যাপ"
            idLabel="TikTok Client Key"
            secretLabel="TikTok Client Secret"
            config={tiktokAppConfig}
            busy={busy}
            verifyBeforeSave={false}
            note={`TikTok-এ নিজের App তৈরি করে Client Key ও Client Secret দিন, আর অ্যাপে Redirect URI হিসেবে এই ঠিকানাটি নিবন্ধন করুন: ${publicApiBase()}/social/oauth/tiktok/callback । TikTok কোনো আগাম credential-যাচাইয়ের সুযোগ দেয় না (টোকেন পেতে ব্যবহারকারীর অনুমোদন লাগে), তাই এটি সেভ হয় "কনফিগার করা" হিসেবে — আসল যাচাই হবে প্রথম কানেক্টে।`}
            onSave={(appId, appSecret) => void saveAppConfig("tiktok", appId, appSecret)}
            onDelete={() => void deleteAppConfig("tiktok")}
          />
          <OwnAppCard
            anchorId="own-google-form"
            icon="🔍"
            title="নিজের Google অ্যাপ"
            idLabel="Google Client ID"
            secretLabel="Google Client Secret"
            config={googleAppConfig}
            busy={busy}
            verifyBeforeSave={false}
            note={`Google Cloud Console-এ নিজের OAuth Client তৈরি করে Client ID (শেষে .apps.googleusercontent.com থাকবে) ও Client Secret দিন। Google কোনো আগাম credential-যাচাই দেয় না, তাই এটি সেভ হয় "কনফিগার করা" হিসেবে — আসল যাচাই হবে প্রথম কানেক্টে। কানেক্টের আগে এই Redirect URI-গুলো আপনার Google Cloud Console-এ নিবন্ধন করা বাধ্যতামূলক — না করলে Google কানেক্ট প্রত্যাখ্যান করবে:${googleRedirectUris.length ? ` ${googleRedirectUris.join(" · ")}` : " (লোড হয়নি — পেজটি আবার লোড করুন)"}`}
            onSave={(appId, appSecret) => void saveAppConfig("google", appId, appSecret)}
            onDelete={() => void deleteAppConfig("google")}
          />
          <OwnAppCard
            anchorId="own-linkedin-form"
            icon="💼"
            title="নিজের LinkedIn অ্যাপ"
            idLabel="LinkedIn Client ID"
            secretLabel="LinkedIn Client Secret"
            config={linkedinAppConfig}
            busy={busy}
            verifyBeforeSave={false}
            note={`LinkedIn Developer Portal-এ নিজের App তৈরি করে Client ID ও Client Secret দিন, আর অ্যাপের Auth সেটিংসে এই Callback URL-টি নিবন্ধন করুন:${linkedinRedirectUris.length ? ` ${linkedinRedirectUris.join(" · ")}` : " (লোড হয়নি — পেজটি আবার লোড করুন)"} LinkedIn-ও কোনো আগাম credential-যাচাই দেয় না, তাই এটি সেভ হয় "কনফিগার করা" হিসেবে — আসল যাচাই হবে প্রথম কানেক্টে।`}
            onSave={(appId, appSecret) => void saveAppConfig("linkedin", appId, appSecret)}
            onDelete={() => void deleteAppConfig("linkedin")}
          />
        </div>
        <div className="card flex flex-wrap items-center gap-2 p-4">
          <span className="text-sm font-semibold text-slate-700">অ্যাপ বেছে কানেক্ট করুন:</span>
          <a href="#cc-forms-messaging" className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">💬 WhatsApp/Messenger/Instagram — আমাদের অ্যাপ দিয়ে (নিচের ফর্মে)</a>
          {metaAppConfig ? (
            <a href="/dashboard/connections?appSource=own#cc-forms-messaging" className="rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-200">💬 WhatsApp/Messenger/Instagram — নিজের অ্যাপ দিয়ে (নিচের ফর্মে)</a>
          ) : (
            <a href="#own-meta-form" className="rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-600 hover:bg-violet-100">💬 নিজের Meta অ্যাপ দিয়ে — আগে অ্যাপ কনফিগার করুন ↑</a>
          )}
          <button type="button" disabled={busy === "tiktok-platform"} onClick={() => void tiktokConnect("platform")} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">🎵 TikTok — আমাদের অ্যাপ দিয়ে</button>
          {tiktokAppConfig ? (
            <button type="button" disabled={busy === "tiktok-own"} onClick={() => void tiktokConnect("own")} className="rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-200 disabled:opacity-50">🎵 TikTok — নিজের অ্যাপ দিয়ে</button>
          ) : (
            <a href="#own-tiktok-form" className="rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-600 hover:bg-violet-100">🎵 নিজের TikTok অ্যাপ দিয়ে — আগে অ্যাপ কনফিগার করুন ↑</a>
          )}
        </div>
      </section>

      <GoogleLinkedInPanel />

      {!overview && !error ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : null}

      {overview && visible.length === 0 ? (
        <EmptyState title="কিছু পাওয়া যায়নি" description="এই খোঁজে কোনো অ্যাকাউন্ট মিলছে না — খোঁজ বদলে আবার চেষ্টা করুন।" />
      ) : null}

      {visible.map((category) => (
        <section key={category.key} id={`cat-${category.key}`} className="scroll-mt-24 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-800">
              {CATEGORY_ICONS[category.key] ?? "🧩"} {category.label}
              <span className="ml-2 text-xs font-medium text-slate-400">{categoryStatusLabel(category)}</span>
            </h2>
            {["commerce", "courier", "messaging", "senders", "ai", "payment"].includes(category.key) ? (
              <a href={`#cc-forms-${category.key}`} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">
                এখানেই কানেক্ট করুন ↓
              </a>
            ) : (
              <Link href={category.deepLink} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">
                {category.totalCount === 0 ? "কানেক্ট করুন" : "ম্যানেজ করুন"}
              </Link>
            )}
          </div>
          {category.note && CATEGORY_NOTES[category.note] ? (
            <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-500 ring-1 ring-inset ring-slate-100">{CATEGORY_NOTES[category.note]}</p>
          ) : null}
          {category.accounts.length > 0 ? (
            <div className="space-y-4">
              {groupAccounts(category.accounts).map((group) => (
                <div key={group.groupName ?? "__ungrouped"} className="space-y-2">
                  {groupNames.length > 0 ? (
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      {group.groupName ? `📁 ${group.groupName}` : "গ্রুপ ছাড়া"}
                    </h3>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {group.accounts.map((account) => (
                      <AccountCard
                        key={`${account.source}:${account.id}`}
                        account={account}
                        busy={busy}
                        onDefault={(a) => void act(a, "default")}
                        onDisconnect={(a) => void act(a, "disconnect")}
                        onChanged={() => void load()}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ))}

      {overview ? <MemberAccessPanel /> : null}

      <section className="space-y-3" aria-label="মার্কেটপ্লেস">
        <div>
          <h2 className="font-semibold text-slate-800">🏪 মার্কেটপ্লেস</h2>
          <p className="mt-1 text-sm text-slate-500">
            দুটি মার্কেটপ্লেস নিয়ে গবেষণার (EC14) সিদ্ধান্ত এখানে সৎভাবে লেখা আছে — যেখানে আসল API পথ নেই,
            সেখানে ভুয়া কানেক্ট বাটন বসানো হয়নি।
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {MARKETPLACE_NOTES.map((note) => (
            <div key={note.provider} className="card space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-800">{note.icon} {note.name}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">সিদ্ধান্ত: কানেক্ট নেই (NO-BUILD)</span>
              </div>
              <p className="text-[13px] font-medium text-slate-600">{note.summary}</p>
              <p className="text-[13px] text-slate-500">{note.reason}</p>
              <p className="text-[13px] text-slate-500"><b>কবে বদলাবে:</b> {note.revisit}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="cc-forms-messaging" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">💬 মেসেজিং চ্যানেল কানেক্ট করুন</h2>
          <p className="mt-1 text-sm text-slate-500">WhatsApp / Messenger / Instagram, Telegram বট ও Email মেইলবক্স — Inbox-এর একই ফ্লো, একই যাচাই, এখন এই পেজ থেকেই। কানেক্ট হলে উপরের তালিকায় অবস্থা হালনাগাদ হবে।</p>
        </div>
        <MessagingConnectPanel onChanged={() => void load()} />
      </section>

      <section id="cc-forms-commerce" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">🛒 স্টোর কানেক্ট করুন — WooCommerce / Shopify</h2>
          <p className="mt-1 text-sm text-slate-500">Integrations পেজের হুবহু একই কম্পোনেন্ট ও একই API — স্টোর যোগ, যাচাই করে কানেক্ট, Sync, Health যাচাই সব এখান থেকেই করা যাবে।</p>
        </div>
        <CommerceConnectPanel onChanged={() => void load()} />
      </section>

      <section id="cc-forms-courier" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">🚚 কুরিয়ার কানেক্ট করুন</h2>
          <p className="mt-1 text-sm text-slate-500">Steadfast / Pathao / RedX / eCourier — সবগুলো একসাথে যুক্ত থাকতে পারে। প্রতিটির যাচাই হয় তার আসল API দিয়ে; ডিফল্ট কুরিয়ারও এখান থেকেই বেছে নেওয়া যায়।</p>
        </div>
        <CourierConnectPanel onChanged={() => void load()} />
      </section>

      <section id="cc-forms-senders" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">✉️ প্রেরক কানেক্ট করুন — নিজের SMTP / SMS</h2>
          <p className="mt-1 text-sm text-slate-500">Messaging পেজের একই MS4 ফ্লো, একই যাচাই — এখন এই পেজ থেকেই। নিজের প্রেরক বসালে Broadcast আপনার অ্যাকাউন্ট দিয়েই যাবে।</p>
        </div>
        <SenderConnectPanel onChanged={() => void load()} />
      </section>

      <section id="cc-forms-ai" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">🤖 AI / LLM — নিজের key অথবা প্ল্যাটফর্মের</h2>
          <p className="mt-1 text-sm text-slate-500">নিজের key বসালে এই সংস্থার AI সেই key দিয়েই চলবে (খরচ আপনার provider অ্যাকাউন্টে); না বসালে প্ল্যাটফর্মের LLM, আগের মতোই।</p>
        </div>
        <LlmConfigPanel onChanged={() => void load()} />
      </section>

      <section id="cc-forms-payment" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">💳 পেমেন্ট — নিজের গেটওয়ে</h2>
          <p className="mt-1 text-sm text-slate-500">টাকা সরাসরি আপনার নিজের merchant অ্যাকাউন্টে যাবে — প্ল্যাটফর্ম এই টাকা ধরে রাখে না। পেমেন্ট সফল ধরা হয় শুধু গেটওয়ের সার্ভার-যাচাইয়ের পরেই; ব্রাউজার ফিরে আসা কখনো প্রমাণ নয়।</p>
        </div>
        <PaymentGatewayPanel onChanged={() => void load()} />
        <PaymentHistoryPanel />
        <PaymentRefundsPanel />
        <SettlementImportsPanel />
        <PayoutAutomationPanel />
        <PaymentLinksPanel />
      </section>

      <section className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">🧾 পেমেন্ট চেষ্টা — সব অর্ডারের অনলাইন পেমেন্ট</h2>
          <p className="mt-1 text-sm text-slate-500">প্রতিটি পেমেন্ট চেষ্টার আসল অবস্থা, ব্যর্থতার কারণ ও ফি/নেট এখানে দেখা যাবে। অপেক্ষমাণ অর্ডারের পেমেন্ট লিংক এখান থেকেই আবার পাঠানো যায় — পাঠানোর ফলাফল হুবহু API যা বলে তাই দেখানো হয়।</p>
        </div>
        <PaymentAttemptsPanel />
      </section>
    </div>
  );
}
