import { describe, expect, it } from "vitest";
import {
  PAYROLL_RECORD_NOTE,
  attendanceSourceLabel,
  leavePaidLabel,
  leaveStatusLabel,
  minutesLabel,
  parseTimeToMinutes,
  runStatusLabel,
  weekdayLabel,
} from "./hr-nf11";

describe("NF11 HR web helpers", () => {
  it("the payroll record note is byte-identical to the API's verbatim note", () => {
    expect(PAYROLL_RECORD_NOTE).toBe("এই রানটি পরিশোধের একটি রেকর্ড মাত্র — এর মাধ্যমে সরাসরি কোনো অর্থ স্থানান্তর হয় না। (This is a record of payment only — no money is transferred by it.)");
    expect(PAYROLL_RECORD_NOTE).toContain("no money is transferred");
  });

  it("weekday + minutes labels follow the NF4 convention (0 = Sunday, minutes from midnight)", () => {
    expect(weekdayLabel(0)).toBe("রবিবার");
    expect(weekdayLabel(6)).toBe("শনিবার");
    expect(weekdayLabel(9)).toBe("—");
    expect(minutesLabel(540)).toBe("09:00");
    expect(minutesLabel(1020)).toBe("17:00");
    expect(minutesLabel(1440)).toBe("24:00");
    expect(parseTimeToMinutes("09:30")).toBe(570);
    expect(parseTimeToMinutes("24:00")).toBe(1440);
    expect(parseTimeToMinutes("25:00")).toBeNull();
    expect(parseTimeToMinutes("abc")).toBeNull();
  });

  it("leave / run / attendance labels are human Bengali, unknown passes through", () => {
    expect(leaveStatusLabel("pending")).toBe("অপেক্ষমাণ");
    expect(leaveStatusLabel("approved")).toBe("অনুমোদিত");
    expect(leavePaidLabel("unpaid")).toBe("বেতনবিহীন ছুটি");
    expect(runStatusLabel("draft")).toContain("খসড়া");
    expect(runStatusLabel("paid")).toContain("Paid");
    expect(attendanceSourceLabel("staff_correction")).toContain("Correction");
    expect(leaveStatusLabel("weird")).toBe("weird");
    expect(leaveStatusLabel(null)).toBe("—");
  });
});
