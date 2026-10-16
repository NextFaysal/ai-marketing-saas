import { describe, expect, it } from "vitest";
import { asList } from "./as-list";

describe("asList", () => {
  it("passes a bare array through untouched", () => {
    const a = [{ id: "1" }, { id: "2" }];
    expect(asList(a)).toBe(a);
  });

  it("unwraps a paginated envelope to its items", () => {
    const items = [{ id: "p1", name: "Saree" }];
    expect(asList({ total: 1, page: 1, pageSize: 20, items })).toBe(items);
  });

  it("returns an empty list for null, undefined and non-list shapes", () => {
    expect(asList(null)).toEqual([]);
    expect(asList(undefined)).toEqual([]);
    expect(asList({ message: "error" })).toEqual([]);
    expect(asList({ items: "nope" })).toEqual([]);
  });
});
