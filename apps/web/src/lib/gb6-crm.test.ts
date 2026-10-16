import { describe, expect, it } from "vitest";
import {
  EMPTY_SEGMENT_DRAFT,
  buildCustomerListParams,
  buildSegmentCriteria,
  buildSegmentPayload,
  normalizeTags,
  segmentCriteriaSummary,
  segmentCriteriaToDraft,
  validateNewTag,
  validateTags,
} from "./gb6-crm";

describe("customer tag validation (mirrors customers.service)", () => {
  it("accepts up to 10 tags of 1-30 chars", () => {
    expect(validateTags([])).toBeNull();
    expect(validateTags(["নিয়মিত", "ঢাকা"])).toBeNull();
    expect(validateTags(Array.from({ length: 10 }, (_, i) => `t${i}`))).toBeNull();
    expect(validateTags(["x".repeat(30)])).toBeNull();
  });

  it("rejects the 11th tag and over-long / empty tags", () => {
    expect(validateTags(Array.from({ length: 11 }, (_, i) => `t${i}`))).toContain("১০টি");
    expect(validateTags(["x".repeat(31)])).toContain("১–৩০");
    expect(validateTags(["  "])).toContain("১–৩০");
  });

  it("normalizes by trimming and deduping", () => {
    expect(normalizeTags([" ঢাকা ", "ঢাকা", "", "VIP"])).toEqual(["ঢাকা", "VIP"]);
  });

  it("validateNewTag checks candidate, duplicates and the ceiling", () => {
    expect(validateNewTag(["a"], " b ")).toBeNull();
    expect(validateNewTag(["a"], "a")).toContain("ইতিমধ্যে");
    expect(validateNewTag(["a"], "  ")).not.toBeNull();
    expect(validateNewTag(["a"], "x".repeat(31))).toContain("১–৩০");
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`);
    expect(validateNewTag(ten, "new")).toContain("১০টি");
  });
});

describe("buildCustomerListParams", () => {
  it("omits empty/default filters entirely", () => {
    const p = buildCustomerListParams({ q: " ", hasDue: false, customerType: "all", tag: "", segmentId: "" });
    expect(p.toString()).toBe("");
  });

  it("sets every wired filter", () => {
    const p = buildCustomerListParams({ q: " রহিম ", hasDue: true, customerType: "vip", tag: "ঢাকা", segmentId: "seg1" });
    expect(p.get("q")).toBe("রহিম");
    expect(p.get("hasDue")).toBe("true");
    expect(p.get("customerType")).toBe("vip");
    expect(p.get("tag")).toBe("ঢাকা");
    expect(p.get("segmentId")).toBe("seg1");
  });
});

describe("buildSegmentCriteria", () => {
  it("empty draft builds an empty criteria object (all-optional)", () => {
    const { criteria, errors } = buildSegmentCriteria(EMPTY_SEGMENT_DRAFT);
    expect(errors).toEqual([]);
    expect(criteria).toEqual({});
  });

  it("converts min spent taka to a minor string", () => {
    const { criteria, errors } = buildSegmentCriteria({ ...EMPTY_SEGMENT_DRAFT, minSpentTaka: "5000.50" });
    expect(errors).toEqual([]);
    expect(criteria).toEqual({ minSpentMinor: "500050" });
  });

  it("sets boolean criteria only when the checkbox is on (never false)", () => {
    const on = buildSegmentCriteria({ ...EMPTY_SEGMENT_DRAFT, vipOnly: true, repeatOnly: true });
    expect(on.criteria).toEqual({ isVip: true, isRepeat: true });
    const off = buildSegmentCriteria(EMPTY_SEGMENT_DRAFT);
    expect(off.criteria).not.toHaveProperty("isVip");
    expect(off.criteria).not.toHaveProperty("isRepeat");
  });

  it("includes tagsAny + district, trimmed and deduped", () => {
    const { criteria } = buildSegmentCriteria({
      ...EMPTY_SEGMENT_DRAFT, tagsAny: [" ঢাকা ", "ঢাকা", "VIP"], district: " খুলনা ",
    });
    expect(criteria).toEqual({ tagsAny: ["ঢাকা", "VIP"], district: "খুলনা" });
  });

  it("flags bad taka, over-long tags and over-long district instead of sending", () => {
    expect(buildSegmentCriteria({ ...EMPTY_SEGMENT_DRAFT, minSpentTaka: "abc" }).criteria).toBeNull();
    expect(buildSegmentCriteria({ ...EMPTY_SEGMENT_DRAFT, tagsAny: ["x".repeat(31)] }).errors.length).toBeGreaterThan(0);
    expect(buildSegmentCriteria({ ...EMPTY_SEGMENT_DRAFT, district: "x".repeat(101) }).errors.length).toBeGreaterThan(0);
  });

  it("round-trips stored criteria back into the draft", () => {
    const draft = segmentCriteriaToDraft({ tagsAny: ["a"], isVip: true, minSpentMinor: "500050", district: "ঢাকা" });
    expect(draft).toEqual({ tagsAny: ["a"], vipOnly: true, repeatOnly: false, minSpentTaka: "5000.50", district: "ঢাকা" });
    const rebuilt = buildSegmentCriteria(draft);
    expect(rebuilt.criteria).toEqual({ tagsAny: ["a"], isVip: true, minSpentMinor: "500050", district: "ঢাকা" });
    expect(segmentCriteriaToDraft(null)).toEqual(EMPTY_SEGMENT_DRAFT);
    expect(segmentCriteriaToDraft({ isVip: false }).vipOnly).toBe(false);
  });
});

describe("buildSegmentPayload + summary", () => {
  it("requires a 1-120 char name", () => {
    expect(buildSegmentPayload(" ", EMPTY_SEGMENT_DRAFT).payload).toBeNull();
    expect(buildSegmentPayload("x".repeat(121), EMPTY_SEGMENT_DRAFT).payload).toBeNull();
    const ok = buildSegmentPayload(" বড় ক্রেতা ", { ...EMPTY_SEGMENT_DRAFT, vipOnly: true });
    expect(ok.payload).toEqual({ name: "বড় ক্রেতা", criteria: { isVip: true } });
  });

  it("summarizes criteria in Bengali and labels empty criteria honestly", () => {
    expect(segmentCriteriaSummary({})).toContain("সব গ্রাহক");
    const s = segmentCriteriaSummary({ tagsAny: ["ঢাকা"], isRepeat: true, minSpentMinor: "100000", district: "খুলনা" });
    expect(s).toContain("ঢাকা");
    expect(s).toContain("পুনরাবৃত্ত");
    expect(s).toContain("1000");
    expect(s).toContain("খুলনা");
  });
});
