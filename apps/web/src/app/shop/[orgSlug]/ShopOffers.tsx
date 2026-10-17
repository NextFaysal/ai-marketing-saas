"use client";
import React, { useEffect, useState } from "react";
import {
  isStandaloneDisplay, offerLabel, visibleOffers, type PublicShopOffer,
} from "@/lib/app-offers-nf14";

/**
 * NF14 (FB5) — storefront offers strip (shop home).
 *
 * Renders the shop's active public offers from the API's
 * /public/shop/:slug/offers payload. The NF14 display rule is
 * applied here via lib/app-offers-nf14: app-only offers appear
 * ONLY when the shop runs as the installed app (standalone
 * display mode). Standalone is a client-only signal, so the
 * first render assumes a normal browser tab (app-only offers
 * hidden) and the effect corrects it after mount — an app-only
 * offer can never flash into a browser tab.
 *
 * DISPLAY ONLY: hiding an offer here never blocks its code —
 * a shared app-only code still redeems at checkout (the API
 * spec proves evaluation ignores the flag).
 */
export function ShopOffers({ offers, accent }: { offers: PublicShopOffer[]; accent: string }) {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    setStandalone(isStandaloneDisplay());
  }, []);
  const visible = visibleOffers(offers, standalone);
  if (visible.length === 0) return null;
  return (
    <section aria-label="চলমান অফার" className="space-y-3">
      <h2 className="text-xl font-black text-slate-900">🎁 চলমান অফার</h2>
      <div className="flex flex-wrap gap-2">
        {visible.map((o) => (
          <div
            key={o.id}
            className="flex items-center gap-2 rounded-2xl border border-dashed bg-white px-4 py-2.5 text-sm shadow-sm"
            style={{ borderColor: accent }}
          >
            <span className="font-black" style={{ color: accent }}>{offerLabel(o)}</span>
            <span className="text-slate-500">কোড:</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono font-bold tracking-wide">{o.code}</span>
            {o.minOrderMinor ? (
              <span className="text-xs text-slate-500">
                কমপক্ষে ৳{(Number(o.minOrderMinor) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })} অর্ডারে
              </span>
            ) : null}
            {o.appOnly ? (
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700">শুধু অ্যাপে</span>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400">চেকআউটে কোডটি বসালেই ছাড় প্রযোজ্য হবে।</p>
    </section>
  );
}
