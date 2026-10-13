import { describe, expect, it } from "vitest";
import { STARTER_PROMPTS, filterPrompts, type SavedPrompt } from "./ai-prompts";

const saved: SavedPrompt[] = [
  { id: "1", title: "সাপ্তাহিক রিপোর্ট", body: "গত সপ্তাহের বিক্রি আর লাভের সারাংশ দাও", createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z" },
  { id: "2", title: "Courier check", body: "কুরিয়ারদের পারফরম্যান্স কেমন?", createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z" },
];

describe("STARTER_PROMPTS", () => {
  it("is the canonical nine, unique and non-empty", () => {
    expect(STARTER_PROMPTS).toHaveLength(9);
    expect(new Set(STARTER_PROMPTS).size).toBe(9);
    for (const s of STARTER_PROMPTS) expect(s.trim().length).toBeGreaterThan(0);
  });
});

describe("filterPrompts", () => {
  it("empty query lists starters first, then saved", () => {
    const items = filterPrompts(STARTER_PROMPTS, saved, "");
    expect(items).toHaveLength(11);
    expect(items[0].kind).toBe("starter");
    expect(items[9].kind).toBe("saved");
    expect(items[9].title).toBe("সাপ্তাহিক রিপোর্ট");
  });
  it("matches case-insensitively over title and body", () => {
    expect(filterPrompts(STARTER_PROMPTS, saved, "COURIER").map((i) => i.title)).toEqual(["Courier check"]);
    expect(filterPrompts(STARTER_PROMPTS, saved, "সারাংশ").map((i) => i.title)).toEqual(["সাপ্তাহিক রিপোর্ট"]);
    expect(filterPrompts(STARTER_PROMPTS, saved, "স্টক").map((i) => i.title)).toEqual(["স্টকের অবস্থা কেমন?"]);
  });
  it("no match → empty list", () => {
    expect(filterPrompts(STARTER_PROMPTS, saved, "zzz-no-match")).toEqual([]);
  });
});
