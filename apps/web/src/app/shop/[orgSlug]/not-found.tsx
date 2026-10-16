"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatMinor } from "@repo/contracts";
import { API_URL } from "@/lib/api";
import { shopLocaleOf, shopT } from "@/lib/shop-i18n";
import type { ShopHome } from "@/lib/storefront-server";
import { MediaImage } from "@/components/MediaImage";

function priceText(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

export default function ShopNotFound() {
  const pathname = usePathname();
  const segments = (pathname ?? "").split("/").filter(Boolean);
  const shopIdx = segments.indexOf("shop");
  const orgSlug = shopIdx >= 0 ? (segments[shopIdx + 1] ?? "") : (segments[1] ?? "");
  const [home, setHome] = useState<ShopHome | null>(null);

  useEffect(() => {
    if (!orgSlug) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}`);
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as ShopHome | null;
        if (!cancelled && data) setHome(data);
      } catch {
        /* graceful fallback — generic branding */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgSlug]);

  const locale = home ? shopLocaleOf(home.settings.locale) : "bn";
  const t = shopT(locale);
  const shopName = home?.settings.shopName ?? "";
  const featured = (home?.featuredProducts ?? []).slice(0, 4);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-16 text-center sm:px-6">
      {home?.organization.logoUrl ? (
        <MediaImage src={home.organization.logoUrl} alt={shopName} width={160} height={160} sizes="56px" className="mx-auto h-14 w-14 rounded-2xl border border-slate-200 object-cover" />
      ) : null}
      {shopName ? <p className="text-sm font-bold text-slate-700">{shopName}</p> : null}
      <div>
        <p className="text-7xl font-black text-slate-900">404</p>
        <h1 className="mt-3 text-2xl font-black text-slate-900">{t.shop404.title}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{t.shop404.text}</p>
      </div>
      {orgSlug ? (
        <form method="get" action={`/shop/${orgSlug}`} className="mx-auto flex max-w-md gap-2">
          <input
            type="search"
            name="q"
            placeholder={t.shop404.searchPlaceholder}
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-indigo-600 focus:outline-none"
          />
          <button type="submit" className="shrink-0 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white">
            {t.home.searchButton}
          </button>
        </form>
      ) : null}
      {orgSlug ? (
        <Link href={`/shop/${orgSlug}`} className="inline-block rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white">
          {t.shop404.backHome}
        </Link>
      ) : null}
      {featured.length > 0 ? (
        <section className="space-y-3 text-left">
          <h2 className="text-center text-lg font-black text-slate-900">{t.shop404.featuredHeading}</h2>
          <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {featured.map((p) => (
              <li key={p.id}>
                {p.slug ? (
                  <Link href={`/shop/${orgSlug}/products/${p.slug}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                    <span className="text-sm font-semibold text-slate-800">{p.name}</span>
                    <span className="text-sm font-extrabold text-indigo-700">{priceText(p.priceMinor)}</span>
                  </Link>
                ) : (
                  <span className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="text-sm font-semibold text-slate-800">{p.name}</span>
                    <span className="text-sm font-extrabold text-indigo-700">{priceText(p.priceMinor)}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
