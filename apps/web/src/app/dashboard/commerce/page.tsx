"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka } from "@/lib/storefront-money";

// EC11 — Commerce Hub: one glance over every store. Every number on
// this page comes from the commerce analytics endpoints
// (hub-summary / analytics/stores / analytics/dead-stock) or from a
// LIVE per-integration health check. Nothing is estimated: profit
// stays "COGS অসম্পূর্ণ" until coverage is 100%, and a store whose
// health was never checked (or whose check failed) says
// "যাচাই হয়নি" — never a guessed badge.

interface HubByStore { storeId: string | null; storeName: string; orders: number; revenueMinor: string }
interface HubSummary {
  generatedAt: string;
  today: { orders: number; revenueMinor: string; byStore: HubByStore[] };
  sync: { pending: number; processing: number; failed: number; dead: number; openConflicts: number; failedSyncs24h: number };
  unfulfilledOrders: number;
  unfulfilledOlderThan48h: number;
  lowStockCount: number;
  stockDivergedCount: number;
  hasCommerceData: boolean;
  abandoned: { openCount: number; totalValueMinor: string; unknownValueCount: number; bySource: Record<string, number> };
}
interface StoreAnalyticsRow {
  storeId: string | null; storeName: string; platform: string; currency: string | null;
  ordersCount: number; revenueOrders: number; revenueMinor: string;
  totalRefundedMinor: string; cogsMinor: string; cogsKnownOrders: number;
  cogsCoveragePercent: number | null; profitMinor: string | null;
}
interface StoresAnalytics { days: number; stores: StoreAnalyticsRow[]; totals: StoreAnalyticsRow }
interface DeadStockItem {
  productId: string; name: string; sku: string | null; stockQuantity: number;
  stockValueMinor: string; currency: string | null; lastSaleAt: string | null;
  daysSinceLastSale: number | null; soldUnitsInWindow: number;
}
interface Store { id: string; name: string; url?: string; platform?: string }
interface Integration { id: string; provider: string; status: string; store?: { id: string; name: string } | null }
interface HealthCheck { key: string; label: string; status: string; evidence: string }
interface HealthResult { integrationId: string; provider: string; checkedAt: string; overall: "pass" | "warn" | "fail" | "unknown"; checks: HealthCheck[] }

const HEALTH_RANK: Record<string, number> = { pass: 0, unknown: 1, warn: 2, fail: 3 };

function healthBadge(status: string): string {
  switch (status) {
    case "pass": return "bg-green-100 text-green-700";
    case "warn": return "bg-amber-100 text-amber-700";
    case "fail": return "bg-red-100 text-red-700";
    default: return "bg-slate-200 text-slate-600";
  }
}

function StatCard({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="card block p-5 transition hover:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">{title}</div>
        <span className="text-slate-400">→</span>
      </div>
      <div className="mt-3">{children}</div>
    </Link>
  );
}

