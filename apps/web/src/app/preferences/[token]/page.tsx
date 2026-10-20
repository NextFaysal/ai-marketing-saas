"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

interface CenterChannel { channel: string; address: string; status: string }
interface CenterView {
  organizationName: string | null; name: string;
  channels: CenterChannel[]; topics: string[] | null; availableTopics: string[]; maxPerDay: number | null;
}

const CHANNEL_LABEL: Record<string, string> = { email: t.preferences.channelEmail, sms: "SMS", whatsapp: "WhatsApp" };

/**
 * MX10 — public preference center. The signed token from the
 * org's mail/link is the only credential (same HMAC discipline
 * as the unsubscribe page). Channel on/off writes real
 * preference rows; topic + frequency choices are stored on the
 * same rows and enforced by the broadcast resolver.
 * Unsubscribe-all stays ONE click — the center adds choice,
 * never friction to opting out.
 */
export default function PublicPreferencesPage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [view, setView] = useState<CenterView | null>(null);
  const [channels, setChannels] = useState<Record<string, boolean>>({});
  const [topics, setTopics] = useState<string[]>([]);
  const [maxPerDay, setMaxPerDay] = useState<string>("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/messaging/preferences/${token}`);
        if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message ?? t.preferences.linkUnusable); }
        const v = (await res.json()) as CenterView;
        setView(v);
        setChannels(Object.fromEntries(v.channels.map((c) => [c.channel, c.status !== "opted_out" && c.status !== "pending"])));
        setTopics(v.topics ?? []);
        setMaxPerDay(v.maxPerDay === null || v.maxPerDay === undefined ? "" : String(v.maxPerDay));
      } catch (e) { setError(e instanceof Error ? e.message : t.preferences.linkUnusable); }
    })();
  }, [token]);

  async function save() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/public/messaging/preferences/${token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels,
          topics: view && view.availableTopics.length ? topics : undefined,
          maxPerDay: maxPerDay === "" ? null : Number(maxPerDay),
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message ?? t.preferences.saveFailed);
      setView(j as CenterView);
      setDone(t.preferences.saved);
    } catch (e) { setError(e instanceof Error ? e.message : t.preferences.saveFailed); }
    finally { setBusy(false); }
  }

  async function unsubscribeAll() {
    if (!window.confirm(t.preferences.confirmUnsubAll)) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/public/messaging/preferences/${token}/unsubscribe-all`, { method: "POST" });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message ?? t.preferences.unsubFailed);
      setDone(j?.message ?? t.preferences.unsubAllDone);
    } catch (e) { setError(e instanceof Error ? e.message : t.preferences.unsubFailed); }
    finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-xl space-y-5 p-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-400">Messaging{view?.organizationName ? ` · ${view.organizationName}` : ""}</p>
        <h1 className="mt-1 text-2xl font-bold">{t.preferences.title}</h1>
      </header>
      {!view && !error ? <p className="text-sm text-slate-500">{t.preferences.loading}</p> : null}
      {error && !done ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      {done ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-sm font-semibold text-emerald-800">✅ {done}</p>
        </section>
      ) : null}
      {view && !done ? (
        <section className="space-y-5 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">{t.preferences.channelQuestion}</p>
            {view.channels.map((c) => (
              <label key={c.channel} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span>{CHANNEL_LABEL[c.channel] ?? c.channel} · <span className="text-slate-500">{c.address}</span>{c.status === "pending" ? <span className="text-amber-600">{t.preferences.pendingConfirmation}</span> : null}</span>
                <input type="checkbox" checked={!!channels[c.channel]} onChange={(e) => setChannels((s) => ({ ...s, [c.channel]: e.target.checked }))} />
              </label>
            ))}
          </div>
          {view.availableTopics.length ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">{t.preferences.topicQuestion}</p>
              <div className="flex flex-wrap gap-2">
                {view.availableTopics.map((t) => (
                  <label key={t} className="flex items-center gap-1 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                    <input type="checkbox" checked={topics.includes(t)} onChange={(e) => setTopics((s) => (e.target.checked ? [...s, t] : s.filter((x) => x !== t)))} /> {t}
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-400">{t.preferences.topicNoneNote}</p>
            </div>
          ) : null}
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">{t.preferences.maxPerDayLabel}</label>
            <input type="number" min="0" max="20" className="input w-32" value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} placeholder={t.preferences.noLimitPlaceholder} />
            <p className="text-xs text-slate-400">{t.preferences.maxPerDayNote}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy} onClick={save}>{busy ? t.preferences.working : t.preferences.saveButton}</button>
            <button className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={busy} onClick={unsubscribeAll}>{t.preferences.unsubAllButton}</button>
          </div>
          <p className="text-xs text-slate-400">{t.preferences.urgentNote}</p>

        </section>
      ) : null}
    </main>
  );
}
