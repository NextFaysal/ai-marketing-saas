"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

/**
 * ORG6 (Organization Next OB2): standalone "ব্যবহার ও সীমা" —
 * the usage picture that used to live only inside the billing
 * page, on its own page so it can be watched without the
 * payment surfaces around it.
 *
 * NO new backend: every number comes from endpoints that
 * already exist —
 *   GET /organizations/:id/billing        (OWNER/ADMIN: plan,
 *     effective limits, usage counters, GC22 resource usage)
 *   GET /organizations/:id/members/usage  (any member: the seat
 *     picture incl. pending invitations, which HOLD seats)
 *   GET /organizations/:id/storage-usage  (any member: recorded
 *     storage from the MediaAsset registry)
 * When the billing payload is unavailable to the caller (not
 * OWNER/ADMIN) the page degrades to the member-level figures
 * and says so — it never invents a limit.
 *
 * Honesty note (same as the billing page): the broadcast cap
 * is a PER-SEND recipient cap, not a monthly quota, so the
 * 30-day broadcast count is shown as a plain count, no bar.
 */

interface BillingPayload {
  subscription: { plan: string; status: string } | null;
  limits: { aiDaily: number; broadcastCap: number; seats: number | null; plan: string };
  usage: { seatsUsed: number; aiCallsToday: number; broadcasts30d: number };
  resourceUsage?: {
    products: { used: number; limit: number | null };
    ordersThisMonth: { used: number; limit: number | null };
    storage: { usedBytes: string; assetCount: number; limitMb: number | null };
    apiToday: { used: number; limit: number | null };
  };
}

interface SeatUsage {
  limit: number | null;
  activeMembers: number;
  suspendedMembers: number;
  pendingInvites: number;
  available: number | null;
}

interface StorageUsage {
  storageBytes: string;
  assetCount: number;
  meteredFrom?: string;
}

