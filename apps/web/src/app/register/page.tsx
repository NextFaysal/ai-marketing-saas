"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, API_URL } from "@/lib/api";
import { registerSchema } from "@repo/contracts";
import { Sparkles, CheckCircle2, ShieldCheck, ArrowRight, Lock } from "lucide-react";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

const HIGHLIGHTS = [
  {
    title: t.auth.regHighlightTrialTitle,
    text: t.auth.regHighlightTrialText,
  },
  {
    title: t.auth.regHighlightChannelsTitle,
    text: t.auth.regHighlightChannelsText,
  },
  {
    title: t.auth.regHighlightIsolationTitle,
    text: t.auth.regHighlightIsolationText,
  },
];

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [signupClosed, setSignupClosed] = useState(false);
  const [refCode, setRefCode] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/public/system-status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && j.signupOpen === false) setSignupClosed(true);
      })
      .catch(() => undefined);
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) setRefCode(ref);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const parsed = registerSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t.auth.checkInfo);
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{ accessToken: string }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ ...parsed.data, ...(refCode ? { referralCode: refCode } : {}) }),
      });
      localStorage.setItem("accessToken", data.accessToken);
      router.push("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.registrationFailed);
    } finally {
      setLoading(false);
    }
  }

  if (signupClosed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-center text-slate-100">
        <div className="max-w-md space-y-4 rounded-3xl border border-slate-800 bg-slate-900/60 p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-2xl text-amber-400">
            🔒
          </div>
          <h1 className="text-2xl font-black text-white">{t.auth.signupClosedTitle}</h1>
          <p className="text-sm leading-relaxed text-slate-400">
            {t.auth.signupClosedTextPrefix}
            <Link className="text-indigo-400 underline font-semibold" href="/login">
              {t.auth.signupClosedLogin}
            </Link>
            {t.auth.signupClosedTextSuffix}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr] bg-slate-950 text-slate-100">
      {/* Brand Panel */}
      <section className="relative hidden overflow-hidden bg-slate-900 border-r border-slate-800/80 lg:flex lg:flex-col lg:justify-between lg:p-14">
        {/* Ambient glow effects */}
        <div className="pointer-events-none absolute -left-20 -top-20 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-20 h-96 w-96 rounded-full bg-fuchsia-600/15 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-lg font-black text-white shadow-lg shadow-indigo-500/25">
            Q
          </span>
          <div>
            <div className="text-lg font-bold tracking-tight text-white">AI Marketing OS</div>
            <div className="text-xs text-slate-400">by Qosprey</div>
          </div>
        </div>

        <div className="relative space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1 text-xs font-semibold text-indigo-300">
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
            <span>{t.auth.registerBadge}</span>
          </div>

          <h2 className="max-w-md text-4xl font-black leading-tight text-white">
            {t.auth.registerHeroPrefix}{" "}
            <span className="bg-gradient-to-r from-indigo-400 via-violet-300 to-fuchsia-400 bg-clip-text text-transparent">
              {t.auth.registerHeroAccent}
            </span>
          </h2>

          <div className="space-y-5">
            {HIGHLIGHTS.map((h) => (
              <div key={h.title} className="flex gap-3.5 items-start">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
                <div>
                  <div className="font-semibold text-white text-sm">{h.title}</div>
                  <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">{h.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-xs text-slate-500">
          © {new Date().getFullYear()} Qosprey ·{t.auth.registerCopyrightSuffix}
        </div>
      </section>

      {/* Registration Form Panel */}
      <section className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-[420px] space-y-6">
          <div className="flex items-center justify-between lg:hidden">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-sm font-black text-white">
                Q
              </span>
              <span className="text-base font-bold text-white">AI Marketing OS</span>
            </Link>
          </div>

          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white">{t.auth.registerTitle}</h1>
            <p className="mt-1.5 text-xs text-slate-400">
              {t.auth.registerTrialSubtitle}
            </p>
          </div>

          <form onSubmit={onSubmit} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-7 space-y-4 shadow-xl">
            <div>
              <label className="block text-xs font-semibold text-slate-300">{t.auth.fullNameLabel}</label>
              <input
                type="text"
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder={t.auth.namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300">{t.auth.emailAddressLabel}</label>
              <input
                type="email"
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="yourname@brand.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300">{t.auth.passwordMinLabel}</label>
              <input
                type="password"
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error ? (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 font-medium">
                {error}
              </div>
            ) : null}

            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-[11px] leading-relaxed text-indigo-200">
              {t.auth.verifyNotePrefix}<b>{t.auth.verifyNoteBold}</b>{t.auth.verifyNoteSuffix}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 via-violet-600 to-fuchsia-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/25 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
            >
              {loading ? t.auth.pleaseWait : t.auth.registerFreeButton}
            </button>

            <p className="text-center text-xs text-slate-400 pt-1">
              {t.auth.haveAccount}
              <Link className="font-semibold text-indigo-400 hover:text-indigo-300 underline" href="/login">
                {t.auth.loginLink}
              </Link>
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}
