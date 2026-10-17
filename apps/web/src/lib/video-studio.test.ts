import { describe, expect, it } from "vitest";
import {
  VIDEO_HONESTY_NOTE, buildCreateProjectPayload, buildPublishPayload, canPublish,
  canRetryRender, isPublished, projectStatusChip, socialPostHref, templateLabel,
  videoPreviewSrc,
} from "./video-studio";

describe("projectStatusChip", () => {
  it("maps the four API statuses to Bengali labels", () => {
    expect(projectStatusChip("queued").label).toBe("অপেক্ষমাণ");
    expect(projectStatusChip("rendering").label).toBe("তৈরি হচ্ছে");
    expect(projectStatusChip("ready").label).toBe("প্রস্তুত");
    expect(projectStatusChip("failed").label).toBe("ব্যর্থ");
  });
});

describe("templateLabel", () => {
  it("showcase/offer get Bengali labels, unknown passes through", () => {
    expect(templateLabel("showcase")).toBe("শোকেস");
    expect(templateLabel("offer")).toBe("অফার");
    expect(templateLabel("other")).toBe("other");
  });
});

describe("canPublish / canRetryRender / isPublished", () => {
  it("publish only when ready", () => {
    expect(canPublish({ status: "ready" })).toBe(true);
    expect(canPublish({ status: "queued" })).toBe(false);
    expect(canPublish({ status: "rendering" })).toBe(false);
    expect(canPublish({ status: "failed" })).toBe(false);
  });

  it("retry only for failed or queued", () => {
    expect(canRetryRender({ status: "failed" })).toBe(true);
    expect(canRetryRender({ status: "queued" })).toBe(true);
    expect(canRetryRender({ status: "ready" })).toBe(false);
    expect(canRetryRender({ status: "rendering" })).toBe(false);
  });

  it("published is exactly socialPostId presence", () => {
    expect(isPublished({ socialPostId: "post-1" })).toBe(true);
    expect(isPublished({ socialPostId: null })).toBe(false);
    expect(socialPostHref({ socialPostId: "post-1" })).toBe("/dashboard/social-posts");
  });
});

describe("videoPreviewSrc", () => {
  it("absolute CDN URLs pass through untouched", () => {
    expect(videoPreviewSrc("https://media.qosprey.com/org/video-studio/x.mp4", "/backend"))
      .toBe("https://media.qosprey.com/org/video-studio/x.mp4");
  });

  it("relative /public/media paths are prefixed with the API base", () => {
    expect(videoPreviewSrc("/public/media/token123", "/backend")).toBe("/backend/public/media/token123");
  });

  it("no asset → no preview (never fabricated)", () => {
    expect(videoPreviewSrc(null, "/backend")).toBeNull();
    expect(videoPreviewSrc(undefined, "/backend")).toBeNull();
    expect(videoPreviewSrc("", "/backend")).toBeNull();
  });
});

describe("payload builders", () => {
  it("create payload omits empty offer text and defaults template/language", () => {
    expect(buildCreateProjectPayload({ productId: "p1", template: "", language: "", offerText: "  " }))
      .toEqual({ productId: "p1", template: "showcase", language: "bn" });
    expect(buildCreateProjectPayload({ productId: "p1", template: "offer", language: "en", offerText: " ২০% ছাড় " }))
      .toEqual({ productId: "p1", template: "offer", language: "en", offerText: "২০% ছাড়" });
  });

  it("publish payload omits both optionals when blank", () => {
    expect(buildPublishPayload({})).toEqual({});
    expect(buildPublishPayload({ socialAccountId: " acc-1 ", caption: " ক্যাপশন " }))
      .toEqual({ socialAccountId: "acc-1", caption: "ক্যাপশন" });
  });
});

describe("honesty note", () => {
  it("names local ffmpeg template rendering and the missing AI video, never claims AI", () => {
    expect(VIDEO_HONESTY_NOTE).toContain("ffmpeg");
    expect(VIDEO_HONESTY_NOTE).toContain("AI ভিডিও সুবিধা এখনো যুক্ত হয়নি");
    expect(VIDEO_HONESTY_NOTE).not.toContain("AI-generated");
  });
});
