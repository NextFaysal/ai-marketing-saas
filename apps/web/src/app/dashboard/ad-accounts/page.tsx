"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";

interface AdAccount { id: string; platform: string; sourceType: string; externalId?: string | null; name: string; currency: string; integrationId?: string | null }

export default function AdAccountsPage() {
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [capi, setCapi] = useState<{ configured: boolean; pixelId?: string; hasDedicatedToken?: boolean; testEventCode?: string | null; purchaseTrigger?: string; enabled?: boolean; sendLeadEvents?: boolean } | null>(null);
  const [capiForm, setCapiForm] = useState({ pixelId: "", accessToken: "", testEventCode: "", purchaseTrigger: "placed", enabled: true, sendLeadEvents: true });
  const [capiEvents, setCapiEvents] = useState<{ id: string; eventName: string; sourceType: string; eventId: string; status: string; eventsReceived?: number | null; error?: string | null; createdAt: string }[]>([]);
  const [pubs, setPubs] = useState<{ id: string; platform: string; name: string; status: string; externalCampaignId?: string | null; error?: string | null; createdAt: string }[]>([]);
  const [ocSettings, setOcSettings] = useState<{ platform: string; conversionAction?: string | null; pixelCode?: string | null; trigger: string; enabled: boolean }[]>([]);
  const [ocLogs, setOcLogs] = useState<{ id: string; platform: string; eventId: string; status: string; detail?: string | null; createdAt: string }[]>([]);
  const [ocForm, setOcForm] = useState({ googleAccount: "", googleAction: "", tiktokAccount: "", tiktokPixel: "", trigger: "cod_confirmed" });
  const [gForm, setGForm] = useState({ name: "", dailyBudget: "500", countries: "BD", headlines: "", descriptions: "", finalUrl: "" });
  const [gKeywords, setGKeywords] = useState("");
  const [gNegatives, setGNegatives] = useState("");
  const [gSitelinks, setGSitelinks] = useState("");
  const [gCallouts, setGCallouts] = useState("");
  const [tForm, setTForm] = useState({ name: "", dailyBudget: "500", countries: "BD", adText: "", landingUrl: "", imageUrl: "", videoUrl: "" });
  const [pForm, setPForm] = useState({ name: "", dailyBudget: "500", countries: "BD", finalUrl: "", businessName: "", headlines: "", longHeadlines: "", descriptions: "", logoUrl: "", imageUrls: "" });
  const [form, setForm] = useState({ platform: "meta", name: "", externalId: "", currency: "BDT" });
  const [manual, setManual] = useState<Record<string, { date: string; spend: string }>>({});
  const [metaToken, setMetaToken] = useState("");
  const [googleForm, setGoogleForm] = useState({ customerId: "", clientId: "", clientSecret: "", refreshToken: "", developerToken: "", loginCustomerId: "" });
  const [tiktokForm, setTiktokForm] = useState({ advertiserId: "", accessToken: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    try {
      setAccounts(await apiFetch<AdAccount[]>(`/organizations/${orgId}/ad-accounts`));
      apiFetch(`/organizations/${orgId}/conversions/settings`).then((s: any) => { setCapi(s); if (s?.configured) setCapiForm((f) => ({ ...f, pixelId: s.pixelId ?? "", testEventCode: s.testEventCode ?? "", purchaseTrigger: s.purchaseTrigger ?? "placed", enabled: s.enabled ?? true, sendLeadEvents: s.sendLeadEvents ?? true })); }).catch(() => undefined);
      apiFetch(`/organizations/${orgId}/conversions/events`).then((rows: any) => setCapiEvents(rows)).catch(() => undefined);
      apiFetch(`/organizations/${orgId}/publish/publications`).then((rows: any) => setPubs(rows)).catch(() => undefined);
      apiFetch(`/organizations/${orgId}/offline-conversions/settings`).then((rows: any) => setOcSettings(rows)).catch(() => undefined);
      apiFetch(`/organizations/${orgId}/offline-conversions/logs`).then((rows: any) => setOcLogs(rows)).catch(() => undefined);
    }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("create"); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/ad-accounts`, {
        method: "POST",
        body: JSON.stringify({ platform: form.platform, sourceType: "csv", name: form.name, externalId: form.externalId || undefined, currency: form.currency }),
      });
      setForm({ platform: "meta", name: "", externalId: "", currency: "BDT" });
      setNotice("Ad Account তৈরি হয়েছে। এখন CSV Import বা Manual Entry দিয়ে Spend যোগ করুন।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function connectMeta(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("meta"); setError("");
    try {
      const res = await apiFetch<{ connectedAccounts: AdAccount[] }>(`/organizations/${orgId}/integrations/meta/connect`, {
        method: "POST", body: JSON.stringify({ accessToken: metaToken }),
      });
      setMetaToken("");
      setNotice(`Meta কানেক্ট হয়েছে: ${res.connectedAccounts.length}টি Ad Account পাওয়া গেছে।`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Meta connection failed"); }
    finally { setBusy(""); }
  }

  async function syncMeta(accountId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`sync-${accountId}`); setError("");
    try {
      const res = await apiFetch<{ rows: number; created: number; updated: number }>(`/organizations/${orgId}/ad-accounts/${accountId}/sync/meta-insights`, { method: "POST", body: JSON.stringify({}) });
      setNotice(`Meta Sync শেষ (শেষ ৩০ দিন): ${res.rows}টি Row, নতুন ${res.created}, আপডেট ${res.updated}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed"); }
    finally { setBusy(""); }
  }

  async function syncMetaExtra(accountId: string, kind: string, label: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`syncx-${accountId}`); setError("");
    try {
      const res = await apiFetch<{ rows: number }>(`/organizations/${orgId}/ad-accounts/${accountId}/sync/${kind}`, { method: "POST", body: JSON.stringify({}) });
      setNotice(`${label} Sync সম্পন্ন: ${res.rows}টি Row। ফলাফল Analytics পেজে।`);
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed"); }
    finally { setBusy(""); }
  }

  async function connectGoogle(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("google"); setError("");
    try {
      const res = await apiFetch<{ connectedAccounts: AdAccount[] }>(`/organizations/${orgId}/integrations/google/connect`, {
        method: "POST", body: JSON.stringify({ ...googleForm, loginCustomerId: googleForm.loginCustomerId || undefined }),
      });
      setGoogleForm({ customerId: "", clientId: "", clientSecret: "", refreshToken: "", developerToken: "", loginCustomerId: "" });
      setNotice(`Google Ads কানেক্ট হয়েছে: ${res.connectedAccounts[0]?.name ?? ""}`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Google connection failed"); }
    finally { setBusy(""); }
  }

  async function connectTikTok(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("tiktok"); setError("");
    try {
      const res = await apiFetch<{ connectedAccounts: AdAccount[] }>(`/organizations/${orgId}/integrations/tiktok/connect`, {
        method: "POST", body: JSON.stringify(tiktokForm),
      });
      setTiktokForm({ advertiserId: "", accessToken: "" });
      setNotice(`TikTok Ads কানেক্ট হয়েছে: ${res.connectedAccounts[0]?.name ?? ""}`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "TikTok connection failed"); }
    finally { setBusy(""); }
  }

  async function syncPlatform(accountId: string, platform: "google" | "tiktok") {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`sync-${accountId}`); setError("");
    try {
      const res = await apiFetch<{ rows: number; created: number; updated: number }>(`/organizations/${orgId}/ad-accounts/${accountId}/sync/${platform}-insights`, { method: "POST", body: JSON.stringify({}) });
      setNotice(`${platform === "google" ? "Google" : "TikTok"} Sync শেষ (শেষ ৩০ দিন): ${res.rows}টি Row, নতুন ${res.created}, আপডেট ${res.updated}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed"); }
    finally { setBusy(""); }
  }

  async function importCsv(accountId: string, file: File) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`csv-${accountId}`); setError("");
    try {
      const csvText = await file.text();
      const res = await apiFetch<{ totalRows: number; created: number; updated: number; failed: number }>(
        `/organizations/${orgId}/ad-accounts/${accountId}/metrics/import-csv`,
        { method: "POST", body: JSON.stringify({ fileName: file.name, csvText }) });
      setNotice(`CSV Import: মোট ${res.totalRows}, নতুন ${res.created}, আপডেট ${res.updated}, ব্যর্থ ${res.failed}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed"); }
    finally { setBusy(""); }
  }

  async function manualEntry(accountId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const entry = manual[accountId];
    if (!entry?.date || !entry?.spend) { setError("তারিখ ও Spend দিন"); return; }
    setBusy(`manual-${accountId}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/ad-accounts/${accountId}/metrics/manual`, {
        method: "POST", body: JSON.stringify(entry),
      });
      setNotice("Manual Entry সেভ হয়েছে। একই তারিখে আবার দিলে আগের মান আপডেট হবে।");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  const inputCls = "input mt-1";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Advertising Accounts</h1>
        <p className="text-sm text-slate-500">তিনভাবে Spend আসতে পারে: Meta API (Token থাকলে), CSV Import (Ads Manager Export), Manual Entry। প্ল্যাটফর্মের Reported Conversion আর আমাদের Tracked Conversion আলাদা রাখা হয়।</p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {accounts.length === 0 ? (
        <EmptyState title="এখনো কোনো Ad Account নেই" description="নিচে CSV/Manual এর জন্য Account তৈরি করুন অথবা Meta Token দিয়ে সরাসরি কানেক্ট করুন।" />
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => (
            <div key={a.id} className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">{a.name} <span className="ml-1 rounded bg-slate-100 px-2 py-0.5 text-xs capitalize">{a.platform}</span> <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{a.sourceType}</span></div>
                <div className="text-xs text-slate-400">{a.externalId ?? ""} · {a.currency}</div>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                {a.platform === "google" && a.integrationId ? (
                  <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => syncPlatform(a.id, "google")}>
                    {busy === `sync-${a.id}` ? "Sync হচ্ছে..." : "Google Insights Sync (৩০ দিন)"}
                  </button>
                ) : null}
                {a.platform === "tiktok" && a.integrationId ? (
                  <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => syncPlatform(a.id, "tiktok")}>
                    {busy === `sync-${a.id}` ? "Sync হচ্ছে..." : "TikTok Insights Sync (৩০ দিন)"}
                  </button>
                ) : null}
                {a.platform === "meta" && a.integrationId ? (
                  <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => syncMeta(a.id)}>
                    {busy === `sync-${a.id}` ? "Sync হচ্ছে..." : "Meta Insights Sync (৩০ দিন)"}
                  </button>
                ) : null}
                {a.platform === "meta" && a.integrationId ? (
                  <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => syncMetaExtra(a.id, "meta-ad-insights", "Ad-level")}>
                    {busy === `syncx-${a.id}` ? "Sync হচ্ছে..." : "Ad-level Sync"}
                  </button>
                ) : null}
                {a.platform === "meta" && a.integrationId ? (
                  <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => syncMetaExtra(a.id, "meta-breakdowns", "Breakdown")}>
                    {busy === `syncx-${a.id}` ? "Sync হচ্ছে..." : "Breakdown Sync"}
                  </button>
                ) : null}
                <label className="text-sm">
                  <span className="block text-xs text-slate-500">Ad Spend CSV</span>
                  <input type="file" accept=".csv,text/csv" className="text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(a.id, f); }} />
                </label>
                <label className="text-sm">তারিখ
                  <input type="date" className="ml-1 rounded-lg border px-2 py-1.5" value={manual[a.id]?.date ?? ""} onChange={(e) => setManual({ ...manual, [a.id]: { date: e.target.value, spend: manual[a.id]?.spend ?? "" } })} />
                </label>
                <label className="text-sm">Spend
                  <input className="ml-1 w-28 rounded-lg border px-2 py-1.5" placeholder="0.00" value={manual[a.id]?.spend ?? ""} onChange={(e) => setManual({ ...manual, [a.id]: { date: manual[a.id]?.date ?? "", spend: e.target.value } })} />
                </label>
                <button className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => manualEntry(a.id)}>Manual Entry সেভ</button>
              </div>
              <p className="mt-2 text-xs text-slate-400">CSV কলাম: date, spend (আবশ্যক), campaign_id, campaign_name, impressions, clicks, conversions, conversion_value, currency। একই দিন ও ক্যাম্পেইন আবার Import হলে মান আপডেট (Restate) হয়।</p>
            </div>
          ))}
        </div>
      )}

      <div className="card space-y-3 p-5">
        <div className="font-semibold">🔁 Server Conversions — Google Offline ও TikTok Events (Phase L)</div>
        <p className="text-sm text-slate-500">COD অর্ডার সম্পূর্ণ হলে সেই তথ্য Google/TikTok এ ফেরত যায় — Tracker এর ধরা gclid/ttclid দিয়েই মিলিয়ে। Click ID না থাকলে পাঠানো হয় না (লগে skipped দেখাবে)। Trigger: {ocSettings.map((s) => `${s.platform}=${s.trigger}${s.enabled ? "" : " (বন্ধ)"}`).join(", ") || "এখনো সেট করা হয়নি"}।</p>
        <div className="grid gap-2 md:grid-cols-2">
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <div className="text-sm font-medium">Google Ads</div>
            <select className="input" value={ocForm.googleAccount} onChange={(e) => setOcForm({ ...ocForm, googleAccount: e.target.value })}>
              <option value="">Google Account বেছে নিন</option>
              {accounts.filter((a) => a.platform === "google").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <input className="input" placeholder="Offline Conversion Action ID (Google Ads > Goals থেকে)" value={ocForm.googleAction} onChange={(e) => setOcForm({ ...ocForm, googleAction: e.target.value })} />
            <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
              const orgId = getOrganizationId(); if (!orgId || !ocForm.googleAccount || !ocForm.googleAction) { setError("Google Account ও Conversion Action ID দিন"); return; }
              try { await apiFetch(`/organizations/${orgId}/offline-conversions/settings/google`, { method: "PUT", body: JSON.stringify({ adAccountId: ocForm.googleAccount, conversionAction: ocForm.googleAction, trigger: ocForm.trigger, enabled: true }) }); setNotice("Google Offline Conversion সেটিং সেভ হয়েছে।"); await load(); } catch (e) { setError(e instanceof Error ? e.message : "সেভ ব্যর্থ"); }
            }}>সেভ করুন</button>
          </div>
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <div className="text-sm font-medium">TikTok Events API</div>
            <select className="input" value={ocForm.tiktokAccount} onChange={(e) => setOcForm({ ...ocForm, tiktokAccount: e.target.value })}>
              <option value="">TikTok Account বেছে নিন</option>
              {accounts.filter((a) => a.platform === "tiktok").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <input className="input" placeholder="TikTok Pixel Code (Events Manager থেকে)" value={ocForm.tiktokPixel} onChange={(e) => setOcForm({ ...ocForm, tiktokPixel: e.target.value })} />
            <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
              const orgId = getOrganizationId(); if (!orgId || !ocForm.tiktokAccount || !ocForm.tiktokPixel) { setError("TikTok Account ও Pixel Code দিন"); return; }
              try { await apiFetch(`/organizations/${orgId}/offline-conversions/settings/tiktok`, { method: "PUT", body: JSON.stringify({ adAccountId: ocForm.tiktokAccount, pixelCode: ocForm.tiktokPixel, trigger: ocForm.trigger, enabled: true }) }); setNotice("TikTok Events সেটিং সেভ হয়েছে।"); await load(); } catch (e) { setError(e instanceof Error ? e.message : "সেভ ব্যর্থ"); }
            }}>সেভ করুন</button>
          </div>
        </div>
        <label className="block text-sm">কখন পাঠানো হবে
          <select className="input mt-1 w-56" value={ocForm.trigger} onChange={(e) => setOcForm({ ...ocForm, trigger: e.target.value })}>
            <option value="placed">অর্ডার হওয়ার সাথে সাথে</option>
            <option value="cod_confirmed">COD নিশ্চিত হলে (সুপারিশ)</option>
            <option value="delivered">ডেলিভারি সম্পূর্ণ হলে</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
            const orgId = getOrganizationId(); if (!orgId) { setError("Organization নেই"); return; } try { const res = await apiFetch<{ examined: number; sent: number; skipped: number; failed: number }>(`/organizations/${orgId}/offline-conversions/upload-recent`, { method: "POST", body: JSON.stringify({ platform: "google", days: 30 }) }); setNotice(`Google Backfill: ${res.examined}টি অর্ডারের মধ্যে পাঠানো ${res.sent}, skipped ${res.skipped}, failed ${res.failed}।`); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Backfill ব্যর্থ"); }
          }}>⬆ Google তে গত ৩০ দিনের অর্ডার পাঠান</button>
          <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
            const orgId = getOrganizationId(); if (!orgId) { setError("Organization নেই"); return; } try { const res = await apiFetch<{ examined: number; sent: number; skipped: number; failed: number }>(`/organizations/${orgId}/offline-conversions/upload-recent`, { method: "POST", body: JSON.stringify({ platform: "tiktok", days: 30 }) }); setNotice(`TikTok Backfill: ${res.examined}টি অর্ডারের মধ্যে পাঠানো ${res.sent}, skipped ${res.skipped}, failed ${res.failed}।`); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Backfill ব্যর্থ"); }
          }}>⬆ TikTok এ গত ৩০ দিনের অর্ডার পাঠান</button>
        </div>
        {ocLogs.length > 0 && (
          <ul className="space-y-1 text-xs text-slate-500">
            {ocLogs.slice(0, 8).map((l) => <li key={l.id}>{l.platform} · {l.eventId} · <b>{l.status}</b>{l.detail ? ` — ${l.detail}` : ""} · {new Date(l.createdAt).toLocaleString("bn-BD")}</li>)}
          </ul>
        )}
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">🚀 Google / TikTok এ সরাসরি Publish</h2>
        <p className="text-sm text-slate-500">সবকিছু PAUSED/DISABLED অবস্থায় তৈরি হয়। Campaign সক্রিয় করা প্ল্যাটফর্মের নিজের ইন্টারফেস থেকে যাচাই করে করবেন। প্রতিটি ধাপের ফলাফল নিচের তালিকায় থাকে — কোনো ধাপ ব্যর্থ হলে Publication "failed" দেখাবে, সফল সাজানো হবে না।</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <form className="space-y-2 rounded-xl bg-slate-50 p-4" onSubmit={async (e) => {
            e.preventDefault();
            const orgId = getOrganizationId(); if (!orgId) return;
            const acc = accounts.find((x) => x.platform === "google" && x.integrationId);
            if (!acc) { setError("আগে একটি Google Ads Account কানেক্ট করুন"); return; }
            setBusy("gpub"); setError("");
            try {
              const pub = await apiFetch<any>(`/organizations/${orgId}/publish/google`, { method: "POST", body: JSON.stringify({
                adAccountId: acc.id, name: gForm.name, dailyBudget: gForm.dailyBudget,
                countryCodes: gForm.countries.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
                headlines: gForm.headlines.split("\n").map((x) => x.trim()).filter(Boolean),
                descriptions: gForm.descriptions.split("\n").map((x) => x.trim()).filter(Boolean),
                finalUrl: gForm.finalUrl,
                keywords: gKeywords.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [text, mt] = l.split("|").map((x) => x.trim()); return { text, matchType: mt || undefined }; }),
                negativeKeywords: gNegatives.split(",").map((x) => x.trim()).filter(Boolean),
                sitelinks: gSitelinks.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [text, url] = l.split("|").map((x) => x.trim()); return { text, url }; }),
                callouts: gCallouts.split(",").map((x) => x.trim()).filter(Boolean),
              }) });
              setNotice(pub.status === "created_paused" ? "Google Campaign তৈরি হয়েছে (PAUSED)।" : `Google Publish সম্পন্ন হয়নি: ${pub.error}`);
              await load();
            } catch (err) { setError(err instanceof Error ? err.message : "Publish failed"); }
            finally { setBusy(""); }
          }}>
            <div className="font-medium">Google Search Campaign</div>
            <input className="input" placeholder="Campaign এর নাম" value={gForm.name} onChange={(e) => setGForm({ ...gForm, name: e.target.value })} required />
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="দৈনিক বাজেট" value={gForm.dailyBudget} onChange={(e) => setGForm({ ...gForm, dailyBudget: e.target.value })} required />
              <input className="input" placeholder="দেশ (BD, IN)" value={gForm.countries} onChange={(e) => setGForm({ ...gForm, countries: e.target.value })} required />
            </div>
            <textarea className="input" rows={3} placeholder={"Headline — প্রতি লাইনে একটি (কমপক্ষে ৩টি, সর্বোচ্চ ৩০ অক্ষর)"} value={gForm.headlines} onChange={(e) => setGForm({ ...gForm, headlines: e.target.value })} required />
            <textarea className="input" rows={2} placeholder={"Description — প্রতি লাইনে একটি (কমপক্ষে ২টি, সর্বোচ্চ ৯০ অক্ষর)"} value={gForm.descriptions} onChange={(e) => setGForm({ ...gForm, descriptions: e.target.value })} required />
            <input className="input" placeholder="Final URL (https://...)" value={gForm.finalUrl} onChange={(e) => setGForm({ ...gForm, finalUrl: e.target.value })} required />
            <textarea className="input md:col-span-2" rows={3} placeholder="Keywords — প্রতি লাইনে একটি: keyword অথবা keyword|PHRASE (ম্যাচ টাইপ না দিলে EXACT)। যেমন: জুতা কিনুন" value={gKeywords} onChange={(e) => setGKeywords(e.target.value)} required />
            <input className="input md:col-span-2" placeholder="Negative Keywords (কমা দিয়ে, ঐচ্ছিক)" value={gNegatives} onChange={(e) => setGNegatives(e.target.value)} />
            <textarea className="input md:col-span-2" rows={2} placeholder="Sitelinks (ঐচ্ছিক) — প্রতি লাইনে: লেখা | URL" value={gSitelinks} onChange={(e) => setGSitelinks(e.target.value)} />
            <input className="input md:col-span-2" placeholder="Callouts (ঐচ্ছিক, কমা দিয়ে — প্রতিটি সর্বোচ্চ ২৫ অক্ষর)" value={gCallouts} onChange={(e) => setGCallouts(e.target.value)} />
            <button className="btn-primary btn-sm" disabled={busy !== ""}>{busy === "gpub" ? "তৈরি হচ্ছে..." : "Google এ তৈরি করুন (PAUSED)"}</button>
          </form>
          <form className="space-y-2 rounded-xl bg-slate-50 p-4" onSubmit={async (e) => {
            e.preventDefault();
            const orgId = getOrganizationId(); if (!orgId) return;
            const acc = accounts.find((x) => x.platform === "tiktok" && x.integrationId);
            if (!acc) { setError("আগে একটি TikTok Ads Account কানেক্ট করুন"); return; }
            setBusy("tpub"); setError("");
            try {
              const pub = await apiFetch<any>(`/organizations/${orgId}/publish/tiktok`, { method: "POST", body: JSON.stringify({
                adAccountId: acc.id, name: tForm.name, dailyBudget: tForm.dailyBudget,
                countryCodes: tForm.countries.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
                adText: tForm.adText, landingUrl: tForm.landingUrl, imageUrl: tForm.imageUrl || undefined, videoUrl: tForm.videoUrl || undefined,
              }) });
              setNotice(pub.status === "created_paused" ? "TikTok Campaign তৈরি হয়েছে (DISABLED)।" : `TikTok Publish সম্পন্ন হয়নি: ${pub.error}`);
              await load();
            } catch (err) { setError(err instanceof Error ? err.message : "Publish failed"); }
            finally { setBusy(""); }
          }}>
            <div className="font-medium">TikTok Traffic Campaign</div>
            <input className="input" placeholder="Campaign এর নাম" value={tForm.name} onChange={(e) => setTForm({ ...tForm, name: e.target.value })} required />
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="দৈনিক বাজেট" value={tForm.dailyBudget} onChange={(e) => setTForm({ ...tForm, dailyBudget: e.target.value })} required />
              <input className="input" placeholder="দেশ (BD)" value={tForm.countries} onChange={(e) => setTForm({ ...tForm, countries: e.target.value })} required />
            </div>
            <input className="input" placeholder="Ad Text" value={tForm.adText} onChange={(e) => setTForm({ ...tForm, adText: e.target.value })} required />
            <input className="input" placeholder="Landing URL" value={tForm.landingUrl} onChange={(e) => setTForm({ ...tForm, landingUrl: e.target.value })} required />
            <input className="input" placeholder="ছবির URL (https) — অথবা নিচে Video URL দিন" value={tForm.imageUrl} onChange={(e) => setTForm({ ...tForm, imageUrl: e.target.value })} />
            <input className="input" placeholder="Video URL (https, ঐচ্ছিক) — দিলে Video Ad (SINGLE_VIDEO) তৈরি হবে" value={tForm.videoUrl} onChange={(e) => setTForm({ ...tForm, videoUrl: e.target.value })} />
            <button className="btn-primary btn-sm" disabled={busy !== ""}>{busy === "tpub" ? "তৈরি হচ্ছে..." : "TikTok এ তৈরি করুন (DISABLED)"}</button>
          </form>
        </div>
        <form className="space-y-2 rounded-xl bg-slate-50 p-4" onSubmit={async (e) => {
          e.preventDefault();
          const orgId = getOrganizationId(); if (!orgId) return;
          const acc = accounts.find((x) => x.platform === "google" && x.integrationId);
          if (!acc) { setError("আগে একটি Google Ads Account কানেক্ট করুন"); return; }
          setBusy("ppub"); setError("");
          try {
            const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);
            const pub = await apiFetch<any>(`/organizations/${orgId}/publish/google-pmax`, { method: "POST", body: JSON.stringify({
              adAccountId: acc.id, name: pForm.name, dailyBudget: pForm.dailyBudget,
              countryCodes: pForm.countries.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
              finalUrl: pForm.finalUrl, businessName: pForm.businessName,
              headlines: lines(pForm.headlines), longHeadlines: lines(pForm.longHeadlines), descriptions: lines(pForm.descriptions),
              logoUrl: pForm.logoUrl, imageUrls: lines(pForm.imageUrls),
            }) });
            setNotice(pub.status === "created_paused" ? "Performance Max Campaign তৈরি হয়েছে (PAUSED)।" : `PMax Publish সম্পন্ন হয়নি: ${pub.error}`);
            await load();
          } catch (err) { setError(err instanceof Error ? err.message : "Publish failed"); }
          finally { setBusy(""); }
        }}>
          <div className="font-medium">Google Performance Max (Asset Group)</div>
          <p className="text-xs text-slate-500">PMax এ Keyword থাকে না — Google সব প্লেসমেন্টে Asset মিলিয়ে দেখায়। Campaign ও Asset Group দুটোই PAUSED থাকে। ছবি URL থেকে সার্ভার নিজে ডাউনলোড করে Asset হিসেবে আপলোড করে।</p>
          <div className="grid gap-2 md:grid-cols-2">
            <input className="input" placeholder="Campaign এর নাম" value={pForm.name} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} required />
            <input className="input" placeholder="ব্যবসার নাম (সর্বোচ্চ ২৫ অক্ষর)" value={pForm.businessName} onChange={(e) => setPForm({ ...pForm, businessName: e.target.value })} required />
            <input className="input" placeholder="দৈনিক বাজেট" value={pForm.dailyBudget} onChange={(e) => setPForm({ ...pForm, dailyBudget: e.target.value })} required />
            <input className="input" placeholder="দেশ (BD, IN)" value={pForm.countries} onChange={(e) => setPForm({ ...pForm, countries: e.target.value })} required />
            <input className="input" placeholder="Final URL (https://...)" value={pForm.finalUrl} onChange={(e) => setPForm({ ...pForm, finalUrl: e.target.value })} required />
            <input className="input" placeholder="Logo ছবির URL (https)" value={pForm.logoUrl} onChange={(e) => setPForm({ ...pForm, logoUrl: e.target.value })} required />
            <textarea className="input" rows={3} placeholder={"Headlines — প্রতি লাইনে একটি (৩–১৫টি, সর্বোচ্চ ৩০ অক্ষর)"} value={pForm.headlines} onChange={(e) => setPForm({ ...pForm, headlines: e.target.value })} required />
            <textarea className="input" rows={3} placeholder={"Marketing ছবির URL — প্রতি লাইনে একটি (১–২০টি)"} value={pForm.imageUrls} onChange={(e) => setPForm({ ...pForm, imageUrls: e.target.value })} required />
            <textarea className="input" rows={2} placeholder={"Long Headlines — প্রতি লাইনে একটি (১–৫টি, সর্বোচ্চ ৯০ অক্ষর)"} value={pForm.longHeadlines} onChange={(e) => setPForm({ ...pForm, longHeadlines: e.target.value })} required />
            <textarea className="input" rows={2} placeholder={"Descriptions — প্রতি লাইনে একটি (২–৫টি, সর্বোচ্চ ৯০ অক্ষর)"} value={pForm.descriptions} onChange={(e) => setPForm({ ...pForm, descriptions: e.target.value })} required />
          </div>
          <button className="btn-primary btn-sm" disabled={busy !== ""}>{busy === "ppub" ? "তৈরি হচ্ছে..." : "Performance Max তৈরি করুন (PAUSED)"}</button>
        </form>
        {pubs.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {pubs.slice(0, 8).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                <span className="capitalize">{p.platform} · {p.name}</span>
                <span className={p.status === "created_paused" ? "text-green-600" : p.status === "failed" ? "text-red-600" : "text-slate-500"}>{p.status}{p.externalCampaignId ? ` · ${p.externalCampaignId}` : ""}{p.error ? ` · ${p.error}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">📡 Meta Conversions API (CAPI)</h2>
          <span className={capi?.configured && capi.enabled ? "badge-green" : "badge-slate"}>{capi?.configured ? (capi.enabled ? "চালু" : "বন্ধ") : "সেটআপ হয়নি"}</span>
        </div>
        <p className="text-sm text-slate-500">আসল অর্ডার ও Lead সার্ভার থেকে সরাসরি Meta কে পাঠান — ব্রাউজার Pixel এর হারানো সিগন্যাল ফিরে আসে। Event শুধু তখনই "Sent" ধরা হয় যখন Meta <code>events_received</code> দিয়ে নিশ্চিত করে। Browser Pixel এর সাথে একই Event ID (<code>purchase-অর্ডারনম্বর</code>) ব্যবহার হয়, তাই Duplicate গণনা হয় না।</p>
        <form className="grid gap-2 sm:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault();
          const orgId = getOrganizationId(); if (!orgId) return;
          setBusy("capi"); setError("");
          try {
            const s = await apiFetch(`/organizations/${orgId}/conversions/settings`, { method: "PATCH", body: JSON.stringify({ ...capiForm, accessToken: capiForm.accessToken || undefined, testEventCode: capiForm.testEventCode || null }) });
            setCapi(s as any); setCapiForm({ ...capiForm, accessToken: "" }); setNotice("CAPI সেটিংস সংরক্ষণ হয়েছে।");
          } catch (err) { setError(err instanceof Error ? err.message : "Save failed"); }
          finally { setBusy(""); }
        }}>
          <label className="block text-sm">Dataset / Pixel ID<input className="input mt-1" value={capiForm.pixelId} onChange={(e) => setCapiForm({ ...capiForm, pixelId: e.target.value })} required placeholder="যেমন: 1234567890" /></label>
          <label className="block text-sm">CAPI Access Token (ঐচ্ছিক)<input className="input mt-1" type="password" value={capiForm.accessToken} onChange={(e) => setCapiForm({ ...capiForm, accessToken: e.target.value })} placeholder={capi?.hasDedicatedToken ? "সংরক্ষিত আছে — বদলাতে নতুন দিন" : "ফাঁকা রাখলে Ads Token ব্যবহৃত হবে"} /></label>
          <label className="block text-sm">Test Event Code (ঐচ্ছিক)<input className="input mt-1" value={capiForm.testEventCode} onChange={(e) => setCapiForm({ ...capiForm, testEventCode: e.target.value })} placeholder="TEST12345" /></label>
          <label className="block text-sm">Purchase কখন পাঠাবে
            <select className="input mt-1" value={capiForm.purchaseTrigger} onChange={(e) => setCapiForm({ ...capiForm, purchaseTrigger: e.target.value })}>
              <option value="placed">অর্ডার হলেই</option>
              <option value="cod_confirmed">COD কনফার্ম হলে</option>
              <option value="delivered">ডেলিভারি সম্পন্ন হলে</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={capiForm.enabled} onChange={(e) => setCapiForm({ ...capiForm, enabled: e.target.checked })} /> CAPI চালু</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={capiForm.sendLeadEvents} onChange={(e) => setCapiForm({ ...capiForm, sendLeadEvents: e.target.checked })} /> Lead Event পাঠান</label>
          <span className="flex gap-2">
            <button className="btn-primary" disabled={busy !== ""}>{busy === "capi" ? "সংরক্ষণ হচ্ছে..." : "সংরক্ষণ"}</button>
            <button type="button" className="btn-secondary" disabled={busy !== ""} onClick={async () => {
              const orgId = getOrganizationId(); if (!orgId) return;
              setBusy("capitest"); setError("");
              try { await apiFetch(`/organizations/${orgId}/conversions/test`, { method: "POST" }); setNotice("Test Event পাঠানো হয়েছে — Meta Events Manager এর Test Events ট্যাবে দেখুন।"); await load(); }
              catch (err) { setError(err instanceof Error ? err.message : "Test failed"); }
              finally { setBusy(""); }
            }}>{busy === "capitest" ? "পাঠাচ্ছে..." : "Test Event পাঠান"}</button>
          </span>
        </form>
        {capiEvents.length > 0 ? (
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">Event</th><th className="px-3 py-2">সূত্র</th><th className="px-3 py-2">Event ID</th><th className="px-3 py-2">অবস্থা</th><th className="px-3 py-2">সময়</th></tr></thead>
              <tbody>{capiEvents.slice(0, 10).map((ev) => (
                <tr key={ev.id} className="border-t"><td className="px-3 py-2 font-medium">{ev.eventName}</td><td className="px-3 py-2">{ev.sourceType}</td><td className="px-3 py-2">{ev.eventId}</td><td className="px-3 py-2">{ev.status === "sent" ? <span className="text-green-600">✓ sent ({ev.eventsReceived})</span> : <span className="text-red-600" title={ev.error ?? ""}>✗ failed</span>}</td><td className="px-3 py-2">{new Date(ev.createdAt).toLocaleString()}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}
      </div>

      <form onSubmit={createAccount} className="space-y-3 card p-5">
        <div className="font-semibold">CSV / Manual এর জন্য Account তৈরি</div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <label className="block text-sm">প্ল্যাটফর্ম
            <select className={inputCls} value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
              <option value="meta">Meta</option><option value="google">Google</option><option value="tiktok">TikTok</option><option value="manual">Manual / Other</option>
            </select>
          </label>
          <label className="block text-sm">নাম<input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Main Facebook Ads" /></label>
          <label className="block text-sm">Account ID (ঐচ্ছিক)<input className={inputCls} value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} placeholder="act_123456" /></label>
          <label className="block text-sm">মুদ্রা<input className={inputCls} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></label>
        </div>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>Account তৈরি করুন</button>
      </form>

      <form onSubmit={connectMeta} className="space-y-3 card p-5">
        <div className="font-semibold">Meta API দিয়ে কানেক্ট (যদি Token থাকে)</div>
        <p className="text-sm text-slate-500">
          Meta App (Marketing API, ads_read) থেকে পাওয়া User/System-User Access Token লাগবে। অন্যের Account এর জন্য
          Advanced Access ও App Review দরকার হতে পারে, সেটি Meta এর প্রক্রিয়া, আমরা বাইপাস করি না।
          Token সার্ভারে এনক্রিপ্ট করে রাখা হয়, যাচাই ব্যর্থ হলে সেভ হয় না।
        </p>
        <label className="block text-sm">Access Token
          <input className={inputCls} type="password" value={metaToken} onChange={(e) => setMetaToken(e.target.value)} required placeholder="EAA..." />
        </label>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>
          {busy === "meta" ? "যাচাই হচ্ছে..." : "যাচাই করে Meta কানেক্ট করুন"}
        </button>
      </form>

      <form onSubmit={connectGoogle} className="space-y-3 card p-5">
        <div className="font-semibold">Google Ads API দিয়ে কানেক্ট</div>
        <p className="text-sm text-slate-500">
          Google Ads API এর জন্য লাগবে: Developer Token (Google Ads API Center থেকে, Approval Level অনুযায়ী Access),
          OAuth Client ID/Secret ও একটি Refresh Token। সবগুলো যাচাই করে তারপর এনক্রিপ্ট করে সেভ হয়।
          Developer Token অনুমোদিত না হলে Google নিজেই Error ফেরত দেবে, সেটি এখানে দেখা যাবে।
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Customer ID<input className={inputCls} value={googleForm.customerId} onChange={(e) => setGoogleForm({ ...googleForm, customerId: e.target.value })} required placeholder="123-456-7890" /></label>
          <label className="block text-sm">Developer Token<input className={inputCls} type="password" value={googleForm.developerToken} onChange={(e) => setGoogleForm({ ...googleForm, developerToken: e.target.value })} required /></label>
          <label className="block text-sm">OAuth Client ID<input className={inputCls} value={googleForm.clientId} onChange={(e) => setGoogleForm({ ...googleForm, clientId: e.target.value })} required /></label>
          <label className="block text-sm">OAuth Client Secret<input className={inputCls} type="password" value={googleForm.clientSecret} onChange={(e) => setGoogleForm({ ...googleForm, clientSecret: e.target.value })} required /></label>
          <label className="block text-sm">Refresh Token<input className={inputCls} type="password" value={googleForm.refreshToken} onChange={(e) => setGoogleForm({ ...googleForm, refreshToken: e.target.value })} required /></label>
          <label className="block text-sm">Manager (MCC) ID, থাকলে<input className={inputCls} value={googleForm.loginCustomerId} onChange={(e) => setGoogleForm({ ...googleForm, loginCustomerId: e.target.value })} placeholder="ঐচ্ছিক" /></label>
        </div>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>
          {busy === "google" ? "যাচাই হচ্ছে..." : "যাচাই করে Google Ads কানেক্ট করুন"}
        </button>
      </form>

      <form onSubmit={connectTikTok} className="space-y-3 card p-5">
        <div className="font-semibold">TikTok Ads API দিয়ে কানেক্ট</div>
        <p className="text-sm text-slate-500">TikTok Marketing API App থেকে পাওয়া Advertiser ID ও দীর্ঘমেয়াদি Access Token লাগবে। Token যাচাই ব্যর্থ হলে সেভ হবে না।</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Advertiser ID<input className={inputCls} value={tiktokForm.advertiserId} onChange={(e) => setTiktokForm({ ...tiktokForm, advertiserId: e.target.value })} required /></label>
          <label className="block text-sm">Access Token<input className={inputCls} type="password" value={tiktokForm.accessToken} onChange={(e) => setTiktokForm({ ...tiktokForm, accessToken: e.target.value })} required /></label>
        </div>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>
          {busy === "tiktok" ? "যাচাই হচ্ছে..." : "যাচাই করে TikTok কানেক্ট করুন"}
        </button>
      </form>
    </div>
  );
}
