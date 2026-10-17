"use client";
import React from "react";
import dynamic from "next/dynamic";
import type { ShopLocale } from "@/lib/shop-i18n";
import type { ShopThemeId } from "@/lib/shop-theme";

/**
 * ED6 (EB2) — deferred shop overlays. The shop layout is a Server
 * Component, where next/dynamic's ssr:false is not allowed, so the
 * dynamic imports live in this thin client wrapper. The layout
 * mounts each deferred component at the SAME position its static
 * import occupied, so DOM order (and any stacking tie-breaks
 * between the fixed overlays) is unchanged.
 *
 * Both overlays render NOTHING until client-side state fires:
 * ShopPopup starts with popup=null / visible=false and only shows
 * after its fetch + delay/scroll/exit-intent trigger; ShopSocialProof
 * starts with item=null and only shows after its feed fetch +
 * rotation timers. Their SSR output today is therefore already
 * empty, so ssr:false is behaviour-identical — it only keeps their
 * JS chunks out of every shop page's first load. Trigger logic,
 * frequency markers and rotation live untouched in the components
 * themselves; these wrappers only forward the same props.
 */
const ShopPopupLazy = dynamic(
  () => import("./ShopPopup").then((m) => m.ShopPopup),
  { ssr: false, loading: () => null },
);
const ShopSocialProofLazy = dynamic(
  () => import("./ShopSocialProof").then((m) => m.ShopSocialProof),
  { ssr: false, loading: () => null },
);
const ShopPromotionsLazy = dynamic(
  () => import("./ShopPromotions").then((m) => m.ShopPromotions),
  { ssr: false, loading: () => null },
);

export function ShopPopupDeferred({
  orgSlug,
  locale,
}: {
  orgSlug: string;
  locale?: ShopLocale | string;
}) {
  return <ShopPopupLazy orgSlug={orgSlug} locale={locale} />;
}

/** NF6 (FB3): gamified promotions overlay — same deferred
 * treatment as the popup (renders nothing until its own
 * trigger fires; it requests the ED9 overlay-queue slot under
 * the "promo" id so it never stacks over the shop popup). */
export function ShopPromotionsDeferred({ orgSlug }: { orgSlug: string }) {
  return <ShopPromotionsLazy orgSlug={orgSlug} />;
}

export function ShopSocialProofDeferred({
  orgSlug,
  themeId,
}: {
  orgSlug: string;
  themeId?: ShopThemeId | string;
}) {
  return <ShopSocialProofLazy orgSlug={orgSlug} themeId={themeId} />;
}
