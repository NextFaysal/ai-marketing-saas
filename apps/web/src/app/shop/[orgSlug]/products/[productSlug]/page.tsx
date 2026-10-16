import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { RotateCcw, ShieldCheck, Truck } from "lucide-react";
import { fetchProductDetail, fetchProductReviewsSummary, fetchShopHome } from "@/lib/storefront-server";
import { effectiveThemeId, previewThemeIdFromHeaders, themeOf } from "@/lib/shop-theme";
import { shopLocaleOf, shopT } from "@/lib/shop-i18n";
import { buildProductJsonLd, canonicalShopBase, canonicalShopUrlAt, jsonLdScript } from "@/lib/storefront-seo";
import { sitemapUrlBase } from "@/lib/storefront-sitemap";
import { ProductCard } from "../../ProductCard";
import { FlashCountdown } from "../../FlashCountdown";
import { ProductDetailClient } from "./ProductDetailClient";
import { ReviewInsightBox } from "./ReviewInsightBox";
import { ProductReviewsSection } from "@/components/product-reviews";
import { ProductQuestions } from "../../ProductQuestions";
import { RecordRecentlyViewed, RecentlyViewedStrip } from "../../RecentlyViewed";

type Params = Promise<{ orgSlug: string; productSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug, productSlug } = await params;
  const [detail, home] = await Promise.all([fetchProductDetail(orgSlug, productSlug), fetchShopHome(orgSlug)]);
  if (!detail) return { title: shopT("bn").common.productNotFound };
  const title = detail.product.seo.title ?? detail.product.name;
  const description = detail.product.seo.description ?? detail.product.description ?? home?.settings.metaDescription ?? undefined;
  // TD7: canonical host base from the shop home payload's org
  // (verified custom domain, else tenant subdomain); when the home
  // payload is unavailable the subdomain rule still applies.
  const canonical = canonicalShopUrlAt(
    canonicalShopBase(home?.organization ?? { slug: orgSlug }),
    productSlug,
  );
  return {
    title: home ? `${title} — ${home.settings.shopName}` : title,
    description: description ?? undefined,
    // EC27: canonical + OG URL/type for the product page.
    alternates: { canonical },
    openGraph: {
      type: "website",
      title,
      description: description ?? undefined,
      url: canonical,
      images: detail.product.imageUrl ? [detail.product.imageUrl] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Params }) {
  const { orgSlug, productSlug } = await params;
  // ED5 (EB2): detail and the reviews summary are independent reads,
  // so they now start concurrently instead of detail → (flash) →
  // reviews sequentially. Semantics are unchanged: a null detail
  // still answers notFound(), a failed reviews fetch still degrades
  // to null (so JSON-LD omits the rating), and the flash home fetch
  // below stays conditional on detail.product.flashSale.
  // EC27: the EC15 unified reviews summary feeds the JSON-LD
  // aggregateRating — only when it really has reviews.
  const [detail, reviewsSummary] = await Promise.all([
    fetchProductDetail(orgSlug, productSlug),
    fetchProductReviewsSummary(orgSlug, productSlug).catch(() => null),
  ]);
  if (!detail) notFound();
  const { product, related } = detail;
  // GB7 (GC18): server clock for the flash countdown (cached fetch).
  const homeForFlash = product.flashSale ? await fetchShopHome(orgSlug).catch(() => null) : null;
  const flashServerNow = homeForFlash?.flashSales?.serverNow ?? null;
  // ED8: detail.settings carries NO themeId (locale/trust copy
  // only — verified in lib/storefront-server), so the effective
  // theme comes from the shop-home payload. fetchShopHome is
  // React cache()-deduped with generateMetadata's fetch in the
  // same request (and with homeForFlash above when present).
  const homeForTheme = homeForFlash ?? (await fetchShopHome(orgSlug).catch(() => null));
  // TD7: the JSON-LD canonical base reads the org's custom-domain
  // fields from this same (React cache-deduped) shop-home payload.
  const home = homeForTheme;
  const hdrs = await headers();
  const effThemeId = effectiveThemeId(homeForTheme?.settings.themeId, previewThemeIdFromHeaders(hdrs));
  const isV2 = effThemeId === "v2";
  const themeTokens = themeOf(effThemeId);
  const locale = shopLocaleOf(detail.settings?.locale);
  const t = shopT(locale);
  const boughtTogether = detail.boughtTogether ?? [];

  return (
    // ED11 (EB4): one token-timed rise entrance for the PDP
    // container (transform/opacity only, once per mount).
    <div className="animate-rise-in mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
      {/* EC27: Product JSON-LD from real data (rating omitted when no reviews). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            buildProductJsonLd({
              base: sitemapUrlBase(),
              orgSlug,
              canonicalBase: canonicalShopBase(home?.organization ?? { slug: orgSlug }),
              product,
              reviewsSummary,
            }),
          ),
        }}
      />
      <RecordRecentlyViewed orgSlug={orgSlug} productId={product.id} />
      <nav className="text-xs font-semibold text-slate-500">
        <Link href={`/shop/${orgSlug}`} className="hover:text-indigo-700">{t.common.home}</Link>
        {product.category?.name ? (
          <>
            <span className="mx-1.5">/</span>
            <Link
              href={`/shop/${orgSlug}?category=${encodeURIComponent(product.category.slug ?? product.category.id ?? product.category.name)}`}
              className="hover:text-indigo-700"
            >
              {product.category.name}
            </Link>
          </>
        ) : null}
        <span className="mx-1.5">/</span>
        <span className="text-slate-800">{product.name}</span>
      </nav>

      {/* GB7 (GC18): flash-sale banner above the buy panel's price area */}
      {product.flashSale ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-rose-600 px-5 py-3 text-white shadow-sm">
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-black">−{product.flashSale.percentOff}%</span>
          <span className="text-sm">
            <FlashCountdown endsAt={product.flashSale.endsAt} serverNow={flashServerNow} locale={locale} />
          </span>
          <span className="text-xs font-semibold text-rose-100">{product.flashSale.name}</span>
        </div>
      ) : null}

      <ProductDetailClient orgSlug={orgSlug} product={product} locale={locale} theme={isV2 ? themeTokens : undefined} isV2={isV2} />

      {/* EC27: bought-together from real sold orders — the section
          is absent entirely when nothing clears the threshold. */}
      {boughtTogether.length > 0 ? (
        <section className="space-y-4">
          <h2 className={isV2 ? themeTokens.sectionTitleClass : "text-xl font-black text-slate-900"}>{t.product.boughtTogether}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {boughtTogether.map((p) => (
              <ProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} theme={isV2 ? themeTokens : undefined} />
            ))}
          </div>
        </section>
      ) : null}

      {/* AB7 (AX15): AI review-insight box — renders only when the
          endpoint returns an insight; sits directly above reviews. */}
      <ReviewInsightBox orgSlug={orgSlug} productSlug={productSlug} />

      {/* EC15: unified reviews (own delivered-order reviews + pulled
          external reviews) from the public product-reviews endpoint. */}
      <ProductReviewsSection orgSlug={orgSlug} productSlug={productSlug} heading={t.product.reviewsHeading} />

      {/* EC28: product Q&A (published only + ask form). */}
      <ProductQuestions orgSlug={orgSlug} productSlug={productSlug} locale={locale} />

      <RecentlyViewedStrip orgSlug={orgSlug} locale={locale} excludeId={product.id} theme={isV2 ? themeTokens : undefined} />

      {related.length > 0 ? (
        <section className="space-y-4">
          <h2 className={isV2 ? themeTokens.sectionTitleClass : "text-xl font-black text-slate-900"}>{t.product.related}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} theme={isV2 ? themeTokens : undefined} />
            ))}
          </div>
        </section>
      ) : null}

      {/* EC18 trust copy from the product payload — hidden when empty.
          ED8: v2-only token restyle + lucide trust icons (Truck /
          ShieldCheck / RotateCcw) in place of the emoji; the text
          content and legacy rendering are unchanged. */}
      {detail.settings?.deliveryPromiseText?.trim() || detail.settings?.supportPhone?.trim() ? (
        <section className={isV2 ? "space-y-1 rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-[var(--surface)] p-5 text-center shadow-[var(--shadow-card)]" : "space-y-1 rounded-2xl border border-slate-200 bg-white p-5 text-center"}>
          {detail.settings?.deliveryPromiseText?.trim() ? (
            <p className={isV2 ? "text-sm font-semibold text-[var(--ink-body)]" : "text-sm font-semibold text-slate-700"}>{isV2 ? <Truck className="mr-1.5 inline h-4 w-4 align-[-2px]" aria-hidden="true" /> : "🚚 "}{detail.settings.deliveryPromiseText.trim()}</p>
          ) : null}
          {detail.settings?.supportPhone?.trim() ? (
            <p className={isV2 ? "text-xs text-[var(--ink-muted)]" : "text-xs text-slate-500"}>{isV2 ? <ShieldCheck className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" /> : null}{t.common.supportPhoneLabel}: <span className="font-mono font-semibold">{detail.settings.supportPhone.trim()}</span></p>
          ) : null}
        </section>
      ) : null}
      {detail.settings?.returnPolicyText?.trim() ? (
        <section className={isV2 ? "rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]" : "rounded-2xl border border-slate-200 bg-white p-5"}>
          <h2 className={isV2 ? "text-sm font-bold text-[var(--ink-strong)]" : "text-sm font-bold text-slate-800"}>{isV2 ? <RotateCcw className="mr-1.5 inline h-4 w-4 align-[-2px]" aria-hidden="true" /> : null}{t.common.returnPolicyLabel}</h2>
          <p className={isV2 ? "mt-1 whitespace-pre-line text-sm leading-relaxed text-[var(--ink-body)]" : "mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600"}>{detail.settings.returnPolicyText.trim()}</p>
        </section>
      ) : null}
    </div>
  );
}
