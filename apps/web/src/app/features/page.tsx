import FeaturesClient from "./features-client";

export const metadata = {
  title: "ফিচারসমূহ — AI Marketing OS | অল-ইন-ওয়ান ই-কমার্স অটোমেশন প্ল্যাটফর্ম",
  description:
    "Omnichannel Competitor Spy, Unified Inbox, Strict Grounding AI, Courier Hub & COD Fraud Shield, No-Code Workflows ও Real Profit Analytics-এর সম্পূর্ণ বিস্তারিত বিবরণ।",
  openGraph: {
    title: "ফিচারসমূহ — AI Marketing OS | অল-ইন-ওয়ান ই-কমার্স অটোমেশন",
    description:
      "Omnichannel Competitor Spy, Unified Inbox, Strict Grounding AI, Courier Hub & COD Fraud Shield-এর সম্পূর্ণ টেকনিক্যাল স্পেসিফিকেশন।",
    type: "website",
    locale: "bn_BD",
    siteName: "AI Marketing OS",
  },
  twitter: {
    card: "summary_large_image",
    title: "ফিচারসমূহ — AI Marketing OS",
    description: "আপনার ই-কমার্স ব্যবসার প্রতিটি ডিপার্টমেন্টের পাওয়ারফুল টুলস।",
  },
};

export default function FeaturesPage() {
  return <FeaturesClient />;
}
