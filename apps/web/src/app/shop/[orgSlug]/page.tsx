import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchShopHome, fetchShopOffers, shopSortOf } from "@/lib/storefront-server";
import { shopLocaleOf, shopT } from "@/lib/shop-i18n";
import { effectiveThemeId, themeOf } from "@/lib/shop-theme";
import { orderedVisibleSections, sectionVisibilityOf, type ShopSectionKey } from "@/lib/shop-sections";
import { buildShopJsonLd, canonicalShopBase, canonicalShopUrlAt, jsonLdScript } from "@/lib/storefront-seo";
import { sitemapUrlBase } from "@/lib/storefront-sitemap";
import { ProductCard } from "./ProductCard";
import { FlashCountdown } from "./FlashCountdown";
import { ShopOffers } from "./ShopOffers";
import { AffiliateRefCapture } from "./AffiliateRefCapture";
import { BundleCard } from "./BundleCard";
import { RecentlyViewedStrip } from "./RecentlyViewed";
import { SortSelect } from "./SortSelect";
import { FashionProductCard, FashionThemeHome } from "./FashionTheme";
import { ElectronicsProductCard, ElectronicsThemeHome } from "./ElectronicsTheme";
import { GroceryProductCard, GroceryThemeHome } from "./GroceryTheme";
import { BeautyProductCard, BeautyThemeHome } from "./BeautyTheme";
import { FurnitureProductCard, FurnitureThemeHome } from "./FurnitureTheme";
import { BooksProductCard, BooksThemeHome } from "./BooksTheme";
import { KidsProductCard, KidsThemeHome } from "./KidsTheme";
import { AutomotiveProductCard, AutomotiveThemeHome } from "./AutomotiveTheme";
import { SportsProductCard, SportsThemeHome } from "./SportsTheme";
import { JewelryProductCard, JewelryThemeHome } from "./JewelryTheme";
import { ListingFilterDrawer, type ListingFilterSection } from "./ListingFilterDrawer";

type Params = Promise<{ orgSlug: string }>;
type Search = Promise<{ q?: string; category?: string; page?: string; sort?: string; brand?: string; themePreview?: string; locale?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug } = await params;
  const home = await fetchShopHome(orgSlug);
  if (!home) return { title: shopT("bn").common.shopNotFound };
  const cover = home.featuredProducts[0]?.imageUrl ?? home.products[0]?.imageUrl ?? null;
  // TD7: the canonical URL lives on the shop's canonical HOST
  // (verified custom domain, else the tenant subdomain) at its root.
  const canonical = canonicalShopUrlAt(canonicalShopBase(home.organization));
  return {
    title: home.settings.shopName,
    description: home.settings.metaDescription ?? undefined,
    // EC27: canonical + OG URL for the shop home.
    alternates: { canonical },
    openGraph: {
      title: home.settings.shopName,
      description: home.settings.metaDescription ?? undefined,
      url: canonical,
      images: cover ? [cover] : undefined,
    },
  };
}

