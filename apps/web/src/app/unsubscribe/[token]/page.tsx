"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { pubT, publicDicts } from "@/lib/i18n/public";
import { tr } from "@/lib/i18n/lookup";

const t = pubT();

interface UnsubscribeInfo { valid: boolean; channel: string; address: string }

/**
 * MS2 — public unsubscribe page. The signed token from the
 * broadcast email footer is the only credential. GET validates
 * and shows only the channel + masked address; the opt-out is
 * written only when the visitor confirms with the button (POST).
 */
export default function PublicUnsubscribePage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [info, setInfo] = useState<UnsubscribeInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/messaging/unsubscribe/${token}`);
        if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message ?? t.unsubscribe.linkUnusable); }
        setInfo(await res.json());
      } catch (e) { setError(e instanceof Error ? e.message : t.unsubscribe.linkUnusable); }
    })();
  }, [token]);

  async function confirm() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/public/messaging/unsubscribe/${token}`, { method: "POST" });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message ?? t.unsubscribe.failed);
      setDone(j?.message ?? t.unsubscribe.doneFallback);
    } catch (e) { setError(e instanceof Error ? e.message : t.unsubscribe.failed); }
    finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-xl space-y-5 p-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-400">Messaging</p>
        <h1 className="mt-1 text-2xl font-bold">{t.unsubscribe.title}</h1>
      </header>
      {!info && !error ? <p className="text-sm text-slate-500">{t.unsubscribe.loading}</p> : null}
      {error && !done ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      {info && !done ? (
        <section className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-700">
            {tr(publicDicts, "bn", "unsubscribe.body", { address: info.address, channel: info.channel })}
          </p>
          <p className="text-xs text-slate-400">{t.unsubscribe.note}</p>
          <button className="btn-primary" disabled={busy} onClick={confirm}>{busy ? t.unsubscribe.working : t.unsubscribe.confirmButton}</button>

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
