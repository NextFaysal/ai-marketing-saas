"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, API_URL } from "@/lib/api";
import { registerSchema } from "@repo/contracts";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [signupClosed, setSignupClosed] = useState(false);
  const [refCode, setRefCode] = useState("");
  React.useEffect(() => {
    fetch(`${API_URL}/public/system-status`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.signupOpen === false) setSignupClosed(true); }).catch(() => undefined);
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) setRefCode(ref);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const parsed = registerSchema.safeParse({ name, email, password });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? t.auth.checkInfo); return; }
    setLoading(true);
    try {
      const data = await apiFetch<{ accessToken: string }>("/auth/register", { method: "POST", body: JSON.stringify({ ...parsed.data, ...(refCode ? { referralCode: refCode } : {}) }) });
      localStorage.setItem("accessToken", data.accessToken);
      router.push("/onboarding");
    } catch (err) { setError(err instanceof Error ? err.message : t.auth.registrationFailed); }
    finally { setLoading(false); }
  }

  if (signupClosed) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
        <div className="text-4xl">🚪</div>
        <h1 className="mt-2 text-xl font-bold">{t.auth.signupClosedTitle}</h1>
        <p className="mt-1 text-sm text-slate-500">{t.auth.signupClosedTextPrefix}<a className="text-indigo-600 underline" href="/login">{t.auth.signupClosedLogin}</a>{t.auth.signupClosedTextSuffix}</p>
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="page-title">{t.auth.registerTitle}</h1>
      <p className="mt-1 text-sm text-slate-500">{t.auth.registerSubtitle}</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4 card p-6">
        <label className="block text-sm">{t.auth.nameLabel}
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block text-sm">{t.auth.emailLabel}
          <input className="input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-sm">{t.auth.passwordMinLabel}
          <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <p className="rounded-lg bg-indigo-50 px-3 py-2 text-[13px] leading-relaxed text-indigo-900">
          {t.auth.verifyNotePrefix}<b>{t.auth.verifyNoteBold}</b>{t.auth.verifyNoteSuffix}
        </p>
        <button className="w-full rounded-lg bg-blue-600 py-2 font-semibold text-white disabled:opacity-50" disabled={loading}>
          {loading ? t.auth.pleaseWait : t.auth.registerButton}
        </button>
        <p className="text-center text-sm text-slate-500">{t.auth.haveAccount}<a className="text-blue-600" href="/login">{t.auth.loginLink}</a></p>

      </form>
    </main>
  );
}
