"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  minorToMinTotalTaka, minTotalTakaToMinor, type SocialProofSetting,
} from "@/lib/ab7";

// AB7 (AX17) — social-proof settings card for the storefront
// settings area. Own endpoints:
//   GET/PUT organizations/:orgId/social-proof/setting
// minTotalMinor travels as a paisa string; the form edits টাকায়
// and converts with the exact string-arithmetic helpers (ab7 →
// storefront-money), like every other money input here.
// The card carries the honesty line VERBATIM: only this shop's
// real orders are ever shown — no fabricated proof.

export function SocialProofSettingsCard() {
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
      setError(`${label} সঠিক সংখ্যা দিন (${min} বা বেশি)।`);
      return null;
    }
    return n;
  }

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setNotice("");
    const lookback = parseIntField("খোঁজার সময়সীমা (ঘণ্টা)", lookbackHours, 1); if (lookback === null) return;
    const interval = parseIntField("দেখানোর ব্যবধান (সেকেন্ড)", intervalSec, 1); if (interval === null) return;
    const display = parseIntField("কতক্ষণ দেখাবে (সেকেন্ড)", displaySec, 1); if (display === null) return;
    const maxSession = parseIntField("সেশনে সর্বোচ্চ কয়বার", maxPerSession, 1); if (maxSession === null) return;
    let minTotalMinor: string | null = null;
    if (minTotalTaka.trim()) {
      minTotalMinor = minTotalTakaToMinor(minTotalTaka);
      if (minTotalMinor === null) {
        setError("সর্বনিম্ন অর্ডার মূল্য টাকায় সঠিক সংখ্যা দিন (যেমন: ৫০০), অথবা খালি রাখুন।");
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
      setNotice("সোশ্যাল প্রুফ সেটিংস সংরক্ষণ হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(false); }
  }

  return (
    <section className="card space-y-4 p-5">
      <div>
        <div className="font-semibold">🛍️ সোশ্যাল প্রুফ (কেনাকাটার বিজ্ঞপ্তি)</div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          দোকানে সাম্প্রতিক আসল কেনাকাটার ছোট বিজ্ঞপ্তি ("কিছুক্ষণ আগে একজন ক্রেতা এই পণ্যটি কিনেছেন")
          ভিজিটরদের দেখানো হয় — কখন, কতক্ষণ ও কয়বার দেখাবে তা এখান থেকে ঠিক করুন।
        </p>
        <p className="mt-1 rounded-lg bg-emerald-50 p-3 text-xs font-semibold leading-relaxed text-emerald-800">
          এখানে শুধুমাত্র আপনার দোকানের আসল অর্ডার দেখানো হয় — ভুয়া বা সাজানো প্রমাণ তৈরি করা হয় না।
        </p>
        <p className="text-xs text-slate-500">
          মোট ইমপ্রেশন: <b>{impressions ?? 0}</b>বার দেখানো হয়েছে।
        </p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        সোশ্যাল প্রুফ চালু করুন
      </label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block text-sm">কত ঘণ্টা পেছনের অর্ডার দেখাবে
          <input className="input mt-1" type="number" min="1" value={lookbackHours} onChange={(e) => setLookbackHours(e.target.value)} disabled={!enabled} />
        </label>
        <label className="block text-sm">দেখানোর ব্যবধান (সেকেন্ড)
          <input className="input mt-1" type="number" min="1" value={intervalSec} onChange={(e) => setIntervalSec(e.target.value)} disabled={!enabled} />
        </label>
        <label className="block text-sm">একবার কতক্ষণ দেখাবে (সেকেন্ড)
          <input className="input mt-1" type="number" min="1" value={displaySec} onChange={(e) => setDisplaySec(e.target.value)} disabled={!enabled} />
        </label>
        <label className="block text-sm">এক সেশনে সর্বোচ্চ কয়বার
          <input className="input mt-1" type="number" min="1" value={maxPerSession} onChange={(e) => setMaxPerSession(e.target.value)} disabled={!enabled} />
        </label>
        <label className="block text-sm">সর্বনিম্ন অর্ডার মূল্য (টাকা, খালি = নেই)
          <input className="input mt-1" inputMode="decimal" value={minTotalTaka} onChange={(e) => setMinTotalTaka(e.target.value)} placeholder="যেমন: ৫০০" disabled={!enabled} />
        </label>
      </div>
      <button type="button" className="btn-primary disabled:opacity-50" disabled={busy} onClick={() => void save()}>
        {busy ? "সংরক্ষণ হচ্ছে…" : "সোশ্যাল প্রুফ সেটিংস সংরক্ষণ করুন"}
      </button>
    </section>
  );
}
