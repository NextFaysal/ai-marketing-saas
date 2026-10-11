import { describe, expect, it } from "vitest";
import { SNOOZE_PRESETS, isActivelySnoozed, snoozeBodyForCustom, snoozeBodyForMinutes } from "./snooze";

describe("SNOOZE_PRESETS", () => {
  it("carries the three action-bar presets (1h / 4h / 24h)", () => {
    expect(SNOOZE_PRESETS.map((p) => p.minutes)).toEqual([60, 240, 1440]);
    expect(SNOOZE_PRESETS.map((p) => p.label)).toEqual(["১ ঘণ্টা", "৪ ঘণ্টা", "২৪ ঘণ্টা"]);
  });
});

describe("snoozeBodyForMinutes", () => {
  it("builds a minutes body inside the API range, boundaries included", () => {
    expect(snoozeBodyForMinutes(60)).toEqual({ minutes: 60 });
    expect(snoozeBodyForMinutes(5)).toEqual({ minutes: 5 });
    expect(snoozeBodyForMinutes(10080)).toEqual({ minutes: 10080 });
  });

  it("rejects out-of-range and non-integer minutes", () => {
    expect(snoozeBodyForMinutes(4)).toBeNull();
    expect(snoozeBodyForMinutes(10081)).toBeNull();
    expect(snoozeBodyForMinutes(30.5)).toBeNull();
    expect(snoozeBodyForMinutes(Number.NaN)).toBeNull();
  });
});

describe("snoozeBodyForCustom", () => {
  const now = new Date("2026-10-12T10:00:00.000Z");

  it("builds an until body (ISO) for a future local datetime", () => {
    const body = snoozeBodyForCustom("2026-10-12T18:30", now);
    expect(body).not.toBeNull();
    expect(new Date((body as { until: string }).until).getTime()).toBe(new Date("2026-10-12T18:30").getTime());
  });

  it("rejects past times, times within 60s, garbage and empty input", () => {
    expect(snoozeBodyForCustom("2026-10-12T09:00", now)).toBeNull();
    expect(snoozeBodyForCustom("2026-10-12T10:00:30", now)).toBeNull();
    expect(snoozeBodyForCustom("not-a-date", now)).toBeNull();
    expect(snoozeBodyForCustom("", now)).toBeNull();
  });
});

describe("isActivelySnoozed", () => {
  const now = new Date("2026-10-12T10:00:00.000Z");

  it("is true only for a parseable future wake time", () => {
    expect(isActivelySnoozed("2026-10-12T11:00:00.000Z", now)).toBe(true);
    expect(isActivelySnoozed("2026-10-12T09:00:00.000Z", now)).toBe(false);
    expect(isActivelySnoozed(null, now)).toBe(false);
    expect(isActivelySnoozed(undefined, now)).toBe(false);
    expect(isActivelySnoozed("garbage", now)).toBe(false);
  });
});
