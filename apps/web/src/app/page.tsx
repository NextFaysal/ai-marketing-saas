import type { Metadata } from "next";
import Landing from "./landing-client";
import { pubT } from "@/lib/i18n/public";

export async function generateMetadata(): Promise<Metadata> {
  const t = pubT();
  return {
    title: t.landing.metaTitle,
    description: t.landing.metaDescription,
    keywords: [
      "AI Marketing OS",
      "Ecommerce Marketing Bangladesh",
      "Unified Inbox",
      "COD Return Risk Score",
      "Courier Automation",
      "Facebook Ads Automation",
      "WhatsApp Catalog Bot",
      "Steadfast Courier",
      "Pathao Logistics",
    ],
    openGraph: {
      title: t.landing.metaTitle,
      description: t.landing.metaOgDescription,
      type: "website",
      locale: "bn_BD",
      siteName: "AI Marketing OS by Qosprey",
    },
    twitter: {
      card: "summary_large_image",
      title: t.landing.metaTwitterTitle,
      description: t.landing.metaTwitterDescription,
    },
  };
}

/**
 * Milestone 58: "/" is now the public marketing landing.
 * Routing choice (documented in docs/milestone-58-acceptance.md):
 * before M58 this route server-redirected EVERY visitor to
 * /dashboard (which then bounced anonymous visitors to /login).
 * Now anonymous visitors get the landing; the landing client
 * preserves the old behaviour for signed-in users by redirecting
 * token-holders to /dashboard on mount.
 */
export default function Home() {
  return <Landing />;
}
