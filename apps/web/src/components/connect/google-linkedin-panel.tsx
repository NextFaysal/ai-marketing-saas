"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { GOOGLE_CONNECT_KINDS, googleKindLabel } from "@/lib/connections";

/**
 * CC20 — Google pack + LinkedIn Page connect strip.
 * CC28 — BOTH app paths: the strip carries an app-source choice
 * (প্ল্যাটফর্মের অ্যাপ / নিজের অ্যাপ) that applies to every
 * connect in it, YouTube included (YouTube rides the Google
 * app). "নিজের অ্যাপ" requires the tenant's app saved in the
 * own-app section above FIRST — the API refuses honestly when
 * it is missing, and for Google the Redirect URIs shown there
 * must be registered in the tenant's own Google Cloud console
 * or their OAuth cannot complete.
 * Each button asks the API for the authorize URL and leaves;
 * the Google/LinkedIn callbacks land back on this page with a
 * result param (handled by the page) or a pick state (handled
 * by the pick cards exported below, mirroring SP9's channel
 * picker); the YouTube callback lands on the Social Posts page,
 * where its channel picker lives (SP9 behavior, unchanged).
 * LinkedIn carries its honest gate in text: live posting needs
 * LinkedIn's Community Management API approval for the app in
 * use — connecting works on the standard scopes, posting is
 * LinkedIn's to unlock.
 */
