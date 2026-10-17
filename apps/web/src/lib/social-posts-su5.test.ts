import { describe, expect, it } from "vitest";
import {
  AUTO_DRAFT_CAP_MAX,
  AUTO_DRAFT_CAP_MIN,
  AUTO_DRAFT_TOGGLES,
  autoDraftBadgeLabel,
  autoDraftFormFromSettings,
  autoDraftKindLabel,
  buildAutoDraftSettingsPayload,
  clampAutoDraftCap,
  formatClicksLabel,
  formatOrdersRevenueLabel,
  isTrackedLinkPlatform,
  nonTrackedPlatformNote,
  type SocialLinkStats,
} from "./social-posts-su5";

describe("AUTO_DRAFT_TOGGLES (SU5)", () => {
  it("lists the commerce keys in panel order, then the SN8 syndication keys", () => {
    expect(AUTO_DRAFT_TOGGLES.map((t) => t.key)).toEqual([
      "newProductEnabled",
      "saleEnabled",
      "backInStockEnabled",
      "reviewMilestoneEnabled",
      "rssEnabled",
      "youtubeEnabled",
    ]);
    expect(AUTO_DRAFT_TOGGLES.every((t) => t.label.length > 0)).toBe(true);
  });
});

describe("clampAutoDraftCap (SU5)", () => {
  it("keeps values inside 1–20 untouched and floors fractions", () => {
    expect(clampAutoDraftCap(1)).toBe(1);
    expect(clampAutoDraftCap(5)).toBe(5);
    expect(clampAutoDraftCap(20)).toBe(20);
    expect(clampAutoDraftCap(7.9)).toBe(7);
  });

  it("clamps below/above the range and tolerates junk input", () => {
    expect(clampAutoDraftCap(0)).toBe(AUTO_DRAFT_CAP_MIN);
    expect(clampAutoDraftCap(-3)).toBe(AUTO_DRAFT_CAP_MIN);
    expect(clampAutoDraftCap(21)).toBe(AUTO_DRAFT_CAP_MAX);
    expect(clampAutoDraftCap(999)).toBe(AUTO_DRAFT_CAP_MAX);
    expect(clampAutoDraftCap("12")).toBe(12);
    expect(clampAutoDraftCap("abc")).toBe(AUTO_DRAFT_CAP_MIN);
    expect(clampAutoDraftCap(Number.NaN)).toBe(AUTO_DRAFT_CAP_MIN);
  });
});

describe("buildAutoDraftSettingsPayload (SU5)", () => {
  it("maps the form into the API shape, empty account → null", () => {
    expect(
      buildAutoDraftSettingsPayload({
        newProductEnabled: true,
        saleEnabled: false,
        backInStockEnabled: true,
        reviewMilestoneEnabled: false,
        rssEnabled: false,
        youtubeEnabled: false,
        rssFeedUrl: "",
        maxDraftsPerDay: 8,
        socialAccountId: "",
      }),
    ).toEqual({
      newProductEnabled: true,
      saleEnabled: false,
      backInStockEnabled: true,
      reviewMilestoneEnabled: false,
      rssEnabled: false,
      youtubeEnabled: false,
      rssFeedUrl: null,
      maxDraftsPerDay: 8,
      socialAccountId: null,
    });
  });

  it("trims the account id and clamps the cap", () => {
    const payload = buildAutoDraftSettingsPayload({
      newProductEnabled: false,
      saleEnabled: false,
      backInStockEnabled: false,
      reviewMilestoneEnabled: false,
      rssEnabled: false,
      youtubeEnabled: false,
      rssFeedUrl: "",
      maxDraftsPerDay: 500,
      socialAccountId: "  acc-1 ",
    });
    expect(payload.socialAccountId).toBe("acc-1");
    expect(payload.maxDraftsPerDay).toBe(20);
    const low = buildAutoDraftSettingsPayload({
      newProductEnabled: false, saleEnabled: false, backInStockEnabled: false,
      reviewMilestoneEnabled: false, rssEnabled: false, youtubeEnabled: false, rssFeedUrl: "",
      maxDraftsPerDay: 0, socialAccountId: "   ",
    });
    expect(low.maxDraftsPerDay).toBe(1);
    expect(low.socialAccountId).toBeNull();
  });

  it("SN8: trims the RSS feed URL; blank becomes null (clears it)", () => {
    const payload = buildAutoDraftSettingsPayload({
      newProductEnabled: false, saleEnabled: false, backInStockEnabled: false,
      reviewMilestoneEnabled: false, rssEnabled: true, youtubeEnabled: true,
      rssFeedUrl: "  https://example.com/feed.xml  ", maxDraftsPerDay: 5, socialAccountId: "",
    });
    expect(payload.rssEnabled).toBe(true);
    expect(payload.youtubeEnabled).toBe(true);
    expect(payload.rssFeedUrl).toBe("https://example.com/feed.xml");
    const blank = buildAutoDraftSettingsPayload({
      newProductEnabled: false, saleEnabled: false, backInStockEnabled: false,
      reviewMilestoneEnabled: false, rssEnabled: false, youtubeEnabled: false,
      rssFeedUrl: "   ", maxDraftsPerDay: 5, socialAccountId: "",
    });
    expect(blank.rssFeedUrl).toBeNull();
  });
});

