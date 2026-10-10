"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";

interface AdAccount { id: string; name: string; platform: string; sourceType: string; externalId?: string | null }
interface Product { id: string; name: string; priceMinor: string; currency: string }
interface AdItem { id: string; name: string; primaryText: string; headline?: string | null; linkUrl: string; externalAdId?: string | null; createdByAi: boolean; effectiveStatus?: string | null; issuesInfo?: unknown }
interface AdSet { id: string; name: string; dailyBudgetMinor?: string | null; optimizationGoal: string; pageId?: string | null; pixelId?: string | null; targeting: { countries?: string[] }; externalAdSetId?: string | null; effectiveStatus?: string | null; startTime?: string | null; endTime?: string | null; daypart?: { day: number; startHour: number; endHour: number }[] | null; ads: AdItem[] }
interface PublishLog { id: string; step: string; status: string; externalId?: string | null; error?: string | null; createdAt: string }
interface Plan {
  adAccountId: string; id: string; name: string; objective: string; status: string; advantagePlus?: boolean; metaStatus?: string | null; metaEffectiveStatus?: string | null; lastStatusSyncAt?: string | null; healthIssues?: { level: string; name: string; status: string }[]; externalCampaignId?: string | null; approvedById?: string | null; rejectionReason?: string | null; adSets: AdSet[]; publishLogs: PublishLog[] }

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", pending_approval: "অনুমোদনের অপেক্ষায়", approved: "অনুমোদিত", rejected: "প্রত্যাখ্যাত",
  publishing: "প্রকাশ হচ্ছে", published: "প্রকাশিত (Meta তে)", publish_failed: "প্রকাশ ব্যর্থ",
};

