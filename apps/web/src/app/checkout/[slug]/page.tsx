"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { formatMinor } from "@repo/contracts";

interface CheckoutData {
  product: {
    id: string;
    name: string;
    slug: string;
    description?: string | null;
    category?: string | null;
    imageUrl?: string | null;
    priceMinor: string;
    compareAtMinor?: string | null;
    stockQuantity?: number | null;
    bumpTitle?: string | null;
    bumpPriceMinor?: string | null;
    bumpImageUrl?: string | null;
    variants?: { id: string; name: string; sku?: string | null; priceMinor?: string | null }[];
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    insideDhakaFee: string;
    outsideDhakaFee: string;
    codAvailable: boolean;
    bkashNumber?: string | null;
    nagadNumber?: string | null;
    paymentNote?: string | null;
    metaPixelId?: string | null;
    tikTokPixelId?: string | null;
  };
}

export default function CheckoutPage() {
  const params = useParams();
  const slug = String(params.slug ?? "");

  const [data, setData] = useState<CheckoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderCompleted, setOrderCompleted] = useState<any>(null);

  // Form State
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [deliveryZone, setDeliveryZone] = useState<"inside_dhaka" | "outside_dhaka">("inside_dhaka");
  const [quantity, setQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "bkash" | "nagad">("cod");
  const [note, setNote] = useState("");
  const [includeBump, setIncludeBump] = useState(false);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${API_URL}/public/checkout/${slug}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.message || "প্রোডাক্টটি পাওয়া যায়নি অথবা বর্তমানে স্টকে নেই।");
        }
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "লোড করতে ব্যর্থ হয়েছে");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  async function handleOrderSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;

    // Bangladeshi phone validation
    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.length < 11) {
      alert("অনুগ্রহ করে সঠিক ১১ ডিজিটের মোবাইল নম্বর দিন (যেমন: 017XXXXXXXX)");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/public/checkout/${slug}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name.trim(),
          customerPhone: phone.trim(),
          customerAddress: address.trim(),
          deliveryZone,
          quantity,
          paymentMethod,
          note: note.trim() || undefined,
          includeBump,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.message || "অর্ডার সম্পন্ন করতে সমস্যা হয়েছে");
      }

      const out = await res.json();
      setOrderCompleted(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "অর্ডার ব্যর্থ হয়েছে");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="h-10 w-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-600">অর্ডার পেজ লোড হচ্ছে...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl p-8 shadow-sm border text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-lg font-bold text-slate-800">দুঃখিত!</h2>
          <p className="text-xs text-rose-600 font-medium">{error || "পণ্যটি পাওয়া যায়নি"}</p>
          <a
            href="/"
            className="inline-block rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white"
          >
            হোমে ফিরে যান
          </a>
        </div>
      </div>
    );
  }

  const { product, organization } = data;
  const unitPrice = Number(product.priceMinor) / 100;
  const bumpPrice = (product.bumpPriceMinor && includeBump) ? Number(product.bumpPriceMinor) / 100 : 0;
  const subtotal = (unitPrice * quantity) + bumpPrice;
  const deliveryCharge = deliveryZone === "inside_dhaka" ? Number(organization.insideDhakaFee) : Number(organization.outsideDhakaFee);
  const grandTotal = subtotal + deliveryCharge;

  // Order Confirmed State
  if (orderCompleted) {
    return (
      <div className="min-h-screen bg-slate-100/60 py-12 px-4 flex items-center justify-center">
        <div className="max-w-lg w-full bg-white rounded-3xl p-8 shadow-xl border border-slate-100 space-y-6 text-center animate-in fade-in">
          <div className="h-16 w-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-3xl mx-auto">
            ✓
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900">অর্ডার সফলভাবে গ্রহণ করা হয়েছে!</h1>
            <p className="text-xs text-slate-500 mt-1">
              ধন্যবাদ <b>{orderCompleted.customerName}</b>! আমাদের প্রতিনিধি শীঘ্রই আপনাকে কল করে কনফার্ম করবেন।
            </p>
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 border text-left space-y-2 text-xs">
            <div className="flex justify-between border-b pb-2">
              <span className="text-slate-500">পণ্য:</span>
              <span className="font-bold text-slate-800">{orderCompleted.productName} (x{orderCompleted.quantity})</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-slate-500">ডেলিভারি ঠিকানা:</span>
              <span className="font-medium text-slate-800 text-right max-w-[200px]">{orderCompleted.deliveryAddress}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-slate-500">পেমেন্ট মেথড:</span>
              <span className="font-bold text-indigo-700">ক্যাশ অন ডেলিভারি (পণ্য পেয়ে টাকা দিন)</span>
            </div>
            <div className="flex justify-between pt-1 text-sm font-bold">
              <span className="text-slate-900">সর্বমোট প্রদেয় টাকা:</span>
              <span className="text-emerald-700 text-base">{orderCompleted.totalFormatted}</span>
            </div>
          </div>

          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
            🔒 আপনার পার্সেলটি ঢাকা বা ঢাকার বাইরে ২-৩ কার্যদিবসের মধ্যে কুরিয়ারের মাধ্যমে পৌঁছে দেওয়া হবে।
          </div>

          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-xl bg-slate-900 text-white font-semibold py-3 text-xs hover:bg-black transition-colors"
          >
            আরেকটি অর্ডার করুন
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6">
      {/* 📊 SaaS Multi-Tenant Merchant Facebook Pixel Injection */}
      {organization.metaPixelId ? (
        <script
          dangerouslySetInnerHTML={{
            __html: `
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${organization.metaPixelId}');
              fbq('track', 'PageView');
              fbq('track', 'InitiateCheckout', {
                content_name: '${product.name.replace(/'/g, "\\'")}',
                value: ${unitPrice},
                currency: 'BDT'
              });
            `,
          }}
        />
      ) : null}

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Brand Header */}
        <div className="text-center">
          <span className="rounded-full bg-indigo-100 text-indigo-800 text-[11px] font-bold px-3 py-1">
            {organization.name}
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">
            অর্ডার করতে নিচের ফর্মটি পূরণ করুন
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            ক্যাশ অন ডেলিভারি সুবিধা · পণ্য হাতে পেয়ে চেক করে পেমেন্ট করার নিশ্চয়তা
          </p>
        </div>

        <form onSubmit={handleOrderSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Left Column: Customer Form */}
          <div className="md:col-span-7 bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
            <h2 className="text-base font-bold text-slate-900 border-b pb-2 flex items-center gap-2">
              <span>📍 আপনার ডেলিভারি তথ্য দিন</span>
            </h2>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                আপনার নাম (Full Name) *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="যেমন: মোঃ সাব্বির আহমেদ"
                className="w-full rounded-xl border border-slate-300 p-2.5 text-xs focus:border-indigo-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                মোবাইল নম্বর (Phone Number) *
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01XXXXXXXXX"
                className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-mono font-bold focus:border-indigo-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                পূর্ণ ঠিকানা (Full Delivery Address) *
              </label>
              <textarea
                required
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="বাড়ি নং, রোড নং, এলাকা, থানা ও জেলার নাম লিখুন..."
                className="w-full rounded-xl border border-slate-300 p-2.5 text-xs focus:border-indigo-600 focus:outline-none"
              />
            </div>

            {/* Delivery Area Selection */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                ডেলিভারি এরিয়া বেছে নিন *
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setDeliveryZone("inside_dhaka")}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    deliveryZone === "inside_dhaka"
                      ? "border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="font-bold text-xs text-slate-900">ঢাকা সিটির ভেতরে</div>
                  <div className="text-[11px] text-indigo-700 font-semibold mt-0.5">
                    চার্জ: ৳{organization.insideDhakaFee}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setDeliveryZone("outside_dhaka")}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    deliveryZone === "outside_dhaka"
                      ? "border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="font-bold text-xs text-slate-900">ঢাকার বাইরে (সারা দেশ)</div>
                  <div className="text-[11px] text-indigo-700 font-semibold mt-0.5">
                    চার্জ: ৳{organization.outsideDhakaFee}
                  </div>
                </button>
              </div>
            </div>

            {/* Payment Method Option */}
            <div className="border-t pt-3">
              <label className="block text-xs font-bold text-slate-700 mb-1.5">পেমেন্ট মেথড:</label>
              <div className="rounded-xl border border-emerald-300 bg-emerald-50/60 p-3 flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-emerald-950">
                  <input
                    type="radio"
                    name="payment"
                    checked={paymentMethod === "cod"}
                    onChange={() => setPaymentMethod("cod")}
                    className="text-emerald-600"
                  />
                  <span>💵 ক্যাশ অন ডেলিভারি (Cash on Delivery)</span>
                </label>
                <span className="text-[10px] bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                  জনপ্রিয়
                </span>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                বিশেষ কোনো নির্দেশনা (ঐচ্ছিক):
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="যেমন: বিকেলে ডেলিভারি দিলে ভালো হয়"
                className="w-full rounded-lg border border-slate-200 p-2 text-xs"
              />
            </div>
          </div>

          {/* Right Column: Product Summary & Order Total */}
          <div className="md:col-span-5 space-y-4">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
              <h2 className="text-base font-bold text-slate-900 border-b pb-2">
                🛍️ অর্ডার বিবরণ
              </h2>

              <div className="flex gap-3">
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="h-20 w-20 rounded-xl object-cover border border-slate-200"
                  />
                ) : (
                  <div className="h-20 w-20 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-3xl">
                    📦
                  </div>
                )}
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-900 line-clamp-2">{product.name}</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-extrabold text-indigo-700">
                      {formatMinor(BigInt(product.priceMinor))}
                    </span>
                    {product.compareAtMinor ? (
                      <span className="text-xs text-slate-400 line-through">
                        {formatMinor(BigInt(product.compareAtMinor))}
                      </span>
                    ) : null}
                  </div>
                  {product.category ? (
                    <span className="inline-block text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                      {product.category}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Quantity Selector */}
              <div className="flex items-center justify-between border-y py-3">
                <span className="text-xs font-bold text-slate-700">পরিমাণ (Quantity):</span>
                <div className="flex items-center border rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="px-3 py-1 bg-slate-50 hover:bg-slate-100 font-bold text-slate-600"
                  >
                    -
                  </button>
                  <span className="px-4 py-1 text-xs font-bold text-slate-900">{quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity(quantity + 1)}
                    className="px-3 py-1 bg-slate-50 hover:bg-slate-100 font-bold text-slate-600"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* ⚡ High-Converting 1-Click Order Bump Box */}
              {product.bumpTitle && product.bumpPriceMinor ? (
                <div
                  onClick={() => setIncludeBump(!includeBump)}
                  className={`rounded-xl border p-3.5 transition-all cursor-pointer ${
                    includeBump
                      ? "border-amber-500 bg-amber-50/70 ring-2 ring-amber-400"
                      : "border-dashed border-amber-300 bg-amber-50/20 hover:bg-amber-50/40"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={includeBump}
                      onChange={(e) => setIncludeBump(e.target.checked)}
                      className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                    />
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold bg-amber-500 text-white px-1.5 py-0.2 rounded">
                          🔥 বিশেষ অ্যাড-অন অফার
                        </span>
                        <span className="text-xs font-bold text-slate-900">
                          {product.bumpTitle}
                        </span>
                      </div>
                      <p className="text-[11px] text-amber-900 font-bold">
                        মাত্র ৳{(Number(product.bumpPriceMinor) / 100).toLocaleString("en-IN")} অতিরিক্ত যোগ হবে
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Price Calculation Breakdown */}
              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>সাবটোটাল ({quantity} টি পণ্য):</span>
                  <span className="font-semibold text-slate-900">৳{(unitPrice * quantity).toLocaleString("en-IN")}</span>
                </div>
                {includeBump && bumpPrice > 0 ? (
                  <div className="flex justify-between text-amber-800 font-semibold bg-amber-50 px-2 py-1 rounded">
                    <span>⚡ স্পেশাল অ্যাড-অন:</span>
                    <span>+ ৳{bumpPrice.toLocaleString("en-IN")}</span>
                  </div>
                ) : null}
                <div className="flex justify-between text-slate-600">
                  <span>ডেলিভারি চার্জ:</span>
                  <span className="font-semibold text-slate-900">৳{deliveryCharge}</span>
                </div>
                <div className="flex justify-between text-sm font-black text-slate-900 border-t pt-2">
                  <span>সর্বমোট প্রদেয় টাকা:</span>
                  <span className="text-indigo-600 text-lg">৳{grandTotal.toLocaleString("en-IN")}</span>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-2xl bg-indigo-600 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-700 active:scale-[0.99] transition-all disabled:opacity-50"
              >
                {submitting ? "অর্ডার প্রসেস হচ্ছে..." : "🚀 অর্ডার নিশ্চিত করুন (Cash on Delivery)"}
              </button>

              <div className="text-center text-[10px] text-slate-400 space-y-1">
                <p>🔒 ১০০% নিরাপদ চেকআউট · পণ্য হাতে পেয়ে পেমেন্ট</p>
                <p>প্রয়োজনে কল করে সাপোর্ট দেওয়া হবে</p>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
