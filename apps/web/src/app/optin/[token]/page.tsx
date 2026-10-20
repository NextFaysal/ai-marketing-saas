"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

/**
 * MX10 — double opt-in confirmation page. The signed token in
 * the confirmation email is the only credential; GET validates
 * (masked address only), the button POSTs the actual confirm —
 * the same shape as the public unsubscribe page.
 */
export default function PublicOptInConfirmPage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [info, setInfo] = useState<{ valid: boolean; channel: string; address: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/messaging/optin/${token}`);
        if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message ?? t.optinConfirm.linkUnusable); }
        setInfo(await res.json());
      } catch (e) { setError(e instanceof Error ? e.message : t.optinConfirm.linkUnusable); }
    })();
  }, [token]);

  async function confirm() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/public/messaging/optin/${token}`, { method: "POST" });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message ?? t.optinConfirm.confirmFailed);
      setDone(j?.message ?? t.optinConfirm.confirmedFallback);
    } catch (e) { setError(e instanceof Error ? e.message : t.optinConfirm.confirmFailed); }
    finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-xl space-y-5 p-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-400">Messaging</p>
        <h1 className="mt-1 text-2xl font-bold">{t.optinConfirm.title}</h1>
      </header>
      {!info && !error ? <p className="text-sm text-slate-500">{t.optinConfirm.loading}</p> : null}
      {error && !done ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      {info && !done ? (
        <section className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-700"><span className="font-medium">{info.address}</span>{t.optinConfirm.bodySuffix}</p>
          <button className="btn-primary" disabled={busy} onClick={confirm}>{busy ? t.optinConfirm.working : t.optinConfirm.confirmButton}</button>

        </section>
      ) : null}
      {done ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-sm font-semibold text-emerald-800">✅ {done}</p>
        </section>
      ) : null}
    </main>
  );
}
