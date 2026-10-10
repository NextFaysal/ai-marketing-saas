"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { createOrganizationSchema } from "@repo/contracts";

function slugify(v: string) { return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

const INDUSTRIES = ["Fashion & Apparel", "Electronics", "Beauty & Cosmetics", "Food & Grocery", "Home & Living", "Health", "Other"];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [orgId, setOrgId] = useState("");
  const [name, setName] = useState("");
  const [profile, setProfile] = useState({ industry: INDUSTRIES[0], websiteUrl: "", description: "", goals: "", brandVoice: "", monthlyBudget: "" });
  const [shipping, setShipping] = useState("");
  const [refund, setRefund] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submitStep1(e: React.FormEvent) {
    e.preventDefault(); setError("");
    const parsed = createOrganizationSchema.safeParse({ name, slug: slugify(name) });
    if (!parsed.success) { setError("ব্যবসার নাম কমপক্ষে ২ অক্ষরের হতে হবে"); return; }
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
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required placeholder="যেমন: Dhaka Fashion House" />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button className="w-full rounded-lg bg-blue-600 py-2 font-semibold text-white disabled:opacity-50" disabled={loading}>{loading ? "অপেক্ষা করুন..." : "পরের ধাপ"}</button>
          </form>
        </>
      ) : (
        <>
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
