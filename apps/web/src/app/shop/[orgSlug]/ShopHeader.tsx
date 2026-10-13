"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CART_UPDATED_EVENT, fetchCart, cartItemCount } from "@/lib/storefront-cart";
import {
  GUEST_WISHLIST_EVENT,
  SHOP_SESSION_EVENT,
  fetchWishlist,
  getGuestWishlist,
  getShopSession,
} from "@/lib/storefront-account";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";

export function ShopHeader({
  orgSlug,
  shopName,
  logoUrl,
  primaryColor,
  locale = "bn",
}: {
  orgSlug: string;
  shopName: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const accent = primaryColor || "#4f46e5";
  const [count, setCount] = useState(0);
  const [wishCount, setWishCount] = useState(0);

  const refresh = useCallback(async () => {
    const cart = await fetchCart(orgSlug);
    setCount(cartItemCount(cart));
  }, [orgSlug]);

  // EC25: wishlist badge — account wishlist size when logged in,
  // the local guest list otherwise.
  const refreshWish = useCallback(async () => {
    if (getShopSession(orgSlug)) {
      try {
        const out = await fetchWishlist(orgSlug);
        setWishCount(out.items.length);
        return;
      } catch { /* fall back to the guest list size */ }
    }
    setWishCount(getGuestWishlist(orgSlug).length);
  }, [orgSlug]);

  useEffect(() => {
    refresh();
    refreshWish();
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ orgSlug?: string }>).detail;
      if (!detail?.orgSlug || detail.orgSlug === orgSlug) refresh();
    };
    const onWish = (e: Event) => {
      const detail = (e as CustomEvent<{ orgSlug?: string }>).detail;
      if (!detail?.orgSlug || detail.orgSlug === orgSlug) refreshWish();
    };
    window.addEventListener(CART_UPDATED_EVENT, onUpdate);
    window.addEventListener(SHOP_SESSION_EVENT, onWish);
    window.addEventListener(GUEST_WISHLIST_EVENT, onWish);
    window.addEventListener("storage", refresh);
    window.addEventListener("storage", refreshWish);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, onUpdate);
      window.removeEventListener(SHOP_SESSION_EVENT, onWish);
      window.removeEventListener(GUEST_WISHLIST_EVENT, onWish);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("storage", refreshWish);
    };
  }, [refresh, refreshWish, orgSlug]);

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href={`/shop/${orgSlug}`} className="flex min-w-0 items-center gap-2.5">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={shopName} className="h-9 w-9 rounded-xl border border-slate-200 object-cover" />
          ) : (
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl text-base font-black text-white"
              style={{ backgroundColor: accent }}
            >
              {shopName.slice(0, 1)}
            </span>
          )}
          <span className="truncate text-base font-black text-slate-900">{shopName}</span>
        </Link>
        <nav className="flex items-center gap-2 text-sm font-semibold">
          <Link href={`/shop/${orgSlug}`} className="rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100">
            {t.common.home}
          </Link>
          <Link
            href={`/shop/${orgSlug}/account?wishlist=1`}
            className="relative rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100"
            aria-label={t.common.wishlist}
          >
            ❤️ <span className="hidden sm:inline">{t.common.wishlist}</span>
            {wishCount > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-bold text-white">
                {wishCount}
              </span>
            ) : null}
          </Link>
          <Link href={`/shop/${orgSlug}/account`} className="rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100">
            👤 {t.common.account}
          </Link>
          <Link
            href={`/shop/${orgSlug}/cart`}
            className="relative rounded-lg px-3 py-2 text-white"
            style={{ backgroundColor: accent }}
          >
            🛒 {t.common.cart}
            {count > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-bold text-white">
                {count}
              </span>
            ) : null}
          </Link>
        </nav>
      </div>
    </header>
  );
}
