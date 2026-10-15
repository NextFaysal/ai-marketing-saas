"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  DeliverabilityView,
  UsageView,
  businessVerificationMeta,
  formatTakaMinor,
  formatWhen,
  usageMetricSummary,
} from "@/lib/connections";

/**
 * CC30 — per-account usage insights + deliverability.
 *
 * Fed ONLY by GET connections/usage and
 * connections/deliverability, which count REAL rows. Facts the
 * schema cannot attribute to one account arrive as null (or in
 * the unattributed list) and render as "তথ্য নেই" — this panel
 * never splits, estimates or invents a number. Cost appears
 * ONLY where the API computed it from the org's own entered
 * rate (labelled as such). Both endpoints are OWNER/ADMIN; for
 * other roles the panels quietly stay hidden.
 */

const WINDOWS = [7, 30, 90] as const;

export function UsageInsightsPanel() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<UsageView | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (d: number) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<UsageView>(`organizations/${orgId}/connections/usage?days=${d}`);
      setData(res);
    } catch { /* OWNER/ADMIN-only surface — stays hidden otherwise */ }
    setLoaded(true);
  }, []);

  useEffect(() => { void load(days); }, [load, days]);

  if (!loaded || !data) return null;

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-slate-800">📊 ব্যবহারের হিসাব (Usage) <span className="text-xs font-normal text-slate-400">(আসল রেকর্ড গুনে — কোন অ্যাকাউন্টে কত)</span></div>
        <div className="flex gap-1">
          {WINDOWS.map((d) => (
            <button
              key={d} type="button" onClick={() => setDays(d)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${days === d ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {d} দিন
            </button>
          ))}
        </div>
      </div>
      {data.accounts.length === 0 ? (
        <p className="text-xs leading-relaxed text-slate-500">এই সময়ে হিসাব করার মতো কোনো অ্যাকাউন্ট নেই।</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="py-1 pr-2 font-semibold">অ্যাকাউন্ট</th>
                <th className="py-1 pr-2 font-semibold">ব্যবহার (শেষ {data.days} দিন)</th>
                <th className="py-1 pr-2 font-semibold">যাচাইকৃত পরিমাণ</th>
                <th className="py-1 font-semibold">আনুমানিক খরচ</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => {
                const summary = usageMetricSummary(a);
                const volume = a.metrics && "verifiedVolumeMinor" in a.metrics ? a.metrics.verifiedVolumeMinor : null;
                return (
                  <tr key={`${a.targetType}:${a.targetId}`} className="border-t border-slate-100 align-top">
                    <td className="py-1.5 pr-2 font-medium text-slate-700">
                      {a.displayName}
                      <span className="block text-[11px] font-normal text-slate-400">{a.provider} · {a.category}</span>
                    </td>
                    <td className="py-1.5 pr-2 text-slate-600">
                      {summary ?? <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-500">তথ্য নেই</span>}
                      {a.attribution === "unavailable" ? (
                        <span className="block text-[11px] text-slate-400">এই চ্যানেলের পুরনো কথোপকথন কোনো নির্দিষ্ট অ্যাকাউন্টের সঙ্গে যুক্ত নয় — তাই ভাগ করে দেখানো হয়নি।</span>
                      ) : null}
                      {a.attribution === "store" ? (
                        <span className="block text-[11px] text-slate-400">অর্ডার স্টোরের সঙ্গে যুক্ত থাকে — এই স্টোরের মোট হিসাব।</span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-2 text-slate-600">
                      {typeof volume === "string" ? formatTakaMinor(volume) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="py-1.5 text-slate-600">
                      {a.estimatedCostMinor !== null ? (
                        <>
                          {formatTakaMinor(a.estimatedCostMinor)}
                          <span className="block text-[11px] text-slate-400">আপনার দেওয়া rate অনুযায়ী আনুমানিক (প্রতি মেসেজ {formatTakaMinor(String(a.costRateMinor ?? 0))})</span>
                        </>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data.unattributed.length > 0 ? (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">কোনো অ্যাকাউন্টে বরাদ্দ করা যায়নি:</span>{" "}
          {data.unattributed.map((u, i) => (
            <span key={i}>
              {i > 0 ? " · " : ""}
              {u.kind === "messaging"
                ? `${String(u.channel)} — এসেছে ${u.messagesReceived} · গেছে ${u.messagesSent} (অ্যাকাউন্ট-বিহীন পুরনো কথোপকথন)`
                : `${String(u.provider)} — শিপমেন্ট বুকিং ${u.shipmentsBooked} (CC29-এর আগের রেকর্ড, অ্যাকাউন্ট রেকর্ড হয়নি)`}
            </span>
          ))}
          <span className="block text-[11px] text-amber-600">এগুলো অনুমান করে কোনো অ্যাকাউন্টে যোগ করা হয়নি।</span>
        </div>
      ) : null}
      <p className="text-[11px] leading-relaxed text-slate-400">
        খরচ শুধু তখনই দেখায় যখন আপনি নিজে Messaging প্রেরক সেটিংসে rate দিয়ে রেখেছেন — rate না থাকলে খরচের ঘর ফাঁকা থাকে, কোনো দাম অনুমান করা হয় না।
        পেমেন্টের পরিমাণে শুধু যাচাইকৃত (verified_paid) ও live লেনদেন ধরা হয়; sandbox পরীক্ষার লেনদেন বাদ।
      </p>
    </div>
  );
}

export function DeliverabilityPanel() {
  const [data, setData] = useState<DeliverabilityView | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<DeliverabilityView>(`organizations/${orgId}/connections/deliverability`);
      setData(res);
    } catch { /* OWNER/ADMIN-only surface — stays hidden otherwise */ }
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!loaded || !data) return null;
  const { email, metaBusiness } = data;

  return (
    <div className="card space-y-3 p-4">
      <div className="font-semibold text-slate-800">📬 Deliverability <span className="text-xs font-normal text-slate-400">(সংরক্ষিত অবস্থা থেকে — এখানে কোনো live পরীক্ষা চলে না)</span></div>

      <div className="space-y-1.5 text-xs">
        <p className="font-semibold text-slate-700">ইমেইল পাঠানোর ডোমেইন</p>
        {email.configured ? (
          <div className="flex flex-wrap items-center gap-1.5 text-slate-600">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold">{email.domain}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold">SPF: সংরক্ষিত ফল নেই (not recorded)</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold">
              DKIM: {email.dkim.status === "not_checked" ? "Selector দেওয়া নেই — যাচাই হয়নি" : "সংরক্ষিত ফল নেই (not recorded)"}
            </span>
            <span className="text-slate-400">DKIM selector {email.dkimSelectorSet ? "দেওয়া আছে" : "দেওয়া নেই"}</span>
          </div>
        ) : (
          <p className="text-slate-500">নিজের কোনো পাঠানোর ডোমেইন (From address) কনফিগার করা নেই।</p>
        )}
        <p className="text-[11px] leading-relaxed text-slate-400">{email.note}</p>
      </div>

      <div className="space-y-1.5 text-xs">
        <p className="font-semibold text-slate-700">Meta Business verification</p>
        {metaBusiness.length === 0 ? (
          <p className="text-slate-500">
            এখনো কোনো Meta Page/Ad Account-এর provider health আনা হয়নি — অ্যাকাউন্ট কার্ডে "তথ্য আপডেট করুন" চাপলে Meta-র উত্তর এখানে দেখা যাবে।
          </p>
        ) : (
          <ul className="space-y-1">
            {metaBusiness.map((b) => {
              const meta = businessVerificationMeta(b.verificationStatus);
              return (
                <li key={`${b.targetType}:${b.targetId}`} className="flex flex-wrap items-center gap-2 text-slate-600">
                  <span className="font-medium text-slate-700">{b.displayName}</span>
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${meta.cls}`}>{meta.label}</span>
                  {b.businessId ? <span className="text-slate-400">Business ID: {b.businessId}</span> : null}
                  {b.providerHealthAt ? <span className="text-slate-400">আনা হয়েছে: {formatWhen(b.providerHealthAt)}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] leading-relaxed text-slate-400">
          Verification অবস্থা Meta-র নিজের উত্তর থেকে সংরক্ষিত — Meta উত্তর না দিলে "তথ্য নেই" থাকে, অনুমান করা হয় না।
        </p>
      </div>
    </div>
  );
}
