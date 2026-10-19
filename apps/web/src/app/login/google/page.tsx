"use client";
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { parseHandoffFromHash } from "@/lib/google-auth";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

interface ExchangeResponse { accessToken?: string; requiresTotp?: boolean; challengeToken?: string }

/**
 * AB8 (AX26) — Google login landing. The API redirects the browser
 * here with the one-time handoff token in the URL fragment
 * (#handoff=<token>) so it never reaches a server or a log. We read
 * it once, strip the fragment from history immediately, exchange it
 * for the usual login response, and finish exactly like the
 * password login does — including the TOTP challenge step when the
 * account has two-factor on (the challenge carries its Google
 * origin internally; the verify call is unchanged).
 */
export default function GoogleLoginCallbackPage() {
  const router = useRouter();
  const startedRef = useRef(false);
  const [challengeToken, setChallengeToken] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const handoffToken = parseHandoffFromHash(window.location.hash);
    // Remove the fragment from history right after reading it, so
    // the token doesn't linger in the address bar or history.
    window.history.replaceState(null, "", window.location.pathname);
    if (!handoffToken) {
      router.replace("/login?googleError=state_invalid");
      return;
    }
    apiFetch<ExchangeResponse>("/auth/google/exchange", {
      method: "POST", body: JSON.stringify({ handoffToken }),
    }).then((data) => {
      if (data.requiresTotp && data.challengeToken) {
        setChallengeToken(data.challengeToken);
        return;
      }
      if (!data.accessToken) throw new Error("exchange failed");
      localStorage.setItem("accessToken", data.accessToken);
      router.replace("/dashboard");
    }).catch(() => {
      router.replace("/login?googleError=exchange_failed");
    });
  }, [router]);

  async function onVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await apiFetch<{ accessToken: string }>("/auth/totp/verify", {
        method: "POST", body: JSON.stringify({ challengeToken, code }),
      });
      localStorage.setItem("accessToken", data.accessToken);
      router.replace("/dashboard");
    } catch (err) { setError(err instanceof Error ? err.message : t.auth.codeVerifyFailed); }
    finally { setLoading(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-[420px] animate-rise">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-base font-black text-white">Q</span>
          <div className="text-lg font-bold tracking-tight">AI Marketing OS</div>
        </div>
        {challengeToken ? (
          <form onSubmit={onVerifyCode} className="card space-y-4 p-6 sm:p-7">
            <p className="text-sm text-slate-600">{t.googleLogin.introPrefix}<b>{t.googleLogin.introBold}</b>{t.googleLogin.introSuffix}</p>
            <label className="block text-sm font-medium text-slate-700">{t.auth.totpCodeLabel}
              <input className="input mt-1.5 tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required placeholder="123456" />
            </label>
            {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">{error}</p> : null}
            <button className="btn-primary w-full py-2.5 text-[15px]" disabled={loading || code.length !== 6}>
              {loading ? t.auth.verifying : t.auth.verifyAndLogin}
            </button>
          </form>
        ) : (
          <div className="card p-6 text-center sm:p-7">
            <p className="text-[15px] font-medium text-slate-700">{t.googleLogin.completing}</p>
            <p className="mt-1 text-sm text-slate-500">{t.googleLogin.completingHelp}</p>

          </div>
        )}
      </div>
    </main>
  );
}
