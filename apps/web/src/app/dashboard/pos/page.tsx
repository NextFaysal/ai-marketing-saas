"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

// EC34 — POS / কাউন্টার বিক্রি। বামে পণ্য খোঁজা (Enter-এ exact
// SKU/barcode মিললে সরাসরি কার্টে), ডানে কার্ট + পেমেন্ট।
// দাম এখানে শুধু API-র search payload থেকে দেখানো হয়; বিক্রির
// চূড়ান্ত হিসাব (প্রমোশন/কুপন/কর) সার্ভারেই হয় — কার্টের
// মোটটি তাই "আনুমানিক" লেবেলযুক্ত।

interface PosVariant {
  id: string; name: string; sku?: string | null;
  priceMinor: string | null; stockQuantity: number | null;
}
interface PosProduct {
  productId: string; name: string; sku?: string | null; barcode?: string | null;
  imageUrl?: string | null; priceMinor: string; stockQuantity: number | null;
  stockState: string; preorderEnabled?: boolean; variants: PosVariant[];
}
interface PosExact extends PosProduct {
  variantId: string | null; variant: PosVariant | null;
  unitPriceMinor: string; effectiveStockQuantity: number | null;
}
interface SearchResponse { exact: PosExact | null; results: PosProduct[] }

interface CartLine {
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  sku: string | null;
  unitPriceMinor: number;
  quantity: number;
  /** Tracked stock for the chosen variant/product; null = untracked. */
  stockQuantity: number | null;
  variants: PosVariant[];
  productPriceMinor: number;
  productStockQuantity: number | null;
}

interface ReceiptData {
  shopName: string | null; orderNumber: string | null;
  lines: Array<{ name: string; quantity: number; unitPriceMinor: string; totalMinor: string }>;
  subtotalMinor: string; discountMinor: string; taxMinor: string; taxAddedMinor: string;
  totalMinor: string; paidMinor: string; dueMinor: string;
  paymentMode: string; paymentMethod: string | null;
}
interface SaleResponse { id: string; externalNumber?: string | null; receipt: ReceiptData }

interface TodayOrder {
  id: string; externalNumber: string | null; totalMinor: string;
  dueMinor: string; createdAt: string; itemCount: number;
}
interface TodayResponse { orders: TodayOrder[]; totalSalesMinor: string; orderCount: number }

function fmt(v: string | number | null | undefined): string {
  const n = v == null ? 0 : Number(v);
  return `৳${(Number.isFinite(n) ? n / 100 : 0).toFixed(2)}`;
}

const STOCK_BADGE: Record<string, { label: (p: PosProduct) => string; cls: string }> = {
  in_stock: { label: (p) => `স্টকে আছে (${p.stockQuantity})`, cls: "bg-emerald-100 text-emerald-700" },
  out_of_stock: { label: () => "স্টক শেষ", cls: "bg-red-100 text-red-700" },
  untracked: { label: () => "স্টক ট্র্যাক হয় না", cls: "bg-slate-100 text-slate-600" },
  preorder: { label: () => "প্রি-অর্ডার", cls: "bg-indigo-100 text-indigo-700" },
};

