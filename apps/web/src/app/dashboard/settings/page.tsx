"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { mediaSrc } from "@/lib/media-src";
import { getOrganizationId } from "@/lib/org";
import {
  MERCHANT_API_SCOPES, canDownloadExport, dataExportKindLabel, dataExportStatusLabel,
  dataExportsFromPayload, exportDownloadFilename,
  formatExportSize, formatMerchantKeyPrefix, merchantApiKeyStatusLabel, merchantApiScopeLabel,
  merchantKeysFromPayload,
  validateMerchantKeyDraft, type CreatedMerchantApiKey, type DataExportRow,
  type MerchantApiKeyRecord,
} from "@/lib/ab8";
import {
  NOTIFICATION_CATEGORIES, canRevokeOwnSession, isCategoryEnabled, toggleMutedCategory,
  type LoginHistoryRow, type OwnSession,
} from "@/lib/gb6-team";
import { BusinessKnowledgeSection } from "./knowledge-section";

interface TotpStatus { totpEnabled: boolean; enrolmentInProgress: boolean }

interface OrgBranding {
  name: string; brandName: string | null; logoUrl: string | null;
  primaryColor: string | null; customDomain: string | null;
}

/**
 * Milestone 59 — Agency White-Label v1 settings. Everything here
 * writes to the Organization row via PATCH /organizations/:id/branding
 * and the logo endpoint; applied in the sidebar/header, invoice +
 * label PDFs, and the public client report.
 */