function shopHref(orgSlug: string, q: string, category: string, page: number, sort = "featured", brand = ""): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (brand) params.set("brand", brand);
  if (sort && sort !== "featured") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/shop/${orgSlug}${qs ? `?${qs}` : ""}`;
}

export default async function ShopHomePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const category = (sp.category ?? "").trim();
  const brand = (sp.brand ?? "").trim();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const sort = shopSortOf(sp.sort);

  // NF5 (FB3): forward the shopper's ?locale= choice (bn|en|hi)
  // to the API on the same route; absent = the shop's own locale.
  const home = await fetchShopHome(orgSlug, q, category, String(page), "24", sort, brand, undefined, (sp.locale ?? "").trim() || undefined);
  if (!home) notFound();
  // NF14 (FB5): active public offers for the offers strip
  // (failure-isolated — no offers payload, no strip).
  const offersPayload = await fetchShopOffers(orgSlug).catch(() => null);
  const offers = offersPayload?.offers ?? [];

  const { settings, categories, featuredProducts, products, pagination } = home;
  const brands = home.brands ?? [];
  const accent = home.organization.primaryColor || "#4f46e5";
  const filtering = !!q || !!category || !!brand;
  const locale = shopLocaleOf(settings.locale);
  const t = shopT(locale);
  // ED8: render with the EFFECTIVE theme (?themePreview= wins
  // when valid) — the hero/grid/card tokens all follow from this.
  const effThemeId = effectiveThemeId(settings.themeId, sp.themePreview);
  const theme = themeOf(effThemeId);
  const isV2 = effThemeId === "v2";

  // ED8: precomputed link lists for the v2 mobile filter drawer —
  // the SAME shopHref URLs and active rules as the inline chips
  // and SortSelect below; the drawer adds no navigation logic.
  const filterSections: ListingFilterSection[] = [];
  if (settings.showCategories && categories.length > 0) {
    filterSections.push({
      heading: t.chrome.categories,
      links: [
        { label: t.home.allProducts, href: shopHref(orgSlug, q, "", 1, sort, brand), active: !category },
        ...categories.map((c) => {
          const value = c.slug ?? c.id ?? c.name;
          return {
            label: `${c.name} (${c.productCount})`,
            href: shopHref(orgSlug, q, value, 1, sort, brand),
            active: category === value || category === c.name || (c.id ? category === c.id : false),
          };
        }),
      ],
    });
  }
  if (brands.length > 0) {
    filterSections.push({
      heading: t.brand.brandLabel,
      links: [
        { label: t.brand.allBrands, href: shopHref(orgSlug, q, category, 1, sort, ""), active: !brand },
        ...brands.map((b) => ({
          label: `${b.name} (${b.productCount})`,
          href: shopHref(orgSlug, q, category, 1, sort, b.slug),
          active: brand === b.slug,
        })),
      ],
    });
  }
  filterSections.push({
    heading: t.sort.label,
    links: (
      [
        ["featured", t.sort.featured],
        ["newest", t.sort.newest],
        ["price_asc", t.sort.priceAsc],
        ["price_desc", t.sort.priceDesc],
        ["best_selling", t.sort.bestSelling],
        ["name_asc", t.sort.nameAsc],
      ] as const
    ).map(([value, label]) => ({
      label,
      href: shopHref(orgSlug, q, category, 1, value, brand),
      active: sort === value,
    })),
  });
  const activeFilterCount = (category ? 1 : 0) + (brand ? 1 : 0) + (sort !== "featured" ? 1 : 0);

  if (settings.themeId === "fashion" && !filtering) {
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              buildShopJsonLd({
                base: sitemapUrlBase(),
                orgSlug,
                shopName: settings.shopName,
                description: settings.metaDescription,
                logoUrl: home.organization.logoUrl,
              }),
            ),
          }}
        />
        <AffiliateRefCapture orgSlug={orgSlug} />
        <FashionThemeHome
          orgSlug={orgSlug}
          home={home}
          q={q}
          category={category}
          brand={brand}
          page={page}
          sort={sort}
        />
      </>
    );
  }

  if (settings.themeId === "electronics" && !filtering) {
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              buildShopJsonLd({
                base: sitemapUrlBase(),
                orgSlug,
                shopName: settings.shopName,
                description: settings.metaDescription,
                logoUrl: home.organization.logoUrl,
              }),
            ),
          }}
        />
        <AffiliateRefCapture orgSlug={orgSlug} />
        <ElectronicsThemeHome
          orgSlug={orgSlug}
          home={home}
          locale={locale}
        />
      </>
    );
  }

  if (settings.themeId === "grocery" && !filtering) {
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              buildShopJsonLd({
                base: sitemapUrlBase(),
                orgSlug,
                shopName: settings.shopName,
                description: settings.metaDescription,
                logoUrl: home.organization.logoUrl,
              }),
            ),
          }}
        />
        <AffiliateRefCapture orgSlug={orgSlug} />
        <GroceryThemeHome
          orgSlug={orgSlug}
          home={home}
          locale={locale}
        />
      </>
    );
  }

  if (settings.themeId === "beauty" && !filtering) {
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              buildShopJsonLd({
                base: sitemapUrlBase(),
                orgSlug,
                shopName: settings.shopName,
                description: settings.metaDescription,
                logoUrl: home.organization.logoUrl,
              }),
            ),
          }}
        />
        <AffiliateRefCapture orgSlug={orgSlug} />
        <BeautyThemeHome
          orgSlug={orgSlug}
          home={home}
          locale={locale}
        />
      </>
    );
  }

  if (settings.themeId === "furniture" && !filtering) {
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              buildShopJsonLd({
                base: sitemapUrlBase(),
                orgSlug,
                shopName: settings.shopName,
                description: settings.metaDescription,
                logoUrl: home.organization.logoUrl,
              }),
            ),
          }}
        />
        <AffiliateRefCapture orgSlug={orgSlug} />
        <FurnitureThemeHome
          orgSlug={orgSlug}
          home={home}
          locale={locale}
        />
      </>
    );
  }

  if (settings.themeId === "books" && !filtering) {
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              buildShopJsonLd({
                base: sitemapUrlBase(),
                orgSlug,
                shopName: settings.shopName,
                description: settings.metaDescription,
                logoUrl: home.organization.logoUrl,
              }),
            ),
          }}
        />
        <AffiliateRefCapture orgSlug={orgSlug} />
        <BooksThemeHome
          orgSlug={orgSlug}
          home={home}
          locale={locale}
        />
      </>
    );
  }

  if (settings.themeId === "kids" && !filtering) {
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              buildShopJsonLd({
                base: sitemapUrlBase(),
                orgSlug,
                shopName: settings.shopName,
                description: settings.metaDescription,
                logoUrl: home.organization.logoUrl,
              }),
            ),
          }}
        />
        <AffiliateRefCapture orgSlug={orgSlug} />
        <KidsThemeHome
          orgSlug={orgSlug}
          home={home}
          locale={locale}
        />
      </>
    );
  }

  if (settings.themeId === "automotive" && !filtering) {
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              buildShopJsonLd({
                base: sitemapUrlBase(),
                orgSlug,
                shopName: settings.shopName,
                description: settings.metaDescription,
                logoUrl: home.organization.logoUrl,
              }),
            ),
          }}
        />
        <AffiliateRefCapture orgSlug={orgSlug} />
        <AutomotiveThemeHome
          orgSlug={orgSlug}
          home={home}
          locale={locale}
        />
      </>
    );
  }

  if (settings.themeId === "sports" && !filtering) {
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              buildShopJsonLd({
                base: sitemapUrlBase(),
                orgSlug,
                shopName: settings.shopName,
                description: settings.metaDescription,
                logoUrl: home.organization.logoUrl,
              }),
            ),
          }}
        />
        <AffiliateRefCapture orgSlug={orgSlug} />
        <SportsThemeHome
          orgSlug={orgSlug}
          home={home}
          locale={locale}
        />
      </>
    );
  }

  if (settings.themeId === "jewelry" && !filtering) {
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              buildShopJsonLd({
                base: sitemapUrlBase(),
                orgSlug,
                shopName: settings.shopName,
                description: settings.metaDescription,
                logoUrl: home.organization.logoUrl,
              }),
            ),
          }}
        />
        <AffiliateRefCapture orgSlug={orgSlug} />
        <JewelryThemeHome
          orgSlug={orgSlug}
          home={home}
          locale={locale}
        />
      </>
    );
  }
  // OU8: section customizer — the home sections are collected
  // into a keyed record and rendered in the merchant's stored
  // order, minus the sections they hid (lib/shop-sections is the
  // single source of the render list; the product grid below is
  // not a section — it always renders last).
  const sectionTitle = isV2 ? theme.sectionTitleClass : `text-xl font-black ${theme.headerDark ? "text-slate-100" : "text-slate-900"}`;
  const sectionNodes: Record<ShopSectionKey, React.ReactNode> = {
    hero: (
<section className={theme.heroClass}>
  <h1 className={theme.heroTitleClass}>{settings.shopName}</h1>
  {settings.metaDescription ? <p className={`mx-auto mt-2 max-w-xl text-sm ${theme.headerDark ? "text-slate-300" : "text-slate-500"}`}>{settings.metaDescription}</p> : null}
  {settings.showSearch ? (
    <form method="get" action={`/shop/${orgSlug}`} className="mx-auto mt-5 flex max-w-md gap-2">
      {category ? <input type="hidden" name="category" value={category} /> : null}
      {brand ? <input type="hidden" name="brand" value={brand} /> : null}
      <input
        type="search"
        name="q"
        defaultValue={q}
        placeholder={t.home.searchPlaceholder}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none"
      />
      <button type="submit" className="shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold text-white" style={{ backgroundColor: accent }}>
        {t.home.searchButton}
      </button>
    </form>
  ) : null}
</section>
    ),
    categories: (
settings.showCategories && categories.length > 0 ? (
  <section className="flex flex-wrap items-center gap-2">
    <Link
      href={shopHref(orgSlug, q, "", 1, sort, brand)}
      className={`rounded-full px-4 py-1.5 text-xs font-bold ${!category ? "text-white" : "bg-white text-slate-700 border border-slate-200"}`}
      style={!category ? { backgroundColor: accent } : undefined}
    >
      {t.home.allProducts}
    </Link>
    {categories.map((c) => {
      const value = c.slug ?? c.id ?? c.name;
      const active = category === value || category === c.name || (c.id ? category === c.id : false);
      return (
        <Link
          key={`${c.id ?? "legacy"}-${c.name}`}
          href={shopHref(orgSlug, q, value, 1, sort, brand)}
          className={`rounded-full px-4 py-1.5 text-xs font-bold ${active ? "text-white" : "bg-white text-slate-700 border border-slate-200"}`}
          style={active ? { backgroundColor: accent } : undefined}
        >
          {c.name} ({c.productCount})
        </Link>
      );
    })}
  </section>
) : null
    ),
    brands: (
brands.length > 0 ? (
  <section className="flex flex-wrap items-center gap-2">
    <span className="text-xs font-bold text-slate-500">{t.brand.brandLabel}:</span>
    <Link
      href={shopHref(orgSlug, q, category, 1, sort, "")}
      className={`rounded-full px-4 py-1.5 text-xs font-bold ${!brand ? "text-white" : "bg-white text-slate-700 border border-slate-200"}`}
      style={!brand ? { backgroundColor: accent } : undefined}
    >
      {t.brand.allBrands}
    </Link>
    {brands.map((b) => {
      const active = brand === b.slug;
      return (
        <Link
          key={b.id}
          href={shopHref(orgSlug, q, category, 1, sort, b.slug)}
          className={`rounded-full px-4 py-1.5 text-xs font-bold ${active ? "text-white" : "bg-white text-slate-700 border border-slate-200"}`}
          style={active ? { backgroundColor: accent } : undefined}
        >
          {b.name} ({b.productCount})
        </Link>
      );
    })}
  </section>
) : null
    ),
    bundles: (
(home.bundles ?? []).length > 0 && !filtering ? (
  <section className="space-y-4">
    <h2 className={sectionTitle}>{t.home.bundlesHeading}</h2>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {(home.bundles ?? []).map((b) => (
        <BundleCard key={b.id} orgSlug={orgSlug} bundle={b} locale={locale} />
      ))}
    </div>
  </section>
) : null
    ),
    flash: (
(home.flashSales?.sales ?? []).length > 0 ? (
  <section className="space-y-4 rounded-3xl border border-rose-200 bg-rose-50 p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-xl font-black text-rose-700">⚡ {t.home.flashSale}</h2>
      <span className="text-sm text-rose-700">
        <FlashCountdown endsAt={home.flashSales!.sales[0].endsAt} serverNow={home.flashSales!.serverNow} locale={locale} />
      </span>
    </div>
    <div className={theme.gridClass}>
      {home.flashSales!.sales[0].products.map((p) => (
        <ProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} theme={theme} flashServerNow={home.flashSales!.serverNow} />
      ))}
    </div>
  </section>
) : null
    ),
    featured: (
settings.showFeatured && featuredProducts.length > 0 && !filtering ? (
  <section className="space-y-4">
    <h2 className={sectionTitle}>{t.home.featured}</h2>
    <div className={theme.featuredGridClass}>
      {featuredProducts.map((p) => (
        <ProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} theme={theme} flashServerNow={home.flashSales?.serverNow} />
      ))}
    </div>
  </section>
) : null
    ),
    recently: (
!filtering ? <RecentlyViewedStrip orgSlug={orgSlug} locale={locale} theme={isV2 ? theme : undefined} /> : null
    ),
  };
  const renderSections = orderedVisibleSections(settings.sectionOrder, sectionVisibilityOf(settings));

  return (
    // ED11 (EB4): one token-timed rise entrance for the home
    // sections wrapper (transform/opacity only, once per mount).
    <div className="animate-rise-in mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
      {/* EC27: Organization + WebSite JSON-LD from real shop data. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            buildShopJsonLd({
              base: sitemapUrlBase(),
              orgSlug,
              canonicalBase: canonicalShopBase(home.organization),
              shopName: settings.shopName,
              description: settings.metaDescription,
              logoUrl: home.organization.logoUrl,
            }),
          ),
        }}
      />
      {/* EC32: capture a partner ?ref= code for checkout attribution. */}
      <AffiliateRefCapture orgSlug={orgSlug} />
      {/* OU8: merchant-ordered, merchant-visible home sections. */}
      {renderSections.map((k) => (
        <React.Fragment key={k}>{sectionNodes[k]}</React.Fragment>
      ))}

      {/* Product grid */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={sectionTitle}>
            {filtering ? t.home.searchResults : t.home.allProducts}
            <span className={`ml-2 text-sm font-semibold ${theme.headerDark ? "text-slate-400" : "text-slate-400"}`}>({pagination.total}{t.home.itemsSuffix})</span>
          </h2>
          <div className="flex items-center gap-2">
            {/* ED8: v2-only additional mobile affordance — the
                inline chips + SortSelect stay exactly as they are
                on every theme and viewport. */}
            {isV2 ? (
              <ListingFilterDrawer locale={locale} activeCount={activeFilterCount} sections={filterSections} />
            ) : null}
            <SortSelect orgSlug={orgSlug} locale={locale} value={sort} q={q} category={category} brand={brand} />
          </div>
        </div>
        {products.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-3xl">🔍</p>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              {filtering ? t.home.emptyFiltered : t.home.emptyNoProducts}
            </p>
            {filtering ? (
              <Link href={`/shop/${orgSlug}`} className="mt-3 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white">
                {t.home.viewAllProducts}
              </Link>
            ) : null}
          </div>
        ) : (
          <div className={theme.gridClass}>
            {products.map((p) =>
              settings.themeId === "fashion" ? (
                <FashionProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} flashServerNow={home.flashSales?.serverNow} />
              ) : settings.themeId === "electronics" ? (
                <ElectronicsProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
              ) : settings.themeId === "grocery" ? (
                <GroceryProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
              ) : settings.themeId === "beauty" ? (
                <BeautyProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
              ) : settings.themeId === "furniture" ? (
                <FurnitureProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
              ) : settings.themeId === "books" ? (
                <BooksProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
              ) : settings.themeId === "kids" ? (
                <KidsProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
              ) : settings.themeId === "automotive" ? (
                <AutomotiveProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
              ) : settings.themeId === "sports" ? (
                <SportsProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
              ) : settings.themeId === "jewelry" ? (
                <JewelryProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
              ) : (
                <ProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} theme={theme} flashServerNow={home.flashSales?.serverNow} />
              ),
            )}
          </div>
        )}

        {pagination.totalPages > 1 ? (
          <nav className="flex items-center justify-center gap-2 pt-2">
            {page > 1 ? (
              <Link href={shopHref(orgSlug, q, category, page - 1, sort, brand)} className="rounded-lg border bg-white px-4 py-2 text-xs font-bold text-slate-700">
                {t.home.prevPage}
              </Link>
            ) : null}
            <span className="text-xs font-semibold text-slate-500">{t.home.page} {pagination.page} / {pagination.totalPages}</span>
            {page < pagination.totalPages ? (
              <Link href={shopHref(orgSlug, q, category, page + 1, sort, brand)} className="rounded-lg border bg-white px-4 py-2 text-xs font-bold text-slate-700">
                {t.home.nextPage}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
