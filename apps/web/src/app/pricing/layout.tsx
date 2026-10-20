import React from "react";
import type { Metadata } from "next";
import { pubT } from "@/lib/i18n/public";

export async function generateMetadata(): Promise<Metadata> {
  const t = pubT();
  return {
    title: t.pricing.metaTitle,
    description: t.pricing.metaDescription,
    openGraph: {
      title: t.pricing.metaOgTitle,
      description: t.pricing.metaOgDescription,
      type: "website",
      locale: "bn_BD",
    },
  };
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