export default function CommerceHubPage() {
  const [hub, setHub] = useState<HubSummary | null>(null);
  const [analytics, setAnalytics] = useState<StoresAnalytics | null>(null);
  const [deadStock, setDeadStock] = useState<DeadStockItem[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [health, setHealth] = useState<Record<string, HealthResult>>({});
  const [healthChecked, setHealthChecked] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); setLoading(false); return; }
    setLoading(true);
    const failures: string[] = [];
    const grab = async <T,>(label: string, p: Promise<T>): Promise<T | null> => {
      try { return await p; } catch (e) { failures.push(`${label}: ${e instanceof Error ? e.message : "লোড ব্যর্থ"}`); return null; }
    };
    const [h, a, d, s, ints] = await Promise.all([
      grab("Hub summary", apiFetch<HubSummary>(`/organizations/${orgId}/commerce/hub-summary`)),
      grab("স্টোর অ্যানালিটিক্স", apiFetch<StoresAnalytics>(`/organizations/${orgId}/commerce/analytics/stores?days=30`)),
      grab("Dead stock", apiFetch<{ items: DeadStockItem[] }>(`/organizations/${orgId}/commerce/analytics/dead-stock?days=90&limit=10`)),
      grab("স্টোর তালিকা", apiFetch<Store[]>(`/organizations/${orgId}/stores`)),
      grab("ইন্টিগ্রেশন তালিকা", apiFetch<Integration[]>(`/organizations/${orgId}/integrations`)),
    ]);
    if (h) setHub(h);
    if (a) setAnalytics(a);
    if (d) setDeadStock(d.items ?? []);
    if (s) setStores(s);
    if (ints) {
      setIntegrations(ints);
      // Live health per integration — a failed check simply
      // leaves no entry, and the card renders "যাচাই হয়নি".
      const results = await Promise.allSettled(
        ints.map((i) => apiFetch<HealthResult>(`/organizations/${orgId}/integrations/${i.id}/health`)),
      );
      const map: Record<string, HealthResult> = {};
      results.forEach((r, idx) => { if (r.status === "fulfilled") map[ints[idx].id] = r.value; });
      setHealth(map);
      setHealthChecked(true);
    }
    setError(failures.join(" · "));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Worst live-health overall per store (across its integrations).
  const worstHealthByStore = new Map<string, string>();
  for (const i of integrations) {
    const sid = i.store?.id;
    if (!sid) continue;
    const overall = health[i.id]?.overall;
    if (!overall) continue;
    const prev = worstHealthByStore.get(sid);
    if (!prev || HEALTH_RANK[overall] > HEALTH_RANK[prev]) worstHealthByStore.set(sid, overall);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Commerce Hub — সব স্টোর এক নজরে</h1>
        <p className="text-sm text-slate-500">
          আজকের বিক্রি, Sync অবস্থা, ফুলফিলমেন্ট বাকি, কম স্টক আর abandoned মূল্য — সব সংখ্যা সরাসরি
          Commerce Analytics থেকে আসে। লাভ শুধু তখনই দেখানো হয় যখন COGS coverage ১০০% — অসম্পূর্ণ হলে
          সংখ্যা বানিয়ে দেখানো হয় না।
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/dashboard/commerce/sync" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🔄 Sync Center</Link>
          <Link href="/dashboard/commerce/discounts" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🏷️ Discounts / কুপন</Link>
          <Link href="/dashboard/commerce/promotions" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🎁 প্রমোশন</Link>
          <Link href="/dashboard/commerce/bundles" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🧺 বান্ডল</Link>
          <Link href="/dashboard/commerce/feeds" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">📡 প্রোডাক্ট ফিড</Link>
          <Link href="/dashboard/commerce/abandoned" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🛒 Abandoned Carts</Link>
          <Link href="/dashboard/commerce/storefront" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🏪 Storefront / দোকান</Link>
          <Link href="/dashboard/commerce/landings" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🚀 ল্যান্ডিং পেজ</Link>
          <Link href="/dashboard/commerce/reviews" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">⭐ রিভিউ মডারেশন</Link>
          <Link href="/dashboard/commerce/questions" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">❓ পণ্য প্রশ্নোত্তর</Link>
          <Link href="/dashboard/commerce/purchasing" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🧾 ক্রয় / Purchasing</Link>
          <Link href="/dashboard/commerce/warehouse" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🏭 গুদাম / Warehouse</Link>
          <Link href="/dashboard/commerce/accounting" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🧮 কর ও হিসাব / Accounting</Link>
          <Link href="/dashboard/commerce/reconciliation" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">💵 COD মিলকরণ</Link>
          <Link href="/dashboard/commerce/inventory-intelligence" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">📊 ইনভেন্টরি বুদ্ধিমত্তা</Link>
          <Link href="/dashboard/commerce/subscriptions" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🔁 সাবস্ক্রিপশন / Subscriptions</Link>
          <Link href="/dashboard/commerce/installments" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">💰 কিস্তি / Installments</Link>
          <Link href="/dashboard/commerce/affiliates" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🤝 অ্যাফিলিয়েট</Link>
          <Link href="/dashboard/integrations" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🔌 Integrations</Link>
        </div>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}

      {hub && !hub.hasCommerceData ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          এখনো কোনো স্টোর বা Listing নেই — <Link href="/dashboard/integrations" className="font-semibold underline">Integrations পেজ</Link> থেকে প্রথম স্টোরটি কানেক্ট করুন।
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard href="/dashboard/orders" title="আজকের বিক্রি (ঢাকা সময়)">
          {hub ? (
            <>
              <div className="text-3xl font-bold">{formatMinorTaka(hub.today.revenueMinor)}</div>
              <div className="mt-1 text-sm text-slate-500">মোট {hub.today.orders}টি অর্ডার আজ</div>
              {hub.today.byStore.length > 0 ? (
                <ul className="mt-3 space-y-1 border-t pt-2 text-sm">
                  {hub.today.byStore.map((g) => (
                    <li key={g.storeId ?? "native"} className="flex items-center justify-between gap-2">
                      <span className="text-slate-600">{g.storeName}</span>
                      <span className="font-medium">{formatMinorTaka(g.revenueMinor)} · {g.orders}টি</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-slate-500">আজ এখনো কোনো অর্ডার আসেনি।</p>}
            </>
          ) : <p className="text-sm text-slate-500">—</p>}
        </StatCard>

        <StatCard href="/dashboard/commerce/sync" title="Sync অবস্থা">
          {hub ? (
            <>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="rounded-lg bg-amber-50 p-2"><div className="text-xl font-bold text-amber-700">{hub.sync.pending}</div><div className="text-[11px] text-slate-500">Pending</div></div>
                <div className="rounded-lg bg-blue-50 p-2"><div className="text-xl font-bold text-blue-700">{hub.sync.processing}</div><div className="text-[11px] text-slate-500">Processing</div></div>
                <div className="rounded-lg bg-red-50 p-2"><div className="text-xl font-bold text-red-700">{hub.sync.failed}</div><div className="text-[11px] text-slate-500">Failed</div></div>
                <div className="rounded-lg bg-red-50 p-2"><div className="text-xl font-bold text-red-700">{hub.sync.dead}</div><div className="text-[11px] text-slate-500">Dead</div></div>
              </div>
              <ul className="mt-3 space-y-1 text-sm text-slate-600">
                <li>খোলা Conflict: <span className="font-semibold">{hub.sync.openConflicts}টি</span></li>
                <li>শেষ ২৪ ঘণ্টায় ব্যর্থ Sync: <span className="font-semibold">{hub.sync.failedSyncs24h}টি</span></li>
                <li>স্টক মিলছে না (diverged): <span className="font-semibold">{hub.stockDivergedCount}টি Listing</span></li>
              </ul>
            </>
          ) : <p className="text-sm text-slate-500">—</p>}
        </StatCard>

        <StatCard href="/dashboard/orders" title="Unfulfilled অর্ডার">
          {hub ? (
            <>
              <div className="text-3xl font-bold">{hub.unfulfilledOrders}টি</div>
              <p className="mt-1 text-sm text-slate-500">
                pending / processing / on-hold অবস্থায় আছে।
                {hub.unfulfilledOlderThan48h > 0
                  ? <span className="text-red-600"> এর মধ্যে {hub.unfulfilledOlderThan48h}টি ৪৮ ঘণ্টার বেশি পুরনো!</span>
                  : " কোনোটিই ৪৮ ঘণ্টার বেশি পুরনো নয়।"}
              </p>
            </>
          ) : <p className="text-sm text-slate-500">—</p>}
        </StatCard>

        <StatCard href="/dashboard/products" title="Low Stock সতর্কতা">
          {hub ? (
            <>
              <div className="text-3xl font-bold">{hub.lowStockCount}টি</div>
              <p className="mt-1 text-sm text-slate-500">পণ্যের স্টক threshold-এর নিচে বা সমান (ডিফল্ট threshold ৫)।</p>
            </>
          ) : <p className="text-sm text-slate-500">—</p>}
        </StatCard>

        <StatCard href="/dashboard/commerce/abandoned" title="Abandoned কার্টের মূল্য">
          {hub ? (
            <>
              <div className="text-3xl font-bold">{formatMinorTaka(hub.abandoned.totalValueMinor)}</div>
              <p className="mt-1 text-sm text-slate-500">
                খোলা (recovered নয়) কার্ট {hub.abandoned.openCount}টি
                {hub.abandoned.unknownValueCount > 0
                  ? ` · ${hub.abandoned.unknownValueCount}টির মূল্য জানা নেই, সেগুলো এই মোটে নেই`
                  : ""}।
              </p>
              {Object.keys(hub.abandoned.bySource).length > 0 ? (
                <p className="mt-1 text-xs text-slate-400">
                  উৎস: {Object.entries(hub.abandoned.bySource).map(([s, n]) => `${s} ${n}টি`).join(" · ")}
                </p>
              ) : null}
            </>
          ) : <p className="text-sm text-slate-500">—</p>}
        </StatCard>

        <StatCard href="/dashboard/commerce/landings" title="ল্যান্ডিং পেজ">
          <p className="text-sm text-slate-500">
            এক পণ্যের ফানেল পেজ তৈরি করুন — সেকশন সাজানো, A/B ভ্যারিয়েন্ট, পোস্ট-অর্ডার আপসেল আর
            ভিউ→অর্ডার কনভার্সন পরিসংখ্যানসহ।
          </p>
        </StatCard>

        <StatCard href="/dashboard/commerce/bundles" title="বান্ডল অফার">
          <p className="text-sm text-slate-500">
            ২–১০টি পণ্যের কম্বো প্যাক একটি বান্ডল দামে — দোকানের হোম পেজের বান্ডল স্ট্রিপ থেকে
            ক্রেতা এক ক্লিকে কার্টে যোগ করতে পারে।
          </p>
        </StatCard>

        <StatCard href="/dashboard/commerce/reviews" title="রিভিউ মডারেশন">
          <p className="text-sm text-slate-500">
            নিজের দোকানের ডেলিভারি-পরবর্তী রিভিউ আর WooCommerce/Shopify থেকে টানা রিভিউ এক জায়গায় —
            লুকান/দেখান ও নিজের দোকানের রিভিউতে উত্তর দিন।
          </p>
        </StatCard>

        <div className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">প্রতি স্টোরের স্বাস্থ্য (Live Health)</div>
            <Link href="/dashboard/integrations" className="text-slate-400">→</Link>
          </div>
          {!healthChecked ? (
            <p className="mt-3 text-sm text-slate-500">Health যাচাই চলছে…</p>
          ) : stores.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">কোনো স্টোর নেই।</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {stores.map((s) => {
                const overall = worstHealthByStore.get(s.id);
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">{s.name}</span>
                      {s.platform ? <span className="text-slate-400"> ({s.platform})</span> : null}
                    </span>
                    {overall ? (
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${healthBadge(overall)}`}>{overall}</span>
                    ) : (
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">যাচাই হয়নি</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-400">ব্যাজটি পেজ লোডের সময় চালানো আসল Health check-এর সবচেয়ে খারাপ ফল — যাচাই ব্যর্থ হলে অনুমান করা হয় না।</p>
        </div>
      </div>

      <div className="card p-5">
        <div className="font-semibold">স্টোর অনুযায়ী রেভিনিউ ও লাভ — শেষ {analytics?.days ?? 30} দিন</div>
        {analytics ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">স্টোর</th>
                  <th className="py-2 pr-3">অর্ডার</th>
                  <th className="py-2 pr-3">রেভিনিউ</th>
                  <th className="py-2 pr-3">Refund (মোট)</th>
                  <th className="py-2 pr-3">COGS</th>
                  <th className="py-2">লাভ</th>
                </tr>
              </thead>
              <tbody>
                {analytics.stores.map((r) => (
                  <tr key={r.storeId ?? "native"} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{r.storeName}</span>
                      <span className="block text-xs text-slate-400">{r.platform}</span>
                    </td>
                    <td className="py-2 pr-3">{r.ordersCount}টি <span className="text-xs text-slate-400">(রেভিনিউ {r.revenueOrders}টি)</span></td>
                    <td className="py-2 pr-3 font-medium">{formatMinorTaka(r.revenueMinor)}</td>
                    <td className="py-2 pr-3">{formatMinorTaka(r.totalRefundedMinor)}</td>
                    <td className="py-2 pr-3">{formatMinorTaka(r.cogsMinor)}</td>
                    <td className="py-2">
                      {r.profitMinor !== null ? (
                        <span className="font-semibold">{formatMinorTaka(r.profitMinor)}</span>
                      ) : r.cogsCoveragePercent !== null ? (
                        <span className="text-amber-700">COGS অসম্পূর্ণ (coverage {r.cogsCoveragePercent}%)</span>
                      ) : (
                        <span className="text-slate-500">রেভিনিউ অর্ডার নেই — লাভ প্রযোজ্য নয়</span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="py-2 pr-3">মোট</td>
                  <td className="py-2 pr-3">{analytics.totals.ordersCount}টি <span className="text-xs font-normal text-slate-400">(রেভিনিউ {analytics.totals.revenueOrders}টি)</span></td>
                  <td className="py-2 pr-3">{formatMinorTaka(analytics.totals.revenueMinor)}</td>
                  <td className="py-2 pr-3">{formatMinorTaka(analytics.totals.totalRefundedMinor)}</td>
                  <td className="py-2 pr-3">{formatMinorTaka(analytics.totals.cogsMinor)}</td>
                  <td className="py-2">
                    {analytics.totals.profitMinor !== null ? formatMinorTaka(analytics.totals.profitMinor)
                      : analytics.totals.cogsCoveragePercent !== null ? `COGS অসম্পূর্ণ (coverage ${analytics.totals.cogsCoveragePercent}%)`
                      : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : <p className="mt-2 text-sm text-slate-500">{loading ? "লোড হচ্ছে…" : "তথ্য পাওয়া যায়নি।"}</p>}
        <p className="mt-2 text-xs text-slate-400">রেভিনিউ = cancelled/refunded/failed বাদে অর্ডারের মোট (effective date = placedAt ?? createdAt, ঢাকা দিন)। লাভ = রেভিনিউ − refund − COGS, শুধু ১০০% COGS coverage-এ।</p>
      </div>

      <div className="card p-5">
        <div className="font-semibold">Dead Stock — শেষ ৯০ দিনে বিক্রি হয়নি</div>
        <p className="mt-1 text-xs text-slate-500">
          স্টকে থাকা পণ্য যেগুলোর শেষ ৯০ দিনে কোনো বিক্রি নেই। এটি একটি <span className="font-semibold">সংকেত, প্রমাণ নয়</span> —
          পণ্যটি সিজনাল বা সাময়িক বন্ধও হতে পারে; সিদ্ধান্তের আগে যাচাই করুন।
        </p>
        {deadStock.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{loading ? "লোড হচ্ছে…" : "এই সংজ্ঞায় কোনো Dead Stock পণ্য নেই।"}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">পণ্য</th>
                  <th className="py-2 pr-3">স্টক</th>
                  <th className="py-2 pr-3">আটকে থাকা মূল্য</th>
                  <th className="py-2">শেষ বিক্রি</th>
                </tr>
              </thead>
              <tbody>
                {deadStock.slice(0, 10).map((p) => (
                  <tr key={p.productId} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{p.name}</span>
                      {p.sku ? <span className="block text-xs text-slate-400">SKU: {p.sku}</span> : null}
                    </td>
                    <td className="py-2 pr-3">{p.stockQuantity}টি</td>
                    <td className="py-2 pr-3 font-medium">{formatMinorTaka(p.stockValueMinor)}</td>
                    <td className="py-2 text-slate-600">
                      {p.lastSaleAt
                        ? <>{new Date(p.lastSaleAt).toLocaleDateString()} <span className="text-xs text-slate-400">({p.daysSinceLastSale} দিন আগে)</span></>
                        : <span className="text-amber-700">কখনো বিক্রি হয়নি</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3">
          <Link href="/dashboard/products" className="text-sm font-semibold text-blue-700">সব পণ্য দেখুন →</Link>
        </div>
      </div>
    </div>
  );
}
