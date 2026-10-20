"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  minorToMinTotalTaka, minTotalTakaToMinor, type SocialProofSetting,
} from "@/lib/ab7";
import { useLocale } from "@/lib/i18n/provider";
import { fmtNumber } from "@repo/contracts";

// AB7 (AX17) — social-proof settings card for the storefront
// settings area. Own endpoints:
//   GET/PUT organizations/:orgId/social-proof/setting
// minTotalMinor travels as a paisa string; the form edits টাকায়
// and converts with the exact string-arithmetic helpers (ab7 →
// storefront-money), like every other money input here.
// The card carries the honesty line VERBATIM: only this shop's
// real orders are ever shown — no fabricated proof.

export function SocialProofSettingsCard() {
  const { dict, t, locale } = useLocale();
  const S = dict.shared;
  const [enabled, setEnabled] = useState(false);
  const [lookbackHours, setLookbackHours] = useState("24");
  const [intervalSec, setIntervalSec] = useState("20");
  const [displaySec, setDisplaySec] = useState("6");
  const [maxPerSession, setMaxPerSession] = useState("5");
  const [minTotalTaka, setMinTotalTaka] = useState("");
  const [impressions, setImpressions] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const s = await apiFetch<SocialProofSetting>(`/organizations/${orgId}/social-proof/setting`);
      setEnabled(!!s.enabled);
      setLookbackHours(String(s.lookbackHours ?? 24));
      setIntervalSec(String(s.intervalSec ?? 20));
      setDisplaySec(String(s.displaySec ?? 6));
      setMaxPerSession(String(s.maxPerSession ?? 5));
      setMinTotalTaka(minorToMinTotalTaka(s.minTotalMinor));
      setImpressions(typeof s.impressions === "number" ? s.impressions : null);
    } catch { /* card keeps defaults until the endpoint answers */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function parseIntField(label: string, value: string, min: number): number | null {
    const n = parseInt(value || "", 10);
    if (!Number.isInteger(n) || n < min) {
      setError(t("shared.zzSpsInvalidNumber", { label, min: fmtNumber(locale, min) }));
      return null;
    }
    return n;
  }

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setNotice("");
    const lookback = parseIntField(S.zzSpsLabelLookback, lookbackHours, 1); if (lookback === null) return;
    const interval = parseIntField(S.zzSpsLabelInterval, intervalSec, 1); if (interval === null) return;
    const display = parseIntField(S.zzSpsLabelDisplay, displaySec, 1); if (display === null) return;
    const maxSession = parseIntField(S.zzSpsLabelMaxSession, maxPerSession, 1); if (maxSession === null) return;
    let minTotalMinor: string | null = null;
    if (minTotalTaka.trim()) {
      minTotalMinor = minTotalTakaToMinor(minTotalTaka);
      if (minTotalMinor === null) {
        setError(S.zzSpsMinTotalError);
        return;
      }
    }
    setBusy(true);
    try {
      const s = await apiFetch<SocialProofSetting>(`/organizations/${orgId}/social-proof/setting`, {
        method: "PUT",
        body: JSON.stringify({
          enabled,
          lookbackHours: lookback,
          intervalSec: interval,
          displaySec: display,
          maxPerSession: maxSession,
          minTotalMinor,
        }),
      });
      setImpressions(typeof s.impressions === "number" ? s.impressions : impressions);
      setNotice(S.zzSpsSaved);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : S.zzSpsSaveFailed); }
    finally { setBusy(false); }
  }

  return (
    <section className="card space-y-4 p-5">
      <div>
        <div className="font-semibold">{S.zzSpsTitle}</div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          {S.zzSpsIntro}
        </p>
        <p className="mt-1 rounded-lg bg-emerald-50 p-3 text-xs font-semibold leading-relaxed text-emerald-800">
          {S.zzSpsHonesty}
        </p>
        <p className="text-xs text-slate-500">
          {S.zzSpsImpressionsPrefix}<b>{fmtNumber(locale, impressions ?? 0)}</b>{S.zzSpsImpressionsSuffix}
        </p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {S.zzSpsEnable}
      </label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block text-sm">{S.zzSpsFieldLookback}
          <input className="input mt-1" type="number" min="1" value={lookbackHours} onChange={(e) => setLookbackHours(e.target.value)} disabled={!enabled} />
        </label>
        <label className="block text-sm">{S.zzSpsLabelInterval}
          <input className="input mt-1" type="number" min="1" value={intervalSec} onChange={(e) => setIntervalSec(e.target.value)} disabled={!enabled} />
        </label>
        <label className="block text-sm">{S.zzSpsFieldDisplay}
          <input className="input mt-1" type="number" min="1" value={displaySec} onChange={(e) => setDisplaySec(e.target.value)} disabled={!enabled} />
        </label>
        <label className="block text-sm">{S.zzSpsFieldMax}
          <input className="input mt-1" type="number" min="1" value={maxPerSession} onChange={(e) => setMaxPerSession(e.target.value)} disabled={!enabled} />
        </label>
        <label className="block text-sm">{S.zzSpsFieldMinTotal}
          <input className="input mt-1" inputMode="decimal" value={minTotalTaka} onChange={(e) => setMinTotalTaka(e.target.value)} placeholder={S.zzSpsPlaceholder500} disabled={!enabled} />
        </label>
      </div>
      <button type="button" className="btn-primary disabled:opacity-50" disabled={busy} onClick={() => void save()}>
        {busy ? S.zzSpsSaving : S.zzSpsSaveBtn}
      </button>
    </section>
  );
}
