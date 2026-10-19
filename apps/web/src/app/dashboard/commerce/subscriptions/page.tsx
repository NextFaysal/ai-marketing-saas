"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka } from "@/lib/storefront-money";
import { ResponsiveTable } from "@repo/ui";

// EC24c — গ্রাহক সাবস্ক্রিপশন (শুধুমাত্র স্টাফ তৈরি করে; দোকানে
// self-serve সাইনআপ নেই)। নবায়ন হলে sweep একটি COD অর্ডার তৈরি
// করে — কোনো স্বয়ংক্রিয় পেমেন্ট চার্জ হয় না।
// OU12 — তৈরি করার সময় গ্রাহকের অটো-চার্জ সম্মতি রেকর্ড করা
// যায় (পদ্ধতি + সময়সহ), কিন্তু চার্জিং চালু নয়: সম্মতি থাকলেও
// নবায়ন আগের মতোই COD। ব্যাজে সেটাই স্পষ্ট লেখা থাকে।

interface SubscriptionRow {
  id: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  productId: string;
  productName: string | null;
  variantSku: string | null;
  qty: number;
  unitPriceMinor: string;
  discountPercent: number | null;
  status: string;
  nextRunAt: string | null;
  lastOrderId: string | null;
  failureCount: number;
  autoChargeConsentAt?: string | null;
  autoChargeConsentMethod?: string | null;
  autoCharge?: {
    consentGiven: boolean;
    consentAt: string | null;
    method: string | null;
    chargingActive: boolean;
    statusLabel: string;
  } | null;
}

const CONSENT_METHOD_LABEL: Record<string, string> = {
  phone_call: "phoneCall",
  in_person: "inPerson",
  written: "written",
  message: "message",
};
interface CustomerRow { id: string; name: string | null; phone: string | null }
interface ProductRow {
  id: string; name: string;
  subscriptionEnabled?: boolean; subscriptionIntervalDays?: number | null;
}

const STATUS_LABEL: Record<string, string> = {
  active: "active",
  paused: "break",
  cancelled: "cancel",
};

