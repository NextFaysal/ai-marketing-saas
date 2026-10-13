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
}
interface PrintOrder {
  id: string; externalNumber?: string | null; status: string; isCod: boolean;
  paymentMethod?: string | null; address?: string | null; currency?: string | null;
  subtotalMinor?: string | null; shippingMinor?: string | null; discountMinor?: string | null;
  taxMinor?: string | null; totalMinor?: string | null;
  placedAt?: string | null; createdAt?: string | null;
  customer?: {
    firstName?: string | null; lastName?: string | null; name?: string | null;
    phone?: string | null; email?: string | null; address?: unknown;
  } | null;
  items?: PrintOrderItem[];
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
  const kind = params.get("kind") === "slip" ? "slip" : "invoice";
  const [order, setOrder] = useState<PrintOrder | null>(null);
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
        const [o, orgInfo, prof] = await Promise.all([
          apiFetch<PrintOrder>(`/organizations/${orgId}/orders/${orderId}`),
          apiFetch<OrgInfo>(`/organizations/${orgId}`).catch(() => null),
          apiFetch<BusinessProfile>(`/organizations/${orgId}/business-profile`).catch(() => null),
        ]);
        setOrder(o);
        setOrg(orgInfo);
        setProfile(prof);
      } catch (e) {
        setError(e instanceof Error ? e.message : "অর্ডার লোড করা যায়নি");
      } finally { setLoading(false); }
    })();
  }, [orderId]);

  const isSlip = kind === "slip";
  const businessName = org?.brandName || org?.name || "ব্যবসা";
  const businessAddress = [profile?.address, profile?.city].filter(Boolean).join(", ");
  const orderDate = order?.placedAt ?? order?.createdAt ?? null;
  const taxMinor = Number(order?.taxMinor ?? 0);

  return (
    <div className="mx-auto max-w-3xl bg-white p-6 text-slate-900">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <h1 className="page-title">{isSlip ? "প্যাকিং স্লিপ" : "ইনভয়েস"}</h1>
        <button type="button" className="btn-primary" onClick={() => window.print()} disabled={!order}>
          প্রিন্ট করুন
        </button>
      </div>

      {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {order ? (
        <div>
          <header className="border-b pb-4">
            <div className="text-2xl font-bold">{businessName}</div>
            {businessAddress ? <p className="mt-1 text-sm text-slate-600">{businessAddress}</p> : null}
            {profile?.contactPhone ? <p className="text-sm text-slate-600">ফোন: {profile.contactPhone}</p> : null}
            {profile?.contactEmail ? <p className="text-sm text-slate-600">ইমেইল: {profile.contactEmail}</p> : null}
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>{isSlip ? "প্যাকিং স্লিপ নং" : "ইনভয়েস নং"}: <span className="font-semibold">{order.externalNumber ?? order.id}</span></span>
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
                      {item.name}
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
                        {item.name}
                        {item.sku ? <span className="block text-xs text-slate-400">SKU: {item.sku}</span> : null}
                      </td>
                      <td className="py-2 pr-3 text-right">{item.quantity}</td>
                      <td className="py-2 pr-3 text-right">{fmt(item.priceMinor)}</td>
                      <td className="py-2 text-right">{fmt(item.totalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-4 ml-auto w-64 space-y-1 text-sm">
                <div className="flex justify-between"><span>সাবটোটাল</span><span>{fmt(order.subtotalMinor)}</span></div>
                <div className="flex justify-between"><span>ডেলিভারি / শিপিং</span><span>{fmt(order.shippingMinor)}</span></div>
                <div className="flex justify-between"><span>ছাড়</span><span>-{fmt(order.discountMinor)}</span></div>
                {taxMinor > 0 ? (
                  <div className="flex justify-between"><span>কর</span><span>{fmt(order.taxMinor)}</span></div>
                ) : null}
                <div className="flex justify-between border-t pt-2 text-base font-bold">
                  <span>মোট</span><span>{fmt(order.totalMinor)}</span>
                </div>
              </div>

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
