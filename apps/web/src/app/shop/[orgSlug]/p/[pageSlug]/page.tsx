import React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchShopPage } from "@/lib/storefront-server";
import { shopLocaleOf, shopT } from "@/lib/shop-i18n";
import { PageBlocks } from "../../PageBlocks";

type Params = Promise<{ orgSlug: string; pageSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug, pageSlug } = await params;
  const data = await fetchShopPage(orgSlug, pageSlug);
  if (!data) return { title: shopT("bn").common.shopNotFound };
  return { title: `${data.page.title} — ${data.settings.shopName}` };
}

export default async function ShopContentPage({ params }: { params: Params }) {
  const { orgSlug, pageSlug } = await params;
  const data = await fetchShopPage(orgSlug, pageSlug);
  if (!data) notFound();
  const locale = shopLocaleOf(data.settings.locale);
  const blocks = data.page.blocks ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-black text-slate-900">{data.page.title}</h1>
      <PageBlocks blocks={blocks} orgSlug={orgSlug} locale={locale} />
    </div>
  );
}
