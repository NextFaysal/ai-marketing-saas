"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CART_UPDATED_EVENT, fetchCart, cartItemCount } from "@/lib/storefront-cart";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { SHOP_ICONS } from "@/lib/icons";
import {
  getCachedCartCount,
  invalidateCartCount,
  setCachedCartCount,
} from "@/lib/shop-header-cache";
import { setNavLiftPx, useBuyBarActive } from "@/lib/shop-bottom-chrome";

/**
 * ED7 — v2 mobile bottom navigation. Rendered by the shop layout
 * ONLY for the v2 theme. Four ≥44px items (home / search / cart /
 * account) on the token surface; hides while scrolling down and
 * yields completely while a page-level buy bar owns the bottom
 * (lib/shop-bottom-chrome — ED8 sets that on the PDP).
 */
export function ShopBottomNav({
  orgSlug,
  locale = "bn",
}: {
  orgSlug: string;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const pathname = usePathname();
  const buyBarActive = useBuyBarActive();
  const [count, setCount] = useState(0);
  const [hidden, setHidden] = useState(false);
  const lastYRef = useRef(0);
  const navRef = useRef<HTMLElement | null>(null);

  // ED9: publish this nav's height as the nav bottom lift while
  // it is the bottom-chrome owner on <lg, so floating overlays
  // sit above it. While a buy bar owns the bottom (this nav
  // yields) the nav lift is 0 and the buy bar's own lift rules.
  useEffect(() => {
    if (buyBarActive) {
      setNavLiftPx(0);
      return;
    }
    const mq = window.matchMedia("(max-width: 1023.98px)");
    const measure = () => {
      if (!mq.matches) {
        setNavLiftPx(0);
        return;
      }
      setNavLiftPx(navRef.current?.offsetHeight || 64);
    };
    measure();
    mq.addEventListener?.("change", measure);
    window.addEventListener("resize", measure);
    return () => {
      mq.removeEventListener?.("change", measure);
      window.removeEventListener("resize", measure);
      setNavLiftPx(0);
    };
  }, [buyBarActive]);

  // Cart badge: the same header-cache + event pattern ShopHeader
  // uses (ED5) — cached ~30s, invalidated on cart mutations and
  // cross-tab storage changes, refetched otherwise.
  const refresh = useCallback(async () => {
    const cached = getCachedCartCount(orgSlug);
    if (cached !== null) {
      setCount(cached);
      return;
    }
    const cart = await fetchCart(orgSlug);
    const next = cartItemCount(cart);
    setCachedCartCount(orgSlug, next);
    setCount(next);
  }, [orgSlug]);

  useEffect(() => {
    refresh();
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ orgSlug?: string }>).detail;
      if (!detail?.orgSlug || detail.orgSlug === orgSlug) {
        invalidateCartCount(orgSlug);
        refresh();
      }
    };
    const onStorage = () => {
      invalidateCartCount(orgSlug);
      refresh();
    };
    window.addEventListener(CART_UPDATED_EVENT, onUpdate);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, onUpdate);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh, orgSlug]);

  // Hide on scroll down (>8px), show on scroll up, always show
  // near the top of the page.
  useEffect(() => {
    lastYRef.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const last = lastYRef.current;
      if (y < 120) {
        setHidden(false);
        lastYRef.current = y;
      } else if (y - last > 8) {
        setHidden(true);
        lastYRef.current = y;
      } else if (last - y > 8) {
        setHidden(false);
        lastYRef.current = y;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // A buy bar owns the bottom edge — yield completely.
  if (buyBarActive) return null;

  const homePath = `/shop/${orgSlug}`;
  const cartPath = `/shop/${orgSlug}/cart`;
  const accountPath = `/shop/${orgSlug}/account`;
  const itemCls = (active: boolean) =>
    `flex min-h-11 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold ${
      active ? "text-[var(--brand)]" : "text-[var(--ink-muted)]"
    }`;

  return (
    <nav
      ref={navRef}
      aria-label={t.chrome.menu}
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border-soft)] bg-[var(--surface)] transition-transform duration-200 lg:hidden ${
        hidden ? "translate-y-full" : "translate-y-0"
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-4">
        <Link href={homePath} className={itemCls(pathname === homePath)} aria-current={pathname === homePath ? "page" : undefined}>
          <SHOP_ICONS.home className="h-5 w-5" />
          {t.common.home}
        </Link>
        <button
          type="button"
          className={itemCls(false)}
          onClick={() => {
            window.dispatchEvent(new CustomEvent("shop:open-search"));
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <SHOP_ICONS.search className="h-5 w-5" />
          {t.chrome.search}
        </button>
        <Link
          href={cartPath}
          className={itemCls(pathname === cartPath)}
          aria-current={pathname === cartPath ? "page" : undefined}
        >
          <span className="relative">
            <SHOP_ICONS.cart className="h-5 w-5" />
            {count > 0 ? (
              <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                {count}
              </span>
            ) : null}
          </span>
          {t.common.cart}
        </Link>
        <Link
          href={accountPath}
          className={itemCls(pathname === accountPath || (pathname?.startsWith(`${accountPath}/`) ?? false))}
          aria-current={pathname === accountPath || (pathname?.startsWith(`${accountPath}/`) ?? false) ? "page" : undefined}
        >
          <SHOP_ICONS.account className="h-5 w-5" />
          {t.common.account}
        </Link>
      </div>
    </nav>
  );
}
