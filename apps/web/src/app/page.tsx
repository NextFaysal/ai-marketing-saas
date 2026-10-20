import Landing from "./landing-client";

export const metadata = {
  title: "AI Marketing OS — সব মেসেজ, বিজ্ঞাপন আর ডেলিভারি এক ড্যাশবোর্ডে",
  description:
    "বাংলাদেশের ই-কমার্স ব্যবসার জন্য অল-ইন-ওয়ান AI মার্কেটিং অপারেটিং সিস্টেম: Omnichannel Competitor Spy, Unified Inbox, AI Assistant, বিজ্ঞাপন অটোমেশন, কুরিয়ার ও COD রিটার্ন-ঝুঁকি স্কোর।",
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
    title: "AI Marketing OS — সব মেসেজ, বিজ্ঞাপন আর ডেলিভারি এক ড্যাশবোর্ডে",
    description:
      "বাংলাদেশের অনলাইন সেলারদের জন্য অল-ইন-ওয়ান মার্কেটিং ও কমার্স ওএস। ইনবক্স, বিজ্ঞাপন, কুরিয়ার বুকিং ও রিটার্ন ফ্রড শিল্ড।",
    type: "website",
    locale: "bn_BD",
    siteName: "AI Marketing OS by Qosprey",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Marketing OS — অল-ইন-ওয়ান ই-কমার্স অটোমেশন",
    description: "সব মেসেজ, বিজ্ঞাপন আর ডেলিভারি এক ড্যাশবোর্ডে। ১৪ দিনের ফ্রি ট্রায়াল শুরু করুন।",
  },
};

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