function bn(n: number): string {
  return n.toLocaleString("bn-BD");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "০ বাইট";
  const units = ["বাইট", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString("bn-BD", { maximumFractionDigits: 2 })} ${units[i]}`;
}

function Meter({ label, used, limit, detail }: { label: string; used: number; limit: number | null; detail?: string }) {
  const pct = limit !== null && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null;
  const tone = pct === null ? "" : pct >= 100 ? "meter-fill-danger" : pct >= 80 ? "meter-fill-warn" : "meter-fill-ok";
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-slate-700">{label}</div>
        <div className="text-sm text-slate-500">
          <b className="text-base text-slate-900">{bn(used)}</b>
          {limit === null ? " · সীমাহীন" : ` / ${bn(limit)}`}
          {pct !== null ? <span className="ml-1.5 text-xs text-slate-400">({bn(pct)}%)</span> : null}
        </div>
      </div>
      {pct !== null ? (
        <div className="meter mt-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <div className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {detail ? <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{detail}</p> : null}
    </div>
  );
}

export default function UsagePage() {
  const [billing, setBilling] = useState<BillingPayload | null>(null);
  const [billingBlocked, setBillingBlocked] = useState(false);
  const [seats, setSeats] = useState<SeatUsage | null>(null);
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setLoading(false); setError("কোনো Organization নির্বাচন করা হয়নি।"); return; }
    setLoading(true);
    const [b, s, st] = await Promise.allSettled([
      apiFetch<BillingPayload>(`/organizations/${orgId}/billing`),
      apiFetch<SeatUsage>(`/organizations/${orgId}/members/usage`),
      apiFetch<StorageUsage>(`/organizations/${orgId}/storage-usage`),
    ]);
    if (b.status === "fulfilled") setBilling(b.value); else setBillingBlocked(true);
    if (s.status === "fulfilled") setSeats(s.value);
    if (st.status === "fulfilled") setStorage(st.value);
    if (b.status === "rejected" && s.status === "rejected" && st.status === "rejected") {
      setError("ব্যবহারের তথ্য লোড করা যায়নি — একটু পরে আবার চেষ্টা করুন।");
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const seatLimit = seats?.limit ?? billing?.limits.seats ?? null;
  const seatUsed = seats ? seats.activeMembers + seats.pendingInvites : (billing?.usage.seatsUsed ?? 0);
  const storageBytes = billing?.resourceUsage ? Number(billing.resourceUsage.storage.usedBytes) : (storage ? Number(storage.storageBytes) : 0);
  const storageLimitMb = billing?.resourceUsage?.storage.limitMb ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">ব্যবহার ও সীমা</h1>
          <p className="page-sub mt-1">
            এই Organization-এর আসল ব্যবহার বনাম প্ল্যানের সীমা — পেমেন্ট ছাড়াই এক নজরে।
            {billing?.subscription ? <> বর্তমান প্ল্যান: <b>{billing.subscription.plan}</b> ({billing.subscription.status})।</> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/settings" className="btn-secondary btn-sm min-h-[40px]">← Settings</Link>
          <Link href="/dashboard/billing" className="btn-secondary btn-sm min-h-[40px]">সাবস্ক্রিপশন ও বিলিং →</Link>
        </div>
      </div>

      {error ? <div className="alert alert-red"><span>⚠️</span><span>{error}</span></div> : null}
      {billingBlocked ? (
        <div className="alert alert-amber">
          <span>ℹ️</span>
          <span>প্ল্যানের সীমার বিস্তারিত (Billing তথ্য) শুধু মালিক (OWNER) ও অ্যাডমিন (ADMIN) দেখতে পারেন — নিচে সদস্য-স্তরের আসল সংখ্যাগুলো দেখানো হলো।</span>
        </div>
      ) : null}
      {loading ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : null}

      {!loading && (seats || billing) ? (
        <section className="card p-5">
          <h2 className="section-title">টিম সিট</h2>
          <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2">
            <Meter
              label="ব্যবহৃত সিট (সক্রিয় সদস্য + পেন্ডিং আমন্ত্রণ)"
              used={seatUsed}
              limit={seatLimit}
              detail={seats ? `সক্রিয় সদস্য ${bn(seats.activeMembers)} জন · পেন্ডিং আমন্ত্রণ ${bn(seats.pendingInvites)}টি · স্থগিত সদস্য ${bn(seats.suspendedMembers)} জন (স্থগিতরা সিট নেয় না)${seats.available !== null ? ` · আর ${bn(seats.available)}টি সিট খালি আছে` : ""}` : undefined}
            />
            <p className="text-xs leading-relaxed text-slate-400">
              আমন্ত্রণ পাঠালেই সেই সিটটি <b className="text-slate-600">সংরক্ষিত</b> হয়ে যায় — আমন্ত্রিত ব্যক্তি যোগ না দিলেও সিট খালি দেখায় না।
              আমন্ত্রণের মেয়াদ শেষ হলে বা প্রত্যাহার করলে সিট ফিরে আসে। হিসাবটা Team পেজের সিট-চিত্রের সঙ্গেই মিলিয়ে করা।
            </p>
          </div>
        </section>
      ) : null}

      {!loading && billing ? (
        <section className="card p-5">
          <h2 className="section-title">AI, ব্রডকাস্ট ও রিসোর্স</h2>
          <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-3">
            <Meter label="আজকের AI ব্যবহার" used={billing.usage.aiCallsToday} limit={billing.limits.aiDaily} detail="প্রতিদিনের সীমা — রাত ১২টায় আবার শুরু হয়।" />
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-medium text-slate-700">ব্রডকাস্ট (৩০ দিন)</div>
                <div className="text-sm text-slate-500"><b className="text-base text-slate-900">{bn(billing.usage.broadcasts30d)}</b>টি পাঠানো হয়েছে</div>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                ব্রডকাস্টের সীমা মাসিক কোটা নয় — প্রতি পাঠানোতে সর্বোচ্চ <b className="text-slate-600">{bn(billing.limits.broadcastCap)} জন</b> করে পাঠানো যায়, তাই এখানে শতাংশের বার দেখানো হয় না।
              </p>
            </div>
            {billing.resourceUsage ? (
              <Meter label="আজকের API কল (Merchant API)" used={billing.resourceUsage.apiToday.used} limit={billing.resourceUsage.apiToday.limit} />
            ) : null}
          </div>
          {billing.resourceUsage ? (
            <div className="mt-6 grid gap-x-8 gap-y-5 border-t border-slate-100 pt-5 md:grid-cols-3">
              <Meter label="পণ্য" used={billing.resourceUsage.products.used} limit={billing.resourceUsage.products.limit} />
              <Meter label="এই মাসের অর্ডার" used={billing.resourceUsage.ordersThisMonth.used} limit={billing.resourceUsage.ordersThisMonth.limit} />
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-medium text-slate-700">স্টোরেজ (মিডিয়া)</div>
                  <div className="text-sm text-slate-500">
                    <b className="text-base text-slate-900">{formatBytes(storageBytes)}</b>
                    {storageLimitMb === null ? " · সীমাহীন" : ` / ${bn(storageLimitMb)} MB`}
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  আপলোড করা মিডিয়া ফাইলের মোট আকার ({bn(billing.resourceUsage.storage.assetCount)}টি ফাইল) — Media Library-র রেকর্ড থেকে গণনা করা।
                </p>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {!loading && !billing && storage ? (
        <section className="card p-5">
          <h2 className="section-title">স্টোরেজ (মিডিয়া)</h2>
          <p className="mt-3 text-sm text-slate-600">
            ব্যবহৃত: <b>{formatBytes(Number(storage.storageBytes))}</b> · {bn(storage.assetCount)}টি ফাইল (Media Library-র রেকর্ড থেকে)।
          </p>
        </section>
      ) : null}

      <p className="text-xs leading-relaxed text-slate-400">
        প্ল্যান বদলানো, পেমেন্ট ও সাবস্ক্রিপশনের বাকি সবকিছু <Link href="/dashboard/billing" className="font-semibold text-indigo-700 hover:underline">সাবস্ক্রিপশন ও বিলিং</Link> পেজে।
      </p>
    </div>
  );
}
