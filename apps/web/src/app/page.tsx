import Landing from "./landing-client";

export const metadata = {
  title: "AI Marketing OS — সব মেসেজ, বিজ্ঞাপন আর ডেলিভারি এক ড্যাশবোর্ডে",
  description: "বাংলাদেশের ই-কমার্স ব্যবসার জন্য অল-ইন-ওয়ান AI মার্কেটিং অপারেটিং সিস্টেম: Unified Inbox, AI Assistant, বিজ্ঞাপন অটোমেশন, কুরিয়ার ও COD রিটার্ন-ঝুঁকি স্কোর।",
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
