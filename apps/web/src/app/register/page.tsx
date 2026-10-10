"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, API_URL } from "@/lib/api";
import { registerSchema } from "@repo/contracts";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [signupClosed, setSignupClosed] = useState(false);
  React.useEffect(() => {
    fetch(`${API_URL}/public/system-status`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.signupOpen === false) setSignupClosed(true); }).catch(() => undefined);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const parsed = registerSchema.safeParse({ name, email, password });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "তথ্য যাচাই করুন"); return; }
    setLoading(true);
    try {
      const data = await apiFetch<{ accessToken: string }>("/auth/register", { method: "POST", body: JSON.stringify(parsed.data) });
      localStorage.setItem("accessToken", data.accessToken);
      router.push("/onboarding");
    } catch (err) { setError(err instanceof Error ? err.message : "Registration failed"); }
    finally { setLoading(false); }
  }

  if (signupClosed) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
        <div className="text-4xl">🚪</div>
        <h1 className="mt-2 text-xl font-bold">নতুন সাইনআপ আপাতত বন্ধ আছে</h1>
        <p className="mt-1 text-sm text-slate-500">প্ল্যাটফর্ম টিম সাময়িকভাবে নতুন রেজিস্ট্রেশন বন্ধ রেখেছে। কিছুদিন পরে আবার চেষ্টা করুন। ইতিমধ্যে অ্যাকাউন্ট থাকলে <a className="text-indigo-600 underline" href="/login">লগইন করুন</a>।</p>
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="page-title">অ্যাকাউন্ট তৈরি করুন</h1>
      <p className="mt-1 text-sm text-slate-500">এরপর আপনার ব্যবসার Organization তৈরি করা হবে</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4 card p-6">
        <label className="block text-sm">নাম
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block text-sm">ইমেইল
          <input className="input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-sm">পাসওয়ার্ড (কমপক্ষে ৮ অক্ষর)
          <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button className="w-full rounded-lg bg-blue-600 py-2 font-semibold text-white disabled:opacity-50" disabled={loading}>
          {loading ? "অপেক্ষা করুন..." : "রেজিস্টার"}
        </button>
        <p className="text-center text-sm text-slate-500">আগেই অ্যাকাউন্ট আছে? <a className="text-blue-600" href="/login">লগইন করুন</a></p>
      </form>
    </main>
  );
}
