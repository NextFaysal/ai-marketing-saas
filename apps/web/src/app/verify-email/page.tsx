"use client";
import React, { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

/**
 * GC21 (GB9): public landing page for the emailed verification
 * link (`${WEB_URL}/verify-email?token=...`). Posts the token to
 * POST /auth/verify-email — the API is the only place the token
 * is consumed; the page just renders the outcome via the public dictionary.
 */
function VerifyForm() {
  const sp = useSearchParams();
  const token = sp.get("token") ?? "";
  const [state, setState] = useState<"working" | "done" | "already" | "failed">("working");
  const [msg, setMsg] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) { setState("failed"); setMsg(t.auth.verifyNoToken); return; }
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/verify-email`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.verified !== true) throw new Error(body.message ?? t.auth.verifyInvalidLink);
        setState(body.alreadyVerified ? "already" : "done");
      } catch (err) {
        setState("failed");
        setMsg(err instanceof Error ? err.message : t.auth.verifyFailed);
      }
    })();
  }, [token]);

  if (state === "working") return <p className="text-center text-sm text-slate-500">{t.auth.verifyingEmail}</p>;
  if (state === "done" || state === "already") return (
    <div className="space-y-3 text-center">
      <div className="text-4xl">✅</div>
      <p className="font-medium">{state === "already" ? t.auth.verifyAlready : t.auth.verifyDone}</p>
      <p className="text-sm text-slate-500">{t.auth.verifyDoneHelp}</p>
      <a href="/dashboard" className="btn-primary inline-block">{t.auth.goDashboard}</a>
      <a href="/login" className="block text-sm text-blue-600">{t.auth.loginLink}</a>
    </div>
  );
  return (
    <div className="space-y-3 text-center">
      <div className="text-4xl">⚠️</div>
      <p className="font-medium">{t.auth.verifyFailedTitle}</p>
      <p className="text-sm text-red-600">{msg}</p>
      <p className="text-sm text-slate-500">{t.auth.verifyFailedHelp}</p>
      <a href="/login" className="btn-primary inline-block">{t.auth.loginLink}</a>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <Suspense fallback={<p className="text-sm text-slate-500">{t.auth.loading}</p>}>

          <VerifyForm />
        </Suspense>
      </div>
    </div>
  );
}
