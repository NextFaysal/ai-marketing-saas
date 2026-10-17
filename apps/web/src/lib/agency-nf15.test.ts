import { describe, expect, it } from "vitest";
import {
  AGENCY_COMMISSION_RECORDS_BN,
  AGENCY_SUMMARY_ERROR_BN,
  agencyOrgChoices,
  bdtToMinor,
  clientOrgChoices,
  roleLabelBn,
  sumSummaries,
  totalsBannerLabel,
  type AgencyOrgCard,
} from "./agency-nf15";
import { NAV_ITEMS, COMMERCE_NAV_ITEMS } from "./nav";

// NF15 (FB5) — web helper pins: the totals are labelled as sums
// of the LISTED orgs only, the records-only commission banner
// stays verbatim (byte-identical to the API constant), a failed
// card contributes 0 and is counted, and the nav entry exists
// exactly once.

const card = (id: string, role: string, summary: AgencyOrgCard["summary"]): AgencyOrgCard => ({
  organization: { id, name: `Org ${id}`, slug: `org-${id}` },
  myRole: role,
  summary,
  error: summary ? null : AGENCY_SUMMARY_ERROR_BN,
});

const summary = (over: Partial<NonNullable<AgencyOrgCard["summary"]>> = {}): NonNullable<AgencyOrgCard["summary"]> => ({
  ordersToday: 1, revenueTodayMinor: "1000",
  ordersMonth: 10, revenueMonthMinor: "10000",
  pendingOrders: 2, unreadInbox: 3,
  ...over,
});

describe("agency-nf15 helpers", () => {
  it("commission records-only banner is verbatim and names the OU11 gate", () => {
    expect(AGENCY_COMMISSION_RECORDS_BN).toBe(
      "কমিশন এখানে শুধু রেকর্ড হিসেবে রাখা হয় — কোনো টাকা স্বয়ংক্রিয়ভাবে কাটা বা পাঠানো হয় না। পেআউট OU11 আইনি গেটের অধীনে বন্ধ আছে।",
    );
    expect(AGENCY_COMMISSION_RECORDS_BN).toContain("OU11");
  });

  it("totals banner labels the sum as listed-orgs-only, with the count", () => {
    expect(totalsBannerLabel(3)).toBe("শুধু তালিকাভুক্ত প্রতিষ্ঠানগুলোর মোট (3টি)");
    expect(totalsBannerLabel(0)).toBe("শুধু তালিকাভুক্ত প্রতিষ্ঠানগুলোর মোট (0টি)");
  });

  it("sumSummaries sums listed cards only; a null summary contributes 0 and counts as failed", () => {
    const totals = sumSummaries([
      card("a", "OWNER", summary()),
      card("b", "ADMIN", summary({ ordersToday: 4, revenueTodayMinor: "2500", ordersMonth: 40, revenueMonthMinor: "25000", pendingOrders: 1, unreadInbox: 2 })),
      card("c", "VIEWER", null),
    ]);
    expect(totals).toEqual({
      orgCount: 3,
      ordersToday: 5, revenueTodayMinor: "3500",
      ordersMonth: 50, revenueMonthMinor: "35000",
      pendingOrders: 3, unreadInbox: 5,
      summariesFailed: 1,
    });
    expect(sumSummaries([]).revenueTodayMinor).toBe("0");
  });

  it("role labels are Bengali with the raw role kept; unknown passes through", () => {
    expect(roleLabelBn("OWNER")).toBe("মালিক (OWNER)");
    expect(roleLabelBn("ADMIN")).toBe("অ্যাডমিন (ADMIN)");
    expect(roleLabelBn("SUPPORT_AGENT")).toBe("সাপোর্ট এজেন্ট");
    expect(roleLabelBn("WEIRD")).toBe("WEIRD");
    expect(roleLabelBn(null)).toBe("—");
  });

  it("bdtToMinor parses major units to a positive minor string, refuses junk and zero", () => {
    expect(bdtToMinor("1500")).toBe("150000");
    expect(bdtToMinor("1500.50")).toBe("150050");
    expect(bdtToMinor("1,500")).toBe("150000");
    expect(bdtToMinor("0")).toBeNull();
    expect(bdtToMinor("0.00")).toBeNull();
    expect(bdtToMinor("-5")).toBeNull();
    expect(bdtToMinor("abc")).toBeNull();
    expect(bdtToMinor("")).toBeNull();
  });

  it("commission choices: agency = caller's OWNER/ADMIN orgs; clients = the other membership orgs", () => {
    const orgs = [
      card("a", "OWNER", summary()),
      card("b", "ADMIN", summary()),
      card("c", "VIEWER", summary()),
    ];
    expect(agencyOrgChoices(orgs).map((o) => o.organization.id)).toEqual(["a", "b"]);
    expect(clientOrgChoices(orgs, "a").map((o) => o.organization.id)).toEqual(["b", "c"]);
  });
});

describe("agency nav pin (NF15)", () => {
  it("the agency console nav item exists exactly once and is ready", () => {
    const all = [...NAV_ITEMS, ...COMMERCE_NAV_ITEMS];
    const hits = all.filter((i) => i.href === "/dashboard/agency");
    expect(hits).toHaveLength(1);
    expect(hits[0].ready).toBe(true);
    const hrefs = all.map((i) => i.href as string);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
