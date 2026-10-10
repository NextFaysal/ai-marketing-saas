import { describe, it, expect } from "vitest";
import { QUEUES } from "./queues";
describe("queues", () => {
  it("queue names are unique", () => {
    const names = Object.values(QUEUES);
    expect(new Set(names).size).toBe(names.length);
  });
});
