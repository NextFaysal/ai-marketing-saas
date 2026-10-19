"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { getOrganizationId } from "@/lib/org";
import { apiFetch } from "@/lib/api";
import { coordsLabel, fixAgeLabel, type FleetView } from "@/lib/rider-gps";
import { useToast } from "@repo/ui/client";

// NF9 (FB4) — Fleet view: every ACTIVE own-rider assignment
// with the rider's last-known fix. Freshness is the SERVER's
// call (`stale` + `ageMs`, 5-minute threshold): an old fix is
// badged "পুরনো অবস্থান" and never dressed up as live. There
// is deliberately NO map vendor (the web bundle carries none) —
// a fix renders as coordinates + a "মানচিত্রে দেখুন" external
// Google Maps link built from those coordinates. Share links
// are managed here: issue/rotate returns the raw token ONCE
// (shown below until dismissed); revoke kills it immediately.

const inputBtn =
  "rounded-xl px-3.5 py-1.5 text-xs font-bold transition disabled:opacity-50";

export default function DeliveryFleetPage() {
  const { dict, t, locale } = useLocale();
  const { toast } = useToast();
  const orgId = getOrganizationId();
  const [fleet, setFleet] = useState<FleetView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [issuedLink, setIssuedLink] = useState<{ riderName: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      setFleet(await apiFetch<FleetView>(`/organizations/${orgId}/delivery/fleet`));
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : dict.delivery.failedToLoad, tone: "error" });
    } finally {
      setLoading(false);
    }
  }, [orgId, toast]);

  useEffect(() => { void load(); }, [load]);

  async function issueLink(riderId: string, riderName: string) {
    if (!orgId) return;
    setBusy(`issue-${riderId}`);
    try {
      const out = await apiFetch<{ link: string }>(
        `/organizations/${orgId}/delivery/riders/${riderId}/share-link`, { method: "POST" },
      );
      setIssuedLink({ riderName, link: out.link });
      setCopied(false);
      await load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : dict.delivery.failedToCreateLink, tone: "error" });
    } finally {
      setBusy("");
    }
  }

  async function revokeLink(riderId: string) {
    if (!orgId) return;
    setBusy(`revoke-${riderId}`);
    try {
      await apiFetch(`/organizations/${orgId}/delivery/riders/${riderId}/share-link`, { method: "DELETE" });
      toast({ title: dict.delivery.shareLinkRevokedThePrevious });
      await load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : dict.delivery.cancellationFailed, tone: "error" });
    } finally {
      setBusy("");
    }
  }

  async function copyLink() {
    if (!issuedLink) return;
    try {
      await navigator.clipboard.writeText(issuedLink.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the link stays visible to copy manually */ }
  }

  if (!orgId) {
    return <main className="p-6 text-sm text-slate-500">{dict.delivery.selectAnOrganizationFirst}</main>;
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">{dict.delivery.riderLiveGPS}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {dict.delivery.latestLocationsOfYourOwn}<b> {dict.delivery.markedAsStale}</b> {dict.delivery.notShownAsLive}</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className={`${inputBtn} bg-indigo-600 text-white hover:bg-indigo-700`}>
          {loading ? dict.common.loading : dict.delivery.refresh}
        </button>
      </header>

      {issuedLink ? (
        <section className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-bold text-emerald-900">
            {issuedLink.riderName}{dict.delivery.sShareLinkSendIt}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-2 font-mono text-xs font-bold text-slate-900">{issuedLink.link}</code>
            <button type="button" onClick={copyLink} className={`${inputBtn} shrink-0 bg-emerald-600 text-white hover:bg-emerald-700`}>
              {copied ? dict.delivery.copied : dict.delivery.copy}
            </button>
            <button type="button" onClick={() => setIssuedLink(null)} className={`${inputBtn} shrink-0 bg-white text-slate-600 border border-slate-200`}>
              {dict.delivery.close}</button>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-black text-slate-800">{dict.delivery.activeDeliveries}{fleet?.entries.length ?? 0})</h2>
        {loading && !fleet ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : null}
        {fleet && fleet.entries.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            {dict.delivery.thereAreNoActiveDelivery}</p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          {(fleet?.entries ?? []).map((e) => (
            <article key={e.assignmentId} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-black text-slate-900">🛵 {e.riderName ?? dict.delivery.rider}</p>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${e.assignmentStatus === "picked_up" ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600"}`}>
                  {e.assignmentStatus === "picked_up" ? dict.delivery.parcelPickedUpOutFor : dict.delivery.assigned}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {dict.delivery.order}<b className="text-slate-700">{e.orderNumber ?? e.orderId}</b>
                {e.riderPhone ? <> · 📞 <span className="font-mono">{e.riderPhone}</span></> : null}
              </p>
              <p className="text-xs">
                {e.sharing.sharing ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">{dict.delivery.locationSharingOn}</span>
                ) : e.sharing.hasLink ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700">{dict.delivery.sharingOff}{e.sharing.revoked ? dict.delivery.linkRevoked : ""}</span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-500">{dict.delivery.noShareLinksCreateOne}</span>
                )}
              </p>
              {e.location ? (
                <div className="space-y-1 rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-sm font-semibold text-slate-800">
                    📍 {coordsLabel(e.location)}
                    {e.location.stale ? (
                      <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-black text-amber-800">{dict.delivery.staleLocation}</span>
                    ) : (
                      <span className="ml-2 rounded-full bg-emerald-200 px-2 py-0.5 text-[11px] font-black text-emerald-800">{dict.delivery.lastSeen}</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    {fixAgeLabel(e.location.ageMs)} · {fmtDateTime(locale, new Date(e.location.recordedAt))}
                    {e.location.accuracy != null ? <> {dict.delivery.accuracy}{Math.round(e.location.accuracy)} {dict.delivery.meters}</> : null}
                    {" · "}
                    <a href={e.location.mapsUrl} target="_blank" rel="noreferrer" className="font-bold text-indigo-700 underline">{dict.delivery.viewOnMap}</a>
                  </p>
                </div>
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  {dict.delivery.noLocationReceivedYetOnce}</p>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-black text-slate-800">{dict.delivery.riderShareLinks}</h2>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {(fleet?.riders ?? []).map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
              <div className="min-w-40 flex-1">
                <p className="text-sm font-bold text-slate-800">{r.name} {!r.active ? <span className="text-xs font-semibold text-slate-400">{dict.delivery.inactive}</span> : null}</p>
                <p className="font-mono text-xs text-slate-500">{r.phone}</p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${r.sharing.sharing ? "bg-emerald-100 text-emerald-700" : r.sharing.hasLink ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                {r.sharing.sharing ? dict.delivery.sharingOn : r.sharing.revoked ? dict.delivery.revokeLink : r.sharing.hasLink ? dict.delivery.sharingOff : dict.delivery.noLink}
              </span>
              <button
                type="button"
                disabled={busy === `issue-${r.id}` || !r.active}
                onClick={() => issueLink(r.id, r.name)}
                className={`${inputBtn} bg-indigo-600 text-white hover:bg-indigo-700`}
              >
                {r.sharing.hasLink ? dict.delivery.newLinkRotate : dict.delivery.createLink}
              </button>
              {r.sharing.hasLink && !r.sharing.revoked ? (
                <button
                  type="button"
                  disabled={busy === `revoke-${r.id}`}
                  onClick={() => revokeLink(r.id)}
                  className={`${inputBtn} bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100`}
                >
                  {dict.delivery.revokeLink2}</button>
              ) : null}
            </div>
          ))}
          {fleet && fleet.riders.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">{dict.delivery.noRidersAddRidersFrom}</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
