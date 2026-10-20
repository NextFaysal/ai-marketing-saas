"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, publicApiBase } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { fmtDateTime, fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { EmptyState, KpiCard } from "@repo/ui";

interface Store { id: string; name: string; url: string; trackingKey?: string | null }
interface Report {
  model: string; windowDays: number;
  totals: { orders: number; ordersRevenueMinor: string; attributedRevenueMinor: string; unattributedRevenueMinor: string; ordersWithoutCredits: number };
  byChannel: { source: string; campaign: string | null; revenueMinor: string; orders: number }[];
  reconciliation: { trackedPurchaseEvents: number; purchaseEventsWithoutMatchingOrder: number; uncreditedRevenueMinor: string; note: string };
}

interface AbandonedCart {
  visitorId: string; sessionKey: string; storeId: string;
  signal: "checkout_started" | "add_to_cart";
  lastActivityAt: string;
  items: { productId: string | null; name: string | null; quantity: number | null }[];
  valueMinor: string | null; currency: string | null;
  storeName: string | null; storeUrl: string | null;
  contact: { email: string | null; phone: string | null };
  recoverySentAt: string | null;
}

const MODELS = [
  { value: "LAST_TOUCH", label: "Last Touch" },
  { value: "FIRST_TOUCH", label: "First Touch" },
  { value: "LAST_NON_DIRECT", label: "Last Non-Direct" },
  { value: "LINEAR", label: "Linear" },
];

