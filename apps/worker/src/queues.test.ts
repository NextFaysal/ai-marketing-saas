import { describe, it, expect } from "vitest";
import { QUEUES } from "./queues";
describe("queues", () => {
  it("queue names are unique", () => {
    const names = Object.values(QUEUES);
    expect(new Set(names).size).toBe(names.length);
  });

  it("WK1: only queues with a real producer + processor remain", () => {
    expect(Object.values(QUEUES).sort()).toEqual(["scheduled-jobs", "scheduled-jobs-dlq", "webhook"]);
    const retired = ["sync-store", "sync-ads", "aggregate-daily", "ai-report", "competitor-scan"];
    for (const name of retired) expect(Object.values(QUEUES)).not.toContain(name);
  });
});
