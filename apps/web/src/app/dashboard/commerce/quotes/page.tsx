"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDate, fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useConfirm, useToast } from "@repo/ui/client";
import { ResponsiveTable } from "@repo/ui";
import { formatMinorTaka, minorToTakaString, takaToMinorString } from "@/lib/storefront-money";

// AB5 (AX7) — staff quotes dashboard. A quote is an OFFER
// document: line prices are snapshots typed/confirmed here,
// totals are Σ lines + delivery (no tax/promotion math — the
// API computes totalMinor the same way). Sending returns the
// public link + the honest sentVia outcome; conversion goes
// through the ORDERS surface (POST orders/from-quote/:id/convert)
// and is gated on a loaded convert-preview.

interface QuoteLine {
  productId: string; variantId?: string | null;
  name: string; variantName?: string | null; sku?: string | null;
  qty: number; unitPriceMinor: string; lineTotalMinor: string;
}
interface Quote {
  id: string; number: string; status: string;
  customerId?: string | null; walkinName?: string | null; walkinPhone?: string | null;
  lines: QuoteLine[]; deliveryChargeMinor: string; totalMinor: string;
  note?: string | null; expiresAt?: string | null;
  sentAt?: string | null; sentVia?: string | null; respondedAt?: string | null;
  convertedOrderId?: string | null; createdAt?: string | null;
}
interface CustomerOpt { id: string; name?: string | null; phone?: string | null; email?: string | null }
interface ProductOpt { id: string; name: string; priceMinor: string }
interface VariantOpt { id: string; name: string; priceMinor?: string | null }
interface LineRow { productId: string; variantId: string; qty: string; unitPriceTaka: string; variants: VariantOpt[] }
interface ConvertPreview {
  quoteTotalMinor: string; orderSubtotalMinor: string; orderShippingMinor: string;
  orderTotalMinor: string; matchesQuoteTotal: boolean;
}

const STATUS_LABEL: Record<string, string> = { /* values are commerce dict keys (ML6) */
  draft: "draft",
  sent: "sent",
  accepted: "received",
  declined: "rejected",
  expired: "expired3",
  converted: "ordered",
  cancelled: "cancel",
};
/* ML6: label fields hold commerce dict keys, resolved at render. */
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "all" },
  ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
];
const statusChip = (s: string) =>
  s === "accepted" || s === "converted" ? "bg-emerald-100 text-emerald-700"
  : s === "sent" ? "bg-sky-100 text-sky-700"
  : s === "declined" || s === "cancelled" || s === "expired" ? "bg-rose-100 text-rose-700"
  : "bg-slate-100 text-slate-600";

