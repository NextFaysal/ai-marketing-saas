"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { mediaSrc } from "@/lib/media-src";
import { getOrganizationId } from "@/lib/org";
import {
  canDownloadExport, dataExportKindLabel, dataExportStatusLabel,
  dataExportsFromPayload, dataImportErrorLabel, dataImportJobStatusLabel,
  dataImportSkipReasonLabel, dataImportTableLabel, exportDownloadFilename,
  formatExportSize, formatMerchantKeyPrefix, merchantApiKeyStatusLabel, merchantApiScopeLabel,
  merchantApiScopesFor, merchantKeysFromPayload,
  validateMerchantKeyDraft, type CreatedMerchantApiKey, type DataExportRow,
  type DataImportJob, type DataImportReport, type MerchantApiKeyRecord,
} from "@/lib/ab8";
import {
  NOTIFICATION_CATEGORIES, canRevokeOwnSession, isCategoryEnabled, toggleMutedCategory,
  type LoginHistoryRow, type OwnSession,
} from "@/lib/gb6-team";
import dynamic from "next/dynamic";

const BusinessKnowledgeSection = dynamic(() => import("./knowledge-section").then((m) => m.BusinessKnowledgeSection), { ssr: false });
const AiLearningSection = dynamic(() => import("./ai-learning-section").then((m) => m.AiLearningSection), { ssr: false });
const AiControlCenterSection = dynamic(() => import("./ai-control-section").then((m) => m.AiControlCenterSection), { ssr: false });
import { LanguageSection } from "./language-section";
import { useLocale } from "@/lib/i18n/provider";
import { fmtDateTime, fmtNumber, type UiLocale } from "@repo/contracts";
import { settingsBn, settingsEn } from "@/lib/i18n/settings";

interface TotpStatus { totpEnabled: boolean; enrolmentInProgress: boolean }

interface OrgBranding {
  name: string; brandName: string | null; logoUrl: string | null;
  primaryColor: string | null; customDomain: string | null;
  // MX7: brand-kit font (allowlist key) + secondary color — used
  // by the Messaging email builder's brand kit.
  brandFont?: string | null; brandSecondaryColor?: string | null;
  // NF8: the org's own Google review link (see the branding card).
  googleReviewUrl: string | null;
}

const BRAND_FONT_OPTIONS: { key: string; labelKey?: string; labelEn?: string }[] = [
  { key: "hind-siliguri", labelKey: "brandFontHindSiliguri" },
  { key: "noto-sans-bengali", labelKey: "brandFontNotoSans" },
  { key: "arial", labelEn: "Arial" },
  { key: "georgia", labelEn: "Georgia" },
  { key: "verdana", labelEn: "Verdana" },
];

/**
 * Milestone 59 — Agency White-Label v1 settings. Everything here
 * writes to the Organization row via PATCH /organizations/:id/branding
 * and the logo endpoint; applied in the sidebar/header, invoice +
 * label PDFs, and the public client report.
 */
function BrandingCard() {
  const { dict, t, locale } = useLocale();
  const D = dict.settings;
  const [org, setOrg] = useState<OrgBranding | null>(null);
  const [brandName, setBrandName] = useState("");
  const [googleReviewUrl, setGoogleReviewUrl] = useState("");
  const [color, setColor] = useState("#4F46E5");
  const [font, setFont] = useState("");
  const [color2, setColor2] = useState("#B45309");
  const [domain, setDomain] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const o = await apiFetch<OrgBranding>(`/organizations/${orgId}`);
      setOrg(o);
      setBrandName(o.brandName ?? "");
      setGoogleReviewUrl(o.googleReviewUrl ?? "");
      setColor(o.primaryColor ?? "#4F46E5");
      setFont(o.brandFont ?? "");
      setColor2(o.brandSecondaryColor ?? "#B45309");
      setDomain(o.customDomain ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : D.loadFailed); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setMsg(""); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/branding`, {
        method: "PATCH",
        body: JSON.stringify({ brandName, primaryColor: color, brandFont: font, brandSecondaryColor: color2, customDomain: domain, googleReviewUrl: googleReviewUrl.trim() }),
      });
      setMsg(D.brandSaved);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.saveFailed); }
    finally { setBusy(false); }
  }

  async function uploadLogo(file: File) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setMsg(""); setError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error(D.brandFileReadFailed));
        r.readAsDataURL(file);
      });
      const dataBase64 = dataUrl.split(",")[1] ?? "";
      await apiFetch(`/organizations/${orgId}/branding/logo`, {
        method: "POST",
        body: JSON.stringify({ dataBase64, contentType: file.type }),
      });
      setMsg(D.brandLogoUploaded);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.brandLogoUploadFailed); }
    finally { setBusy(false); }
  }

  async function removeLogo() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setMsg(""); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/branding/logo`, { method: "DELETE" });
      setMsg(D.brandLogoRemoved);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.removeFailed); }
    finally { setBusy(false); }
  }

  return (
    <section id="hub-branding" className="card scroll-mt-24 p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="stat-icon stat-icon-brand !h-10 !w-10 text-lg">🎨</span>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight text-slate-900">{D.brandTitle}</h2>
        </div>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">{D.brandIntro}</p>
      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}
      {!org ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start gap-5">
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">{D.brandLogoLabel}</div>
              <div className="flex items-center gap-3">
                {org.logoUrl
                  ? <img src={mediaSrc(API_URL, org.logoUrl) ?? ""} alt={D.brandLogoAlt} className="h-14 w-14 rounded-2xl border bg-white object-contain p-1" />
                  : <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-xl font-black text-white">Q</span>}
                <div className="space-y-2">
                  <label className="btn-secondary btn-sm cursor-pointer">
                    {org.logoUrl ? D.brandLogoChange : D.brandLogoUpload}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={busy}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ""; }} />
                  </label>
                  {org.logoUrl ? <button className="btn-secondary btn-sm block text-red-600" disabled={busy} onClick={removeLogo}>{D.brandLogoRemove}</button> : null}
                </div>
              </div>
            </div>
            <label className="block min-w-56 flex-1 text-sm text-slate-600">{D.brandNameLabel}
              <input className="input mt-1" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder={org.name} maxLength={120} />
              <span className="mt-1 block text-xs text-slate-400">{D.brandNameHintBefore}{org.name}{D.brandNameHintAfter}</span>
            </label>
            <label className="block text-sm text-slate-600">{D.brandPrimaryColor}
              <span className="mt-1 flex items-center gap-2">
                <input type="color" className="h-10 w-14 cursor-pointer rounded-lg border bg-white p-1" value={color} onChange={(e) => setColor(e.target.value)} />
                <input className="input w-28" value={color} onChange={(e) => setColor(e.target.value)} placeholder="#4F46E5" maxLength={20} />
              </span>
              <span className="mt-1 block text-xs text-slate-400">{D.brandPrimaryColorHint}</span>
            </label>
            <label className="block text-sm text-slate-600">{D.brandSecondaryColor}
              <span className="mt-1 flex items-center gap-2">
                <input type="color" className="h-10 w-14 cursor-pointer rounded-lg border bg-white p-1" value={color2} onChange={(e) => setColor2(e.target.value)} />
                <input className="input w-28" value={color2} onChange={(e) => setColor2(e.target.value)} placeholder="#B45309" maxLength={20} />
              </span>
              <span className="mt-1 block text-xs text-slate-400">{D.brandSecondaryColorHint}</span>
            </label>
            <label className="block text-sm text-slate-600">{D.brandFontLabel}
              <select className="input mt-1" value={font} onChange={(e) => setFont(e.target.value)}>
                <option value="">{D.brandFontDefault}</option>
                {BRAND_FONT_OPTIONS.map((f) => <option key={f.key} value={f.key}>{f.labelKey ? D[f.labelKey as keyof typeof D] : f.labelEn}</option>)}
              </select>
              <span className="mt-1 block text-xs text-slate-400">{D.brandFontHint}</span>
            </label>
          </div>

          {/* NF14 (FB5): how the shop's installable-app icon is
              actually chosen — stated exactly as shop-pwa.ts
              buildShopManifest does it, nothing more claimed. */}
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-700">{D.brandAppIconTitle}</p>
            <p className="mt-1 text-xs leading-relaxed">{D.brandAppIconText}</p>
          </div>

          {/* NF8: the org's own Google review link. Offered (never
              auto-redirected, no reward attached) on the review
              thank-you screen only after a 4–5 star review. */}
          <label className="block text-sm text-slate-600">{D.brandGoogleReviewLabel}
            <input className="input mt-1" value={googleReviewUrl} onChange={(e) => setGoogleReviewUrl(e.target.value)} placeholder="https://g.page/r/…/review" maxLength={2048} inputMode="url" />
            <span className="mt-1 block text-xs leading-relaxed text-slate-400">{D.brandGoogleReviewHintA}<b>{D.brandGoogleReviewHintBold}</b>{D.brandGoogleReviewHintB}</span>
          </label>

          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-4 text-sm">
            <span className="font-medium text-slate-700">{D.brandCustomDomain}</span>
            {org.customDomain
              ? <span className="font-mono font-bold text-slate-900">{org.customDomain}</span>
              : <span className="text-slate-500">{D.brandNotSet}</span>}
            <a href="/dashboard/commerce/storefront" className="font-semibold text-indigo-700 underline">{D.brandManageDomain}</a>
          </div>

          <button className="btn-primary" disabled={busy} onClick={save}>{busy ? D.waitPlease : D.brandSaveBtn}</button>
          <p className="text-xs text-slate-400">{D.brandReportNoteBefore}</p>
        </div>
      )}
    </section>
  );
}

/**
 * AB8 (AX21): merchant developer API keys. The plaintext key is
 * returned exactly once at creation — it is kept only in this
 * card's local state, shown in a copyable box with the one-time
 * warning, and never re-fetched (the list carries prefixes only).
 */
