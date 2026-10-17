"use client";
import React, { useCallback, useEffect, useState } from "react";
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
      toast({ title: e instanceof Error ? e.message : "লোড ব্যর্থ হয়েছে", tone: "error" });
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
      toast({ title: e instanceof Error ? e.message : "লিংক তৈরি ব্যর্থ হয়েছে", tone: "error" });
    } finally {
      setBusy("");
    }
  }

  async function revokeLink(riderId: string) {
    if (!orgId) return;
    setBusy(`revoke-${riderId}`);
    try {
      await apiFetch(`/organizations/${orgId}/delivery/riders/${riderId}/share-link`, { method: "DELETE" });
      toast({ title: "শেয়ার লিংক বাতিল হয়েছে — আগের লিংক আর কাজ করবে না" });
      await load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "বাতিল ব্যর্থ হয়েছে", tone: "error" });
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
    return <main className="p-6 text-sm text-slate-500">প্রথমে একটি অর্গানাইজেশন বেছে নিন।</main>;
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">🛵 রাইডার লাইভ (GPS)</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            সক্রিয় ডেলিভারিতে থাকা নিজস্ব রাইডারদের সর্বশেষ অবস্থান। রাইডার তার শেয়ার পেজটি ফোনে খোলা রাখলেই
            কেবল লোকেশন আসে — পেজ বন্ধ থাকলে কোনো ট্র্যাকিং হয় না। ৫ মিনিটের পুরনো অবস্থানকে
            <b> “পুরনো” </b> হিসেবে চিহ্নিত করা হয়, লাইভ বলে দেখানো হয় না।
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} className={`${inputBtn} bg-indigo-600 text-white hover:bg-indigo-700`}>
          {loading ? "লোড হচ্ছে…" : "🔄 রিফ্রেশ"}
        </button>
      </header>

      {issuedLink ? (
        <section className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-bold text-emerald-900">
            {issuedLink.riderName}-এর শেয়ার লিংক — রাইডারকে পাঠিয়ে দিন। এই লিংকটি শুধু এখনই দেখানো হচ্ছে, পরে আর দেখা যাবে না (প্রয়োজনে নতুন লিংক তৈরি করুন)।
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-2 font-mono text-xs font-bold text-slate-900">{issuedLink.link}</code>
            <button type="button" onClick={copyLink} className={`${inputBtn} shrink-0 bg-emerald-600 text-white hover:bg-emerald-700`}>
              {copied ? "কপি হয়েছে ✅" : "কপি করুন"}
            </button>
            <button type="button" onClick={() => setIssuedLink(null)} className={`${inputBtn} shrink-0 bg-white text-slate-600 border border-slate-200`}>
              বন্ধ করুন
            </button>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-black text-slate-800">সক্রিয় ডেলিভারি ({fleet?.entries.length ?? 0})</h2>
        {loading && !fleet ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}
        {fleet && fleet.entries.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            এখন কোনো সক্রিয় ডেলিভারি অ্যাসাইনমেন্ট নেই। অর্ডার পেজ থেকে রাইডার অ্যাসাইন করলে এখানে দেখা যাবে।
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          {(fleet?.entries ?? []).map((e) => (
            <article key={e.assignmentId} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-black text-slate-900">🛵 {e.riderName ?? "রাইডার"}</p>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${e.assignmentStatus === "picked_up" ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600"}`}>
                  {e.assignmentStatus === "picked_up" ? "পার্সেল হাতে — ডেলিভারির পথে" : "অ্যাসাইন করা হয়েছে"}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                অর্ডার: <b className="text-slate-700">{e.orderNumber ?? e.orderId}</b>
                {e.riderPhone ? <> · 📞 <span className="font-mono">{e.riderPhone}</span></> : null}
              </p>
              <p className="text-xs">
                {e.sharing.sharing ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">📍 লোকেশন শেয়ারিং চালু</span>
                ) : e.sharing.hasLink ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700">শেয়ারিং বন্ধ{e.sharing.revoked ? " (লিংক বাতিল)" : ""}</span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-500">কোনো শেয়ার লিংক নেই — নিচে তৈরি করুন</span>
                )}
              </p>
              {e.location ? (
                <div className="space-y-1 rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-sm font-semibold text-slate-800">
                    📍 {coordsLabel(e.location)}
                    {e.location.stale ? (
                      <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-black text-amber-800">পুরনো অবস্থান</span>
                    ) : (
                      <span className="ml-2 rounded-full bg-emerald-200 px-2 py-0.5 text-[11px] font-black text-emerald-800">সর্বশেষ</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    {fixAgeLabel(e.location.ageMs)} · {new Date(e.location.recordedAt).toLocaleString("bn-BD")}
                    {e.location.accuracy != null ? <> · নির্ভুলতা ≈ {Math.round(e.location.accuracy)} মিটার</> : null}
                    {" · "}
                    <a href={e.location.mapsUrl} target="_blank" rel="noreferrer" className="font-bold text-indigo-700 underline">মানচিত্রে দেখুন</a>
                  </p>
                </div>
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  এখনো কোনো লোকেশন পাওয়া যায়নি — রাইডার শেয়ার পেজ খুলে শেয়ারিং চালু করলে এখানে দেখা যাবে।
                </p>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-black text-slate-800">রাইডারদের শেয়ার লিংক</h2>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {(fleet?.riders ?? []).map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
              <div className="min-w-40 flex-1">
                <p className="text-sm font-bold text-slate-800">{r.name} {!r.active ? <span className="text-xs font-semibold text-slate-400">(নিষ্ক্রিয়)</span> : null}</p>
                <p className="font-mono text-xs text-slate-500">{r.phone}</p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${r.sharing.sharing ? "bg-emerald-100 text-emerald-700" : r.sharing.hasLink ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                {r.sharing.sharing ? "শেয়ারিং চালু" : r.sharing.revoked ? "লিংক বাতিল" : r.sharing.hasLink ? "শেয়ারিং বন্ধ" : "লিংক নেই"}
              </span>
              <button
                type="button"
                disabled={busy === `issue-${r.id}` || !r.active}
                onClick={() => issueLink(r.id, r.name)}
                className={`${inputBtn} bg-indigo-600 text-white hover:bg-indigo-700`}
              >
                {r.sharing.hasLink ? "নতুন লিংক (রোটেট)" : "লিংক তৈরি করুন"}
              </button>
              {r.sharing.hasLink && !r.sharing.revoked ? (
                <button
                  type="button"
                  disabled={busy === `revoke-${r.id}`}
                  onClick={() => revokeLink(r.id)}
                  className={`${inputBtn} bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100`}
                >
                  লিংক বাতিল করুন
                </button>
              ) : null}
            </div>
          ))}
          {fleet && fleet.riders.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">কোনো রাইডার নেই — ওয়্যারহাউস / অর্ডার পেজ থেকে রাইডার যোগ করুন।</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