export function GoogleLinkedInPanel() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // CC28: which app the connects below run under.
  const [source, setSource] = useState<"platform" | "own">("platform");
  const sourceQs = source === "own" ? "?appSource=own" : "";

  const startGoogle = useCallback(async (kind: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(`google-${kind}`);
    setError("");
    try {
      const res = await apiFetch<{ url: string }>(`organizations/${orgId}/connections/google/${kind}/connect-url${sourceQs}`);
      window.location.href = res.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google কানেক্ট শুরু হয়নি");
      setBusy("");
    }
  }, [sourceQs]);

  const startYouTube = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy("youtube");
    setError("");
    try {
      const res = await apiFetch<{ url: string }>(`organizations/${orgId}/social/accounts/youtube/connect-url${sourceQs}`);
      window.location.href = res.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "YouTube কানেক্ট শুরু হয়নি");
      setBusy("");
    }
  }, [sourceQs]);

  const startLinkedIn = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy("linkedin");
    setError("");
    try {
      const res = await apiFetch<{ url: string }>(`organizations/${orgId}/social/accounts/linkedin/connect-url${sourceQs}`);
      window.location.href = res.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "LinkedIn কানেক্ট শুরু হয়নি");
      setBusy("");
    }
  }, [sourceQs]);

  return (
    <section className="space-y-3" aria-label="Google ও LinkedIn কানেক্ট">
      <div>
        <h2 className="font-semibold text-slate-800">🔍 Google ও LinkedIn</h2>
        <p className="mt-1 text-sm text-slate-500">
          কোন অ্যাপ দিয়ে কানেক্ট করবেন বেছে নিন — প্ল্যাটফর্মের অ্যাপ, অথবা উপরের অংশে সেভ করা আপনার নিজের
          Google/LinkedIn অ্যাপ। নিজের Google অ্যাপ বেছে নিলে Redirect URI-গুলো আপনার Google Cloud Console-এ
          নিবন্ধন করা থাকতে হবে (উপরে দেখুন) — না থাকলে Google কানেক্ট প্রত্যাখ্যান করবে। কানেক্টের পর তালিকা
          থেকে আসল অ্যাকাউন্টটি বেছে নেবেন; যেই অ্যাকাউন্টে ওই সার্ভিসের কিছুই নেই, সেখানে কিছুই সেভ হবে না।
        </p>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="অ্যাপ বাছাই">
          <button
            type="button"
            onClick={() => setSource("platform")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${source === "platform" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            প্ল্যাটফর্মের অ্যাপ দিয়ে
          </button>
          <button
            type="button"
            onClick={() => setSource("own")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${source === "own" ? "bg-violet-600 text-white" : "bg-violet-50 text-violet-600 hover:bg-violet-100"}`}
          >
            নিজের অ্যাপ দিয়ে
          </button>
        </div>
      </div>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {GOOGLE_CONNECT_KINDS.map((k) => (
          <div key={k.kind} className="card flex flex-col gap-2 p-4">
            <div className="font-semibold text-slate-800">{k.icon} {k.label}</div>
            <p className="flex-1 text-[13px] text-slate-500">{k.blurb}</p>
            <button
              type="button"
              disabled={busy === `google-${k.kind}`}
              onClick={() => void startGoogle(k.kind)}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy === `google-${k.kind}` ? "যাচ্ছে…" : "Google দিয়ে কানেক্ট করুন"}
            </button>
          </div>
        ))}
        <div className="card flex flex-col gap-2 p-4">
          <div className="font-semibold text-slate-800">▶️ YouTube</div>
          <p className="flex-1 text-[13px] text-slate-500">
            YouTube Channel কানেক্ট করুন — Social Posts থেকে ভিডিও প্রকাশ করা যাবে। একাধিক Channel থাকলে
            তালিকা থেকে একটি বেছে নেবেন। (YouTube Google-এর অ্যাপ দিয়েই চলে — উপরের অ্যাপ-বাছাই এখানেও প্রযোজ্য।)
          </p>
          <button
            type="button"
            disabled={busy === "youtube"}
            onClick={() => void startYouTube()}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy === "youtube" ? "যাচ্ছে…" : "YouTube কানেক্ট করুন"}
          </button>
        </div>
        <div className="card flex flex-col gap-2 p-4">
          <div className="font-semibold text-slate-800">💼 LinkedIn Page</div>
          <p className="flex-1 text-[13px] text-slate-500">
            যেই Pageগুলোর আপনি admin, তালিকা থেকে একটি বেছে নেবেন — তারপর Social Posts থেকে পোস্ট করা যাবে।
            সৎ নোট: লাইভ পোস্টিংয়ের জন্য ব্যবহৃত LinkedIn অ্যাপে Community Management API-এর অনুমোদন
            লাগে — অনুমোদন না থাকলে LinkedIn নিজেই পোস্ট প্রত্যাখ্যান করবে এবং সেই বার্তাই দেখা যাবে।
          </p>
          <button
            type="button"
            disabled={busy === "linkedin"}
            onClick={() => void startLinkedIn()}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy === "linkedin" ? "যাচ্ছে…" : "LinkedIn দিয়ে কানেক্ট করুন"}
          </button>
        </div>
      </div>
    </section>
  );
}

/** The Google account picker — shown when the callback parked
 * MORE THAN ONE property/account/location in a pick state.
 * Exactly the picked id is submitted; the server re-checks it
 * against the offered list. */
export function GooglePickCard({ kind, state, onDone }: {
  kind: string;
  state: string;
  onDone: (message: string) => void;
}) {
  const [options, setOptions] = useState<{ id: string; name: string; detail?: string | null }[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    let live = true;
    (async () => {
      try {
        const res = await apiFetch<{ options: { id: string; name: string; detail?: string | null }[] }>(
          `organizations/${orgId}/connections/google/pick-info?state=${encodeURIComponent(state)}`,
        );
        if (live) setOptions(res.options ?? []);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "তালিকা লোড হয়নি — আবার কানেক্ট করুন।");
      }
    })();
    return () => { live = false; };
  }, [state]);

  const pick = useCallback(async (optionId: string, name: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(optionId);
    setError("");
    try {
      await apiFetch(`organizations/${orgId}/connections/google/${kind}/select`, {
        method: "POST",
        body: JSON.stringify({ state, optionId }),
      });
      onDone(`${googleKindLabel(kind)} কানেক্ট হয়েছে — “${name}”।`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "বেছে নেওয়া সম্পন্ন হয়নি");
      setBusy("");
    }
  }, [kind, state, onDone]);

  return (
    <section className="card space-y-3 border-indigo-200 p-4" aria-label="Google অ্যাকাউন্ট বেছে নিন">
      <h2 className="font-semibold text-slate-800">🔍 {googleKindLabel(kind)} — কোনটি কানেক্ট করবেন?</h2>
      <p className="text-sm text-slate-500">আপনার Google অ্যাকাউন্টে একাধিক পাওয়া গেছে। যেটি এই ব্যবসার, সেটি বেছে নিন — শুধু সেটিই সেভ হবে।</p>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">{error}</p> : null}
      {options === null && !error ? <p className="text-sm text-slate-400">তালিকা লোড হচ্ছে…</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {(options ?? []).map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={busy === o.id}
            onClick={() => void pick(o.id, o.name)}
            className="rounded-xl bg-slate-50 px-4 py-3 text-left ring-1 ring-inset ring-slate-200 hover:bg-indigo-50 disabled:opacity-50"
          >
            <span className="block font-semibold text-slate-800">{o.name}</span>
            <span className="block text-xs text-slate-400">{o.detail ? `${o.detail} · ` : ""}{o.id}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** The LinkedIn Page picker — the SP9 channel_pick shape for
 * organizations the member administrates. */
export function LinkedInPickCard({ state, onDone }: {
  state: string;
  onDone: (message: string) => void;
}) {
  const [orgs, setOrgs] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    let live = true;
    (async () => {
      try {
        const res = await apiFetch<{ organizations: { id: string; name: string }[] }>(
          `organizations/${orgId}/social/accounts/linkedin/pick-info?state=${encodeURIComponent(state)}`,
        );
        if (live) setOrgs(res.organizations ?? []);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "তালিকা লোড হয়নি — আবার কানেক্ট করুন।");
      }
    })();
    return () => { live = false; };
  }, [state]);

  const pick = useCallback(async (organizationId: string, name: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(organizationId);
    setError("");
    try {
      await apiFetch(`organizations/${orgId}/social/accounts/linkedin/select-organization`, {
        method: "POST",
        body: JSON.stringify({ state, organizationId }),
      });
      onDone(`LinkedIn Page কানেক্ট হয়েছে — “${name}”।`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "বেছে নেওয়া সম্পন্ন হয়নি");
      setBusy("");
    }
  }, [state, onDone]);

  return (
    <section className="card space-y-3 border-indigo-200 p-4" aria-label="LinkedIn Page বেছে নিন">
      <h2 className="font-semibold text-slate-800">💼 LinkedIn — কোন Pageটি কানেক্ট করবেন?</h2>
      <p className="text-sm text-slate-500">আপনি একাধিক Page-এর admin। যেটি এই ব্যবসার, সেটি বেছে নিন — শুধু সেটিই সেভ হবে।</p>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">{error}</p> : null}
      {orgs === null && !error ? <p className="text-sm text-slate-400">তালিকা লোড হচ্ছে…</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {(orgs ?? []).map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={busy === o.id}
            onClick={() => void pick(o.id, o.name)}
            className="rounded-xl bg-slate-50 px-4 py-3 text-left ring-1 ring-inset ring-slate-200 hover:bg-indigo-50 disabled:opacity-50"
          >
            <span className="block font-semibold text-slate-800">{o.name}</span>
            <span className="block text-xs text-slate-400">Organization ID: {o.id}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