describe("autoDraftFormFromSettings (SU5)", () => {
  it("round-trips through the payload builder", () => {
    const settings = {
      newProductEnabled: true,
      saleEnabled: true,
      backInStockEnabled: false,
      reviewMilestoneEnabled: true,
      rssEnabled: true,
      youtubeEnabled: false,
      rssFeedUrl: "https://example.com/feed.xml",
      maxDraftsPerDay: 3,
      socialAccountId: "acc-9",
    };
    expect(buildAutoDraftSettingsPayload(autoDraftFormFromSettings(settings))).toEqual(settings);
  });

  it("turns a null account into the empty select value", () => {
    const form = autoDraftFormFromSettings({
      newProductEnabled: false, saleEnabled: false, backInStockEnabled: false,
      reviewMilestoneEnabled: false, rssEnabled: false, youtubeEnabled: false, rssFeedUrl: null,
      maxDraftsPerDay: 5, socialAccountId: null,
    });
    expect(form.socialAccountId).toBe("");
    expect(form.rssFeedUrl).toBe("");
  });
});

describe("autoDraftKindLabel / autoDraftBadgeLabel (SU5)", () => {
  it("labels every known kind in Bengali with its icon", () => {
    expect(autoDraftKindLabel("new_product")).toBe("🆕 নতুন product");
    expect(autoDraftKindLabel("sale")).toBe("🏷️ সেল");
    expect(autoDraftKindLabel("back_in_stock")).toBe("📦 Back-in-stock");
    expect(autoDraftKindLabel("review_milestone")).toBe("⭐ রিভিউ মাইলফলক");
  });

  it("prefixes the badge with the Auto draft label", () => {
    expect(autoDraftBadgeLabel("sale")).toBe("Auto draft · 🏷️ সেল");
    expect(autoDraftBadgeLabel("new_product")).toBe("Auto draft · 🆕 নতুন product");
  });

  it("returns null for manual posts and unknown kinds", () => {
    expect(autoDraftKindLabel(null)).toBeNull();
    expect(autoDraftKindLabel(undefined)).toBeNull();
    expect(autoDraftKindLabel("")).toBeNull();
    expect(autoDraftBadgeLabel(null)).toBeNull();
    expect(autoDraftBadgeLabel("something_else")).toBeNull();
  });
});

describe("tracked-link platform helpers (SU6)", () => {
  it("only meta_page carries a tracked clickable link", () => {
    expect(isTrackedLinkPlatform("meta_page")).toBe(true);
    expect(isTrackedLinkPlatform("instagram")).toBe(false);
    expect(isTrackedLinkPlatform("tiktok")).toBe(false);
    expect(isTrackedLinkPlatform("youtube")).toBe(false);
    expect(isTrackedLinkPlatform(null)).toBe(false);
    expect(isTrackedLinkPlatform(undefined)).toBe(false);
  });

  it("gives the honest note for IG/TikTok/YouTube and null for meta_page", () => {
    const note = "এই platform-এ clickable link যায় না — tracking প্রযোজ্য নয়";
    expect(nonTrackedPlatformNote("instagram")).toBe(note);
    expect(nonTrackedPlatformNote("tiktok")).toBe(note);
    expect(nonTrackedPlatformNote("youtube")).toBe(note);
    expect(nonTrackedPlatformNote("meta_page")).toBeNull();
    expect(nonTrackedPlatformNote(null)).toBeNull();
    expect(nonTrackedPlatformNote("unknown_platform")).toBeNull();
  });
});

describe("formatClicksLabel (SU6)", () => {
  it("renders the count with Bengali digits", () => {
    expect(formatClicksLabel(0)).toBe("০টি click");
    expect(formatClicksLabel(3)).toBe("৩টি click");
    expect(formatClicksLabel(1250)).toBe("১,২৫০টি click");
  });

  it("never shows a negative or fractional count", () => {
    expect(formatClicksLabel(-2)).toBe("০টি click");
    expect(formatClicksLabel(4.7)).toBe("৪টি click");
  });
});

describe("formatOrdersRevenueLabel (SU6)", () => {
  const base: SocialLinkStats = {
    clicks: 10,
    lastClickedAt: null,
    ordersAssociated: 0,
    revenueAssociatedMinor: "0",
    associationNote: "association, attribution নয়",
  };

  it("is null when no order is associated — no invented revenue line", () => {
    expect(formatOrdersRevenueLabel(base)).toBeNull();
    expect(formatOrdersRevenueLabel({ ...base, ordersAssociated: -1 })).toBeNull();
  });

  it("formats orders + taka (existing minor→taka helper) with the association caveat", () => {
    expect(formatOrdersRevenueLabel({ ...base, ordersAssociated: 2, revenueAssociatedMinor: "123456" }))
      .toBe("২টি order · ৳ 1,234.56 (association, attribution নয়)");
    expect(formatOrdersRevenueLabel({ ...base, ordersAssociated: 1, revenueAssociatedMinor: "5000" }))
      .toBe("১টি order · ৳ 50.00 (association, attribution নয়)");
  });
});
