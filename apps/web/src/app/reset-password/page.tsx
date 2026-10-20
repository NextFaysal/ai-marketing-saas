"use client";
import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

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
    if (password.length < 8) { setMsg(t.auth.resetTooShort); return; }
    if (password !== confirm) { setMsg(t.auth.resetMismatch); return; }
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.reset === false) throw new Error(body.message ?? t.auth.resetInvalidLink);
      setDone(true);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t.auth.failed);
    } finally { setBusy(false); }
  }

  if (!token) return <p className="text-sm text-red-500">{t.auth.resetNoToken}</p>;
  if (done) return (
    <div className="space-y-3 text-center">
      <div className="text-4xl">✅</div>
      <p className="font-medium">{t.auth.resetDoneText}</p>
      <a href="/login" className="btn-primary inline-block">{t.auth.resetDoneButton}</a>
    </div>
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-bold">{t.auth.resetTitle}</h1>
      <p className="text-sm text-slate-500">{t.auth.resetIntro}</p>
      {msg ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{msg}</p> : null}
      <label className="block text-sm font-medium">{t.auth.newPasswordLabel}
        <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      </label>
      <label className="block text-sm font-medium">{t.auth.confirmPasswordLabel}
        <input className="input mt-1" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </label>
      <button className="btn-primary w-full" disabled={busy}>{busy ? t.auth.saving : t.auth.resetButton}</button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <Suspense fallback={<p className="text-sm text-slate-500">{t.auth.loading}</p>}>

          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
