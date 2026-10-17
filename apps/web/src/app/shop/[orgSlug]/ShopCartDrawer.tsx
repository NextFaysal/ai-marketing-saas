"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatMinor } from "@repo/contracts";
import { Drawer } from "@repo/ui/client";
import { MediaImage } from "@/components/MediaImage";
import {
  CART_UPDATED_EVENT,
  fetchCart,
  patchCartLine,
  type Cart,
} from "@/lib/storefront-cart";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";

function money(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

/**
 * ED9 — v2 cart drawer, opened from the v2 ShopHeader cart
 * button (the header mounts it; legacy headers never do).
 *
 * Behaviour mirrors the cart page exactly: data comes from
 * fetchCart on open and refreshes on CART_UPDATED_EVENT while
 * open; product-line mutations call patchCartLine with the same
 * argument shape the cart page uses (productId / variantId /
 * quantity / includeBump), and patchCartLine itself dispatches
 * CART_UPDATED_EVENT, so the header badge updates through the
 * existing flow. Bundle lines are rendered read-only (badge +
 * contents + totals, mirroring the cart page's treatment) — a
 * bundle's quantity/picks are managed on the full cart page.
 * The full cart page is unchanged and fully functional.
 */
export function ShopCartDrawer({
  orgSlug,
  locale = "bn",
  open,
  onClose,
}: {
  orgSlug: string;
  locale?: ShopLocale | string;
  open: boolean;
  onClose: () => void;
}) {
  const t = shopT(locale);
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const c = await fetchCart(orgSlug);
    setCart(c);
    setLoading(false);
  }, [orgSlug]);

  useEffect(() => {
    if (!open) return;
    load();
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ orgSlug?: string }>).detail;
      if (!detail?.orgSlug || detail.orgSlug === orgSlug) load();
    };
    window.addEventListener(CART_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(CART_UPDATED_EVENT, onUpdate);
  }, [open, load, orgSlug]);

  // Same line-update pattern as the cart page's changeQty.
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

  const isEmpty = !cart || (cart.items.length === 0 && (cart.bundleItems ?? []).length === 0);

  // Subtotal preview: the cart page's exact computation (line
  // totals + accepted bumps + bundle line totals).
  let previewMinor = 0n;
  if (cart) {
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
  }

  return (
    <Drawer open={open} onClose={onClose} title={t.cart.title} side="right">
      {loading && !cart ? (
        <p className="py-8 text-center text-sm font-semibold text-[var(--ink-muted)]">{t.cart.loading}</p>
      ) : isEmpty ? (
        <div className="space-y-3 py-8 text-center">
          <p className="text-4xl">🛒</p>
          <p className="text-base font-black text-[var(--ink-strong)]">{t.cart.emptyTitle}</p>
          <p className="text-sm text-[var(--ink-muted)]">{t.cart.emptyText}</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] border border-[var(--border-soft)] px-5 py-2.5 text-sm font-bold text-[var(--ink-body)]"
          >
            {t.chrome.close}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}
          <div className="space-y-3">
            {cart.items.map((item) => (
              <div key={item.id} className="flex gap-3 rounded-[var(--radius-lg)] border border-[var(--border-soft)] bg-[var(--surface)] p-3">
                {item.imageUrl ? (
                  <MediaImage src={item.imageUrl} alt={item.productName ?? ""} width={128} height={128} sizes="64px" className="h-16 w-16 shrink-0 rounded-[var(--radius-md)] border border-[var(--border-soft)] object-cover" />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-soft)] text-2xl">📦</div>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-[var(--ink-strong)]">{item.productName ?? t.cart.productFallback}</p>
                      {item.variantName ? <p className="text-[11px] text-[var(--ink-muted)]">{item.variantName}</p> : null}
                      <p className="text-xs text-[var(--ink-muted)]">{t.cart.unitPrice} {money(item.unitPriceMinor)}</p>
                    </div>
                    <p className="shrink-0 text-sm font-extrabold text-[var(--brand)]">{money(item.lineTotalMinor)}</p>
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

          {/* Bundle lines: read-only (quantity/picks live on the
              full cart page), with the cart page's badge +
              contents treatment. */}
          {(cart.bundleItems ?? []).map((b) => (
            <div key={b.id} className="flex gap-3 rounded-[var(--radius-lg)] border border-amber-200 bg-[var(--surface)] p-3">
              {b.imageUrl ? (
                <MediaImage src={b.imageUrl} alt={b.name} width={128} height={128} sizes="64px" className="h-16 w-16 shrink-0 rounded-[var(--radius-md)] border border-[var(--border-soft)] object-cover" />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-amber-50 text-2xl">🎁</div>
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[var(--ink-strong)]">
                      {b.name}{" "}
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">{t.cart.bundleBadge}</span>
                    </p>
                    <p className="text-xs text-[var(--ink-muted)]">{t.cart.unitPrice} {money(b.bundlePriceMinor)} × {b.quantity}</p>
                  </div>
                  <p className="shrink-0 text-sm font-extrabold text-[var(--brand)]">{money(b.lineTotalMinor)}</p>
                </div>
                <details className="text-xs text-slate-600">
                  <summary className="cursor-pointer font-semibold text-slate-700">{t.cart.bundleContents}</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {b.components.map((c) => (
                      <li key={`${c.productId}-${c.variantSku ?? ""}`}>{c.name}{c.variantSku ? ` (${c.variantSku})` : ""} × {c.qty}{c.viaSlot ? <span className="ml-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">{c.viaSlot}</span> : null}</li>
                    ))}
                  </ul>
                </details>
              </div>
            </div>
          ))}

          <div className="space-y-3 border-t border-[var(--border-soft)] pt-3">
            <div className="flex justify-between text-sm">
              <span className="font-semibold text-[var(--ink-muted)]">{t.cart.subtotalPreview}</span>
              <span className="font-extrabold text-[var(--ink-strong)]">{formatMinor(previewMinor)}</span>
            </div>
            <Link
              href={`/shop/${orgSlug}/checkout`}
              onClick={onClose}
              className="btn-brand btn-brand-shadow block rounded-[var(--radius-lg)] py-3.5 text-center text-sm font-extrabold"
            >
              {t.cart.goCheckout}
            </Link>
            <Link
              href={`/shop/${orgSlug}/cart`}
              onClick={onClose}
              className="block text-center text-xs font-bold text-[var(--brand)] hover:underline"
            >
              {t.cart.fullCartPage}
            </Link>
          </div>
        </div>
      )}
    </Drawer>
  );
}
