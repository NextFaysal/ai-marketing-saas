import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchShopHome } from "@/lib/storefront-server";
import { ProductCard } from "./ProductCard";

type Params = Promise<{ orgSlug: string }>;
type Search = Promise<{ q?: string; category?: string; page?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug } = await params;
  const home = await fetchShopHome(orgSlug);
  if (!home) return { title: "দোকান পাওয়া যায়নি" };
  const cover = home.featuredProducts[0]?.imageUrl ?? home.products[0]?.imageUrl ?? null;
  return {
    title: home.settings.shopName,
    description: home.settings.metaDescription ?? undefined,
    openGraph: {
      title: home.settings.shopName,
      description: home.settings.metaDescription ?? undefined,
      images: cover ? [cover] : undefined,
    },
  };
}

function shopHref(orgSlug: string, q: string, category: string, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/shop/${orgSlug}${qs ? `?${qs}` : ""}`;
}

export default async function ShopHomePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const category = (sp.category ?? "").trim();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const home = await fetchShopHome(orgSlug, q, category, String(page), "24");
  if (!home) notFound();

  const { settings, categories, featuredProducts, products, pagination } = home;
  const accent = home.organization.primaryColor || "#4f46e5";
  const filtering = !!q || !!category;

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
      {/* Hero */}
      <section className="rounded-3xl bg-white p-8 text-center shadow-sm border border-slate-200">
        <h1 className="text-3xl font-black text-slate-900 sm:text-4xl">{settings.shopName}</h1>
        {settings.metaDescription ? <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">{settings.metaDescription}</p> : null}
        {settings.showSearch ? (
          <form method="get" action={`/shop/${orgSlug}`} className="mx-auto mt-5 flex max-w-md gap-2">
            {category ? <input type="hidden" name="category" value={category} /> : null}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="পণ্য খুঁজুন…"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-indigo-600 focus:outline-none"
            />
            <button type="submit" className="shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold text-white" style={{ backgroundColor: accent }}>
              খুঁজুন
            </button>
          </form>
        ) : null}
      </section>

      {/* Categories */}
      {settings.showCategories && categories.length > 0 ? (
        <section className="flex flex-wrap items-center gap-2">
          <Link
            href={shopHref(orgSlug, q, "", 1)}
            className={`rounded-full px-4 py-1.5 text-xs font-bold ${!category ? "text-white" : "bg-white text-slate-700 border border-slate-200"}`}
            style={!category ? { backgroundColor: accent } : undefined}
          >
            সব পণ্য
          </Link>
          {categories.map((c) => {
            const value = c.slug ?? c.id ?? c.name;
            const active = category === value || category === c.name || (c.id ? category === c.id : false);
            return (
              <Link
                key={`${c.id ?? "legacy"}-${c.name}`}
                href={shopHref(orgSlug, q, value, 1)}
                className={`rounded-full px-4 py-1.5 text-xs font-bold ${active ? "text-white" : "bg-white text-slate-700 border border-slate-200"}`}
                style={active ? { backgroundColor: accent } : undefined}
              >
                {c.name} ({c.productCount})
              </Link>
            );
          })}
        </section>
      ) : null}

      {/* Featured */}
      {settings.showFeatured && featuredProducts.length > 0 && !filtering ? (
        <section className="space-y-4">
          <h2 className="text-xl font-black text-slate-900">⭐ ফিচার্ড পণ্য</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {featuredProducts.map((p) => (
              <ProductCard key={p.id} orgSlug={orgSlug} product={p} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Product grid */}
      <section className="space-y-4">
        <h2 className="text-xl font-black text-slate-900">
          {filtering ? "খোঁজার ফলাফল" : "সব পণ্য"}
          <span className="ml-2 text-sm font-semibold text-slate-400">({pagination.total}টি)</span>
        </h2>
        {products.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-3xl">🔍</p>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              {filtering ? "এই খোঁজে কোনো পণ্য পাওয়া যায়নি — অন্য নাম বা ক্যাটাগরি দিয়ে চেষ্টা করুন।" : "এই দোকানে এখনো কোনো পণ্য যোগ করা হয়নি।"}
            </p>
            {filtering ? (
              <Link href={`/shop/${orgSlug}`} className="mt-3 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white">
                সব পণ্য দেখুন
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.id} orgSlug={orgSlug} product={p} />
            ))}
          </div>
        )}

        {pagination.totalPages > 1 ? (
          <nav className="flex items-center justify-center gap-2 pt-2">
            {page > 1 ? (
              <Link href={shopHref(orgSlug, q, category, page - 1)} className="rounded-lg border bg-white px-4 py-2 text-xs font-bold text-slate-700">
                ← আগের পেজ
              </Link>
            ) : null}
            <span className="text-xs font-semibold text-slate-500">পেজ {pagination.page} / {pagination.totalPages}</span>
            {page < pagination.totalPages ? (
              <Link href={shopHref(orgSlug, q, category, page + 1)} className="rounded-lg border bg-white px-4 py-2 text-xs font-bold text-slate-700">
                পরের পেজ →
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
