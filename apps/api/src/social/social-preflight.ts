/**
 * SU1 — platform pre-flight validation (pure).
 *
 * One rule set used at schedule time (SocialService.schedulePost)
 * and again at publish time (SocialPublishService), so a post that
 * can never succeed on its platform is refused in the composer
 * instead of failing in the worker. Messages are verbatim where an
 * existing publisher rule already owns the text (SP6/PP4/SP8/SP9).
 */

/**
 * SP8/SP9: TikTok and YouTube are VIDEO-ONLY destinations in v1
 * and take exactly one video. (Moved here from social.service.ts,
 * which re-exports it so existing imports keep working.)
 */
export function videoOnlyViolation(platform: string, mediaRefs: { assetId: string; kind: string }[] | null | undefined): string | null {
  if (platform !== "tiktok" && platform !== "youtube") return null;
  const label = platform === "tiktok" ? "TikTok" : "YouTube";
  const refs = Array.isArray(mediaRefs) ? mediaRefs : [];
  if (refs.length !== 1 || refs[0]?.kind !== "video") {
    return `${label}-এর পোস্টে ঠিক একটি Video লাগবে — ছবি বা একাধিক মিডিয়া দিয়ে ${label}-এ প্রকাশ করা যায় না। একটি Video বেছে নিন।`;
  }
  return null;
}

/** SU1: validate one post against its platform's rules. Returns
 * the Bengali violation message, or null when acceptable. */
export function validateForPlatform(
  input: { caption?: string | null; mediaRefs?: { assetId: string; kind: string }[] | null; isStory?: boolean | null },
  platform: string,
): string | null {
  const caption = String(input?.caption ?? "");
  const refs = Array.isArray(input?.mediaRefs) ? input.mediaRefs : [];

  // SU8: stories are FB Page photo stories ONLY (the documented
  // photo_stories flow) — exactly one image, nothing else.
  if (input?.isStory) {
    if (platform !== "meta_page") {
      return "Story আপাতত শুধু Facebook Page-এ সমর্থিত — অন্য Platform-এ Story প্রকাশ করা যায় না।";
    }
    if (refs.length !== 1 || refs[0]?.kind !== "image") {
      return "Facebook Page Story-তে ঠিক একটি ছবি লাগবে — একটি ছবি বেছে নিন।";
    }
    return null;
  }

  const videoOnly = videoOnlyViolation(platform, refs);
  if (videoOnly) return videoOnly;

  if (platform === "instagram") {
    if (refs.length === 0) {
      // SP6 publisher's verbatim message.
      return "Instagram-এ প্রকাশের জন্য একটি ছবি বা ভিডিও লাগবে — শুধু লেখার পোস্ট Instagram-এ করা যায় না।";
    }
    if (refs.length > 10) {
      // PP4 carousel limit, verbatim.
      return "Instagram Carousel-এ সর্বোচ্চ ১০টি মিডিয়া রাখা যায় — মিডিয়ার সংখ্যা কমিয়ে আবার চেষ্টা করুন।";
    }
    if (caption.length > 2200) {
      return "Instagram-এর ক্যাপশন সর্বোচ্চ ২২০০ অক্ষরের হতে পারবে — ক্যাপশন ছোট করুন।";
    }
    return null;
  }

  if (platform === "youtube") {
    const title = caption.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0) ?? "";
    if (title.length > 100) {
      return "YouTube-এর শিরোনাম (ক্যাপশনের প্রথম লাইন) সর্বোচ্চ ১০০ অক্ষরের হতে পারবে — প্রথম লাইন ছোট করুন।";
    }
    if (caption.length > 5000) {
      return "YouTube-এর বর্ণনা (ক্যাপশন) সর্বোচ্চ ৫০০০ অক্ষরের হতে পারবে — ক্যাপশন ছোট করুন।";
    }
    return null;
  }

  if (platform === "meta_page") {
    const videos = refs.filter((r) => r.kind === "video");
    if (videos.length > 0 && refs.length > 1) {
      // SP6 publisher's verbatim message.
      return "একাধিক মিডিয়ার মধ্যে ভিডিও থাকলে Facebook Page-এ একসাথে প্রকাশ করা যায় না — শুধু ছবিগুলো একসাথে, অথবা শুধু একটি ভিডিও রাখুন।";
    }
    return null;
  }

  return null;
}
