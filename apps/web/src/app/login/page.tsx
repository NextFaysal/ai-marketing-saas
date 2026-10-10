"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { loginSchema } from "@repo/contracts";

const HIGHLIGHTS = [
  { title: "সব মার্কেটিং এক জায়গায়", text: "Ads, Orders, Profit আর AI Report, একটাই Operating System এ।" },
  { title: "অনুমোদন ছাড়া কিছুই লাইভ নয়", text: "প্রতিটি Campaign মানুষের অনুমোদন পেরিয়ে, PAUSED অবস্থায় Publish হয়।" },
  { title: "বানানো সংখ্যা নয়, প্রমাণিত সংখ্যা", text: "Platform এর রিপোর্ট আর আপনার আসল Order ডেটা আলাদা ও যাচাইযোগ্য।" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) { setError("সঠিক ইমেইল ও পাসওয়ার্ড দিন"); return; }
    setLoading(true);
    try {
      const data = await apiFetch<{ accessToken: string }>("/auth/login", { method: "POST", body: JSON.stringify(parsed.data) });
      localStorage.setItem("accessToken", data.accessToken);
      router.push("/dashboard");
    } catch (err) { setError(err instanceof Error ? err.message : "Login failed"); }
    finally { setLoading(false); }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-ink-950 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-fuchsia-600/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-lg font-black text-white shadow-glow">Q</span>
          <div>
            <div className="text-lg font-bold tracking-tight text-white">AI Marketing OS</div>
            <div className="text-xs text-slate-400">by Qosprey</div>
          </div>
        </div>
        <div className="relative space-y-8">
          <h2 className="max-w-md text-4xl font-bold leading-[1.15] tracking-tight text-white">আপনার পুরো মার্কেটিং, <span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">একটা OS এ।</span></h2>
          <div className="space-y-5">
            {HIGHLIGHTS.map((h) => (
              <div key={h.title} className="flex gap-3.5">
                <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-[11px] text-emerald-300 ring-1 ring-inset ring-emerald-300/30">✓</span>
                <div>
                  <div className="font-semibold text-white">{h.title}</div>
                  <div className="text-sm text-slate-400">{h.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-xs text-slate-500">© 2026 Qosprey · Bangladesh থেকে, বিশ্বের জন্য</div>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[420px] animate-rise">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-base font-black text-white">Q</span>
            <div className="text-lg font-bold tracking-tight">AI Marketing OS</div>
          </div>
          <h1 className="page-title">লগইন করুন</h1>
          <p className="page-sub mt-1">আপনার মার্কেটিং ড্যাশবোর্ডে স্বাগতম</p>
          <form onSubmit={onSubmit} className="card mt-6 space-y-4 p-6 sm:p-7">
            <label className="block text-sm font-medium text-slate-700">ইমেইল
              <input className="input mt-1.5" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" autoComplete="email" />
            </label>
            <label className="block text-sm font-medium text-slate-700">পাসওয়ার্ড
              <input className="input mt-1.5" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" autoComplete="current-password" />
            </label>
            {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">{error}</p> : null}
            <button className="btn-primary w-full py-2.5 text-[15px]" disabled={loading}>
              {loading ? "অপেক্ষা করুন..." : "লগইন করুন"}
            </button>
            <p className="text-center text-sm text-slate-500">অ্যাকাউন্ট নেই? <a className="font-semibold text-brand-600 hover:text-brand-700" href="/register">রেজিস্টার করুন</a></p>
          </form>
          <p className="mt-4 rounded-2xl bg-brand-50 px-4 py-3 text-center text-[13px] text-brand-700 ring-1 ring-inset ring-brand-100">
            Demo: <span className="font-semibold">owner@demo.local</span> / <span className="font-semibold">ChangeMe123!</span>
          </p>
        </div>
      </section>
    </main>
  );
}