function DeveloperApiCard() {
  const { dict, t, locale } = useLocale();
  const D = dict.settings;
  const [keys, setKeys] = useState<MerchantApiKeyRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["products:read"]);
  const [createdKey, setCreatedKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoaded(true); return; }
    try {
      // Contract shape is { items }; the delivered API returns
      // the bare array — the lib normalizer accepts both.
      const out = await apiFetch<unknown>(`/organizations/${orgId}/merchant-api-keys`);
      setKeys(merchantKeysFromPayload(out));
    } catch (e) { setError(e instanceof Error ? e.message : D.loadFailed); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function toggleScope(scope: string) {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  }

  async function createKey() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const err = validateMerchantKeyDraft(name, scopes, locale);
    if (err) { setError(err); return; }
    setBusy("create"); setMsg(""); setError(""); setCreatedKey(""); setCopied(false);
    try {
      const out = await apiFetch<CreatedMerchantApiKey>(`/organizations/${orgId}/merchant-api-keys`, {
        method: "POST", body: JSON.stringify({ name: name.trim(), scopes }),
      });
      setCreatedKey(out.key);
      setName("");
      setMsg(D.apiKeyCreated);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.apiKeyCreateFailed); }
    finally { setBusy(""); }
  }

  async function copyCreatedKey() {
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
    } catch { setError(D.apiCopyFailed); }
  }

  async function revokeKey(k: MerchantApiKeyRecord) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(t("settings.apiRevokeConfirm", { name: k.name }))) return;
    setBusy(`revoke-${k.id}`); setMsg(""); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/merchant-api-keys/${k.id}`, { method: "DELETE" });
      setMsg(D.apiKeyRevoked);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.apiKeyRevokeFailed); }
    finally { setBusy(""); }
  }

  return (
    <section id="hub-developer-api" className="card scroll-mt-24 p-5 sm:p-6">
      <SectionHead icon="🔑" title={D.apiTitle} hint={D.apiHint} />
      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}
      {createdKey ? (
        <div className="mb-4 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="text-sm font-semibold text-amber-900">{D.apiKeyOneTimeWarn}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white p-2 font-mono text-sm ring-1 ring-amber-200">{createdKey}</code>
            <button type="button" className="btn-secondary btn-sm" onClick={copyCreatedKey}>{copied ? D.apiCopied : D.apiCopy}</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setCreatedKey(""); setCopied(false); }}>{D.apiSavedHide}</button>
          </div>
        </div>
      ) : null}
      {!loaded ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : (
        <div className="space-y-5">
          <div>
            {keys.length === 0 ? <p className="text-sm text-slate-400">{D.apiNoKeys}</p> : (
              <ul className="space-y-1.5">
                {keys.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium text-slate-800">{k.name}</span>
                      <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${k.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>{merchantApiKeyStatusLabel(k.status, locale)}</span>
                      <span className="block font-mono text-xs text-slate-500">{formatMerchantKeyPrefix(k.keyPrefix)}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {(k.scopes ?? []).map((s) => (
                          <span key={s} className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">{merchantApiScopeLabel(s, locale)}</span>
                        ))}
                      </span>
                      <span className="block text-[11px] text-slate-400">
                        {D.apiCreatedLabel}{fmtDateTime(locale, k.createdAt)}{D.apiLastUsedLabel}{k.lastUsedAt ? fmtDateTime(locale, k.lastUsedAt) : D.apiNever}
                      </span>
                    </span>
                    {k.status === "active" ? (
                      <button type="button" className="btn-secondary btn-sm text-red-600" disabled={busy !== ""} onClick={() => revokeKey(k)}>
                        {busy === `revoke-${k.id}` ? D.apiRevoking : D.apiRevoke}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">{D.apiNewKeyTitle}</h3>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block min-w-52 flex-1 text-sm text-slate-600">{D.apiKeyNameLabel}
                <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={D.apiKeyNamePlaceholder} maxLength={80} />
              </label>
            </div>
            <div className="mt-3">
              <div className="mb-1.5 text-[13px] font-medium text-slate-600">{D.apiScopeLabel}</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {merchantApiScopesFor(locale).map((s) => (
                  <label key={s.key} className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                    <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={scopes.includes(s.key)}
                      onChange={() => toggleScope(s.key)} aria-label={s.label} />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <button type="button" className="btn-primary mt-4 min-h-[44px]" disabled={busy !== ""} onClick={createKey}>
              {busy === "create" ? D.apiCreating : D.apiCreateBtn}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * AB8 (AX25): self-serve data exports + the weekly backup
 * preference. Exports carry the org's FULL records — the card
 * says so plainly, and a download is offered only while an
 * export is ready (the API enforces org ownership + expiry).
 */
function DataToolsCard() {
  const { dict, t, locale } = useLocale();
  const D = dict.settings;
  const [items, setItems] = useState<DataExportRow[]>([]);
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  // OU12: backup verification (restore-readiness check) state.
  const [orgSlug, setOrgSlug] = useState("");
  const [verifyRowId, setVerifyRowId] = useState("");
  const [verifySlug, setVerifySlug] = useState("");
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; problems: string[]; truncatedTables: string[] } | null>(null);
  // ORG16: bundle import/restore is OWNER-only (the API enforces
  // it too) — the section renders its controls only for the owner.
  const [myRole, setMyRole] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importText, setImportText] = useState("");
  const [importReport, setImportReport] = useState<DataImportReport | null>(null);
  const [importJob, setImportJob] = useState<DataImportJob | null>(null);

  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<{ id: string; myRole: string }[]>(`/organizations`)
      .then((mine) => setMyRole((mine ?? []).find((x) => x.id === orgId)?.myRole ?? ""))
      .catch(() => undefined);
  }, []);

  async function pickImportFile(file: File | null) {
    setImportReport(null); setImportJob(null); setError(""); setMsg("");
    if (!file) { setImportFileName(""); setImportText(""); return; }
    setImportFileName(file.name);
    try {
      const text = await file.text();
      if (text.length > 2_800_000) {
        setImportText("");
        setError(D.dataImportTooBig);
        return;
      }
      setImportText(text);
    } catch {
      setImportText("");
      setError(D.dataFileReadFailed);
    }
  }

  async function validateImport() {
    const orgId = getOrganizationId(); if (!orgId || !importText) return;
    setBusy("import-validate"); setMsg(""); setError(""); setImportJob(null);
    try {
      const report = await apiFetch<DataImportReport>(`/organizations/${orgId}/data-imports/validate`, {
        method: "POST",
        body: JSON.stringify({ fileName: importFileName || undefined, bundleJson: importText }),
      });
      setImportReport(report);
      if (!report.valid && report.errors.length === 0) setError(D.dataBundleInvalid);
    } catch (e) { setError(e instanceof Error ? e.message : D.dataValidateFailed); }
    finally { setBusy(""); }
  }

  async function runImport() {
    const orgId = getOrganizationId(); if (!orgId || !importText) return;
    setBusy("import-run"); setMsg(""); setError("");
    try {
      const job = await apiFetch<DataImportJob>(`/organizations/${orgId}/data-imports`, {
        method: "POST",
        body: JSON.stringify({ fileName: importFileName || undefined, bundleJson: importText }),
      });
      setImportJob(job);
      setImportReport(null);
      if (job.status === "completed") {
        setMsg(t("settings.dataImportDone", { count: fmtNumber(locale, job.report?.totalImportRows ?? 0) }));
      } else if (job.status === "failed") {
        setError(t("settings.dataImportFailed", { reason: job.error ?? D.dataUnknownError }));
      }
    } catch (e) { setError(e instanceof Error ? e.message : D.dataImportStartFailed); }
    finally { setBusy(""); }
  }

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoaded(true); return; }
    try {
      // Contract shape is { items, backupPreference }; the
      // delivered API returns the rows under `exports` — the
      // lib normalizer accepts both.
      const out = dataExportsFromPayload(await apiFetch<unknown>(`/organizations/${orgId}/data-exports`));
      setItems(out.items);
      setBackupEnabled(out.backupPreference.enabled);
      setLastBackupAt(out.backupPreference.lastBackupAt);
      // OU12: the slug is the verification confirm text.
      const org = await apiFetch<{ slug?: string }>(`/organizations/${orgId}`).catch(() => null);
      if (org?.slug) setOrgSlug(org.slug);
    } catch (e) { setError(e instanceof Error ? e.message : D.loadFailed); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggleBackup(enabled: boolean) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("backup-pref"); setMsg(""); setError("");
    try {
      const out = await apiFetch<{ enabled: boolean; lastBackupAt: string | null }>(
        `/organizations/${orgId}/data-exports/backup-preference`,
        { method: "PUT", body: JSON.stringify({ enabled }) },
      );
      setBackupEnabled(Boolean(out.enabled));
      setLastBackupAt(out.lastBackupAt ?? null);
      setMsg(enabled ? D.dataBackupOn : D.dataBackupOff);
    } catch (e) { setError(e instanceof Error ? e.message : D.dataPrefSaveFailed); }
    finally { setBusy(""); }
  }

  async function createExport() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("export"); setMsg(""); setError("");
    try {
      await apiFetch<DataExportRow>(`/organizations/${orgId}/data-exports`, { method: "POST" });
      setMsg(D.dataExportRequested);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.dataExportStartFailed); }
    finally { setBusy(""); }
  }

  // OU12: run the read-only backup verification for one ready
  // export. OWNER-only on the API; the slug must be typed
  // exactly. This is NOT a restore — see the note in the card.
  async function verifyBackup(row: DataExportRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`verify-${row.id}`); setMsg(""); setError(""); setVerifyResult(null);
    try {
      const out = await apiFetch<{ verification: { ok: boolean; problems: string[]; truncatedTables: string[] } }>(
        `/organizations/${orgId}/data-exports/${row.id}/verify-backup`,
        { method: "POST", body: JSON.stringify({ confirmSlug: verifySlug.trim() }) },
      );
      setVerifyResult(out.verification);
      setMsg(out.verification.ok ? D.dataVerifyOk : D.dataVerifyProblems);
      setVerifyRowId(""); setVerifySlug("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.dataValidateFailed); }
    finally { setBusy(""); }
  }

  async function downloadExport(row: DataExportRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`download-${row.id}`); setMsg(""); setError("");
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/organizations/${orgId}/data-exports/${row.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(D.dataDownloadExpired);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = exportDownloadFilename(row.id);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setError(e instanceof Error ? e.message : D.dataDownloadFailed); }
    finally { setBusy(""); }
  }

  return (
    <section id="hub-data-tools" className="card scroll-mt-24 p-5 sm:p-6">
      <SectionHead icon="💾" title={D.dataTitle} hint={D.dataHint} />
      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}
      <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{D.dataExportWarn}</p>
      <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">ℹ️ <strong>{D.dataVerifyNoteBold}</strong>{D.dataVerifyNoteAfter}</p>
      {!loaded ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : (
        <div className="space-y-5">
          <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-100">
            <span>
              {D.dataWeeklyBackup}
              <span className="block text-xs font-normal text-slate-400">
                {lastBackupAt ? t("settings.dataLastBackup", { date: fmtDateTime(locale, lastBackupAt) }) : D.dataNoBackupYet}
              </span>
            </span>
            <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={backupEnabled} disabled={busy !== ""}
              onChange={(e) => toggleBackup(e.target.checked)} aria-label={D.dataWeeklyBackup} />
          </label>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-700">{D.dataExportsTitle}</h3>
              <button type="button" className="btn-primary btn-sm min-h-[40px]" disabled={busy !== ""} onClick={createExport}>
                {busy === "export" ? D.dataRequesting : D.dataExportNow}
              </button>
            </div>
            {items.length === 0 ? <p className="text-sm text-slate-400">{D.dataNoExports}</p> : (
              <ul className="space-y-1.5">
                {items.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium text-slate-800">{dataExportKindLabel(row.kind, locale)}</span>
                      <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${row.status === "ready" ? "bg-emerald-100 text-emerald-700" : row.status === "failed" ? "bg-red-100 text-red-600" : "bg-slate-200 text-slate-600"}`}>{dataExportStatusLabel(row.status, locale)}</span>
                      <span className="block text-xs text-slate-500">
                        {D.dataSizeLabel}{formatExportSize(row.sizeBytes, locale)}{D.dataCreatedLabel}{fmtDateTime(locale, row.createdAt)}
                        {row.completedAt ? `${D.dataCompletedLabel}${fmtDateTime(locale, row.completedAt)}` : ""}
                        {row.expiresAt ? `${D.dataExpiresLabel}${fmtDateTime(locale, row.expiresAt)}` : ""}
                      </span>
                      {row.status === "failed" && row.error ? <span className="block text-xs text-red-600">{row.error}</span> : null}
                      {row.backupVerifiedAt ? (
                        <span className={`block text-xs ${row.backupVerification?.ok ? "text-emerald-600" : "text-red-600"}`}>
                          {D.dataLastVerifyLabel}{fmtDateTime(locale, row.backupVerifiedAt)} — {row.backupVerification?.ok ? D.dataFileIntact : `${D.dataProblemsPrefix}${(row.backupVerification?.problems ?? []).join(", ") || D.dataUnknown}`}
                          {row.backupVerification?.truncatedTables?.length ? `${D.dataTruncatedTables}${row.backupVerification.truncatedTables.join(", ")}` : ""}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {canDownloadExport(row) ? (
                        <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => downloadExport(row)}>
                          {busy === `download-${row.id}` ? D.dataDownloading : dict.common.download}
                        </button>
                      ) : null}
                      {row.status === "ready" ? (
                        <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""}
                          onClick={() => { setVerifyRowId(verifyRowId === row.id ? "" : row.id); setVerifySlug(""); setVerifyResult(null); }}>
                          {D.dataVerifyBackup}
                        </button>
                      ) : null}
                    </span>
                    {verifyRowId === row.id ? (
                      <span className="block w-full rounded-lg bg-white px-3 py-2.5 ring-1 ring-inset ring-slate-200">
                        <span className="block text-xs text-slate-600">
                          {D.dataVerifyReadonlyA}
                          {orgSlug ? <> (<strong>{orgSlug}</strong>)</> : null}{D.dataVerifyReadonlyB}
                        </span>
                        <span className="mt-2 flex flex-wrap gap-2">
                          <input value={verifySlug} onChange={(e) => setVerifySlug(e.target.value)} className="min-h-[40px] flex-1 rounded-lg border border-slate-300 px-2.5 text-sm" placeholder="org slug" aria-label={D.dataVerifySlugAria} />
                          <button type="button" className="btn-primary btn-sm min-h-[40px]" disabled={busy !== "" || !verifySlug.trim()} onClick={() => verifyBackup(row)}>
                            {busy === `verify-${row.id}` ? D.dataVerifying : D.dataVerifyBtn}
                          </button>
                        </span>
                        {verifyResult ? (
                          <span className={`mt-2 block text-xs ${verifyResult.ok ? "text-emerald-600" : "text-red-600"}`}>
                            {verifyResult.ok ? D.dataFileIntactReadable : `${D.dataProblemsPrefix}${verifyResult.problems.join(", ")}`}
                            {verifyResult.truncatedTables.length ? `${D.dataTruncatedTables}${verifyResult.truncatedTables.join(", ")}` : ""}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-slate-100 pt-4">
            <h3 className="mb-1 text-sm font-semibold text-slate-700">{D.dataImportTitle}</h3>
            <p className="mb-3 text-sm text-slate-500">{D.dataImportIntro}</p>
            {myRole !== "OWNER" ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">{D.dataImportOwnerOnly}</p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="file"
                    accept=".json,application/json"
                    aria-label={D.dataImportPickFile}
                    className="text-sm text-slate-600 file:mr-2 file:min-h-[40px] file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700"
                    onChange={(e) => pickImportFile(e.target.files?.[0] ?? null)}
                  />
                  <button type="button" className="btn-secondary btn-sm min-h-[40px]" disabled={busy !== "" || !importText} onClick={validateImport}>
                    {busy === "import-validate" ? D.dataVerifying : D.dataVerifyBtn}
                  </button>
                </div>

                {importReport ? (
                  <div className="rounded-xl bg-slate-50 px-3.5 py-3 text-sm">
                    {importReport.source?.organizationName ? (
                      <p className="mb-2 text-slate-600">
                        {D.dataSourceOrg}<b>{importReport.source.organizationName}</b>
                        {importReport.source.exportedAt ? `${D.dataExportedAtLabel}${fmtDateTime(locale, importReport.source.exportedAt)}` : ""}
                      </p>
                    ) : null}
                    {importReport.errors.length > 0 ? (
                      <ul className="mb-2 list-inside list-disc space-y-1 text-red-600">
                        {importReport.errors.map((e) => <li key={e}>{dataImportErrorLabel(e, locale)}</li>)}
                      </ul>
                    ) : null}
                    {importReport.tables.length > 0 ? (
                      <ul className="space-y-1">
                        {importReport.tables.map((tb) => (
                          <li key={tb.table} className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-slate-700">{dataImportTableLabel(tb.table, locale)}</span>
                            {tb.action === "import" ? (
                              <span className="text-emerald-700">{t("settings.dataWillRestore", { count: fmtNumber(locale, tb.rows) })}</span>
                            ) : (
                              <span className="text-slate-400">{D.dataSkippedPrefix}{dataImportSkipReasonLabel(tb.reason, locale)}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {importReport.strippedSensitiveFields.length > 0 ? (
                      <p className="mt-2 text-xs text-amber-700">
                        {t("settings.dataStrippedNote", { fields: importReport.strippedSensitiveFields.join(", ") })}
                      </p>
                    ) : null}
                    {importReport.warnings.includes("duplicate_product_slugs") ? (
                      <p className="mt-2 text-xs text-amber-700">{D.dataDupSlugWarn}</p>
                    ) : null}
                    {importReport.valid ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-slate-600">{t("settings.dataTotalRestore", { count: fmtNumber(locale, importReport.totalImportRows) })}</span>
                        <button type="button" className="btn-primary btn-sm min-h-[40px]" disabled={busy !== ""} onClick={runImport}>
                          {busy === "import-run" ? D.dataImporting : D.dataImportConfirmBtn}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {importJob ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {D.dataLastImport}<b>{dataImportJobStatusLabel(importJob.status, locale)}</b>
                    {importJob.sourceOrgName ? `${D.dataSourceLabel}${importJob.sourceOrgName}` : ""}
                    {importJob.completedAt ? ` · ${fmtDateTime(locale, importJob.completedAt)}` : ""}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <p className="text-sm text-slate-600">
            {D.dataAuditNote}
            <a href="/dashboard/settings/audit-logs" className="font-semibold text-indigo-700 hover:underline">{D.dataAuditLink}</a>
          </p>
        </div>
      )}
    </section>
  );
}

const ORG_CURRENCIES = [
  "BDT", "USD", "EUR", "GBP", "INR", "PKR", "LKR", "NPR", "AED", "SAR", "QAR", "KWD", "OMR",
  "MYR", "SGD", "THB", "VND", "IDR", "PHP", "CNY", "JPY", "KRW", "AUD", "CAD", "CHF",
  "SEK", "NOK", "DKK", "TRY", "ZAR", "NGN", "KES", "EGP",
] as const;

function orgTimezones(current: string): string[] {
  let list: string[] = [];
  try {
    const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof sv === "function") list = sv("timeZone");
  } catch { list = []; }
  if (!list.length) list = ["Asia/Dhaka", "Asia/Kolkata", "Asia/Karachi", "Asia/Dubai", "UTC"];
  return list.includes(current) ? list : [current, ...list];
}

interface OrgIdentity {
  name: string; slug: string; currency: string; timezone: string; country: string;
}

/**
 * ORG5 (Organization Next OB2): the organization's legal name
 * and regional defaults. Until now these four fields could only
 * be set at create time — this card writes them through
 * PATCH /organizations/:id/identity (OWNER/ADMIN; the card hides
 * for everyone else, and the API refuses them anyway). The slug
 * is shown read-only: TD decided slugs are immutable, so there
 * is deliberately no edit affordance for it here. The currency
 * warning is part of the semantics, not decoration: a change
 * moves only the default going forward.
 */
function OrgIdentityCard() {
  const { dict, t, locale } = useLocale();
  const D = dict.settings;
  const [org, setOrg] = useState<OrgIdentity | null>(null);
  const [myRole, setMyRole] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("BDT");
  const [timezone, setTimezone] = useState("Asia/Dhaka");
  const [country, setCountry] = useState("BD");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoaded(true); return; }
    try {
      const [o, mine] = await Promise.all([
        apiFetch<OrgIdentity>(`/organizations/${orgId}`),
        apiFetch<{ id: string; myRole: string }[]>(`/organizations`).catch(() => [] as { id: string; myRole: string }[]),
      ]);
      setOrg(o);
      setName(o.name ?? "");
      setCurrency(o.currency ?? "BDT");
      setTimezone(o.timezone ?? "Asia/Dhaka");
      setCountry(o.country ?? "BD");
      setMyRole((mine as { id: string; myRole: string }[]).find((x) => x.id === orgId)?.myRole ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : D.loadFailed); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setMsg(""); setError("");
    try {
      const out = await apiFetch<{ changedFields?: string[]; unchanged?: boolean }>(`/organizations/${orgId}/identity`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), currency, timezone, country: country.trim().toUpperCase() }),
      });
      if (out.unchanged || !out.changedFields?.length) {
        setMsg(D.orgIdNoChange);
      } else {
        setMsg(D.orgIdSaved);
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.saveFailed); }
    finally { setBusy(false); }
  }

  if (!loaded) return null;
  if (myRole !== "OWNER" && myRole !== "ADMIN") return null;
  if (!org) return null;
  const currencies = ORG_CURRENCIES.includes(currency as (typeof ORG_CURRENCIES)[number]) ? [...ORG_CURRENCIES] : [currency, ...ORG_CURRENCIES];

  return (
    <section id="hub-org-identity" className="card scroll-mt-24 p-5 sm:p-6">
      <SectionHead icon="🏢" title={D.orgIdTitle} hint={D.orgIdHint} />
      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4">
          <label className="block min-w-56 flex-1 text-sm text-slate-600">{D.orgIdNameLabel}
            <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={D.orgIdNamePlaceholder} />
            <span className="mt-1 block text-xs text-slate-400">{D.orgIdNameHint}</span>
          </label>
          <label className="block text-sm text-slate-600">{D.orgIdSlugLabel}
            <input className="input mt-1 bg-slate-50 font-mono" value={org.slug} readOnly disabled />
            <span className="mt-1 block text-xs text-slate-400">{t("settings.orgIdSlugHint", { slug: org.slug })}</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="block text-sm text-slate-600">{D.orgIdCurrencyLabel}
            <select className="input mt-1" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block min-w-56 flex-1 text-sm text-slate-600">Timezone
            <select className="input mt-1" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {orgTimezones(timezone).map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </label>
          <label className="block text-sm text-slate-600">{D.orgIdCountryLabel}
            <input className="input mt-1 w-24 uppercase" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} placeholder="BD" />
          </label>
        </div>
        <div className="rounded-xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
          ⚠️ <b>{D.orgIdCurrencyWarnA}</b>{D.orgIdCurrencyWarnB}<b>{D.orgIdCurrencyWarnC}</b>{D.orgIdCurrencyWarnD}
        </div>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? D.waitPlease : D.orgIdSaveBtn}</button>
      </div>
    </section>
  );
}

/**
 * ORG3 (Organization Next OB1): organization lifecycle — the
 * OWNER can archive the workspace (work pauses, data intact,
 * TenantGuard enforces it) and restore it from the dashboard's
 * archived screen or here. Permanent close is deliberately NOT
 * self-serve: the card explains the honest path — export first,
 * then the platform team performs the deletion (which also
 * places the slug on its 180-day hold).
 */
interface OrgSecurityPolicy {
  requireMfa: boolean;
  sessionMaxAgeHours: number | null;
  myTotpEnabled: boolean;
  myMfaBlocked: boolean;
  mySessionBlocked: boolean;
}

/**
 * ORG11 (Organization Next OB4): the organization's security
 * policy — an MFA requirement for every member and a cap on how
 * old a member's session may be inside THIS org. Reading the
 * policy is open to every member (GET), changing it is OWNER-only
 * (PATCH; the API refuses everyone else), so non-owners see this
 * card read-only. The self-lockout rule is enforced by the API
 * and mirrored in the copy: the owner must have their own MFA on
 * before the requirement can be switched on.
 */
function OrgSecurityPolicyCard() {
  const { dict, t, locale } = useLocale();
  const D = dict.settings;
  const [policy, setPolicy] = useState<OrgSecurityPolicy | null>(null);
  const [myRole, setMyRole] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [requireMfa, setRequireMfa] = useState(false);
  const [capText, setCapText] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoaded(true); return; }
    try {
      const [pol, mine] = await Promise.all([
        apiFetch<OrgSecurityPolicy>(`/organizations/${orgId}/security-policy`),
        apiFetch<{ id: string; myRole: string }[]>(`/organizations`).catch(() => [] as { id: string; myRole: string }[]),
      ]);
      setPolicy(pol);
      setRequireMfa(pol.requireMfa);
      setCapText(pol.sessionMaxAgeHours === null ? "" : String(pol.sessionMaxAgeHours));
      setMyRole((mine as { id: string; myRole: string }[]).find((x) => x.id === orgId)?.myRole ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : D.loadFailed); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const capTrim = capText.trim();
    let cap: number | null = null;
    if (capTrim !== "") {
      cap = Number(capTrim);
      if (!Number.isInteger(cap) || cap < 1 || cap > 720) {
        setError(D.secPolCapError);
        return;
      }
    }
    setBusy(true); setMsg(""); setError("");
    try {
      const out = await apiFetch<OrgSecurityPolicy & { changedFields?: string[]; unchanged?: boolean }>(`/organizations/${orgId}/security-policy`, {
        method: "PATCH",
        body: JSON.stringify({ requireMfa, sessionMaxAgeHours: cap }),
      });
      setMsg(out.unchanged || !out.changedFields?.length ? D.secPolNoChange : D.secPolSaved);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.saveFailed); }
    finally { setBusy(false); }
  }

  if (!loaded || !policy) return null;
  const isOwner = myRole === "OWNER";
  return (
    <section id="hub-org-security-policy" className="card scroll-mt-24 p-5 sm:p-6">
      <SectionHead icon="🛡️" title={D.secPolTitle} hint={D.secPolHint} />
      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}
      <div className="space-y-4">
        <label className="flex items-start justify-between gap-4 text-sm text-slate-600">
          <span>
            <b className="text-slate-800">{D.secPolMfaLabel}</b>
            <span className="mt-1 block text-xs leading-relaxed text-slate-400">
              {D.secPolMfaDescA}<a className="font-medium underline" href="#hub-my-security">{D.secPolMfaDescLink}</a>{D.secPolMfaDescB}
              {isOwner && !policy.myTotpEnabled ? <span className="mt-1 block font-medium text-amber-600">{D.secPolMfaOwnerWarn}</span> : null}
            </span>
          </span>
          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={requireMfa} disabled={!isOwner || busy} onChange={(e) => setRequireMfa(e.target.checked)} />
        </label>
        <label className="block text-sm text-slate-600">{D.secPolSessionLabel}
          <input className="input mt-1 w-44" inputMode="numeric" placeholder={D.secPolSessionPlaceholder} value={capText} disabled={!isOwner || busy} onChange={(e) => setCapText(e.target.value)} />
          <span className="mt-1 block text-xs leading-relaxed text-slate-400">{D.secPolSessionHint}</span>
        </label>
        {isOwner ? (
          <button type="button" className="btn-primary min-h-[44px] px-5" disabled={busy} onClick={save}>{busy ? D.savingEllipsis : D.secPolSaveBtn}</button>
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
            {D.secPolStatePrefix}<b>{policy.requireMfa ? D.stateOn : D.stateOff}</b>{D.secPolStateMid}<b>{policy.sessionMaxAgeHours === null ? D.secPolStateNone : t("settings.secPolStateHours", { hours: fmtNumber(locale, policy.sessionMaxAgeHours) })}</b>{D.secPolStateSuffix}
          </p>
        )}
      </div>
    </section>
  );
}

function OrgLifecycleCard() {
  const { dict, t, locale } = useLocale();
  const D = dict.settings;
  const [org, setOrg] = useState<{ name: string; status: string; archivedAt: string | null } | null>(null);
  const [myRole, setMyRole] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoaded(true); return; }
    try {
      const [o, mine] = await Promise.all([
        apiFetch<{ name: string; status: string; archivedAt: string | null }>(`/organizations/${orgId}`),
        apiFetch<{ id: string; myRole: string }[]>(`/organizations`).catch(() => [] as { id: string; myRole: string }[]),
      ]);
      setOrg(o);
      setMyRole((mine as { id: string; myRole: string }[]).find((x) => x.id === orgId)?.myRole ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : D.loadFailed); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function archive() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("archive"); setMsg(""); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/archive`, { method: "POST" });
      // The dashboard gate takes over from here (archived screen).
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : D.lifeArchiveFailed); setBusy(""); }
  }

  async function restore() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("restore"); setMsg(""); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/restore`, { method: "POST" });
      setConfirming(false);
      setMsg(D.lifeRestored);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.lifeRestoreFailed); }
    finally { setBusy(""); }
  }

  if (!loaded) return null;
  if (myRole !== "OWNER" && myRole !== "ADMIN") return null;
  const archived = Boolean(org?.archivedAt);

  return (
    <section id="hub-org-lifecycle" className="card scroll-mt-24 p-5 sm:p-6">
      <SectionHead icon="🗄️" title={D.lifeTitle} hint={D.lifeHint} />
      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}

      <div className="space-y-5">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-700">{D.lifeArchiveTitle}</h3>
          {archived ? (
            <>
              <p className="mb-3 text-sm text-slate-600">
                {D.lifeArchivedA}<b>{D.lifeArchivedBold}</b>{t("settings.lifeArchivedB", { date: org?.archivedAt ? fmtDateTime(locale, org.archivedAt) : "" })}
              </p>
              {myRole === "OWNER" ? (
                <button type="button" className="btn-primary btn-sm min-h-[40px]" disabled={busy !== ""} onClick={restore}>
                  {busy === "restore" ? D.waitPlease : D.lifeRestoreBtn}
                </button>
              ) : <p className="text-sm text-slate-500">{D.lifeRestoreOwnerOnly}</p>}
            </>
          ) : (
            <>
              <p className="mb-3 text-sm leading-relaxed text-slate-600">
                {D.lifeArchiveWarnA}<b>{D.lifeArchiveWarnBold1}</b>{D.lifeArchiveWarnB}<b>{D.lifeArchiveWarnBold2}</b>{D.lifeArchiveWarnC}
              </p>
              {myRole === "OWNER" ? (
                !confirming ? (
                  <button type="button" className="btn-secondary btn-sm min-h-[40px]" disabled={busy !== ""} onClick={() => setConfirming(true)}>
                    {D.lifeArchiveBtn}
                  </button>
                ) : (
                  <div className="space-y-3 rounded-xl bg-amber-50 p-4">
                    <p className="text-sm text-amber-900">
                      {D.lifeConfirmA}<b>{org?.name}</b>{D.lifeConfirmB}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-primary btn-sm min-h-[40px]" disabled={busy !== ""} onClick={archive}>
                        {busy === "archive" ? D.lifeArchiving : D.lifeArchiveYes}
                      </button>
                      <button type="button" className="btn-secondary btn-sm min-h-[40px]" disabled={busy !== ""} onClick={() => setConfirming(false)}>{D.lifeNeverMind}</button>
                    </div>
                  </div>
                )
              ) : <p className="text-sm text-slate-500">{D.lifeAdminNote}</p>}
            </>
          )}
        </div>

        <div className="border-t border-slate-100 pt-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">{D.lifeCloseTitle}</h3>
          <p className="text-sm leading-relaxed text-slate-600">{D.lifeCloseIntro}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-slate-600">
            <li>{D.lifeCloseStep1A}<a href="#hub-data-tools" className="font-semibold text-indigo-700 hover:underline">{D.lifeCloseStep1Link}</a>{D.lifeCloseStep1B}</li>
            <li>{D.lifeCloseStep2}</li>
            <li>{D.lifeCloseStep3A}<b>{D.lifeCloseStep3Bold}</b>{D.lifeCloseStep3B}</li>
          </ol>
        </div>
      </div>
    </section>
  );
}

