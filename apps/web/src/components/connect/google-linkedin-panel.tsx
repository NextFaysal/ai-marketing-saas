"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { googleConnectKinds, googleKindLabel } from "@/lib/connections";
import { useLocale } from "@/lib/i18n/provider";

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
  const { dict, locale } = useLocale();
  const D = dict.connections;
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
      setError(e instanceof Error ? e.message : D.glFailedGoogle);
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
      setError(e instanceof Error ? e.message : D.glFailedYt);
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
      setError(e instanceof Error ? e.message : D.glFailedLi);
      setBusy("");
    }
  }, [sourceQs]);

  return (
    <section className="space-y-3" aria-label={D.glAriaSection}>
      <div>
        <h2 className="font-semibold text-slate-800">{D.glTitle}</h2>
        <p className="mt-1 text-sm text-slate-500">{D.glIntro}</p>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={D.glAriaAppPick}>
          <button
            type="button"
            onClick={() => setSource("platform")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${source === "platform" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {D.glPlatformApp}
          </button>
          <button
            type="button"
            onClick={() => setSource("own")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${source === "own" ? "bg-violet-600 text-white" : "bg-violet-50 text-violet-600 hover:bg-violet-100"}`}
          >
            {D.glOwnApp}
          </button>
        </div>
      </div>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {googleConnectKinds(locale).map((k) => (
          <div key={k.kind} className="card flex flex-col gap-2 p-4">
            <div className="font-semibold text-slate-800">{k.icon} {k.label}</div>
            <p className="flex-1 text-[13px] text-slate-500">{k.blurb}</p>
            <button
              type="button"
              disabled={busy === `google-${k.kind}`}
              onClick={() => void startGoogle(k.kind)}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy === `google-${k.kind}` ? D.glGoing : D.glConnectGoogle}
            </button>
          </div>
        ))}
        <div className="card flex flex-col gap-2 p-4">
          <div className="font-semibold text-slate-800">{D.glYtTitle}</div>
          <p className="flex-1 text-[13px] text-slate-500">{D.glYtBlurb}</p>
          <button
            type="button"
            disabled={busy === "youtube"}
            onClick={() => void startYouTube()}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy === "youtube" ? D.glGoing : D.glConnectYt}
          </button>
        </div>
        <div className="card flex flex-col gap-2 p-4">
          <div className="font-semibold text-slate-800">{D.glLiTitle}</div>
          <p className="flex-1 text-[13px] text-slate-500">{D.glLiBlurb}</p>
          <button
            type="button"
            disabled={busy === "linkedin"}
            onClick={() => void startLinkedIn()}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy === "linkedin" ? D.glGoing : D.glConnectLi}
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
  const { dict, t, locale } = useLocale();
  const D = dict.connections;
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
        if (live) setError(e instanceof Error ? e.message : D.glPickListFailed);
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
      onDone(t("connections.glConnectedNamed", { label: googleKindLabel(kind), name }));
    } catch (e) {
      setError(e instanceof Error ? e.message : D.glPickFailed);
      setBusy("");
    }
  }, [kind, state, onDone]);

  return (
    <section className="card space-y-3 border-indigo-200 p-4" aria-label={D.glPickAria}>
      <h2 className="font-semibold text-slate-800">{t("connections.glPickTitle", { label: googleKindLabel(kind) })}</h2>
      <p className="text-sm text-slate-500">{D.glPickSub}</p>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">{error}</p> : null}
      {options === null && !error ? <p className="text-sm text-slate-400">{D.glListLoading}</p> : null}
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
  const { dict, t } = useLocale();
  const D = dict.connections;
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
        if (live) setError(e instanceof Error ? e.message : D.glPickListFailed);
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
      onDone(t("connections.glLiConnected", { name }));
    } catch (e) {
      setError(e instanceof Error ? e.message : D.glPickFailed);
      setBusy("");
    }
  }, [state, onDone]);

  return (
    <section className="card space-y-3 border-indigo-200 p-4" aria-label={D.glLiPickAria}>
      <h2 className="font-semibold text-slate-800">{D.glLiPickTitle}</h2>
      <p className="text-sm text-slate-500">{D.glLiPickSub}</p>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">{error}</p> : null}
      {orgs === null && !error ? <p className="text-sm text-slate-400">{D.glListLoading}</p> : null}
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
