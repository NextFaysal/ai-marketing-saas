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
import dynamic from "next/dynamic";
import { useLocale } from "@/lib/i18n/provider";
import { fmtNumber } from "@repo/contracts";
import { AccountInsights } from "@/components/connect/account-insights";
import { MessagingConnectPanel } from "@/components/connect/messaging-connect-panel";
import { SenderConnectPanel } from "@/components/connect/sender-connect-panel";
import { LlmConfigPanel } from "@/components/connect/llm-config-panel";
import { MemberAccessPanel } from "@/components/connect/member-access-panel";
import { SetupAssistantPanel } from "@/components/connect/setup-assistant-panel";
import { GooglePickCard, LinkedInPickCard } from "@/components/connect/google-linkedin-panel";

const CommerceConnectPanel = dynamic(() => import("@/components/connect/commerce-connect-panel").then((m) => m.CommerceConnectPanel), { ssr: false });
const CourierConnectPanel = dynamic(() => import("@/components/connect/courier-connect-panel").then((m) => m.CourierConnectPanel), { ssr: false });
const PaymentGatewayPanel = dynamic(() => import("@/components/connect/payment-gateway-panel").then((m) => m.PaymentGatewayPanel), { ssr: false });
const PaymentAttemptsPanel = dynamic(() => import("@/components/connect/payment-attempts-panel").then((m) => m.PaymentAttemptsPanel), { ssr: false });
const PaymentHistoryPanel = dynamic(() => import("@/components/connect/payment-history-panel").then((m) => m.PaymentHistoryPanel), { ssr: false });
const PaymentRefundsPanel = dynamic(() => import("@/components/connect/payment-refunds-panel").then((m) => m.PaymentRefundsPanel), { ssr: false });
const SettlementImportsPanel = dynamic(() => import("@/components/connect/settlement-imports-panel").then((m) => m.SettlementImportsPanel), { ssr: false });
const PayoutAutomationPanel = dynamic(() => import("@/components/connect/payout-automation-panel").then((m) => m.PayoutAutomationPanel), { ssr: false });
const PaymentLinksPanel = dynamic(() => import("@/components/connect/payment-links-panel").then((m) => m.PaymentLinksPanel), { ssr: false });
const AlertsPanel = dynamic(() => import("@/components/connect/alerts-panel").then((m) => m.AlertsPanel), { ssr: false });
const HealthAnalyticsPanel = dynamic(() => import("@/components/connect/health-analytics-panel").then((m) => m.HealthAnalyticsPanel), { ssr: false });
const DeliverabilityPanel = dynamic(() => import("@/components/connect/usage-insights-panel").then((m) => m.DeliverabilityPanel), { ssr: false });
const UsageInsightsPanel = dynamic(() => import("@/components/connect/usage-insights-panel").then((m) => m.UsageInsightsPanel), { ssr: false });
const GoogleLinkedInPanel = dynamic(() => import("@/components/connect/google-linkedin-panel").then((m) => m.GoogleLinkedInPanel), { ssr: false });
import { marketplaceNotes, googleKindLabel } from "@/lib/connections";

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

const CATEGORY_NOTE_KEYS: Record<string, string> = {
  ai_platform_managed: "pgNoteAiManaged",
  ai_not_configured: "pgNoteAiNotConfigured",
  payment_manual_not_configured: "pgNotePaymentManual",
  no_accounts: "pgNoteNoAccounts",
};

