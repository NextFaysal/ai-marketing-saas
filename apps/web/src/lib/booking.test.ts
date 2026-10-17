import { describe, expect, it } from "vitest";
import {
  apiRowsToEditor, availabilityError, bookingActions, bookingStatusChip,
  dayRangeUtcIso, depositStateLabel, editorRowsToApi, groupBookingsByStaff, minutesToTime,
  slotTimeLabel, timeToMinutes, weekdayLabel, ymdInZone,
  type ServiceBookingView,
} from "./booking";

describe("bookingStatusChip / depositStateLabel", () => {
  it("maps all five statuses to Bengali labels", () => {
    expect(bookingStatusChip("pending").label).toBe("অপেক্ষমাণ");
    expect(bookingStatusChip("confirmed").label).toBe("নিশ্চিত");
    expect(bookingStatusChip("cancelled").label).toBe("বাতিল");
    expect(bookingStatusChip("completed").label).toBe("সম্পন্ন");
    expect(bookingStatusChip("no_show").label).toBe("আসেননি");
    expect(bookingStatusChip("weird").label).toBe("weird");
  });

  it("deposit states are labelled manual where manual", () => {
    expect(depositStateLabel("not_required")).toBe("ডিপোজিট প্রয়োজন নেই");
    expect(depositStateLabel("unpaid_manual")).toContain("ম্যানুয়াল");
    expect(depositStateLabel("paid_manual")).toContain("ম্যানুয়াল");
  });
});

describe("time helpers", () => {
  it("minutesToTime / timeToMinutes round-trip and reject junk", () => {
    expect(minutesToTime(600)).toBe("10:00");
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(1440)).toBe("24:00");
    expect(timeToMinutes("10:30")).toBe(630);
    expect(timeToMinutes("24:00")).toBe(1440);
    expect(timeToMinutes("25:00")).toBeNull();
    expect(timeToMinutes("10:99")).toBeNull();
    expect(timeToMinutes("abc")).toBeNull();
  });

  it("slotTimeLabel renders the instant in the org zone", () => {
    // 04:00Z = 10:00 in Asia/Dhaka (UTC+6).
    expect(slotTimeLabel("2026-10-19T04:00:00.000Z")).toBe("10:00");
    expect(slotTimeLabel("2026-10-19T04:00:00.000Z", "UTC")).toBe("04:00");
  });

  it("ymdInZone returns the zone's calendar date", () => {
    // 20:00Z on the 18th is already the 19th in Dhaka.
    expect(ymdInZone("Asia/Dhaka", 0, new Date("2026-10-18T20:00:00.000Z"))).toBe("2026-10-19");
    expect(ymdInZone("UTC", 0, new Date("2026-10-18T20:00:00.000Z"))).toBe("2026-10-18");
  });

  it("dayRangeUtcIso spans the Dhaka day in UTC", () => {
    expect(dayRangeUtcIso("2026-10-19")).toEqual({
      from: "2026-10-18T18:00:00.000Z",
      to: "2026-10-19T17:59:59.999Z",
    });
    expect(dayRangeUtcIso("2026-10-19", "UTC").from).toBe("2026-10-19T00:00:00.000Z");
  });

  it("weekdayLabel follows the JS convention (0 = Sunday)", () => {
    expect(weekdayLabel(0)).toBe("রবিবার");
    expect(weekdayLabel(1)).toBe("সোমবার");
    expect(weekdayLabel(6)).toBe("শনিবার");
  });
});

describe("availability editor conversion + validation", () => {
  it("editorRowsToApi keeps only enabled, parseable rows", () => {
    const rows = editorRowsToApi([
      { weekday: 6, enabled: true, start: "10:00", end: "18:00" },
      { weekday: 0, enabled: false, start: "10:00", end: "18:00" },
      { weekday: 1, enabled: true, start: "bad", end: "18:00" },
    ]);
    expect(rows).toEqual([{ weekday: 6, startMinute: 600, endMinute: 1080 }]);
  });

  it("apiRowsToEditor marks days with windows and counts extra windows", () => {
    const editor = apiRowsToEditor([
      { weekday: 1, startMinute: 600, endMinute: 720 },
      { weekday: 1, startMinute: 840, endMinute: 1080 },
    ]);
    const monday = editor.find((e) => e.weekday === 1)!;
    expect(monday.enabled).toBe(true);
    expect(monday.start).toBe("10:00");
    expect(monday.end).toBe("12:00");
    expect(monday.extraWindows).toBe(1);
    expect(editor.find((e) => e.weekday === 3)!.enabled).toBe(false);
  });

  it("availabilityError catches inverted and overlapping rows", () => {
    expect(availabilityError([{ weekday: 1, startMinute: 700, endMinute: 600 }])).not.toBeNull();
    expect(availabilityError([
      { weekday: 1, startMinute: 600, endMinute: 720 },
      { weekday: 1, startMinute: 700, endMinute: 800 },
    ])).not.toBeNull();
    expect(availabilityError([
      { weekday: 1, startMinute: 600, endMinute: 720 },
      { weekday: 1, startMinute: 720, endMinute: 840 },
      { weekday: 2, startMinute: 600, endMinute: 720 },
    ])).toBeNull();
  });
});

describe("groupBookingsByStaff + bookingActions", () => {
  const mk = (id: string, staffId: string, staffName: string, startAt: string, status = "pending"): ServiceBookingView => ({
    id, organizationId: "org-1", serviceId: "svc", staffId, customerId: null,
    guestName: "অতিথি", guestPhone: "01710000001", startAt, endAt: startAt,
    status, statusLabel: "", source: "storefront", depositRequiredMinor: "0",
    depositState: "not_required", depositLabel: "", reminderSentAt: null,
    reminderStatus: null, note: null, staffName,
  });

  it("groups by staff, time-ordered inside each group", () => {
    const groups = groupBookingsByStaff([
      mk("b2", "s1", "রাবেয়া", "2026-10-19T06:00:00.000Z"),
      mk("b1", "s1", "রাবেয়া", "2026-10-19T04:00:00.000Z"),
      mk("b3", "s2", "করিম", "2026-10-19T05:00:00.000Z"),
    ]);
    expect(groups).toHaveLength(2);
    const g1 = groups.find((g) => g.staffId === "s1")!;
    expect(g1.staffName).toBe("রাবেয়া");
    expect(g1.bookings.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("actions mirror the server transition table", () => {
    expect(bookingActions("pending").map((a) => a.key)).toEqual(["confirm", "cancel"]);
    expect(bookingActions("confirmed").map((a) => a.key)).toEqual(["complete", "no-show", "cancel"]);
    expect(bookingActions("cancelled")).toEqual([]);
    expect(bookingActions("completed")).toEqual([]);
    expect(bookingActions("no_show")).toEqual([]);
  });
});