/** Organization Design v2 (2026-10-11): the Command Center in a
 * modern, fully responsive shell — gradient brain hero with a
 * progress ring, sticky section navigation (sidebar on desktop,
 * chip rail on mobile), icon-headed section cards and a sticky
 * save bar. ALL form logic, endpoints and handlers are the
 * Milestone 75/77 ones, unchanged — presentation only. */
const HUB_NAV = [
  { id: "hub-brain", icon: "🧠", labelKey: "hubBrain" },
  { id: "hub-identity", icon: "🏪", labelKey: "hubIdentity" },
  { id: "hub-contact", icon: "📍", labelKey: "hubContact" },
  { id: "hub-delivery", icon: "🚚", labelKey: "hubDelivery" },
  { id: "hub-payment", icon: "💳", labelKey: "hubPayment" },
  { id: "hub-ai", icon: "🤖", labelKey: "hubAi" },
  { id: "hub-knowledge", icon: "📚", labelKey: "hubKnowledge" },
  { id: "hub-ai-learning", icon: "🧠", labelKey: "hubAiLearning" },
  { id: "hub-ai-control", icon: "🎛️", labelKey: "hubAiControl" },
  { id: "hub-org-identity", icon: "🏢", labelKey: "hubOrgIdentity" },
  { id: "hub-language", icon: "🌐", labelKey: "hubLanguage" },
  { id: "hub-branding", icon: "🎨", labelKey: "hubBranding" },
  { id: "hub-org-verification", icon: "🏅", labelKey: "hubOrgVerification" },
  { id: "hub-verification", icon: "✅", labelKey: "hubVerification" },
  { id: "hub-security", icon: "🔐", labelKey: "hubSecurity" },
  { id: "hub-my-security", icon: "🖥️", labelKey: "hubMySecurity" },
  { id: "hub-developer-api", icon: "🔑", labelKey: "hubDeveloperApi" },
  { id: "hub-data-tools", icon: "💾", labelKey: "hubDataTools" },
  { id: "hub-org-lifecycle", icon: "🗄️", labelKey: "hubLifecycle" },
] as const;