export default function SubscriptionsPage() {
  const { dict, t, locale } = useLocale();
  const [items, setItems] = useState<SubscriptionRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [variantSku, setVariantSku] = useState("");
  const [createdFromOrderId, setCreatedFromOrderId] = useState("");
  // OU12: auto-charge consent capture (record only — no charging).
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentMethod, setConsentMethod] = useState("phone_call");
  const [consentNote, setConsentNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createMsg, setCreateMsg] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError(dict.commerce.noOrganizationSelected); setLoading(false); return; }
    setLoading(true);
    try {
      const [subs, custs, prods] = await Promise.all([
        apiFetch<{ items: SubscriptionRow[] }>(`/organizations/${orgId}/subscriptions`),
        apiFetch<CustomerRow[]>(`/organizations/${orgId}/customers`).catch(() => [] as CustomerRow[]),
        apiFetch<{ items: ProductRow[] }>(`/organizations/${orgId}/products?pageSize=100`).catch(() => ({ items: [] as ProductRow[] })),
      ]);
      setItems(subs.items ?? []);
      setCustomers(custs ?? []);
      setProducts((prods.items ?? []).filter((p) => p.subscriptionEnabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotLoadSubscriptions);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    setCreating(true); setCreateError(""); setCreateMsg("");
    try {
      await apiFetch(`/organizations/${orgId}/subscriptions`, {
        method: "POST",
        body: JSON.stringify({
          customerId,
          productId,
          qty: Math.max(1, parseInt(qty, 10) || 1),
          ...(variantSku.trim() ? { variantSku: variantSku.trim() } : {}),
          ...(createdFromOrderId.trim() ? { createdFromOrderId: createdFromOrderId.trim() } : {}),
          ...(consentGiven ? {
            autoChargeConsentGiven: true,
            autoChargeConsentMethod: consentMethod,
            ...(consentNote.trim() ? { autoChargeConsentNote: consentNote.trim() } : {}),
          } : {}),
        }),
      });
      setCreateMsg(consentGiven
        ? dict.commerce.subscriptionCreatedAutoChargeConsent
        : dict.commerce.subscriptionCreated);
      setVariantSku(""); setCreatedFromOrderId(""); setQty("1");
      setConsentGiven(false); setConsentMethod("phone_call"); setConsentNote("");
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : dict.commerce.couldNotCreate);
    } finally { setCreating(false); }
  }

  // OU12: withdraw a recorded consent (clears the record via the
  // API). Recording later is API-only for now; creation-time
  // capture above is the dashboard flow.
  async function withdrawConsent(id: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusyId(id); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/subscriptions/${id}/auto-charge-consent`, {
        method: "POST",
        body: JSON.stringify({ autoChargeConsentGiven: false }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotWithdrawConsent);
    } finally { setBusyId(""); }
  }

  // OU12: the ONLY claim the UI makes from a consent record —
  // ready, NOT charging. No consent → a plain "none" note.
  const renderAutoChargeBadge = (s: SubscriptionRow) => {
    const consent = s.autoCharge?.consentGiven ?? Boolean(s.autoChargeConsentAt);
    if (!consent) {
      return <span className="block text-xs text-slate-400">{dict.commerce.noAutoChargeConsent}</span>;
    }
    const method = s.autoCharge?.method ?? s.autoChargeConsentMethod;
    return (
      <span className="mt-1 block">
        <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
          {dict.commerce.autoChargeReadyChargingIs}</span>
        <span className="block text-xs text-slate-500">
          {dict.commerce.consent}{method ? (CONSENT_METHOD_LABEL[method] ? dict.commerce[CONSENT_METHOD_LABEL[method] as keyof typeof dict.commerce] : method) : "—"}
          {s.autoCharge?.consentAt || s.autoChargeConsentAt
            ? ` · ${fmtDateTime(locale, new Date((s.autoCharge?.consentAt ?? s.autoChargeConsentAt) as string))}`
            : ""}
        </span>
      </span>
    );
  };

  async function act(id: string, action: "pause" | "resume" | "cancel") {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusyId(id); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/subscriptions/${id}/${action}`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.theTaskCouldNotBe);
    } finally { setBusyId(""); }
  }

  // EB6: row actions shared verbatim between the desktop table and
  // the ResponsiveTable mobile card — same handlers, same order.
  const renderSubActions = (s: SubscriptionRow) => (
    <div className="flex gap-1.5">
      {s.status === "active" ? (
        <button type="button" disabled={busyId === s.id} onClick={() => act(s.id, "pause")} className="inline-flex min-h-[44px] items-center rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 disabled:opacity-50">{dict.commerce.break}</button>
      ) : null}
      {s.status === "paused" ? (
        <button type="button" disabled={busyId === s.id} onClick={() => act(s.id, "resume")} className="inline-flex min-h-[44px] items-center rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800 disabled:opacity-50">{dict.commerce.resume}</button>
      ) : null}
      {s.status !== "cancelled" ? (
        <button type="button" disabled={busyId === s.id} onClick={() => act(s.id, "cancel")} className="inline-flex min-h-[44px] items-center rounded-lg bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800 disabled:opacity-50">{dict.common.cancel}</button>
      ) : null}
      {(s.autoCharge?.consentGiven ?? Boolean(s.autoChargeConsentAt)) && s.status !== "cancelled" ? (
        <button type="button" disabled={busyId === s.id} onClick={() => withdrawConsent(s.id)} className="inline-flex min-h-[44px] items-center rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 disabled:opacity-50">{dict.commerce.withdrawConsent}</button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900">{dict.commerce.customerSubscriptions}</h1>
          <p className="text-sm text-slate-500">{dict.commerce.staffCreateWhenTheTime}</p>
        </div>
        <Link href="/dashboard/commerce" className="text-sm font-semibold text-indigo-700 hover:underline">← Commerce Hub</Link>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}

      <form onSubmit={create} className="space-y-3 rounded-2xl border bg-white p-5">
        <h2 className="text-sm font-bold text-slate-900">{dict.commerce.newSubscription}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block text-xs font-bold text-slate-700">
            {dict.commerce.customer}<select required value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm">
              <option value="">{dict.commerce.select}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name ?? c.id}{c.phone ? ` (${c.phone})` : ""}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-700">
            {dict.commerce.productSubscriptionEnabledOnly}<select required value={productId} onChange={(e) => setProductId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm">
              <option value="">{dict.commerce.select}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.subscriptionIntervalDays ? t("commerce.everyDays", { subscriptionIntervalDays: p.subscriptionIntervalDays }) : ""}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-700">
            {dict.commerce.quantity}<input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm" />
          </label>
          <label className="block text-xs font-bold text-slate-700">
            {dict.commerce.variantSKUOptional}<input value={variantSku} onChange={(e) => setVariantSku(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm" />
          </label>
          <label className="block text-xs font-bold text-slate-700">
            {dict.commerce.sourceOrderIDOptionalPrice}<input value={createdFromOrderId} onChange={(e) => setCreatedFromOrderId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm" />
          </label>
        </div>
        <div className="rounded-xl bg-amber-50 px-3.5 py-3 ring-1 ring-inset ring-amber-100">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm font-medium text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" checked={consentGiven}
              onChange={(e) => setConsentGiven(e.target.checked)} aria-label={dict.commerce.theCustomerHasConsentedTo} />
            <span>
              {dict.commerce.theCustomerHasConsentedTo2}<span className="block text-xs font-normal text-amber-800">
                {dict.commerce.evenIfConsentIsRecorded}</span>
            </span>
          </label>
          {consentGiven ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-bold text-slate-700">
                {dict.commerce.consentMethodRequired}<select value={consentMethod} onChange={(e) => setConsentMethod(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm">
                  <option value="phone_call">{dict.commerce.phoneCall}</option>
                  <option value="in_person">{dict.commerce.inPerson}</option>
                  <option value="written">{dict.commerce.written}</option>
                  <option value="message">{dict.commerce.message}</option>
                </select>
              </label>
              <label className="block text-xs font-bold text-slate-700">
                {dict.commerce.noteOptional}<input value={consentNote} onChange={(e) => setConsentNote(e.target.value)} maxLength={500} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm" placeholder={dict.commerce.eGDateOfThe} />
              </label>
            </div>
          ) : null}
        </div>
        {createError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{createError}</p> : null}
        {createMsg ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{createMsg}</p> : null}
        <button type="submit" disabled={creating} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
          {creating ? dict.commerce.creating : dict.commerce.createSubscription}
        </button>
      </form>

      <ResponsiveTable
        table={
      <div className="overflow-x-auto rounded-2xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-xs text-slate-600">
              <th className="p-3">{dict.commerce.customer}</th>
              <th className="p-3">{dict.commerce.product}</th>
              <th className="p-3">{dict.commerce.quantity}</th>
              <th className="p-3">{dict.commerce.priceSnapshot}</th>
              <th className="p-3">{dict.commerce.nextRenewal}</th>
              <th className="p-3">{dict.commerce.status}</th>
              <th className="p-3">{dict.commerce.failure}</th>
              <th className="p-3">{dict.commerce.task}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="p-4 text-slate-500">{dict.common.loading}</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="p-4 text-slate-500">{dict.commerce.noSubscriptions}</td></tr>
            ) : items.map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="p-3">{s.customerName ?? s.customerId}{s.customerPhone ? <span className="block text-xs text-slate-500">{s.customerPhone}</span> : null}</td>
                <td className="p-3">{s.productName ?? s.productId}{s.variantSku ? <span className="block text-xs text-slate-500">SKU: {s.variantSku}</span> : null}</td>
                <td className="p-3">{s.qty}</td>
                <td className="p-3">{formatMinorTaka(s.unitPriceMinor)}{s.discountPercent ? <span className="block text-xs text-slate-500">{dict.commerce.discount}{s.discountPercent}%</span> : null}</td>
                <td className="p-3">{s.nextRunAt ? fmtDateTime(locale, new Date(s.nextRunAt)) : "—"}</td>
                <td className="p-3">{STATUS_LABEL[s.status] ? dict.commerce[STATUS_LABEL[s.status] as keyof typeof dict.commerce] : s.status}{renderAutoChargeBadge(s)}</td>
                <td className="p-3">{s.failureCount}</td>
                <td className="p-3">
                  {renderSubActions(s)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
        }
        cards={
          loading ? (
            <p className="rounded-2xl border bg-white p-4 text-sm text-slate-500">{dict.common.loading}</p>
          ) : items.length === 0 ? (
            <p className="rounded-2xl border bg-white p-4 text-sm text-slate-500">{dict.commerce.noSubscriptions}</p>
          ) : items.map((s) => (
            <div key={s.id} className="rounded-2xl border bg-white p-3 text-sm shadow-sm">
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.customer}</dt><dd className="text-right">{s.customerName ?? s.customerId}{s.customerPhone ? <span className="block text-xs text-slate-500">{s.customerPhone}</span> : null}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.product}</dt><dd className="text-right">{s.productName ?? s.productId}{s.variantSku ? <span className="block text-xs text-slate-500">SKU: {s.variantSku}</span> : null}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.quantity}</dt><dd className="text-right">{s.qty}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.priceSnapshot}</dt><dd className="text-right">{formatMinorTaka(s.unitPriceMinor)}{s.discountPercent ? <span className="block text-xs text-slate-500">{dict.commerce.discount}{s.discountPercent}%</span> : null}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.nextRenewal}</dt><dd className="text-right">{s.nextRunAt ? fmtDateTime(locale, new Date(s.nextRunAt)) : "—"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.status}</dt><dd className="text-right">{STATUS_LABEL[s.status] ? dict.commerce[STATUS_LABEL[s.status] as keyof typeof dict.commerce] : s.status}{renderAutoChargeBadge(s)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.failure}</dt><dd className="text-right">{s.failureCount}</dd></div>
              </dl>
              <div className="mt-2">{renderSubActions(s)}</div>
            </div>
          ))
        }
      />
    </div>
  );
}
