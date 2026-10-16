import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchShopBlog } from "@/lib/storefront-server";
import { shopLocaleOf, shopT } from "@/lib/shop-i18n";
import { themeOf } from "@/lib/shop-theme";

type Params = Promise<{ orgSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug } = await params;
  const data = await fetchShopBlog(orgSlug);
  if (!data) return { title: shopT("bn").common.shopNotFound };
  const t = shopT(data.settings.locale);
  return { title: `${t.blog.title} — ${data.settings.shopName}` };
}

function dateText(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale === "en" ? "en-GB" : "bn-BD", { year: "numeric", month: "long", day: "numeric" });
}

export default async function ShopBlogIndexPage({ params }: { params: Params }) {
  const { orgSlug } = await params;
  const data = await fetchShopBlog(orgSlug);
  if (!data) notFound();
  const locale = shopLocaleOf(data.settings.locale);
  const t = shopT(locale);
  const theme = themeOf(undefined);
  const posts = data.posts ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-black text-slate-900">{t.blog.title}</h1>
      {posts.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm text-slate-500">{t.blog.empty}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/shop/${orgSlug}/blog/${encodeURIComponent(post.slug)}`}
              className={`block overflow-hidden bg-white transition hover:shadow-md ${theme.cardClass}`}
            >
              {post.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.coverImageUrl} alt={post.title} className="aspect-video w-full object-cover" />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center bg-indigo-50 text-5xl">📝</div>
              )}
              <div className="space-y-2 p-4">
                <h2 className="line-clamp-2 text-base font-bold text-slate-900">{post.title}</h2>
                {post.excerpt ? <p className="line-clamp-3 text-sm leading-relaxed text-slate-600">{post.excerpt}</p> : null}
                {(post.tags ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(post.tags ?? []).map((tag) => (
                      <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{tag}</span>
                    ))}
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-2 pt-1 text-xs text-slate-500">
                  <span>{dateText(post.publishedAt, locale)}</span>
                  <span className="font-bold text-indigo-700">{t.blog.readMore} →</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
