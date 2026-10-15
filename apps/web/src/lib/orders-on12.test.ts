import { describe, expect, it } from "vitest";
import {
  activityTotal, buildTeamPerformancePath, formatHolds, memberDisplayName, roleLabel,
  type TeamMemberPerformance,
} from "./orders-on12";

const member = (over: Partial<TeamMemberPerformance> = {}): TeamMemberPerformance => ({
  userId: "u-1", name: "Ayesha", email: "ayesha@example.com", role: "SUPPORT_AGENT",
  assignedOpen: 4, statusChanges: 2, holdsPlaced: 3, holdsReleased: 1,
  codCalls: 5, picksDone: 6, commentsPosted: 7, ...over,
});

describe("orders-on12 helpers", () => {
  it("builds the team-performance path with the range as query params", () => {
    expect(buildTeamPerformancePath("org-1", "2026-10-01", "2026-10-07"))
      .toBe("/organizations/org-1/orders/team-performance?from=2026-10-01&to=2026-10-07");
  });

  it("labels roles in Bengali and passes unknown roles through", () => {
    expect(roleLabel("OWNER")).toBe("মালিক");
    expect(roleLabel("SUPPORT_AGENT")).toBe("সাপোর্ট এজেন্ট");
    expect(roleLabel("PACKER")).toBe("PACKER");
  });

  it("memberDisplayName falls back name → email → userId", () => {
    expect(memberDisplayName(member())).toBe("Ayesha");
    expect(memberDisplayName(member({ name: "" }))).toBe("ayesha@example.com");
    expect(memberDisplayName(member({ name: "", email: null }))).toBe("u-1");
  });

  it("formatHolds renders placed / released with signs", () => {
    expect(formatHolds(3, 1)).toBe("+3 / −1");
    expect(formatHolds(0, 0)).toBe("+0 / −0");
  });

  it("activityTotal sums range-bound metrics only (snapshot assignedOpen excluded)", () => {
    expect(activityTotal(member())).toBe(2 + 3 + 1 + 5 + 6 + 7);
    expect(activityTotal(member({ assignedOpen: 99 }))).toBe(24);
  });
});
