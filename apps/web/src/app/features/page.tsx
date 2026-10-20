import type { Metadata } from "next";
import FeaturesClient from "./features-client";
import { pubT } from "@/lib/i18n/public";

export async function generateMetadata(): Promise<Metadata> {
  const t = pubT();
  return {
    title: t.features.featuresMetaTitle,
    description: t.features.featuresMetaDescription,
    openGraph: {
      title: t.features.featuresMetaOgTitle,
      description: t.features.featuresMetaOgDescription,
      type: "website",
      locale: "bn_BD",
      siteName: "AI Marketing OS",
    },
    twitter: {
      card: "summary_large_image",
      title: t.features.featuresMetaTwitterTitle,
      description: t.features.featuresMetaTwitterDescription,
    },
  };
}

export default function FeaturesPage() {
  return <FeaturesClient />;
}
