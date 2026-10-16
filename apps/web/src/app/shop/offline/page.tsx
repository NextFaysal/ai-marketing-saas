import React from "react";
import { shopT } from "@/lib/shop-i18n";
import { ShopOfflineRetry } from "./ShopOfflineRetry";

export const metadata = { title: "অফলাইন — Offline" };

/**
 * ED10 (EB4) — shop offline fallback page, served at
 * /shop/offline (the static "offline" segment wins over the
 * sibling [orgSlug] dynamic segment, so this never renders a
 * shop). The shop worker (lib/shop-sw) precaches this URL on
 * install and serves it when a shop navigation fails offline
 * and neither that page nor the shop's home is in the page
 * cache.
 *
 * Deliberately static: NO data fetching of any kind — it must
 * render with zero network, so it cannot know which shop (or
 * which locale) the visitor came from. Copy therefore leads
 * with the bn dictionary and follows with the en one, both
 * straight from lib/shop-i18n (pure imports, no fetch).
 * Platform-neutral on purpose: no shop name, no platform
 * branding — any shop's visitor may land here.
 */
export default function ShopOfflinePage() {
  const bn = shopT("bn");
  const en = shopT("en");
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl" aria-hidden="true">📡</div>
      <h1 className="mt-4 text-2xl font-bold text-slate-900">{bn.offline.title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">{bn.offline.text}</p>
      <p className="mt-3 text-sm font-semibold text-slate-700">{en.offline.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{en.offline.text}</p>
      <ShopOfflineRetry label={`${bn.offline.retry} · ${en.offline.retry}`} />
    </main>
  );
}
