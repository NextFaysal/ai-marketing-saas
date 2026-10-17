"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatMinor } from "@repo/contracts";
import { API_URL } from "@/lib/api";
import { ensureCartToken, fetchCart, patchBundleLine, patchCartLine, setCartContact, type Cart } from "@/lib/storefront-cart";
import dynamic from "next/dynamic";
import { MediaImage } from "@/components/MediaImage";
import { CrossSellRail } from "../CrossSellRail";
import { shopLocaleOf, shopT, type ShopLocale } from "@/lib/shop-i18n";

// ED4: the express-checkout sheet is interactive and only matters
// for signed-in shoppers — code-split it (SSR stays on by default)
// with a light placeholder so the cart itself paints first.
const ExpressCheckout = dynamic(
  () => import("../ExpressCheckout").then((m) => ({ default: m.ExpressCheckout })),
  { loading: () => <div className="h-11 w-full animate-pulse rounded-2xl bg-slate-100" aria-hidden="true" /> },
);

function money(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

export default function CartPage() {
  const params = useParams();
  const orgSlug = String(params.orgSlug ?? "");
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [contactNotice, setContactNotice] = useState("");
  const [locale, setLocale] = useState<ShopLocale>("bn");
  const [reorderedCount, setReorderedCount] = useState(0);
  const t = shopT(locale);

  // EC25: account-page reorder lands here with ?reordered=<n>.
  useEffect(() => {
    try {
      const n = parseInt(new URLSearchParams(window.location.search).get("reordered") ?? "", 10);
      if (Number.isFinite(n) && n > 0) setReorderedCount(n);
    } catch { /* no banner */ }
  }, []);

  // EC19: shop locale from the public shop payload (default bn).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}`);
        if (!res.ok) return;
        const json = await res.json();
        setLocale(shopLocaleOf(json?.settings?.locale));
      } catch { /* locale stays bn */ }
    })();
  }, [orgSlug]);

  const load = useCallback(async () => {
    setLoading(true);
    const c = await fetchCart(orgSlug);
    setCart(c);
    if (c) {
      setEmail(c.email ?? "");
      setPhone(c.phone ?? "");
    }
    setLoading(false);
  }, [orgSlug]);

  useEffect(() => { load(); }, [load]);

  async function changeQty(itemId: string, productId: string, variantId: string | null, includeBump: boolean, quantity: number) {
    setBusy(itemId);
    setError("");
    try {
      const updated = await patchCartLine(orgSlug, { productId, variantId, quantity, includeBump });
      setCart(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.cart.updateError);
    } finally {
      setBusy("");
    }
  }

  async function changeBundleQty(bundleId: string, quantity: number) {
    setBusy(`bundle-${bundleId}`);
    setError("");
    try {
      // AB5 (AX8): a slotted line's stored picks must ride along
      // on quantity changes — the server re-validates them and
      // refuses a slotted bundle without picks.
      const line = (cart?.bundleItems ?? []).find((b) => b.bundleId === bundleId);
      const updated = await patchBundleLine(orgSlug, {
        bundleId, quantity,
        ...(line?.picks?.length ? { picks: line.picks } : {}),
      });
      setCart(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.cart.updateError);
    } finally {
      setBusy("");
    }
  }

  async function saveContact() {
    setBusy("contact");
    setError("");
    setContactNotice("");
    try {
      const body: { email?: string; phone?: string } = {};
      if (email.trim()) body.email = email.trim();
      if (phone.trim()) body.phone = phone.trim();
      const updated = await setCartContact(orgSlug, body);
      setCart(updated);
      setContactNotice(t.cart.contactSaved);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.cart.saveError);
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        <p className="mt-3 text-sm font-semibold text-slate-600">{t.cart.loading}</p>
      </div>
    );
  }

  if (!cart || (cart.items.length === 0 && (cart.bundleItems ?? []).length === 0)) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16">
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-4xl">🛒</p>
          <h1 className="mt-3 text-xl font-black text-slate-900">{t.cart.emptyTitle}</h1>
          <p className="mt-1 text-sm text-slate-500">{t.cart.emptyText}</p>
          <Link href={`/shop/${orgSlug}`} className="mt-4 inline-block rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white">
            {t.cart.startShopping}
          </Link>
        </div>
      </div>
    );
  }

  // Preview only: server cart line totals + accepted bumps (once per line).
  let previewMinor = 0n;
  for (const item of cart.items) {
    try {
      previewMinor += BigInt(item.lineTotalMinor);
      if (item.includeBump && item.bump) previewMinor += BigInt(item.bump.priceMinor);
    } catch { /* ignore malformed */ }
  }
  for (const b of cart.bundleItems ?? []) {
    try {
      previewMinor += BigInt(b.lineTotalMinor);
    } catch { /* ignore malformed */ }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-black text-slate-900">{t.cart.title}</h1>
      {reorderedCount > 0 ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
          🔁 {reorderedCount}{t.account.reorderLoaded}
        </p>
      ) : null}
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}

      <div className="space-y-3">
        {cart.items.map((item) => (
          <div key={item.id} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {item.imageUrl ? (
              <MediaImage src={item.imageUrl} alt={item.productName ?? ""} width={160} height={160} sizes="80px" className="h-20 w-20 rounded-xl border border-slate-200 object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-indigo-50 text-3xl">📦</div>
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-slate-900">{item.productName ?? t.cart.productFallback}</p>
                  {item.variantName ? <p className="text-[11px] text-slate-500">{item.variantName}</p> : null}
                  <p className="text-xs text-slate-500">{t.cart.unitPrice} {money(item.unitPriceMinor)}</p>
                </div>
                <p className="text-sm font-extrabold text-indigo-700">{money(item.lineTotalMinor)}</p>
              </div>
              {item.includeBump && item.bump ? (
                <p className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-900">
                  {t.cart.bumpWith} {item.bump.title} (+{money(item.bump.priceMinor)})
                </p>
              ) : null}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center overflow-hidden rounded-lg border">
                  <button
                    type="button"
                    disabled={busy === item.id}
                    onClick={() => changeQty(item.id, item.productId, item.variantId, item.includeBump, Math.max(0, item.quantity - 1))}
                    className="bg-slate-50 px-3 py-1 font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                  >−</button>
                  <span className="px-3 py-1 text-xs font-bold">{item.quantity}</span>
                  <button
                    type="button"
                    disabled={busy === item.id}
                    onClick={() => changeQty(item.id, item.productId, item.variantId, item.includeBump, Math.min(99, item.quantity + 1))}
                    className="bg-slate-50 px-3 py-1 font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                  >+</button>
                </div>
                <button
                  type="button"
                  disabled={busy === item.id}
                  onClick={() => changeQty(item.id, item.productId, item.variantId, item.includeBump, 0)}
                  className="text-xs font-bold text-rose-600 hover:underline disabled:opacity-50"
                >
                  {t.cart.remove}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* EC29: bundle lines */}
      {(cart.bundleItems ?? []).length > 0 ? (
        <div className="space-y-3">
          {(cart.bundleItems ?? []).map((b) => (
            <div key={b.id} className="flex gap-4 rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
              {b.imageUrl ? (
                <MediaImage src={b.imageUrl} alt={b.name} width={160} height={160} sizes="80px" className="h-20 w-20 rounded-xl border border-slate-200 object-cover" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-amber-50 text-3xl">🎁</div>
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      {b.name}{" "}
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">{t.cart.bundleBadge}</span>
                    </p>
                    <p className="text-xs text-slate-500">{t.cart.unitPrice} {money(b.bundlePriceMinor)}</p>
                  </div>
                  <p className="text-sm font-extrabold text-indigo-700">{money(b.lineTotalMinor)}</p>
                </div>
                <details className="text-xs text-slate-600">
                  <summary className="cursor-pointer font-semibold text-slate-700">{t.cart.bundleContents}</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {b.components.map((c) => (
                      <li key={`${c.productId}-${c.variantSku ?? ""}`}>{c.name}{c.variantSku ? ` (${c.variantSku})` : ""} × {c.qty}{c.viaSlot ? <span className="ml-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">{c.viaSlot}</span> : null}</li>
                    ))}
                  </ul>
                </details>
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center overflow-hidden rounded-lg border">
                    <button
                      type="button"
                      disabled={busy === `bundle-${b.bundleId}`}
                      onClick={() => changeBundleQty(b.bundleId, Math.max(0, b.quantity - 1))}
                      className="bg-slate-50 px-3 py-1 font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                    >−</button>
                    <span className="px-3 py-1 text-xs font-bold">{b.quantity}</span>
                    <button
                      type="button"
                      disabled={busy === `bundle-${b.bundleId}`}
                      onClick={() => changeBundleQty(b.bundleId, Math.min(99, b.quantity + 1))}
                      className="bg-slate-50 px-3 py-1 font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                    >+</button>
                  </div>
                  <button
                    type="button"
                    disabled={busy === `bundle-${b.bundleId}`}
                    onClick={() => changeBundleQty(b.bundleId, 0)}
                    className="text-xs font-bold text-rose-600 hover:underline disabled:opacity-50"
                  >
                    {t.cart.remove}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Contact capture — powers abandoned-cart recovery */}
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">{t.cart.contactTitle}</h2>
        <p className="text-[11px] text-slate-500">{t.cart.contactText}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.cart.phonePlaceholder} className="rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none" />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.cart.emailPlaceholder} className="rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none" />
        </div>
        {contactNotice ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{contactNotice}</p> : null}
        <button type="button" onClick={saveContact} disabled={busy === "contact" || (!email.trim() && !phone.trim())} className="rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white disabled:opacity-50">
          {busy === "contact" ? t.cart.saving : t.cart.saveContact}
        </button>
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {/* Free Shipping Progress bar */}
        {previewMinor > 0n && (
          <div className="rounded-xl bg-amber-50/80 p-3 text-xs text-amber-900 border border-amber-200/60">
            {previewMinor >= 200000n ? (
              <p className="font-bold text-emerald-700">🎉 অভিনন্দন! আপনি সারাদেশে ফ্রি ডেলিভারি পাচ্ছেন!</p>
            ) : (
              <p className="font-medium">
                🚚 আর মাত্র <b>{formatMinor(200000n - previewMinor)}</b> টাকার কেনাকাটা করলেই <b>ফ্রি ডেলিভারি</b>!
              </p>
            )}
          </div>
        )}

        <div className="flex justify-between text-sm">
          <span className="font-semibold text-slate-600">{t.cart.subtotalPreview}</span>
          <span className="font-extrabold text-slate-900">{formatMinor(previewMinor)}</span>
        </div>
        <p className="text-[11px] text-slate-400">{t.cart.previewNote}</p>
        <Link href={`/shop/${orgSlug}/checkout`} className="btn-brand btn-brand-shadow block rounded-2xl py-3.5 text-center text-sm font-extrabold">
          {t.cart.goCheckout} →
        </Link>
        {/* AB4 (AX5c): express checkout — renders only for a
            logged-in shopper with a live shop session. */}
        <ExpressCheckout orgSlug={orgSlug} ensureCart={() => ensureCartToken(orgSlug)} />
        <Link href={`/shop/${orgSlug}`} className="block text-center text-xs font-bold text-stone-600 hover:text-neutral-900 hover:underline">{t.cart.continueShopping}</Link>

        {/* Fashion Trust Assurances */}
        <div className="border-t border-stone-100 pt-3 space-y-2 text-[11px] text-stone-600">
          <div className="flex items-center gap-2">
            <span>🚚</span>
            <span>ঢাকার ভিতর ২৪-৪৮ ঘণ্টা এক্সপ্রেস ডেলিভারি</span>
          </div>
          <div className="flex items-center gap-2">
            <span>🔄</span>
            <span>৭ দিনের সহজ সাইজ ও কালার এক্সচেঞ্জ গ্যারান্টি</span>
          </div>
          <div className="flex items-center gap-2">
            <span>💵</span>
            <span>ক্যাশ অন ডেলিভারি (পণ্য দেখে মূল্য পরিশোধ)</span>
          </div>
        </div>
      </div>

      {/* AB6 (AX14): cross-sell for the products in this cart. */}
      <CrossSellRail orgSlug={orgSlug} productIds={cart.items.map((i) => i.productId)} locale={locale} />
    </div>
  );
}
