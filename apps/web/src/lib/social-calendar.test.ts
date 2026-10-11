import { describe, expect, it } from "vitest";
import { bucketPostsByDay, localInputToUtcIso, monthCells, orgDayKey, utcToLocalInput } from "./social-calendar";

const DHAKA = "Asia/Dhaka";
const NEW_YORK = "America/New_York";

describe("orgDayKey (SP5)", () => {
  it("UTC late evening is already the next day in Dhaka (UTC+6)", () => {
    // 2026-10-11T19:30:00Z = 2026-10-12 01:30 in Dhaka.
    expect(orgDayKey("2026-10-11T19:30:00.000Z", DHAKA)).toBe("2026-10-12");
    expect(orgDayKey("2026-10-11T19:30:00.000Z", "UTC")).toBe("2026-10-11");
  });

  it("just before Dhaka midnight stays on the same Dhaka day", () => {
    // 2026-10-11T17:59:59Z = 2026-10-11 23:59:59 in Dhaka.
    expect(orgDayKey("2026-10-11T17:59:59.000Z", DHAKA)).toBe("2026-10-11");
    // Exactly Dhaka midnight flips the day.
    expect(orgDayKey("2026-10-11T18:00:00.000Z", DHAKA)).toBe("2026-10-12");
  });
});

describe("localInputToUtcIso / utcToLocalInput (SP5)", () => {
  it("Dhaka wall time converts exactly (UTC+6, no DST)", () => {
    expect(localInputToUtcIso("2026-10-12T09:00", DHAKA)).toBe("2026-10-12T03:00:00.000Z");
    expect(localInputToUtcIso("2026-10-12T00:30", DHAKA)).toBe("2026-10-11T18:30:00.000Z");
  });

  it("UTC instants convert back to Dhaka wall time for input prefill", () => {
    expect(utcToLocalInput("2026-10-12T03:00:00.000Z", DHAKA)).toBe("2026-10-12T09:00");
    // The boundary instant: Oct 11 19:30Z is Oct 12 01:30 in Dhaka.
    expect(utcToLocalInput("2026-10-11T19:30:00.000Z", DHAKA)).toBe("2026-10-12T01:30");
  });

  it("New York: standard time and the spring DST boundary", () => {
    // EST (UTC-5) in winter.
    expect(localInputToUtcIso("2026-01-15T09:00", NEW_YORK)).toBe("2026-01-15T14:00:00.000Z");
    // 2026-03-08 is spring-forward day: 09:00 local is already EDT (UTC-4).
    expect(localInputToUtcIso("2026-03-08T09:00", NEW_YORK)).toBe("2026-03-08T13:00:00.000Z");
  });

  it("round-trips wall time → UTC → wall time", () => {
    const samples: Array<[string, string]> = [
      ["2026-10-12T09:00", DHAKA],
      ["2026-01-01T00:00", DHAKA],
      ["2026-12-31T23:59", DHAKA],
      ["2026-01-15T09:00", NEW_YORK],
      ["2026-07-04T18:30", NEW_YORK],
      ["2026-03-08T09:00", NEW_YORK],
      ["2026-06-15T12:00", "UTC"],
    ];
    for (const [value, tz] of samples) {
      expect(utcToLocalInput(localInputToUtcIso(value, tz), tz)).toBe(value);
    }
  });
});

describe("monthCells (SP5)", () => {
  it("October 2026: Sunday-start grid beginning 2026-09-27", () => {
    const cells = monthCells(2026, 10);
    // Oct 1 2026 is a Thursday, so the Sunday-start grid opens on Sep 27.
    expect(cells[0]).toEqual({ key: "2026-09-27", day: 27, inMonth: false });
    expect(cells).toHaveLength(42);
    expect(cells.length % 7).toBe(0);
    const oct1 = cells.find((c) => c.key === "2026-10-01");
    expect(oct1).toEqual({ key: "2026-10-01", day: 1, inMonth: true });
    // All 31 October days are present and flagged inMonth.
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
    // The fixed 6-week grid runs into November at the tail.
    const last = cells[cells.length - 1];
    expect(last.key.startsWith("2026-11-")).toBe(true);
    expect(last.inMonth).toBe(false);
  });

  it("keys are consecutive calendar days with no gaps or repeats", () => {
    const cells = monthCells(2026, 2);
    expect(new Set(cells.map((c) => c.key)).size).toBe(cells.length);
    for (let i = 1; i < cells.length; i += 1) {
      const prev = new Date(`${cells[i - 1].key}T00:00:00.000Z`).getTime();
      const curr = new Date(`${cells[i].key}T00:00:00.000Z`).getTime();
      expect(curr - prev).toBe(86_400_000);
    }
    // Feb 2026 has 28 days.
    expect(cells.filter((c) => c.inMonth)).toHaveLength(28);
  });
});

describe("bucketPostsByDay (SP5)", () => {
  interface P {
    id: string;
    status: string;
    scheduledAt?: string | null;
    publishedAt?: string | null;
  }

  it("groups posts from different UTC days onto the same Dhaka day", () => {
    const posts: P[] = [
      // Oct 11 19:30Z = Oct 12 01:30 Dhaka.
      { id: "a", status: "scheduled", scheduledAt: "2026-10-11T19:30:00.000Z" },
      // Oct 12 10:00Z = Oct 12 16:00 Dhaka.
      { id: "b", status: "scheduled", scheduledAt: "2026-10-12T10:00:00.000Z" },
      // Oct 13 05:00Z = Oct 13 11:00 Dhaka — a different Dhaka day.
      { id: "c", status: "scheduled", scheduledAt: "2026-10-13T05:00:00.000Z" },
    ];
    const buckets = bucketPostsByDay(posts, DHAKA);
    expect(buckets.get("2026-10-12")?.map((p) => p.id)).toEqual(["a", "b"]);
    expect(buckets.get("2026-10-13")?.map((p) => p.id)).toEqual(["c"]);
    expect(buckets.has("2026-10-11")).toBe(false);
  });

  it("falls back to publishedAt, prefers scheduledAt, and skips posts with neither", () => {
    const posts: P[] = [
      { id: "pub", status: "published", scheduledAt: null, publishedAt: "2026-10-11T19:30:00.000Z" },
      { id: "both", status: "published", scheduledAt: "2026-10-13T05:00:00.000Z", publishedAt: "2026-10-11T19:30:00.000Z" },
      { id: "draft", status: "draft", scheduledAt: null, publishedAt: null },
    ];
    const buckets = bucketPostsByDay(posts, DHAKA);
    expect(buckets.get("2026-10-12")?.map((p) => p.id)).toEqual(["pub"]);
    expect(buckets.get("2026-10-13")?.map((p) => p.id)).toEqual(["both"]);
    expect([...buckets.values()].flat()).toHaveLength(2);
  });

  it("empty input → empty map", () => {
    expect(bucketPostsByDay([], DHAKA).size).toBe(0);
  });
});
