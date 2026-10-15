import { describe, expect, it } from "vitest";
import {
  buildPlatformPreview,
  groupNameFromCaption,
  groupVariantsForSave,
  isFirstCommentApplicable,
  platformLabel,
  weekdayLabelBn,
  type ComposerMediaKind,
} from "./social-composer";

const kinds = (s: string): ComposerMediaKind[] =>
  s.split("").filter(Boolean).map((c) => (c === "v" ? "video" : "image")) as ComposerMediaKind[];

describe("isFirstCommentApplicable (SU1)", () => {
  it("only meta_page and instagram", () => {
    expect(isFirstCommentApplicable("meta_page")).toBe(true);
    expect(isFirstCommentApplicable("instagram")).toBe(true);
    expect(isFirstCommentApplicable("tiktok")).toBe(false);
    expect(isFirstCommentApplicable("youtube")).toBe(false);
    expect(isFirstCommentApplicable("unknown")).toBe(false);
  });
});

describe("platformLabel (SU1)", () => {
  it("labels all four platforms, falls back to the raw value", () => {
    expect(platformLabel("meta_page")).toBe("Facebook Page");
    expect(platformLabel("instagram")).toBe("Instagram");
    expect(platformLabel("tiktok")).toBe("TikTok");
    expect(platformLabel("youtube")).toBe("YouTube");
    expect(platformLabel("other")).toBe("other");
  });
});

describe("weekdayLabelBn (SU2)", () => {
  it("0 = রবিবার … 6 = শনিবার", () => {
    expect(weekdayLabelBn(0)).toBe("রবিবার");
    expect(weekdayLabelBn(1)).toBe("সোমবার");
    expect(weekdayLabelBn(3)).toBe("বুধবার");
    expect(weekdayLabelBn(5)).toBe("শুক্রবার");
    expect(weekdayLabelBn(6)).toBe("শনিবার");
    expect(weekdayLabelBn(7)).toBe("");
  });
});

describe("buildPlatformPreview — media summary (SU1)", () => {
  it("text-only / images / video / mixed, with Bengali digits", () => {
    expect(buildPlatformPreview("meta_page", { caption: "হ্যালো", mediaKinds: [] }).mediaSummary).toBe("শুধু লেখা");
    expect(buildPlatformPreview("meta_page", { caption: "হ্যালো", mediaKinds: kinds("iii") }).mediaSummary).toBe("৩টি ছবি");
    expect(buildPlatformPreview("meta_page", { caption: "হ্যালো", mediaKinds: kinds("v") }).mediaSummary).toBe("১টি ভিডিও");
    expect(buildPlatformPreview("instagram", { caption: "হ্যালো", mediaKinds: kinds("iiv") }).mediaSummary).toBe("২টি ছবি ও ১টি ভিডিও");
  });
});

describe("buildPlatformPreview — caption rules (SU1)", () => {
  it("Facebook shows the full caption", () => {
    const long = "ক".repeat(3000);
    expect(buildPlatformPreview("meta_page", { caption: long, mediaKinds: [] }).captionShown).toBe(long);
  });

  it("Instagram truncates the preview at 2200 chars (preview only)", () => {
    const long = "ক".repeat(2500);
    const preview = buildPlatformPreview("instagram", { caption: long, mediaKinds: kinds("i") });
    expect(preview.captionShown).toHaveLength(2200);
  });

  it("YouTube splits title (first line) and description (full caption)", () => {
    const caption = "ঈদ কালেকশন লঞ্চ\nবিস্তারিত বর্ণনা এখানে\nদ্বিতীয় লাইন";
    const preview = buildPlatformPreview("youtube", { caption, mediaKinds: kinds("v") });
    expect(preview.title).toBe("ঈদ কালেকশন লঞ্চ");
    expect(preview.description).toBe(caption);
    expect(preview.captionShown).toBe("ঈদ কালেকশন লঞ্চ");
    expect(preview.warnings).toEqual([]);
  });

  it("non-YouTube previews carry no title/description split", () => {
    const preview = buildPlatformPreview("meta_page", { caption: "লাইন এক\nলাইন দুই", mediaKinds: [] });
    expect(preview.title).toBeNull();
    expect(preview.description).toBeNull();
  });
});

