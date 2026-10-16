import { describe, expect, it } from "vitest";
import { flashOffsetMs, flashRemainingMs, formatCountdown } from "./shop-flash";

/**
 * GB7 (GC18) — flash countdown math. The pinned rule: remaining
 * time is measured on the SERVER clock (serverNow offset applied
 * to the client clock), never on the visitor's raw clock alone.
 */
describe("flashOffsetMs", () => {
  it("is server minus client at mount", () => {
    const clientNow = Date.parse("2026-10-15T10:00:00.000Z");
    expect(flashOffsetMs("2026-10-15T10:00:05.000Z", clientNow)).toBe(5000);
    expect(flashOffsetMs("2026-10-15T09:59:55.000Z", clientNow)).toBe(-5000);
    expect(flashOffsetMs("2026-10-15T10:00:00.000Z", clientNow)).toBe(0);
  });

  it("falls back to 0 for unparseable input", () => {
    expect(flashOffsetMs("not-a-date", 123)).toBe(0);
    expect(flashOffsetMs("2026-10-15T10:00:00.000Z", Number.NaN)).toBe(0);
  });
});

describe("flashRemainingMs", () => {
  const endsAt = "2026-10-15T12:00:00.000Z";

  it("counts down on the server clock via the offset", () => {
    // Client clock is 5s BEHIND the server: offset +5000.
    const mountClient = Date.parse("2026-10-15T11:00:00.000Z");
    const offset = flashOffsetMs("2026-10-15T11:00:05.000Z", mountClient);
    // One minute of client time later the server clock reads
    // 11:01:05, so 58m55s remain until 12:00:00.
    expect(flashRemainingMs(endsAt, offset, mountClient + 60_000)).toBe(3535_000);
  });

  it("clamps at zero once the sale has ended", () => {
    const after = Date.parse("2026-10-15T13:00:00.000Z");
    expect(flashRemainingMs(endsAt, 0, after)).toBe(0);
    expect(flashRemainingMs(endsAt, 0, Date.parse(endsAt))).toBe(0);
  });

  it("returns 0 for an unparseable endsAt", () => {
    expect(flashRemainingMs("nope", 0, Date.now())).toBe(0);
  });
});

describe("formatCountdown", () => {
  it("formats HH:MM:SS with zero padding", () => {
    expect(formatCountdown(0)).toBe("00:00:00");
    expect(formatCountdown(1000)).toBe("00:00:01");
    expect(formatCountdown(61_000)).toBe("00:01:01");
    expect(formatCountdown(3_661_000)).toBe("01:01:01");
    expect(formatCountdown((7 * 3600 + 23 * 60 + 11) * 1000)).toBe("07:23:11");
  });

  it("hours are total hours and may exceed 24", () => {
    expect(formatCountdown(25 * 3600 * 1000)).toBe("25:00:00");
    expect(formatCountdown(100 * 3600 * 1000 + 1000)).toBe("100:00:01");
  });

  it("floors sub-second remainders and clamps bad input", () => {
    expect(formatCountdown(1999)).toBe("00:00:01");
    expect(formatCountdown(-5000)).toBe("00:00:00");
    expect(formatCountdown(Number.NaN)).toBe("00:00:00");
  });
});
