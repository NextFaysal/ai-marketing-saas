import { describe, expect, it } from "vitest";
import { relTimeBn } from "./rel-time-bn";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000).toISOString();

describe("relTimeBn", () => {
  it("under a minute is এইমাত্র, with Bengali digits after", () => {
    expect(relTimeBn(ago(30), NOW)).toBe("এইমাত্র");
    expect(relTimeBn(ago(5 * 60), NOW)).toBe("৫ মিনিট আগে");
    expect(relTimeBn(ago(59 * 60), NOW)).toBe("৫৯ মিনিট আগে");
  });
  it("hours and days use bn-BD grouped digits", () => {
    expect(relTimeBn(ago(2 * 3600), NOW)).toBe("২ ঘণ্টা আগে");
    expect(relTimeBn(ago(23 * 3600), NOW)).toBe("২৩ ঘণ্টা আগে");
    expect(relTimeBn(ago(3 * 86400), NOW)).toBe("৩ দিন আগে");
    expect(relTimeBn(ago(6 * 86400), NOW)).toBe("৬ দিন আগে");
  });
  it("a week or older falls back to the absolute bn-BD date", () => {
    const old = ago(8 * 86400);
    expect(relTimeBn(old, NOW)).toBe(new Date(old).toLocaleDateString("bn-BD"));
  });
  it("missing or invalid input renders empty, never a fake time", () => {
    expect(relTimeBn(null, NOW)).toBe("");
    expect(relTimeBn(undefined, NOW)).toBe("");
    expect(relTimeBn("not-a-date", NOW)).toBe("");
  });
});
