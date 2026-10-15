import { describe, expect, it } from "vitest";
import { mentionSegments, monthGrid, planCalendarDate, sameDay } from "./campaign-cn10";

describe("mentionSegments", () => {
  it("highlights only server-resolved @names", () => {
    const segs = mentionSegments("বাজেট দেখুন @Rahim Uddin ধন্যবাদ @অন্য", ["Rahim Uddin"]);
    expect(segs).toEqual([
      { text: "বাজেট দেখুন ", mention: false },
      { text: "@Rahim Uddin", mention: true },
      { text: " ধন্যবাদ @অন্য", mention: false },
    ]);
  });
  it("no mentions → single plain segment", () => {
    expect(mentionSegments("hello", [])).toEqual([{ text: "hello", mention: false }]);
  });
  it("longest name wins over a prefix name", () => {
    const segs = mentionSegments("@Abdul Karim এলেন", ["Abdul", "Abdul Karim"]);
    expect(segs[0]).toEqual({ text: "@Abdul Karim", mention: true });
  });
});

describe("planCalendarDate", () => {
  it("prefers publishedAt, then publishAt, then createdAt", () => {
    expect(planCalendarDate({ publishedAt: "2026-10-02T00:00:00Z", publishAt: "2026-10-05T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" })?.kind).toBe("published");
    expect(planCalendarDate({ publishAt: "2026-10-05T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" })?.kind).toBe("scheduled");
    expect(planCalendarDate({ createdAt: "2026-10-01T00:00:00Z" })?.kind).toBe("created");
    expect(planCalendarDate({})).toBeNull();
  });
});

describe("monthGrid", () => {
  it("starts on a Monday and covers the whole month", () => {
    const cells = monthGrid(2026, 9, new Date(2026, 9, 14)); // October 2026
    expect(cells[0].day.getDay()).toBe(1);
    expect(cells.length % 7).toBe(0);
    expect(cells.some((c) => c.inMonth && c.day.getDate() === 31)).toBe(true);
    expect(cells.find((c) => c.isToday)?.day.getDate()).toBe(14);
    expect(sameDay(new Date(2026, 9, 14), new Date(2026, 9, 14))).toBe(true);
  });
});
