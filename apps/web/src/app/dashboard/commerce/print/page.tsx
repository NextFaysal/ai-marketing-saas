"use client";
import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

// Shape mirrors the API's pubOrder (orders.service.ts getOne): the
// raw order row with every *Minor money field stringified, plus
// customer + items. Prices below come ONLY from these stored fields.
interface PrintOrderItem {
  id: string; name: string; quantity: number; sku?: string | null;
  priceMinor?: string | null; totalMinor?: string | null;
  // EC29: free-gift lines + bundle membership.
  isGift?: boolean; bundleName?: string | null;
}
interface PrintOrder {
  id: string; externalNumber?: string | null; status: string; isCod: boolean;
  paymentMethod?: string | null; address?: string | null; currency?: string | null;
  subtotalMinor?: string | null; shippingMinor?: string | null; discountMinor?: string | null;
  taxMinor?: string | null; totalMinor?: string | null;
  // EC19/EC34: approved-advance / due split from getOne — the
  // receipt prints paid = total − due from these stored sums.
  advancePaidMinor?: string | null; amountDueMinor?: string | null;
  // EC29: gift wrap + buyer-written gift message.
  giftWrapMinor?: string | null;
  giftMessage?: string | null;
  placedAt?: string | null; createdAt?: string | null;
  customer?: {
    firstName?: string | null; lastName?: string | null; name?: string | null;
    phone?: string | null; email?: string | null; address?: unknown;
  } | null;
  items?: PrintOrderItem[];
}
interface TaxBreakdownLine { rateBps: number; taxableMinor: string; taxMinor: string }
interface InvoiceData {
  invoiceNumber?: string | null;
  issuedAt?: string | null;
  seller?: { legalName?: string | null; tin?: string | null; binVatNo?: string | null } | null;
  taxBreakdown?: TaxBreakdownLine[] | null;
}
interface OrgInfo { name?: string | null; brandName?: string | null }
interface BusinessProfile {
  address?: string | null; city?: string | null;
  contactPhone?: string | null; contactEmail?: string | null;
}

/** Money arrives as minor-unit strings — format per spec. */
function fmt(v: string | number | null | undefined): string {
  const n = v == null ? 0 : Number(v);
  return `৳${(Number.isFinite(n) ? n / 100 : 0).toFixed(2)}`;
}

function customerName(order: PrintOrder): string {
  const c = order.customer;
  if (!c) return "—";
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || "—";
}

function addressText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    return Object.values(v as Record<string, unknown>)
      .filter((x) => typeof x === "string" || typeof x === "number")
      .map(String)
      .join(", ");
  }
  return String(v);
}