function BrandingCard() {
  const [org, setOrg] = useState<OrgBranding | null>(null);
  const [brandName, setBrandName] = useState("");
  const [color, setColor] = useState("#4F46E5");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const o = await apiFetch<OrgBranding>(`/organizations/${orgId}`);
      setOrg(o);
      setBrandName(o.brandName ?? "");
      setColor(o.primaryColor ?? "#4F46E5");
    } catch (e) { setError(e instanceof Error ? e.message : "লোড করা যায়নি"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setMsg(""); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/branding`, {
        method: "PATCH",
        body: JSON.stringify({ brandName, primaryColor: color }),
      });
      setMsg("✅ ব্র্যান্ডিং সংরক্ষিত হয়েছে। সাইডবার, ইনভয়েস/লেবেল PDF আর ক্লায়েন্ট রিপোর্টে এখন থেকে এই ব্র্যান্ডিং দেখাবে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ করা যায়নি"); }
    finally { setBusy(false); }
  }

  async function uploadLogo(file: File) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setMsg(""); setError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("ফাইল পড়া যায়নি"));
        r.readAsDataURL(file);
      });
      const dataBase64 = dataUrl.split(",")[1] ?? "";
      await apiFetch(`/organizations/${orgId}/branding/logo`, {
        method: "POST",
        body: JSON.stringify({ dataBase64, contentType: file.type }),
      });
      setMsg("✅ লোগো আপলোড হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "লোগো আপলোড করা যায়নি"); }
    finally { setBusy(false); }
  }

  async function removeLogo() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setMsg(""); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/branding/logo`, { method: "DELETE" });
      setMsg("লোগো সরিয়ে দেওয়া হয়েছে — এখন ডিফল্ট চিহ্ন দেখাবে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সরানো যায়নি"); }
    finally { setBusy(false); }
  }

  return (
    <section id="hub-branding" className="card scroll-mt-24 p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="stat-icon stat-icon-brand !h-10 !w-10 text-lg">🎨</span>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight text-slate-900">ব্র্যান্ডিং — White-Label</h2>
        </div>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        এজেন্সি হিসেবে ক্লায়েন্টের সামনে নিজের ব্র্যান্ড দেখান। ব্র্যান্ডিং থাকলে সাইডবার/হেডারে আপনার লোগো ও নাম,
        ইনভয়েস ও শিপিং লেবেল PDF-এ আপনার ব্র্যান্ডের নাম ও রঙের অ্যাকসেন্ট, আর পাবলিক ক্লায়েন্ট রিপোর্টে আপনার ব্র্যান্ডিং দেখাবে।
        কিছু না দিলে প্ল্যাটফর্মের ডিফল্ট রূপই থাকে।
      </p>
      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}
      {!org ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start gap-5">
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">লোগো (PNG/JPEG/WebP, সর্বোচ্চ ১.৫ MB)</div>
              <div className="flex items-center gap-3">
                {org.logoUrl
                  ? <img src={mediaSrc(API_URL, org.logoUrl) ?? ""} alt="লোগো" className="h-14 w-14 rounded-2xl border bg-white object-contain p-1" />
                  : <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-xl font-black text-white">Q</span>}
                <div className="space-y-2">
                  <label className="btn-secondary btn-sm cursor-pointer">
                    {org.logoUrl ? "লোগো বদলান" : "লোগো আপলোড করুন"}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={busy}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ""; }} />
                  </label>
                  {org.logoUrl ? <button className="btn-secondary btn-sm block text-red-600" disabled={busy} onClick={removeLogo}>লোগো সরান</button> : null}
                </div>
              </div>
            </div>
            <label className="block min-w-56 flex-1 text-sm text-slate-600">ব্র্যান্ড / প্রদর্শন নাম
              <input className="input mt-1" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder={org.name} maxLength={120} />
              <span className="mt-1 block text-xs text-slate-400">খালি রাখলে প্রতিষ্ঠানের আসল নাম ({org.name}) দেখাবে।</span>
            </label>
            <label className="block text-sm text-slate-600">প্রাইমারি রঙ
              <span className="mt-1 flex items-center gap-2">
                <input type="color" className="h-10 w-14 cursor-pointer rounded-lg border bg-white p-1" value={color} onChange={(e) => setColor(e.target.value)} />
                <input className="input w-28" value={color} onChange={(e) => setColor(e.target.value)} placeholder="#4F46E5" maxLength={20} />
              </span>
              <span className="mt-1 block text-xs text-slate-400">ড্যাশবোর্ডের প্রধান বাটন ও PDF অ্যাকসেন্টে ব্যবহার হয়।</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-4 text-sm">
            <span className="font-medium text-slate-700">কাস্টম ডোমেইন:</span>
            {org.customDomain
              ? <span className="font-mono font-bold text-slate-900">{org.customDomain}</span>
              : <span className="text-slate-500">সেট করা নেই</span>}
            <a href="/dashboard/commerce/storefront" className="font-semibold text-indigo-700 underline">দোকানের ডোমেইন সেটিংসে পরিচালনা করুন →</a>
          </div>

          <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "অপেক্ষা করুন…" : "ব্র্যান্ডিং সংরক্ষণ করুন"}</button>
          <p className="text-xs text-slate-400">ক্লায়েন্ট রিপোর্ট লিংক তৈরি ও বাতিল করা যায় Analytics পেজের “ক্লায়েন্ট রিপোর্ট লিংক” কার্ড থেকে — লিংক খুললে ক্লায়েন্ট আপনার ব্র্যান্ডিংয়েই রিপোর্ট দেখবে।</p>
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
    } catch (e) { setError(e instanceof Error ? e.message : "লোড করা যায়নি"); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function toggleScope(scope: string) {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  }

  async function createKey() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const err = validateMerchantKeyDraft(name, scopes);
    if (err) { setError(err); return; }
    setBusy("create"); setMsg(""); setError(""); setCreatedKey(""); setCopied(false);
    try {
      const out = await apiFetch<CreatedMerchantApiKey>(`/organizations/${orgId}/merchant-api-keys`, {
        method: "POST", body: JSON.stringify({ name: name.trim(), scopes }),
      });
      setCreatedKey(out.key);
      setName("");
      setMsg("✅ নতুন API কী তৈরি হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "কী তৈরি করা যায়নি"); }
    finally { setBusy(""); }
  }

  async function copyCreatedKey() {
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
    } catch { setError("কপি করা যায়নি — কীটি হাতে কপি করুন।"); }
  }

  async function revokeKey(k: MerchantApiKeyRecord) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`"${k.name}" কীটি বাতিল করবেন? এই কী দিয়ে চলা সব সংযোগ সঙ্গে সঙ্গে বন্ধ হয়ে যাবে — এটি আর ফিরিয়ে আনা যাবে না।`)) return;
    setBusy(`revoke-${k.id}`); setMsg(""); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/merchant-api-keys/${k.id}`, { method: "DELETE" });
      setMsg("কীটি বাতিল করা হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "কী বাতিল করা যায়নি"); }
    finally { setBusy(""); }
  }

  return (
    <section id="hub-developer-api" className="card scroll-mt-24 p-5 sm:p-6">
      <SectionHead icon="🔑" title="ডেভেলপার API" hint="নিজের অ্যাপ/স্ক্রিপ্ট থেকে এই প্রতিষ্ঠানের পণ্য, অর্ডার ও গ্রাহকের তথ্যে প্রোগ্রাম দিয়ে অ্যাক্সেসের জন্য API কী। প্রতিটি কী শুধু বেছে দেওয়া স্কোপগুলোতেই কাজ করে।" />
      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}
      {createdKey ? (
        <div className="mb-4 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="text-sm font-semibold text-amber-900">⚠️ এই কীটি আর দেখানো হবে না — এখনই সংরক্ষণ করুন</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white p-2 font-mono text-sm ring-1 ring-amber-200">{createdKey}</code>
            <button type="button" className="btn-secondary btn-sm" onClick={copyCreatedKey}>{copied ? "✓ কপি হয়েছে" : "কপি করুন"}</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setCreatedKey(""); setCopied(false); }}>আমি সংরক্ষণ করেছি, লুকিয়ে দিন</button>
          </div>
        </div>
      ) : null}
      {!loaded ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : (
        <div className="space-y-5">
          <div>
            {keys.length === 0 ? <p className="text-sm text-slate-400">এখনো কোনো API কী তৈরি করা হয়নি।</p> : (
              <ul className="space-y-1.5">
                {keys.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium text-slate-800">{k.name}</span>
                      <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${k.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>{merchantApiKeyStatusLabel(k.status)}</span>
                      <span className="block font-mono text-xs text-slate-500">{formatMerchantKeyPrefix(k.keyPrefix)}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {(k.scopes ?? []).map((s) => (
                          <span key={s} className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">{merchantApiScopeLabel(s)}</span>
                        ))}
                      </span>
                      <span className="block text-[11px] text-slate-400">
                        তৈরি: {new Date(k.createdAt).toLocaleString("bn-BD")} · শেষ ব্যবহার: {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("bn-BD") : "কখনো নয়"}
                      </span>
                    </span>
                    {k.status === "active" ? (
                      <button type="button" className="btn-secondary btn-sm text-red-600" disabled={busy !== ""} onClick={() => revokeKey(k)}>
                        {busy === `revoke-${k.id}` ? "বাতিল হচ্ছে…" : "বাতিল করুন"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">নতুন কী তৈরি করুন</h3>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block min-w-52 flex-1 text-sm text-slate-600">কী-এর নাম
                <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="যেমন: ওয়েবসাইট সিঙ্ক" maxLength={80} />
              </label>
            </div>
            <div className="mt-3">
              <div className="mb-1.5 text-[13px] font-medium text-slate-600">স্কোপ (অনুমতি)</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {MERCHANT_API_SCOPES.map((s) => (
                  <label key={s.key} className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                    <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={scopes.includes(s.key)}
                      onChange={() => toggleScope(s.key)} aria-label={s.label} />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <button type="button" className="btn-primary mt-4 min-h-[44px]" disabled={busy !== ""} onClick={createKey}>
              {busy === "create" ? "তৈরি হচ্ছে…" : "API কী তৈরি করুন"}
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
  const [items, setItems] = useState<DataExportRow[]>([]);
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

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
    } catch (e) { setError(e instanceof Error ? e.message : "লোড করা যায়নি"); }
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
      setMsg(enabled ? "সাপ্তাহিক স্বয়ংক্রিয় ব্যাকআপ চালু হয়েছে।" : "সাপ্তাহিক স্বয়ংক্রিয় ব্যাকআপ বন্ধ করা হয়েছে।");
    } catch (e) { setError(e instanceof Error ? e.message : "পছন্দ সংরক্ষণ করা যায়নি"); }
    finally { setBusy(""); }
  }

  async function createExport() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("export"); setMsg(""); setError("");
    try {
      await apiFetch<DataExportRow>(`/organizations/${orgId}/data-exports`, { method: "POST" });
      setMsg("✅ এক্সপোর্টের অনুরোধ তৈরি হয়েছে — প্রস্তুত হলে নিচের তালিকা থেকে ডাউনলোড করা যাবে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "এক্সপোর্ট শুরু করা যায়নি"); }
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
      if (!res.ok) throw new Error("ডাউনলোড করা যায়নি — এক্সপোর্টটির মেয়াদ শেষ হয়ে থাকতে পারে।");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = exportDownloadFilename(row.id);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setError(e instanceof Error ? e.message : "ডাউনলোড করা যায়নি"); }
    finally { setBusy(""); }
  }

  return (
    <section id="hub-data-tools" className="card scroll-mt-24 p-5 sm:p-6">
      <SectionHead icon="💾" title="ডেটা ও ব্যাকআপ" hint="প্রতিষ্ঠানের পুরো ডেটা এক্সপোর্ট করুন, সাপ্তাহিক স্বয়ংক্রিয় ব্যাকআপ চালু করুন, আর কে কখন কী বদলেছে তা কার্যকলাপ লগে দেখুন।" />
      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}
      <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">⚠️ এক্সপোর্টে এই প্রতিষ্ঠানের সম্পূর্ণ রেকর্ড থাকে — ফাইলটি যত্নে নিরাপদ জায়গায় সংরক্ষণ করুন এবং অপরিচিত কারও সঙ্গে শেয়ার করবেন না।</p>
      {!loaded ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : (
        <div className="space-y-5">
          <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-100">
            <span>
              সাপ্তাহিক স্বয়ংক্রিয় ব্যাকআপ
              <span className="block text-xs font-normal text-slate-400">
                {lastBackupAt ? `সর্বশেষ ব্যাকআপ: ${new Date(lastBackupAt).toLocaleString("bn-BD")}` : "এখনো কোনো ব্যাকআপ হয়নি"}
              </span>
            </span>
            <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={backupEnabled} disabled={busy !== ""}
              onChange={(e) => toggleBackup(e.target.checked)} aria-label="সাপ্তাহিক স্বয়ংক্রিয় ব্যাকআপ" />
          </label>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-700">এক্সপোর্টসমূহ</h3>
              <button type="button" className="btn-primary btn-sm min-h-[40px]" disabled={busy !== ""} onClick={createExport}>
                {busy === "export" ? "অনুরোধ হচ্ছে…" : "এখনই এক্সপোর্ট করুন"}
              </button>
            </div>
            {items.length === 0 ? <p className="text-sm text-slate-400">এখনো কোনো এক্সপোর্ট করা হয়নি।</p> : (
              <ul className="space-y-1.5">
                {items.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium text-slate-800">{dataExportKindLabel(row.kind)}</span>
                      <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${row.status === "ready" ? "bg-emerald-100 text-emerald-700" : row.status === "failed" ? "bg-red-100 text-red-600" : "bg-slate-200 text-slate-600"}`}>{dataExportStatusLabel(row.status)}</span>
                      <span className="block text-xs text-slate-500">
                        আকার: {formatExportSize(row.sizeBytes)} · তৈরি: {new Date(row.createdAt).toLocaleString("bn-BD")}
                        {row.completedAt ? ` · সম্পন্ন: ${new Date(row.completedAt).toLocaleString("bn-BD")}` : ""}
                        {row.expiresAt ? ` · মেয়াদ: ${new Date(row.expiresAt).toLocaleString("bn-BD")}` : ""}
                      </span>
                      {row.status === "failed" && row.error ? <span className="block text-xs text-red-600">{row.error}</span> : null}
                    </span>
                    {canDownloadExport(row) ? (
                      <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => downloadExport(row)}>
                        {busy === `download-${row.id}` ? "ডাউনলোড হচ্ছে…" : "ডাউনলোড"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-sm text-slate-600">
            কে কখন কোন রেকর্ডে কী করেছেন —{" "}
            <a href="/dashboard/settings/audit-logs" className="font-semibold text-indigo-700 hover:underline">কার্যকলাপ লগ দেখুন →</a>
          </p>
        </div>
      )}
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
  { id: "hub-brain", icon: "🧠", label: "ব্যবসার ব্রেইন" },
  { id: "hub-identity", icon: "🏪", label: "পরিচিতি" },
  { id: "hub-contact", icon: "📍", label: "যোগাযোগ ও সময়" },
  { id: "hub-delivery", icon: "🚚", label: "ডেলিভারি ও রিটার্ন" },
  { id: "hub-payment", icon: "💳", label: "পেমেন্ট" },
  { id: "hub-ai", icon: "🤖", label: "AI এর আচরণ" },
  { id: "hub-knowledge", icon: "📚", label: "Business Knowledge" },
  { id: "hub-branding", icon: "🎨", label: "ব্র্যান্ডিং" },
  { id: "hub-org-verification", icon: "🏅", label: "প্রতিষ্ঠান যাচাইকরণ" },
  { id: "hub-verification", icon: "✅", label: "যাচাইকরণ (ইমেইল/ফোন)" },
  { id: "hub-security", icon: "🔐", label: "নিরাপত্তা (2FA)" },
  { id: "hub-my-security", icon: "🖥️", label: "আমার সেশন ও নোটিফিকেশন" },
  { id: "hub-developer-api", icon: "🔑", label: "ডেভেলপার API" },
  { id: "hub-data-tools", icon: "💾", label: "ডেটা ও ব্যাকআপ" },
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
    } catch (e) { setError(e instanceof Error ? e.message : "লোড করা যায়নি"); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function revokeSession(s: OwnSession) {
    setBusy(`session-${s.id}`); setMsg(""); setError("");
    try {
      await apiFetch(`/auth/sessions/${s.id}`, { method: "DELETE" });
      setMsg("সেশনটি বাতিল হয়েছে — ওই ডিভাইস/ব্রাউজার থেকে লগআউট হয়ে যাবে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সেশন বাতিল করা যায়নি"); }
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
      setMsg("নোটিফিকেশন পছন্দ সংরক্ষিত হয়েছে।");
    } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ করা যায়নি"); }
    finally { setBusy(""); }
  }

  return (
    <section id="hub-my-security" className="card scroll-mt-24 p-5 sm:p-6">
      <SectionHead icon="🖥️" title="আমার সেশন, লগইন ইতিহাস ও নোটিফিকেশন" hint="আপনি যেসব ডিভাইস/ব্রাউজার থেকে লগইন করেছেন, সাম্প্রতিক লগইন চেষ্টা, আর এই Organization-এ কোন ধরনের ইন-অ্যাপ নোটিফিকেশন পাবেন।" />
      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}
      {!loaded ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : (
        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold">সক্রিয় সেশন ({sessions.length})</h3>
            {sessions.length === 0 ? <p className="text-sm text-slate-400">কোনো সক্রিয় সেশন পাওয়া যায়নি।</p> : sessions.map((s) => (
              <div key={s.id} className="mb-1.5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{s.ip ?? "IP অজানা"}</span>
                  {s.current ? <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">বর্তমান সেশন</span> : null}
                  <span className="block max-w-lg truncate text-[11px] text-slate-400" title={s.userAgent ?? ""}>{s.userAgent ?? "ডিভাইস অজানা"}</span>
                  <span className="block text-[11px] text-slate-400">শুরু: {new Date(s.createdAt).toLocaleString("bn-BD")} · শেষ দেখা: {new Date(s.lastSeenAt).toLocaleString("bn-BD")}</span>
                </span>
                {canRevokeOwnSession(s) ? (
                  <button className="btn-secondary btn-sm text-red-600" disabled={busy !== ""} onClick={() => revokeSession(s)}>সেশন বাতিল করুন</button>
                ) : (
                  <span className="max-w-56 text-right text-[11px] text-slate-400">এটি আপনার বর্তমান সেশন — এটি বাতিল করলে আপনি সঙ্গে সঙ্গে লগআউট হয়ে যাবেন, তাই এখান থেকে বাতিল করা যাবে না। লগআউট করতে চাইলে স্বাভাবিক লগআউট করুন।</span>
                )}
              </div>
            ))}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">আমার লগইন ইতিহাস (শেষ ৫০টি)</h3>
            {history.length === 0 ? <p className="text-sm text-slate-400">কোনো লগইন ইতিহাস নেই।</p> : (
              <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
                {history.map((h, i) => (
                  <li key={h.id ?? i} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${h.success ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>{h.success ? "সফল" : "ব্যর্থ"}</span>
                    <span className="text-slate-600">{h.ip ?? "IP অজানা"}</span>
                    <span className="max-w-52 truncate text-[11px] text-slate-400" title={h.userAgent ?? ""}>{h.userAgent ?? ""}</span>
                    <span className="text-[11px] text-slate-400">{new Date(h.createdAt).toLocaleString("bn-BD")}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-slate-400">অচেনা IP/ডিভাইস থেকে সফল লগইন দেখলে ওই সেশনটি ওপরে বাতিল করুন এবং পাসওয়ার্ড বদলে ফেলুন।</p>
          </div>

          <div>
            <h3 className="mb-1 text-sm font-semibold">নোটিফিকেশন পছন্দ — এই Organization-এর জন্য</h3>
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">এটি শুধু অ্যাপের ভিতরের নোটিফিকেশন বন্ধ করে — এটি কোনো নিরাপত্তা সেটিং নয়। বন্ধ করা ধরনের নোটিফিকেশন তৈরি হবে না; ইমেইল বা অন্য চ্যানেলে এর কোনো প্রভাব নেই। পছন্দটি শুধু এই Organization-এর জন্য প্রযোজ্য।</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {NOTIFICATION_CATEGORIES.map((c) => {
                const enabled = isCategoryEnabled(muted, c.key);
                return (
                  <label key={c.key} className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-100">
                    <span>{c.labelBn} <span className="text-xs font-normal text-slate-400">({c.label})</span></span>
                    <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={enabled} disabled={busy !== ""}
                      onChange={() => toggleCategory(c.key)} aria-label={`${c.labelBn} নোটিফিকেশন`} />
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
    } catch (e) { setError(e instanceof Error ? e.message : "লোড করা যায়নি"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function resendEmail() {
    setBusy("email"); setMsg(""); setError("");
    try {
      const out = await apiFetch<{ sent: boolean; reason?: string }>("/auth/verification/email", { method: "POST" });
      if (out.sent) setMsg("✅ যাচাইকরণ ইমেইল আবার পাঠানো হয়েছে — ইনবক্স (ও Spam) দেখুন। লিংকটি ২৪ ঘণ্টা বৈধ।");
      else if (out.reason === "already_verified") setMsg("আপনার ইমেইল ইতিমধ্যে যাচাই করা হয়েছে।");
      else setError("ইমেইল পাঠানো যায়নি — প্ল্যাটফর্মের ইমেইল সেটআপে সমস্যা থাকতে পারে। পরে আবার চেষ্টা করুন।");
    } catch (e) { setError(e instanceof Error ? e.message : "পাঠানো যায়নি"); }
    finally { setBusy(""); }
  }

  async function savePhone() {
    setBusy("phone"); setMsg(""); setError("");
    try {
      const out = await apiFetch<{ phone: string; phoneVerifiedAt: string | null }>("/auth/verification/phone", {
        method: "POST", body: JSON.stringify({ phone }),
      });
      setPhone(out.phone);
      setMsg("মোবাইল নম্বর সংরক্ষিত হয়েছে। এবার OTP পাঠিয়ে যাচাই করুন।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ করা যায়নি"); }
    finally { setBusy(""); }
  }

  async function requestOtp() {
    setBusy("otp"); setMsg(""); setError(""); setSmsUnavailable(false);
    try {
      const out = await apiFetch<{ sent: boolean; reason?: string }>("/auth/verification/phone/otp", { method: "POST" });
      if (out.sent) { setOtpSent(true); setMsg("✅ OTP পাঠানো হয়েছে — ৫ মিনিটের মধ্যে কোডটি দিন।"); }
      else if (out.reason === "sms_not_configured") setSmsUnavailable(true);
      else if (out.reason === "already_verified") setMsg("আপনার ফোন নম্বর ইতিমধ্যে যাচাই করা হয়েছে।");
      else setError("SMS পাঠানো যায়নি — কিছুক্ষণ পরে আবার চেষ্টা করুন।");
    } catch (e) { setError(e instanceof Error ? e.message : "OTP পাঠানো যায়নি"); }
    finally { setBusy(""); }
  }

  async function verifyOtp() {
    setBusy("verify"); setMsg(""); setError("");
    try {
      await apiFetch("/auth/verification/phone/verify", { method: "POST", body: JSON.stringify({ code }) });
      setOtpSent(false); setCode("");
      setMsg("✅ ফোন নম্বর যাচাই সম্পন্ন হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "কোড মেলেনি"); }
    finally { setBusy(""); }
  }

  return (
    <section id="hub-verification" className="card scroll-mt-24 p-5 sm:p-6">
      <SectionHead icon="✅" title="যাচাইকরণ — ইমেইল ও ফোন" hint="যাচাই করা অ্যাকাউন্ট মার্চেন্ট হিসেবে আস্থা বাড়ায়; প্ল্যাটফর্ম যাচাইকরণ চালু করলে নতুন অ্যাকাউন্টের জন্য ইমেইল যাচাই বাধ্যতামূলক হতে পারে।" />
      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}
      {!me ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-700">ইমেইল: <span className="font-semibold">{me.email}</span></div>
              <div className="text-xs text-slate-500">{me.emailVerifiedAt ? `যাচাই করা হয়েছে · ${new Date(me.emailVerifiedAt).toLocaleString("bn-BD")}` : "এখনো যাচাই করা হয়নি"}</div>
            </div>
            {me.emailVerifiedAt
              ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">✓ যাচাইকৃত</span>
              : <button className="btn-primary btn-sm min-h-[40px]" disabled={busy !== ""} onClick={resendEmail}>{busy === "email" ? "পাঠানো হচ্ছে…" : "যাচাইকরণ লিংক আবার পাঠান"}</button>}
          </div>

          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-700">মোবাইল নম্বর</span>
              {me.phoneVerifiedAt
                ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">✓ যাচাইকৃত</span>
                : <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">যাচাই বাকি</span>}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-sm text-slate-600">নম্বর (01 দিয়ে শুরু)
                <input className="input mt-1 w-56" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" inputMode="tel" />
              </label>
              <button className="btn-secondary min-h-[44px]" disabled={busy !== "" || !phone.trim()} onClick={savePhone}>{busy === "phone" ? "অপেক্ষা করুন…" : "নম্বর সংরক্ষণ করুন"}</button>
              {!me.phoneVerifiedAt ? (
                <button className="btn-primary min-h-[44px]" disabled={busy !== "" || !me.phone} onClick={requestOtp}>{busy === "otp" ? "পাঠানো হচ্ছে…" : "OTP পাঠান"}</button>
              ) : null}
            </div>
            {smsUnavailable ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">📵 এসএমএস যাচাই এখন উপলব্ধ নয় — প্ল্যাটফর্মে SMS গেটওয়ে সেটআপ করা নেই। ইমেইল যাচাই দিয়েই আপাতত চলবে।</p>
            ) : null}
            {otpSent && !me.phoneVerifiedAt ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="block text-sm text-slate-600">৬ সংখ্যার OTP কোড
                  <input className="input mt-1 w-44 tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={6} inputMode="numeric" />
                </label>
                <button className="btn-primary min-h-[44px]" disabled={busy !== "" || code.trim().length < 6} onClick={verifyOtp}>{busy === "verify" ? "যাচাই হচ্ছে…" : "কোড যাচাই করুন"}</button>
                <span className="text-xs text-slate-400">কোডের মেয়াদ ৫ মিনিট · ৫ বার ভুল চেষ্টা করলে কোডটি বাতিল হয়ে যাবে।</span>
              </div>
            ) : null}
            {!me.phone ? <p className="mt-2 text-xs text-slate-400">আগে নম্বর সংরক্ষণ করুন, তারপর OTP পাঠানো যাবে।</p> : null}
          </div>
        </div>
      )}
    </section>
  );
}

interface OrgVerificationState {
  verificationStatus: string; verificationNote: string | null; verificationSubmittedAt: string | null;
}

function formatBytesBn(bytesStr: string): string {
  const n = Number(bytesStr);
  if (!Number.isFinite(n) || n <= 0) return "০ বাইট";
  const units = ["বাইট", "KB", "MB", "GB", "TB"];
  let v = n; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString("bn-BD", { maximumFractionDigits: 2 })} ${units[i]}`;
}

/**
 * GC21 (GB9): merchant (organization) verification + recorded
 * storage usage. Submit goes to the API, which validates the
 * Business Profile pieces and names anything missing in Bengali;
 * a rejected submission shows the admin's note verbatim so the
 * merchant knows exactly what to fix.
 */
function OrgVerificationCard() {
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
    } catch (e) { setError(e instanceof Error ? e.message : "লোড করা যায়নি"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function submit() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setMsg(""); setError("");
    try {
      const out = await apiFetch<OrgVerificationState>(`/organizations/${orgId}/verification/submit`, { method: "POST" });
      setOrg(out);
      setMsg("✅ যাচাইয়ের আবেদন জমা পড়েছে — প্ল্যাটফর্ম টিম রিভিউ করে সিদ্ধান্ত জানাবে।");
    } catch (e) { setError(e instanceof Error ? e.message : "জমা দেওয়া যায়নি"); }
    finally { setBusy(false); }
  }

  const badge = (status: string) => {
    switch (status) {
      case "verified": return <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">✓ যাচাইকৃত প্রতিষ্ঠান</span>;
      case "pending": return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">⏳ রিভিউ চলছে</span>;
      case "rejected": return <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">✗ আবেদন ফিরিয়ে দেওয়া হয়েছে</span>;
      default: return <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600">যাচাই করা হয়নি</span>;
    }
  };

  return (
    <section id="hub-org-verification" className="card scroll-mt-24 p-5 sm:p-6">
      <SectionHead icon="🏅" title="প্রতিষ্ঠান যাচাইকরণ ও স্টোরেজ" hint="ট্রেড লাইসেন্সসহ ব্যবসার তথ্য জমা দিলে প্ল্যাটফর্ম টিম যাচাই করে যাচাইকৃত ব্যাজ দেয়। জমা দেওয়ার আগে ওপরের ফর্মে প্রতিষ্ঠানের নাম, ঠিকানা, যোগাযোগের ফোন/ইমেইল ও ট্রেড লাইসেন্স নম্বর পূরণ করে সংরক্ষণ করুন।" />
      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}
      {!org ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-slate-700">বর্তমান অবস্থা:</span>
            {badge(org.verificationStatus)}
            {org.verificationSubmittedAt ? <span className="text-xs text-slate-400">সর্বশেষ জমা: {new Date(org.verificationSubmittedAt).toLocaleString("bn-BD")}</span> : null}
          </div>
          {org.verificationStatus === "rejected" && org.verificationNote ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">প্ল্যাটফর্ম টিমের নোট: “{org.verificationNote}” — তথ্য ঠিক করে আবার জমা দিন।</p>
          ) : null}
          {org.verificationStatus === "verified" && org.verificationNote ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">প্ল্যাটফর্ম টিমের নোট: “{org.verificationNote}”</p>
          ) : null}
          {org.verificationStatus !== "verified" ? (
            <button className="btn-primary min-h-[44px]" disabled={busy} onClick={submit}>
              {busy ? "অপেক্ষা করুন…" : org.verificationStatus === "pending" ? "আবার জমা দিন" : org.verificationStatus === "rejected" ? "ঠিক করে আবার জমা দিন" : "যাচাইয়ের জন্য জমা দিন"}
            </button>
          ) : null}

          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <div className="text-sm font-medium text-slate-700">📦 স্টোরেজ ব্যবহার</div>
            {storage ? (
              <p className="mt-1 text-sm text-slate-600">
                মিডিয়া লাইব্রেরিতে <b>{formatBytesBn(storage.storageBytes)}</b> · {storage.assetCount.toLocaleString("bn-BD")}টি ফাইল
                <span className="block text-xs text-slate-400">{storage.meteredFrom} — ব্যান্ডউইডথ হিসাব করা হয় না।</span>
              </p>
            ) : <p className="mt-1 text-sm text-slate-400">স্টোরেজ তথ্য লোড করা যায়নি।</p>}
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
  { key: "sat", label: "শনিবার" }, { key: "sun", label: "রবিবার" }, { key: "mon", label: "সোমবার" },
  { key: "tue", label: "মঙ্গলবার" }, { key: "wed", label: "বুধবার" }, { key: "thu", label: "বৃহস্পতিবার" }, { key: "fri", label: "শুক্রবার" },
] as const;

function BusinessHub() {
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
    } catch (e) { setError(e instanceof Error ? e.message : "লোড করা যায়নি"); }
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
      setMsg("✅ ব্যবসার তথ্য সংরক্ষিত হয়েছে — AI এখন থেকে এই তথ্য থেকেই উত্তর দেবে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ করা যায়নি"); }
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
              <h2 className="text-lg font-bold leading-tight">🧠 ব্যবসার ব্রেইন — AI এর জ্ঞানের উৎস</h2>
              <p className="mx-auto mt-1 max-w-xl text-[13px] leading-relaxed text-white/85 sm:mx-0">
                এই তথ্যগুলোই AI এর জ্ঞানের উৎস। যত পূর্ণ হবে, AI তত নির্ভুল উত্তর দেবে — তথ্য না থাকলে AI অনুমান করে না, "জানি না" বলে।
                এখন {comp.doneCount}/{comp.totalSections}টি অংশ পূর্ণ।
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                <span className="mr-1 self-center text-xs font-semibold text-white/80">AI যা উত্তর দিতে পারবে:</span>
                {([["priceStock", "দাম ও স্টক"], ["delivery", "ডেলিভারি"], ["payment", "পেমেন্ট"], ["contactHours", "যোগাযোগ ও সময়"], ["faq", "FAQ"]] as const).map(([k, l]) => (
                  <span key={k} className="hero-chip !px-2.5 !py-0.5">{comp.aiCanAnswer[k] ? "✓" : "✗"} {l}</span>
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
        <div className="skeleton h-40 w-full" aria-label="লোড হচ্ছে" />
      )}

      {error ? <div className="alert alert-red">{error}</div> : null}
      {msg ? <div className="alert alert-green">{msg}</div> : null}

      <section id="hub-identity" className="card scroll-mt-24 p-5 sm:p-6">
        <SectionHead icon="🏪" title="ব্যবসার পরিচিতি" hint="AI এই ভাষাতেই ব্যবসাটাকে বুঝবে — নিজের কথায়, সহজভাবে লিখুন।" />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>ব্যবসা সম্পর্কে (AI এর ভাষায়)<textarea className={input} rows={3} value={form.description ?? ""} onChange={set("description")} placeholder="আমরা খুলনাভিত্তিক একটি অনলাইন ফ্যাশন স্টোর…" /></label>
          <label className={label}>ইন্ডাস্ট্রি<input className={input} value={form.industry ?? ""} onChange={set("industry")} placeholder="ফ্যাশন / ইলেকট্রনিক্স / খাবার…" /></label>
          <label className={label}>ব্যবসার ধরন<input className={input} value={form.businessModel ?? ""} onChange={set("businessModel")} placeholder="অনলাইন রিটেইল / পাইকারি…" /></label>
          <label className={label}>ব্র্যান্ডের সুর (Brand Voice)<input className={input} value={form.brandVoice ?? ""} onChange={set("brandVoice")} placeholder="বন্ধুসুলভ, সহজ বাংলায়, সম্মানজনক" /></label>
          <label className={label}>বিশেষত্ব (USP)<input className={input} value={form.uniqueSellingPoints ?? ""} onChange={set("uniqueSellingPoints")} placeholder="অরিজিনাল পণ্য, ৭ দিনের রিপ্লেসমেন্ট…" /></label>
          <label className={label}>ওয়েবসাইট<input className={input} value={form.websiteUrl ?? ""} onChange={set("websiteUrl")} placeholder="https://…" /></label>
          <label className={label}>ব্যবসার লক্ষ্য<input className={input} value={form.goals ?? ""} onChange={set("goals")} placeholder="মাসে ৫০০ অর্ডার…" /></label>
          <label className={label}>ট্রেড লাইসেন্স নম্বর<input className={input} value={form.tradeLicenseNo ?? ""} onChange={set("tradeLicenseNo")} placeholder="ট্রেড লাইসেন্স অনুযায়ী হুবহু" /></label>
          <label className={label}>ব্যবসার ঠিকানা (লাইসেন্স অনুযায়ী)<input className={input} value={form.businessAddress ?? ""} onChange={set("businessAddress")} placeholder="দোকান/অফিসের পূর্ণ ঠিকানা" /></label>
        </div>
        <p className="mt-3 text-xs text-slate-400">ট্রেড লাইসেন্স নম্বর ও ব্যবসার ঠিকানা প্রতিষ্ঠান যাচাইকরণে (নিচের “প্রতিষ্ঠান যাচাইকরণ” কার্ড) জমা দেওয়ার জন্য লাগে।</p>
      </section>

      <section id="hub-contact" className="card scroll-mt-24 p-5 sm:p-6">
        <SectionHead icon="📍" title="যোগাযোগ, ঠিকানা ও সময়" hint="গ্রাহক ফোন/ঠিকানা/খোলার সময় জিজ্ঞেস করলে AI এখান থেকেই উত্তর দেয়।" />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>যোগাযোগের ফোন<input className={input} value={form.contactPhone ?? ""} onChange={set("contactPhone")} placeholder="01XXXXXXXXX" /></label>
          <label className={label}>যোগাযোগের ইমেইল<input className={input} value={form.contactEmail ?? ""} onChange={set("contactEmail")} placeholder="hello@shop.com" /></label>
          <label className={label}>ঠিকানা (দোকান/অফিস)<input className={input} value={form.address ?? ""} onChange={set("address")} placeholder="বাড়ি, রোড, এলাকা" /></label>
          <label className={label}>শহর<input className={input} value={form.city ?? ""} onChange={set("city")} placeholder="ঢাকা / খুলনা / চট্টগ্রাম" /></label>
        </div>
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] font-medium text-slate-600">
            ব্যবসার সময়
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
                    {d.label}
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
          <p className="mt-2 text-xs text-slate-400">যেদিন টিক নেই, সেদিন বন্ধ। রাতের ব্যবসায় শেষ সময় ছোট দিলে মধ্যরাত পার হয়।</p>
        </div>
      </section>

      <section id="hub-delivery" className="card scroll-mt-24 p-5 sm:p-6">
        <SectionHead icon="🚚" title="ডেলিভারি ও রিটার্ন" hint="সবচেয়ে বেশি জিজ্ঞেস করা প্রশ্নের উত্তর — টাকায় লিখুন, সিস্টেম পয়সায় রাখে।" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <label className={label}>ঢাকার ভিতরে চার্জ (৳)<input type="number" min={0} className={input} value={form.deliveryChargeInside ?? ""} onChange={set("deliveryChargeInside")} placeholder="৬০" /></label>
          <label className={label}>ঢাকার বাইরে চার্জ (৳)<input type="number" min={0} className={input} value={form.deliveryChargeOutside ?? ""} onChange={set("deliveryChargeOutside")} placeholder="১২০" /></label>
          <label className={label}>কত টাকার ওপরে ফ্রি ডেলিভারি (৳)<input type="number" min={0} className={input} value={form.freeDeliveryAbove ?? ""} onChange={set("freeDeliveryAbove")} placeholder="২০০০ (না থাকলে খালি)" /></label>
          <label className={label}>ঢাকায় ডেলিভারি সময় (দিন)<input type="number" min={0} max={60} className={input} value={form.deliveryDaysInside ?? ""} onChange={set("deliveryDaysInside")} placeholder="১–২ হলে ২ লিখুন" /></label>
          <label className={label}>ঢাকার বাইরে সময় (দিন)<input type="number" min={0} max={60} className={input} value={form.deliveryDaysOutside ?? ""} onChange={set("deliveryDaysOutside")} placeholder="৩–৫ হলে ৫ লিখুন" /></label>
          <label className={label}>ন্যূনতম অর্ডার (৳)<input type="number" min={0} className={input} value={form.minOrder ?? ""} onChange={set("minOrder")} placeholder="না থাকলে খালি" /></label>
          <label className={label}>রিটার্নের সময়সীমা (দিন)<input type="number" min={0} max={365} className={input} value={form.returnWindowDays ?? ""} onChange={set("returnWindowDays")} placeholder="৭" /></label>
        </div>
      </section>

      <section id="hub-payment" className="card scroll-mt-24 p-5 sm:p-6">
        <SectionHead icon="💳" title="পেমেন্ট" hint="গ্রাহক পেমেন্ট জিজ্ঞেস করলে AI এই নম্বরগুলোই দেবে — সঠিক নম্বর দিন।" />
        <label className="mb-4 flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-100">
          <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={cod} onChange={(e) => setCod(e.target.checked)} />
          ক্যাশ অন ডেলিভারি (COD) আছে
        </label>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <label className={label}>বিকাশ নম্বর<input className={input} value={form.bkashNumber ?? ""} onChange={set("bkashNumber")} placeholder="01XXXXXXXXX" /></label>
          <label className={label}>নগদ নম্বর<input className={input} value={form.nagadNumber ?? ""} onChange={set("nagadNumber")} placeholder="01XXXXXXXXX" /></label>
          <label className={label}>অগ্রিম পেমেন্ট (%)<input type="number" min={0} max={100} className={input} value={form.advancePaymentPercent ?? ""} onChange={set("advancePaymentPercent")} placeholder="না লাগলে খালি" /></label>
          <label className={label}>COD সর্বোচ্চ অর্ডার (৳)<input type="number" min={0} className={input} value={form.codMaxOrder ?? ""} onChange={set("codMaxOrder")} placeholder="খালি = সীমা নেই" /></label>
          <label className={label}>অগ্রিম আবশ্যকের সীমা (৳)<input type="number" min={0} className={input} value={form.codAdvanceAbove ?? ""} onChange={set("codAdvanceAbove")} placeholder="খালি = নেই" /></label>
          <label className={label}>COD বন্ধ জেলা<input className={input} value={form.codBlockedDistricts ?? ""} onChange={set("codBlockedDistricts")} placeholder="খুলনা, বরিশাল" />
            <span className="mt-1 block text-xs font-normal text-slate-400">কমা দিয়ে জেলার নাম লিখুন — যেমন: খুলনা, বরিশাল</span>
          </label>
        </div>
        <label className={`${label} mt-4`}>পেমেন্ট সম্পর্কে নোট<textarea className={input} rows={2} value={form.paymentNote ?? ""} onChange={set("paymentNote")} placeholder="যেমন: অর্ডারের পর বিকাশে অগ্রিম পাঠিয়ে শেষ ৪ ডিজিট জানাবেন…" /></label>

        {/* AB4 (AX5): deposit / advance collection rules. */}
        <div className="mt-5 space-y-4 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-100">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">💰 ডিপোজিট / Advance collection</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              চালু থাকলে চেকআউটে ক্রেতাকে মোটের একটি অংশ এখন পরিশোধ করতে বলা হবে — বাকি টাকা ডেলিভারির সময়।
              অনলাইন গেটওয়ে থাকলে ডিপোজিটটি সরাসরি অনলাইনে নেওয়া যায়; না থাকলে ক্রেতা ম্যানুয়াল নম্বরে পাঠাবে।
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <label className={label}>ডিপোজিটের ধরন
              <select className={input} value={form.depositMode ?? ""} onChange={(e) => setForm({ ...form, depositMode: e.target.value })}>
                <option value="">বন্ধ</option>
                <option value="percent">শতাংশ</option>
                <option value="fixed">নির্দিষ্ট টাকা</option>
              </select>
            </label>
            {form.depositMode === "percent" ? (
              <label className={label}>ডিপোজিটের হার (%) — ১ থেকে ৯০<input type="number" min={1} max={90} className={input} value={form.depositPercent ?? ""} onChange={set("depositPercent")} placeholder="যেমন: ২০" /></label>
            ) : null}
            {form.depositMode === "fixed" ? (
              <label className={label}>ডিপোজিটের পরিমাণ (৳)<input type="number" min={0} className={input} value={form.depositFixed ?? ""} onChange={set("depositFixed")} placeholder="যেমন: ২০০" /></label>
            ) : null}
            <label className={label}>কোন পেমেন্টে প্রযোজ্য
              <select className={input} value={form.depositAppliesTo ?? "all"} onChange={(e) => setForm({ ...form, depositAppliesTo: e.target.value })}>
                <option value="cod">শুধু COD</option>
                <option value="online">শুধু অনলাইন</option>
                <option value="all">সব</option>
              </select>
            </label>
          </div>
          <label className={label}>ক্রেতাকে দেখানোর নোট
            <textarea className={input} rows={2} value={form.depositNote ?? ""} onChange={set("depositNote")} placeholder="ডিপোজিট পরিশোধের পর বাকি টাকা ডেলিভারির সময় দিতে হবে।" />
            <span className="mt-1 block text-xs font-normal text-slate-400">খালি রাখলে ডিফল্ট বার্তা দেখাবে — নিজের কথা লিখলে সেটাই ক্রেতা দেখবে।</span>
          </label>
        </div>
      </section>

      <section id="hub-ai" className="card scroll-mt-24 p-5 sm:p-6">
        <SectionHead icon="🤖" title="AI এর আচরণ — মালিকের নির্দেশনা" hint="AI Assistant ও Inbox Autopilot দুজনেই মানে — শুধু সুর ও আচরণের জন্য। তথ্য কখনো বদলায় না: দাম, চার্জ, নম্বর সবসময় এই পেজের সেট করা তথ্য থেকেই আসে।" />
        <div className="grid gap-4">
          <div className="rounded-xl bg-indigo-50/70 px-4 py-3.5 ring-1 ring-inset ring-indigo-100">
            <p className="text-sm leading-relaxed text-slate-700">
              AI নির্দেশনা এখন <b>AI Instructions Desk</b> থেকে Draft → Test → Publish করা হয় — যাতে যাচাই না করা নির্দেশনা সরাসরি customer-এর কাছে না যায়, আর প্রতিটি সংস্করণে ফিরে যাওয়া যায়।
            </p>
            <a href="/dashboard/ai-instructions" className="btn-secondary mt-3 inline-flex min-h-[40px] items-center px-4 text-sm">🤖 AI Instructions Desk খুলুন</a>
          </div>
          <label className={`${label} sm:max-w-xs`}>AI উত্তরের ভাষা
            <select className={input} value={form.aiReplyLanguage ?? "auto"} onChange={(e) => setForm({ ...form, aiReplyLanguage: e.target.value })}>
              <option value="auto">স্বয়ংক্রিয় — গ্রাহক/ব্যবহারকারীর ভাষায়</option>
              <option value="bn">সবসময় বাংলা</option>
              <option value="en">সবসময় English</option>
            </select>
          </label>
        </div>
      </section>

      <div className="sticky bottom-3 z-20 sm:bottom-4">
        <div className="card flex flex-col gap-2.5 p-3.5 shadow-card-hover sm:flex-row sm:items-center sm:p-4">
          <button className="btn-primary min-h-[44px] w-full sm:w-auto" disabled={busy} onClick={save}>{busy ? "অপেক্ষা করুন…" : "💾 ব্যবসার তথ্য সংরক্ষণ করুন"}</button>
          <a href="#hub-knowledge" className="btn-secondary min-h-[44px] w-full justify-center sm:w-auto">📚 নীতিমালা ও FAQ (Knowledge)</a>
          <span className="text-xs leading-snug text-slate-400 sm:ml-auto sm:max-w-56 sm:text-right">নীতিমালা ও FAQ এই পেজের Business Knowledge সেকশনে সম্পাদনা হয় — Completeness এ সেগুলোও ধরা হয়।</span>
        </div>
      </div>
    </div>
  );
}

function VoiceSettingsCard() {
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
      setError(e instanceof Error ? e.message : "ভয়েস সেটিংস লোড করা যায়নি");
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
      setMsg("✅ AI ভয়েস কল সেটিংস সফলভাবে সংরক্ষিত হয়েছে।");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "সংরক্ষণ করা যায়নি");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="hub-voice" className="card scroll-mt-24 p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="stat-icon stat-icon-brand !h-10 !w-10 text-lg">📞</span>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight text-slate-900">
            AI ভয়েস কল কনফার্মেশন (Bangla IVR)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            ক্যাশ অন ডেলিভারি (COD) অর্ডার কনফার্ম করতে গ্রাহককে স্বয়ংক্রিয় বাংলা ভয়েস কল এবং ১/২ বাটন ইনপুট
          </p>
        </div>
      </div>

      {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {msg ? <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div> : null}

      {!loaded ? (
        <p className="text-sm text-slate-400">লোড হচ্ছে…</p>
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
                <span className="font-semibold text-slate-800 block">ভয়েস কল সার্ভিস সক্রিয় করুন</span>
                <span className="text-xs text-slate-500">অর্ডার ড্যাশবোর্ড থেকে ১-ক্লিকে গ্রাহককে AI কল করার সুবিধা</span>
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
                <span className="font-semibold text-slate-800 block">নতুন COD অর্ডারে অটোমেটিক কল দিন</span>
                <span className="text-xs text-slate-500">অর্ডার প্লেস হওয়ার সাথে সাথে স্বয়ংক্রিয়ভাবে কল ট্রিগার হবে</span>
              </div>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">প্রোভাইডার</label>
              <select
                className="input"
                value={provider}
                onChange={(e) => setProvider(e.target.value as any)}
              >
                <option value="mock">স্যান্ডবক্স / টেস্ট মোড (Mock)</option>
                <option value="twilio">Twilio Voice API (লাইভ প্রোডাকশন)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">অটো-কল বিলম্ব (মিনিট)</label>
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
              <label className="block text-xs font-semibold text-slate-600 mb-1">সর্বোচ্চ পুনঃপ্রচেষ্টা (বার)</label>
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
                Twilio ক্রেডেনশিয়াল
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
                  <label className="block text-xs text-slate-600 mb-1">Twilio Caller ID (ফোন নম্বর)</label>
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
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              কাস্টম বাংলা শুভেচ্ছা ভূমিকা (ঐচ্ছিক)
            </label>
            <input
              type="text"
              className="input"
              placeholder="আসসালামু আলাইকুম। (খালি রাখলে সিস্টেমের স্ট্যান্ডার্ড বাংলা স্ক্রিপ্ট চলবে)"
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
              {busy ? "সংরক্ষণ হচ্ছে..." : "ভয়েস সেটিংস সংরক্ষণ করুন"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function SettingsPage() {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setStatus(await apiFetch<TotpStatus>("/auth/totp/status")); }
    catch (e) { setError(e instanceof Error ? e.message : "লোড করা যায়নি"); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function enroll() {
    setBusy(true); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ secret: string; otpauthUrl: string; qrDataUrl?: string }>("/auth/totp/enroll", { method: "POST" });
      setSecret(out.secret);
      setOtpauthUrl(out.otpauthUrl);
      setQrDataUrl(out.qrDataUrl ?? "");
      setNotice("Secret তৈরি হয়েছে — Authenticator অ্যাপে যোগ করে নিচে কোড দিয়ে নিশ্চিত করুন। নিশ্চিত না করা পর্যন্ত 2FA চালু হবে না।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "শুরু করা যায়নি"); }
    finally { setBusy(false); }
  }

  async function confirm() {
    const code = (document.getElementById("totp-code") as HTMLInputElement)?.value ?? "";
    setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch("/auth/totp/confirm", { method: "POST", body: JSON.stringify({ code }) });
      setSecret(""); setOtpauthUrl("");
      setNotice("✅ দ্বি-স্তর নিরাপত্তা (2FA) চালু হয়েছে। এখন থেকে লগইনে পাসওয়ার্ডের পর Authenticator কোড লাগবে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "কোড মেলেনি"); }
    finally { setBusy(false); }
  }

  async function disable() {
    const code = (document.getElementById("totp-disable-code") as HTMLInputElement)?.value ?? "";
    setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch("/auth/totp/disable", { method: "POST", body: JSON.stringify({ code }) });
      setNotice("2FA বন্ধ করা হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "বন্ধ করা যায়নি"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <h1 className="page-title">🏢 Business Command Center</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">ব্যবসার সব সেটিং এক জায়গায় — মালিক এখানে যা সেট করবেন, AI সেখান থেকেই তথ্য নিয়ে কাজ করবে।</p>
      </div>
      {error ? <div className="alert alert-red">{error}</div> : null}
      {notice ? <div className="alert alert-green">{notice}</div> : null}

      {/* Mobile: horizontal chip rail (sticky). Desktop: the rail
          becomes the sidebar below. */}
      <nav className="sticky top-2 z-30 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:hidden" aria-label="সেকশন">
        {HUB_NAV.map((n) => (
          <a key={n.id} href={`#${n.id}`} className="flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-2 text-[13px] font-semibold text-slate-600 shadow-card ring-1 ring-slate-200/70">
            <span>{n.icon}</span>{n.label}
          </a>
        ))}
      </nav>

      <div className="items-start gap-5 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="sticky top-4 hidden lg:block">
          <nav className="card space-y-0.5 p-2.5" aria-label="সেকশন">
            {HUB_NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} className="flex min-h-[40px] items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-[var(--brand-soft)] hover:text-slate-900">
                <span className="text-base">{n.icon}</span>{n.label}
              </a>
            ))}
            <p className="px-3 pb-1.5 pt-3 text-xs leading-relaxed text-slate-400">সব তথ্য একবার সেট করলেই AI Assistant, Inbox Autopilot ও Order Bot — সবাই এখান থেকে কাজ করবে।</p>
          </nav>
        </aside>

        <div className="min-w-0 space-y-4 sm:space-y-5">
          <BusinessHub />

          <OrgVerificationCard />
          <BusinessKnowledgeSection />

          <section id="hub-security" className="card scroll-mt-24 p-5 sm:p-6">
            <SectionHead icon="🔐" title="আমার অ্যাকাউন্টের নিরাপত্তা — দ্বি-স্তর যাচাই (2FA)" hint={`চালু করলে লগইনে পাসওয়ার্ডের পর ফোনের Authenticator অ্যাপের ৬ সংখ্যার কোড লাগবে। অবস্থা: ${status === null ? "লোড হচ্ছে…" : status.totpEnabled ? "চালু আছে" : `বন্ধ${status.enrolmentInProgress ? " (Enrol শুরু হয়েছে, নিশ্চিত করা বাকি)" : ""}`}`} />
            {status && !status.totpEnabled ? (
              <div className="space-y-3">
                {!secret ? (
                  <button className="btn-primary min-h-[44px]" disabled={busy} onClick={enroll}>{busy ? "অপেক্ষা করুন…" : "2FA চালু করা শুরু করুন"}</button>
                ) : (
                  <div className="space-y-3 rounded-2xl bg-slate-50 p-4">
                    {qrDataUrl ? (
                      <div>
                        <div className="text-xs font-medium text-slate-500">Authenticator অ্যাপ দিয়ে Scan করুন</div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={qrDataUrl} alt="TOTP QR" className="mt-1 rounded bg-white p-1 ring-1 ring-slate-200" width={180} height={180} />
                      </div>
                    ) : null}
                    <div>
                      <div className="text-xs font-medium text-slate-500">Secret Key (একবারই দেখানো হয় — নিরাপদে রাখুন)</div>
                      <code className="mt-1 block break-all rounded bg-white p-2 text-sm ring-1 ring-slate-200">{secret}</code>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-500">otpauth URL (কিছু অ্যাপে সরাসরি ব্যবহার করা যায়)</div>
                      <code className="mt-1 block break-all rounded bg-white p-2 text-xs ring-1 ring-slate-200">{otpauthUrl}</code>
                    </div>
                    <p className="text-sm text-slate-600">Authenticator অ্যাপে <b>“Enter a setup key”</b> দিয়ে Secret টি যোগ করুন, তারপর অ্যাপের বর্তমান কোডটি দিন:</p>
                    <div className="flex flex-wrap gap-2">
                      <input id="totp-code" inputMode="numeric" className="input w-44 tracking-[0.3em]" placeholder="123456" maxLength={6} />
                      <button className="btn-primary min-h-[44px]" disabled={busy} onClick={confirm}>কোড নিশ্চিত করুন</button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            {status?.totpEnabled ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm text-slate-600">বন্ধ করতে বর্তমান কোড দিন
                  <input id="totp-disable-code" inputMode="numeric" className="input mt-1.5 w-44 tracking-[0.3em]" placeholder="123456" maxLength={6} />
                </label>
                <button className="btn-secondary min-h-[44px]" disabled={busy} onClick={disable}>2FA বন্ধ করুন</button>
              </div>
            ) : null}
            <p className="mt-4 text-xs text-slate-400">
              ফোন/Secret হারালে প্রতিষ্ঠানের OWNER Team পেজ থেকে আপনার 2FA রিসেট করে দিতে পারবেন — তারপর এখানে আবার চালু করুন।
            </p>
          </section>

          <VoiceSettingsCard />

          <MySecurityCard />

          <AccountVerificationCard />
          <BrandingCard />

          <DeveloperApiCard />

          <DataToolsCard />
        </div>
      </div>
    </div>
  );
}
