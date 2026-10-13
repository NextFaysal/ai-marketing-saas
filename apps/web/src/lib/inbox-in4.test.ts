import { describe, expect, it } from "vitest";
import { parseSlaMinutesInput, slaChipInfo } from "./inbox-in4";

// IN4: the card chip formats the SERVER's SLA verdict only.
const NOW = new Date("2026-10-12T12:00:00.000Z").getTime();
const iso = (ms: number) => new Date(ms).toISOString();

describe("slaChipInfo", () => {
  it("warning chip counts down to the server deadline", () => {
    const chip = slaChipInfo({ slaState: "warning", slaDueAt: iso(NOW + 10 * 60000) }, NOW);
    expect(chip).toEqual({ tone: "warning", label: "⏰ SLA সতর্কতা — আর 10 মিনিট" });
  });
  it("breached chip states the overdue minutes", () => {
    const chip = slaChipInfo({ slaState: "breached", slaDueAt: iso(NOW - 25 * 60000) }, NOW);
    expect(chip?.tone).toBe("breached");
    expect(chip?.label).toContain("25 মিনিট পেরিয়ে গেছে");
  });
  it("no chip without a server verdict or with a corrupt deadline", () => {
    expect(slaChipInfo({ slaState: null, slaDueAt: iso(NOW) }, NOW)).toBeNull();
    expect(slaChipInfo({ slaState: "warning", slaDueAt: null }, NOW)).toBeNull();
    expect(slaChipInfo({ slaState: "warning", slaDueAt: "junk" }, NOW)).toBeNull();
    expect(slaChipInfo({ slaState: "other", slaDueAt: iso(NOW) }, NOW)).toBeNull();
  });
});

describe("parseSlaMinutesInput", () => {
  it("blank = no override, integers pass, garbage is invalid", () => {
    expect(parseSlaMinutesInput("")).toBeNull();
    expect(parseSlaMinutesInput(" 30 ")).toBe(30);
    expect(parseSlaMinutesInput("0")).toBeUndefined();
    expect(parseSlaMinutesInput("abc")).toBeUndefined();
    expect(parseSlaMinutesInput("10081")).toBeUndefined();
  });
});