function PrintInner() {
  const params = useSearchParams();
  const orderId = params.get("orderId") ?? "";
  const kindParam = params.get("kind");
  const kind = kindParam === "slip" ? "slip" : kindParam === "receipt" ? "receipt" : "invoice";
  const [order, setOrder] = useState<PrintOrder | null>(null);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const orgId = getOrganizationId();
      if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); setLoading(false); return; }
      if (!orderId) { setError("অর্ডার আইডি পাওয়া যায়নি — orderId query param দরকার।"); setLoading(false); return; }
      try {
        // EC23: an invoice prints from the invoice endpoint, which
        // ensures the fiscal invoice number and returns the seller's
        // legal identity (TaxSetting). The packing slip keeps the
        // plain order endpoint, unchanged.
        // EC34: a receipt also uses the plain order endpoint (it
        // needs getOne's EC19 advance/due fields, not a fiscal
        // invoice number).
        const isInvoice = kind === "invoice";
        const [o, orgInfo, prof] = await Promise.all([
          isInvoice
            ? apiFetch<PrintOrder & InvoiceData>(`/organizations/${orgId}/orders/${orderId}/invoice`)
            : apiFetch<PrintOrder>(`/organizations/${orgId}/orders/${orderId}`),
          apiFetch<OrgInfo>(`/organizations/${orgId}`).catch(() => null),
          apiFetch<BusinessProfile>(`/organizations/${orgId}/business-profile`).catch(() => null),
        ]);
        setOrder(o);
        if (isInvoice) setInvoice(o as InvoiceData);
        setOrg(orgInfo);
        setProfile(prof);
      } catch (e) {
        setError(e instanceof Error ? e.message : "অর্ডার লোড করা যায়নি");
      } finally { setLoading(false); }
    })();
  }, [orderId]);

  const isSlip = kind === "slip";
  const isReceipt = kind === "receipt";
  const businessName = org?.brandName || org?.name || "ব্যবসা";
  const businessAddress = [profile?.address, profile?.city].filter(Boolean).join(", ");
  const orderDate = order?.placedAt ?? order?.createdAt ?? null;
  const taxMinor = Number(order?.taxMinor ?? 0);

  return (
    <div className="mx-auto max-w-3xl bg-white p-6 text-slate-900">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <h1 className="page-title">{isReceipt ? "রসিদ" : isSlip ? "প্যাকিং স্লিপ" : "ইনভয়েস"}</h1>
        <button type="button" className="btn-primary" onClick={() => window.print()} disabled={!order}>
          প্রিন্ট করুন
        </button>
      </div>

      {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {order && isReceipt ? (
        <div className="pos-receipt mx-auto bg-white text-slate-900" style={{ width: "80mm" }}>
          {/* EC34: narrow thermal-style receipt. Paid/due come
              from getOne's EC19 fields (amountDueMinor is the sum
              of APPROVED verifications netted off the total). */}
          <style>{`@media print { .pos-receipt { width: 80mm !important; margin: 0 auto; } @page { margin: 4mm; } }`}</style>
          <header className="border-b border-dashed pb-3 text-center">
            <div className="text-xl font-bold">{businessName}</div>
            {businessAddress ? <p className="mt-1 text-xs text-slate-600">{businessAddress}</p> : null}
            {profile?.contactPhone ? <p className="text-xs text-slate-600">ফোন: {profile.contactPhone}</p> : null}
            <p className="mt-2 text-xs">
              রসিদ নং: <span className="font-semibold">{order.externalNumber ?? order.id}</span>
              {orderDate ? <span> · {new Date(orderDate).toLocaleString("bn-BD")}</span> : null}
            </p>
            <p className="text-xs">ক্রেতা: {customerName(order)}{order.customer?.phone ? ` · ${order.customer.phone}` : ""}</p>
          </header>

          <table className="mt-3 w-full text-xs">
            <tbody>
              {(order.items ?? []).map((item) => (
                <tr key={item.id} className="align-top">
                  <td className="py-1 pr-2">
                    {item.isGift ? "🎁 " : ""}{item.name} × {item.quantity}
                    {item.sku ? <span className="block text-[10px] text-slate-400">{item.sku}</span> : null}
                  </td>
                  <td className="py-1 text-right whitespace-nowrap">{item.isGift ? "৳০" : fmt(item.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 space-y-1 border-t border-dashed pt-2 text-xs">
            <div className="flex justify-between"><span>সাবটোটাল</span><span>{fmt(order.subtotalMinor)}</span></div>
            {Number(order.discountMinor ?? 0) > 0 ? (
              <div className="flex justify-between"><span>ছাড়</span><span>-{fmt(order.discountMinor)}</span></div>
            ) : null}
            {taxMinor > 0 ? (
              <div className="flex justify-between"><span>কর</span><span>{fmt(order.taxMinor)}</span></div>
            ) : null}
            <div className="flex justify-between border-t border-dashed pt-1.5 text-sm font-bold">
              <span>মোট</span><span>{fmt(order.totalMinor)}</span>
            </div>
            <div className="flex justify-between">
              <span>পরিশোধিত</span>
              <span>{fmt(String(Number(order.totalMinor ?? 0) - Number(order.amountDueMinor ?? 0)))}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>বাকি</span><span>{fmt(order.amountDueMinor)}</span>
            </div>
            {order.paymentMethod ? (
              <div className="flex justify-between"><span>পেমেন্ট পদ্ধতি</span><span>{order.paymentMethod}</span></div>
            ) : null}
          </div>

          <p className="mt-4 border-t border-dashed pt-3 text-center text-sm font-semibold">ধন্যবাদ! আবার আসবেন 🙏</p>
        </div>
      ) : null}

      {order && !isReceipt ? (
        <div>
          <header className="border-b pb-4">
            <div className="text-2xl font-bold">{businessName}</div>
            {!isSlip && invoice?.seller?.legalName ? (
              <p className="mt-1 text-sm text-slate-600">আইনি নাম: {invoice.seller.legalName}</p>
            ) : null}
            {!isSlip && invoice?.seller?.tin ? (
              <p className="text-sm text-slate-600">TIN: {invoice.seller.tin}</p>
            ) : null}
            {!isSlip && invoice?.seller?.binVatNo ? (
              <p className="text-sm text-slate-600">BIN / VAT নং: {invoice.seller.binVatNo}</p>
            ) : null}
            {businessAddress ? <p className="mt-1 text-sm text-slate-600">{businessAddress}</p> : null}
            {profile?.contactPhone ? <p className="text-sm text-slate-600">ফোন: {profile.contactPhone}</p> : null}
            {profile?.contactEmail ? <p className="text-sm text-slate-600">ইমেইল: {profile.contactEmail}</p> : null}
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>{isSlip ? "প্যাকিং স্লিপ নং" : "ইনভয়েস নং"}: <span className="font-semibold">{isSlip ? (order.externalNumber ?? order.id) : (invoice?.invoiceNumber ?? order.externalNumber ?? order.id)}</span></span>
              {orderDate ? <span>তারিখ: {new Date(orderDate).toLocaleString("bn-BD")}</span> : null}
              <span>অবস্থা: {order.status}</span>
            </div>
          </header>

          <section className="mt-4 text-sm">
            <div className="font-semibold">কাস্টমার</div>
            <p className="mt-1">{customerName(order)}</p>
            {order.customer?.phone ? <p>ফোন: {order.customer.phone}</p> : null}
            {order.customer?.email ? <p>ইমেইল: {order.customer.email}</p> : null}
            {order.address ? <p>ঠিকানা: {order.address}</p> : null}
            {!order.address && addressText(order.customer?.address) ? (
              <p>ঠিকানা: {addressText(order.customer?.address)}</p>
            ) : null}
          </section>

          {isSlip && order.giftMessage ? (
            <div className="mt-4 rounded-lg border-2 border-slate-900 p-3 text-center text-base font-bold">
              🎁 গিফট বার্তা: {order.giftMessage}
            </div>
          ) : null}

          {isSlip ? (
            <table className="mt-6 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">আইটেম</th>
                  <th className="py-2 text-right">পরিমাণ</th>
                </tr>
              </thead>
              <tbody>
                {(order.items ?? []).map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      {item.isGift ? "🎁 " : ""}{item.name}
                      {item.isGift ? <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold">উপহার</span> : null}
                      {item.bundleName ? <span className="block text-xs text-slate-500">বান্ডল: {item.bundleName}</span> : null}
                      {item.sku ? <span className="block text-xs text-slate-400">SKU: {item.sku}</span> : null}
                    </td>
                    <td className="py-2 text-right">{item.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <>
              <table className="mt-6 w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-500">
                    <th className="py-2 pr-3">আইটেম</th>
                    <th className="py-2 pr-3 text-right">পরিমাণ</th>
                    <th className="py-2 pr-3 text-right">একক দাম</th>
                    <th className="py-2 text-right">লাইন মোট</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.items ?? []).map((item) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        {item.isGift ? "🎁 " : ""}{item.name}
                        {item.isGift ? <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold">উপহার</span> : null}
                        {item.bundleName ? <span className="block text-xs text-slate-500">বান্ডল: {item.bundleName}</span> : null}
                        {item.sku ? <span className="block text-xs text-slate-400">SKU: {item.sku}</span> : null}
                      </td>
                      <td className="py-2 pr-3 text-right">{item.quantity}</td>
                      <td className="py-2 pr-3 text-right">{item.isGift ? "৳০" : fmt(item.priceMinor)}</td>
                      <td className="py-2 text-right">{item.isGift ? "৳০" : fmt(item.totalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {order.giftMessage ? (
                <div className="mt-4 rounded-lg border-2 border-slate-900 p-3 text-center text-base font-bold">
                  🎁 গিফট বার্তা: {order.giftMessage}
                </div>
              ) : null}

              <div className="mt-4 ml-auto w-64 space-y-1 text-sm">
                <div className="flex justify-between"><span>সাবটোটাল</span><span>{fmt(order.subtotalMinor)}</span></div>
                {Number(order.giftWrapMinor ?? 0) > 0 ? (
                  <div className="flex justify-between"><span>গিফট র‍্যাপ</span><span>{fmt(order.giftWrapMinor)}</span></div>
                ) : null}
                <div className="flex justify-between"><span>ডেলিভারি / শিপিং</span><span>{fmt(order.shippingMinor)}</span></div>
                <div className="flex justify-between"><span>ছাড়</span><span>-{fmt(order.discountMinor)}</span></div>
                {taxMinor > 0 ? (
                  <div className="flex justify-between"><span>কর</span><span>{fmt(order.taxMinor)}</span></div>
                ) : null}
                <div className="flex justify-between border-t pt-2 text-base font-bold">
                  <span>মোট</span><span>{fmt(order.totalMinor)}</span>
                </div>
              </div>

              {invoice?.taxBreakdown && invoice.taxBreakdown.length > 0 ? (
                <div className="mt-4 ml-auto w-64 space-y-1 text-xs text-slate-600">
                  <div className="font-semibold text-slate-700">কর বিবরণ (VAT)</div>
                  {invoice.taxBreakdown.map((b) => (
                    <div key={b.rateBps} className="flex justify-between">
                      <span>VAT {b.rateBps / 100}% — করযোগ্য {fmt(b.taxableMinor)}</span>
                      <span>{fmt(b.taxMinor)}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {order.isCod ? (
                <div className="mt-6 rounded-lg border-2 border-slate-900 p-4 text-center text-lg font-bold">
                  COD — ডেলিভারির সময় প্রাপ্য: {fmt(order.totalMinor)}
                </div>
              ) : order.paymentMethod ? (
                <p className="mt-6 text-sm text-slate-600">পেমেন্ট পদ্ধতি: {order.paymentMethod}</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function CommercePrintPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-slate-500">লোড হচ্ছে…</p>}>
      <PrintInner />
    </Suspense>
  );
}
