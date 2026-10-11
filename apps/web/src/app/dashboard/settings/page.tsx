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
    <div className="card p-5">
      <h2 className="mb-1 font-semibold">🎨 ব্র্যান্ডিং — White-Label</h2>
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
    </div>
  );
}

export default function SettingsPage() {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
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
      const out = await apiFetch<{ secret: string; otpauthUrl: string }>("/auth/totp/enroll", { method: "POST" });
      setSecret(out.secret);
      setOtpauthUrl(out.otpauthUrl);
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
    <div className="space-y-4">
      <h1 className="page-title">Organization Settings</h1>
      {error ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div> : null}

      <div className="card p-5">
        <h2 className="mb-1 font-semibold">🔐 আমার অ্যাকাউন্টের নিরাপত্তা — দ্বি-স্তর যাচাই (2FA)</h2>
        <p className="mb-3 max-w-2xl text-sm text-slate-500">
          চালু করলে লগইনে পাসওয়ার্ডের পর ফোনের Authenticator অ্যাপের ৬ সংখ্যার কোড লাগবে।
          অবস্থা: {status === null ? "লোড হচ্ছে…" : status.totpEnabled
            ? <b className="text-emerald-600">চালু আছে</b>
            : <b className="text-slate-600">বন্ধ{status.enrolmentInProgress ? " (Enrol শুরু হয়েছে, নিশ্চিত করা বাকি)" : ""}</b>}
        </p>

        {status && !status.totpEnabled ? (
          <div className="space-y-3">
            {!secret ? (
              <button className="btn-primary" disabled={busy} onClick={enroll}>{busy ? "অপেক্ষা করুন…" : "2FA চালু করা শুরু করুন"}</button>
            ) : (
              <div className="space-y-3 rounded-xl bg-slate-50 p-4">
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
                  <button className="btn-primary" disabled={busy} onClick={confirm}>কোড নিশ্চিত করুন</button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {status?.totpEnabled ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm text-slate-600">বন্ধ করতে বর্তমান কোড দিন
              <input id="totp-disable-code" inputMode="numeric" className="input mt-1 w-44 tracking-[0.3em]" placeholder="123456" maxLength={6} />
            </label>
            <button className="btn-secondary" disabled={busy} onClick={disable}>2FA বন্ধ করুন</button>
          </div>
        ) : null}

        <p className="mt-4 text-xs text-slate-400">
          ফোন/Secret হারালে প্রতিষ্ঠানের OWNER Team পেজ থেকে আপনার 2FA রিসেট করে দিতে পারবেন — তারপর এখানে আবার চালু করুন।
        </p>
      </div>

      <BrandingCard />
    </div>
  );
}
