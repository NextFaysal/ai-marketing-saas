import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchShopBrand, fetchShopHome } from "@/lib/storefront-server";
import { shopLocaleOf, shopT } from "@/lib/shop-i18n";
import { effectiveThemeId, themeOf } from "@/lib/shop-theme";
import { ProductCard } from "../../ProductCard";
import { MediaImage } from "@/components/MediaImage";

type Params = Promise<{ orgSlug: string; brandSlug: string }>;
type Search = Promise<{ page?: string; themePreview?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug, brandSlug } = await params;
  const data = await fetchShopBrand(orgSlug, brandSlug);
  if (!data) return { title: shopT("bn").common.shopNotFound };
  return {
    title: data.brand.name,
    description: data.brand.description ?? undefined,
    openGraph: {
      title: data.brand.name,
      description: data.brand.description ?? undefined,
      images: data.brand.logoUrl ? [data.brand.logoUrl] : undefined,
    },
  };
}

export default async function ShopBrandPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { orgSlug, brandSlug } = await params;
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const [data, home] = await Promise.all([
    fetchShopBrand(orgSlug, brandSlug, String(page), "24"),
    fetchShopHome(orgSlug),
  ]);
  // Unknown / unpublished brand → the shop's existing not-found surface.
  if (!data) notFound();

  const { brand, products, pagination } = data;
  const locale = shopLocaleOf(home?.settings.locale);
  const t = shopT(locale);
  // ED8: effective theme (?themePreview= wins when valid), so
  // brand-page cards follow the same v2 switch as the listing.
  const theme = themeOf(effectiveThemeId(home?.settings.themeId, sp.themePreview));
  const accent = home?.organization.primaryColor || "#4f46e5";

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
      <nav className="text-xs font-semibold text-slate-500">
        <Link href={`/shop/${orgSlug}`} className="hover:text-indigo-700">{t.common.home}</Link>
        <span className="mx-1.5">/</span>
        <span className="text-slate-800">{brand.name}</span>
      </nav>

      {/* Brand header */}
      <section className={theme.heroClass}>
        {brand.logoUrl ? (
          <MediaImage src={brand.logoUrl} alt={brand.name} width={160} height={160} sizes="80px" className="mx-auto h-20 w-20 rounded-2xl border border-slate-200 bg-white object-contain" />
        ) : null}
        <h1 className={theme.heroTitleClass}>{brand.name}</h1>
        <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">{t.brand.brandLabel}</p>
        {brand.description ? (
          <p className={`mx-auto mt-2 max-w-xl whitespace-pre-line text-sm ${home?.settings.themeId === "bold" ? "text-slate-300" : "text-slate-500"}`}>{brand.description}</p>
        ) : null}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black text-slate-900">
            {t.brand.brandProductsHeading}
            <span className="ml-2 text-sm font-semibold text-slate-400">({pagination.total}{t.home.itemsSuffix})</span>
          </h2>
          <Link
            href={`/shop/${orgSlug}?brand=${encodeURIComponent(brand.slug)}`}
            className="rounded-lg px-4 py-2 text-xs font-bold text-white"
            style={{ backgroundColor: accent }}
          >
            {t.home.viewAllProducts}
          </Link>
        </div>
        {products.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-3xl">🔍</p>
            <p className="mt-2 text-sm font-semibold text-slate-600">{t.home.emptyNoProducts}</p>
          </div>
        ) : (
          <div className={theme.gridClass}>
            {products.map((p) => (
              <ProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} theme={theme} />
            ))}
          </div>
        )}

        {pagination.totalPages > 1 ? (
          <nav className="flex items-center justify-center gap-2 pt-2">
            {page > 1 ? (
              <Link href={`/shop/${orgSlug}/brands/${brandSlug}?page=${page - 1}`} className="rounded-lg border bg-white px-4 py-2 text-xs font-bold text-slate-700">
                {t.home.prevPage}
              </Link>
            ) : null}
            <span className="text-xs font-semibold text-slate-500">{t.home.page} {pagination.page} / {pagination.totalPages}</span>
            {page < pagination.totalPages ? (
              <Link href={`/shop/${orgSlug}/brands/${brandSlug}?page=${page + 1}`} className="rounded-lg border bg-white px-4 py-2 text-xs font-bold text-slate-700">
                {t.home.nextPage}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
