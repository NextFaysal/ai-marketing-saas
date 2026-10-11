"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

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
      setColor(o.primaryColor ?? "#4F46E5");
      setDomain(o.customDomain ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : "লোড করা যায়নি"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setMsg(""); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/branding`, {
        method: "PATCH",
        body: JSON.stringify({ brandName, primaryColor: color, customDomain: domain }),
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
                  ? <img src={`${API_URL}${org.logoUrl}`} alt="লোগো" className="h-14 w-14 rounded-2xl border bg-white object-contain p-1" />
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

          <div className="rounded-xl bg-slate-50 p-4">
            <label className="block text-sm font-medium text-slate-700">কাস্টম ডোমেইন (যেমন reports.youragency.com)
              <input className="input mt-1" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="reports.youragency.com" maxLength={253} />
            </label>
            <div className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-slate-600">
              <p><b>কীভাবে চালু করবেন:</b></p>
              <p>১. আপনার ডোমেইনের DNS-এ একটি <b>CNAME</b> রেকর্ড যোগ করুন: হোস্ট <code className="rounded bg-white px-1 ring-1 ring-slate-200">{domain || "reports.youragency.com"}</code> → টার্গেট এই অ্যাপের হোস্টিং ডোমেইন (যে ঠিকানায় অ্যাপটি এখন চলছে)।</p>
              <p>২. হোস্টিং প্যানেলে (Dokploy) এই অ্যাপের Domains অংশে ডোমেইনটি যোগ করুন — SSL সার্টিফিকেট সেখান থেকেই ইস্যু হবে।</p>
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">⚠️ <b>সৎ নোট:</b> এই সেটিং শুধু আপনার উদ্দেশ্য সংরক্ষণ করে। DNS ও হোস্টিং প্যানেলের ধাপ দুটো শেষ না হওয়া পর্যন্ত ডোমেইনটি সক্রিয় হবে না — ডোমেইন রাউটিং অ্যাপের ভেতর থেকে চালু করা যায় না।</p>
            </div>
          </div>

          <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "অপেক্ষা করুন…" : "ব্র্যান্ডিং সংরক্ষণ করুন"}</button>
          <p className="text-xs text-slate-400">ক্লায়েন্ট রিপোর্ট লিংক তৈরি ও বাতিল করা যায় Analytics পেজের “ক্লায়েন্ট রিপোর্ট লিংক” কার্ড থেকে — লিংক খুললে ক্লায়েন্ট আপনার ব্র্যান্ডিংয়েই রিপোর্ট দেখবে।</p>
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
  { id: "hub-branding", icon: "🎨", label: "ব্র্যান্ডিং" },
  { id: "hub-security", icon: "🔐", label: "নিরাপত্তা (2FA)" },
] as const;

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
          deliveryChargeInside: taka(p.deliveryChargeInsideMinor), deliveryChargeOutside: taka(p.deliveryChargeOutsideMinor),
          freeDeliveryAbove: taka(p.freeDeliveryAboveMinor), minOrder: taka(p.minOrderMinor),
          deliveryDaysInside: p.deliveryDaysInside != null ? String(p.deliveryDaysInside) : "",
          deliveryDaysOutside: p.deliveryDaysOutside != null ? String(p.deliveryDaysOutside) : "",
          bkashNumber: p.bkashNumber ?? "", nagadNumber: p.nagadNumber ?? "", paymentNote: p.paymentNote ?? "",
          advancePaymentPercent: p.advancePaymentPercent != null ? String(p.advancePaymentPercent) : "",
          returnWindowDays: p.returnWindowDays != null ? String(p.returnWindowDays) : "",
          aiInstructions: p.aiInstructions ?? "", aiReplyLanguage: p.aiReplyLanguage ?? "auto",
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
      deliveryChargeInsideMinor: minor(form.deliveryChargeInside ?? ""), deliveryChargeOutsideMinor: minor(form.deliveryChargeOutside ?? ""),
      freeDeliveryAboveMinor: minor(form.freeDeliveryAbove ?? ""), minOrderMinor: minor(form.minOrder ?? ""),
      deliveryDaysInside: intOrNull(form.deliveryDaysInside ?? ""), deliveryDaysOutside: intOrNull(form.deliveryDaysOutside ?? ""),
      codAvailable: cod, bkashNumber: form.bkashNumber, nagadNumber: form.nagadNumber, paymentNote: form.paymentNote,
      advancePaymentPercent: intOrNull(form.advancePaymentPercent ?? ""), returnWindowDays: intOrNull(form.returnWindowDays ?? ""),
      aiInstructions: form.aiInstructions ?? "", aiReplyLanguage: form.aiReplyLanguage ?? "auto",
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
        </div>
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
        </div>
        <label className={`${label} mt-4`}>পেমেন্ট সম্পর্কে নোট<textarea className={input} rows={2} value={form.paymentNote ?? ""} onChange={set("paymentNote")} placeholder="যেমন: অর্ডারের পর বিকাশে অগ্রিম পাঠিয়ে শেষ ৪ ডিজিট জানাবেন…" /></label>
      </section>

      <section id="hub-ai" className="card scroll-mt-24 p-5 sm:p-6">
        <SectionHead icon="🤖" title="AI এর আচরণ — মালিকের নির্দেশনা" hint="AI Assistant ও Inbox Autopilot দুজনেই মানে — শুধু সুর ও আচরণের জন্য। তথ্য কখনো বদলায় না: দাম, চার্জ, নম্বর সবসময় এই পেজের সেট করা তথ্য থেকেই আসে।" />
        <div className="grid gap-4">
          <label className={label}>AI এর জন্য নির্দেশনা
            <textarea className={input} rows={3} maxLength={2000} value={form.aiInstructions ?? ""} onChange={set("aiInstructions")} placeholder="যেমন: সবসময় সালাম দিয়ে শুরু করবেন। উত্তর ছোট রাখবেন। কোনো ছাড়ের প্রতিশ্রুতি দেবেন না। অভিযোগ এলে আগে দুঃখ প্রকাশ করে এজেন্টকে পাঠাবেন…" />
          </label>
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
          <a href="/dashboard/knowledge" className="btn-secondary min-h-[44px] w-full justify-center sm:w-auto">📚 নীতিমালা ও FAQ (Knowledge)</a>
          <span className="text-xs leading-snug text-slate-400 sm:ml-auto sm:max-w-56 sm:text-right">নীতিমালা ও FAQ Knowledge পেজে সম্পাদনা হয় — Completeness এ সেগুলোও ধরা হয়।</span>
        </div>
      </div>
    </div>
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

          <BrandingCard />
        </div>
      </div>
    </div>
  );
}
