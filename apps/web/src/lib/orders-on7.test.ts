import { describe, expect, it } from "vitest";
import {
  agingRows, codBoardRows, coverageLabel, deliveryCoverageCaption, isOverLimit,
  marginTone, overpaidMinorOf, type CodBoard, type CustomerKhata,
} from "./orders-on7";

describe("marginTone", () => {
  it("positive / negative by sign", () => {
    expect(marginTone("15000")).toBe("positive");
    expect(marginTone("-2500")).toBe("negative");
    expect(marginTone("0")).toBe("positive");
  });
  it("null / unparseable margin is unknown — never dressed up as positive", () => {
    expect(marginTone(null)).toBe("unknown");
    expect(marginTone(undefined)).toBe("unknown");
    expect(marginTone("abc")).toBe("unknown");
  });
});

describe("overpaidMinorOf", () => {
  it("returns the excess when advance exceeds total", () => {
    expect(overpaidMinorOf("300000", "250000")).toBe("50000");
  });
  it("null when paid ≤ total or fields missing", () => {
    expect(overpaidMinorOf("250000", "250000")).toBeNull();
    expect(overpaidMinorOf("100", "250000")).toBeNull();
    expect(overpaidMinorOf(null, "250000")).toBeNull();
    expect(overpaidMinorOf("300000", undefined)).toBeNull();
  });
});

describe("agingRows", () => {
  const khata: CustomerKhata = {
    customerId: "c1", orders: [], ordersTruncated: false, totalDueMinor: "46000",
    aging: { d0_7: "10000", d8_15: "20000", d16_30: "5000", d30plus: "11000" },
    creditLimitMinor: null, overLimit: false, availableCreditMinor: null,
  };
  it("renders the four buckets in order with Bengali labels", () => {
    const rows = agingRows(khata);
    expect(rows.map((r) => r.label)).toEqual(["০–৭ দিন", "৮–১৫ দিন", "১৬–৩০ দিন", "৩০ দিনের বেশি"]);
    expect(rows.map((r) => r.amountMinor)).toEqual(["10000", "20000", "5000", "11000"]);
    expect(rows.map((r) => r.key)).toEqual(["d0_7", "d8_15", "d16_30", "d30plus"]);
  });
});

describe("isOverLimit — negative available credit", () => {
  it("the server flag wins, and a negative available credit also warns", () => {
    expect(isOverLimit({ overLimit: true, availableCreditMinor: "5000" })).toBe(true);
    expect(isOverLimit({ overLimit: false, availableCreditMinor: "-12000" })).toBe(true);
    expect(isOverLimit({ overLimit: false, availableCreditMinor: "0" })).toBe(false);
    expect(isOverLimit({ overLimit: false, availableCreditMinor: null })).toBe(false);
  });
});

describe("codBoardRows", () => {
  const board: CodBoard = {
    providers: [
      { provider: "steadfast", inTransitCodMinor: "100000", deliveredUncollectedMinor: "50000", collectedLast7dMinor: "80000", outstandingMinor: "150000" },
      { provider: "pathao", inTransitCodMinor: "20000", deliveredUncollectedMinor: "0", collectedLast7dMinor: "10000", outstandingMinor: "20000" },
    ],
    unassigned: { orders: 3, dueMinor: "45000" },
    totals: { inTransitCodMinor: "120000", deliveredUncollectedMinor: "50000", collectedLast7dMinor: "90000", outstandingMinor: "215000" },
  };
  it("providers, then the unassigned row, then totals", () => {
    const rows = codBoardRows(board);
    expect(rows.map((r) => r.kind)).toEqual(["provider", "provider", "unassigned", "total"]);
    const un = rows.find((r) => r.kind === "unassigned")!;
    expect(un.provider).toBe("এখনো courier-এ যায়নি");
    expect(un.unassignedOrders).toBe(3);
    expect(un.outstandingMinor).toBe("45000");
    const total = rows[rows.length - 1];
    expect(total.provider).toBe("মোট");
    expect(total.outstandingMinor).toBe("215000");
  });
  it("no unassigned row when every due order has gone to a courier", () => {
    const rows = codBoardRows({ ...board, unassigned: { orders: 0, dueMinor: "0" } });
    expect(rows.map((r) => r.kind)).toEqual(["provider", "provider", "total"]);
  });
});

describe("coverageLabel", () => {
  it("states the covered share of line revenue", () => {
    expect(coverageLabel(80)).toBe("মোট লাইন-আয়ের 80% অংশের খরচ জানা আছে");
    expect(coverageLabel(62.5)).toBe("মোট লাইন-আয়ের 62.5% অংশের খরচ জানা আছে");
  });
  it("null percent says there is nothing costed — not a fake 0%", () => {
    expect(coverageLabel(null)).toContain("কোনো লাইন-আয় নেই");
    expect(coverageLabel(undefined)).toContain("কোনো লাইন-আয় নেই");
  });
});

describe("deliveryCoverageCaption", () => {
  it("captions partial coverage, stays silent on full / none", () => {
    expect(deliveryCoverageCaption({ shipments: 2, withCharge: 1 })).toBe("shipment 1/2-তে courier চার্জ পাওয়া গেছে");
    expect(deliveryCoverageCaption({ shipments: 2, withCharge: 2 })).toBeNull();
    expect(deliveryCoverageCaption({ shipments: 0, withCharge: 0 })).toBeNull();
    expect(deliveryCoverageCaption(null)).toBeNull();
  });
});
