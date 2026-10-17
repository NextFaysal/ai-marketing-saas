"use client";
import React, { useCallback, useEffect, useState } from "react";
import {
  GUEST_WISHLIST_EVENT,
  SHOP_SESSION_EVENT,
  addWishlist,
  fetchWishlist,
  getShopSession,
  guestWishlistAdd,
  guestWishlistHas,
  guestWishlistRemove,
  removeWishlist,
} from "@/lib/storefront-account";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";

/**
 * EC25 — wishlist heart toggle. Guests keep a local productId
 * list; logged-in shoppers use the account wishlist (fetched once
 * per mount). Optimistic: on API error the toggle silently
 * reverts. Sits inside card <Link>s, so it must never navigate.
 */
export function WishlistHeart({
  orgSlug,
  productId,
  locale = "bn",
  className = "",
  large = false,
}: {
  orgSlug: string;
  productId: string;
  locale?: ShopLocale | string;
  className?: string;
  /** ED8: v2 cards only — enlarges the hit area to 44px.
   * Default false renders exactly as before. */
  large?: boolean;
}) {
  const t = shopT(locale);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (getShopSession(orgSlug)) {
      try {
        const out = await fetchWishlist(orgSlug);
        setActive(out.items.some((i) => i.productId === productId));
      } catch {
        setActive(guestWishlistHas(orgSlug, productId));
      }
    } else {
      setActive(guestWishlistHas(orgSlug, productId));
    }
  }, [orgSlug, productId]);

  useEffect(() => {
    refresh();
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ orgSlug?: string }>).detail;
      if (!detail?.orgSlug || detail.orgSlug === orgSlug) refresh();
    };
    window.addEventListener(SHOP_SESSION_EVENT, onChange);
    window.addEventListener(GUEST_WISHLIST_EVENT, onChange);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SHOP_SESSION_EVENT, onChange);
      window.removeEventListener(GUEST_WISHLIST_EVENT, onChange);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh, orgSlug]);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const next = !active;
    setActive(next);
    if (!getShopSession(orgSlug)) {
      if (next) guestWishlistAdd(orgSlug, productId);
      else guestWishlistRemove(orgSlug, productId);
      return;
    }
    setBusy(true);
    try {
      if (next) await addWishlist(orgSlug, productId);
      else await removeWishlist(orgSlug, productId);
    } catch {
      setActive(!next); // revert silently
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-label={active ? t.product.removeFromWishlist : t.product.addToWishlist}
      title={active ? t.product.removeFromWishlist : t.product.addToWishlist}
      className={`flex ${large ? "h-11 w-11" : "h-9 w-9"} items-center justify-center rounded-full bg-white/95 text-lg shadow-md ring-1 ring-slate-200 transition hover:scale-110 disabled:opacity-60 ${active ? "text-rose-600" : "text-slate-400"} ${className}`}
    >
      {active ? "❤️" : "🤍"}
    </button>
  );
}
