import { describe, expect, it } from "vitest";
import {
  TRANSFER_STATUSES, allocationChipLabel, allocationStatusLabel, buildReceiveLines,
  countScopeLabel, groupAllocationsByItem, hasActiveAllocations, parseDistrictInput,
  summarizeAllocations, transferLineVariance, transferStatusCls, transferStatusLabel,
  type OrderAllocation,
} from "./warehouse-ab3";

describe("transfer status labels", () => {
  it("carries exactly the five fixed API statuses in order", () => {
    expect([...TRANSFER_STATUSES]).toEqual([
      "draft", "in_transit", "received", "received_with_variance", "cancelled",
    ]);
  });
  it("labels every status in Bengali", () => {
    for (const s of TRANSFER_STATUSES) {
      expect(transferStatusLabel(s)).not.toBe(s);
      expect(transferStatusCls(s)).not.toBe("");
    }
    expect(transferStatusLabel("draft")).toBe("খসড়া");
    expect(transferStatusLabel("in_transit")).toBe("পথে আছে");
    expect(transferStatusLabel("received_with_variance")).toBe("পার্থক্যসহ গ্রহণ");
    expect(transferStatusLabel(null)).toBe("—");
    expect(transferStatusLabel("mystery")).toBe("mystery");
  });
});

describe("transferLineVariance", () => {
  it("is sent − received once received, floored at 0", () => {
    expect(transferLineVariance({ qtySent: 10, qtyReceived: 7 })).toBe(3);
    expect(transferLineVariance({ qtySent: 10, qtyReceived: 10 })).toBe(0);
    expect(transferLineVariance({ qtySent: 10, qtyReceived: 12 })).toBe(0);
  });
  it("an unreceived line has no variance yet", () => {
    expect(transferLineVariance({ qtySent: 10, qtyReceived: null })).toBe(0);
    expect(transferLineVariance({ qtySent: 10 })).toBe(0);
  });
});

describe("buildReceiveLines", () => {
  const lines = [
    { id: "l1", qtySent: 5 },
    { id: "l2", qtySent: 3 },
    { id: "l3", qtySent: 2 },
  ];
  it("omits blank lines (the API defaults them to qtySent)", () => {
    expect(buildReceiveLines(lines, { l1: "", l2: "2", l3: "" })).toEqual([
      { lineId: "l2", qtyReceived: 2 },
    ]);
    expect(buildReceiveLines(lines, {})).toEqual([]);
  });
  it("keeps explicit zeros and drops invalid values", () => {
    expect(buildReceiveLines(lines, { l1: "0", l2: "-1", l3: "1.5" })).toEqual([
      { lineId: "l1", qtyReceived: 0 },
    ]);
  });
});

describe("parseDistrictInput", () => {
  it("splits on commas, trims and dedupes", () => {
    expect(parseDistrictInput(" Dhaka, Khulna ,Dhaka,, ")).toEqual(["Dhaka", "Khulna"]);
    expect(parseDistrictInput("")).toEqual([]);
  });
});

describe("countScopeLabel", () => {
  it("labels bin vs warehouse scope", () => {
    expect(countScopeLabel("bin")).toBe("বিন অনুযায়ী গণনা");
    expect(countScopeLabel("warehouse")).toBe("গুদাম অনুযায়ী গণনা");
    expect(countScopeLabel(null, "bin-1")).toBe("বিন অনুযায়ী গণনা");
    expect(countScopeLabel(null, null)).toBe("গুদাম অনুযায়ী গণনা");
    expect(countScopeLabel(undefined)).toBe("গুদাম অনুযায়ী গণনা");
  });
});

const alloc = (over: Partial<OrderAllocation>): OrderAllocation => ({
  id: "a1", orderItemId: "item-1", productId: "p1", variantId: null,
  warehouseId: "w1", warehouseName: "Main", binId: "b1", binCode: "A-01",
  qty: 2, status: "active", ...over,
});

describe("allocation grouping / summary", () => {
  it("groups per order item and per component key", () => {
    const groups = groupAllocationsByItem([
      alloc({ id: "a1" }),
      alloc({ id: "a2", binId: "b2", binCode: "A-02", qty: 1 }),
      alloc({ id: "a3", orderItemId: null, productId: "p9" }),
      alloc({ id: "a4", orderItemId: null, productId: "p9", qty: 4 }),
      alloc({ id: "a5", orderItemId: "item-2", status: "settled" }),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[0].orderItemId).toBe("item-1");
    expect(groups[0].totalQty).toBe(3);
    expect(groups[0].hasActive).toBe(true);
    expect(groups[1].orderItemId).toBeNull();
    expect(groups[1].totalQty).toBe(6);
    expect(groups[2].hasActive).toBe(false);
    expect(groupAllocationsByItem(null)).toEqual([]);
  });
  it("hasActiveAllocations reflects any active row", () => {
    expect(hasActiveAllocations([alloc({ status: "settled" })])).toBe(false);
    expect(hasActiveAllocations([alloc({})])).toBe(true);
    expect(hasActiveAllocations([])).toBe(false);
    expect(hasActiveAllocations(undefined)).toBe(false);
  });
  it("summarizes wave allocations into per-bin chips", () => {
    const chips = summarizeAllocations([
      { warehouseName: "Main", binCode: "A-01", qty: 2 },
      { warehouseName: "Main", binCode: "A-01", qty: 3 },
      { warehouseName: "Khulna", binCode: "K-01", qty: 1 },
      { warehouseName: null, binCode: null, qty: 1 },
    ]);
    expect(chips).toEqual([
      { key: "Main::A-01", label: "Main — A-01", qty: 5 },
      { key: "Khulna::K-01", label: "Khulna — K-01", qty: 1 },
      { key: "::", label: "গুদাম অজানা — বিন অজানা", qty: 1 },
    ]);
    expect(summarizeAllocations(undefined)).toEqual([]);
  });
  it("chip + status labels", () => {
    expect(allocationChipLabel({ warehouseName: "Main", binCode: "A-01", qty: 2 })).toBe("Main — A-01 ×2");
    expect(allocationStatusLabel("settled")).toBe("নিষ্পত্তি");
    expect(allocationStatusLabel("active")).toBe("সক্রিয়");
  });
});