describe("buildPlatformPreview — first comment (SU1)", () => {
  it("shown on Meta platforms, hidden elsewhere even when text exists", () => {
    const input = { caption: "পোস্ট", mediaKinds: kinds("i"), firstCommentText: "অর্ডার করতে ইনবক্স করুন" };
    expect(buildPlatformPreview("meta_page", input).firstCommentShown).toBe("অর্ডার করতে ইনবক্স করুন");
    expect(buildPlatformPreview("instagram", input).firstCommentShown).toBe("অর্ডার করতে ইনবক্স করুন");
    expect(buildPlatformPreview("tiktok", { ...input, mediaKinds: kinds("v") }).firstCommentShown).toBeNull();
    expect(buildPlatformPreview("youtube", { ...input, mediaKinds: kinds("v") }).firstCommentShown).toBeNull();
  });

  it("empty first comment → null everywhere", () => {
    expect(buildPlatformPreview("meta_page", { caption: "পোস্ট", mediaKinds: [], firstCommentText: "  " }).firstCommentShown).toBeNull();
    expect(buildPlatformPreview("meta_page", { caption: "পোস্ট", mediaKinds: [] }).firstCommentShown).toBeNull();
  });
});

describe("buildPlatformPreview — warning matrix (SU1)", () => {
  it("Instagram without media warns; with media does not", () => {
    const noMedia = buildPlatformPreview("instagram", { caption: "পোস্ট", mediaKinds: [] });
    expect(noMedia.warnings.some((w) => w.includes("মিডিয়া ছাড়া"))).toBe(true);
    const withMedia = buildPlatformPreview("instagram", { caption: "পোস্ট", mediaKinds: kinds("i") });
    expect(withMedia.warnings).toEqual([]);
  });

  it("Instagram with more than 10 media warns", () => {
    const preview = buildPlatformPreview("instagram", { caption: "পোস্ট", mediaKinds: kinds("iiiiiiiiiii") });
    expect(preview.warnings.some((w) => w.includes("১১"))).toBe(true);
    const ten = buildPlatformPreview("instagram", { caption: "পোস্ট", mediaKinds: kinds("iiiiiiiiii") });
    expect(ten.warnings).toEqual([]);
  });

  it("TikTok / YouTube need exactly one video", () => {
    for (const platform of ["tiktok", "youtube"] as const) {
      expect(buildPlatformPreview(platform, { caption: "পোস্ট", mediaKinds: [] }).warnings.length).toBeGreaterThan(0);
      expect(buildPlatformPreview(platform, { caption: "পোস্ট", mediaKinds: kinds("i") }).warnings.length).toBeGreaterThan(0);
      expect(buildPlatformPreview(platform, { caption: "পোস্ট", mediaKinds: kinds("vv") }).warnings.length).toBeGreaterThan(0);
      expect(buildPlatformPreview(platform, { caption: "পোস্ট", mediaKinds: kinds("iv") }).warnings.length).toBeGreaterThan(0);
      expect(buildPlatformPreview(platform, { caption: "পোস্ট", mediaKinds: kinds("v") }).warnings).toEqual([]);
    }
  });

  it("YouTube title over 100 chars warns and the preview title is capped", () => {
    const caption = `${"শ".repeat(120)}\nবর্ণনা`;
    const preview = buildPlatformPreview("youtube", { caption, mediaKinds: kinds("v") });
    expect(preview.warnings.some((w) => w.includes("১০০"))).toBe(true);
    expect(preview.title).toHaveLength(100);
    const ok = buildPlatformPreview("youtube", { caption: "ছোট শিরোনাম\nবর্ণনা", mediaKinds: kinds("v") });
    expect(ok.warnings).toEqual([]);
  });

  it("Facebook video mixed with other media warns; video alone / images alone do not", () => {
    expect(buildPlatformPreview("meta_page", { caption: "পোস্ট", mediaKinds: kinds("vi") }).warnings.length).toBeGreaterThan(0);
    expect(buildPlatformPreview("meta_page", { caption: "পোস্ট", mediaKinds: kinds("vv") }).warnings.length).toBeGreaterThan(0);
    expect(buildPlatformPreview("meta_page", { caption: "পোস্ট", mediaKinds: kinds("v") }).warnings).toEqual([]);
    expect(buildPlatformPreview("meta_page", { caption: "পোস্ট", mediaKinds: kinds("iii") }).warnings).toEqual([]);
    expect(buildPlatformPreview("meta_page", { caption: "পোস্ট", mediaKinds: [] }).warnings).toEqual([]);
  });

  it("all warnings are Bengali text", () => {
    const preview = buildPlatformPreview("instagram", { caption: "পোস্ট", mediaKinds: [] });
    for (const w of preview.warnings) expect(w).toMatch(/[\u0980-\u09FF]/);
  });
});