function AccountCard({ account, busy, onDefault, onDisconnect, onChanged }: {
  account: ConnectionAccount;
  busy: string;
  onDefault: (a: ConnectionAccount) => void;
  onDisconnect: (a: ConnectionAccount) => void;
  onChanged: () => void;
}) {
  const { dict, t, locale } = useLocale();
  const D = dict.connections;
  const health = healthMeta(account.health, locale);
  const appSource = appSourceMeta(account, locale);
  const lastSync = formatWhen(account.lastSyncAt, locale);
  const expires = formatWhen(account.tokenExpiresAt, locale);
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
      setHealError(e instanceof Error ? e.message : D.pgHealFailed);
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
      setMetaError(e instanceof Error ? e.message : D.pgMetaSaveFailed);
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
          {account.isDefault ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{D.crDefault}</span> : null}
          {account.groupName ? <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-700">📁 {account.groupName}</span> : null}
          {account.syncPaused ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{D.pgSyncPausedChip}</span> : null}
          {account.autoHealEnabled === false ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{D.pgAutoHealOffChip}</span> : null}
          {account.syncDisabled ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{D.pgSyncDisabledChip}</span> : null}
          {appSource ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${appSource.cls}`}>{appSource.label}</span> : null}
          {(() => { const wa = whatsappHealth(account); return wa?.qualityRating ? (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${qualityMeta(wa.qualityRating, locale).cls}`}>{qualityMeta(wa.qualityRating, locale).label}</span>
          ) : null; })()}
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${health.cls}`}>{health.label}</span>
        </div>
      </div>
      <div className="mt-2 space-y-1 text-xs text-slate-500">
        <div>{D.pgStatusLabel}<span className="font-medium text-slate-700">{account.status}</span></div>
        {lastSync ? <div>{D.pgLastSync}{lastSync}</div> : null}
        {expires ? <div className={account.expiringSoon ? "font-medium text-amber-600" : undefined}>{D.pgTokenExpiry}{expires}{account.expiringSoon ? D.pgExpiringSoon : ""}</div> : null}
        {account.ownAppConfigMissing ? <div className="rounded-lg bg-amber-50 px-2 py-1 font-medium text-amber-700">{D.pgOwnAppMissing}</div> : null}
        {account.lastError ? <div className="rounded-lg bg-red-50 px-2 py-1 font-medium text-red-600">⚠️ {account.lastError}</div> : null}
        {account.lastCheck ? (
          <div>
            {D.pgLastCheck}
            <span className={`rounded-full px-1.5 py-0.5 font-semibold ${overallMeta(account.lastCheck.overall, locale).cls}`}>{overallMeta(account.lastCheck.overall, locale).label}</span>{" "}
            <span className="text-slate-400">{formatWhen(account.lastCheck.at, locale)} · {account.lastCheck.trigger === "sweep" ? D.pgAuto : D.aiManual}</span>
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={account.deepLink} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">{D.pgManage}</Link>
        {canAct && !account.isDefault ? (
          <button type="button" disabled={busy === account.id} onClick={() => onDefault(account)} className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
            {busy === account.id ? D.pwWorking : D.pgMakeDefault}
          </button>
        ) : null}
        {canAct && account.status !== "DISCONNECTED" ? (
          <button type="button" disabled={busy === account.id} onClick={() => onDisconnect(account)} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50">
            {D.pgDisconnect}
          </button>
        ) : null}
        {canEditAccountMeta(account) ? (
          <button type="button" onClick={() => { setLabelDraft(account.label ?? ""); setGroupDraft(account.groupName ?? ""); setMetaError(""); setEditingMeta((v) => !v); }} className="rounded-lg bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-100">
            {D.pgMetaBtn}
          </button>
        ) : null}
        {canAct ? (
          <button type="button" disabled={healBusy} onClick={() => void toggleAutoHeal()} title={D.pgHealTitle} className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
            {healBusy ? D.pwWorking : account.autoHealEnabled === false ? D.pgHealOn : D.pgHealOffBtn}
          </button>
        ) : null}
        {account.syncDisabled ? (
          <Link href={account.deepLink} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100">
            {D.pgSyncDisabledLink}
          </Link>
        ) : null}
      </div>
      {healError ? <p className="mt-2 text-xs font-medium text-red-600">{healError}</p> : null}
      {editingMeta ? (
        <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-100">
          <label className="block text-xs font-medium text-slate-600">{D.pgLabelField}
            <input value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} maxLength={120} placeholder={D.pgLabelPh} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400" />
          </label>
          <label className="block text-xs font-medium text-slate-600">{D.pgGroupField}
            <input value={groupDraft} onChange={(e) => setGroupDraft(e.target.value)} maxLength={120} placeholder={D.pgGroupPh} list="cc-group-names" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400" />
          </label>
          {metaError ? <p className="text-xs font-medium text-red-600">{metaError}</p> : null}
          <div className="flex gap-2">
            <button type="button" disabled={metaBusy} onClick={() => void saveMeta()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {metaBusy ? D.pgSaving : D.pgSavePlain}
            </button>
            <button type="button" onClick={() => setEditingMeta(false)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200">{dict.common.close}</button>
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
  const { dict, locale } = useLocale();
  const D = dict.connections;
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const verifiedAt = formatWhen(config?.lastVerifiedAt, locale);
  const saving = busy === anchorId;
  return (
    <div id={anchorId} className="card scroll-mt-24 space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="font-semibold text-slate-800">{icon} {title}</div>
        {config ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${config.status === "verified" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
            {appConfigStatusLabel(config, locale)}
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{D.gwNotConfigured}</span>
        )}
      </div>
      {config ? (
        <div className="space-y-1 text-xs text-slate-500">
          <div>{idLabel}: <span className="font-medium text-slate-700">{config.appId}</span></div>
          {verifiedAt ? <div>{D.gwLastVerified}{verifiedAt}</div> : null}
        </div>
      ) : null}
      <p className="text-xs leading-relaxed text-slate-500">{note}</p>
      {config?.redirectUris?.length ? (
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <div className="font-semibold">{D.pgRedirectTitle}</div>
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
            {saving ? D.pgSavingDots : verifyBeforeSave ? (config ? D.pgResaveVerify : D.pgSaveVerify) : (config ? D.pgResave : D.pgSavePlain)}
          </button>
          {config ? (
            <button type="button" disabled={saving} onClick={onDelete} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50">
              {D.pgRemoveConfig}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

export default function ConnectionsPage() {
  const { dict, t, locale } = useLocale();
  const D = dict.connections;
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
    if (!orgId) { setError(D.cmNoOrg); return; }
    try {
      const data = await apiFetch<ConnectionsOverview>(`organizations/${orgId}/connections/overview`);
      setOverview(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : D.pgLoadFailed);
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
  // SN7: the tenant's own Threads app (SN7 own-app path).
  const threadsAppConfig = appConfigs.find((c) => c.platform === "threads") ?? null;
  const threadsRedirectUris = ownAppGuides?.threads?.redirectUris ?? threadsAppConfig?.redirectUris ?? [];

  type OwnAppPlatform = "meta" | "tiktok" | "google" | "linkedin" | "threads";
  const OWN_APP_ANCHORS: Record<OwnAppPlatform, string> = {
    meta: "own-meta-form", tiktok: "own-tiktok-form", google: "own-google-form", linkedin: "own-linkedin-form", threads: "own-threads-form",
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
        ? D.pgRotated
        : platform === "meta"
          ? D.pgSavedMeta
          : platform === "tiktok"
            ? D.pgSavedTiktok
            : platform === "google"
              ? D.pgSavedGoogle
              : D.pgSavedLinkedin);
      setAppConfigs((prev) => [...prev.filter((c) => c.platform !== platform), saved]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.pgAppSaveFailed);
    } finally { setBusy(""); }
  }, [load]);

  const deleteAppConfig = useCallback(async (platform: OwnAppPlatform) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!window.confirm(D.pgConfirmRemoveApp)) return;
    // CC23: TOTP step-up — চালু থাকলে কোড বাধ্যতামূলক (সার্ভার
    // যাচাই করে); না থাকলে খালি রেখে এগোনো যাবে, তবে সার্ভার
    // stepUpUnavailable জানিয়ে দেবে।
    const code = window.prompt(D.pgPromptTotp);
    if (code === null) return;
    setBusy(OWN_APP_ANCHORS[platform]);
    try {
      const res = await apiFetch<{ stepUpUnavailable?: boolean }>(`organizations/${orgId}/connections/app-configs/${platform}${code.trim() ? `?totpCode=${encodeURIComponent(code.trim())}` : ""}`, { method: "DELETE" });
      setNotice(res?.stepUpUnavailable ? `${D.pgRemovedApp}${D.gwStepUpSuffix}` : D.pgRemovedApp);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.pgRemoveAppFailed);
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
      setError(e instanceof Error ? e.message : D.pgTiktokFailed);
      setBusy("");
    }
  }, []);

  /** SN7: Threads OAuth শুরু — একই ধাঁচ। (Callback Social Posts
   * পেজে ফেরত যায়, যেখানে Connect বোতামটিও আছে।) */
  const threadsConnect = useCallback(async (source: "platform" | "own") => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(`threads-${source}`); setError("");
    try {
      const res = await apiFetch<{ url: string }>(`organizations/${orgId}/social/accounts/threads/connect-url${source === "own" ? "?appSource=own" : ""}`);
      window.location.href = res.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : D.pgThreadsFailed);
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
      setNotice(t("connections.pgGoogleConnected", { label: googleKindLabel(params.get("google_connected")!) }));
      void load();
    }
    if (params.get("google_error")) setError(params.get("google_error")!);
    if (params.get("google_pick")) {
      setGooglePick({ kind: params.get("google_kind") ?? "ga4", state: params.get("google_pick")! });
    }
    if (params.get("linkedin_connected")) {
      setNotice(D.pgLinkedinConnected);
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
    if (kind === "disconnect" && !window.confirm(t("connections.pgConfirmDisconnect", { name: account.displayName }))) return;
    setBusy(account.id);
    try {
      if (kind === "default") {
        await apiFetch(`organizations/${orgId}/connections/${account.id}/default`, { method: "PATCH" });
        setNotice(t("connections.pgNowDefault", { name: account.displayName }));
      } else {
        await apiFetch(`organizations/${orgId}/connections/${account.id}/disconnect`, { method: "POST" });
        setNotice(t("connections.pgDisconnected", { name: account.displayName }));
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.gwActionFailed);
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
        <h1 className="text-xl font-bold text-slate-900">{D.pgTitle}</h1>
        <p className="mt-1 text-sm text-slate-500">{D.pgIntro}</p>
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
          <span>{D.pgSummaryTotal}<b>{fmtNumber(locale, overview.summary.totalAccounts)}</b></span>
          <span>{D.pgSummaryConnected}<b className="text-green-700">{fmtNumber(locale, overview.summary.connectedAccounts)}</b></span>
          <span>{D.pgSummaryErrors}<b className="text-red-600">{fmtNumber(locale, overview.summary.errorAccounts)}</b></span>
          {(overview.summary.unreadAlerts ?? 0) > 0 ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">{t("connections.pgUnreadAlerts", { count: fmtNumber(locale, overview.summary.unreadAlerts ?? 0) })}</span>
          ) : null}
          <span className="flex flex-wrap gap-1.5">
            {overview.categories.map((c) => (
              <span key={c.key} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {CATEGORY_ICONS[c.key] ?? "🧩"} {c.label}: {fmtNumber(locale, c.connectedCount)}/{fmtNumber(locale, c.totalCount)}
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
          placeholder={D.pgSearchPh}
          className="min-w-56 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-indigo-400"
        />
        <select
          aria-label={D.pgAriaGroupFilter}
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600 outline-none focus:border-indigo-400"
        >
          <option value="">{D.pgAllGroups}</option>
          {groupNames.map((name) => (
            <option key={name} value={name}>📁 {name}</option>
          ))}
          <option value={UNGROUPED_FILTER}>{D.pgUngroupedOpt}</option>
        </select>
        <datalist id="cc-group-names">
          {groupNames.map((name) => <option key={name} value={name} />)}
        </datalist>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">{D.pgOwnAppTitle}</h2>
          <p className="mt-1 text-sm text-slate-500">{D.pgOwnAppIntro}</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <OwnAppCard
            anchorId="own-meta-form"
            icon="🔷"
            title={D.pgOwnMetaTitle}
            idLabel="Meta App ID"
            secretLabel="Meta App Secret"
            config={metaAppConfig}
            busy={busy}
            note={D.pgOwnMetaNote}
            onSave={(appId, appSecret) => void saveAppConfig("meta", appId, appSecret)}
            onDelete={() => void deleteAppConfig("meta")}
          />
          <OwnAppCard
            anchorId="own-tiktok-form"
            icon="🎵"
            title={D.pgOwnTiktokTitle}
            idLabel="TikTok Client Key"
            secretLabel="TikTok Client Secret"
            config={tiktokAppConfig}
            busy={busy}
            verifyBeforeSave={false}
            note={t("connections.pgOwnTiktokNote", { url: `${publicApiBase()}/social/oauth/tiktok/callback` })}
            onSave={(appId, appSecret) => void saveAppConfig("tiktok", appId, appSecret)}
            onDelete={() => void deleteAppConfig("tiktok")}
          />
          <OwnAppCard
            anchorId="own-google-form"
            icon="🔍"
            title={D.pgOwnGoogleTitle}
            idLabel="Google Client ID"
            secretLabel="Google Client Secret"
            config={googleAppConfig}
            busy={busy}
            verifyBeforeSave={false}
            note={t("connections.pgOwnGoogleNote", { uris: googleRedirectUris.length ? ` ${googleRedirectUris.join(" · ")}` : D.pgUrisNotLoaded })}
            onSave={(appId, appSecret) => void saveAppConfig("google", appId, appSecret)}
            onDelete={() => void deleteAppConfig("google")}
          />
          <OwnAppCard
            anchorId="own-linkedin-form"
            icon="💼"
            title={D.pgOwnLinkedinTitle}
            idLabel="LinkedIn Client ID"
            secretLabel="LinkedIn Client Secret"
            config={linkedinAppConfig}
            busy={busy}
            verifyBeforeSave={false}
            note={t("connections.pgOwnLinkedinNote", { uris: linkedinRedirectUris.length ? ` ${linkedinRedirectUris.join(" · ")}` : D.pgUrisNotLoaded })}
            onSave={(appId, appSecret) => void saveAppConfig("linkedin", appId, appSecret)}
            onDelete={() => void deleteAppConfig("linkedin")}
          />
          <OwnAppCard
            anchorId="own-threads-form"
            icon="🧵"
            title={D.pgOwnThreadsTitle}
            idLabel="Threads App ID"
            secretLabel="Threads App Secret"
            config={threadsAppConfig}
            busy={busy}
            verifyBeforeSave={false}
            note={t("connections.pgOwnThreadsNote", { uris: threadsRedirectUris.length ? ` ${threadsRedirectUris.join(" · ")}` : D.pgUrisNotLoaded })}
            onSave={(appId, appSecret) => void saveAppConfig("threads", appId, appSecret)}
            onDelete={() => void deleteAppConfig("threads")}
          />
        </div>
        <div className="card flex flex-wrap items-center gap-2 p-4">
          <span className="text-sm font-semibold text-slate-700">{D.pgPickAppLabel}</span>
          <a href="#cc-forms-messaging" className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">{D.pgMsgPlatform}</a>
          {metaAppConfig ? (
            <a href="/dashboard/connections?appSource=own#cc-forms-messaging" className="rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-200">{D.pgMsgOwn}</a>
          ) : (
            <a href="#own-meta-form" className="rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-600 hover:bg-violet-100">{D.pgMsgOwnConfigure}</a>
          )}
          <button type="button" disabled={busy === "tiktok-platform"} onClick={() => void tiktokConnect("platform")} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">{D.pgTiktokPlatform}</button>
          {tiktokAppConfig ? (
            <button type="button" disabled={busy === "tiktok-own"} onClick={() => void tiktokConnect("own")} className="rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-200 disabled:opacity-50">{D.pgTiktokOwn}</button>
          ) : (
            <a href="#own-tiktok-form" className="rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-600 hover:bg-violet-100">{D.pgTiktokConfigure}</a>
          )}
          <button type="button" disabled={busy === "threads-platform"} onClick={() => void threadsConnect("platform")} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">{D.pgThreadsPlatform}</button>
          {threadsAppConfig ? (
            <button type="button" disabled={busy === "threads-own"} onClick={() => void threadsConnect("own")} className="rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-200 disabled:opacity-50">{D.pgThreadsOwn}</button>
          ) : (
            <a href="#own-threads-form" className="rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-600 hover:bg-violet-100">{D.pgThreadsConfigure}</a>
          )}
        </div>
      </section>

      <GoogleLinkedInPanel />

      {!overview && !error ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : null}

      {overview && visible.length === 0 ? (
        <EmptyState title={D.pgEmptyTitle} description={D.pgEmptyDesc} />
      ) : null}

      {visible.map((category) => (
        <section key={category.key} id={`cat-${category.key}`} className="scroll-mt-24 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-800">
              {CATEGORY_ICONS[category.key] ?? "🧩"} {category.label}
              <span className="ml-2 text-xs font-medium text-slate-400">{categoryStatusLabel(category, locale)}</span>
            </h2>
            {["commerce", "courier", "messaging", "senders", "ai", "payment"].includes(category.key) ? (
              <a href={`#cc-forms-${category.key}`} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">
                {D.pgConnectHere}
              </a>
            ) : (
              <Link href={category.deepLink} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">
                {category.totalCount === 0 ? D.pgConnect : D.pgManage}
              </Link>
            )}
          </div>
          {category.note && CATEGORY_NOTE_KEYS[category.note] ? (
            <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-500 ring-1 ring-inset ring-slate-100">{D[CATEGORY_NOTE_KEYS[category.note] as keyof typeof D]}</p>
          ) : null}
          {category.accounts.length > 0 ? (
            <div className="space-y-4">
              {groupAccounts(category.accounts).map((group) => (
                <div key={group.groupName ?? "__ungrouped"} className="space-y-2">
                  {groupNames.length > 0 ? (
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      {group.groupName ? `📁 ${group.groupName}` : D.pgUngroupedOpt}
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

      <section className="space-y-3" aria-label={D.pgMarketAria}>
        <div>
          <h2 className="font-semibold text-slate-800">{D.pgMarketTitle}</h2>
          <p className="mt-1 text-sm text-slate-500">{D.pgMarketIntro}</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {marketplaceNotes(locale).map((note) => (
            <div key={note.provider} className="card space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-800">{note.icon} {note.name}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{D.pgMarketDecision}</span>
              </div>
              <p className="text-[13px] font-medium text-slate-600">{note.summary}</p>
              <p className="text-[13px] text-slate-500">{note.reason}</p>
              <p className="text-[13px] text-slate-500"><b>{D.pgRevisitLabel}</b> {note.revisit}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="cc-forms-messaging" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">{D.pgSecMessagingTitle}</h2>
          <p className="mt-1 text-sm text-slate-500">{D.pgSecMessagingIntro}</p>
        </div>
        <MessagingConnectPanel onChanged={() => void load()} />
      </section>

      <section id="cc-forms-commerce" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">{D.pgSecCommerceTitle}</h2>
          <p className="mt-1 text-sm text-slate-500">{D.pgSecCommerceIntro}</p>
        </div>
        <CommerceConnectPanel onChanged={() => void load()} />
      </section>

      <section id="cc-forms-courier" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">{D.pgSecCourierTitle}</h2>
          <p className="mt-1 text-sm text-slate-500">{D.pgSecCourierIntro}</p>
        </div>
        <CourierConnectPanel onChanged={() => void load()} />
      </section>

      <section id="cc-forms-senders" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">{D.pgSecSendersTitle}</h2>
          <p className="mt-1 text-sm text-slate-500">{D.pgSecSendersIntro}</p>
        </div>
        <SenderConnectPanel onChanged={() => void load()} />
      </section>

      <section id="cc-forms-ai" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">{D.pgSecAiTitle}</h2>
          <p className="mt-1 text-sm text-slate-500">{D.pgSecAiIntro}</p>
        </div>
        <LlmConfigPanel onChanged={() => void load()} />
      </section>

      <section id="cc-forms-payment" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">{D.pgSecPaymentTitle}</h2>
          <p className="mt-1 text-sm text-slate-500">{D.pgSecPaymentIntro}</p>
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
          <h2 className="font-semibold text-slate-800">{D.pgSecAttemptsTitle}</h2>
          <p className="mt-1 text-sm text-slate-500">{D.pgSecAttemptsIntro}</p>
        </div>
        <PaymentAttemptsPanel />
      </section>
    </div>
  );
}