/**
 * GB6 (GC16): my sessions + login history + notification
 * preferences (per current organization).
 *
 * Own-session revoke choice (from AuthService.revokeMySession):
 * the API revokes ANY of the caller's own sessions, including
 * the current one — revoking the current session would
 * invalidate the token in use and log the user out on the spot.
 * The UI therefore disables revoke on the current session with
 * an explanatory note instead of offering a one-click logout.
 */
function MySecurityCard() {
  const { dict, t, locale } = useLocale();
  const D = dict.settings;
  const [sessions, setSessions] = useState<OwnSession[]>([]);
  const [history, setHistory] = useState<LoginHistoryRow[]>([]);
  const [muted, setMuted] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    try {
      const [s, h] = await Promise.all([
        apiFetch<OwnSession[]>("/auth/sessions"),
        apiFetch<LoginHistoryRow[]>("/auth/login-history"),
      ]);
      setSessions(s); setHistory(h);
      if (orgId) {
        const prefs = await apiFetch<{ mutedCategories: string[] }>(`/organizations/${orgId}/my-notification-preferences`);
        setMuted(prefs.mutedCategories ?? []);
      }
    } catch (e) { setError(e instanceof Error ? e.message : D.loadFailed); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function revokeSession(s: OwnSession) {
    setBusy(`session-${s.id}`); setMsg(""); setError("");
    try {
      await apiFetch(`/auth/sessions/${s.id}`, { method: "DELETE" });
      setMsg(D.mySecRevoked);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.mySecRevokeFailed); }
    finally { setBusy(""); }
  }

  async function toggleCategory(key: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const next = toggleMutedCategory(muted, key);
    setBusy(`cat-${key}`); setMsg(""); setError("");
    try {
      const out = await apiFetch<{ mutedCategories: string[] }>(`/organizations/${orgId}/my-notification-preferences`, {
        method: "PATCH", body: JSON.stringify({ mutedCategories: next }),
      });
      setMuted(out.mutedCategories ?? next);
      setMsg(D.mySecPrefsSaved);
    } catch (e) { setError(e instanceof Error ? e.message : D.saveFailed); }
    finally { setBusy(""); }
  }

  return (
    <section id="hub-my-security" className="card scroll-mt-24 p-5 sm:p-6">
      <SectionHead icon="🖥️" title={D.mySecTitle} hint={D.mySecHint} />
      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}
      {!loaded ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : (
        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("settings.mySecActiveSessions", { count: fmtNumber(locale, sessions.length) })}</h3>
            {sessions.length === 0 ? <p className="text-sm text-slate-400">{D.mySecNoSessions}</p> : sessions.map((s) => (
              <div key={s.id} className="mb-1.5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{s.ip ?? D.mySecIpUnknown}</span>
                  {s.current ? <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">{D.mySecCurrent}</span> : null}
                  <span className="block max-w-lg truncate text-[11px] text-slate-400" title={s.userAgent ?? ""}>{s.userAgent ?? D.mySecDeviceUnknown}</span>
                  <span className="block text-[11px] text-slate-400">{D.mySecStartedLabel}{fmtDateTime(locale, s.createdAt)}{D.mySecLastSeenLabel}{fmtDateTime(locale, s.lastSeenAt)}</span>
                </span>
                {canRevokeOwnSession(s) ? (
                  <button className="btn-secondary btn-sm text-red-600" disabled={busy !== ""} onClick={() => revokeSession(s)}>{D.mySecRevokeBtn}</button>
                ) : (
                  <span className="max-w-56 text-right text-[11px] text-slate-400">{D.mySecCurrentNote}</span>
                )}
              </div>
            ))}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">{D.mySecHistoryTitle}</h3>
            {history.length === 0 ? <p className="text-sm text-slate-400">{D.mySecNoHistory}</p> : (
              <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
                {history.map((h, i) => (
                  <li key={h.id ?? i} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${h.success ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>{h.success ? D.mySecSuccess : D.mySecFailed}</span>
                    <span className="text-slate-600">{h.ip ?? D.mySecIpUnknown}</span>
                    <span className="max-w-52 truncate text-[11px] text-slate-400" title={h.userAgent ?? ""}>{h.userAgent ?? ""}</span>
                    <span className="text-[11px] text-slate-400">{fmtDateTime(locale, h.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-slate-400">{D.mySecHistoryNote}</p>
          </div>

          <div>
            <h3 className="mb-1 text-sm font-semibold">{D.mySecNotifTitle}</h3>
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{D.mySecNotifNote}</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {NOTIFICATION_CATEGORIES.map((c) => {
                const enabled = isCategoryEnabled(muted, c.key);
                return (
                  <label key={c.key} className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-100">
                    <span>{locale === "en" ? c.label : c.labelBn}</span>
                    <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={enabled} disabled={busy !== ""}
                      onChange={() => toggleCategory(c.key)} aria-label={t("settings.mySecNotifAria", { label: locale === "en" ? c.label : c.labelBn })} />
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

interface MeVerification {
  email: string; emailVerifiedAt: string | null; phone: string | null; phoneVerifiedAt: string | null;
}

/**
 * GC21 (GB9): account verification — email status + resend, and
 * the phone OTP inline flow. The API is honest about platform
 * SMS availability (reason "sms_not_configured"); the card shows
 * that state plainly instead of pretending a code was sent.
 */
function AccountVerificationCard() {
  const { dict, t, locale } = useLocale();
  const D = dict.settings;
  const [me, setMe] = useState<MeVerification | null>(null);
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [smsUnavailable, setSmsUnavailable] = useState(false);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const m = await apiFetch<MeVerification>("/auth/me");
      setMe(m);
      setPhone((prev) => prev || (m.phone ?? ""));
    } catch (e) { setError(e instanceof Error ? e.message : D.loadFailed); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function resendEmail() {
    setBusy("email"); setMsg(""); setError("");
    try {
      const out = await apiFetch<{ sent: boolean; reason?: string }>("/auth/verification/email", { method: "POST" });
      if (out.sent) setMsg(D.acctVerEmailResent);
      else if (out.reason === "already_verified") setMsg(D.acctVerEmailAlready);
      else setError(D.acctVerEmailFailed);
    } catch (e) { setError(e instanceof Error ? e.message : D.sendFailed); }
    finally { setBusy(""); }
  }

  async function savePhone() {
    setBusy("phone"); setMsg(""); setError("");
    try {
      const out = await apiFetch<{ phone: string; phoneVerifiedAt: string | null }>("/auth/verification/phone", {
        method: "POST", body: JSON.stringify({ phone }),
      });
      setPhone(out.phone);
      setMsg(D.acctVerPhoneSaved);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.saveFailed); }
    finally { setBusy(""); }
  }

  async function requestOtp() {
    setBusy("otp"); setMsg(""); setError(""); setSmsUnavailable(false);
    try {
      const out = await apiFetch<{ sent: boolean; reason?: string }>("/auth/verification/phone/otp", { method: "POST" });
      if (out.sent) { setOtpSent(true); setMsg(D.acctVerOtpSent); }
      else if (out.reason === "sms_not_configured") setSmsUnavailable(true);
      else if (out.reason === "already_verified") setMsg(D.acctVerPhoneAlready);
      else setError(D.acctVerSmsFailed);
    } catch (e) { setError(e instanceof Error ? e.message : D.acctVerOtpFailed); }
    finally { setBusy(""); }
  }

  async function verifyOtp() {
    setBusy("verify"); setMsg(""); setError("");
    try {
      await apiFetch("/auth/verification/phone/verify", { method: "POST", body: JSON.stringify({ code }) });
      setOtpSent(false); setCode("");
      setMsg(D.acctVerPhoneVerified);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.acctVerCodeMismatch); }
    finally { setBusy(""); }
  }

  return (
    <section id="hub-verification" className="card scroll-mt-24 p-5 sm:p-6">
      <SectionHead icon="✅" title={D.acctVerTitle} hint={D.acctVerHint} />
      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}
      {!me ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-700">{D.acctVerEmailLabel}<span className="font-semibold">{me.email}</span></div>
              <div className="text-xs text-slate-500">{me.emailVerifiedAt ? t("settings.acctVerVerifiedAt", { date: fmtDateTime(locale, me.emailVerifiedAt) }) : D.acctVerNotVerifiedYet}</div>
            </div>
            {me.emailVerifiedAt
              ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">{D.acctVerVerifiedBadge}</span>
              : <button className="btn-primary btn-sm min-h-[40px]" disabled={busy !== ""} onClick={resendEmail}>{busy === "email" ? D.acctVerSending : D.acctVerResendBtn}</button>}
          </div>

          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-700">{D.acctVerPhoneLabel}</span>
              {me.phoneVerifiedAt
                ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">{D.acctVerVerifiedBadge}</span>
                : <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">{D.acctVerPendingBadge}</span>}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-sm text-slate-600">{D.acctVerNumberLabel}
                <input className="input mt-1 w-56" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" inputMode="tel" />
              </label>
              <button className="btn-secondary min-h-[44px]" disabled={busy !== "" || !phone.trim()} onClick={savePhone}>{busy === "phone" ? D.waitPlease : D.acctVerSaveNumberBtn}</button>
              {!me.phoneVerifiedAt ? (
                <button className="btn-primary min-h-[44px]" disabled={busy !== "" || !me.phone} onClick={requestOtp}>{busy === "otp" ? D.acctVerSending : D.acctVerSendOtpBtn}</button>
              ) : null}
            </div>
            {smsUnavailable ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{D.acctVerSmsUnavailable}</p>
            ) : null}
            {otpSent && !me.phoneVerifiedAt ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="block text-sm text-slate-600">{D.acctVerOtpLabel}
                  <input className="input mt-1 w-44 tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={6} inputMode="numeric" />
                </label>
                <button className="btn-primary min-h-[44px]" disabled={busy !== "" || code.trim().length < 6} onClick={verifyOtp}>{busy === "verify" ? D.dataVerifying : D.acctVerVerifyCodeBtn}</button>
                <span className="text-xs text-slate-400">{D.acctVerOtpNote}</span>
              </div>
            ) : null}
            {!me.phone ? <p className="mt-2 text-xs text-slate-400">{D.acctVerNoPhoneNote}</p> : null}
          </div>
        </div>
      )}
    </section>
  );
}

interface OrgVerificationState {
  verificationStatus: string; verificationNote: string | null; verificationSubmittedAt: string | null;
}

function formatBytesLoc(locale: UiLocale, bytesStr: string): string {
  const D = locale === "en" ? settingsEn : settingsBn;
  const n = Number(bytesStr);
  if (!Number.isFinite(n) || n <= 0) return D.zeroBytes;
  const units = [D.orgVerUnitByte, "KB", "MB", "GB", "TB"];
  let v = n; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${fmtNumber(locale, v, { maximumFractionDigits: 2 })} ${units[i]}`;
}

/**
 * GC21 (GB9): merchant (organization) verification + recorded
 * storage usage. Submit goes to the API, which validates the
 * Business Profile pieces and names anything missing in Bengali;
 * a rejected submission shows the admin's note verbatim so the
 * merchant knows exactly what to fix.
 */
function OrgVerificationCard() {
  const { dict, t, locale } = useLocale();
  const D = dict.settings;
  const [org, setOrg] = useState<OrgVerificationState | null>(null);
  const [storage, setStorage] = useState<{ storageBytes: string; assetCount: number; meteredFrom: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const [o, s] = await Promise.all([
        apiFetch<OrgVerificationState>(`/organizations/${orgId}`),
        apiFetch<{ storageBytes: string; assetCount: number; meteredFrom: string }>(`/organizations/${orgId}/storage-usage`).catch(() => null),
      ]);
      setOrg(o); setStorage(s);
    } catch (e) { setError(e instanceof Error ? e.message : D.loadFailed); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function submit() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setMsg(""); setError("");
    try {
      const out = await apiFetch<OrgVerificationState>(`/organizations/${orgId}/verification/submit`, { method: "POST" });
      setOrg(out);
      setMsg(D.orgVerSubmitted);
    } catch (e) { setError(e instanceof Error ? e.message : D.orgVerSubmitFailed); }
    finally { setBusy(false); }
  }

  const badge = (status: string) => {
    switch (status) {
      case "verified": return <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">{D.orgVerBadgeVerified}</span>;
      case "pending": return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">{D.orgVerBadgePending}</span>;
      case "rejected": return <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">{D.orgVerBadgeRejected}</span>;
      default: return <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600">{D.orgVerBadgeNone}</span>;
    }
  };

  return (
    <section id="hub-org-verification" className="card scroll-mt-24 p-5 sm:p-6">
      <SectionHead icon="🏅" title={D.orgVerTitle} hint={D.orgVerHint} />
      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}
      {!org ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-slate-700">{D.orgVerCurrentStatus}</span>
            {badge(org.verificationStatus)}
            {org.verificationSubmittedAt ? <span className="text-xs text-slate-400">{t("settings.orgVerLastSubmit", { date: fmtDateTime(locale, org.verificationSubmittedAt) })}</span> : null}
          </div>
          {org.verificationStatus === "rejected" && org.verificationNote ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{t("settings.orgVerNoteRejected", { note: org.verificationNote })}</p>
          ) : null}
          {org.verificationStatus === "verified" && org.verificationNote ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{t("settings.orgVerNote", { note: org.verificationNote })}</p>
          ) : null}
          {org.verificationStatus !== "verified" ? (
            <button className="btn-primary min-h-[44px]" disabled={busy} onClick={submit}>
              {busy ? D.waitPlease : org.verificationStatus === "pending" ? D.orgVerResubmit : org.verificationStatus === "rejected" ? D.orgVerFixResubmit : D.orgVerSubmitBtn}
            </button>
          ) : null}

          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <div className="text-sm font-medium text-slate-700">{D.orgVerStorageTitle}</div>
            {storage ? (
              <p className="mt-1 text-sm text-slate-600">
                {D.orgVerStorageInLibrary}<b>{formatBytesLoc(locale, storage.storageBytes)}</b>{t("settings.orgVerStorageFiles", { count: fmtNumber(locale, storage.assetCount) })}
                <span className="block text-xs text-slate-400">{storage.meteredFrom}{D.orgVerBandwidthNote}</span>
              </p>
            ) : <p className="mt-1 text-sm text-slate-400">{D.orgVerStorageLoadFailed}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function SectionHead({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="stat-icon stat-icon-brand !h-10 !w-10 text-lg">{icon}</span>
      <div className="min-w-0">
        <h2 className="font-semibold leading-tight text-slate-900">{title}</h2>
        {hint ? <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{hint}</p> : null}
      </div>
    </div>
  );
}

const HUB_DAYS = [
  { key: "sat", labelKey: "daySat" }, { key: "sun", labelKey: "daySun" }, { key: "mon", labelKey: "dayMon" },
  { key: "tue", labelKey: "dayTue" }, { key: "wed", labelKey: "dayWed" }, { key: "thu", labelKey: "dayThu" }, { key: "fri", labelKey: "dayFri" },
] as const;

function BusinessHub() {
  const { dict, t, locale } = useLocale();
  const D = dict.settings;
  const [form, setForm] = useState<Record<string, string>>({});
  const [cod, setCod] = useState(false);
  const [hours, setHours] = useState<Record<string, { on: boolean; start: string; end: string }>>({});
  const [hoursTz, setHoursTz] = useState("Asia/Dhaka");
  const [hoursTouched, setHoursTouched] = useState(false);
  const [comp, setComp] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const [p, c] = await Promise.all([
        apiFetch<any>(`/organizations/${orgId}/business-profile`).catch(() => null),
        apiFetch<any>(`/organizations/${orgId}/business-profile/completeness`).catch(() => null),
      ]);
      setComp(c);
      if (p) {
        const taka = (v: unknown) => (v == null ? "" : String(Math.round(Number(v) / 100)));
        setForm({
          description: p.description ?? "", industry: p.industry ?? "", businessModel: p.businessModel ?? "",
          websiteUrl: p.websiteUrl ?? "", brandVoice: p.brandVoice ?? "", uniqueSellingPoints: p.uniqueSellingPoints ?? "",
          goals: p.goals ?? "", contactEmail: p.contactEmail ?? "", contactPhone: p.contactPhone ?? "",
          address: p.address ?? "", city: p.city ?? "",
          tradeLicenseNo: p.tradeLicenseNo ?? "", businessAddress: p.businessAddress ?? "",
          deliveryChargeInside: taka(p.deliveryChargeInsideMinor), deliveryChargeOutside: taka(p.deliveryChargeOutsideMinor),
          freeDeliveryAbove: taka(p.freeDeliveryAboveMinor), minOrder: taka(p.minOrderMinor),
          deliveryDaysInside: p.deliveryDaysInside != null ? String(p.deliveryDaysInside) : "",
          deliveryDaysOutside: p.deliveryDaysOutside != null ? String(p.deliveryDaysOutside) : "",
          bkashNumber: p.bkashNumber ?? "", nagadNumber: p.nagadNumber ?? "", paymentNote: p.paymentNote ?? "",
          // GB3 (GC8): COD rules — minor -> taka for display, districts joined.
          codMaxOrder: taka(p.codMaxOrderMinor), codAdvanceAbove: taka(p.codAdvanceRequiredAboveMinor),
          codBlockedDistricts: Array.isArray(p.codBlockedDistricts) ? p.codBlockedDistricts.join(", ") : "",
          advancePaymentPercent: p.advancePaymentPercent != null ? String(p.advancePaymentPercent) : "",
          returnWindowDays: p.returnWindowDays != null ? String(p.returnWindowDays) : "",
          aiReplyLanguage: p.aiReplyLanguage ?? "auto",
          // AB4 (AX5): deposit config — the read exposes a nested
          // `deposit` object; flat fields are accepted as fallback.
          depositMode: p.deposit?.mode ?? p.depositMode ?? "",
          depositPercent: (p.deposit?.percent ?? p.depositPercent) != null ? String(p.deposit?.percent ?? p.depositPercent) : "",
          depositFixed: taka(p.deposit?.fixedMinor ?? p.depositFixedMinor),
          depositAppliesTo: p.deposit?.appliesTo ?? p.depositAppliesTo ?? "all",
          depositNote: p.deposit?.note ?? p.depositNote ?? "",
        });
        setCod(Boolean(p.codAvailable));
        if (p.businessHours?.windows) {
          const w = p.businessHours.windows as Record<string, [string, string][]>;
          const next: Record<string, { on: boolean; start: string; end: string }> = {};
          for (const d of HUB_DAYS) {
            const win = w[d.key]?.[0];
            next[d.key] = win ? { on: true, start: win[0], end: win[1] } : { on: false, start: "09:00", end: "21:00" };
          }
          setHours(next);
          setHoursTz(p.businessHours.timezone ?? "Asia/Dhaka");
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : D.loadFailed); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setMsg(""); setError("");
    const minor = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 100));
    const intOrNull = (v: string) => (v.trim() === "" ? null : Math.round(Number(v)));
    const body: Record<string, unknown> = {
      description: form.description, industry: form.industry, businessModel: form.businessModel,
      websiteUrl: form.websiteUrl, brandVoice: form.brandVoice, uniqueSellingPoints: form.uniqueSellingPoints,
      goals: form.goals, contactEmail: form.contactEmail, contactPhone: form.contactPhone,
      address: form.address, city: form.city,
      tradeLicenseNo: form.tradeLicenseNo, businessAddress: form.businessAddress,
      deliveryChargeInsideMinor: minor(form.deliveryChargeInside ?? ""), deliveryChargeOutsideMinor: minor(form.deliveryChargeOutside ?? ""),
      freeDeliveryAboveMinor: minor(form.freeDeliveryAbove ?? ""), minOrderMinor: minor(form.minOrder ?? ""),
      deliveryDaysInside: intOrNull(form.deliveryDaysInside ?? ""), deliveryDaysOutside: intOrNull(form.deliveryDaysOutside ?? ""),
      codAvailable: cod, bkashNumber: form.bkashNumber, nagadNumber: form.nagadNumber, paymentNote: form.paymentNote,
      // GB3 (GC8): COD rules — taka -> minor ints (empty = null/off);
      // districts split+trim+filter (empty = null).
      codMaxOrderMinor: minor(form.codMaxOrder ?? ""), codAdvanceRequiredAboveMinor: minor(form.codAdvanceAbove ?? ""),
      codBlockedDistricts: (form.codBlockedDistricts ?? "").split(",").map((s) => s.trim()).filter(Boolean).length
        ? (form.codBlockedDistricts ?? "").split(",").map((s) => s.trim()).filter(Boolean)
        : null,
      advancePaymentPercent: intOrNull(form.advancePaymentPercent ?? ""), returnWindowDays: intOrNull(form.returnWindowDays ?? ""),
      aiReplyLanguage: form.aiReplyLanguage ?? "auto",
      // AB4 (AX5): deposit config — flat fields on the profile
      // PATCH (mode "" = off/null; money taka -> paisa like the
      // neighbouring fields).
      depositMode: form.depositMode ? form.depositMode : null,
      depositPercent: intOrNull(form.depositPercent ?? ""),
      depositFixedMinor: minor(form.depositFixed ?? ""),
      depositAppliesTo: form.depositAppliesTo || "all",
      depositNote: form.depositNote ?? "",
    };
    if (hoursTouched) {
      const windows: Record<string, [string, string][]> = {};
      for (const d of HUB_DAYS) {
        const h = hours[d.key];
        if (h?.on) windows[d.key] = [[h.start, h.end]];
      }
      body.businessHours = { timezone: hoursTz, windows };
    }
    try {
      await apiFetch(`/organizations/${orgId}/business-profile`, { method: "PATCH", body: JSON.stringify(body) });
      setMsg(D.hubSaved);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.saveFailed); }
    finally { setBusy(false); }
  }

  const input = "input mt-1.5 w-full";
  const label = "block text-[13px] font-medium text-slate-600";
  const ring = comp ? 2 * Math.PI * 34 : 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      {comp ? (
        <section id="hub-brain" className="hero-panel scroll-mt-24 p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="relative mx-auto h-24 w-24 shrink-0 sm:mx-0">
              <svg viewBox="0 0 84 84" className="h-24 w-24 -rotate-90">
                <circle cx="42" cy="42" r="34" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="9" />
                <circle cx="42" cy="42" r="34" fill="none" stroke="#ffffff" strokeWidth="9" strokeLinecap="round"
                  strokeDasharray={ring} strokeDashoffset={ring - (ring * comp.percent) / 100} />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-xl font-black">{comp.percent}%</div>
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <h2 className="text-lg font-bold leading-tight">{D.hubBrainTitle}</h2>
              <p className="mx-auto mt-1 max-w-xl text-[13px] leading-relaxed text-white/85 sm:mx-0">
                {D.hubBrainTextA}{t("settings.hubBrainProgress", { done: fmtNumber(locale, comp.doneCount), total: fmtNumber(locale, comp.totalSections) })}
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                <span className="mr-1 self-center text-xs font-semibold text-white/80">{D.hubCanAnswerLabel}</span>
                {([["priceStock", "hubCapPriceStock"], ["delivery", "hubCapDelivery"], ["payment", "hubPayment"], ["contactHours", "hubContact"], ["faq", ""]] as const).map(([k, lk]) => (
                  <span key={k} className="hero-chip !px-2.5 !py-0.5">{comp.aiCanAnswer[k] ? "✓" : "✗"} {lk ? D[lk as keyof typeof D] : "FAQ"}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-5 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
            {comp.sections.map((s: any) => (
              <div key={s.key} className="flex items-start gap-2 rounded-xl bg-white/10 px-3 py-2 text-[13px] ring-1 ring-inset ring-white/15 backdrop-blur-sm">
                <span className="mt-px">{s.done ? "✅" : "⬜"}</span>
                <span className="min-w-0"><b className="font-semibold">{s.labelBn}</b>{s.done ? null : <span className="block text-xs leading-snug text-white/75">{s.missingBn}</span>}</span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="skeleton h-40 w-full" aria-label={D.hubLoadingAria} />
      )}

      {error ? <div className="alert alert-red">{error}</div> : null}
      {msg ? <div className="alert alert-green">{msg}</div> : null}

      <section id="hub-identity" className="card scroll-mt-24 p-5 sm:p-6">
        <SectionHead icon="🏪" title={D.hubIdentityTitle} hint={D.hubIdentityHint} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>{D.hubDescLabel}<textarea className={input} rows={3} value={form.description ?? ""} onChange={set("description")} placeholder={D.hubDescPlaceholder} /></label>
          <label className={label}>{D.hubIndustryLabel}<input className={input} value={form.industry ?? ""} onChange={set("industry")} placeholder={D.hubIndustryPlaceholder} /></label>
          <label className={label}>{D.hubModelLabel}<input className={input} value={form.businessModel ?? ""} onChange={set("businessModel")} placeholder={D.hubModelPlaceholder} /></label>
          <label className={label}>{D.hubVoiceLabel}<input className={input} value={form.brandVoice ?? ""} onChange={set("brandVoice")} placeholder={D.hubVoicePlaceholder} /></label>
          <label className={label}>{D.hubUspLabel}<input className={input} value={form.uniqueSellingPoints ?? ""} onChange={set("uniqueSellingPoints")} placeholder={D.hubUspPlaceholder} /></label>
          <label className={label}>{D.hubWebsiteLabel}<input className={input} value={form.websiteUrl ?? ""} onChange={set("websiteUrl")} placeholder="https://…" /></label>
          <label className={label}>{D.hubGoalsLabel}<input className={input} value={form.goals ?? ""} onChange={set("goals")} placeholder={D.hubGoalsPlaceholder} /></label>
          <label className={label}>{D.hubTradeLabel}<input className={input} value={form.tradeLicenseNo ?? ""} onChange={set("tradeLicenseNo")} placeholder={D.hubTradePlaceholder} /></label>
          <label className={label}>{D.hubBizAddressLabel}<input className={input} value={form.businessAddress ?? ""} onChange={set("businessAddress")} placeholder={D.hubBizAddressPlaceholder} /></label>
        </div>
        <p className="mt-3 text-xs text-slate-400">{D.hubTradeNote}</p>
      </section>

      <section id="hub-contact" className="card scroll-mt-24 p-5 sm:p-6">
        <SectionHead icon="📍" title={D.hubContactTitle} hint={D.hubContactHint} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>{D.hubContactPhone}<input className={input} value={form.contactPhone ?? ""} onChange={set("contactPhone")} placeholder="01XXXXXXXXX" /></label>
          <label className={label}>{D.hubContactEmail}<input className={input} value={form.contactEmail ?? ""} onChange={set("contactEmail")} placeholder="hello@shop.com" /></label>
          <label className={label}>{D.hubAddressLabel}<input className={input} value={form.address ?? ""} onChange={set("address")} placeholder={D.hubAddressPlaceholder} /></label>
          <label className={label}>{D.hubCityLabel}<input className={input} value={form.city ?? ""} onChange={set("city")} placeholder={D.hubCityPlaceholder} /></label>
        </div>
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] font-medium text-slate-600">
            {D.hubHoursLabel}
            <span className="font-normal text-slate-400">Timezone:
              <input className="input ml-1.5 w-40" value={hoursTz} onChange={(e) => { setHoursTz(e.target.value); setHoursTouched(true); }} />
            </span>
          </div>
          <div className="grid gap-1.5 md:grid-cols-2 2xl:grid-cols-3">
            {HUB_DAYS.map((d) => {
              const h = hours[d.key] ?? { on: false, start: "09:00", end: "21:00" };
              return (
                <div key={d.key} className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-2 text-sm ring-1 ring-inset ${h.on ? "bg-indigo-50/60 ring-indigo-100" : "bg-slate-50 ring-slate-100"}`}>
                  <label className="flex min-w-24 items-center gap-2 font-medium text-slate-700">
                    <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={h.on} onChange={(e) => { setHours({ ...hours, [d.key]: { ...h, on: e.target.checked } }); setHoursTouched(true); }} />
                    {D[d.labelKey as keyof typeof D]}
                  </label>
                  <span className="flex items-center gap-1.5">
                    <input type="time" className="input w-[7.5rem]" value={h.start} disabled={!h.on} onChange={(e) => { setHours({ ...hours, [d.key]: { ...h, start: e.target.value } }); setHoursTouched(true); }} />
                    <span className="text-slate-400">–</span>
                    <input type="time" className="input w-[7.5rem]" value={h.end} disabled={!h.on} onChange={(e) => { setHours({ ...hours, [d.key]: { ...h, end: e.target.value } }); setHoursTouched(true); }} />
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-400">{D.hubHoursNote}</p>
        </div>
      </section>

      <section id="hub-delivery" className="card scroll-mt-24 p-5 sm:p-6">
        <SectionHead icon="🚚" title={D.hubDelivery} hint={D.hubDeliveryHint} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <label className={label}>{D.hubDelInLabel}<input type="number" min={0} className={input} value={form.deliveryChargeInside ?? ""} onChange={set("deliveryChargeInside")} placeholder={fmtNumber(locale, 60)} /></label>
          <label className={label}>{D.hubDelOutLabel}<input type="number" min={0} className={input} value={form.deliveryChargeOutside ?? ""} onChange={set("deliveryChargeOutside")} placeholder={fmtNumber(locale, 120)} /></label>
          <label className={label}>{D.hubFreeDelLabel}<input type="number" min={0} className={input} value={form.freeDeliveryAbove ?? ""} onChange={set("freeDeliveryAbove")} placeholder={D.hubFreeDelPlaceholder} /></label>
          <label className={label}>{D.hubDaysInLabel}<input type="number" min={0} max={60} className={input} value={form.deliveryDaysInside ?? ""} onChange={set("deliveryDaysInside")} placeholder={D.hubDaysInPlaceholder} /></label>
          <label className={label}>{D.hubDaysOutLabel}<input type="number" min={0} max={60} className={input} value={form.deliveryDaysOutside ?? ""} onChange={set("deliveryDaysOutside")} placeholder={D.hubDaysOutPlaceholder} /></label>
          <label className={label}>{D.hubMinOrderLabel}<input type="number" min={0} className={input} value={form.minOrder ?? ""} onChange={set("minOrder")} placeholder={D.hubEmptyPlaceholder} /></label>
          <label className={label}>{D.hubReturnWindowLabel}<input type="number" min={0} max={365} className={input} value={form.returnWindowDays ?? ""} onChange={set("returnWindowDays")} placeholder={fmtNumber(locale, 7)} /></label>
        </div>
      </section>

      <section id="hub-payment" className="card scroll-mt-24 p-5 sm:p-6">
        <SectionHead icon="💳" title={D.hubPayment} hint={D.hubPaymentHint} />
        <label className="mb-4 flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-100">
          <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={cod} onChange={(e) => setCod(e.target.checked)} />
          {D.hubCodLabel}
        </label>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <label className={label}>{D.hubBkashLabel}<input className={input} value={form.bkashNumber ?? ""} onChange={set("bkashNumber")} placeholder="01XXXXXXXXX" /></label>
          <label className={label}>{D.hubNagadLabel}<input className={input} value={form.nagadNumber ?? ""} onChange={set("nagadNumber")} placeholder="01XXXXXXXXX" /></label>
          <label className={label}>{D.hubAdvancePctLabel}<input type="number" min={0} max={100} className={input} value={form.advancePaymentPercent ?? ""} onChange={set("advancePaymentPercent")} placeholder={D.hubAdvancePctPlaceholder} /></label>
          <label className={label}>{D.hubCodMaxLabel}<input type="number" min={0} className={input} value={form.codMaxOrder ?? ""} onChange={set("codMaxOrder")} placeholder={D.hubCodMaxPlaceholder} /></label>
          <label className={label}>{D.hubCodAdvanceLabel}<input type="number" min={0} className={input} value={form.codAdvanceAbove ?? ""} onChange={set("codAdvanceAbove")} placeholder={D.hubCodAdvancePlaceholder} /></label>
          <label className={label}>{D.hubCodBlockedLabel}<input className={input} value={form.codBlockedDistricts ?? ""} onChange={set("codBlockedDistricts")} placeholder={D.hubCodBlockedPlaceholder} />
            <span className="mt-1 block text-xs font-normal text-slate-400">{D.hubCodBlockedHint}</span>
          </label>
        </div>
        <label className={`${label} mt-4`}>{D.hubPaymentNoteLabel}<textarea className={input} rows={2} value={form.paymentNote ?? ""} onChange={set("paymentNote")} placeholder={D.hubPaymentNotePlaceholder} /></label>

        {/* AB4 (AX5): deposit / advance collection rules. */}
        <div className="mt-5 space-y-4 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-100">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{D.hubDepositTitle}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{D.hubDepositText}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <label className={label}>{D.hubDepositModeLabel}
              <select className={input} value={form.depositMode ?? ""} onChange={(e) => setForm({ ...form, depositMode: e.target.value })}>
                <option value="">{D.stateOff}</option>
                <option value="percent">{D.hubDepositPercentOpt}</option>
                <option value="fixed">{D.hubDepositFixedOpt}</option>
              </select>
            </label>
            {form.depositMode === "percent" ? (
              <label className={label}>{D.hubDepositPctLabel}<input type="number" min={1} max={90} className={input} value={form.depositPercent ?? ""} onChange={set("depositPercent")} placeholder={D.hubExample20} /></label>
            ) : null}
            {form.depositMode === "fixed" ? (
              <label className={label}>{D.hubDepositAmtLabel}<input type="number" min={0} className={input} value={form.depositFixed ?? ""} onChange={set("depositFixed")} placeholder={D.hubExample200} /></label>
            ) : null}
            <label className={label}>{D.hubDepositAppliesLabel}
              <select className={input} value={form.depositAppliesTo ?? "all"} onChange={(e) => setForm({ ...form, depositAppliesTo: e.target.value })}>
                <option value="cod">{D.hubDepositCodOnly}</option>
                <option value="online">{D.hubDepositOnlineOnly}</option>
                <option value="all">{dict.common.all}</option>
              </select>
            </label>
          </div>
          <label className={label}>{D.hubDepositNoteLabel}
            <textarea className={input} rows={2} value={form.depositNote ?? ""} onChange={set("depositNote")} placeholder={D.hubDepositNotePlaceholder} />
            <span className="mt-1 block text-xs font-normal text-slate-400">{D.hubDepositNoteHint}</span>
          </label>
        </div>
      </section>

      <section id="hub-ai" className="card scroll-mt-24 p-5 sm:p-6">
        <SectionHead icon="🤖" title={D.hubAiTitle} hint={D.hubAiHint} />
        <div className="grid gap-4">
          <div className="rounded-xl bg-indigo-50/70 px-4 py-3.5 ring-1 ring-inset ring-indigo-100">
            <p className="text-sm leading-relaxed text-slate-700">
              {D.hubAiDeskA}<b>{D.hubAiDeskBold}</b>{D.hubAiDeskB}
            </p>
            <a href="/dashboard/ai-instructions" className="btn-secondary mt-3 inline-flex min-h-[40px] items-center px-4 text-sm">{D.hubAiDeskLink}</a>
          </div>
          <label className={`${label} sm:max-w-xs`}>{D.hubAiLangLabel}
            <select className={input} value={form.aiReplyLanguage ?? "auto"} onChange={(e) => setForm({ ...form, aiReplyLanguage: e.target.value })}>
              <option value="auto">{D.hubAiLangAuto}</option>
              <option value="bn">{D.hubAiLangBn}</option>
              <option value="en">{D.hubAiLangEn}</option>
            </select>
          </label>
        </div>
      </section>

      <div className="sticky bottom-3 z-20 sm:bottom-4">
        <div className="card flex flex-col gap-2.5 p-3.5 shadow-card-hover sm:flex-row sm:items-center sm:p-4">
          <button className="btn-primary min-h-[44px] w-full sm:w-auto" disabled={busy} onClick={save}>{busy ? D.waitPlease : D.hubSaveBtn}</button>
          <a href="#hub-knowledge" className="btn-secondary min-h-[44px] w-full justify-center sm:w-auto">{D.hubKnowledgeLink}</a>
          <span className="text-xs leading-snug text-slate-400 sm:ml-auto sm:max-w-56 sm:text-right">{D.hubKnowledgeNote}</span>
        </div>
      </div>
    </div>
  );
}

function VoiceSettingsCard() {
  const { dict, t, locale } = useLocale();
  const D = dict.settings;
  const [enabled, setEnabled] = useState(false);
  const [autoCallNewCod, setAutoCallNewCod] = useState(false);
  const [delayMinutes, setDelayMinutes] = useState(2);
  const [provider, setProvider] = useState<"mock" | "twilio">("mock");
  const [twilioAccountSid, setTwilioAccountSid] = useState("");
  const [twilioAuthToken, setTwilioAuthToken] = useState("");
  const [twilioCallerId, setTwilioCallerId] = useState("");
  const [promptIntro, setPromptIntro] = useState("");
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const s = await apiFetch<any>(`/organizations/${orgId}/voice/settings`);
      if (s) {
        setEnabled(Boolean(s.enabled));
        setAutoCallNewCod(Boolean(s.autoCallNewCod));
        setDelayMinutes(Number(s.delayMinutes ?? 2));
        setProvider(s.provider || "mock");
        setTwilioAccountSid(s.twilioAccountSid ?? "");
        setTwilioAuthToken(s.twilioAuthToken ?? "");
        setTwilioCallerId(s.twilioCallerId ?? "");
        setPromptIntro(s.promptIntro ?? "");
        setMaxAttempts(Number(s.maxAttempts ?? 3));
      }
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : D.voiceLoadFailed);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setMsg(""); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/voice/settings`, {
        method: "PUT",
        body: JSON.stringify({
          enabled,
          autoCallNewCod,
          delayMinutes,
          provider,
          twilioAccountSid,
          twilioAuthToken,
          twilioCallerId,
          promptIntro,
          maxAttempts,
        }),
      });
      setMsg(D.voiceSaved);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="hub-voice" className="card scroll-mt-24 p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="stat-icon stat-icon-brand !h-10 !w-10 text-lg">📞</span>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight text-slate-900">{D.voiceTitle}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{D.voiceSubtitle}</p>
        </div>
      </div>

      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}

      {!loaded ? (
        <p className="text-sm text-slate-400">{dict.common.loading}</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <div>
                <span className="font-semibold text-slate-800 block">{D.voiceEnableLabel}</span>
                <span className="text-xs text-slate-500">{D.voiceEnableSub}</span>
              </div>
            </label>

            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
                checked={autoCallNewCod}
                onChange={(e) => setAutoCallNewCod(e.target.checked)}
              />
              <div>
                <span className="font-semibold text-slate-800 block">{D.voiceAutoLabel}</span>
                <span className="text-xs text-slate-500">{D.voiceAutoSub}</span>
              </div>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{D.voiceProviderLabel}</label>
              <select
                className="input"
                value={provider}
                onChange={(e) => setProvider(e.target.value as any)}
              >
                <option value="mock">{D.voiceProviderMock}</option>
                <option value="twilio">{D.voiceProviderTwilio}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{D.voiceDelayLabel}</label>
              <input
                type="number"
                min={0}
                max={60}
                className="input"
                value={delayMinutes}
                onChange={(e) => setDelayMinutes(Number(e.target.value))}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{D.voiceAttemptsLabel}</label>
              <input
                type="number"
                min={1}
                max={5}
                className="input"
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(Number(e.target.value))}
              />
            </div>
          </div>

          {provider === "twilio" && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-3">
              <h4 className="font-semibold text-indigo-950 text-xs uppercase tracking-wider">
                {D.voiceTwilioTitle}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Account SID</label>
                  <input
                    type="text"
                    className="input font-mono text-xs"
                    placeholder="AC..."
                    value={twilioAccountSid}
                    onChange={(e) => setTwilioAccountSid(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Auth Token</label>
                  <input
                    type="password"
                    className="input font-mono text-xs"
                    placeholder="••••••••"
                    value={twilioAuthToken}
                    onChange={(e) => setTwilioAuthToken(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">{D.voiceCallerIdLabel}</label>
                  <input
                    type="text"
                    className="input text-xs"
                    placeholder="+1234567890"
                    value={twilioCallerId}
                    onChange={(e) => setTwilioCallerId(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{D.voiceGreetingLabel}</label>
            <input
              type="text"
              className="input"
              placeholder={D.voiceGreetingPlaceholder}
              value={promptIntro}
              onChange={(e) => setPromptIntro(e.target.value)}
            />
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="btn-primary min-h-[40px] px-5"
            >
              {busy ? D.voiceSaving : D.voiceSaveBtn}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function SettingsPage() {
  const { dict, t, locale } = useLocale();
  const D = dict.settings;
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setStatus(await apiFetch<TotpStatus>("/auth/totp/status")); }
    catch (e) { setError(e instanceof Error ? e.message : D.loadFailed); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function enroll() {
    setBusy(true); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ secret: string; otpauthUrl: string; qrDataUrl?: string }>("/auth/totp/enroll", { method: "POST" });
      setSecret(out.secret);
      setOtpauthUrl(out.otpauthUrl);
      setQrDataUrl(out.qrDataUrl ?? "");
      setNotice(D.pageEnrollNotice);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.pageStartFailed); }
    finally { setBusy(false); }
  }

  async function confirm() {
    const code = (document.getElementById("totp-code") as HTMLInputElement)?.value ?? "";
    setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch("/auth/totp/confirm", { method: "POST", body: JSON.stringify({ code }) });
      setSecret(""); setOtpauthUrl("");
      setNotice(D.page2faOn);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.acctVerCodeMismatch); }
    finally { setBusy(false); }
  }

  async function disable() {
    const code = (document.getElementById("totp-disable-code") as HTMLInputElement)?.value ?? "";
    setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch("/auth/totp/disable", { method: "POST", body: JSON.stringify({ code }) });
      setNotice(D.page2faOff);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.pageDisableFailed); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <h1 className="page-title">🏢 Business Command Center</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">{D.pageIntro}</p>
      </div>
      {error ? <div className="alert alert-red">{error}</div> : null}
      {notice ? <div className="alert alert-green">{notice}</div> : null}

      {/* Mobile: horizontal chip rail (sticky). Desktop: the rail
          becomes the sidebar below. */}
      <nav className="sticky top-2 z-30 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:hidden" aria-label={D.pageSectionAria}>
        {HUB_NAV.map((n) => (
          <a key={n.id} href={`#${n.id}`} className="flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-2 text-[13px] font-semibold text-slate-600 shadow-card ring-1 ring-slate-200/70">
            <span>{n.icon}</span>{D[n.labelKey as keyof typeof D]}
          </a>
        ))}
      </nav>

      <div className="items-start gap-5 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="sticky top-4 hidden lg:block">
          <nav className="card space-y-0.5 p-2.5" aria-label={D.pageSectionAria}>
            {HUB_NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} className="flex min-h-[40px] items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-[var(--brand-soft)] hover:text-slate-900">
                <span className="text-base">{n.icon}</span>{D[n.labelKey as keyof typeof D]}
              </a>
            ))}
            <p className="px-3 pb-1.5 pt-3 text-xs leading-relaxed text-slate-400">{D.pageAsideNote}</p>
          </nav>
        </aside>

        <div className="min-w-0 space-y-4 sm:space-y-5">
          <BusinessHub />

          <OrgVerificationCard />
          <BusinessKnowledgeSection />

          <AiLearningSection />

          <AiControlCenterSection />

          <LanguageSection />

          <section id="hub-security" className="card scroll-mt-24 p-5 sm:p-6">
            <SectionHead icon="🔐" title={D.page2faTitle} hint={t("settings.page2faHint", { status: status === null ? dict.common.loading : status.totpEnabled ? D.page2faStatusOn : status.enrolmentInProgress ? D.page2faStatusOffPending : D.page2faStatusOff })} />
            {status && !status.totpEnabled ? (
              <div className="space-y-3">
                {!secret ? (
                  <button className="btn-primary min-h-[44px]" disabled={busy} onClick={enroll}>{busy ? D.waitPlease : D.page2faStartBtn}</button>
                ) : (
                  <div className="space-y-3 rounded-2xl bg-slate-50 p-4">
                    {qrDataUrl ? (
                      <div>
                        <div className="text-xs font-medium text-slate-500">{D.page2faScanLabel}</div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={qrDataUrl} alt="TOTP QR" className="mt-1 rounded bg-white p-1 ring-1 ring-slate-200" width={180} height={180} />
                      </div>
                    ) : null}
                    <div>
                      <div className="text-xs font-medium text-slate-500">{D.page2faSecretLabel}</div>
                      <code className="mt-1 block break-all rounded bg-white p-2 text-sm ring-1 ring-slate-200">{secret}</code>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">{D.page2faOtpAuthLabel}</div>
                      <code className="mt-1 block break-all rounded bg-white p-2 text-xs ring-1 ring-slate-200">{otpauthUrl}</code>
                    </div>
                    <p className="text-sm text-slate-600">{D.page2faSetupA}<b>{D.page2faSetupBold}</b>{D.page2faSetupB}</p>
                    <div className="flex flex-wrap gap-2">
                      <input id="totp-code" inputMode="numeric" className="input w-44 tracking-[0.3em]" placeholder="123456" maxLength={6} />
                      <button className="btn-primary min-h-[44px]" disabled={busy} onClick={confirm}>{D.page2faConfirmBtn}</button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            {status?.totpEnabled ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm text-slate-600">{D.page2faDisableLabel}
                  <input id="totp-disable-code" inputMode="numeric" className="input mt-1.5 w-44 tracking-[0.3em]" placeholder="123456" maxLength={6} />
                </label>
                <button className="btn-secondary min-h-[44px]" disabled={busy} onClick={disable}>{D.page2faDisableBtn}</button>
              </div>
            ) : null}
            <p className="mt-4 text-xs text-slate-400">{D.page2faFooterNote}</p>
          </section>

          <VoiceSettingsCard />

          <MySecurityCard />

          <AccountVerificationCard />
          <OrgIdentityCard />
          <OrgSecurityPolicyCard />
          <BrandingCard />

          <DeveloperApiCard />

          <DataToolsCard />

          <OrgLifecycleCard />
        </div>
      </div>
    </div>
  );
}
