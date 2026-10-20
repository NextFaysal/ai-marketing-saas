"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDate } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka } from "@/lib/storefront-money";
import { COMMERCE_ICONS } from "@/lib/icons";
import { ResponsiveTable } from "@repo/ui";

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
  const { dict, t, locale } = useLocale();
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
    if (!orgId) { setError(dict.commerce.noOrganizationSelected); setLoading(false); return; }
    setLoading(true);
    const failures: string[] = [];
    const grab = async <T,>(label: string, p: Promise<T>): Promise<T | null> => {
      try { return await p; } catch (e) { failures.push(`${label}: ${e instanceof Error ? e.message : dict.commerce.loadingFailed}`); return null; }
    };
    const [h, a, d, s, ints] = await Promise.all([
      grab("Hub summary", apiFetch<HubSummary>(`/organizations/${orgId}/commerce/hub-summary`)),
      grab(dict.commerce.storeAnalytics, apiFetch<StoresAnalytics>(`/organizations/${orgId}/commerce/analytics/stores?days=30`)),
      grab("Dead stock", apiFetch<{ items: DeadStockItem[] }>(`/organizations/${orgId}/commerce/analytics/dead-stock?days=90&limit=10`)),
      grab(dict.commerce.storeList, apiFetch<Store[]>(`/organizations/${orgId}/stores`)),
      grab(dict.commerce.integrationList, apiFetch<Integration[]>(`/organizations/${orgId}/integrations`)),
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
        <h1 className="page-title">{dict.commerce.commerceHubAllStoresAt}</h1>
        <p className="text-sm text-slate-500">
          {dict.commerce.todaySSalesSyncStatus}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/dashboard/commerce/sync" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.sync className="mr-1 inline h-4 w-4 -translate-y-px" /> Sync Center</Link>
          <Link href="/dashboard/commerce/discounts" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.discounts className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.discountsCoupons2}</Link>
          <Link href="/dashboard/commerce/promotions" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.promotions className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.promotions}</Link>
          <Link href="/dashboard/commerce/bundles" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.bundles className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.bundle}</Link>
          <Link href="/dashboard/commerce/feeds" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.feeds className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.productFeeds}</Link>
          <Link href="/dashboard/commerce/abandoned" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.abandoned className="mr-1 inline h-4 w-4 -translate-y-px" /> Abandoned Carts</Link>
          <Link href="/dashboard/commerce/storefront" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.storefront className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.storefrontShop2}</Link>
          <Link href="/dashboard/commerce/landings" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.landings className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.landingPage}</Link>
          <Link href="/dashboard/commerce/reviews" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.reviews className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.reviewModeration}</Link>
          <Link href="/dashboard/commerce/questions" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.questions className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.productQA}</Link>
          <Link href="/dashboard/commerce/purchasing" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.purchasing className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.purchasing}</Link>
          <Link href="/dashboard/commerce/warehouse" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.warehouse className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.warehouse2}</Link>
          <Link href="/dashboard/commerce/accounting" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.accounting className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.taxAccounting2}</Link>
          <Link href="/dashboard/commerce/reports" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.reports className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.reports}</Link>
          <Link href="/dashboard/commerce/finance" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.finance className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.finance}</Link>
          <Link href="/dashboard/commerce/reconciliation" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.reconciliation className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.cODReconciliation}</Link>
          <Link href="/dashboard/commerce/inventory-intelligence" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.inventoryIntelligence className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.inventoryIntelligence2}</Link>
          <Link href="/dashboard/commerce/subscriptions" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.subscriptions className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.subscriptions}</Link>
          <Link href="/dashboard/commerce/installments" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.installments className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.installments2}</Link>
          <Link href="/dashboard/commerce/affiliates" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.affiliates className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.affiliates}</Link>
          <Link href="/dashboard/commerce/loyalty" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.loyalty className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.loyaltyPoints2}</Link>
          <Link href="/dashboard/commerce/gift-cards" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.giftCards className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.giftCard}</Link>
          <Link href="/dashboard/commerce/quotes" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.quotes className="mr-1 inline h-4 w-4 -translate-y-px" /> {dict.commerce.quotes}</Link>
          <Link href="/dashboard/integrations" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold"><COMMERCE_ICONS.integrations className="mr-1 inline h-4 w-4 -translate-y-px" /> Integrations</Link>
        </div>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : null}

      {hub && !hub.hasCommerceData ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          {dict.commerce.noStoresOrListingsYet}<Link href="/dashboard/integrations" className="font-semibold underline">{dict.commerce.integrationsPage}</Link> {dict.commerce.connectTheFirstStoreFrom}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard href="/dashboard/orders" title={dict.commerce.todaySSalesDhakaTime}>
          {hub ? (
            <>
              <div className="text-3xl font-bold">{formatMinorTaka(hub.today.revenueMinor)}</div>
              <div className="mt-1 text-sm text-slate-500">{dict.commerce.total}{hub.today.orders}{dict.commerce.ordersToday}</div>
              {hub.today.byStore.length > 0 ? (
                <ul className="mt-3 space-y-1 border-t pt-2 text-sm">
                  {hub.today.byStore.map((g) => (
                    <li key={g.storeId ?? "native"} className="flex items-center justify-between gap-2">
                      <span className="text-slate-600">{g.storeName}</span>
                      <span className="font-medium">{formatMinorTaka(g.revenueMinor)} · {g.orders}{dict.commerce.text1ou8}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-slate-500">{dict.commerce.noOrdersYetToday}</p>}
            </>
          ) : <p className="text-sm text-slate-500">—</p>}
        </StatCard>

        <StatCard href="/dashboard/commerce/sync" title={dict.commerce.syncStatus}>
          {hub ? (
            <>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="rounded-lg bg-amber-50 p-2"><div className="text-xl font-bold text-amber-700">{hub.sync.pending}</div><div className="text-[11px] text-slate-500">Pending</div></div>
                <div className="rounded-lg bg-blue-50 p-2"><div className="text-xl font-bold text-blue-700">{hub.sync.processing}</div><div className="text-[11px] text-slate-500">Processing</div></div>
                <div className="rounded-lg bg-red-50 p-2"><div className="text-xl font-bold text-red-700">{hub.sync.failed}</div><div className="text-[11px] text-slate-500">Failed</div></div>
                <div className="rounded-lg bg-red-50 p-2"><div className="text-xl font-bold text-red-700">{hub.sync.dead}</div><div className="text-[11px] text-slate-500">Dead</div></div>
              </div>
              <ul className="mt-3 space-y-1 text-sm text-slate-600">
                <li>{dict.commerce.openConflicts}<span className="font-semibold">{hub.sync.openConflicts}{dict.commerce.text1ou8}</span></li>
                <li>{dict.commerce.failedSyncsInTheLast}<span className="font-semibold">{hub.sync.failedSyncs24h}{dict.commerce.text1ou8}</span></li>
                <li>{dict.commerce.stockDiverged}<span className="font-semibold">{hub.stockDivergedCount}{dict.commerce.listings}</span></li>
              </ul>
            </>
          ) : <p className="text-sm text-slate-500">—</p>}
        </StatCard>

        <StatCard href="/dashboard/orders" title={dict.commerce.unfulfilledOrders}>
          {hub ? (
            <>
              <div className="text-3xl font-bold">{hub.unfulfilledOrders}{dict.commerce.text1ou8}</div>
              <p className="mt-1 text-sm text-slate-500">
                {dict.commerce.areInPendingProcessingOn}{hub.unfulfilledOlderThan48h > 0
                  ? <span className="text-red-600"> {dict.commerce.ofThem}{hub.unfulfilledOlderThan48h}{dict.commerce.areMoreThan48Hours}</span>
                  : dict.commerce.noneAreMoreThan48}
              </p>
            </>
          ) : <p className="text-sm text-slate-500">—</p>}
        </StatCard>

        <StatCard href="/dashboard/products" title={dict.commerce.lowStockAlerts}>
          {hub ? (
            <>
              <div className="text-3xl font-bold">{hub.lowStockCount}{dict.commerce.text1ou8}</div>
              <p className="mt-1 text-sm text-slate-500">{dict.commerce.productsAtOrBelowThe}</p>
            </>
          ) : <p className="text-sm text-slate-500">—</p>}
        </StatCard>

        <StatCard href="/dashboard/commerce/abandoned" title={dict.commerce.abandonedCartValue}>
          {hub ? (
            <>
              <div className="text-3xl font-bold">{formatMinorTaka(hub.abandoned.totalValueMinor)}</div>
              <p className="mt-1 text-sm text-slate-500">
                {dict.commerce.openNotRecoveredCarts}{hub.abandoned.openCount}{dict.commerce.text1ou8}{hub.abandoned.unknownValueCount > 0
                  ? t("commerce.haveUnknownValueNotIncluded", { unknownValueCount: hub.abandoned.unknownValueCount })
                  : ""}।
              </p>
              {Object.keys(hub.abandoned.bySource).length > 0 ? (
                <p className="mt-1 text-xs text-slate-500">
                  {dict.commerce.source2}{Object.entries(hub.abandoned.bySource).map(([s, n]) => t("commerce.text1x3jaz3", { s: s, n: n })).join(" · ")}
                </p>
              ) : null}
            </>
          ) : <p className="text-sm text-slate-500">—</p>}
        </StatCard>

        <StatCard href="/dashboard/commerce/landings" title={dict.commerce.landingPage}>
          <p className="text-sm text-slate-500">
            {dict.commerce.createAFunnelPageFor}</p>
        </StatCard>

        <StatCard href="/dashboard/commerce/loyalty" title={dict.commerce.loyaltyPointsReferralRewards}>
          <p className="text-sm text-slate-500">
            {dict.commerce.earningPointsOnShoppingSpending}</p>
        </StatCard>

        <StatCard href="/dashboard/commerce/gift-cards" title={dict.commerce.giftCard}>
          <p className="text-sm text-slate-500">
            {dict.commerce.giftCardLiabilityManualIssue2}</p>
        </StatCard>

        <StatCard href="/dashboard/commerce/bundles" title={dict.commerce.bundleOffers}>
          <p className="text-sm text-slate-500">
            {dict.commerce.comboPacksOf210}</p>
        </StatCard>

        <StatCard href="/dashboard/commerce/reviews" title={dict.commerce.reviewModeration}>
          <p className="text-sm text-slate-500">
            {dict.commerce.postDeliveryReviewsOfYour}</p>
        </StatCard>

        <div className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">{dict.commerce.perStoreHealthLiveHealth}</div>
            <Link href="/dashboard/integrations" className="text-slate-400" aria-label={dict.commerce.openTheIntegrationsPage}>→</Link>
          </div>
          {!healthChecked ? (
            <p className="mt-3 text-sm text-slate-500">{dict.commerce.healthCheckRunning}</p>
          ) : stores.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">{dict.commerce.noStores}</p>
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
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">{dict.commerce.notChecked}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">{dict.commerce.theBadgeIsTheWorst}</p>
        </div>
      </div>

      <div className="card p-5">
        <div className="font-semibold">{dict.commerce.revenueProfitByStoreLast}{analytics?.days ?? 30} {dict.commerce.days}</div>
        {analytics ? (
          <ResponsiveTable
            className="mt-3"
            table={
              <div>
                <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">{dict.commerce.store}</th>
                  <th className="py-2 pr-3">{dict.commerce.order}</th>
                  <th className="py-2 pr-3">{dict.commerce.revenue2}</th>
                  <th className="py-2 pr-3">{dict.commerce.refundTotal}</th>
                  <th className="py-2 pr-3">COGS</th>
                  <th className="py-2">{dict.commerce.profit}</th>
                </tr>
              </thead>
              <tbody>
                {analytics.stores.map((r) => (
                  <tr key={r.storeId ?? "native"} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{r.storeName}</span>
                      <span className="block text-xs text-slate-500">{r.platform}</span>
                    </td>
                    <td className="py-2 pr-3">{r.ordersCount}{dict.commerce.text1ou8}<span className="text-xs text-slate-500">{dict.commerce.revenue3}{r.revenueOrders}{dict.commerce.text1ge21}</span></td>
                    <td className="py-2 pr-3 font-medium">{formatMinorTaka(r.revenueMinor)}</td>
                    <td className="py-2 pr-3">{formatMinorTaka(r.totalRefundedMinor)}</td>
                    <td className="py-2 pr-3">{formatMinorTaka(r.cogsMinor)}</td>
                    <td className="py-2">
                      {r.profitMinor !== null ? (
                        <span className="font-semibold">{formatMinorTaka(r.profitMinor)}</span>
                      ) : r.cogsCoveragePercent !== null ? (
                        <span className="text-amber-700">{dict.commerce.cOGSIncompleteCoverage}{r.cogsCoveragePercent}%)</span>
                      ) : (
                        <span className="text-slate-500">{dict.commerce.noRevenueOrdersProfitNot}</span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="py-2 pr-3">{dict.commerce.total}</td>
                  <td className="py-2 pr-3">{analytics.totals.ordersCount}{dict.commerce.text1ou8}<span className="text-xs font-normal text-slate-500">{dict.commerce.revenue3}{analytics.totals.revenueOrders}{dict.commerce.text1ge21}</span></td>
                  <td className="py-2 pr-3">{formatMinorTaka(analytics.totals.revenueMinor)}</td>
                  <td className="py-2 pr-3">{formatMinorTaka(analytics.totals.totalRefundedMinor)}</td>
                  <td className="py-2 pr-3">{formatMinorTaka(analytics.totals.cogsMinor)}</td>
                  <td className="py-2">
                    {analytics.totals.profitMinor !== null ? formatMinorTaka(analytics.totals.profitMinor)
                      : analytics.totals.cogsCoveragePercent !== null ? t("commerce.cOGSIncompleteCoverage2", { cogsCoveragePercent: analytics.totals.cogsCoveragePercent })
                      : "—"}
                  </td>
                </tr>
                </tbody>
                </table>
              </div>
            }
            cards={
              <>
                {analytics.stores.map((r) => (
                  <div key={r.storeId ?? "native"} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{r.storeName}</div>
                        <div className="text-xs text-slate-500">{r.platform}</div>
                      </div>
                      <span className="font-medium">{formatMinorTaka(r.revenueMinor)}</span>
                    </div>
                    <dl className="mt-2 space-y-1.5 text-sm">
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.order}</dt>
                        <dd>{r.ordersCount}{dict.commerce.text1ou8}<span className="text-xs text-slate-500">{dict.commerce.revenue3}{r.revenueOrders}{dict.commerce.text1ge21}</span></dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.refundTotal}</dt>
                        <dd>{formatMinorTaka(r.totalRefundedMinor)}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">COGS</dt>
                        <dd>{formatMinorTaka(r.cogsMinor)}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.profit}</dt>
                        <dd>
                          {r.profitMinor !== null ? (
                            <span className="font-semibold">{formatMinorTaka(r.profitMinor)}</span>
                          ) : r.cogsCoveragePercent !== null ? (
                            <span className="text-amber-700">{dict.commerce.cOGSIncompleteCoverage}{r.cogsCoveragePercent}%)</span>
                          ) : (
                            <span className="text-slate-500">{dict.commerce.noRevenueOrdersProfitNot}</span>
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
                <div className="rounded-lg border bg-slate-50 p-3 font-semibold">
                  <div className="flex items-start justify-between gap-2">
                    <span>{dict.commerce.total}</span>
                    <span>{formatMinorTaka(analytics.totals.revenueMinor)}</span>
                  </div>
                  <dl className="mt-2 space-y-1.5 text-sm">
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.order}</dt>
                      <dd>{analytics.totals.ordersCount}{dict.commerce.text1ou8}<span className="text-xs font-normal text-slate-500">{dict.commerce.revenue3}{analytics.totals.revenueOrders}{dict.commerce.text1ge21}</span></dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.refundTotal}</dt>
                      <dd>{formatMinorTaka(analytics.totals.totalRefundedMinor)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">COGS</dt>
                      <dd>{formatMinorTaka(analytics.totals.cogsMinor)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.profit}</dt>
                      <dd>
                        {analytics.totals.profitMinor !== null ? formatMinorTaka(analytics.totals.profitMinor)
                          : analytics.totals.cogsCoveragePercent !== null ? t("commerce.cOGSIncompleteCoverage2", { cogsCoveragePercent: analytics.totals.cogsCoveragePercent })
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </>
            }
          />
        ) : <p className="mt-2 text-sm text-slate-500">{loading ? dict.common.loading : dict.commerce.noInformationFound}</p>}
        <p className="mt-2 text-xs text-slate-500">{dict.commerce.revenueOrderTotalExcludingCancelled}</p>
      </div>

      <div className="card p-5">
        <div className="font-semibold">{dict.commerce.deadStockNotSoldIn}</div>
        <p className="mt-1 text-xs text-slate-500">
          {dict.commerce.productsInStockWithNo}<span className="font-semibold">{dict.commerce.aSignalNotProof}</span> {dict.commerce.theProductMayAlsoBe}</p>
        {deadStock.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{loading ? dict.common.loading : dict.commerce.noDeadStockProductsBy}</p>
        ) : (
          <ResponsiveTable
            className="mt-3"
            table={
              <div>
                <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">{dict.commerce.product}</th>
                  <th className="py-2 pr-3">{dict.commerce.stock}</th>
                  <th className="py-2 pr-3">{dict.commerce.stuckValue}</th>
                  <th className="py-2">{dict.commerce.lastSold}</th>
                </tr>
              </thead>
              <tbody>
                {deadStock.slice(0, 10).map((p) => (
                  <tr key={p.productId} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{p.name}</span>
                      {p.sku ? <span className="block text-xs text-slate-500">SKU: {p.sku}</span> : null}
                    </td>
                    <td className="py-2 pr-3">{p.stockQuantity}{dict.commerce.text1ou8}</td>
                    <td className="py-2 pr-3 font-medium">{formatMinorTaka(p.stockValueMinor)}</td>
                    <td className="py-2 text-slate-600">
                      {p.lastSaleAt
                        ? <>{fmtDate(locale, new Date(p.lastSaleAt))} <span className="text-xs text-slate-500">({p.daysSinceLastSale} {dict.commerce.daysAgo}</span></>
                        : <span className="text-amber-700">{dict.commerce.neverSold}</span>}
                    </td>
                  </tr>
                ))}
                </tbody>
                </table>
              </div>
            }
            cards={deadStock.slice(0, 10).map((p) => (
              <div key={p.productId} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    {p.sku ? <div className="text-xs text-slate-500">SKU: {p.sku}</div> : null}
                  </div>
                  <span className="font-medium">{formatMinorTaka(p.stockValueMinor)}</span>
                </div>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.stock}</dt>
                    <dd>{p.stockQuantity}{dict.commerce.text1ou8}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.lastSold}</dt>
                    <dd className="text-slate-600">
                      {p.lastSaleAt
                        ? <>{fmtDate(locale, new Date(p.lastSaleAt))} <span className="text-xs text-slate-500">({p.daysSinceLastSale} {dict.commerce.daysAgo}</span></>
                        : <span className="text-amber-700">{dict.commerce.neverSold}</span>}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          />
        )}
        <div className="mt-3">
          <Link href="/dashboard/products" className="text-sm font-semibold text-blue-700">{dict.commerce.viewAllProducts}</Link>
        </div>
      </div>
    </div>
  );
}
