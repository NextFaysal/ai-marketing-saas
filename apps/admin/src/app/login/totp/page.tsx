"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { API_URL, setAdminToken } from "@/lib/api";
import { AdminLocaleSwitcher, useAdminLocale } from "@/components/AdminLocale";

export default function TotpPage() {
  const { dict } = useAdminLocale();
  const router = useRouter();
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pending = JSON.parse(localStorage.getItem("admin_totp_pending") ?? "{}");
    if (!pending.challengeToken) { setError(dict.auth.totpNoSession); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/auth/totp/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeToken: pending.challengeToken, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.accessToken) throw new Error(body.message ?? dict.auth.totpFailed);
      localStorage.removeItem("admin_totp_pending");
      setAdminToken(body.accessToken);
      localStorage.setItem("admin_user", JSON.stringify(body.user));
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.auth.totpFailedShort);
    } finally { setBusy(false); }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4 sm:p-6">
      <div className="absolute right-5 top-5"><AdminLocaleSwitcher /></div>
      <form onSubmit={submit} className="acard w-full max-w-sm space-y-4">
        {/* ADNX14: same visual system as Login (acard surface,
            abtn/ainput, gradient brand mark) and the PageHead
            typography pattern for the heading (no AdminShell here).
            The code field stays ONE input, exactly as the auth
            flow has always had it — only sized for mobile: taller
            tap target, numeric keyboard, one-time-code autofill. */}
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-xl">🔐</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">{dict.auth.totpTitle}</h1>
          <p className="text-sm text-slate-400">{dict.auth.totpSub}</p>
        </div>
        {error ? <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300" role="alert">{error}</p> : null}
        <input className="ainput !py-3.5 text-center text-2xl tracking-[0.4em]" placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus />
        <button className="abtn w-full justify-center" disabled={busy || code.length !== 6}>{busy ? dict.auth.verifying : dict.auth.enter}</button>
        <button type="button" className="w-full text-center text-xs text-slate-400 underline" onClick={() => router.replace("/login")}>{dict.auth.restartLogin}</button>
      </form>
    </div>
  );
}
