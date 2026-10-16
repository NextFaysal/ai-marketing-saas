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
import { PLATFORM_APEX_DOMAIN } from "@repo/contracts";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { SHOP_ICONS } from "@/lib/icons";
import {
  getCachedCartCount,
  getCachedWishlistCount,
  invalidateCartCount,
  invalidateWishlistCount,
  setCachedCartCount,
  setCachedWishlistCount,
} from "@/lib/shop-header-cache";
import { MediaImage } from "@/components/MediaImage";
import { useBadgeBump } from "@/lib/use-badge-bump";
import { Drawer } from "@repo/ui/client";
import { ShopCartDrawer } from "./ShopCartDrawer";

export function ShopHeader({
  orgSlug,
  shopName,
  logoUrl,
  primaryColor,
  locale = "bn",
  pages,
  theme,
  themeId,
  blog,
}: {
  orgSlug: string;
  shopName: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  locale?: ShopLocale | string;
  pages?: { slug: string; title: string }[];
  theme?: string;
  themeId?: string;
  // AB6 (AX12): show the blog nav link (≥1 published post).
  blog?: boolean;
}) {
  const t = shopT(locale);
  const accent = primaryColor || "#4f46e5";
  const dark = (theme ?? themeId) === "bold";
  const menuPages = pages ?? [];
  const [count, setCount] = useState(0);
  const [wishCount, setWishCount] = useState(0);
  // ED11 (EB4): cart-badge bump key — increments only when the
  // count INCREASES (see lib/use-badge-bump); the badge span is
  // keyed by it so the CSS pulse replays once per add. No
  // drawer auto-open: the bump is the whole feedback (opening
  // the drawer on every add would be obtrusive mid-browsing).
  const cartBumpKey = useBadgeBump(count);
  // ED7 (v2 header only): expandable search row + mobile drawer nav.
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // ED9: v2-only cart drawer state.
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);

  // ED7: the v2 mobile bottom nav's Search item dispatches
  // "shop:open-search" — opening the row mounts the input with
  // autoFocus, which is what focuses it. Cleaned up on unmount.
  useEffect(() => {
    const onOpenSearch = () => setSearchOpen(true);
    window.addEventListener("shop:open-search", onOpenSearch);
    return () => window.removeEventListener("shop:open-search", onOpenSearch);
  }, []);

  // ED5 (EB2): both badges read the shared ~30s header cache first
  // (lib/shop-header-cache) and only fetch when the entry is missing
  // or stale — soft navigations no longer refetch cart + wishlist on
  // every mount. Counts are the same values as before; they may be
  // up to the TTL stale across soft navigations (see the cache lib).
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

  // EC25: wishlist badge — account wishlist size when logged in,
  // the local guest list otherwise.
  const refreshWish = useCallback(async () => {
    const cached = getCachedWishlistCount(orgSlug);
    if (cached !== null) {
      setWishCount(cached);
      return;
    }
    if (getShopSession(orgSlug)) {
      try {
        const out = await fetchWishlist(orgSlug);
        setCachedWishlistCount(orgSlug, out.items.length);
        setWishCount(out.items.length);
        return;
      } catch { /* fall back to the guest list size */ }
    }
    const guestCount = getGuestWishlist(orgSlug).length;
    setCachedWishlistCount(orgSlug, guestCount);
    setWishCount(guestCount);
  }, [orgSlug]);

  useEffect(() => {
    refresh();
    refreshWish();
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ orgSlug?: string }>).detail;
      if (!detail?.orgSlug || detail.orgSlug === orgSlug) {
        // ED5: a cart mutation invalidates the cached count, so the
        // refresh below refetches instead of serving the stale entry.
        invalidateCartCount(orgSlug);
        refresh();
      }
    };
    const onWish = (e: Event) => {
      const detail = (e as CustomEvent<{ orgSlug?: string }>).detail;
      if (!detail?.orgSlug || detail.orgSlug === orgSlug) {
        // ED5: guest-wishlist changes and session changes both
        // invalidate the cached wishlist count before recomputing.
        // (Account-wishlist mutations dispatch no event — TTL-only,
        // documented in lib/shop-header-cache.ts.)
        invalidateWishlistCount(orgSlug);
        refreshWish();
      }
    };
    const onStorage = () => {
      // Cross-tab change: neither cached badge can be trusted.
      invalidateCartCount(orgSlug);
      invalidateWishlistCount(orgSlug);
      refresh();
      refreshWish();
    };
    window.addEventListener(CART_UPDATED_EVENT, onUpdate);
    window.addEventListener(SHOP_SESSION_EVENT, onWish);
    window.addEventListener(GUEST_WISHLIST_EVENT, onWish);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, onUpdate);
      window.removeEventListener(SHOP_SESSION_EVENT, onWish);
      window.removeEventListener(GUEST_WISHLIST_EVENT, onWish);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh, refreshWish, orgSlug]);

  const navLinkCls = dark
    ? "rounded-lg px-3 py-2 text-slate-100 hover:bg-slate-800"
    : "rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100";

  // ED7: v2 header — token surface, ≥44px icon buttons, expandable
  // search row (the SAME GET form mechanism as the hero search),
  // drawer nav below lg and inline text nav at lg+. Legacy themes
  // render the original markup below, byte-identical.
  if (themeId === "v2") {
    const iconBtnCls = "relative flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-[var(--ink-body)] hover:bg-[var(--surface-sunken)]";
    const drawerLinkCls = "flex min-h-11 items-center rounded-[var(--radius-md)] px-3 py-2 text-sm font-semibold text-[var(--ink-body)] hover:bg-[var(--surface-sunken)]";
    return (
      <header className="sticky top-0 z-30 border-b border-[var(--border-soft)] bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 items-center gap-1">
              <button type="button" onClick={() => setDrawerOpen(true)} aria-label={t.chrome.menu} className={`${iconBtnCls} lg:hidden`}>
                <SHOP_ICONS.menu className="h-5 w-5" />
              </button>
              <Link href={`/shop/${orgSlug}`} className="flex min-w-0 items-center gap-2.5">
                {logoUrl ? (
                  <MediaImage src={logoUrl} alt={shopName} width={36} height={36} aspectRatio="1 / 1" className="h-9 w-9 rounded-[var(--radius-md)] border border-[var(--border-soft)] object-cover" />
                ) : (
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-base font-black text-white"
                    style={{ backgroundColor: accent }}
                  >
                    {shopName.slice(0, 1)}
                  </span>
                )}
                <span className="truncate text-base font-black text-[var(--ink-strong)]">{shopName}</span>
              </Link>
            </div>
            <nav className="hidden items-center gap-1 text-sm font-semibold lg:flex">
              <Link href={`/shop/${orgSlug}`} className="rounded-[var(--radius-md)] px-3 py-2 text-[var(--ink-body)] hover:bg-[var(--surface-sunken)]">
                {t.common.home}
              </Link>
              {blog ? (
                <Link href={`/shop/${orgSlug}/blog`} className="rounded-[var(--radius-md)] px-3 py-2 text-[var(--ink-body)] hover:bg-[var(--surface-sunken)]">
                  {t.blog.title}
                </Link>
              ) : null}
              {menuPages.map((p) => (
                <Link key={p.slug} href={`/shop/${orgSlug}/p/${p.slug}`} className="rounded-[var(--radius-md)] px-3 py-2 text-[var(--ink-body)] hover:bg-[var(--surface-sunken)]">
                  {p.title}
                </Link>
              ))}
            </nav>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setSearchOpen((v) => !v)} aria-label={t.chrome.search} aria-expanded={searchOpen} className={iconBtnCls}>
                <SHOP_ICONS.search className="h-5 w-5" />
              </button>
              <Link href={`/shop/${orgSlug}/account?wishlist=1`} className={iconBtnCls} aria-label={t.common.wishlist}>
                <SHOP_ICONS.wishlist className="h-5 w-5" />
                {wishCount > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-bold text-white">
                    {wishCount}
                  </span>
                ) : null}
              </Link>
              <Link href={`/shop/${orgSlug}/account`} className={iconBtnCls} aria-label={t.common.account}>
                <SHOP_ICONS.account className="h-5 w-5" />
              </Link>
              {/* ED9: in v2 the cart button opens the cart drawer
                  instead of navigating; the badge is unchanged
                  and the full cart page stays one tap away
                  (drawer link + bottom nav). */}
              <button type="button" onClick={() => setCartDrawerOpen(true)} className="btn-brand relative flex h-11 items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-3 text-sm font-bold" aria-label={t.common.cart}>
                <SHOP_ICONS.cart className="h-5 w-5" /> <span className="hidden sm:inline">{t.common.cart}</span>
                {count > 0 ? (
                  <span key={cartBumpKey} className={`absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-bold text-white${cartBumpKey > 0 ? " badge-bump" : ""}`}>
                    {count}
                  </span>
                ) : null}
              </button>
            </div>
          </div>
          {searchOpen ? (
            <form method="get" action={`/shop/${orgSlug}`} className="flex gap-2 pb-3">
              <input
                autoFocus
                type="search"
                name="q"
                placeholder={t.home.searchPlaceholder}
                className="w-full rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--ink-strong)] focus:outline-none"
              />
              <button type="submit" className="btn-brand shrink-0 rounded-[var(--radius-md)] px-5 py-2.5 text-sm font-bold">
                {t.home.searchButton}
              </button>
            </form>
          ) : null}
        </div>
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={shopName} side="left">
          <nav className="flex flex-col gap-1">
            <Link href={`/shop/${orgSlug}`} className={drawerLinkCls} onClick={() => setDrawerOpen(false)}>
              {t.common.home}
            </Link>
            {blog ? (
              <Link href={`/shop/${orgSlug}/blog`} className={drawerLinkCls} onClick={() => setDrawerOpen(false)}>
                {t.blog.title}
              </Link>
            ) : null}
            {menuPages.map((p) => (
              <Link key={p.slug} href={`/shop/${orgSlug}/p/${p.slug}`} className={drawerLinkCls} onClick={() => setDrawerOpen(false)}>
                {p.title}
              </Link>
            ))}
            <Link href={`/shop/${orgSlug}/account?wishlist=1`} className={drawerLinkCls} onClick={() => setDrawerOpen(false)}>
              {t.common.wishlist}
            </Link>
            <Link href={`/shop/${orgSlug}/account`} className={drawerLinkCls} onClick={() => setDrawerOpen(false)}>
              {t.common.account}
            </Link>
          </nav>
        </Drawer>
        <ShopCartDrawer orgSlug={orgSlug} locale={locale} open={cartDrawerOpen} onClose={() => setCartDrawerOpen(false)} />
      </header>
    );
  }
  return (
    <header className={dark ? "sticky top-0 z-20 border-b border-slate-800 bg-slate-900/95 backdrop-blur" : "sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur"}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href={`/shop/${orgSlug}`} className="flex min-w-0 items-center gap-2.5">
          {logoUrl ? (
            // ED5 (EB2): shared MediaImage (ED4 contract) — CDN logos
            // get a srcset, others fall back to a plain img with
            // explicit dimensions + lazy loading. Same classes, so
            // the rendered logo is visually unchanged.
            <MediaImage src={logoUrl} alt={shopName} width={36} height={36} aspectRatio="1 / 1" className="h-9 w-9 rounded-xl border border-slate-200 object-cover" />
          ) : (
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl text-base font-black text-white"
              style={{ backgroundColor: accent }}
            >
              {shopName.slice(0, 1)}
            </span>
          )}
          <span className={dark ? "truncate text-base font-black text-white" : "truncate text-base font-black text-slate-900"}>{shopName}</span>
        </Link>
        <nav className="flex items-center gap-2 text-sm font-semibold">
          <Link href={`/shop/${orgSlug}`} className={navLinkCls}>
            {t.common.home}
          </Link>
          {blog ? (
            <Link href={`/shop/${orgSlug}/blog`} className={navLinkCls}>
              {t.blog.title}
            </Link>
          ) : null}
          <Link
            href={`/shop/${orgSlug}/account?wishlist=1`}
            className={`relative ${navLinkCls}`}
            aria-label={t.common.wishlist}
          >
            <SHOP_ICONS.wishlist className="h-5 w-5" /> <span className="hidden sm:inline">{t.common.wishlist}</span>
            {wishCount > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-bold text-white">
                {wishCount}
              </span>
            ) : null}
          </Link>
          <Link href={`/shop/${orgSlug}/account`} className={navLinkCls}>
            <SHOP_ICONS.account className="h-5 w-5" /> {t.common.account}
          </Link>
          {/* TD8 (TB2 carry-over): staff manage the shop ONLY on the
              platform app host — the panel never lives on a shop
              host (TD5), so this is a plain external link. */}
          <a
            href={`https://app.${PLATFORM_APEX_DOMAIN}`}
            className="hidden rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 md:inline"
          >
            ⚙️ {t.common.manageShop}
          </a>
          <Link
            href={`/shop/${orgSlug}/cart`}
            className="relative rounded-lg px-3 py-2 text-white"
            style={{ backgroundColor: accent }}
          >
            <SHOP_ICONS.cart className="h-5 w-5" /> {t.common.cart}
            {count > 0 ? (
              <span key={cartBumpKey} className={`absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-bold text-white${cartBumpKey > 0 ? " badge-bump" : ""}`}>
                {count}
              </span>
            ) : null}
          </Link>
          {menuPages.map((p) => (
            <Link key={p.slug} href={`/shop/${orgSlug}/p/${p.slug}`} className={navLinkCls}>
              {p.title}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
