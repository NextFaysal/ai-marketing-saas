import { describe, expect, it } from "vitest";
import {
  EMPTY_ORDER_FILTERS, buildOrderListParams, feedAdvance, filtersToViewPayload,
  minorToTaka, takaToMinor, viewToFilters, type FeedItem,
} from "./orders-on1";

describe("takaToMinor / minorToTaka", () => {
  it("converts exact taka strings to minor strings", () => {
    expect(takaToMinor("200")).toBe("20000");
    expect(takaToMinor("200.5")).toBe("20050");
    expect(takaToMinor("200.50")).toBe("20050");
    expect(takaToMinor("0.05")).toBe("5");
  });
  it("rejects malformed amounts instead of mangling them", () => {
    expect(takaToMinor("")).toBeNull();
    expect(takaToMinor("abc")).toBeNull();
    expect(takaToMinor("10.999")).toBeNull();
    expect(takaToMinor("-5")).toBeNull();
  });
  it("minorToTaka round-trips", () => {
    expect(minorToTaka("20050")).toBe("200.50");
    expect(minorToTaka("20000")).toBe("200");
    expect(minorToTaka("bogus")).toBe("");
  });
});

describe("buildOrderListParams", () => {
  it("queue wins over the legacy status param (alternatives)", () => {
    const p = buildOrderListParams({ ...EMPTY_ORDER_FILTERS, queue: "ready_to_pack", status: "pending" });
    expect(p.get("queue")).toBe("ready_to_pack");
    expect(p.get("status")).toBeNull();
  });
  it("sends legacy params when no queue is selected", () => {
    const p = buildOrderListParams({ ...EMPTY_ORDER_FILTERS, status: "pending", codOnly: true, practice: true });
    expect(p.get("status")).toBe("pending");
    expect(p.get("cod")).toBe("true");
    expect(p.get("practice")).toBe("1");
  });
  it("converts taka range inputs to minor strings and skips invalid ones", () => {
    const p = buildOrderListParams({ ...EMPTY_ORDER_FILTERS, minTotalTaka: "100", maxTotalTaka: "abc" });
    expect(p.get("minTotal")).toBe("10000");
    expect(p.get("maxTotal")).toBeNull();
  });
  it("omits the default sort and empty filters", () => {
    const p = buildOrderListParams(EMPTY_ORDER_FILTERS);
    expect([...p.keys()]).toEqual(["pageSize"]);
  });
  it("sends the ON4 riskBand filter only when set", () => {
    expect(buildOrderListParams(EMPTY_ORDER_FILTERS).get("riskBand")).toBeNull();
    const p = buildOrderListParams({ ...EMPTY_ORDER_FILTERS, riskBand: "high" });
    expect(p.get("riskBand")).toBe("high");
  });
});

describe("saved-view round-trip", () => {
  it("filters -> view payload -> filters preserves the state", () => {
    const f = {
      ...EMPTY_ORDER_FILTERS, queue: "due_collection", search: "রহিম",
      minTotalTaka: "250.50", tag: "vip", sort: "total_desc", codOnly: true,
    };
    const payload = filtersToViewPayload(f);
    expect(payload.queue).toBe("due_collection");
    expect(payload.filters.minTotal).toBe("25050");
    const back = viewToFilters({ id: "v1", name: "x", queue: payload.queue, filters: payload.filters });
    expect(back).toEqual(f);
  });
  it("persists COD as isCod and never emits server-rejected keys (cod / practice)", () => {
    const payload = filtersToViewPayload({ ...EMPTY_ORDER_FILTERS, codOnly: true, practice: true });
    expect(payload.filters.isCod).toBe(true);
    expect(payload.filters).not.toHaveProperty("cod");
    expect(payload.filters).not.toHaveProperty("practice");
    // A legacy view written with `cod` still restores.
    expect(viewToFilters({ id: "v0", name: "old", filters: { cod: true } }).codOnly).toBe(true);
  });
  it("unknown / missing view keys fall back to defaults", () => {
    const back = viewToFilters({ id: "v1", name: "x", filters: { nope: "1" } as never });
    expect(back).toEqual(EMPTY_ORDER_FILTERS);
  });
  it("round-trips the ON4 riskBand filter through a saved view", () => {
    const f = { ...EMPTY_ORDER_FILTERS, riskBand: "medium" };
    const payload = filtersToViewPayload(f);
    expect(payload.filters.riskBand).toBe("medium");
    const back = viewToFilters({ id: "v1", name: "x", queue: payload.queue, filters: payload.filters });
    expect(back).toEqual(f);
    // An empty band is not persisted and restores as "".
    expect(filtersToViewPayload(EMPTY_ORDER_FILTERS).filters).not.toHaveProperty("riskBand");
  });
});

describe("feedAdvance", () => {
  const item = (patch: Partial<FeedItem>): FeedItem => ({
    id: "o1", status: "pending", isCod: true, totalMinor: "100",
    createdAt: "2026-10-14T10:00:00.000Z", updatedAt: "2026-10-14T10:00:00.000Z",
    changeKind: "created", ...patch,
  });
  it("counts only creations newer than the initial load", () => {
    const out = feedAdvance(
      [item({}), item({ id: "o2", createdAt: "2026-10-14T09:00:00.000Z" })],
      "2026-10-14T09:30:00.000Z", "2026-10-14T09:30:00.000Z",
    );
    expect(out.newCreated).toBe(1);
    expect(out.nextWatermark).toBe("2026-10-14T10:00:00.000Z");
  });
  it("updates advance the watermark but never raise the pill", () => {
    const out = feedAdvance(
      [item({ changeKind: "updated", updatedAt: "2026-10-14T11:00:00.000Z" })],
      "2026-10-14T09:30:00.000Z", "2026-10-14T09:30:00.000Z",
    );
    expect(out.newCreated).toBe(0);
    expect(out.nextWatermark).toBe("2026-10-14T11:00:00.000Z");
  });
});
