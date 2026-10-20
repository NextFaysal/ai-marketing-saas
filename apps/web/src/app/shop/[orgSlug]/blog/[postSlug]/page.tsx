import React from "react";
import { fmtDate } from "@repo/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchShopBlogPost } from "@/lib/storefront-server";
import { shopLocaleOf, shopT } from "@/lib/shop-i18n";
import { PageBlocks } from "../../PageBlocks";
import { MediaImage } from "@/components/MediaImage";

type Params = Promise<{ orgSlug: string; postSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug, postSlug } = await params;
  const data = await fetchShopBlogPost(orgSlug, postSlug);
  if (!data) return { title: shopT("bn").common.shopNotFound };
  const title = data.post.seo?.title ?? data.post.title;
  const description = data.post.seo?.description ?? data.post.excerpt ?? undefined;
  return {
    title: `${title} — ${data.settings.shopName}`,
    description,
    openGraph: {
      title,
      description,
      images: data.post.coverImageUrl ? [data.post.coverImageUrl] : undefined,
    },
  };
}

function dateText(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return fmtDate(locale === "en" ? "en" : "bn", d);
}

export default async function ShopBlogPostPage({ params }: { params: Params }) {
  const { orgSlug, postSlug } = await params;
  const data = await fetchShopBlogPost(orgSlug, postSlug);
  if (!data) notFound();
  const locale = shopLocaleOf(data.settings.locale);
  const t = shopT(locale);
  const post = data.post;
  const date = dateText(post.publishedAt, locale);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-black text-slate-900">{post.title}</h1>
      {date || post.authorName ? (
        <p className="text-sm text-slate-500">
          {date}
          {date && post.authorName ? " · " : null}
          {post.authorName ? <>{t.blog.byline} {post.authorName}</> : null}
        </p>
      ) : null}
      {post.coverImageUrl ? (
        <MediaImage src={post.coverImageUrl} alt={post.title} width={1280} height={720} aspectRatio="16/9" priority sizes="(max-width: 768px) 100vw, 768px" className="w-full rounded-2xl border border-slate-200 object-cover" />
      ) : null}
      <PageBlocks blocks={post.blocks ?? []} orgSlug={orgSlug} locale={locale} />
      {(post.tags ?? []).length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-slate-200 pt-4">
          {(post.tags ?? []).map((tag) => (
            <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{tag}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
