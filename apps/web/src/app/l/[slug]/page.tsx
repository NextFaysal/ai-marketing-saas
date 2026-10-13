import React from "react";
import type { Metadata } from "next";
import { fetchLandingMeta } from "@/lib/landing-server";
import LandingClient from "./LandingClient";

// EC13 — /l/[slug] server wrapper. Unlike checkout/[slug] (a pure
// client page with no metadata), this route follows the shop
// product page's cleaner pattern: a server component supplies
// generateMetadata from the SAME public endpoint (fetched
// server-side via API_INTERNAL_URL, React-cached), while the
// interactive page is a client child. The client fetch carries
// the visitor token, so the A/B variant it renders is the one
// assigned to this actual visitor — metadata never needs it.

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const meta = await fetchLandingMeta(slug);
  if (!meta) return { title: "ল্যান্ডিং পেজ পাওয়া যায়নি" };
  const title = meta.landing.title || meta.product.name;
  const description = meta.product.description ?? undefined;
  const image = meta.product.imageUrl ?? meta.product.images?.[0] ?? undefined;
  return {
    title: meta.organization.name ? `${title} — ${meta.organization.name}` : title,
    description,
    openGraph: {
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function LandingPage({ params }: { params: Params }) {
  const { slug } = await params;
  return <LandingClient slug={slug} />;
}