export default function QuotesPage() {
  const { dict, t, locale } = useLocale();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  // form state
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [identityMode, setIdentityMode] = useState<"customer" | "walkin">("customer");
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [walkinName, setWalkinName] = useState("");
  const [walkinPhone, setWalkinPhone] = useState("");
  const [lines, setLines] = useState<LineRow[]>([{ productId: "", variantId: "", qty: "1", unitPriceTaka: "", variants: [] }]);
  const [deliveryTaka, setDeliveryTaka] = useState("");
  const [expiresDate, setExpiresDate] = useState("");
  const [note, setNote] = useState("");

  // detail + action state
  const [detail, setDetail] = useState<Quote | null>(null);
  const [sendResult, setSendResult] = useState<{ sentVia: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<ConvertPreview | null>(null);
  const [previewFor, setPreviewFor] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
      const out = await apiFetch<{ items: Quote[] }>(`/organizations/${orgId}/commerce/quotes${qs}`);
      setQuotes(out.items ?? []);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.loadingFailed); }
    finally { setLoading(false); }
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<CustomerOpt[]>(`/organizations/${orgId}/customers`).then(setCustomers).catch(() => undefined);
    apiFetch<{ items: ProductOpt[] }>(`/organizations/${orgId}/products?pageSize=100`)
      .then((d) => setProducts(d.items ?? [])).catch(() => undefined);
  }, []);

  const customerName = (c: CustomerOpt) => c.name || c.phone || c.email || c.id.slice(0, 8);
  const quoteBuyer = (q: Quote) =>
    q.customerId ? (customers.find((c) => c.id === q.customerId) ? customerName(customers.find((c) => c.id === q.customerId)!) : dict.commerce.customer2)
    : (q.walkinName || q.walkinPhone || dict.commerce.walkIn);

  function resetForm() {
    setEditingId(null); setIdentityMode("customer"); setCustomerId(""); setCustomerSearch("");
    setWalkinName(""); setWalkinPhone("");
    setLines([{ productId: "", variantId: "", qty: "1", unitPriceTaka: "", variants: [] }]);
    setDeliveryTaka(""); setExpiresDate(""); setNote("");
  }

  async function lineProductChange(i: number, productId: string) {
    const orgId = getOrganizationId();
    const product = products.find((p) => p.id === productId);
    const next = [...lines];
    next[i] = {
      ...next[i], productId, variantId: "", variants: [],
      // Prefill from the catalog price — still editable (snapshot offer).
      unitPriceTaka: product ? minorToTakaString(product.priceMinor) : next[i].unitPriceTaka,
    };
    setLines(next);
    if (!orgId || !productId) return;
    try {
      const d = await apiFetch<{ variants?: VariantOpt[] }>(`/organizations/${orgId}/products/${productId}`);
      setLines((cur) => {
        const copy = [...cur];
        if (copy[i]) copy[i] = { ...copy[i], variants: d.variants ?? [] };
        return copy;
      });
    } catch { /* variant picker stays empty — product-level line */ }
  }

  function lineVariantChange(i: number, variantId: string) {
    const next = [...lines];
    const variant = next[i].variants.find((v) => v.id === variantId);
    next[i] = {
      ...next[i], variantId,
      unitPriceTaka: variant?.priceMinor ? minorToTakaString(variant.priceMinor) : next[i].unitPriceTaka,
    };
    setLines(next);
  }

  function startEdit(q: Quote) {
    resetForm();
    setEditingId(q.id);
    if (q.customerId) { setIdentityMode("customer"); setCustomerId(q.customerId); }
    else { setIdentityMode("walkin"); setWalkinName(q.walkinName ?? ""); setWalkinPhone(q.walkinPhone ?? ""); }
    setLines(q.lines.map((l) => ({
      productId: l.productId, variantId: l.variantId ?? "", qty: String(l.qty),
      unitPriceTaka: minorToTakaString(l.unitPriceMinor), variants: [],
    })));
    // Load variant pools for the prefilled lines (best-effort).
    q.lines.forEach((l, i) => { if (l.productId) void lineVariantsInto(i, l.productId); });
    setDeliveryTaka(q.deliveryChargeMinor && q.deliveryChargeMinor !== "0" ? minorToTakaString(q.deliveryChargeMinor) : "");
    setExpiresDate(q.expiresAt ? String(q.expiresAt).slice(0, 10) : "");
    setNote(q.note ?? "");
    setFormOpen(true);
  }

  async function lineVariantsInto(i: number, productId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const d = await apiFetch<{ variants?: VariantOpt[] }>(`/organizations/${orgId}/products/${productId}`);
      setLines((cur) => {
        const copy = [...cur];
        if (copy[i] && copy[i].productId === productId) copy[i] = { ...copy[i], variants: d.variants ?? [] };
        return copy;
      });
    } catch { /* ignore */ }
  }

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const builtLines: { productId: string; variantId: string | null; qty: number; unitPriceMinor: string }[] = [];
    for (const r of lines.filter((x) => x.productId)) {
      const unitPriceMinor = takaToMinorString(r.unitPriceTaka);
      if (unitPriceMinor === null) { setError(dict.commerce.giveEachLineSUnit); return; }
      const qty = parseInt(r.qty || "0", 10);
      if (!Number.isInteger(qty) || qty < 1) { setError(dict.commerce.eachLineSQuantityMust); return; }
      builtLines.push({ productId: r.productId, variantId: r.variantId || null, qty, unitPriceMinor });
    }
    if (builtLines.length === 0) { setError(dict.commerce.giveAtLeastOneProduct); return; }
    if (identityMode === "customer" && !customerId) { setError(dict.commerce.selectACustomerOrGive); return; }
    if (identityMode === "walkin" && !walkinName.trim() && !walkinPhone.trim()) { setError(dict.commerce.giveTheWalkInBuyer); return; }
    const deliveryChargeMinor = takaToMinorString(deliveryTaka) ?? "0";
    setBusy("save"); setError(""); setNotice("");
    const body = {
      ...(identityMode === "customer" ? { customerId } : { customerId: null, walkinName: walkinName.trim() || null, walkinPhone: walkinPhone.trim() || null }),
      lines: builtLines,
      deliveryChargeMinor,
      expiresAt: expiresDate ? new Date(`${expiresDate}T23:59:59`).toISOString() : null,
      note: note.trim() || null,
    };
    try {
      if (editingId) {
        await apiFetch(`/organizations/${orgId}/commerce/quotes/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
        toast({ title: dict.commerce.quoteUpdated, tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/commerce/quotes`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: dict.commerce.quoteCreatedDraft, tone: "success" });
      }
      setFormOpen(false); resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.saveFailed); }
    finally { setBusy(""); }
  }

  async function openDetail(q: Quote) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setSendResult(null); setPreview(null); setPreviewFor(""); setCopied(false);
    try {
      const out = await apiFetch<{ quote: Quote }>(`/organizations/${orgId}/commerce/quotes/${q.id}`);
      setDetail(out.quote);
    } catch { setDetail(q); }
  }

  async function refreshDetail(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const out = await apiFetch<{ quote: Quote }>(`/organizations/${orgId}/commerce/quotes/${id}`);
      setDetail(out.quote);
    } catch { /* keep the current detail */ }
    await load();
  }

  async function sendQuote(q: Quote) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`send-${q.id}`); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ quote: Quote; sentVia: string; link: string }>(
        `/organizations/${orgId}/commerce/quotes/${q.id}/send`, { method: "POST" });
      setSendResult({ sentVia: out.sentVia, link: out.link });
      setDetail(out.quote);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.sendFailed2); }
    finally { setBusy(""); }
  }

  async function cancelQuote(q: Quote) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: t("commerce.cancelQuote", { number: q.number }), danger: true, confirmLabel: dict.commerce.cancel2 }))) return;
    setBusy(`cancel-${q.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/quotes/${q.id}/cancel`, { method: "POST" });
      toast({ title: t("commerce.quoteCancelled", { number: q.number }), tone: "success" });
      if (detail?.id === q.id) await refreshDetail(q.id); else await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.cancellationFailed); }
    finally { setBusy(""); }
  }

  async function loadPreview(q: Quote) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`preview-${q.id}`); setError("");
    try {
      const out = await apiFetch<ConvertPreview>(`/organizations/${orgId}/commerce/quotes/${q.id}/convert-preview`);
      setPreview(out); setPreviewFor(q.id);
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.previewLoadingFailed); }
    finally { setBusy(""); }
  }

  async function convertQuote(q: Quote) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!preview || previewFor !== q.id) return; // প্রিভিউ ছাড়া রূপান্তর নয়
    setBusy(`convert-${q.id}`); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ order: { id: string; externalNumber?: string | null }; quote: Quote }>(
        `/organizations/${orgId}/orders/from-quote/${q.id}/convert`, { method: "POST" });
      setNotice(t("commerce.quoteConvertedToAnOrder", { number: q.number, out: out.order.externalNumber ?? out.order.id.slice(0, 8) }));
      setPreview(null); setPreviewFor("");
      await refreshDetail(q.id);
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.conversionFailed); }
    finally { setBusy(""); }
  }

  async function copyLink(link: string) {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard unavailable — link stays visible */ }
  }

  const formTotalMinor = (() => {
    let total = 0n;
    for (const r of lines) {
      const unit = takaToMinorString(r.unitPriceTaka);
      const qty = parseInt(r.qty || "0", 10);
      if (unit !== null && Number.isInteger(qty) && qty > 0) total += BigInt(unit) * BigInt(qty);
    }
    const del = takaToMinorString(deliveryTaka);
    if (del !== null) total += BigInt(del);
    return total.toString();
  })();

  const filteredCustomers = customers.filter((c) =>
    !customerSearch.trim() || customerName(c).toLowerCase().includes(customerSearch.trim().toLowerCase())
    || (c.phone ?? "").includes(customerSearch.trim()));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{dict.commerce.quotesPriceProposals}</h1>
          <p className="text-sm text-slate-500">
            {dict.commerce.sendTheBuyerAWritten}</p>
        </div>
        <Link href="/dashboard/commerce" className="btn-primary">← Commerce Hub</Link>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <button key={f.value} onClick={() => setStatusFilter(f.value)}
            className={`inline-flex min-h-[44px] items-center justify-center rounded-full px-3 py-1.5 text-xs font-semibold ${statusFilter === f.value ? "bg-indigo-600 text-white" : "border bg-white text-slate-600"}`}>
            {dict.commerce[f.label as keyof typeof dict.commerce]}
          </button>
        ))}
        <button className="btn-primary ml-auto" onClick={() => { resetForm(); setFormOpen(!formOpen); }}>
          {formOpen ? dict.commerce.closeForm : dict.commerce.newQuote}
        </button>
      </div>

      {formOpen ? (
        <div className="card space-y-4 p-5">
          <div className="font-semibold">{editingId ? dict.commerce.editQuoteDraftOnly : dict.commerce.newQuote2}</div>
          <div className="flex flex-wrap gap-2 text-sm">
            <button type="button" className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-1.5 font-semibold ${identityMode === "customer" ? "bg-indigo-600 text-white" : "border bg-white"}`} onClick={() => setIdentityMode("customer")}>{dict.commerce.registeredCustomer}</button>
            <button type="button" className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-1.5 font-semibold ${identityMode === "walkin" ? "bg-indigo-600 text-white" : "border bg-white"}`} onClick={() => setIdentityMode("walkin")}>{dict.commerce.walkInBuyer}</button>
          </div>
          {identityMode === "customer" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm">{dict.commerce.searchCustomers}<input className="input mt-1" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder={dict.commerce.searchByNameOrPhone} />
              </label>
              <label className="block text-sm">{dict.commerce.customer2}<select className="input mt-1" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">{dict.commerce.select}</option>
                  {filteredCustomers.map((c) => <option key={c.id} value={c.id}>{customerName(c)}{c.phone ? ` · ${c.phone}` : ""}</option>)}
                </select>
              </label>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm">{dict.commerce.buyerName}<input className="input mt-1" value={walkinName} onChange={(e) => setWalkinName(e.target.value)} placeholder={dict.commerce.eGKarimUddin} />
              </label>
              <label className="block text-sm">{dict.commerce.buyerPhone}<input className="input mt-1" value={walkinPhone} onChange={(e) => setWalkinPhone(e.target.value)} placeholder="01XXXXXXXXX" />
              </label>
            </div>
          )}

          <div className="space-y-2 border-t pt-4">
            <div className="font-semibold">{dict.commerce.lineItems}</div>
            {lines.map((r, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <label className="block flex-1 text-sm">{dict.commerce.product}<select className="input mt-1" value={r.productId} onChange={(e) => void lineProductChange(i, e.target.value)}>
                    <option value="">{dict.commerce.select}</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="block text-sm">{dict.commerce.variant}<select className="input mt-1 w-44" value={r.variantId} disabled={r.variants.length === 0}
                    onChange={(e) => lineVariantChange(i, e.target.value)}>
                    <option value="">{dict.commerce.allNotApplicable}</option>
                    {r.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </label>
                <label className="block text-sm">{dict.commerce.quantity}<input className="input mt-1 w-24" type="number" min="1" value={r.qty}
                    onChange={(e) => { const n = [...lines]; n[i] = { ...r, qty: e.target.value }; setLines(n); }} />
                </label>
                <label className="block text-sm">{dict.commerce.unitPriceProposed}<input className="input mt-1 w-36" inputMode="decimal" value={r.unitPriceTaka}
                    onChange={(e) => { const n = [...lines]; n[i] = { ...r, unitPriceTaka: e.target.value }; setLines(n); }} placeholder={dict.commerce.catalogPrice} />
                </label>
                <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-2 text-xs font-semibold text-rose-600 disabled:opacity-50"
                  disabled={lines.length <= 1}
                  onClick={() => setLines(lines.filter((_, x) => x !== i))}>{dict.commerce.deleteRow}</button>
              </div>
            ))}
            <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold"
              onClick={() => setLines([...lines, { productId: "", variantId: "", qty: "1", unitPriceTaka: "", variants: [] }])}>
              {dict.commerce.addAnotherLine}</button>
            <p className="text-xs text-slate-500">{dict.commerce.unitPricesArePreFilled}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm">{dict.commerce.deliveryCharge3}<input className="input mt-1" inputMode="decimal" value={deliveryTaka} onChange={(e) => setDeliveryTaka(e.target.value)} placeholder={dict.commerce.text1ye} />
            </label>
            <label className="block text-sm">{dict.commerce.expiryDate}<input className="input mt-1" type="date" value={expiresDate} onChange={(e) => setExpiresDate(e.target.value)} />
            </label>
            <label className="block text-sm">{dict.commerce.totalLinesDelivery}<div className="input mt-1 bg-slate-50 font-bold">{formatMinorTaka(formTotalMinor)}</div>
            </label>
            <label className="block text-sm md:col-span-3">{dict.commerce.noteOptional}<textarea className="input mt-1" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={dict.commerce.termsOrAMessageFor} />
            </label>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy !== ""} onClick={save}>
              {busy === "save" ? dict.commerce.saving2 : editingId ? dict.commerce.updateQuote : dict.commerce.createQuote}
            </button>
            <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => { setFormOpen(false); resetForm(); }}>{dict.common.cancel}</button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card overflow-hidden p-0 lg:col-span-2">
          {loading ? <p className="p-4 text-sm text-slate-400">{dict.common.loading}</p> : quotes.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">{dict.commerce.noQuotesInThisFilter}</p>
          ) : quotes.map((q) => (
            <button key={q.id} onClick={() => openDetail(q)}
              className={`block w-full border-b px-4 py-3 text-left transition hover:bg-slate-50 ${detail?.id === q.id ? "bg-indigo-50/60" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{q.number}</span>
                <span className="text-sm font-semibold">{formatMinorTaka(q.totalMinor)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{quoteBuyer(q)}</span>
                <span className={`rounded px-1.5 py-0.5 font-semibold ${statusChip(q.status)}`}>{STATUS_LABEL[q.status] ? dict.commerce[STATUS_LABEL[q.status] as keyof typeof dict.commerce] : q.status}</span>
                {q.createdAt ? <span>{fmtDate(locale, new Date(q.createdAt))}</span> : null}
              </div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-3">
          {detail ? (
            <div className="card space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold">{dict.commerce.quote}{detail.number}</h2>
                  <p className="text-sm text-slate-500">{dict.commerce.buyer2}{quoteBuyer(detail)}{detail.walkinPhone ? ` · ${detail.walkinPhone}` : ""}</p>
                </div>
                <span className={`rounded px-2 py-1 text-xs font-bold ${statusChip(detail.status)}`}>{STATUS_LABEL[detail.status] ? dict.commerce[STATUS_LABEL[detail.status] as keyof typeof dict.commerce] : detail.status}</span>
              </div>

              <ResponsiveTable
                table={
                  <div>
                    <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs text-slate-500">
                      <th className="py-1.5 pr-2 font-semibold">{dict.commerce.product}</th>
                      <th className="py-1.5 pr-2 font-semibold">{dict.commerce.quantity}</th>
                      <th className="py-1.5 pr-2 font-semibold">{dict.commerce.unitPrice}</th>
                      <th className="py-1.5 font-semibold">{dict.commerce.lineTotal}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5 pr-2 font-medium">{l.name}{l.variantName ? ` — ${l.variantName}` : ""}{l.sku ? <span className="block text-xs text-slate-500">SKU: {l.sku}</span> : null}</td>
                        <td className="py-1.5 pr-2">{l.qty}</td>
                        <td className="py-1.5 pr-2">{formatMinorTaka(l.unitPriceMinor)}</td>
                        <td className="py-1.5">{formatMinorTaka(l.lineTotalMinor)}</td>
                      </tr>
                    ))}
                    </tbody>
                    </table>
                  </div>
                }
                cards={detail.lines.map((l, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{l.name}{l.variantName ? ` — ${l.variantName}` : ""}</span>
                      <span className="font-semibold">{formatMinorTaka(l.lineTotalMinor)}</span>
                    </div>
                    {l.sku ? <div className="mt-0.5 text-xs text-slate-500">SKU: {l.sku}</div> : null}
                    <dl className="mt-2 space-y-1.5 text-sm">
                      <div className="flex gap-2">
                        <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.quantity}</dt>
                        <dd>{l.qty}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.unitPrice}</dt>
                        <dd>{formatMinorTaka(l.unitPriceMinor)}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              />
              <div className="space-y-1 border-t pt-3 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">{dict.commerce.deliveryCharge}</span><span>{formatMinorTaka(detail.deliveryChargeMinor)}</span></div>
                <div className="flex justify-between font-black"><span>{dict.commerce.total}</span><span>{formatMinorTaka(detail.totalMinor)}</span></div>
              </div>
              {detail.note ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{dict.commerce.note2}{detail.note}</p> : null}

              <div className="grid gap-1 border-t pt-3 text-xs text-slate-500">
                {detail.createdAt ? <span>{dict.commerce.created}{fmtDateTime(locale, new Date(detail.createdAt))}</span> : null}
                {detail.expiresAt ? <span>{dict.commerce.expiry2}{fmtDate(locale, new Date(detail.expiresAt))}</span> : null}
                {detail.sentAt ? <span>{dict.commerce.sent2}{fmtDateTime(locale, new Date(detail.sentAt))}{detail.sentVia ? ` (${detail.sentVia === "sms" ? "SMS" : detail.sentVia === "email" ? dict.commerce.email : dict.commerce.couldNotSendAutomatically})` : ""}</span> : null}
                {detail.respondedAt ? <span>{dict.commerce.buyerReply}{fmtDateTime(locale, new Date(detail.respondedAt))}</span> : null}
                {detail.convertedOrderId ? (
                  <span>{dict.commerce.convertedOrder}<Link href="/dashboard/orders" className="font-semibold text-indigo-700 underline">#{detail.convertedOrderId.slice(0, 8)} {dict.commerce.viewInTheOrderList}</Link></span>
                ) : null}
              </div>

              {sendResult ? (
                <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
                  <p className={sendResult.sentVia === "none" ? "font-semibold text-amber-700" : "font-semibold text-emerald-700"}>
                    {sendResult.sentVia === "sms" ? dict.commerce.sentBySMS : sendResult.sentVia === "email" ? dict.commerce.sentByEmail : dict.commerce.couldNotSendCopyThe}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-2 py-1.5 font-mono text-xs">{sendResult.link}</code>
                    <button className="btn-secondary btn-sm" onClick={() => copyLink(sendResult.link)}>{copied ? dict.commerce.copied2 : dict.commerce.copyLink}</button>
                  </div>
                  <p className="text-xs text-slate-500">{dict.commerce.sendingAgainWillCreateA}</p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 border-t pt-3">
                {detail.status === "draft" ? (
                  <button className="btn-secondary btn-sm" onClick={() => startEdit(detail)}>{dict.commerce.edit}</button>
                ) : null}
                {detail.status === "draft" || detail.status === "sent" ? (
                  <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={() => sendQuote(detail)}>
                    {busy === `send-${detail.id}` ? dict.commerce.sending : detail.status === "sent" ? dict.commerce.sendAgain : dict.commerce.send2}
                  </button>
                ) : null}
                {detail.status === "accepted" && !detail.convertedOrderId ? (
                  <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => loadPreview(detail)}>
                    {busy === `preview-${detail.id}` ? dict.commerce.previewLoading : dict.commerce.orderConversionPreview}
                  </button>
                ) : null}
                {detail.status === "draft" || detail.status === "sent" ? (
                  <button className="btn-secondary btn-sm text-red-600" disabled={busy !== ""} onClick={() => cancelQuote(detail)}>{dict.commerce.cancel2}</button>
                ) : null}
              </div>

              {preview && previewFor === detail.id && detail.status === "accepted" ? (
                <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 text-sm">
                  <div className="font-semibold">{dict.commerce.conversionPreviewNothingCreatedYet}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-white p-3">
                      <div className="text-xs text-slate-500">{dict.commerce.quoteTotal}</div>
                      <div className="text-lg font-black">{formatMinorTaka(preview.quoteTotalMinor)}</div>
                    </div>
                    <div className="rounded-lg bg-white p-3">
                      <div className="text-xs text-slate-500">{dict.commerce.orderCalculation}</div>
                      <div className="text-sm">{dict.commerce.subtotal2}<b>{formatMinorTaka(preview.orderSubtotalMinor)}</b></div>
                      <div className="text-sm">{dict.commerce.delivery2}<b>{formatMinorTaka(preview.orderShippingMinor)}</b></div>
                      <div className="text-lg font-black">{dict.commerce.total3}{formatMinorTaka(preview.orderTotalMinor)}</div>
                    </div>
                  </div>
                  {!preview.matchesQuoteTotal ? (
                    <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800">
                      {dict.commerce.warningTheOrderTotal}{formatMinorTaka(preview.orderTotalMinor)}{dict.commerce.doesNotMatchTheQuote}{formatMinorTaka(preview.quoteTotalMinor)}{dict.commerce.textm4rs8w}</p>
                  ) : null}
                  <button className="btn-primary" disabled={busy !== ""} onClick={() => convertQuote(detail)}>
                    {busy === `convert-${detail.id}` ? dict.commerce.converting : dict.commerce.confirmCreateOrder}
                  </button>
                </div>
              ) : null}
              {detail.status === "accepted" && !detail.convertedOrderId && (!preview || previewFor !== detail.id) ? (
                <p className="text-xs text-slate-500">{dict.commerce.loadThePreviewBeforeConverting}</p>
              ) : null}
            </div>
          ) : (
            <div className="card p-5 text-sm text-slate-500">{dict.commerce.selectAQuoteFromThe}</div>
          )}
        </div>
      </div>
    </div>
  );
}