describe("groupVariantsForSave (SU1)", () => {
  const base = {
    caption: "মূল ক্যাপশন\nদ্বিতীয় লাইন",
    linkUrl: " https://shop.example/item ",
    mediaRefs: [{ assetId: "m1", kind: "image" as const }],
    firstCommentText: "মূল প্রথম কমেন্ট",
    recurrenceFrequency: "weekly" as const,
    recurrenceInterval: 2,
  };

  it("builds one variant per account, sharing base fields", () => {
    const payload = groupVariantsForSave(["a1", "a2"], base, {});
    expect(payload.name).toBe("মূল ক্যাপশন");
    expect(payload.variants).toHaveLength(2);
    for (const v of payload.variants) {
      expect(v.caption).toBe(base.caption);
      expect(v.linkUrl).toBe("https://shop.example/item");
      expect(v.mediaRefs).toEqual(base.mediaRefs);
      expect(v.firstCommentText).toBe("মূল প্রথম কমেন্ট");
      expect(v.recurrenceFrequency).toBe("weekly");
      expect(v.recurrenceInterval).toBe(2);
    }
    expect(payload.variants.map((v) => v.socialAccountId)).toEqual(["a1", "a2"]);
  });

  it("an override caption / first comment lands on its own account only", () => {
    const payload = groupVariantsForSave(["a1", "a2"], base, {
      a2: { caption: "শুধু দ্বিতীয় অ্যাকাউন্টের ক্যাপশন", firstCommentText: "শুধু দ্বিতীয়টির কমেন্ট" },
    });
    expect(payload.variants[0].caption).toBe(base.caption);
    expect(payload.variants[0].firstCommentText).toBe("মূল প্রথম কমেন্ট");
    expect(payload.variants[1].caption).toBe("শুধু দ্বিতীয় অ্যাকাউন্টের ক্যাপশন");
    expect(payload.variants[1].firstCommentText).toBe("শুধু দ্বিতীয়টির কমেন্ট");
  });

  it("an empty / whitespace override falls back to the base value", () => {
    const payload = groupVariantsForSave(["a1"], base, { a1: { caption: "   ", firstCommentText: "" } });
    expect(payload.variants[0].caption).toBe(base.caption);
    expect(payload.variants[0].firstCommentText).toBe("মূল প্রথম কমেন্ট");
  });

  it("omits empty link / first comment / recurrence from the payload", () => {
    const payload = groupVariantsForSave(["a1"], { caption: "শুধু ক্যাপশন", mediaRefs: [] }, {});
    expect(payload.variants[0]).toEqual({ socialAccountId: "a1", caption: "শুধু ক্যাপশন", mediaRefs: [] });
  });

  it("group name: first line, capped, Untitled group when the caption is empty", () => {
    expect(groupNameFromCaption("প্রথম লাইন\nবাকি")).toBe("প্রথম লাইন");
    expect(groupNameFromCaption("")).toBe("Untitled group");
    expect(groupNameFromCaption("\nদ্বিতীয় লাইন")).toBe("Untitled group");
    expect(groupNameFromCaption("ক".repeat(120))).toHaveLength(81); // 80 chars + "…"
    expect(groupVariantsForSave(["a1"], { caption: "", mediaRefs: [] }, {}).name).toBe("Untitled group");
  });
});
