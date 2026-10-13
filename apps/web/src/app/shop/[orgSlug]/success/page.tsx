"use client";
import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { formatMinor } from "@repo/contracts";
import { lastOrderKey, type CheckoutResult } from "@/lib/storefront-cart";

function money(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

function SuccessInner() {
  const params = useParams();
  const search = useSearchParams();
  const orgSlug = String(params.orgSlug ?? "");
  const orderFromQuery = search.get("order") ?? "";
  const [order, setOrder] = useState<CheckoutResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(lastOrderKey(orgSlug));
      if (raw) setOrder(JSON.parse(raw) as CheckoutResult);
    } catch { /* no stored response — honest generic confirmation below */ }
    setLoaded(true);
  }, [orgSlug]);

  const orderNumber = order?.orderNumber ?? orderFromQuery;

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <div className="space-y-6 rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-600">✓</div>
        <div>
          <h1 className="text-2xl font-black text-slate-900">অর্ডার সফলভাবে গ্রহণ করা হয়েছে!</h1>
          <p className="mt-1 text-xs text-slate-500">ধন্যবাদ! দোকানের প্রতিনিধি শীঘ্রই কল করে অর্ডারটি নিশ্চিত করবেন।</p>
          {orderNumber ? (
            <p className="mt-3 inline-block rounded-full bg-indigo-50 px-4 py-1.5 text-sm font-black text-indigo-800">অর্ডার নম্বর: {orderNumber}</p>
          ) : null}
        </div>

        {loaded && order ? (
          <div className="space-y-2 rounded-2xl border bg-slate-50 p-4 text-left text-xs">
            <div className="flex justify-between border-b pb-2"><span className="text-slate-500">পণ্যের মূল্য:</span><span className="font-bold text-slate-800">{money(order.itemsSubtotalMinor)}</span></div>
            {BigInt(order.bumpMinor) > 0n ? (
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">অ্যাড-অন:</span><span className="font-bold text-slate-800">+ {money(order.bumpMinor)}</span></div>
            ) : null}
            {BigInt(order.discountMinor) > 0n ? (
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">কুপন ছাড়:</span><span className="font-bold text-emerald-700">− {money(order.discountMinor)}</span></div>
            ) : null}
            <div className="flex justify-between border-b pb-2"><span className="text-slate-500">ডেলিভারি চার্জ:</span><span className="font-bold text-slate-800">{BigInt(order.deliveryMinor) === 0n ? "ফ্রি" : money(order.deliveryMinor)}</span></div>
            <div className="flex justify-between pt-1 text-sm font-bold"><span className="text-slate-900">সর্বমোট:</span><span className="text-indigo-700">{money(order.totalMinor)}</span></div>

            {order.paymentClaimStatus === "cod_due" ? (
              <div className="rounded-xl bg-emerald-50 p-3 text-center">
                <p className="text-[11px] font-semibold text-emerald-800">ক্যাশ অন ডেলিভারিতে পরিশোধযোগ্য</p>
                <p className="text-lg font-black text-emerald-900">{money(order.codDueMinor)}</p>
                <p className="text-[11px] text-emerald-700">পণ্য হাতে পেয়ে এই টাকা পরিশোধ করবেন।</p>
              </div>
            ) : (
              <div className="space-y-1 rounded-xl bg-amber-50 p-3 text-center">
                <p className="text-[11px] font-semibold text-amber-800">মোট বকেয়া</p>
                <p className="text-lg font-black text-amber-900">{money(order.amountDueMinor)}</p>
                <p className="text-[11px] leading-relaxed text-amber-800">
                  আপনার অগ্রিম পেমেন্টের দাবিটি এখনো <b>যাচাই করা হয়নি</b> — এটি &lsquo;পেমেন্ট হয়েছে&rsquo; হিসেবে ধরা হয়নি।
                  দোকান যাচাই করে আপনাকে নিশ্চিত করবে; যাচাইয়ের আগে পুরো টাকাই বকেয়া হিসেবে থাকবে।
                </p>
              </div>
            )}
          </div>
        ) : loaded ? (
          <div className="rounded-2xl border bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
            {orderNumber
              ? <>আপনার অর্ডার (<b>{orderNumber}</b>) গ্রহণ করা হয়েছে। এই পেজটি সরাসরি খোলায় অর্ডারের বিস্তারিত হিসাব এখানে দেখানো যাচ্ছে না — দোকান কল করে বিস্তারিত নিশ্চিত করবে।</>
              : "আপনার অর্ডার গ্রহণ করা হয়েছে। দোকান কল করে বিস্তারিত নিশ্চিত করবে।"}
          </div>
        ) : null}

        <Link href={`/shop/${orgSlug}`} className="block w-full rounded-xl bg-slate-900 py-3 text-xs font-semibold text-white hover:bg-black">
          আরও কেনাকাটা করুন
        </Link>
      </div>
    </div>
  );
}

export default function ShopSuccessPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-lg px-4 py-16 text-center text-sm font-semibold text-slate-500">লোড হচ্ছে…</div>}>
      <SuccessInner />
    </Suspense>
  );
}
