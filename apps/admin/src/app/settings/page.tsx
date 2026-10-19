"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { ErrorState, PageHead, askConfirm, askInput, toast } from "@/components/ui";
import { apiFetch, formatMinorStr } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { fmtNumber } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

interface Settings {
  maintenanceMode: boolean; signupOpen: boolean; supportContact: string;
  killSwitches: { aiDisabledOrgIds: string[]; broadcastsPaused: boolean };
  planPrices: Record<string, number>;
  planYearlyPrices: Record<string, number>;
  planLimits: Record<string, { aiDaily: number; broadcastCap: number; seats: number; productLimit?: number; orderLimit?: number; storageLimitMb?: number; apiDailyLimit?: number }>;
  planLimitsStored: Record<string, { aiDaily?: number; broadcastCap?: number; seats?: number; productLimit?: number; orderLimit?: number; storageLimitMb?: number; apiDailyLimit?: number }> | null;
  // ORG12 (OB4): per-user owned-org cap; null = no limit.
  maxOrgsPerUser?: number | null;
}
interface Announcement { id: string; title: string; body: string; audience?: string; active: boolean; startsAt?: string | null; endsAt?: string | null; createdAt: string }
const AUDIENCE_KEYS: { value: string; labelKey?: string; plan?: string }[] = [
  { value: "all", labelKey: "settings.audAll" }, { value: "trialing", labelKey: "settings.audTrialing" }, { value: "past_due", labelKey: "settings.audPastDue" },
  { value: "plan_FREE", plan: "FREE" }, { value: "plan_STARTER", plan: "STARTER" }, { value: "plan_GROWTH", plan: "GROWTH" }, { value: "plan_AGENCY", plan: "AGENCY" },
];

// ADX9: Config Hub sections. Settled §৭ decision: ONE page, in-page
// sub-nav + hash deep-links, no new routes. Every block that exists
// on this page maps to exactly one section (see the DB3 acceptance
// doc for the full mapping table).
const SECTION_IDS = ["general", "ai", "apps", "messaging", "payment", "flags", "announce"];
const BLOCK_SECTION: Record<string, string> = {
  "config-llm": "ai", "config-image": "ai",
  "config-meta": "apps", "config-tiktok": "apps", "config-google": "apps", "config-google-sso": "apps", "config-linkedin": "apps", "config-threads": "apps",
  "config-smtp": "messaging", "config-sms": "messaging",
  "config-sslcommerz": "payment", "config-bkash": "payment", "config-wallet": "payment", "config-stripe": "payment",
};
const HASH_ALIAS: Record<string, string> = {
  "ai-llm": "config-llm", "ai-image": "config-image",
  "apps-meta": "config-meta", "apps-tiktok": "config-tiktok", "apps-google": "config-google", "apps-google-sso": "config-google-sso", "apps-linkedin": "config-linkedin", "apps-threads": "config-threads",
  "messaging-smtp": "config-smtp", "messaging-sms": "config-sms",
  "payment-sslcommerz": "config-sslcommerz", "payment-bkash": "config-bkash", "payment-wallet": "config-wallet", "payment-stripe": "config-stripe",
};

interface PlatformConfigView {
  llm: { source: string; provider: string | null; model: string | null; secretConfigured: boolean };
  metaApp: { source: string; appId: string | null; graphVersion: string | null; appSecretConfigured: boolean; adLibraryTokenConfigured: boolean };
  smtp: { source: string; host: string | null; port: number; user: string | null; from: string | null; secretConfigured: boolean };
  sms: { source: string; senderId: string | null; apiUrl: string | null; secretConfigured: boolean };
  sslcommerz: { source: string; storeId: string | null; sandbox: boolean; secretConfigured: boolean };
  bkash: { source: string; appKey: string | null; username: string | null; sandbox: boolean; secretConfigured: boolean };
  // OU5: platform Stripe (subscription billing card rail).
  stripe?: { source: string; publishableKey: string | null; mode: string | null; secretConfigured: boolean; webhookSecretConfigured: boolean };
  image: { source: string; provider: string | null; model: string | null; secretConfigured: boolean };
  tiktokApp: { source: string; clientKey: string | null; redirectUri: string | null; audited: boolean; secretConfigured: boolean };
  googleApp: { source: string; clientId: string | null; redirectUri: string | null; secretConfigured: boolean; gbpApiAccessApproved?: boolean };
  linkedinApp: { source: string; clientId: string | null; redirectUri: string | null; secretConfigured: boolean };
  // AB8 (AX26): Google SSO staff login — separate OAuth client from
  // the YouTube googleApp above. Optional in the type only so this
  // page keeps rendering while the API section rolls out.
  googleOAuth?: { source?: string; clientId: string | null; secretConfigured: boolean; enabled: boolean };
  threadsApp: { source: string; clientId: string | null; redirectUri: string | null; secretConfigured: boolean };
  wallet: { source: string; feeBps: number; payoutFourEyesThresholdMinor: number | null };
  note: string;
}

// ADNX13: config area → its block id, for dirty tracking and for
// re-baselining a block after its own save/clear succeeds.
const AREA_BLOCK: Record<string, string> = {
  llm: "config-llm", image: "config-image", meta: "config-meta", tiktok: "config-tiktok",
  google: "config-google", linkedin: "config-linkedin", smtp: "config-smtp", sms: "config-sms",
  sslcommerz: "config-sslcommerz", bkash: "config-bkash", wallet: "config-wallet", stripe: "config-stripe",
};

