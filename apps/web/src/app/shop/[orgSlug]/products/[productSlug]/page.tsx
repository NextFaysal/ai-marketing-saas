import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchProductDetail, fetchShopHome } from "@/lib/storefront-server";
import { ProductCard } from "../../ProductCard";
import { ProductDetailClient } from "./ProductDetailClient";

type Params = Promise<{ orgSlug: string; productSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug, productSlug } = await params;
  const [detail, home] = await Promise.all([fetchProductDetail(orgSlug, productSlug), fetchShopHome(orgSlug)]);
  if (!detail) return { title: "পণ্য পাওয়া যায়নি" };
  const title = detail.product.seo.title ?? detail.product.name;
  const description = detail.product.seo.description ?? detail.product.description ?? home?.settings.metaDescription ?? undefined;
  return {
    title: home ? `${title} — ${home.settings.shopName}` : title,
    description: description ?? undefined,
    openGraph: {
      title,
      description: description ?? undefined,
      images: detail.product.imageUrl ? [detail.product.imageUrl] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Params }) {
  const { orgSlug, productSlug } = await params;
  const detail = await fetchProductDetail(orgSlug, productSlug);
  if (!detail) notFound();
  const { product, related } = detail;

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
      <nav className="text-xs font-semibold text-slate-500">
        <Link href={`/shop/${orgSlug}`} className="hover:text-indigo-700">হোম</Link>
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

      <ProductDetailClient orgSlug={orgSlug} product={product} />

      {related.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-black text-slate-900">সম্পর্কিত পণ্য</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} orgSlug={orgSlug} product={p} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
