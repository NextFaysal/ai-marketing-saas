import { describe, expect, it } from "vitest";
import {
  ASPECT_OPTIONS,
  buildMediaQuery,
  formatMediaTags,
  parseMediaTagsInput,
  summarizeBulkResults,
} from "./social-media-library";

describe("ASPECT_OPTIONS (SU3)", () => {
  it("offers exactly the four frozen aspects in order", () => {
    expect(ASPECT_OPTIONS.map((o) => o.value)).toEqual(["1:1", "4:5", "9:16", "16:9"]);
    expect(ASPECT_OPTIONS.every((o) => o.label.includes(o.value))).toBe(true);
  });
});

describe("parseMediaTagsInput (SU3)", () => {
  it("splits on commas and spaces, trims and drops empties", () => {
    expect(parseMediaTagsInput(" eid, offer  new ,,  sale ")).toEqual(["eid", "offer", "new", "sale"]);
    expect(parseMediaTagsInput("")).toEqual([]);
    expect(parseMediaTagsInput(" , , ")).toEqual([]);
  });

  it("dedupes case-insensitively, keeping the first spelling", () => {
    expect(parseMediaTagsInput("Eid, eid, EID, Offer, offer")).toEqual(["Eid", "Offer"]);
  });

  it("caps at 20 tags", () => {
    const input = Array.from({ length: 25 }, (_, i) => `tag${i + 1}`).join(",");
    const parsed = parseMediaTagsInput(input);
    expect(parsed).toHaveLength(20);
    expect(parsed[19]).toBe("tag20");
  });

  it("keeps Bengali tags intact", () => {
    expect(parseMediaTagsInput("ঈদ, অফার নতুন")).toEqual(["ঈদ", "অফার", "নতুন"]);
  });
});

describe("formatMediaTags (SU3)", () => {
  it("joins with ', ' and tolerates empty input", () => {
    expect(formatMediaTags(["eid", "offer"])).toBe("eid, offer");
    expect(formatMediaTags([])).toBe("");
    expect(formatMediaTags(undefined)).toBe("");
    expect(formatMediaTags(null)).toBe("");
  });

  it("round-trips through parseMediaTagsInput", () => {
    const tags = ["eid", "ঈদ অফার".replace(" ", "-"), "sale"];
    expect(parseMediaTagsInput(formatMediaTags(tags))).toEqual(tags);
  });
});

describe("buildMediaQuery (SU3)", () => {
  it("returns '' when there are no filters", () => {
    expect(buildMediaQuery({})).toBe("");
    expect(buildMediaQuery({ folderId: "", tag: "  ", q: undefined })).toBe("");
    expect(buildMediaQuery({ folderId: null, tag: null, q: null })).toBe("");
  });

  it("includes only the non-empty filters, URL-encoded", () => {
    expect(buildMediaQuery({ folderId: "f1" })).toBe("folderId=f1");
    expect(buildMediaQuery({ folderId: "none" })).toBe("folderId=none");
    const qs = buildMediaQuery({ folderId: "f1", tag: "ঈদ", q: "red dress" });
    const params = new URLSearchParams(qs);
    expect(params.get("folderId")).toBe("f1");
    expect(params.get("tag")).toBe("ঈদ");
    expect(params.get("q")).toBe("red dress");
  });
});

describe("summarizeBulkResults (SU3)", () => {
  it("summarises mixed results in Bengali digits", () => {
    expect(
      summarizeBulkResults([
        { id: "a", ok: true },
        { id: "b", ok: true },
        { id: "c", ok: true },
        { id: "d", ok: false, error: "x" },
      ]),
    ).toBe("৩টি সফল, ১টি ব্যর্থ");
  });

  it("omits the zero side and handles an empty list", () => {
    expect(summarizeBulkResults([{ id: "a", ok: true }])).toBe("১টি সফল");
    expect(summarizeBulkResults([{ id: "a", ok: false, error: "x" }])).toBe("১টি ব্যর্থ");
    expect(summarizeBulkResults([])).toBe("কোনো ফলাফল পাওয়া যায়নি");
    expect(summarizeBulkResults(undefined)).toBe("কোনো ফলাফল পাওয়া যায়নি");
  });
});
