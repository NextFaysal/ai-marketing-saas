"use client";
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { createOrganizationSchema } from "@repo/contracts";
import { slugifyShopName, localSlugProblem, shopSubdomainHost, SHOP_ADDRESS_SUFFIX } from "@/lib/shop-slug";

const INDUSTRIES = ["Fashion & Apparel", "Electronics", "Beauty & Cosmetics", "Food & Grocery", "Home & Living", "Health", "Other"];

type SlugCheck =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "unknown"; message: string }
  | { state: "ok" | "taken" | "reserved" | "invalid"; message: string };

interface SlugAvailability { slug: string; available: boolean; reason: "ok" | "taken" | "reserved" | "invalid"; message: string }

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [orgId, setOrgId] = useState("");
  const [name, setName] = useState("");
  // TD2: the shop subdomain picker. The slug follows the business
  // name until the user edits it by hand.
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugCheck, setSlugCheck] = useState<SlugCheck>({ state: "idle" });
  const [copied, setCopied] = useState(false);
  const slugReqSeq = useRef(0);
  const [profile, setProfile] = useState({ industry: INDUSTRIES[0], websiteUrl: "", description: "", goals: "", brandVoice: "", monthlyBudget: "" });
  const [shipping, setShipping] = useState("");
  const [refund, setRefund] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // TD2: live availability check — local format/reserved verdict
  // instantly (same contracts rules), then the API verdict
  // (authoritative; it also knows "taken" and SUPER-added names).
  useEffect(() => {
    if (step !== 1) return;
    if (!slug) { setSlugCheck({ state: "idle" }); return; }
    const problem = localSlugProblem(slug);
    if (problem) {
      setSlugCheck({
        state: problem,
        message: problem === "reserved"
          ? "এই নামটি সংরক্ষিত — প্ল্যাটফর্মের নিজের বা বিভ্রান্তিকর নাম হওয়ায় এটি ব্যবহার করা যাবে না।"
          : "নামের আকার ঠিক নেই — ছোট হাতের ইংরেজি অক্ষর, সংখ্যা ও একক হাইফেন, ৩–৬০ অক্ষর।",
      });
      return;
    }
    setSlugCheck({ state: "checking" });
    const seq = ++slugReqSeq.current;
    const t = setTimeout(async () => {
      try {
        const out = await apiFetch<SlugAvailability>(`/organizations/slug-available?slug=${encodeURIComponent(slug)}`);
        if (slugReqSeq.current !== seq) return; // a newer keystroke won
        setSlugCheck({ state: out.reason, message: out.message });
      } catch {
        if (slugReqSeq.current !== seq) return;
        setSlugCheck({ state: "unknown", message: "এই মুহূর্তে নামটি যাচাই করা যাচ্ছে না — আবার চেষ্টা করুন।" });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [slug, step]);

  const slugReady = slugCheck.state === "ok";

  async function submitStep1(e: React.FormEvent) {
    e.preventDefault(); setError("");
    const parsed = createOrganizationSchema.safeParse({ name, slug });
    if (!parsed.success) {
      setError(name.trim().length < 2 ? "ব্যবসার নাম কমপক্ষে ২ অক্ষরের হতে হবে" : "দোকানের ঠিকানার নামটি ঠিক করুন");
      return;
    }
    if (!slugReady) { setError("দোকানের ঠিকানাটি খালি ও বৈধ না হলে এগোনো যাবে না"); return; }
    setLoading(true);
    try {
      const org = await apiFetch<{ id: string }>("/organizations", { method: "POST", body: JSON.stringify(parsed.data) });
      localStorage.setItem("organizationId", org.id);
      setOrgId(org.id); setStep(2);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setLoading(false); }
  }

  async function submitStep2(e: React.FormEvent) {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      await apiFetch(`/organizations/${orgId}/business-profile`, {
        method: "PATCH",
        body: JSON.stringify({
          industry: profile.industry, websiteUrl: profile.websiteUrl || "",
          description: profile.description, goals: profile.goals, brandVoice: profile.brandVoice,
        }),
      });
      if (shipping.trim()) {
        await apiFetch(`/organizations/${orgId}/policies`, { method: "POST", body: JSON.stringify({ type: "shipping", title: "Shipping & Delivery Policy", content: shipping }) });
      }
      if (refund.trim()) {
        await apiFetch(`/organizations/${orgId}/policies`, { method: "POST", body: JSON.stringify({ type: "refund", title: "Refund & Return Policy", content: refund }) });
      }
      router.push("/dashboard");
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setLoading(false); }
  }

  const inputCls = "input mt-1";

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-10">
      <div className="text-sm text-slate-400">ধাপ {step} / ২</div>
      {step === 1 ? (
        <>
          <h1 className="mt-1 text-2xl font-bold">আপনার ব্যবসা সেটআপ করুন</h1>
          <p className="mt-1 text-sm text-slate-500">Organization তৈরি করুন, পরের ধাপে ব্যবসার বিস্তারিত তথ্য দিন।</p>
          <form onSubmit={submitStep1} className="mt-6 space-y-4 card p-6">
            <label className="block text-sm">ব্যবসার নাম
              <input className={inputCls} value={name} onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugifyShopName(e.target.value));
              }} required placeholder="যেমন: Dhaka Fashion House" />
            </label>
            <div className="block text-sm">আপনার দোকানের ঠিকানা
              <div className="mt-1 flex items-stretch overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-blue-500">
                <input className="min-w-0 flex-1 px-3 py-2 outline-none" value={slug} onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase());
                }} placeholder="dhaka-fashion-house" aria-label="দোকানের ঠিকানার নাম" />
                <span className="flex items-center bg-slate-50 px-3 text-slate-500">{SHOP_ADDRESS_SUFFIX}</span>
              </div>
              {slugCheck.state === "checking" ? <p className="mt-1 text-xs text-slate-500">নামটি খালি আছে কিনা যাচাই হচ্ছে…</p> : null}
              {slugCheck.state === "ok" ? <p className="mt-1 text-xs text-emerald-600">✓ {slugCheck.message}</p> : null}
              {slugCheck.state === "taken" || slugCheck.state === "reserved" || slugCheck.state === "invalid" || slugCheck.state === "unknown" ? (
                <p className="mt-1 text-xs text-red-600">{slugCheck.message}</p>
              ) : null}
              <p className="mt-1 text-xs text-slate-400">ক্রেতারা এই ঠিকানায় আপনার দোকান পাবেন। এই ঠিকানা পরে বদলানো যাবে না, তাই যত্নে বেছে নিন।</p>
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button className="w-full rounded-lg bg-blue-600 py-2 font-semibold text-white disabled:opacity-50" disabled={loading || !slugReady}>{loading ? "অপেক্ষা করুন..." : "পরের ধাপ"}</button>
          </form>
        </>
      ) : (
        <>
          <div className="mb-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
            <div className="flex flex-wrap items-center gap-2">
              <span>আপনার দোকানের ঠিকানা: <b>{shopSubdomainHost(slug)}</b></span>
              <button type="button" className="rounded-md bg-white px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200" onClick={async () => {
                try { await navigator.clipboard.writeText(shopSubdomainHost(slug)); setCopied(true); } catch { setCopied(false); }
              }}>{copied ? "✓ কপি হয়েছে" : "কপি করুন"}</button>
              <a className="text-xs font-medium text-emerald-700 underline" href={`/shop/${slug}`} target="_blank" rel="noreferrer">বর্তমান দোকানের পেজ দেখুন</a>
            </div>
            <p className="mt-1 text-xs">এই ঠিকানা পরে বদলানো যাবে না।</p>
          </div>
          <h1 className="mt-1 text-2xl font-bold">ব্যবসার তথ্য দিন</h1>
          <p className="mt-1 text-sm text-slate-500">এই তথ্য AI ব্যবহার করবে। ভুল তথ্য দিলে AI ভুল সাজেশন দেবে, তাই যা জানেন তাই দিন, বাকিটা পরে পূরণ করা যাবে।</p>
          <form onSubmit={submitStep2} className="mt-6 space-y-4 card p-6">
            <label className="block text-sm">ইন্ডাস্ট্রি
              <select className={inputCls} value={profile.industry} onChange={(e) => setProfile({ ...profile, industry: e.target.value })}>
                {INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
              </select>
            </label>
            <label className="block text-sm">ওয়েবসাইট (যদি থাকে)
              <input className={inputCls} value={profile.websiteUrl} onChange={(e) => setProfile({ ...profile, websiteUrl: e.target.value })} placeholder="https://..." />
            </label>
            <label className="block text-sm">ব্যবসার বিবরণ
              <textarea className={inputCls} rows={3} value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} placeholder="কী বিক্রি করেন, কাদের কাছে?" />
            </label>
            <label className="block text-sm">মার্কেটিং লক্ষ্য
              <textarea className={inputCls} rows={2} value={profile.goals} onChange={(e) => setProfile({ ...profile, goals: e.target.value })} placeholder="যেমন: মাসে ৫০০ অর্ডার, নতুন কাস্টমার বাড়ানো" />
            </label>
            <label className="block text-sm">ব্র্যান্ড ভয়েস
              <input className={inputCls} value={profile.brandVoice} onChange={(e) => setProfile({ ...profile, brandVoice: e.target.value })} placeholder="যেমন: বন্ধুসুলভ, সহজ বাংলা, সম্মানজনক" />
            </label>
            <label className="block text-sm">শিপিং ও ডেলিভারি পলিসি
              <textarea className={inputCls} rows={2} value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="যেমন: ঢাকার ভিতরে ৬০ টাকা, ২৪-৪৮ ঘণ্টা; বাইরে ১২০ টাকা, ২-৩ দিন" />
            </label>
            <label className="block text-sm">রিফান্ড ও রিটার্ন পলিসি
              <textarea className={inputCls} rows={2} value={refund} onChange={(e) => setRefund(e.target.value)} placeholder="যেমন: ত্রুটিপূর্ণ পণ্য ৭ দিনের মধ্যে বদলি" />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button className="w-full rounded-lg bg-blue-600 py-2 font-semibold text-white disabled:opacity-50" disabled={loading}>{loading ? "সেভ হচ্ছে..." : "শেষ করে ড্যাশবোর্ডে যান"}</button>
            <button type="button" className="w-full text-sm text-slate-500" onClick={() => router.push("/dashboard")}>এখন এড়িয়ে যান</button>
          </form>
        </>
      )}
    </main>
  );
}