export default function AttributionPage() {
  const { t, locale } = useLocale();
  const [stores, setStores] = useState<Store[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [model, setModel] = useState("LAST_TOUCH");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError(t("ads.attrNoOrg")); setLoading(false); return; }
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        apiFetch<Store[]>(`/organizations/${orgId}/stores`),
        apiFetch<Report>(`/organizations/${orgId}/attribution/report?model=${model}`),
      ]);
      setStores(s); setReport(r); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, [model]);

  useEffect(() => { load(); }, [load]);

  // S4: abandoned carts — its own state slice; a failure here must not
  // break the attribution report above.
  const [carts, setCarts] = useState<AbandonedCart[] | null>(null);
  const [cartError, setCartError] = useState("");
  const [recoverError, setRecoverError] = useState("");
  const [sendingId, setSendingId] = useState("");

  const loadCarts = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<{ carts: AbandonedCart[] }>(`/organizations/${orgId}/tracking/abandoned-carts`);
      setCarts(res.carts); setCartError("");
    } catch (e) { setCartError(e instanceof Error ? e.message : t("ads.attrCartLoadError")); }
  }, []);

  useEffect(() => { loadCarts(); }, [loadCarts]);

  async function sendRecovery(visitorId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setSendingId(visitorId); setRecoverError("");
    try {
      await apiFetch(`/organizations/${orgId}/tracking/abandoned-carts/${visitorId}/recover`, { method: "POST" });
      await loadCarts();
    } catch (e) { setRecoverError(e instanceof Error ? e.message : t("ads.attrRecoverError")); }
    finally { setSendingId(""); }
  }

  async function reconcile() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setNotice("");
    try {
      const res = await apiFetch<{ checked: number; computed: number; noTrackingEvidence: number }>(
        `/organizations/${orgId}/attribution/reconcile`, { method: "POST" });
      setNotice(t("ads.attrReconciled", { checked: fmtNumber(locale, res.checked), computed: fmtNumber(locale, res.computed), noEvidence: fmtNumber(locale, res.noTrackingEvidence) }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Reconcile failed"); }
  }

  const webOrigin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Attribution</h1>
        <p className="text-sm text-slate-500">{t("ads.attrIntro", { days: fmtNumber(locale, report?.windowDays ?? 30) })}</p>
        <label className="mt-2 block text-sm">{t("ads.attrWindowLabel")}
          <select className="input ml-2 w-32" value={report?.windowDays ?? 30} onChange={async (e) => {
            const orgId = getOrganizationId(); if (!orgId) return;
            try {
              await apiFetch(`/organizations/${orgId}/attribution/settings`, { method: "PATCH", body: JSON.stringify({ windowDays: Number(e.target.value) }) });
              setNotice(t("ads.attrWindowChanged"));
              await load();
            } catch (err) { setError(err instanceof Error ? err.message : "Window update failed"); }
          }}>
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{t("ads.attrDaysSuffix", { days: fmtNumber(locale, d) })}</option>)}
          </select>
        </label>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="card p-5">
        <div className="font-semibold">{t("ads.attrScriptTitle")}</div>
        <p className="mt-1 text-sm text-slate-500">{t("ads.attrScriptIntro")}</p>
        {stores.length === 0 ? <p className="mt-2 text-sm text-slate-500">{t("ads.attrAddStoreFirst")}</p> : stores.map((s) => (
          <div key={s.id} className="mt-3">
            <div className="text-sm font-medium">{s.name}</div>
            <pre className="mt-1 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-green-300">{`<script async src="${webOrigin}/tracker.js" data-key="${s.trackingKey ?? t("ads.attrKeyMissing")}" data-api="${publicApiBase()}"></script>`}</pre>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm">{t("ads.attrModel")}
          <select className="ml-2 rounded-lg border bg-white px-3 py-2" value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <button className="btn-primary" onClick={reconcile}>{t("ads.attrReconcile")}</button>
      </div>

      {loading ? <p className="text-sm text-slate-500">{t("ads.attrLoading")}</p> : report ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label={t("ads.attrTotalRevenue")} value={fmtMoneyMinor(locale, BigInt(report.totals.ordersRevenueMinor))} hint={t("ads.attrTotalRevenueHint", { count: fmtNumber(locale, report.totals.orders) })} />
            <KpiCard label={t("ads.attrAttributedRevenue")} value={fmtMoneyMinor(locale, BigInt(report.totals.attributedRevenueMinor))} hint={t("ads.attrAttributedHint", { model })} />
            <KpiCard label={t("ads.attrUnattributedRevenue")} value={fmtMoneyMinor(locale, BigInt(report.totals.unattributedRevenueMinor))} hint={t("ads.attrUnattributedHint", { count: fmtNumber(locale, report.totals.ordersWithoutCredits) })} />
            <KpiCard label={t("ads.attrTrackedEvents")} value={fmtNumber(locale, report.reconciliation.trackedPurchaseEvents)} hint={t("ads.attrTrackedEventsHint", { count: fmtNumber(locale, report.reconciliation.purchaseEventsWithoutMatchingOrder) })} />
          </div>
          {report.byChannel.length === 0 ? (
            <EmptyState title={t("ads.attrNoCreditsTitle")} description={t("ads.attrNoCreditsDesc")} />
          ) : (
            <div className="overflow-hidden card">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500"><tr>
                  <th className="px-4 py-3">Source</th><th className="px-4 py-3">Campaign</th><th className="px-4 py-3">{t("ads.attrOrders")}</th><th className="px-4 py-3">Revenue</th>
                </tr></thead>
                <tbody>
                  {report.byChannel.map((c, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-4 py-3 font-medium">{c.source === "unattributed" ? <span className="text-slate-400">{t("ads.attrUnattributedNoProof")}</span> : c.source}</td>
                      <td className="px-4 py-3">{c.campaign ?? "—"}</td>
                      <td className="px-4 py-3">{fmtNumber(locale, c.orders)}</td>
                      <td className="px-4 py-3">{fmtMoneyMinor(locale, BigInt(c.revenueMinor))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-400">{report.reconciliation.note} {t("ads.attrReconcileNoteSuffix")}</p>
        </>
      ) : null}

      <div className="card p-5">
        <h2 className="font-semibold">{t("ads.attrCartsTitle")}</h2>
        <p className="mt-1 text-sm text-slate-500">{t("ads.attrCartsIntro")}</p>
        <p className="mt-1 text-sm text-slate-500">{t("ads.attrCartsIdentifyHint")}</p>
        {cartError ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{cartError}</p> : null}
        {recoverError ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{recoverError}</p> : null}
        {carts === null ? (
          <p className="mt-3 text-sm text-slate-500">{t("ads.attrLoading")}</p>
        ) : carts.length === 0 ? (
          <div className="mt-3">
            <EmptyState title={t("ads.attrNoCartsTitle")} description={t("ads.attrNoCartsDesc")} />
          </div>
        ) : (
          <div className="mt-2">
            {carts.map((c) => (
              <div key={`${c.visitorId}-${c.sessionKey}`} className="border-t py-3 first:border-t-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.storeName ?? t("ads.attrUnknownStore")}</span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                    {c.signal === "checkout_started" ? t("ads.attrSignalCheckout") : t("ads.attrSignalCart")}
                  </span>
                  <span className="text-xs text-slate-400">{t("ads.attrLastActivity", { when: fmtDateTime(locale, new Date(c.lastActivityAt)) })}</span>
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {c.items.length > 0 ? (
                    <ul className="list-inside list-disc">
                      {c.items.map((item, i) => (
                        <li key={i}>{item.name ?? item.productId}{item.quantity ? ` ×${item.quantity}` : ""}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-slate-400">{t("ads.attrNoItemDetails")}</span>
                  )}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {t("ads.attrValue", { value: c.valueMinor ? fmtMoneyMinor(locale, BigInt(c.valueMinor)) : t("ads.attrValueUnknown") })}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {t("ads.attrContact", { contact: c.contact.email || c.contact.phone ? [c.contact.email, c.contact.phone].filter(Boolean).join(" · ") : t("ads.attrNoContact") })}
                </div>
                <div className="mt-2">
                  {c.recoverySentAt ? (
                    <span className="text-sm text-green-700">{t("ads.attrRecoverySent", { when: fmtDateTime(locale, new Date(c.recoverySentAt)) })}</span>
                  ) : c.contact.email ? (
                    <button className="btn-primary" disabled={sendingId === c.visitorId} onClick={() => sendRecovery(c.visitorId)}>
                      {sendingId === c.visitorId ? t("ads.attrSending") : t("ads.attrSendRecovery")}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
