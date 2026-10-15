import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchProductDetail, fetchProductReviewsSummary, fetchShopHome } from "@/lib/storefront-server";
import { shopLocaleOf, shopT } from "@/lib/shop-i18n";
import { buildProductJsonLd, canonicalShopBase, canonicalShopUrlAt, jsonLdScript } from "@/lib/storefront-seo";
import { sitemapUrlBase } from "@/lib/storefront-sitemap";
import { ProductCard } from "../../ProductCard";
import { ProductDetailClient } from "./ProductDetailClient";
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
  const detail = await fetchProductDetail(orgSlug, productSlug);
  if (!detail) notFound();
  // TD7: the product payload's organization has no custom-domain
  // fields; the (React-cached) shop home payload carries them.
  const home = await fetchShopHome(orgSlug);
  const { product, related } = detail;
  const locale = shopLocaleOf(detail.settings?.locale);
  const t = shopT(locale);
  // EC27: the EC15 unified reviews summary feeds the JSON-LD
  // aggregateRating — only when it really has reviews.
  const reviewsSummary = await fetchProductReviewsSummary(orgSlug, productSlug).catch(() => null);
  const boughtTogether = detail.boughtTogether ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
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
      <RecordRecentlyViewed orgSlug={orgSlug} product={product} />
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

      <ProductDetailClient orgSlug={orgSlug} product={product} locale={locale} />

      {/* EC27: bought-together from real sold orders — the section
          is absent entirely when nothing clears the threshold. */}
      {boughtTogether.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-black text-slate-900">{t.product.boughtTogether}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {boughtTogether.map((p) => (
              <ProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}

      {/* EC15: unified reviews (own delivered-order reviews + pulled
          external reviews) from the public product-reviews endpoint. */}
      <ProductReviewsSection orgSlug={orgSlug} productSlug={productSlug} heading={t.product.reviewsHeading} />

      {/* EC28: product Q&A (published only + ask form). */}
      <ProductQuestions orgSlug={orgSlug} productSlug={productSlug} locale={locale} />

      <RecentlyViewedStrip orgSlug={orgSlug} locale={locale} excludeId={product.id} />

      {related.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-black text-slate-900">{t.product.related}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} orgSlug={orgSlug} product={p} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}

      {/* EC18 trust copy from the product payload — hidden when empty. */}
      {detail.settings?.deliveryPromiseText?.trim() || detail.settings?.supportPhone?.trim() ? (
        <section className="space-y-1 rounded-2xl border border-slate-200 bg-white p-5 text-center">
          {detail.settings?.deliveryPromiseText?.trim() ? (
            <p className="text-sm font-semibold text-slate-700">🚚 {detail.settings.deliveryPromiseText.trim()}</p>
          ) : null}
          {detail.settings?.supportPhone?.trim() ? (
            <p className="text-xs text-slate-500">{t.common.supportPhoneLabel}: <span className="font-mono font-semibold">{detail.settings.supportPhone.trim()}</span></p>
          ) : null}
        </section>
      ) : null}
      {detail.settings?.returnPolicyText?.trim() ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-bold text-slate-800">{t.common.returnPolicyLabel}</h2>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600">{detail.settings.returnPolicyText.trim()}</p>
        </section>
      ) : null}
    </div>
  );
}