function PlatformConfigSection({ setMsg, section, highlightId, reportDirty }: { setMsg: (m: string) => void; section: string; highlightId: string | null; reportDirty: (key: string, dirty: boolean) => void }) {
  const { dict, locale, t } = useAdminLocale();
  const S = dict.settings;
  const [cfg, setCfg] = React.useState<PlatformConfigView | null>(null);
  const [busy, setBusy] = React.useState("");
  // ADX12: config-load failure state — before, the whole config
  // hub silently vanished (the section returned null) on failure.
  const [cfgFailed, setCfgFailed] = React.useState(false);
  const loadCfg = React.useCallback(async () => {
    const v = await apiFetch<PlatformConfigView>("/admin/platform-config").catch(() => null);
    setCfgFailed(v === null);
    if (v) setCfg(v);
  }, []);
  React.useEffect(() => { loadCfg(); }, [loadCfg]);
  // ADNX13: unsaved-changes tracking for the UNCONTROLLED config
  // blocks. The blocks read their inputs from the DOM at save
  // time (unchanged), so dirty state is derived from the DOM too:
  // a per-block baseline of field values is captured when the
  // config first loads, a delegated input/change listener
  // re-derives the edited block's dirty flag, and a successful
  // save/clear re-baselines only its own block. The Test buttons
  // never clear dirty. Test-recipient inputs (…-test-to) are not
  // config values and are excluded.
  const baselineRef = React.useRef<Map<string, Map<string, string>>>(new Map());
  const readBlock = React.useCallback((blockId: string) => {
    const map = new Map<string, string>();
    const root = document.getElementById(blockId);
    if (root) root.querySelectorAll("input, select, textarea").forEach((el) => {
      const input = el as HTMLInputElement;
      if (!input.id || input.id.endsWith("-test-to")) return;
      map.set(input.id, input.type === "checkbox" ? (input.checked ? "1" : "0") : input.value);
    });
    return map;
  }, []);
  const blockIsDirty = React.useCallback((blockId: string) => {
    const base = baselineRef.current.get(blockId);
    if (!base) return false;
    const now = readBlock(blockId);
    for (const [k, v] of now) if (base.get(k) !== v) return true;
    for (const k of base.keys()) if (!now.has(k)) return true;
    return false;
  }, [readBlock]);
  React.useEffect(() => {
    if (!cfg) return;
    for (const id of Object.keys(BLOCK_SECTION)) {
      if (!baselineRef.current.has(id)) { baselineRef.current.set(id, readBlock(id)); reportDirty(id, false); }
    }
  }, [cfg, readBlock, reportDirty]);
  React.useEffect(() => {
    const handler = (e: Event) => {
      const block = (e.target as HTMLElement | null)?.closest?.('[id^="config-"]') as HTMLElement | null;
      if (block) reportDirty(block.id, blockIsDirty(block.id));
    };
    document.addEventListener("input", handler);
    document.addEventListener("change", handler);
    return () => { document.removeEventListener("input", handler); document.removeEventListener("change", handler); };
  }, [blockIsDirty, reportDirty]);
  // ADX9: a hash deep-link (#payment-bkash) scrolls its block into
  // view once the config has loaded and its section is visible.
  React.useEffect(() => {
    if (!cfg || !highlightId) return;
    const t = setTimeout(() => document.getElementById(highlightId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    return () => clearTimeout(t);
  }, [cfg, highlightId]);
  async function patch(area: string, body: Record<string, unknown>, ok: string) {
    setBusy(area);
    try {
      setCfg(await apiFetch<PlatformConfigView>(`/admin/platform-config/${area}`, { method: "PATCH", body: JSON.stringify(body) })); setMsg(ok);
      // ADNX13: this block's edits are now saved — re-baseline it
      // (the DOM still holds exactly what was sent; other blocks'
      // baselines and dirty flags are untouched).
      const blockId = AREA_BLOCK[area];
      if (blockId) { baselineRef.current.set(blockId, readBlock(blockId)); reportDirty(blockId, false); }
    }
    catch (e) { setMsg(`❌ ${e instanceof Error ? e.message : dict.common.failed}`); }
    finally { setBusy(""); }
  }
  async function test(kind: "test-llm" | "test-email" | "test-sms" | "test-image", to?: string) {
    setBusy(kind);
    try {
      const out = await apiFetch<any>(`/admin/platform-config/${kind}`, { method: "POST", body: JSON.stringify(to ? { to } : {}) });
      setMsg(t("settings.testSuccess", { detail: kind === "test-llm" ? `${out.provider} / ${out.model} (${fmtNumber(locale, out.latencyMs)}ms)` : kind === "test-image" ? `${out.provider} / ${out.model} — ${fmtNumber(locale, out.bytes)} bytes (${fmtNumber(locale, out.latencyMs)}ms)` : `Message ID: ${out.providerMessageId}` }));
    } catch (e) { setMsg(`❌ ${e instanceof Error ? e.message : S.testFailedFallback}`); }
    finally { setBusy(""); }
  }
  async function testConfig(kind: "test-meta" | "test-sslcommerz" | "test-bkash" | "test-tiktok" | "test-google" | "test-linkedin" | "test-threads" | "test-stripe") {
    setBusy(kind);
    try {
      const out = await apiFetch<any>(`/admin/platform-config/${kind}`, { method: "POST", body: "{}" });
      setMsg(out.ok ? t("settings.verifySuccess", { detail: out.detail, ms: fmtNumber(locale, out.latencyMs) }) : `❌ ${t("settings.verifyFailed", { detail: out.detail })}`);
    } catch (e) { setMsg(`❌ ${e instanceof Error ? e.message : S.verifyFailedFallback}`); }
    finally { setBusy(""); }
  }
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
  const secretPh = (set: boolean) => (set ? S.secretSetPlaceholder : S.secretNotSetPlaceholder);
  const hubHidden = !["ai", "apps", "messaging", "payment"].includes(section);
  if (!cfg) return (
    <div className={`mt-4 ${hubHidden ? "hidden" : ""}`}>
      {cfgFailed
        ? <ErrorState message={S.configLoadError} onRetry={loadCfg} />
        : <div className="askel-table" />}
    </div>
  );
  const srcBadge = (src: string) => src === "admin" ? <span className="abadge-green">{S.srcAdmin}</span> : src === "env" ? <span className="abadge-amber">{S.srcEnv}</span> : <span className="abadge-red">{S.srcNone}</span>;
  return (
    <div className={`mt-4 space-y-4 ${hubHidden ? "hidden" : ""}`}>
      <div>
        <h2 className="text-lg font-semibold">{S.configTitle}</h2>
        <p className="text-sm text-slate-400">{S.configNote}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
      <div className={`grid gap-4 lg:grid-cols-2 ${section === "ai" ? "" : "hidden"}`}>
        <div id="config-llm" className={"acard space-y-3 scroll-mt-24 " + (highlightId === "config-llm" ? "ring-2 ring-indigo-400" : "")}>
          <div className="flex items-center justify-between"><span className="font-semibold">{S.llmTitle}</span>{srcBadge(cfg.llm.source)}</div>
          <label className="block text-sm">{S.providerLabel}
            <select id="pc-llm-provider" className="ainput mt-1" defaultValue={cfg.llm.provider ?? ""}>
              <option value="">{S.llmNoProvider}</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option>
            </select></label>
          <label className="block text-sm">{S.modelLabel}<input id="pc-llm-model" className="ainput mt-1" defaultValue={cfg.llm.model ?? ""} placeholder={S.modelPlaceholderLlm} /></label>
          <label className="block text-sm">{S.apiKeyLabel}<input id="pc-llm-key" type="password" className="ainput mt-1" placeholder={secretPh(cfg.llm.secretConfigured)} /></label>
          <div className="flex flex-wrap gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("llm", { provider: val("pc-llm-provider"), model: val("pc-llm-model"), apiKey: val("pc-llm-key") || undefined }, S.llmSaved)}>{S.saveSettings}</button>
            <button className="abtn-secondary" disabled={busy !== ""} onClick={() => test("test-llm")}>{busy === "test-llm" ? S.testing : S.llmTestButton}</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("llm", { clear: true }, S.llmCleared)}>{S.clearAdminSetting}</button>
          </div>
          <p className="text-xs text-slate-400">{S.llmNote}</p>
        </div>
        <div id="config-image" className={"acard space-y-3 scroll-mt-24 " + (highlightId === "config-image" ? "ring-2 ring-indigo-400" : "")}>
          <div className="flex items-center justify-between"><span className="font-semibold">{S.imageTitle}</span>{srcBadge(cfg.image.source)}</div>
          <label className="block text-sm">{S.providerLabel}
            <select id="pc-image-provider" className="ainput mt-1" defaultValue={cfg.image.provider ?? ""}>
              <option value="">{S.imageNoProvider}</option><option value="gemini">Gemini</option>
            </select></label>
          <label className="block text-sm">{S.modelLabel}<input id="pc-image-model" className="ainput mt-1" defaultValue={cfg.image.model ?? ""} placeholder="gemini-2.5-flash-image" /></label>
          <label className="block text-sm">{S.apiKeyLabel}<input id="pc-image-key" type="password" className="ainput mt-1" placeholder={secretPh(cfg.image.secretConfigured)} /></label>
          <div className="flex flex-wrap gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("image", { provider: val("pc-image-provider"), model: val("pc-image-model"), apiKey: val("pc-image-key") || undefined }, S.imageSaved)}>{S.saveSettings}</button>
            <button className="abtn-secondary" disabled={busy !== ""} onClick={() => test("test-image")}>{busy === "test-image" ? S.testing : S.imageTestButton}</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("image", { clear: true }, S.imageCleared)}>{S.clearAdminSetting}</button>
          </div>
          <p className="text-xs text-slate-400">{S.imageNote}</p>
        </div>
      </div>
      <div className={`grid gap-4 lg:grid-cols-2 ${section === "apps" ? "" : "hidden"}`}>
        <div id="config-meta" className={"acard space-y-3 scroll-mt-24 " + (highlightId === "config-meta" ? "ring-2 ring-indigo-400" : "")}>
          <div className="flex items-center justify-between"><span className="font-semibold">{S.metaTitle}</span>{srcBadge(cfg.metaApp.source)}</div>
          <label className="block text-sm">{S.appIdLabel}<input id="pc-meta-appid" className="ainput mt-1" defaultValue={cfg.metaApp.appId ?? ""} /></label>
          <label className="block text-sm">{S.appSecret}<input id="pc-meta-secret" type="password" className="ainput mt-1" placeholder={secretPh(cfg.metaApp.appSecretConfigured)} /></label>
          <label className="block text-sm">{S.adLibraryLabel}<input id="pc-meta-adlib" type="password" className="ainput mt-1" placeholder={secretPh(cfg.metaApp.adLibraryTokenConfigured)} /></label>
          <label className="block text-sm">{S.graphVersionLabel}<input id="pc-meta-version" className="ainput mt-1" defaultValue={cfg.metaApp.graphVersion ?? "v21.0"} /></label>
          <div className="flex flex-wrap gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("meta", { appId: val("pc-meta-appid"), appSecret: val("pc-meta-secret") || undefined, adLibraryToken: val("pc-meta-adlib") || undefined, graphVersion: val("pc-meta-version") }, S.metaSaved)}>{S.saveSettings}</button>
            <button className="abtn-secondary" disabled={busy !== ""} onClick={() => testConfig("test-meta")}>{busy === "test-meta" ? S.verifying : S.verifyButton}</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("meta", { clear: true }, S.metaCleared)}>{S.clearShort}</button>
          </div>
          <p className="text-xs text-slate-400">{S.metaNote}</p>
        </div>
        <div id="config-tiktok" className={"acard space-y-3 scroll-mt-24 " + (highlightId === "config-tiktok" ? "ring-2 ring-indigo-400" : "")}>
          <div className="flex items-center justify-between"><span className="font-semibold">{S.tiktokTitle}</span>{srcBadge(cfg.tiktokApp.source)}</div>
          <label className="block text-sm">{S.clientKey}<input id="pc-tt-key" className="ainput mt-1" defaultValue={cfg.tiktokApp.clientKey ?? ""} placeholder={S.tiktokClientKeyPh} /></label>
          <label className="block text-sm">{S.clientSecret}<input id="pc-tt-secret" type="password" className="ainput mt-1" placeholder={secretPh(cfg.tiktokApp.secretConfigured)} /></label>
          <label className="block text-sm">{S.redirectUriOptional}<input id="pc-tt-redirect" className="ainput mt-1" defaultValue={cfg.tiktokApp.redirectUri ?? ""} placeholder="https://api.qosprey.com/social/oauth/tiktok/callback" /></label>
          <label className="flex items-center gap-2 text-sm">
            <input id="pc-tt-audited" type="checkbox" defaultChecked={cfg.tiktokApp.audited} />
            {S.tiktokAudited}
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("tiktok", { clientKey: val("pc-tt-key"), clientSecret: val("pc-tt-secret") || undefined, redirectUri: val("pc-tt-redirect"), audited: (document.getElementById("pc-tt-audited") as HTMLInputElement)?.checked ?? false }, S.tiktokSaved)}>{S.saveSettings}</button>
            <button className="abtn-secondary" disabled={busy !== ""} onClick={() => testConfig("test-tiktok")}>{busy === "test-tiktok" ? S.verifying : S.verifyButton}</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("tiktok", { clear: true }, S.tiktokCleared)}>{S.clearShort}</button>
          </div>
          <p className="text-xs text-slate-400">{S.tiktokNoteA}<code>https://api.qosprey.com/social/oauth/tiktok/callback</code>{S.tiktokNoteB}</p>
        </div>
        <div id="config-google" className={"acard space-y-3 scroll-mt-24 " + (highlightId === "config-google" ? "ring-2 ring-indigo-400" : "")}>
          <div className="flex items-center justify-between"><span className="font-semibold">{S.googleTitle}</span>{srcBadge(cfg.googleApp.source)}</div>
          <label className="block text-sm">{S.clientId}<input id="pc-gg-id" className="ainput mt-1" defaultValue={cfg.googleApp.clientId ?? ""} placeholder={S.googleClientIdPh} /></label>
          <label className="block text-sm">{S.clientSecret}<input id="pc-gg-secret" type="password" className="ainput mt-1" placeholder={secretPh(cfg.googleApp.secretConfigured)} /></label>
          <label className="block text-sm">{S.redirectUriOptional}<input id="pc-gg-redirect" className="ainput mt-1" defaultValue={cfg.googleApp.redirectUri ?? ""} placeholder="https://api.qosprey.com/social/oauth/youtube/callback" /></label>
          <label className="flex items-center gap-2 text-sm">
            <input id="pc-gg-gbp-approved" type="checkbox" defaultChecked={cfg.googleApp.gbpApiAccessApproved ?? false} />
            <span>{S.gbpApproved}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("google", { clientId: val("pc-gg-id"), clientSecret: val("pc-gg-secret") || undefined, redirectUri: val("pc-gg-redirect"), gbpApiAccessApproved: (document.getElementById("pc-gg-gbp-approved") as HTMLInputElement)?.checked ?? false }, S.googleSaved)}>{S.saveSettings}</button>
            <button className="abtn-secondary" disabled={busy !== ""} onClick={() => testConfig("test-google")}>{busy === "test-google" ? S.verifying : S.verifyButton}</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("google", { clear: true }, S.googleCleared)}>{S.clearShort}</button>
          </div>
          <p className="text-xs text-slate-400">{S.googleNote1A}<code>https://api.qosprey.com/social/oauth/youtube/callback</code>{S.googleNote1B}</p>
          <p className="text-xs text-slate-400">{S.googleNote2A}<code>https://api.qosprey.com/social/oauth/google-ga4/callback</code>{S.googleNote2B}<code>https://api.qosprey.com/social/oauth/google-merchant/callback</code>{S.googleNote2C}<code>https://api.qosprey.com/social/oauth/google-business/callback</code>{S.googleNote2D}</p>
          <p className="text-xs text-slate-400">{S.googleNote3A}<code>https://api.qosprey.com/social/oauth/google-business-profile/callback</code>{S.googleNote3B}</p>
        </div>
        <div id="config-google-sso" className={"acard space-y-3 scroll-mt-24 " + (highlightId === "config-google-sso" ? "ring-2 ring-indigo-400" : "")}>
          <div className="flex items-center justify-between"><span className="font-semibold">{S.googleSsoTitle}</span><span className="flex items-center gap-2">{cfg.googleOAuth?.source ? srcBadge(cfg.googleOAuth.source) : null}{(cfg.googleOAuth?.enabled ?? false) ? <span className="abadge-green">{S.enabledBadge}</span> : <span className="abadge-red">{S.disabledBadge}</span>}</span></div>
          <label className="block text-sm">{S.clientId}<input id="pc-gso-id" className="ainput mt-1" defaultValue={cfg.googleOAuth?.clientId ?? ""} placeholder={S.googleSsoClientIdPh} /></label>
          <label className="block text-sm">{S.clientSecret}<input id="pc-gso-secret" type="password" className="ainput mt-1" placeholder={secretPh(cfg.googleOAuth?.secretConfigured ?? false)} /></label>
          <label className="flex items-center gap-2 text-sm">
            <input id="pc-gso-enabled" type="checkbox" defaultChecked={cfg.googleOAuth?.enabled ?? false} />
            {S.googleSsoEnabled}
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("google-oauth", { clientId: val("pc-gso-id"), clientSecret: val("pc-gso-secret") || undefined, enabled: (document.getElementById("pc-gso-enabled") as HTMLInputElement)?.checked ?? false }, S.googleSsoSaved)}>{S.saveSettings}</button>
          </div>
          <p className="text-xs text-slate-500">{S.googleSsoNoteA}<code>https://api.qosprey.com/auth/google/callback</code>{S.googleSsoNoteB}<code>&lt;API_PUBLIC_URL&gt;/auth/google/callback</code>{S.googleSsoNoteC}</p>
        </div>
        <div id="config-google-sso" className={"acard space-y-3 scroll-mt-24 " + (highlightId === "config-google-sso" ? "ring-2 ring-indigo-400" : "")}>
          <div className="flex items-center justify-between"><span className="font-semibold">{S.googleSsoTitle}</span><span className="flex items-center gap-2">{cfg.googleOAuth?.source ? srcBadge(cfg.googleOAuth.source) : null}{(cfg.googleOAuth?.enabled ?? false) ? <span className="abadge-green">{S.enabledBadge}</span> : <span className="abadge-red">{S.disabledBadge}</span>}</span></div>
          <label className="block text-sm">{S.clientId}<input id="pc-gso-id" className="ainput mt-1" defaultValue={cfg.googleOAuth?.clientId ?? ""} placeholder={S.googleSsoClientIdPh} /></label>
          <label className="block text-sm">{S.clientSecret}<input id="pc-gso-secret" type="password" className="ainput mt-1" placeholder={secretPh(cfg.googleOAuth?.secretConfigured ?? false)} /></label>
          <label className="flex items-center gap-2 text-sm">
            <input id="pc-gso-enabled" type="checkbox" defaultChecked={cfg.googleOAuth?.enabled ?? false} />
            {S.googleSsoEnabled}
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("google-oauth", { clientId: val("pc-gso-id"), clientSecret: val("pc-gso-secret") || undefined, enabled: (document.getElementById("pc-gso-enabled") as HTMLInputElement)?.checked ?? false }, S.googleSsoSaved)}>{S.saveSettings}</button>
          </div>
          <p className="text-xs text-slate-500">{S.googleSsoNoteA}<code>https://api.qosprey.com/auth/google/callback</code>{S.googleSsoNoteB}<code>&lt;API_PUBLIC_URL&gt;/auth/google/callback</code>{S.googleSsoNoteC}</p>
        </div>
        <div id="config-linkedin" className={"acard space-y-3 scroll-mt-24 " + (highlightId === "config-linkedin" ? "ring-2 ring-indigo-400" : "")}>
          <div className="flex items-center justify-between"><span className="font-semibold">{S.linkedinTitle}</span>{srcBadge(cfg.linkedinApp.source)}</div>
          <label className="block text-sm">{S.clientId}<input id="pc-li-id" className="ainput mt-1" defaultValue={cfg.linkedinApp.clientId ?? ""} placeholder={S.linkedinClientIdPh} /></label>
          <label className="block text-sm">{S.clientSecret}<input id="pc-li-secret" type="password" className="ainput mt-1" placeholder={secretPh(cfg.linkedinApp.secretConfigured)} /></label>
          <label className="block text-sm">{S.redirectUriOptional}<input id="pc-li-redirect" className="ainput mt-1" defaultValue={cfg.linkedinApp.redirectUri ?? ""} placeholder="https://api.qosprey.com/social/oauth/linkedin/callback" /></label>
          <div className="flex flex-wrap gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("linkedin", { clientId: val("pc-li-id"), clientSecret: val("pc-li-secret") || undefined, redirectUri: val("pc-li-redirect") }, S.linkedinSaved)}>{S.saveSettings}</button>
            <button className="abtn-secondary" disabled={busy !== ""} onClick={() => testConfig("test-linkedin")}>{busy === "test-linkedin" ? S.verifying : S.verifyButton}</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("linkedin", { clear: true }, S.linkedinCleared)}>{S.clearShort}</button>
          </div>
          <p className="text-xs text-slate-400">{S.linkedinNoteA}<code>https://api.qosprey.com/social/oauth/linkedin/callback</code>{S.linkedinNoteB}<b>Community Management API</b>{S.linkedinNoteC}</p>
        </div>
        <div id="config-threads" className={"acard space-y-3 scroll-mt-24 " + (highlightId === "config-threads" ? "ring-2 ring-indigo-400" : "")}>
          <div className="flex items-center justify-between"><span className="font-semibold">{S.threadsTitle}</span>{srcBadge(cfg.threadsApp.source)}</div>
          <label className="block text-sm">{S.threadsAppId}<input id="pc-th-id" className="ainput mt-1" defaultValue={cfg.threadsApp.clientId ?? ""} placeholder={S.threadsAppIdPh} /></label>
          <label className="block text-sm">{S.threadsAppSecret}<input id="pc-th-secret" type="password" className="ainput mt-1" placeholder={secretPh(cfg.threadsApp.secretConfigured)} /></label>
          <label className="block text-sm">{S.redirectUriOptional}<input id="pc-th-redirect" className="ainput mt-1" defaultValue={cfg.threadsApp.redirectUri ?? ""} placeholder="https://api.qosprey.com/social/oauth/threads/callback" /></label>
          <div className="flex flex-wrap gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("threads", { clientId: val("pc-th-id"), clientSecret: val("pc-th-secret") || undefined, redirectUri: val("pc-th-redirect") }, S.threadsSaved)}>{S.saveSettings}</button>
            <button className="abtn-secondary" disabled={busy !== ""} onClick={() => testConfig("test-threads")}>{busy === "test-threads" ? S.verifying : S.verifyButton}</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("threads", { clear: true }, S.threadsCleared)}>{S.clearShort}</button>
          </div>
          <p className="text-xs text-slate-500">{S.threadsNoteA}<code>https://api.qosprey.com/social/oauth/threads/callback</code>{S.threadsNoteB}<b>{S.threadsNoteBold1}</b>{S.threadsNoteC}<b>{S.threadsNoteBold2}</b>{S.threadsNoteD}</p>
        </div>
      </div>
      <div className={`grid gap-4 lg:grid-cols-2 ${section === "messaging" ? "" : "hidden"}`}>
        <div id="config-smtp" className={"acard space-y-3 scroll-mt-24 " + (highlightId === "config-smtp" ? "ring-2 ring-indigo-400" : "")}>
          <div className="flex items-center justify-between"><span className="font-semibold">{S.smtpTitle}</span>{srcBadge(cfg.smtp.source)}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">{S.hostLabel}<input id="pc-smtp-host" className="ainput mt-1" defaultValue={cfg.smtp.host ?? ""} /></label>
            <label className="block text-sm">{S.portLabel}<input id="pc-smtp-port" type="number" className="ainput mt-1" defaultValue={cfg.smtp.port} /></label>
          </div>
          <label className="block text-sm">{S.userLabel}<input id="pc-smtp-user" className="ainput mt-1" defaultValue={cfg.smtp.user ?? ""} /></label>
          <label className="block text-sm">{S.passwordLabel}<input id="pc-smtp-pass" type="password" className="ainput mt-1" placeholder={secretPh(cfg.smtp.secretConfigured)} /></label>
          <label className="block text-sm">{S.fromLabel}<input id="pc-smtp-from" className="ainput mt-1" defaultValue={cfg.smtp.from ?? ""} placeholder="noreply@qosprey.com" /></label>
          <div className="flex flex-wrap items-center gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("smtp", { host: val("pc-smtp-host"), port: Number(val("pc-smtp-port")) || 587, user: val("pc-smtp-user"), from: val("pc-smtp-from"), pass: val("pc-smtp-pass") || undefined }, S.smtpSaved)}>{S.saveSettings}</button>
            <input id="pc-email-test-to" className="ainput w-52" placeholder={S.testEmailToPlaceholder} />
            <button className="abtn-secondary" disabled={busy !== ""} onClick={() => test("test-email", val("pc-email-test-to"))}>{S.testEmailButton}</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("smtp", { clear: true }, S.smtpCleared)}>{S.clearShort}</button>
          </div>
        </div>
        <div id="config-sms" className={"acard space-y-3 scroll-mt-24 " + (highlightId === "config-sms" ? "ring-2 ring-indigo-400" : "")}>
          <div className="flex items-center justify-between"><span className="font-semibold">{S.smsTitle}</span>{srcBadge(cfg.sms.source)}</div>
          <label className="block text-sm">{S.senderId}<input id="pc-sms-sender" className="ainput mt-1" defaultValue={cfg.sms.senderId ?? ""} /></label>
          <label className="block text-sm">{S.apiToken}<input id="pc-sms-token" type="password" className="ainput mt-1" placeholder={secretPh(cfg.sms.secretConfigured)} /></label>
          <label className="block text-sm">{S.apiUrl}<input id="pc-sms-url" className="ainput mt-1" defaultValue={cfg.sms.apiUrl ?? "https://smsplus.sslwireless.com"} /></label>
          <div className="flex flex-wrap items-center gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("sms", { senderId: val("pc-sms-sender"), apiUrl: val("pc-sms-url"), apiToken: val("pc-sms-token") || undefined }, S.smsSaved)}>{S.saveSettings}</button>
            <input id="pc-sms-test-to" className="ainput w-44" placeholder="01XXXXXXXXX" />
            <button className="abtn-secondary" disabled={busy !== ""} onClick={() => test("test-sms", val("pc-sms-test-to"))}>{S.testSmsButton}</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("sms", { clear: true }, S.smsCleared)}>{S.clearShort}</button>
          </div>
          <p className="text-xs text-slate-400">{cfg.note}</p>
        </div>
      </div>
      <div className={`grid gap-4 lg:grid-cols-2 ${section === "payment" ? "" : "hidden"}`}>
        <div id="config-sslcommerz" className={"acard space-y-3 scroll-mt-24 " + (highlightId === "config-sslcommerz" ? "ring-2 ring-indigo-400" : "")}>
          <div className="flex items-center justify-between"><span className="font-semibold">{S.sslTitle}</span>{srcBadge(cfg.sslcommerz.source)}</div>
          <label className="block text-sm">{S.storeId}<input id="pc-ssl-store" className="ainput mt-1" defaultValue={cfg.sslcommerz.storeId ?? ""} placeholder={S.sslStoreIdPh} /></label>
          <label className="block text-sm">{S.storePassword}<input id="pc-ssl-pass" type="password" className="ainput mt-1" placeholder={secretPh(cfg.sslcommerz.secretConfigured)} /></label>
          <label className="flex items-center gap-2 text-sm">
            <input id="pc-ssl-sandbox" type="checkbox" defaultChecked={cfg.sslcommerz.sandbox} />
            {S.sandboxMode}
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("sslcommerz", { storeId: val("pc-ssl-store"), storePass: val("pc-ssl-pass") || undefined, sandbox: (document.getElementById("pc-ssl-sandbox") as HTMLInputElement)?.checked ?? true }, S.sslSaved)}>{S.saveSettings}</button>
            <button className="abtn-secondary" disabled={busy !== ""} onClick={() => testConfig("test-sslcommerz")}>{busy === "test-sslcommerz" ? S.verifying : S.verifyButton}</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("sslcommerz", { clear: true }, S.sslCleared)}>{S.clearShort}</button>
          </div>
          <p className="text-xs text-slate-400">{S.sslNoteA}<code>https://api.qosprey.com/public/payments/sslcommerz/ipn</code></p>
        </div>
        <div id="config-bkash" className={"acard space-y-3 scroll-mt-24 " + (highlightId === "config-bkash" ? "ring-2 ring-indigo-400" : "")}>
          <div className="flex items-center justify-between"><span className="font-semibold">{S.bkashTitle}</span>{srcBadge(cfg.bkash.source)}</div>
          <label className="block text-sm">{S.appKey}<input id="pc-bk-key" className="ainput mt-1" defaultValue={cfg.bkash.appKey ?? ""} placeholder={S.bkashAppKeyPh} /></label>
          <label className="block text-sm">{S.username}<input id="pc-bk-user" className="ainput mt-1" defaultValue={cfg.bkash.username ?? ""} placeholder={S.bkashUsernamePh} /></label>
          <label className="block text-sm">{S.appSecret}<input id="pc-bk-secret" type="password" className="ainput mt-1" placeholder={secretPh(cfg.bkash.secretConfigured)} /></label>
          <label className="block text-sm">{S.passwordLabel}<input id="pc-bk-pass" type="password" className="ainput mt-1" placeholder={secretPh(cfg.bkash.secretConfigured)} /></label>
          <label className="flex items-center gap-2 text-sm">
            <input id="pc-bk-sandbox" type="checkbox" defaultChecked={cfg.bkash.sandbox} />
            {S.sandboxShort}
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("bkash", { appKey: val("pc-bk-key"), username: val("pc-bk-user"), appSecret: val("pc-bk-secret") || undefined, password: val("pc-bk-pass") || undefined, sandbox: (document.getElementById("pc-bk-sandbox") as HTMLInputElement)?.checked ?? true }, S.bkashSaved)}>{S.saveSettings}</button>
            <button className="abtn-secondary" disabled={busy !== ""} onClick={() => testConfig("test-bkash")}>{busy === "test-bkash" ? S.verifying : S.verifyButton}</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("bkash", { clear: true }, S.bkashCleared)}>{S.clearShort}</button>
          </div>
          <p className="text-xs text-slate-400">{S.bkashNoteA}<code>https://api.qosprey.com/public/payments/bkash/callback</code>{S.bkashNoteB}</p>
        </div>
        <div id="config-stripe" className={"acard space-y-3 scroll-mt-24 " + (highlightId === "config-stripe" ? "ring-2 ring-indigo-400" : "")}>
          <div className="flex items-center justify-between"><span className="font-semibold">{S.stripeTitle}</span>{srcBadge(cfg.stripe?.source ?? "none")}</div>
          {cfg.stripe?.mode ? <p className="text-xs font-semibold text-slate-500">{t("settings.stripeMode", { mode: cfg.stripe.mode === "test" ? S.stripeModeTest : S.stripeModeLive })}</p> : null}
          <label className="block text-sm">{S.publishableKey}<input id="pc-stripe-pk" className="ainput mt-1" defaultValue={cfg.stripe?.publishableKey ?? ""} placeholder="pk_test_… / pk_live_…" /></label>
          <label className="block text-sm">{S.secretKey}<input id="pc-stripe-secret" type="password" className="ainput mt-1" placeholder={secretPh(cfg.stripe?.secretConfigured ?? false)} /></label>
          <label className="block text-sm">{S.webhookSecret}<input id="pc-stripe-whsec" type="password" className="ainput mt-1" placeholder={secretPh(cfg.stripe?.webhookSecretConfigured ?? false)} /></label>
          <div className="flex flex-wrap gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("stripe", { publishableKey: val("pc-stripe-pk"), secretKey: val("pc-stripe-secret") || undefined, webhookSecret: val("pc-stripe-whsec") || undefined }, S.stripeSaved)}>{S.saveSettings}</button>
            <button className="abtn-secondary" disabled={busy !== ""} onClick={() => testConfig("test-stripe")}>{busy === "test-stripe" ? S.verifying : S.verifyButton}</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("stripe", { clear: true }, S.stripeCleared)}>{S.clearShort}</button>
          </div>
          <p className="text-xs text-slate-400">{S.stripeNoteA}<code>https://api.qosprey.com/public/payments/stripe/webhook</code>{S.stripeNoteB}</p>
        </div>
        <div id="config-wallet" className={"acard space-y-3 scroll-mt-24 " + (highlightId === "config-wallet" ? "ring-2 ring-indigo-400" : "")}>
          <div className="flex items-center justify-between"><span className="font-semibold">{S.walletTitle}</span>{srcBadge(cfg.wallet.source)}</div>
          <label className="block text-sm">{S.walletFee}<input id="pc-wallet-fee" type="number" min={0} max={10000} step={1} className="ainput mt-1" defaultValue={cfg.wallet.feeBps} /></label>
          <label className="block text-sm">{S.walletFourEyes}<input id="pc-wallet-foureyes" type="number" min={0} step={1} className="ainput mt-1" defaultValue={cfg.wallet.payoutFourEyesThresholdMinor ?? ""} placeholder={S.walletFourEyesPlaceholder} /></label>
          <p className="text-xs text-slate-400">{S.walletFourEyesNote}</p>
          <p className="text-xs text-slate-400">{S.walletFeeNote}</p>
          <div className="flex flex-wrap gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("wallet", { feeBps: Number(val("pc-wallet-fee")), payoutFourEyesThresholdMinor: val("pc-wallet-foureyes").trim() === "" ? null : Number(val("pc-wallet-foureyes")) }, S.walletSaved)}>{S.saveSettings}</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("wallet", { clear: true }, S.walletCleared)}>{S.clearShort}</button>
          </div>
          <p className="text-xs text-slate-400">{S.walletNote}</p>
        </div>
      </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { dict, locale, t } = useAdminLocale();
  const S = dict.settings;
  const SETTING_SECTIONS = [
    { id: "general", icon: "🧭", label: S.secGeneral, sub: S.secGeneralSub },
    { id: "ai", icon: "🤖", label: S.secAi, sub: S.secAiSub },
    { id: "apps", icon: "🔌", label: S.secApps, sub: S.secAppsSub },
    { id: "messaging", icon: "✉️", label: S.secMessaging, sub: S.secMessagingSub },
    { id: "payment", icon: "💳", label: S.secPayment, sub: S.secPaymentSub },
    { id: "flags", icon: "🚩", label: S.secFlags, sub: S.secFlagsSub },
    { id: "announce", icon: "📣", label: S.secAnnounce, sub: S.secAnnounceSub },
  ];
  const AUDIENCES = AUDIENCE_KEYS.map((a) => ({ value: a.value, label: a.plan ? t("settings.audPlan", { plan: a.plan }) : t(a.labelKey as string) }));
  const [s, setS] = React.useState<Settings | null>(null);
  const [anns, setAnns] = React.useState<Announcement[]>([]);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [audience, setAudience] = React.useState("all");
  const [annStartsAt, setAnnStartsAt] = React.useState("");
  const [annEndsAt, setAnnEndsAt] = React.useState("");
  const [aiOrgIds, setAiOrgIds] = React.useState("");
  // ADNX13: announcement form errors ride the NB2 form pattern
  // (field-level, persistent until fixed) — the publish button
  // used to silently do nothing on empty title/body.
  const [annErr, setAnnErr] = React.useState<{ title?: string; body?: string }>({});
  // ADNX13: all Settings feedback rides the toast system. Child
  // sections keep calling their setMsg prop; it is this dispatcher
  // — the ✅/❌/⚠ prefix a caller already puts on its message
  // selects the toast kind and is stripped from the text (the
  // NB3 convention). Unprefixed = success (callers prefix their
  // failure paths).
  const notify = React.useCallback((m: string) => {
    const clean = m.replace(/^(✅|❌|⚠)\s*/, "");
    if (m.startsWith("❌")) toast(clean, "error");
    else if (m.startsWith("⚠")) toast(clean, "info");
    else toast(clean, "success");
  }, []);
  // ADNX13: unsaved-changes tracking, aggregated from every block
  // on the page. Keys: config block ids (section via
  // BLOCK_SECTION), "general:main", "general:maint", "announce",
  // "flags". Presentation only — no save behaviour changes; the
  // warning is the browser's beforeunload prompt (section
  // switching needs none: unselected sections are hidden, never
  // unmounted, so in-page edits survive switching).
  const [dirtyMap, setDirtyMap] = React.useState<Record<string, boolean>>({});
  const reportDirty = React.useCallback((key: string, dirty: boolean) => {
    setDirtyMap((m) => (m[key] === dirty ? m : { ...m, [key]: dirty }));
  }, []);
  const sectionDirty = (secId: string) => Object.entries(dirtyMap).some(([k, v]) => v && (BLOCK_SECTION[k] ? BLOCK_SECTION[k] === secId : k === secId || k.startsWith(`${secId}:`)));
  const anyDirty = Object.values(dirtyMap).some(Boolean);
  React.useEffect(() => {
    if (!anyDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyDirty]);
  // Snapshot of the saved general-section values, per save-group,
  // so a successful save clears only its own group's dirtiness.
  // The instant-save toggles (maintenance / signup / broadcasts)
  // are never dirty — they persist in their own onChange.
  const generalSnap = React.useRef<{ support: string; prices: string; yearly: string; limits: string; ai: string } | null>(null);
  // ADX9: Config Hub — active section + hash deep-link target.
  const [section, setSection] = React.useState("general");
  const [highlightId, setHighlightId] = React.useState<string | null>(null);
  React.useEffect(() => {
    const apply = () => {
      const raw = window.location.hash.replace(/^#/, "");
      if (!raw) return;
      const block = HASH_ALIAS[raw] ?? (BLOCK_SECTION[raw] ? raw : null);
      if (block) { setSection(BLOCK_SECTION[block]); setHighlightId(block); return; }
      if (SECTION_IDS.includes(raw)) { setSection(raw); setHighlightId(null); }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  React.useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightId]);
  const selectSection = (id: string) => {
    setSection(id); setHighlightId(null);
    try { window.history.replaceState(null, "", `#${id}`); } catch { /* ignore */ }
  };
  // ADX12: a failed settings load used to sit on "লোড হচ্ছে…"
  // forever; it now gets an error state + retry (below).
  const [loadFailed, setLoadFailed] = React.useState(false);
  // CA26: platform blueprint definitions as data — the
  // platform team edits them here; orgs clone, never edit.
  const [blueprints, setBlueprints] = React.useState<any[]>([]);
  const loadBlueprints = React.useCallback(async () => {
    const out = await apiFetch<any>("/admin/blueprints").catch(() => null);
    setBlueprints(out?.blueprints ?? []);
  }, []);
  React.useEffect(() => { void loadBlueprints(); }, [loadBlueprints]);
  const load = React.useCallback(async () => {
    const settings = await apiFetch<Settings>("/admin/settings").catch(() => null);
    setLoadFailed(settings === null);
    if (settings) {
      setS(settings); setAiOrgIds(settings.killSwitches.aiDisabledOrgIds.join(", "));
      generalSnap.current = {
        support: settings.supportContact,
        prices: JSON.stringify(settings.planPrices),
        yearly: JSON.stringify(settings.planYearlyPrices ?? {}),
        limits: JSON.stringify(settings.planLimits),
        ai: settings.killSwitches.aiDisabledOrgIds.join(", "),
      };
    }
    setAnns(await apiFetch<Announcement[]>("/admin/announcements").catch(() => []));
  }, []);
  React.useEffect(() => { load(); }, [load]);
  // ADNX13: general-section dirtiness = any save-group differing
  // from its snapshot (the AI-org list is its own group, updated
  // only by its own save button below).
  React.useEffect(() => {
    const snap = generalSnap.current;
    if (!snap || !s) return;
    reportDirty("general:main", s.supportContact !== snap.support
      || JSON.stringify(s.planPrices) !== snap.prices
      || JSON.stringify(s.planYearlyPrices ?? {}) !== snap.yearly
      || JSON.stringify(s.planLimits) !== snap.limits
      || aiOrgIds !== snap.ai);
  }, [s, aiOrgIds, reportDirty]);
  // ADNX13: an announcement draft (any field touched away from
  // its empty default) is unsaved work.
  React.useEffect(() => {
    reportDirty("announce", Boolean(title.trim() || body.trim() || audience !== "all" || annStartsAt || annEndsAt));
  }, [title, body, audience, annStartsAt, annEndsAt, reportDirty]);

  async function save(patch: Partial<Settings>, ok: string): Promise<boolean> {
    try {
      const out = await apiFetch<Settings>("/admin/settings", { method: "PATCH", body: JSON.stringify(patch) });
      setS(out);
      const snap = generalSnap.current;
      if (snap) {
        if ("supportContact" in patch) snap.support = out.supportContact;
        if ("planPrices" in patch) snap.prices = JSON.stringify(out.planPrices);
        if ("planYearlyPrices" in patch) snap.yearly = JSON.stringify(out.planYearlyPrices ?? {});
        if ("planLimits" in patch) snap.limits = JSON.stringify(out.planLimits);
      }
      toast(ok);
      return true;
    } catch (e) { toast(e instanceof Error ? e.message : dict.common.failed, "error"); return false; }
  }
  if (!s) return <AdminShell title={S.title}>{loadFailed ? <ErrorState message={S.loadError} onRetry={load} /> : <div className="askel-table" />}</AdminShell>;
  return (
    <AdminShell title={S.title}>
      <PageHead sub={S.sub} />
      {/* ADNX13: mobile section navigation is a sticky chip rail —
          every section one tap away. The desktop aside below is
          unchanged apart from becoming lg-only and gaining the
          same dirty dot. */}
      <div className="sticky top-0 z-20 -mx-1 mb-3 overflow-x-auto bg-slate-950/90 px-1 py-2 backdrop-blur lg:hidden">
        <div className="flex gap-1.5" role="navigation" aria-label={S.sectionsAria}>
          {SETTING_SECTIONS.map((sec) => (
            <button key={sec.id} type="button" onClick={() => selectSection(sec.id)} aria-current={section === sec.id ? "true" : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${section === sec.id ? "border-indigo-500 bg-indigo-600/85 text-white" : "border-slate-700 bg-slate-800/80 text-slate-200"}`}>
              <span aria-hidden="true">{sec.icon}</span>{sec.label}
              {sectionDirty(sec.id) ? <span className="h-2 w-2 rounded-full bg-amber-400" title={S.unsavedDot} /> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="hidden shrink-0 self-start lg:block lg:sticky lg:top-4 lg:w-64">
          <nav className="acard space-y-1 !p-3" aria-label={S.sectionsAria}>
            <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{S.hubHeading}</div>
            {SETTING_SECTIONS.map((sec) => (
              <button key={sec.id} type="button" onClick={() => selectSection(sec.id)} className={`anav w-full ${section === sec.id ? "anav-active" : ""}`}>
                <span className="text-base leading-none">{sec.icon}</span>
                <span className="min-w-0">
                  <span className="block truncate">{sec.label}</span>
                  <span className={`block truncate text-[11px] ${section === sec.id ? "text-indigo-200" : "text-slate-400"}`}>{sec.sub}</span>
                </span>
                {sectionDirty(sec.id) ? <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-amber-400" title={S.unsavedDot} /> : null}
              </button>
            ))}
          </nav>
          <p className="mt-2 px-1 text-xs leading-relaxed text-slate-400">{S.asideNoteA}<code>/settings#payment-bkash</code>{S.asideNoteB}</p>
        </aside>
        <div className="min-w-0 flex-1">
      <div className={section === "general" ? "space-y-4" : "hidden"}>
        <div className="acard space-y-4">
          <div className="font-semibold">{S.platformStatus}</div>
          <label className="flex items-center justify-between text-sm">{S.maintenanceMode}
            <input type="checkbox" checked={s.maintenanceMode} onChange={(e) => save({ maintenanceMode: e.target.checked }, S.maintenanceUpdated)} /></label>
          <label className="flex items-center justify-between text-sm">{S.signupOpen}
            <input type="checkbox" checked={s.signupOpen} onChange={(e) => save({ signupOpen: e.target.checked }, S.signupUpdated)} /></label>
          <label className="block text-sm">{S.supportContact}
            <input className="ainput mt-1" value={s.supportContact} onChange={(e) => setS({ ...s, supportContact: e.target.value })} placeholder="support@qosprey.com" /></label>
          <button className="abtn-secondary" onClick={() => save({ supportContact: s.supportContact }, S.supportSaved)}>{dict.common.save}</button>
          <div className="border-t border-slate-800 pt-3">
            <label className="block text-sm">{S.maxOrgsLabel}
              <input className="ainput mt-1 w-44" inputMode="numeric" placeholder={S.maxOrgsPlaceholder}
                value={s.maxOrgsPerUser === null || s.maxOrgsPerUser === undefined ? "" : String(s.maxOrgsPerUser)}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (v === "") { setS({ ...s, maxOrgsPerUser: null }); return; }
                  const n = Number(v);
                  if (Number.isInteger(n) && n >= 1) setS({ ...s, maxOrgsPerUser: n });
                }} /></label>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              {S.maxOrgsNote}
            </p>
            <button className="abtn-secondary mt-2" onClick={() => save({ maxOrgsPerUser: s.maxOrgsPerUser ?? null }, S.maxOrgsSaved)}>{S.maxOrgsSave}</button>
          </div>
          <div className="border-t border-slate-800 pt-3">
            <div className="mb-2 font-semibold">{S.planPricesTitle}</div>
            {Object.entries(s.planPrices).map(([tier, minor]) => (
              <div key={tier} className="mb-2 flex items-center gap-2 text-sm">
                <span className="w-20">{tier}</span>
                <input className="ainput" type="number" min={0} value={Math.round(minor / 100)} onChange={(e) => setS({ ...s, planPrices: { ...s.planPrices, [tier]: Number(e.target.value) * 100 } })} />
                <span className="text-slate-400">{t("settings.takaSuffix", { amount: formatMinorStr(minor, locale) })}</span>
              </div>
            ))}
            <button className="abtn-secondary" onClick={() => save({ planPrices: s.planPrices }, S.pricesSaved)}>{S.pricesSave}</button>
            <p className="mt-1 text-xs text-slate-400">{S.pricesNote}</p>
          </div>
          <div className="border-t border-slate-800 pt-3">
            <div className="mb-2 font-semibold">{S.planYearlyTitle}</div>
            {Object.entries(s.planYearlyPrices ?? {}).map(([tier, minor]) => (
              <div key={tier} className="mb-2 flex items-center gap-2 text-sm">
                <span className="w-20">{tier}</span>
                <input className="ainput" type="number" min={0} value={Math.round(minor / 100)} onChange={(e) => setS({ ...s, planYearlyPrices: { ...s.planYearlyPrices, [tier]: Number(e.target.value) * 100 } })} />
                <span className="text-slate-400">{t("settings.takaPerYear", { amount: formatMinorStr(minor, locale) })}</span>
              </div>
            ))}
            <button className="abtn-secondary" onClick={() => save({ planYearlyPrices: s.planYearlyPrices }, S.yearlySaved)}>{S.yearlySave}</button>
            <p className="mt-1 text-xs text-slate-400">{S.yearlyNote}</p>
          </div>
          <div className="border-t border-slate-800 pt-3">
            <div className="mb-2 font-semibold">{S.planLimitsTitle}</div>
            <p className="mb-3 text-xs text-slate-400">{S.planLimitsNote}</p>
            {(["FREE", "STARTER", "GROWTH", "AGENCY"] as const).map((tier) => {
              const limits = s.planLimits?.[tier] ?? { aiDaily: 0, broadcastCap: 0, seats: 0 };
              const fromSetting = !!(s.planLimitsStored && tier in s.planLimitsStored);
              const setField = (field: "aiDaily" | "broadcastCap" | "seats", v: number) =>
                setS({ ...s, planLimits: { ...s.planLimits, [tier]: { ...limits, [field]: v } } });
              // GC22: resource limits are OPTIONAL — empty = সীমা নেই (unlimited), 0 = সব বন্ধ।
              const setResourceField = (field: "productLimit" | "orderLimit" | "storageLimitMb" | "apiDailyLimit", raw: string) => {
                const next = { ...limits };
                if (raw.trim() === "") delete next[field]; else next[field] = Number(raw);
                setS({ ...s, planLimits: { ...s.planLimits, [tier]: next } });
              };
              return (
                <div key={tier} className="mb-3 rounded-lg bg-slate-800/50 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm">
                    <span className="w-20 font-medium">{tier}</span>
                    {fromSetting ? <span className="abadge-green">{S.settingBadge}</span> : <span className="abadge-amber">{S.defaultBadge}</span>}
                    {fromSetting ? (
                      <button className="abtn-secondary ml-auto !px-2 !py-0.5 text-xs" onClick={async () => {
                        if (!(await askConfirm({ title: t("settings.clearLimitsTitle", { tier }), description: S.clearLimitsDesc, confirmLabel: S.clearLimitsConfirm, danger: true }))) return;
                        const reason = await askInput({ title: S.clearLimitsReasonTitle, inputLabel: dict.common.reason, inputRequired: true, confirmLabel: dict.common.proceed });
                        if (!reason) return;
                        try {
                          const out = await apiFetch<{ cleared: boolean; note?: string }>(`/admin/settings/plan-limits/${tier}/clear`, { method: "POST", body: JSON.stringify({ reason }) });
                          notify(out.cleared ? t("settings.limitsCleared", { tier }) : `⚠ ${t("settings.limitsNoChange", { tier, note: out.note ?? S.noChangeFallback })}`);
                          await load();
                        } catch (e) { notify(`❌ ${e instanceof Error ? e.message : S.clearLimitsFailed}`); }
                      }}>{S.clearLimitsButton}</button>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <label className="block">AI Daily
                      <input className="ainput mt-1" type="number" min={0} step={1} value={limits.aiDaily} onChange={(e) => setField("aiDaily", Number(e.target.value))} />
                    </label>
                    <label className="block">Broadcast Cap
                      <input className="ainput mt-1" type="number" min={0} step={1} value={limits.broadcastCap} onChange={(e) => setField("broadcastCap", Number(e.target.value))} />
                    </label>
                    <label className="block">Seats
                      <input className="ainput mt-1" type="number" min={0} step={1} value={limits.seats} onChange={(e) => setField("seats", Number(e.target.value))} />
                    </label>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-sm">
                    <label className="block">{S.productLimit}
                      <input className="ainput mt-1" type="number" min={0} step={1} value={limits.productLimit ?? ""} placeholder="∞" onChange={(e) => setResourceField("productLimit", e.target.value)} />
                    </label>
                    <label className="block">{S.orderLimit}
                      <input className="ainput mt-1" type="number" min={0} step={1} value={limits.orderLimit ?? ""} placeholder="∞" onChange={(e) => setResourceField("orderLimit", e.target.value)} />
                    </label>
                    <label className="block">{S.storageLimit}
                      <input className="ainput mt-1" type="number" min={0} step={1} value={limits.storageLimitMb ?? ""} placeholder="∞" onChange={(e) => setResourceField("storageLimitMb", e.target.value)} />
                    </label>
                    <label className="block">{S.apiLimit}
                      <input className="ainput mt-1" type="number" min={0} step={1} value={limits.apiDailyLimit ?? ""} placeholder="∞" onChange={(e) => setResourceField("apiDailyLimit", e.target.value)} />
                    </label>
                  </div>
                </div>
              );
            })}
            <button className="abtn-secondary" onClick={() => save({ planLimits: s.planLimits }, S.limitsSaved)}>{S.limitsSave}</button>
            <p className="mt-1 text-xs text-slate-400">{S.limitsSaveNote}</p>
          </div>
        </div>
          <div className="acard space-y-3">
            <div className="font-semibold">{S.killSwitchTitle}</div>
            <label className="flex items-center justify-between text-sm">{S.broadcastsPaused}
              <input type="checkbox" checked={s.killSwitches.broadcastsPaused} onChange={(e) => save({ killSwitches: { ...s.killSwitches, broadcastsPaused: e.target.checked } }, S.broadcastsUpdated)} /></label>
            <label className="block text-sm">{S.aiDisabledOrgs}
              <input className="ainput mt-1" value={aiOrgIds} onChange={(e) => setAiOrgIds(e.target.value)} placeholder="org-id-1, org-id-2" /></label>
            <button className="abtn-secondary" onClick={async () => { if (await save({ killSwitches: { broadcastsPaused: s.killSwitches.broadcastsPaused, aiDisabledOrgIds: aiOrgIds.split(",").map((x) => x.trim()).filter(Boolean) } }, S.aiKillSaved)) { if (generalSnap.current) generalSnap.current.ai = aiOrgIds; } }}>{dict.common.save}</button>
          </div>
          <div className="acard space-y-3">
            <div className="font-semibold">{S.blueprintsTitle}</div>
            <p className="text-xs text-slate-400">{S.blueprintsNote}</p>
            {blueprints.length === 0 ? <p className="text-sm text-slate-400">{S.noBlueprints}</p> : blueprints.map((bp) => (
              <div key={bp.id} className="flex flex-wrap items-center gap-2 rounded border border-slate-800 p-2 text-sm">
                <b>{bp.name}</b>
                <span className="text-slate-400">{bp.key} · {bp.objective} · v{fmtNumber(locale, bp.version)}{bp.advantagePlus ? " · Advantage+" : ""}</span>
                <span className="ml-auto flex gap-1">
                  <button className="abtn-secondary" onClick={async () => {
                    const name = await askInput({ title: S.blueprintNameTitle, inputLabel: S.nameLabel, initialValue: bp.name, inputRequired: true, confirmLabel: dict.common.save });
                    if (!name) return;
                    await apiFetch(`/admin/blueprints/${bp.id}`, { method: "PATCH", body: JSON.stringify({ name }) }).catch(() => null);
                    toast(S.nameSaved); await loadBlueprints();
                  }}>{S.nameButton}</button>
                  <button className="abtn-secondary" onClick={async () => {
                    const description = await askInput({ title: S.blueprintDescTitle, inputLabel: S.descLabel, initialValue: bp.description ?? "", confirmLabel: dict.common.save });
                    if (description === null) return;
                    await apiFetch(`/admin/blueprints/${bp.id}`, { method: "PATCH", body: JSON.stringify({ description }) }).catch(() => null);
                    toast(S.descSaved); await loadBlueprints();
                  }}>{S.descButton}</button>
                  <button className="abtn-secondary" onClick={async () => {
                    if (!(await askConfirm({ title: t("settings.deleteBlueprintTitle", { name: bp.name }), description: S.deleteBlueprintDesc, confirmLabel: dict.common.delete, danger: true }))) return;
                    await apiFetch(`/admin/blueprints/${bp.id}`, { method: "DELETE" }).catch(() => null);
                    toast(S.blueprintDeleted); await loadBlueprints();
                  }}>{dict.common.delete}</button>
                </span>
              </div>
            ))}
            <button className="abtn-secondary" onClick={async () => {
              const key = await askInput({ title: S.newBlueprintTitle, inputLabel: S.blueprintKeyLabel, inputRequired: true, confirmLabel: S.nextStep });
              if (!key) return;
              const name = await askInput({ title: S.newBlueprintTitle, inputLabel: S.nameLabel, inputRequired: true, confirmLabel: S.nextStep });
              if (!name) return;
              const adSetRaw = await askInput({ title: S.adSetTitle, inputLabel: S.adSetLabel, initialValue: JSON.stringify({ name: "BD Broad", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", countries: ["BD"], ageMin: 18, ageMax: 65 }), confirmLabel: S.nextStep });
              if (!adSetRaw) return;
              const adRaw = await askInput({ title: S.adTitle, inputLabel: S.adLabel, initialValue: JSON.stringify({ name: "Ad", primaryText: "", headline: "", linkUrl: "https://example.com", callToAction: "SHOP_NOW" }), confirmLabel: S.createAction });
              if (!adRaw) return;
              let adSet: any; let ad: any;
              try { adSet = JSON.parse(adSetRaw); ad = JSON.parse(adRaw); } catch { toast(S.jsonInvalid); return; }
              const out = await apiFetch<any>("/admin/blueprints", { method: "POST", body: JSON.stringify({ key, name, objective: "OUTCOME_SALES", adSet, ad }) }).catch(() => null);
              if (out) { toast(S.blueprintCreated); await loadBlueprints(); } else toast(S.blueprintCreateFailed);
            }}>{S.newBlueprint}</button>
          </div>
      </div>
      <div className={section === "announce" ? "" : "hidden"}>
          <div className="acard space-y-3">
            <div className="font-semibold">{S.announceTitle}</div>
            <div>
              <input className="ainput" placeholder={S.announceTitlePlaceholder} value={title} onChange={(e) => { setTitle(e.target.value); if (annErr.title) setAnnErr((x) => ({ ...x, title: undefined })); }} />
              {annErr.title ? <p className="mt-1 text-xs text-red-300">{annErr.title}</p> : null}
            </div>
            <div>
              <textarea className="ainput" rows={2} placeholder={S.announceBodyPlaceholder} value={body} onChange={(e) => { setBody(e.target.value); if (annErr.body) setAnnErr((x) => ({ ...x, body: undefined })); }} />
              {annErr.body ? <p className="mt-1 text-xs text-red-300">{annErr.body}</p> : null}
            </div>
            <label className="block text-sm">{S.audienceLabel}
              <select className="ainput mt-1" value={audience} onChange={(e) => setAudience(e.target.value)}>
                {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">{S.startsAt}
                <input type="datetime-local" className="ainput mt-1" value={annStartsAt} onChange={(e) => setAnnStartsAt(e.target.value)} /></label>
              <label className="block text-sm">{S.endsAt}
                <input type="datetime-local" className="ainput mt-1" value={annEndsAt} onChange={(e) => setAnnEndsAt(e.target.value)} /></label>
            </div>
            <p className="text-xs text-slate-400">{S.announceNote}</p>
            <button className="abtn" onClick={async () => {
              const errs: { title?: string; body?: string } = {};
              if (!title.trim()) errs.title = S.announceTitleRequired;
              if (!body.trim()) errs.body = S.announceBodyRequired;
              setAnnErr(errs);
              if (errs.title || errs.body) return;
              try {
                await apiFetch("/admin/announcements", { method: "POST", body: JSON.stringify({ title, body, audience, ...(annStartsAt ? { startsAt: new Date(annStartsAt).toISOString() } : {}), ...(annEndsAt ? { endsAt: new Date(annEndsAt).toISOString() } : {}) }) });
                setTitle(""); setBody(""); setAnnStartsAt(""); setAnnEndsAt(""); toast(S.announcePublished); await load();
              } catch (e) { toast(e instanceof Error ? e.message : dict.common.failed, "error"); }
            }}>{S.publish}</button>
            <ul className="space-y-2">
              {anns.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm">
                  <span><b>{a.title}</b> — {a.body}<span className="block text-xs text-slate-400">{fmtDateTime(locale, a.createdAt)} · {a.active ? S.activeState : S.inactiveState} · 👥 {AUDIENCES.find((x) => x.value === (a.audience ?? "all"))?.label ?? a.audience}{(a.startsAt || a.endsAt) ? <span className="block">🗓 {a.startsAt ? fmtDateTime(locale, a.startsAt) : "—"} → {a.endsAt ? fmtDateTime(locale, a.endsAt) : "—"}</span> : null}</span></span>
                  <span className="flex shrink-0 gap-1">
                    <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={async () => { await apiFetch(`/admin/announcements/${a.id}/active`, { method: "POST", body: JSON.stringify({ active: !a.active }) }); await load(); }}>{a.active ? S.turnOff : S.turnOn}</button>
                    <button className="abtn-danger !px-2 !py-1 text-xs" onClick={async () => { await apiFetch(`/admin/announcements/${a.id}`, { method: "DELETE" }); await load(); }}>{dict.common.delete}</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
      </div>
      <div className={section === "flags" ? "" : "hidden"}>
        <PlanFlagDefaultsCard setMsg={notify} reportDirty={reportDirty} />
      </div>
      <PlatformConfigSection setMsg={notify} section={section} highlightId={highlightId} reportDirty={reportDirty} />
      <div className={section === "general" ? "" : "hidden"}>
        <MaintenanceAndSafety setMsg={notify} reportDirty={reportDirty} />
      </div>
        </div>
      </div>
    </AdminShell>
  );
}

const FLAG_LABELS: { key: string; labelKey: string }[] = [
  { key: "dayparting", labelKey: "settings.flagDayparting" },
  { key: "portfolio", labelKey: "settings.flagPortfolio" },
  { key: "creative_library", labelKey: "settings.flagCreativeLibrary" },
  { key: "order_bot", labelKey: "settings.flagOrderBot" },
  { key: "offline_conversions", labelKey: "settings.flagOfflineConversions" },
  { key: "agency_portfolio", labelKey: "settings.flagAgencyPortfolio" },
];
const FLAG_TIERS = ["FREE", "STARTER", "GROWTH", "AGENCY"] as const;
type TriState = "" | "true" | "false";

/** AA7: plan-scoped feature-flag defaults. Tri-state matrix:
 * unset = "Default (ON)" — nothing stored, the feature stays on;
 * ON/OFF store an explicit sparse entry. The dedicated endpoint
 * replaces the whole sparse map on save. */
function PlanFlagDefaultsCard({ setMsg, reportDirty }: { setMsg: (m: string) => void; reportDirty: (key: string, dirty: boolean) => void }) {
  const { dict, t } = useAdminLocale();
  const S = dict.settings;
  const [cells, setCells] = React.useState<Record<string, Record<string, TriState>>>({});
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // ADNX13: a failed load used to leave this card invisible
  // forever (loaded stayed false and it returned null); it now
  // gets a skeleton in flight and an error state + retry.
  const [failed, setFailed] = React.useState(false);
  // ADNX13: snapshot of the applied cells for dirty reporting.
  const cellsSnap = React.useRef("");

  const apply = React.useCallback((sparse: Record<string, Record<string, boolean>> | undefined) => {
    const next: Record<string, Record<string, TriState>> = {};
    for (const { key } of FLAG_LABELS) {
      next[key] = {};
      for (const tier of FLAG_TIERS) {
        const v = sparse?.[key]?.[tier];
        next[key][tier] = v === undefined ? "" : v ? "true" : "false";
      }
    }
    setCells(next);
    cellsSnap.current = JSON.stringify(next);
  }, []);

  const load = React.useCallback(async () => {
    const s = await apiFetch<{ planFlagDefaults?: Record<string, Record<string, boolean>> }>("/admin/settings").catch(() => null);
    if (s) { apply(s.planFlagDefaults ?? {}); setLoaded(true); setFailed(false); }
    else setFailed(true);
  }, [apply]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    if (loaded) reportDirty("flags", JSON.stringify(cells) !== cellsSnap.current);
  }, [cells, loaded, reportDirty]);

  async function save() {
    const sparse: Record<string, Record<string, boolean>> = {};
    for (const { key } of FLAG_LABELS) {
      for (const tier of FLAG_TIERS) {
        const v = cells[key]?.[tier];
        if (v === "true") (sparse[key] ??= {})[tier] = true;
        else if (v === "false") (sparse[key] ??= {})[tier] = false;
      }
    }
    setBusy(true);
    try {
      const out = await apiFetch<{ planFlagDefaults?: Record<string, Record<string, boolean>> }>("/admin/settings/plan-flag-defaults", { method: "PATCH", body: JSON.stringify(sparse) });
      apply(out?.planFlagDefaults ?? sparse);
      setMsg(S.flagsSaved);
    } catch (e) { setMsg(`❌ ${e instanceof Error ? e.message : dict.common.failed}`); }
    finally { setBusy(false); }
  }

  if (failed) return <div className="acard mt-4"><ErrorState message={S.flagsLoadError} onRetry={load} /></div>;
  if (!loaded) return <div className="acard mt-4"><div className="askel-table" /></div>;
  return (
    <div className="acard mt-4 space-y-3">
      <div className="font-semibold">{S.flagsTitle}</div>
      <p className="text-xs text-slate-400">
        {S.flagsNoteA}<b>{S.flagsNoteBold1}</b>{S.flagsNoteB}<b>{S.flagsNoteBold2}</b>{S.flagsNoteC}
      </p>
      <div className="overflow-x-auto">
        <table className="atable">
          <thead className="bg-slate-900"><tr><th className="ath">{S.colFeature}</th>{FLAG_TIERS.map((t) => <th key={t} className="ath">{t}</th>)}</tr></thead>
          <tbody>
            {FLAG_LABELS.map(({ key, labelKey }) => (
              <tr key={key} className="border-t border-slate-800">
                <td className="atd font-medium">{t(labelKey)}<span className="block text-xs text-slate-400">{key}</span></td>
                {FLAG_TIERS.map((tier) => (
                  <td key={tier} className="atd">
                    <select
                      className="ainput !w-auto px-2 py-1 text-xs"
                      value={cells[key]?.[tier] ?? ""}
                      onChange={(e) => setCells({ ...cells, [key]: { ...cells[key], [tier]: e.target.value as TriState } })}
                    >
                      <option value="">Default (ON)</option>
                      <option value="true">ON</option>
                      <option value="false">OFF</option>
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="abtn-secondary" disabled={busy} onClick={save}>{busy ? S.flagsSaving : S.flagsSave}</button>
    </div>
  );
}

interface MaintenanceWindow { startsAt: string; endsAt: string; message?: string; hardLockout?: boolean }

function MaintenanceAndSafety({ setMsg, reportDirty }: { setMsg: (m: string) => void; reportDirty: (key: string, dirty: boolean) => void }) {
  const { dict, locale, t } = useAdminLocale();
  const S = dict.settings;
  const [win, setWin] = React.useState<MaintenanceWindow | null>(null);
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [hard, setHard] = React.useState(false);
  const [retention, setRetention] = React.useState(365);
  const [entries, setEntries] = React.useState("");
  const [envEntries, setEnvEntries] = React.useState<string[]>([]);
  // ADNX13: saved-value snapshots for dirty reporting (the
  // window group and the allowlist entries are separate saves;
  // both report into the "general" section, which hosts this
  // component). Initialised to the initial field values so the
  // pre-load render never reports dirty.
  const maintSnap = React.useRef(JSON.stringify({ start: "", end: "", message: "", hard: false, retention: 365 }));
  const entriesSnap = React.useRef("");

  const load = React.useCallback(async () => {
    const settings = await apiFetch<any>("/admin/settings").catch(() => null);
    if (settings) {
      setWin(settings.maintenanceWindow ?? null);
      setRetention(settings.auditRetentionDays ?? 365);
      const w = settings.maintenanceWindow;
      const sv = {
        start: w ? String(w.startsAt).slice(0, 16) : "",
        end: w ? String(w.endsAt).slice(0, 16) : "",
        message: w ? (w.message ?? "") : "",
        hard: w ? w.hardLockout === true : false,
        retention: settings.auditRetentionDays ?? 365,
      };
      maintSnap.current = JSON.stringify(sv);
      if (w) {
        setStart(sv.start);
        setEnd(sv.end);
        setMessage(sv.message);
        setHard(sv.hard);
      }
    }
    const allow = await apiFetch<{ entries: string[]; envEntries: string[] }>("/admin/security/ip-allowlist").catch(() => null);
    if (allow) { setEntries(allow.entries.join("\n")); setEnvEntries(allow.envEntries); entriesSnap.current = allow.entries.join("\n"); }
  }, []);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    reportDirty("general:maint", JSON.stringify({ start, end, message, hard, retention }) !== maintSnap.current || entries !== entriesSnap.current);
  }, [start, end, message, hard, retention, entries, reportDirty]);

  const patch = async (patchBody: Record<string, unknown>, ok: string) => {
    try { await apiFetch("/admin/settings", { method: "PATCH", body: JSON.stringify(patchBody) }); setMsg(ok); await load(); }
    catch (e) { setMsg(`❌ ${e instanceof Error ? e.message : dict.common.failed}`); }
  };

  const active = win && new Date(win.startsAt).getTime() <= Date.now() && Date.now() <= new Date(win.endsAt).getTime();

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="acard space-y-3">
        <div className="font-semibold">{S.maintenanceWindowTitle} {active ? <span className="abadge" style={{ background: "#fee2e2", color: "#991b1b" }}>{S.maintenanceActive}</span> : null}</div>
        <p className="text-xs text-slate-400">{S.maintenanceNote}</p>
        <label className="block text-sm">{S.startLabel} <input type="datetime-local" className="ainput mt-1" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="block text-sm">{S.endLabel} <input type="datetime-local" className="ainput mt-1" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label className="block text-sm">{S.messageLabel} <input className="ainput mt-1" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={S.messagePlaceholder} /></label>
        <label className="flex items-center justify-between text-sm">{S.hardLockout}
          <input type="checkbox" checked={hard} onChange={(e) => setHard(e.target.checked)} /></label>
        <div className="flex gap-2">
          <button className="abtn" onClick={() => {
            if (!start || !end) { setMsg(`❌ ${S.windowTimeRequired}`); return; }
            patch({ maintenanceWindow: { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), message, hardLockout: hard } }, S.windowSaved);
          }}>{S.windowSave}</button>
          {win ? <button className="abtn-secondary" onClick={() => patch({ maintenanceWindow: null }, S.windowDeleted)}>{S.windowDelete}</button> : null}
        </div>
        <div className="border-t border-slate-800 pt-3">
          <div className="font-semibold">{S.retentionTitle}</div>
          <p className="text-xs text-slate-400">{S.retentionNoteA}<b>{S.retentionNoteBold}</b>{S.retentionNoteB}</p>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <input type="number" min={30} max={3650} className="ainput" style={{ width: 110 }} value={retention} onChange={(e) => setRetention(Number(e.target.value))} />
            <span>{S.daysSuffix}</span>
            <button className="abtn-secondary" onClick={() => patch({ auditRetentionDays: retention }, S.retentionSaved)}>{dict.common.save}</button>
          </div>
        </div>
      </div>
      <div className="acard space-y-3">
        <div className="font-semibold">{S.ipAllowlistTitle}</div>
        <p className="text-xs text-slate-400">{S.ipAllowlistNoteA}<b>{S.ipAllowlistWarn}</b>{S.ipAllowlistNoteB}</p>
        <textarea className="ainput" rows={5} value={entries} onChange={(e) => setEntries(e.target.value)} placeholder={"203.0.113.10\n198.51.100.0/24"} />
        <button className="abtn" onClick={async () => {
          // ADNX13 (with ADNX13's Security mandate): an allowlist
          // change is a dangerous action — it confirms through
          // the ONE modal pattern before the same PATCH as before.
          if (!(await askConfirm({ title: S.ipAllowlistConfirmTitle, description: S.ipAllowlistConfirmDesc, confirmLabel: S.ipAllowlistConfirm, danger: true }))) return;
          try {
            const list = entries.split("\n").map((x) => x.trim()).filter(Boolean);
            await apiFetch("/admin/security/ip-allowlist", { method: "PATCH", body: JSON.stringify({ entries: list }) });
            setMsg(S.ipAllowlistSaved); await load();
          } catch (e) { setMsg(`❌ ${e instanceof Error ? e.message : dict.common.failed}`); }
        }}>{S.ipAllowlistSave}</button>
        {envEntries.length ? <p className="text-xs text-slate-400">{t("settings.envEntriesNote", { entries: envEntries.join(", ") })}</p> : null}
      </div>
    </div>
  );
}
