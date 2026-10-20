import React from "react";

export const metadata = {
  title: "সহজ ও স্বচ্ছ মূল্যতালিকা (Pricing) — AI Marketing OS",
  description:
    "সব প্ল্যানে ১৪ দিনের ফ্রি ট্রায়াল। Free, Starter, Growth ও Agency প্ল্যানের বিস্তারিত মূল্য ও সুবিধার তুলনা।",
  openGraph: {
    title: "মূল্যতালিকা — AI Marketing OS",
    description: "সব প্ল্যানে ১৪ দিনের ফ্রি ট্রায়াল। স্বচ্ছ ও লাইভ প্রাইসিং।",
    type: "website",
    locale: "bn_BD",
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