export default function PosPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [resultVariant, setResultVariant] = useState<Record<string, string>>({});

  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [payMode, setPayMode] = useState<"paid" | "due">("paid");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [selling, setSelling] = useState(false);
  const [saleError, setSaleError] = useState("");
  const [lastSale, setLastSale] = useState<SaleResponse | null>(null);

  const [today, setToday] = useState<TodayResponse | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadToday = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      setToday(await apiFetch<TodayResponse>(`/organizations/${orgId}/pos/today`));
    } catch { /* strip is advisory — the sale flow must not depend on it */ }
  }, []);

  useEffect(() => { loadToday(); }, [loadToday]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  const addLine = useCallback((product: PosProduct, variant: PosVariant | null) => {
    const unit = variant?.priceMinor != null ? Number(variant.priceMinor) : Number(product.priceMinor);
    const stock = variant ? variant.stockQuantity : product.stockQuantity;
    const key = `${product.productId}::${variant?.id ?? ""}`;
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) => l.key === key ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...prev, {
        key,
        productId: product.productId,
        variantId: variant?.id ?? null,
        name: variant ? `${product.name} — ${variant.name}` : product.name,
        sku: variant?.sku ?? product.sku ?? null,
        unitPriceMinor: unit,
        quantity: 1,
        stockQuantity: stock,
        variants: product.variants ?? [],
        productPriceMinor: Number(product.priceMinor),
        productStockQuantity: product.stockQuantity,
      }];
    });
  }, []);

  const runSearch = useCallback(async () => {
    const orgId = getOrganizationId();
    const q = query.trim();
    if (!orgId || !q) return;
    setSearching(true); setSearchError("");
    try {
      const res = await apiFetch<SearchResponse>(`/organizations/${orgId}/pos/search?q=${encodeURIComponent(q)}`);
      if (res.exact) {
        // Exact SKU/barcode — straight into the cart (scan flow).
        addLine(res.exact, res.exact.variant);
        setQuery(""); setResults([]);
        searchRef.current?.focus();
      } else if (res.results.length === 1) {
        addLine(res.results[0], null);
        setQuery(""); setResults([]);
        searchRef.current?.focus();
      } else {
        setResults(res.results);
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "খুঁজতে সমস্যা হয়েছে");
    } finally { setSearching(false); }
  }, [query, addLine]);

  const changeLineVariant = (line: CartLine, variantId: string) => {
    const variant = line.variants.find((v) => v.id === variantId) ?? null;
    const baseName = line.name.includes(" — ") ? line.name.split(" — ")[0] : line.name;
    setCart((prev) => prev.map((l) => l.key !== line.key ? l : {
      ...l,
      key: `${l.productId}::${variant?.id ?? ""}`,
      variantId: variant?.id ?? null,
      name: variant ? `${baseName} — ${variant.name}` : baseName,
      sku: variant?.sku ?? l.sku,
      unitPriceMinor: variant?.priceMinor != null ? Number(variant.priceMinor) : l.productPriceMinor,
      stockQuantity: variant ? variant.stockQuantity : l.productStockQuantity,
    }));
  };

  const estimate = cart.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0);

  const completeSale = async () => {
    const orgId = getOrganizationId();
    if (!orgId || cart.length === 0 || selling) return;
    setSelling(true); setSaleError("");
    try {
      const res = await apiFetch<SaleResponse>(`/organizations/${orgId}/pos/sale`, {
        method: "POST",
        body: JSON.stringify({
          items: cart.map((l) => ({ productId: l.productId, variantId: l.variantId ?? undefined, quantity: l.quantity })),
          customerPhone: customerPhone.trim() || undefined,
          customerName: customerName.trim() || undefined,
          couponCode: couponCode.trim() || undefined,
          payment: payMode === "paid"
            ? { mode: "paid", method, reference: reference.trim() || undefined }
            : { mode: "due" },
        }),
      });
      setLastSale(res);
      setCart([]); setCouponCode(""); setReference("");
      await loadToday();
      searchRef.current?.focus();
    } catch (e) {
      setSaleError(e instanceof Error ? e.message : "বিক্রি সম্পন্ন করা যায়নি");
    } finally { setSelling(false); }
  };

  const resetSale = () => {
    setLastSale(null); setSaleError("");
    setCustomerPhone(""); setCustomerName("");
    searchRef.current?.focus();
  };

  const printReceipt = (orderId: string) => {
    window.open(`/dashboard/commerce/print?kind=receipt&orderId=${orderId}`, "_blank");
  };

  return (
    <div className="space-y-6">
      <h1 className="page-title">🧾 POS / কাউন্টার বিক্রি</h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* ---------- left: search + results ---------- */}
        <section className="space-y-4">
          <form
            onSubmit={(e) => { e.preventDefault(); runSearch(); }}
            className="flex gap-2"
          >
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="পণ্যের নাম, SKU বা বারকোড লিখে Enter চাপুন…"
              className="w-full rounded-lg border px-3 py-2.5 text-sm"
            />
            <button type="submit" className="btn-primary whitespace-nowrap" disabled={searching}>
              {searching ? "খুঁজছে…" : "খুঁজুন"}
            </button>
          </form>
          {searchError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{searchError}</p> : null}

          {results.length > 0 ? (
            <ul className="divide-y rounded-xl border bg-white">
              {results.map((p) => {
                const badge = STOCK_BADGE[p.stockState] ?? STOCK_BADGE.untracked;
                const chosenVariantId = resultVariant[p.productId] ?? "";
                const chosenVariant = p.variants.find((v) => v.id === chosenVariantId) ?? null;
                return (
                  <li key={p.productId} className="flex flex-wrap items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-slate-500">
                        {p.sku ? `SKU: ${p.sku}` : ""}{p.barcode ? ` · বারকোড: ${p.barcode}` : ""}
                      </div>
                    </div>
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>{badge.label(p)}</span>
                    <span className="text-sm font-semibold">{fmt(chosenVariant?.priceMinor ?? p.priceMinor)}</span>
                    {p.variants.length > 0 ? (
                      <select
                        value={chosenVariantId}
                        onChange={(e) => setResultVariant((prev) => ({ ...prev, [p.productId]: e.target.value }))}
                        className="rounded-lg border px-2 py-1.5 text-xs"
                      >
                        <option value="">সাধারণ</option>
                        {p.variants.map((v) => (
                          <option key={v.id} value={v.id}>{v.name}{v.priceMinor != null ? ` — ${fmt(v.priceMinor)}` : ""}</option>
                        ))}
                      </select>
                    ) : null}
                    <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => addLine(p, chosenVariant)}>
                      + যোগ করুন
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">
              SKU / বারকোড স্ক্যান বা লিখে Enter চাপলে exact মিল সরাসরি কার্টে যোগ হবে।
            </p>
          )}

          {/* ---------- recent sales ---------- */}
          <section className="rounded-xl border bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">আজকের বিক্রি</h2>
              {today ? <span className="text-sm text-slate-600">মোট {today.orderCount}টি — {fmt(today.totalSalesMinor)}</span> : null}
            </div>
            {!today ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : today.orders.length === 0 ? (
              <p className="text-sm text-slate-500">আজ এখনো কোনো কাউন্টার বিক্রি হয়নি।</p>
            ) : (
              <ul className="divide-y">
                {today.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className="font-medium">{o.externalNumber ?? o.id}</span>
                    <span className="text-slate-500">{new Date(o.createdAt).toLocaleTimeString("bn-BD")}</span>
                    <span className="text-slate-500">{o.itemCount}টি আইটেম</span>
                    <span className="font-semibold">{fmt(o.totalMinor)}</span>
                    {Number(o.dueMinor) > 0 ? (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">বাকি {fmt(o.dueMinor)}</span>
                    ) : (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">পরিশোধিত</span>
                    )}
                    <button type="button" className="ml-auto text-xs font-semibold text-indigo-600 hover:underline" onClick={() => printReceipt(o.id)}>
                      🧾 রসিদ আবার প্রিন্ট
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>

        {/* ---------- right: cart ---------- */}
        <aside className="h-fit space-y-4 rounded-xl border bg-white p-4 lg:sticky lg:top-4">
          <h2 className="text-sm font-semibold">কার্ট</h2>

          {lastSale ? (
            <div className="space-y-3 rounded-lg bg-emerald-50 p-3">
              <p className="text-sm font-semibold text-emerald-800">✅ বিক্রি সম্পন্ন — {lastSale.receipt.orderNumber ?? ""}</p>
              <div className="space-y-1 text-sm text-emerald-900">
                <div className="flex justify-between"><span>সাবটোটাল</span><span>{fmt(lastSale.receipt.subtotalMinor)}</span></div>
                <div className="flex justify-between"><span>ছাড়</span><span>-{fmt(lastSale.receipt.discountMinor)}</span></div>
                {Number(lastSale.receipt.taxAddedMinor) > 0 ? (
                  <div className="flex justify-between"><span>কর</span><span>{fmt(lastSale.receipt.taxAddedMinor)}</span></div>
                ) : null}
                <div className="flex justify-between border-t border-emerald-200 pt-1 font-bold"><span>মোট</span><span>{fmt(lastSale.receipt.totalMinor)}</span></div>
                <div className="flex justify-between"><span>পরিশোধিত</span><span>{fmt(lastSale.receipt.paidMinor)}</span></div>
                <div className="flex justify-between"><span>বাকি</span><span>{fmt(lastSale.receipt.dueMinor)}</span></div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-primary flex-1" onClick={() => printReceipt(lastSale.id)}>🧾 রসিদ প্রিন্ট</button>
                <button type="button" className="flex-1 rounded-lg border px-3 py-2 text-sm font-semibold" onClick={resetSale}>নতুন বিক্রি</button>
              </div>
            </div>
          ) : null}

          {cart.length === 0 ? (
            <p className="text-sm text-slate-500">কার্ট খালি — বাম থেকে পণ্য যোগ করুন।</p>
          ) : (
            <ul className="space-y-3">
              {cart.map((l) => (
                <li key={l.key} className="rounded-lg border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{l.name}</div>
                      <div className="text-xs text-slate-500">{fmt(l.unitPriceMinor)} × {l.quantity}</div>
                    </div>
                    <div className="text-sm font-semibold">{fmt(l.unitPriceMinor * l.quantity)}</div>
                  </div>
                  {l.variants.length > 0 ? (
                    <select
                      value={l.variantId ?? ""}
                      onChange={(e) => changeLineVariant(l, e.target.value)}
                      className="mt-2 w-full rounded-lg border px-2 py-1.5 text-xs"
                    >
                      <option value="">সাধারণ</option>
                      {l.variants.map((v) => (
                        <option key={v.id} value={v.id}>{v.name}{v.priceMinor != null ? ` — ${fmt(v.priceMinor)}` : ""}</option>
                      ))}
                    </select>
                  ) : null}
                  <div className="mt-2 flex items-center gap-2">
                    <button type="button" className="rounded border px-2 py-0.5 text-sm" onClick={() => setCart((prev) => prev.map((x) => x.key === l.key ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}>−</button>
                    <span className="w-8 text-center text-sm font-medium">{l.quantity}</span>
                    <button type="button" className="rounded border px-2 py-0.5 text-sm" onClick={() => setCart((prev) => prev.map((x) => x.key === l.key ? { ...x, quantity: x.quantity + 1 } : x))}>+</button>
                    <button type="button" className="ml-auto text-xs font-semibold text-red-600 hover:underline" onClick={() => setCart((prev) => prev.filter((x) => x.key !== l.key))}>সরান</button>
                  </div>
                  {l.stockQuantity != null && l.quantity > l.stockQuantity ? (
                    <p className="mt-1.5 text-xs font-medium text-red-600">⚠️ স্টকে মাত্র {l.stockQuantity}টি আছে — সার্ভার এই পরিমাণে বিক্রি আটকে দেবে</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 border-t pt-3">
            <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="ক্রেতার ফোন (ঐচ্ছিক)" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="ক্রেতার নাম (ঐচ্ছিক)" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="কুপন কোড (ঐচ্ছিক)" className="w-full rounded-lg border px-3 py-2 text-sm" />
          </div>

          <div className="space-y-2 border-t pt-3">
            <div className="flex gap-2">
              <button type="button" onClick={() => setPayMode("paid")} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${payMode === "paid" ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "text-slate-600"}`}>💵 নগদ / পেইড</button>
              <button type="button" onClick={() => setPayMode("due")} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${payMode === "due" ? "border-amber-600 bg-amber-50 text-amber-700" : "text-slate-600"}`}>📒 বাকি / খাতা</button>
            </div>
            {payMode === "paid" ? (
              <div className="flex gap-2">
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-lg border px-2 py-2 text-sm">
                  <option value="cash">নগদ (Cash)</option>
                  <option value="bkash">বিকাশ</option>
                  <option value="nagad">নগদ (Nagad)</option>
                  <option value="card">কার্ড</option>
                  <option value="other">অন্যান্য</option>
                </select>
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="TrxID / রেফারেন্স (ঐচ্ছিক)" className="w-full rounded-lg border px-3 py-2 text-sm" />
              </div>
            ) : (
              <p className="text-xs text-slate-500">বাকি বিক্রিতে পুরো টাকাটাই অর্ডারের বকেয়া (due) হিসেবে থাকবে।</p>
            )}
          </div>

          <div className="space-y-1 border-t pt-3 text-sm">
            <div className="flex justify-between"><span>আনুমানিক সাবটোটাল</span><span className="font-semibold">{fmt(estimate)}</span></div>
            <p className="text-[11px] text-slate-400">আনুমানিক — চূড়ান্ত হিসাব (ছাড়/কুপন/করসহ) সার্ভারে হবে</p>
          </div>

          {saleError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{saleError}</p> : null}
          <button
            type="button"
            className="btn-primary w-full py-3 text-base"
            disabled={cart.length === 0 || selling}
            onClick={completeSale}
          >
            {selling ? "বিক্রি হচ্ছে…" : "বিক্রি সম্পন্ন করুন"}
          </button>
        </aside>
      </div>
    </div>
  );
}