export default function CampaignBuilderPage() {
  const params = useSearchParams();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [createForm, setCreateForm] = useState({ name: "", objective: "OUTCOME_SALES", adAccountId: "" });
  const [adSetForm, setAdSetForm] = useState({ name: "", dailyBudget: "", optimizationGoal: "LINK_CLICKS", pageId: "", pixelId: "", countries: "BD", interests: "", audienceIds: "", excludeIds: "" });
  const [adSetStart, setAdSetStart] = useState("");
  const [adSetEnd, setAdSetEnd] = useState("");
  type AdForm = { name: string; primaryText: string; headline: string; linkUrl: string; imageUrl: string; format: string; imageAssetId: string; videoAssetId: string; carouselText: string };
  const emptyAdForm: AdForm = { name: "", primaryText: "", headline: "", linkUrl: "", imageUrl: "", format: "link", imageAssetId: "", videoAssetId: "", carouselText: "" };
  const [adForms, setAdForms] = useState<Record<string, AdForm>>({});
  const [assets, setAssets] = useState<{ id: string; kind: string; name: string; status: string; adAccountId: string }[]>([]);
  const [audList, setAudList] = useState<{ id: string; name: string; externalAudienceId?: string | null }[]>([]);
  const [savedList, setSavedList] = useState<{ id: string; name: string; targeting: Record<string, unknown> }[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; objective: string }[]>([]);
  const [blueprints, setBlueprints] = useState<{ key: string; name: string; description: string }[]>([]);
  const [bpForm, setBpForm] = useState({ blueprintKey: "", adAccountId: "", productId: "" });
  const [copySelection, setCopySelection] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [preflight, setPreflight] = useState<{ checkedAds: number; findings: { adName: string; field: string; severity: string; snippet: string; explanation: string; suggestion: string }[]; summary: { high: number; medium: number; low: number } } | null>(null);

  const orgId = typeof window !== "undefined" ? getOrganizationId() : null;
  const editable = plan ? ["draft", "rejected"].includes(plan.status) : false;

  const loadPlan = useCallback(async (id: string) => {
    const o = getOrganizationId(); if (!o) return;
    setPlan(await apiFetch<Plan>(`/organizations/${o}/campaign-plans/${id}`));
  }, []);

  useEffect(() => {
    (async () => {
      const o = getOrganizationId(); if (!o) return;
      try {
        const [accs, prods] = await Promise.all([
          apiFetch<AdAccount[]>(`/organizations/${o}/ad-accounts`),
          apiFetch<Product[]>(`/organizations/${o}/products`),
        ]);
        setAccounts(accs.filter((a) => a.platform === "meta"));
        setProducts(prods);
        apiFetch(`/organizations/${o}/creatives`).then((r: any) => setAssets(r)).catch(() => undefined);
        apiFetch(`/organizations/${o}/audiences`).then((r: any) => setAudList(r)).catch(() => undefined);
        apiFetch(`/organizations/${o}/audiences/saved/list`).then((r: any) => setSavedList(r)).catch(() => undefined);
        apiFetch(`/organizations/${o}/campaign-plans/templates/list`).then((r: any) => setTemplates(r)).catch(() => undefined);
        apiFetch(`/organizations/${o}/campaign-plans/blueprints/list`).then((r: any) => setBlueprints(r)).catch(() => undefined);
        if (accs.length) setCreateForm((f) => ({ ...f, adAccountId: f.adAccountId || accs.find((a) => a.platform === "meta")?.id || "" }));
      } catch { /* lists are optional for viewing */ }
      const id = params.get("id");
      if (id) { try { await loadPlan(id); } catch (e) { setError(e instanceof Error ? e.message : "Plan load failed"); } }
    })();
  }, [params, loadPlan]);

  async function wrap<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(key); setError("");
    try { return await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); return null; }
    finally { setBusy(""); }
  }

  async function createPlan(e: React.FormEvent) {
    e.preventDefault(); if (!orgId) return;
    const created = await wrap("create", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans`, { method: "POST", body: JSON.stringify(createForm) }));
    if (created) { setPlan(created); setNotice("Plan তৈরি হয়েছে (Draft)। এবার Ad Set ও Ad যোগ করুন।"); }
  }

  async function addAdSet(e: React.FormEvent) {
    e.preventDefault(); if (!orgId || !plan) return;
    const res = await wrap("adset", () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets`, {
      method: "POST",
      body: JSON.stringify({
        name: adSetForm.name, dailyBudget: adSetForm.dailyBudget || undefined, optimizationGoal: adSetForm.optimizationGoal,
        pageId: adSetForm.pageId, pixelId: adSetForm.pixelId || undefined,
        countries: adSetForm.countries.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
        interests: adSetForm.interests.split(",").map((x) => x.trim()).filter(Boolean),
        customAudienceIds: adSetForm.audienceIds.split(",").map((x) => x.trim()).filter(Boolean),
        excludedAudienceIds: adSetForm.excludeIds.split(",").map((x) => x.trim()).filter(Boolean),
        startTime: adSetStart ? new Date(adSetStart).toISOString() : undefined,
        endTime: adSetEnd ? new Date(adSetEnd).toISOString() : undefined,
      }),
    }));
    if (res) { setAdSetForm({ name: "", dailyBudget: "", optimizationGoal: "LINK_CLICKS", pageId: "", pixelId: "", countries: "BD", interests: "", audienceIds: "", excludeIds: "" }); setAdSetStart(""); setAdSetEnd(""); await loadPlan(plan.id); }
  }

  async function addAd(adSetId: string) {
    if (!orgId || !plan) return;
    const f = adForms[adSetId];
    if (!f?.name || !f?.primaryText || !f?.linkUrl) { setError("Ad এর নাম, Primary Text ও Link লাগবে"); return; }
    const carouselCards = f.format === "carousel"
      ? f.carouselText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
          const [title, linkUrl, imageUrl] = l.split("|").map((x) => x?.trim());
          return { title: title ?? "", linkUrl: linkUrl ?? "", imageUrl: imageUrl || undefined };
        })
      : undefined;
    const payload = {
      name: f.name, primaryText: f.primaryText, headline: f.headline || undefined, linkUrl: f.linkUrl,
      imageUrl: f.imageUrl || undefined, format: f.format,
      imageAssetId: f.format === "link" && f.imageAssetId ? f.imageAssetId : undefined,
      videoAssetId: f.format === "video" ? f.videoAssetId || undefined : undefined,
      carouselCards,
    };
    const res = await wrap(`ad-${adSetId}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSetId}/ads`, { method: "POST", body: JSON.stringify(payload) }));
    if (res) { setAdForms((s) => ({ ...s, [adSetId]: emptyAdForm })); await loadPlan(plan.id); }
  }

  const setAdField = (adSetId: string, field: keyof AdForm, value: string) =>
    setAdForms((s) => ({ ...s, [adSetId]: { ...(s[adSetId] ?? emptyAdForm), [field]: value } }));

  async function generateCopy(adSetId: string) {
    if (!orgId || !plan) return;
    const productId = copySelection[adSetId];
    if (!productId) { setError("AI Copy এর জন্য একটি প্রোডাক্ট বেছে নিন"); return; }
    const res = await wrap(`copy-${adSetId}`, () => apiFetch<{ created: unknown[]; provider: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/generate-copy`, { method: "POST", body: JSON.stringify({ adSetId, productId }) }));
    if (res) { setNotice(`AI Copy তৈরি হয়েছে (${res.provider === "dev-template" ? "Dev Template" : res.provider})। Draft Ad হিসেবে যোগ হয়েছে, চাইলে মুছে নিজের লেখা দিন।`); await loadPlan(plan.id); }
  }

  async function action(name: string, key: string, body?: unknown) {
    if (!orgId || !plan) return;
    const res = await wrap(key, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/${name}`, { method: "POST", body: body ? JSON.stringify(body) : undefined }));
    if (res) { setPlan(res); }
  }

  async function rejectPlan() {
    const reason = window.prompt("প্রত্যাখ্যানের কারণ লিখুন:");
    if (reason) await action("reject", "reject", { reason });
  }

  const inputCls = "input mt-1";

  if (!plan) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Campaign Builder</h1>
          <p className="text-sm text-slate-500">নতুন Plan তৈরি করুন। এটি শুধুই Draft, Meta তে কিছু যাবে না অনুমোদন ও Publish ছাড়া।</p>
        </div>
        {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        <form onSubmit={createPlan} className="space-y-3 card p-5">
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">Plan এর নাম<input className={inputCls} value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} required placeholder="Eid Sale 2026" /></label>
            <label className="block text-sm">Objective
              <select className={inputCls} value={createForm.objective} onChange={(e) => setCreateForm({ ...createForm, objective: e.target.value })}>
                <option value="OUTCOME_SALES">Sales</option><option value="OUTCOME_TRAFFIC">Traffic</option>
                <option value="OUTCOME_LEADS">Leads</option><option value="OUTCOME_ENGAGEMENT">Engagement</option><option value="OUTCOME_AWARENESS">Awareness</option>
              </select>
            </label>
            <label className="block text-sm">Meta Ad Account
              <select className={inputCls} value={createForm.adAccountId} onChange={(e) => setCreateForm({ ...createForm, adAccountId: e.target.value })} required>
                <option value="">বেছে নিন</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.sourceType === "api" ? "API connected" : "CSV/manual - publish হবে না"})</option>)}
              </select>
            </label>
          </div>
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>Draft Plan তৈরি করুন</button>
          <p className="text-xs text-slate-400">Publish করতে হলে Ad Account টি Meta API দিয়ে কানেক্ট করা থাকতে হবে (Advertising Accounts পেজ)। CSV/Manual অ্যাকাউন্টে Publish হবে না, সার্ভারই আটকে দেবে।</p>
        </form>

        {blueprints.length > 0 ? (
          <div className="card space-y-3 p-5">
            <div className="font-semibold">⚡ Blueprint দিয়ে শুরু করুন</div>
            <p className="text-xs text-slate-400">তৈরি কাঠামো থেকে Draft তৈরি হয় — বাজেটসহ সব মান পরে বদলাতে পারবেন। বাজেটগুলো শুরুর মান মাত্র, কোনো পারফরম্যান্স ডেটার ভিত্তিতে সাজেস্ট করা নয়।</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="input" value={bpForm.blueprintKey} onChange={(e) => setBpForm({ ...bpForm, blueprintKey: e.target.value })}>
                <option value="">Blueprint বেছে নিন</option>
                {blueprints.map((bp) => <option key={bp.key} value={bp.key}>{bp.name}</option>)}
              </select>
              <select className="input" value={bpForm.productId} onChange={(e) => setBpForm({ ...bpForm, productId: e.target.value })}>
                <option value="">প্রোডাক্ট (ঐচ্ছিক — কপিতে আসল নাম/দাম বসবে)</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {bpForm.blueprintKey ? <p className="text-sm text-slate-500">{blueprints.find((x) => x.key === bpForm.blueprintKey)?.description}</p> : null}
            <button className="btn-secondary btn-sm" disabled={busy !== "" || !bpForm.blueprintKey || !createForm.adAccountId} onClick={async () => {
              const res = await wrap("bp", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/blueprints/instantiate`, { method: "POST", body: JSON.stringify({ blueprintKey: bpForm.blueprintKey, adAccountId: createForm.adAccountId, productId: bpForm.productId || undefined }) }));
              if (res) { setPlan(res); setNotice("Blueprint থেকে Draft তৈরি হয়েছে। Page ID ও Pixel ID Ad Set এ বসিয়ে সম্পূর্ণ করুন।"); }
            }}>{busy === "bp" ? "তৈরি হচ্ছে..." : "Blueprint থেকে Draft বানান"}</button>
            {!createForm.adAccountId ? <p className="text-xs text-amber-600">আগে উপরে Meta Ad Account বেছে নিন।</p> : null}
          </div>
        ) : null}

        {templates.length > 0 ? (
          <div className="card space-y-2 p-5">
            <div className="font-semibold">⭐ আমার টেমপ্লেট</div>
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span>{t.name} <span className="text-xs text-slate-400">· {t.objective}</span></span>
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const res = await wrap(`tpl-${t.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${t.id}/duplicate`, { method: "POST", body: JSON.stringify({}) }));
                  if (res) { setPlan(res); setNotice("টেমপ্লেট থেকে নতুন Draft তৈরি হয়েছে।"); }
                }}>ব্যবহার করুন</button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{plan.name}</h1>
          <p className="text-sm text-slate-500">{plan.objective} · অবস্থা: <span className="font-semibold">{STATUS_LABEL[plan.status] ?? plan.status}</span>
            {plan.status === "published" ? <> · Meta অবস্থা: <span className="font-semibold">{plan.metaStatus}</span> · Campaign ID: {plan.externalCampaignId}</> : null}
          </p>
          {plan.rejectionReason ? <p className="text-sm text-red-600">প্রত্যাখ্যানের কারণ: {plan.rejectionReason}</p> : null}
          {plan.status === "published" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {plan.metaEffectiveStatus ? <span className={plan.metaEffectiveStatus === "ACTIVE" ? "badge badge-success" : plan.metaEffectiveStatus === "PAUSED" ? "badge badge-muted" : "badge badge-danger"}>Meta কার্যকর অবস্থা: {plan.metaEffectiveStatus}</span> : null}
              <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                const res = await wrap("statussync", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/status-sync`, { method: "POST" }));
                if (res) { setPlan(res); setNotice(res.healthIssues?.length ? `Meta অবস্থা আনা হয়েছে — ${res.healthIssues.length}টি সমস্যা পাওয়া গেছে।` : "Meta অবস্থা আনা হয়েছে — কোনো সমস্যা নেই।"); }
              }}>🔄 Meta অবস্থা যাচাই{plan.lastStatusSyncAt ? ` (সর্বশেষ ${new Date(plan.lastStatusSyncAt).toLocaleString("bn-BD")})` : ""}</button>
            </div>
          ) : null}
          {preflight && preflight.findings.length > 0 ? (
            <div className="mt-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-semibold">🛡 Policy Pre-flight ফলাফল ({preflight.checkedAds}টি বিজ্ঞাপন যাচাই হয়েছে)</p>
              {preflight.findings.map((f, i) => (
                <div key={i} className="rounded-lg bg-white p-2">
                  <span className={f.severity === "high" ? "badge badge-danger" : f.severity === "medium" ? "badge badge-muted" : "badge badge-success"}>{f.severity}</span>{" "}
                  <b>{f.adName}</b> ({f.field}): “{f.snippet}”<br />
                  <span className="text-slate-600">{f.explanation}</span><br />
                  <span className="text-green-700">পরামর্শ: {f.suggestion}</span>
                </div>
              ))}
              <p className="text-xs text-slate-500">Pre-flight পাস করা মানে Meta অনুমোদনের নিশ্চয়তা নয় — এটি প্রতিরোধযোগ্য Reject এর কারণ সরায়।</p>
            </div>
          ) : null}
          {plan.healthIssues && plan.healthIssues.length > 0 ? (
            <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-semibold">⚠️ Meta তে সমস্যা:</p>
              <ul className="mt-1 list-inside list-disc">{plan.healthIssues.map((h, i) => <li key={i}>{h.level}: {h.name} — {h.status}</li>)}</ul>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("dup", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/duplicate`, { method: "POST", body: JSON.stringify({}) }));
            if (res) { setPlan(res); setNotice("Plan এর কপি তৈরি হয়েছে (নতুন Draft, কোনো Meta ID নেই)।"); }
          }}>📋 কপি করুন</button>
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("pf", () => apiFetch<{ checkedAds: number; findings: { adName: string; field: string; severity: string; snippet: string; explanation: string; suggestion: string }[]; summary: { high: number; medium: number; low: number } }>(`/organizations/${orgId}/campaign-plans/${plan.id}/preflight`, { method: "POST" }));
            if (res) {
              setPreflight(res);
              setNotice(res.findings.length === 0 ? `Policy যাচাই শেষ — ${res.checkedAds}টি বিজ্ঞাপনে কোনো সমস্যা পাওয়া যায়নি।` : `Policy যাচাই: উচ্চ ${res.summary.high}, মাঝারি ${res.summary.medium}, নিম্ন ${res.summary.low} — নিচে বিস্তারিত।`);
            }
          }}>🛡 Policy যাচাই</button>
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("ab", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/ab-variant`, { method: "POST", body: JSON.stringify({}) }));
            if (res) { setPlan(res); setNotice("A/B Variant তৈরি হয়েছে (নতুন Draft)। দুটি Plan Publish করে সমান বাজেটে চালান — ফলাফল Analytics পেজে।"); }
          }}>🧪 A/B Variant তৈরি</button>
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("tpl", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/duplicate`, { method: "POST", body: JSON.stringify({ asTemplate: true }) }));
            if (res) setNotice(`"${res.name}" টেমপ্লেট হিসেবে সেভ হয়েছে।`);
          }}>⭐ টেমপ্লেট হিসেবে সেভ</button>
          {!plan.externalCampaignId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("adv", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/advantage-plus`, { method: "POST", body: JSON.stringify({ enabled: !plan.advantagePlus }) }));
            if (res) { setPlan(res); setNotice(res.advantagePlus ? "Advantage+ চালু হয়েছে — Publish এর সময় বাজেট Campaign পর্যায়ে যাবে এবং Meta নিজে Audience প্রসারিত করবে।" : "Advantage+ বন্ধ করা হয়েছে — বাজেট Ad Set পর্যায়ে থাকবে।"); }
          }}>{plan.advantagePlus ? "🤖 Advantage+ চালু আছে (বন্ধ করুন)" : "🤖 Advantage+ চালু করুন"}</button> : null}
          {editable ? <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => action("submit", "submit")}>অনুমোদনের জন্য পাঠান</button> : null}
          {plan.status === "pending_approval" ? <>
            <button className="btn-success btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => action("approve", "approve")}>Approve করুন (Owner/Admin)</button>
            <button className="rounded-lg border px-3 py-2 text-sm font-semibold text-red-600" onClick={rejectPlan}>Reject</button>
          </> : null}
          {(plan.status === "approved" || plan.status === "publish_failed") ? <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => action("publish", "publish")}>{busy === "publish" ? "Publish হচ্ছে..." : plan.status === "publish_failed" ? "আবার Publish চেষ্টা (Resume)" : "Meta তে Publish করুন (PAUSED)"}</button> : null}
          {plan.status === "published" && plan.metaStatus !== "ACTIVE" ? <button className="btn-success btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => action("activate", "activate")}>সক্রিয় করুন (খরচ শুরু হবে)</button> : null}
          {plan.status === "published" && plan.metaStatus === "ACTIVE" ? <button className="btn-warning btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => action("pause", "pause")}>Pause করুন</button> : null}
        </div>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {plan.adSets.map((adSet) => (
        <div key={adSet.id} className="space-y-3 card p-5">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Ad Set: {adSet.name}</div>
            {plan.status === "published" && adSet.externalAdSetId ? (
              <span className="flex items-center gap-1">
                <input className="input w-28" placeholder="নতুন দৈনিক বাজেট" id={`budget-${adSet.id}`} />
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const v = (document.getElementById(`budget-${adSet.id}`) as HTMLInputElement)?.value;
                  if (!v) { setError("নতুন বাজেট লিখুন"); return; }
                  const res = await wrap(`budget-${adSet.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/budget`, { method: "POST", body: JSON.stringify({ dailyBudget: v }) }));
                  if (res) { setPlan(res); setNotice("Meta তে বাজেট আপডেট হয়েছে (Meta নিশ্চিত করেছে)।"); }
                }}>💰 বাজেট আপডেট</button>
              </span>
            ) : null}
            <div className="text-xs text-slate-400">
              {adSet.dailyBudgetMinor ? `দৈনিক বাজেট ${formatMinor(BigInt(adSet.dailyBudgetMinor))}` : ""} · {adSet.optimizationGoal} · দেশ: {(adSet.targeting.countries ?? []).join(", ")}
              {adSet.externalAdSetId ? ` · Meta ID: ${adSet.externalAdSetId}` : ""}
              {adSet.effectiveStatus ? ` · কার্যকর: ${adSet.effectiveStatus}` : ""}
              {adSet.startTime || adSet.endTime ? ` · 🗓 ${adSet.startTime ? new Date(adSet.startTime).toLocaleString("bn-BD") : "…"} → ${adSet.endTime ? new Date(adSet.endTime).toLocaleString("bn-BD") : "…"}` : ""}
            </div>
            {plan.status === "published" && adSet.externalAdSetId ? (
              <span className="flex items-center gap-1">
                <input type="datetime-local" className="input w-48" id={`sched-start-${adSet.id}`} defaultValue={adSet.startTime ? String(adSet.startTime).slice(0, 16) : ""} />
                <input type="datetime-local" className="input w-48" id={`sched-end-${adSet.id}`} defaultValue={adSet.endTime ? String(adSet.endTime).slice(0, 16) : ""} />
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const st = (document.getElementById(`sched-start-${adSet.id}`) as HTMLInputElement)?.value;
                  const en = (document.getElementById(`sched-end-${adSet.id}`) as HTMLInputElement)?.value;
                  if (!st && !en) { setError("শুরু বা শেষের সময় দিন"); return; }
                  const res = await wrap(`sched-${adSet.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/schedule`, { method: "POST", body: JSON.stringify({ startTime: st ? new Date(st).toISOString() : undefined, endTime: en ? new Date(en).toISOString() : undefined }) }));
                  if (res) { setPlan(res); setNotice("সময়সূচি Meta তে আপডেট হয়েছে।"); }
                }}>🗓 সময়সূচি</button>
              </span>
            ) : null}
            {plan.status === "published" && adSet.externalAdSetId ? (
              <span className="flex items-center gap-1">
                <textarea className="input w-64" rows={1} id={`daypart-${adSet.id}`} placeholder="Dayparting: দিন,শুরু,শেষ — যেমন 5,9,23 (শুক্র ৯টা-২৩টা)" defaultValue={Array.isArray((adSet as any).daypart) ? (adSet as any).daypart.map((w: any) => `${w.day},${w.startHour},${w.endHour}`).join("\n") : ""} />
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const raw = (document.getElementById(`daypart-${adSet.id}`) as HTMLTextAreaElement)?.value ?? "";
                  const windows = raw.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [day, startHour, endHour] = l.split(",").map((x) => Number(x.trim())); return { day, startHour, endHour }; });
                  const res = await wrap(`dp-${adSet.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/daypart`, { method: "POST", body: JSON.stringify({ windows, tz: "Asia/Dhaka" }) }));
                  if (res) { setPlan(res); setNotice("Dayparting সেভ হয়েছে। Dayparting Job (Automations পেজে তৈরি করুন) সময়মতো Ad Set চালু/বন্ধ করবে।"); }
                }}>🌗 Dayparting</button>
              </span>
            ) : null}
          </div>
          <div className="space-y-2">
            {adSet.ads.map((ad) => (
              <div key={ad.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="font-medium">{ad.name} {(ad as any).format && (ad as any).format !== "link" ? <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">{(ad as any).format}</span> : null} {ad.createdByAi ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">AI Draft</span> : null} {ad.externalAdId ? <span className="text-xs text-slate-400">Meta ID: {ad.externalAdId}</span> : null} {ad.effectiveStatus ? <span className={ad.effectiveStatus === "ACTIVE" ? "rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-semibold text-green-700" : ad.effectiveStatus === "PAUSED" ? "rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600" : "rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700"}>{ad.effectiveStatus}</span> : null}</div>
                <p className="mt-0.5 whitespace-pre-wrap">{ad.primaryText}</p>
                {ad.headline ? <div className="text-slate-500">Headline: {ad.headline}</div> : null}
                <a className="text-xs text-blue-600" href={ad.linkUrl} target="_blank" rel="noreferrer">{ad.linkUrl}</a>
              </div>
            ))}
            {adSet.ads.length === 0 ? <p className="text-sm text-slate-400">কোনো Ad নেই</p> : null}
          </div>
          {editable ? (
            <div className="grid gap-3 border-t pt-3 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="text-sm font-semibold">হাতে Ad যোগ করুন</div>
                <input className="input" placeholder="Ad এর নাম" value={adForms[adSet.id]?.name ?? ""} onChange={(e) => setAdForms((s) => ({ ...s, [adSet.id]: { ...(s[adSet.id] ?? emptyAdForm), name: e.target.value } }))} />
                <textarea className="input" rows={3} placeholder="Primary Text" value={adForms[adSet.id]?.primaryText ?? ""} onChange={(e) => setAdForms((s) => ({ ...s, [adSet.id]: { ...(s[adSet.id] ?? emptyAdForm), primaryText: e.target.value } }))} />
                <input className="input" placeholder="Headline (ঐচ্ছিক)" value={adForms[adSet.id]?.headline ?? ""} onChange={(e) => setAdForms((s) => ({ ...s, [adSet.id]: { ...(s[adSet.id] ?? emptyAdForm), headline: e.target.value } }))} />
                <input className="input" placeholder="Link URL (https://...)" value={adForms[adSet.id]?.linkUrl ?? ""} onChange={(e) => setAdField(adSet.id, "linkUrl", e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <select className="input w-36" value={adForms[adSet.id]?.format ?? "link"} onChange={(e) => setAdField(adSet.id, "format", e.target.value)}>
                    <option value="link">🖼️ Link Ad</option>
                    <option value="video">🎬 Video Ad</option>
                    <option value="carousel">🎠 Carousel</option>
                  </select>
                  {(adForms[adSet.id]?.format ?? "link") === "link" ? (
                    <select className="input flex-1" value={adForms[adSet.id]?.imageAssetId ?? ""} onChange={(e) => setAdField(adSet.id, "imageAssetId", e.target.value)}>
                      <option value="">লাইব্রেরির ছবি (ঐচ্ছিক)</option>
                      {assets.filter((x) => x.kind === "image" && x.status === "ready" && x.adAccountId === plan.adAccountId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  ) : null}
                  {(adForms[adSet.id]?.format ?? "link") === "video" ? (
                    <select className="input flex-1" value={adForms[adSet.id]?.videoAssetId ?? ""} onChange={(e) => setAdField(adSet.id, "videoAssetId", e.target.value)}>
                      <option value="">লাইব্রেরির ভিডিও বেছে নিন</option>
                      {assets.filter((x) => x.kind === "video" && x.status === "ready" && x.adAccountId === plan.adAccountId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  ) : null}
                </div>
                {(adForms[adSet.id]?.format ?? "link") === "carousel" ? (
                  <textarea className="input font-mono text-xs" rows={4} placeholder="প্রতি লাইনে একটি কার্ড: শিরোনাম | লিংক | ছবির URL (ঐচ্ছিক)" value={adForms[adSet.id]?.carouselText ?? ""} onChange={(e) => setAdField(adSet.id, "carouselText", e.target.value)} />
                ) : null}
                {(adForms[adSet.id]?.format ?? "link") === "link" ? (
                  <input className="input" placeholder="অথবা ছবির URL সরাসরি" value={adForms[adSet.id]?.imageUrl ?? ""} onChange={(e) => setAdField(adSet.id, "imageUrl", e.target.value)} />
                ) : null}
                <button className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => addAd(adSet.id)}>Ad যোগ করুন</button>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold">AI Copy (প্রোডাক্ট থেকে)</div>
                <select className="input" value={copySelection[adSet.id] ?? ""} onChange={(e) => setCopySelection((s) => ({ ...s, [adSet.id]: e.target.value }))}>
                  <option value="">প্রোডাক্ট বেছে নিন</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} - {formatMinor(BigInt(p.priceMinor), p.currency)}</option>)}
                </select>
                <button className="btn-warning btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => generateCopy(adSet.id)}>{busy === `copy-${adSet.id}` ? "তৈরি হচ্ছে..." : "AI Copy তৈরি করুন"}</button>
                <p className="text-xs text-slate-400">AI Copy প্রোডাক্টের আসল দাম ব্যবহার করে, কোনো ছাড় বা প্রতিশ্রুতি বানায় না। তৈরি হওয়া লেখা Draft, Publish এর আগে যাচাই করুন।</p>
              </div>
            </div>
          ) : null}
        </div>
      ))}

      {editable ? (
        <form onSubmit={addAdSet} className="space-y-3 card p-5">
          <div className="font-semibold">নতুন Ad Set</div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <label className="block text-sm">নাম<input className={inputCls} value={adSetForm.name} onChange={(e) => setAdSetForm({ ...adSetForm, name: e.target.value })} required /></label>
            <label className="block text-sm">দৈনিক বাজেট<input className={inputCls} value={adSetForm.dailyBudget} onChange={(e) => setAdSetForm({ ...adSetForm, dailyBudget: e.target.value })} placeholder="500.00" required /></label>
            <label className="block text-sm">শুরুর সময় (ঐচ্ছিক)<input type="datetime-local" className={inputCls} value={adSetStart} onChange={(e) => setAdSetStart(e.target.value)} /></label>
            <label className="block text-sm">শেষের সময় (ঐচ্ছিক)<input type="datetime-local" className={inputCls} value={adSetEnd} onChange={(e) => setAdSetEnd(e.target.value)} /></label>
            <label className="block text-sm">Optimization Goal
              <select className={inputCls} value={adSetForm.optimizationGoal} onChange={(e) => setAdSetForm({ ...adSetForm, optimizationGoal: e.target.value })}>
                <option value="LINK_CLICKS">Link Clicks</option><option value="OFFSITE_CONVERSIONS">Conversions (Pixel লাগবে)</option>
                <option value="LEAD_GENERATION">Lead Generation</option><option value="REACH">Reach</option><option value="LANDING_PAGE_VIEWS">Landing Page Views</option>
              </select>
            </label>
            <label className="block text-sm">Facebook Page ID<input className={inputCls} value={adSetForm.pageId} onChange={(e) => setAdSetForm({ ...adSetForm, pageId: e.target.value })} required /></label>
            <label className="block text-sm">Pixel ID (Conversions হলে)<input className={inputCls} value={adSetForm.pixelId} onChange={(e) => setAdSetForm({ ...adSetForm, pixelId: e.target.value })} /></label>
            <label className="block text-sm">দেশ (কমা দিয়ে)<input className={inputCls} value={adSetForm.countries} onChange={(e) => setAdSetForm({ ...adSetForm, countries: e.target.value })} placeholder="BD" /></label>
            <label className="block text-sm">Interests (কমা দিয়ে)<input className={inputCls} value={adSetForm.interests} onChange={(e) => setAdSetForm({ ...adSetForm, interests: e.target.value })} placeholder="Online shopping, Fashion" /></label>
            <label className="block text-sm">Custom Audience IDs (Meta ID, কমা দিয়ে)<input className={inputCls} value={adSetForm.audienceIds} onChange={(e) => setAdSetForm({ ...adSetForm, audienceIds: e.target.value })} placeholder={audList.filter((a) => a.externalAudienceId).map((a) => a.externalAudienceId).join(", ") || "যেমন: 23850..."} /></label>
            <label className="block text-sm">বাদ দিতে Audience IDs<input className={inputCls} value={adSetForm.excludeIds} onChange={(e) => setAdSetForm({ ...adSetForm, excludeIds: e.target.value })} /></label>
            <label className="block text-sm">Saved প্রিসেট প্রয়োগ
              <select className={inputCls} value="" onChange={(e) => {
                const p = savedList.find((x) => x.id === e.target.value);
                if (!p) return;
                const t = p.targeting as any;
                setAdSetForm((f) => ({ ...f,
                  countries: Array.isArray(t.countries) ? t.countries.join(",") : f.countries,
                  interests: Array.isArray(t.interests) ? t.interests.join(", ") : f.interests,
                  audienceIds: Array.isArray(t.customAudienceIds) ? t.customAudienceIds.join(",") : f.audienceIds,
                }));
              }}>
                <option value="">— প্রিসেট বেছে নিন —</option>
                {savedList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>Ad Set যোগ করুন</button>
        </form>
      ) : null}

      {plan.publishLogs.length > 0 ? (
        <div className="card p-5">
          <div className="font-semibold">Publish Log (প্রতিটি Meta কলের রেকর্ড)</div>
          <div className="mt-2 space-y-1">
            {plan.publishLogs.map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                <span><span className="font-medium capitalize">{l.step}</span> · {new Date(l.createdAt).toLocaleString()}</span>
                <span className={l.status === "success" ? "text-green-600" : "text-red-600"}>{l.status}{l.externalId ? ` · ${l.externalId}` : ""}{l.error ? ` · ${l.error}` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
