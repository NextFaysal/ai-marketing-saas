"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { API_URL, setAdminToken } from "@/lib/api";

export default function TotpPage() {
  const router = useRouter();
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pending = JSON.parse(localStorage.getItem("admin_totp_pending") ?? "{}");
    if (!pending.challengeToken) { setError("লগইন সেশন পাওয়া যায়নি — আবার লগইন করুন।"); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/auth/totp/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeToken: pending.challengeToken, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.accessToken) throw new Error(body.message ?? "কোড যাচাই ব্যর্থ হয়েছে");
      localStorage.removeItem("admin_totp_pending");
      setAdminToken(body.accessToken);
      localStorage.setItem("admin_user", JSON.stringify(body.user));
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ব্যর্থ হয়েছে");
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <form onSubmit={submit} className="acard w-full max-w-sm space-y-4">
        <div className="text-center">
          <div className="text-3xl">🔐</div>
          <h1 className="mt-1 text-xl font-bold sm:text-2xl">Two-Factor যাচাই</h1>
          <p className="text-sm text-slate-400">Authenticator অ্যাপের ৬ সংখ্যার কোডটি দিন। কোড ৫ মিনিটের মধ্যে দিতে হবে।</p>
        </div>
        {error ? <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p> : null}
        <input className="ainput text-center text-2xl tracking-[0.4em]" placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoFocus />
        <button className="abtn w-full justify-center" disabled={busy || code.length !== 6}>{busy ? "যাচাই হচ্ছে…" : "প্রবেশ করুন"}</button>
        <button type="button" className="w-full text-center text-xs text-slate-500 underline" onClick={() => router.replace("/login")}>আবার লগইন থেকে শুরু করুন</button>
      </form>
    </div>
  );
}
