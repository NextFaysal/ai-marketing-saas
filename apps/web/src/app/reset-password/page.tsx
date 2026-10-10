"use client";
import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { API_URL } from "@/lib/api";

function ResetForm() {
  const sp = useSearchParams();
  const token = sp.get("token") ?? "";
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [done, setDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setMsg("পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।"); return; }
    if (password !== confirm) { setMsg("দুটি পাসওয়ার্ড মিলছে না।"); return; }
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.reset === false) throw new Error(body.message ?? "লিংকটি অবৈধ বা মেয়াদোত্তীর্ণ");
      setDone(true);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "ব্যর্থ হয়েছে");
    } finally { setBusy(false); }
  }

  if (!token) return <p className="text-sm text-red-500">লিংকে টোকেন পাওয়া যায়নি। সঠিক Reset লিংকটি ব্যবহার করুন।</p>;
  if (done) return (
    <div className="space-y-3 text-center">
      <div className="text-4xl">✅</div>
      <p className="font-medium">পাসওয়ার্ড বদলে গেছে। আগের সব সেশন বন্ধ হয়ে গেছে।</p>
      <a href="/login" className="btn-primary inline-block">নতুন পাসওয়ার্ড দিয়ে লগইন করুন</a>
    </div>
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-bold">নতুন পাসওয়ার্ড সেট করুন</h1>
      <p className="text-sm text-slate-500">এই লিংকটি প্ল্যাটফর্ম Admin পাঠিয়েছেন। এটি একবারই ব্যবহার করা যায়।</p>
      {msg ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{msg}</p> : null}
      <label className="block text-sm font-medium">নতুন পাসওয়ার্ড
        <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      </label>
      <label className="block text-sm font-medium">আবার লিখুন
        <input className="input mt-1" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </label>
      <button className="btn-primary w-full" disabled={busy}>{busy ? "সেভ হচ্ছে…" : "পাসওয়ার্ড বদলান"}</button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <Suspense fallback={<p className="text-sm text-slate-500">লোড হচ্ছে…</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
