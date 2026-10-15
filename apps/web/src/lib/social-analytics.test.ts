import { describe, expect, it } from "vitest";
import {
  contentTypeLabel,
  currentMonthValue,
  dayLabelBn,
  followerGrowth,
  formatBnNumber,
  monthLabelBn,
  parseYoutubeTagsInput,
  platformFieldsForSave,
  timeseriesBars,
  youtubeTagsToInput,
  type SocialTimeseriesDay,
} from "./social-analytics";

function day(dayStr: string, total: number, posts: number): SocialTimeseriesDay {
  return { day: dayStr, metrics: {}, engagement: { total, posts } };
}

describe("timeseriesBars (SU7)", () => {
  it("heights are relative to the busiest day (0–100)", () => {
    const bars = timeseriesBars([day("2026-10-11", 10, 2), day("2026-10-12", 40, 3), day("2026-10-13", 20, 1)]);
    expect(bars.map((b) => b.heightPct)).toEqual([25, 100, 50]);
    expect(bars[1]).toMatchObject({ day: "2026-10-12", engagementTotal: 40, posts: 3 });
  });

  it("all-zero engagement → every heightPct is 0 (no NaN / divide-by-zero)", () => {
    const bars = timeseriesBars([day("2026-10-12", 0, 0), day("2026-10-13", 0, 0)]);
    expect(bars.map((b) => b.heightPct)).toEqual([0, 0]);
  });

  it("empty / missing series → no bars", () => {
    expect(timeseriesBars([])).toEqual([]);
    expect(timeseriesBars(null)).toEqual([]);
    expect(timeseriesBars(undefined)).toEqual([]);
  });

  it("labels are Bengali day + month names", () => {
    expect(timeseriesBars([day("2026-10-13", 5, 1)])[0].label).toBe("১৩ অক্টোবর");
    expect(dayLabelBn("2026-01-05")).toBe("৫ জানুয়ারি");
    expect(dayLabelBn("not-a-date")).toBe("not-a-date");
  });
});

describe("contentTypeLabel (SU7)", () => {
  it("maps the four known types to Bengali labels", () => {
    expect(contentTypeLabel("text")).toBe("লেখা মাত্র");
    expect(contentTypeLabel("photo")).toBe("ছবি");
    expect(contentTypeLabel("carousel")).toBe("ক্যারোসেল");
    expect(contentTypeLabel("video")).toBe("ভিডিও");
  });

  it("an unknown type falls back to its raw value", () => {
    expect(contentTypeLabel("live")).toBe("live");
  });
});

describe("followerGrowth (SU7)", () => {
  it("fewer than two snapshots → null (no invented growth)", () => {
    expect(followerGrowth([])).toBe(null);
    expect(followerGrowth([{ day: "2026-10-13", followers: 120 }])).toBe(null);
    expect(followerGrowth(null)).toBe(null);
    expect(followerGrowth(undefined)).toBe(null);
  });

  it("first → last delta with the real day gap, sorted by day", () => {
    const growth = followerGrowth([
      { day: "2026-10-13", followers: 150 },
      { day: "2026-10-06", followers: 100 },
      { day: "2026-10-10", followers: 130 },
    ]);
    expect(growth).toEqual({ first: 100, last: 150, delta: 50, days: 7 });
  });

  it("a decline is reported honestly as a negative delta", () => {
    expect(followerGrowth([
      { day: "2026-10-01", followers: 200 },
      { day: "2026-10-08", followers: 180 },
    ])).toEqual({ first: 200, last: 180, delta: -20, days: 7 });
  });
});

describe("monthly report helpers (SU7)", () => {
  it("currentMonthValue pads the month", () => {
    expect(currentMonthValue(new Date(2026, 9, 13))).toBe("2026-10");
    expect(currentMonthValue(new Date(2026, 0, 5))).toBe("2026-01");
  });

  it("monthLabelBn renders the Bengali month name + Bengali year", () => {
    expect(monthLabelBn("2026-10")).toBe("অক্টোবর ২০২৬");
    expect(monthLabelBn("2025-02")).toBe("ফেব্রুয়ারি ২০২৫");
  });

  it("invalid month values are returned as-is", () => {
    expect(monthLabelBn("2026-13")).toBe("2026-13");
    expect(monthLabelBn("garbage")).toBe("garbage");
  });

  it("formatBnNumber uses bn-BD digits and grouping", () => {
    expect(formatBnNumber(1234)).toBe("১,২৩৪");
    expect(formatBnNumber(12.5, 1)).toBe("১২.৫");
  });
});

describe("YouTube tags input (SU8)", () => {
  it("parses comma-separated tags: trims, drops '#', dedupes, drops empties", () => {
    expect(parseYoutubeTagsInput(" ঈদ, #অফার ,, ঈদ , শাড়ি ")).toEqual(["ঈদ", "অফার", "শাড়ি"]);
    expect(parseYoutubeTagsInput("")).toEqual([]);
  });

  it("round-trips through youtubeTagsToInput", () => {
    expect(youtubeTagsToInput(["a", "b"])).toBe("a, b");
    expect(youtubeTagsToInput(null)).toBe("");
    expect(parseYoutubeTagsInput(youtubeTagsToInput(["x", "y"]))).toEqual(["x", "y"]);
  });
});

describe("platformFieldsForSave (SU8)", () => {
  const emptyForm = {
    youtubeTitle: "",
    youtubeTags: [] as string[],
    youtubeCategoryId: "",
    youtubeIsShort: false,
    coverAssetId: "",
    isStory: false,
    isStoryApplicable: false,
  };

  it("create: empty fields are omitted entirely", () => {
    expect(platformFieldsForSave(emptyForm, "create")).toEqual({});
  });

  it("create: only filled fields are sent; isStory only when applicable", () => {
    expect(platformFieldsForSave({
      ...emptyForm,
      youtubeTitle: "  ঈদ ভিডিও ",
      youtubeTags: ["ঈদ"],
      youtubeIsShort: true,
      isStory: true, // not applicable → must not be sent
    }, "create")).toEqual({ youtubeTitle: "ঈদ ভিডিও", youtubeTags: ["ঈদ"], youtubeIsShort: true });
    expect(platformFieldsForSave({ ...emptyForm, isStory: true, isStoryApplicable: true }, "create"))
      .toEqual({ isStory: true });
  });

  it("update: empty fields clear via null / [] / false", () => {
    expect(platformFieldsForSave(emptyForm, "update")).toEqual({
      youtubeTitle: null,
      youtubeTags: [],
      youtubeCategoryId: null,
      youtubeIsShort: false,
      coverAssetId: null,
    });
    expect(platformFieldsForSave({ ...emptyForm, isStoryApplicable: true }, "update"))
      .toMatchObject({ isStory: false });
  });
});
