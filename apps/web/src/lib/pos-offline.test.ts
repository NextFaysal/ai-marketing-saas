import { describe, expect, it } from "vitest";
import {
  clearSynced, enqueue, generateLocalReceiptNo, loadQueue, outboxKey, removeEntry,
  type PosOfflineEntry, type StorageLike,
} from "./pos-offline";

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

const entry = (key: string, total = "50000"): PosOfflineEntry => ({
  idempotencyKey: key,
  localReceiptNo: `OFF-x-${key}`,
  localTotalMinor: total,
  sale: { items: [{ productId: "p1", quantity: 1 }], payment: { mode: "paid", method: "cash" } },
  queuedAt: "2026-10-16T00:00:00.000Z",
});

describe("pos-offline outbox", () => {
  it("uses the versioned per-org storage key", () => {
    expect(outboxKey("org-1")).toBe("qosprey.posOutbox.v1.org-1");
  });

  it("enqueue → load round-trips, per org", () => {
    const s = fakeStorage();
    enqueue("org-1", entry("k1"), s);
    enqueue("org-1", entry("k2", "90000"), s);
    enqueue("org-2", entry("k9"), s);
    const q = loadQueue("org-1", s);
    expect(q.map((e) => e.idempotencyKey)).toEqual(["k1", "k2"]);
    expect(q[1].localTotalMinor).toBe("90000");
    expect(loadQueue("org-2", s)).toHaveLength(1);
    expect(loadQueue("org-3", s)).toEqual([]);
  });

  it("re-enqueueing the same key replaces instead of duplicating", () => {
    const s = fakeStorage();
    enqueue("org-1", entry("k1", "100"), s);
    const q = enqueue("org-1", entry("k1", "200"), s);
    expect(q).toHaveLength(1);
    expect(q[0].localTotalMinor).toBe("200");
  });

  it("removeEntry drops just that entry; empty queue removes the key", () => {
    const s = fakeStorage();
    enqueue("org-1", entry("k1"), s);
    enqueue("org-1", entry("k2"), s);
    expect(removeEntry("org-1", "k1", s).map((e) => e.idempotencyKey)).toEqual(["k2"]);
    expect(removeEntry("org-1", "k2", s)).toEqual([]);
    expect(s.map.has(outboxKey("org-1"))).toBe(false);
  });

  it("clearSynced removes only the named keys, or everything when none are named", () => {
    const s = fakeStorage();
    enqueue("org-1", entry("k1"), s);
    enqueue("org-1", entry("k2"), s);
    enqueue("org-1", entry("k3"), s);
    expect(clearSynced("org-1", ["k1", "k3"], s).map((e) => e.idempotencyKey)).toEqual(["k2"]);
    expect(clearSynced("org-1", undefined, s)).toEqual([]);
    expect(loadQueue("org-1", s)).toEqual([]);
  });

  it("corrupt or malformed storage degrades to an empty queue", () => {
    const s = fakeStorage({ [outboxKey("org-1")]: "{not json" });
    expect(loadQueue("org-1", s)).toEqual([]);
    const s2 = fakeStorage({ [outboxKey("org-1")]: JSON.stringify({ nope: true }) });
    expect(loadQueue("org-1", s2)).toEqual([]);
    const s3 = fakeStorage({
      [outboxKey("org-1")]: JSON.stringify([{ bad: 1 }, entry("good")]),
    });
    expect(loadQueue("org-1", s3).map((e) => e.idempotencyKey)).toEqual(["good"]);
  });

  it("null storage is a safe no-op", () => {
    expect(loadQueue("org-1", null)).toEqual([]);
    // enqueue still returns the in-memory queue; nothing persists.
    const q = enqueue("org-1", entry("k1"), null);
    expect(q.map((e) => e.idempotencyKey)).toEqual(["k1"]);
    expect(loadQueue("org-1", null)).toEqual([]);
    expect(removeEntry("org-1", "k1", null)).toEqual([]);
  });

  it("receipt numbers follow OFF-{base36 timestamp}-{seq}", () => {
    const ts = 1760000000000;
    expect(generateLocalReceiptNo(ts, 7)).toBe(`OFF-${ts.toString(36)}-7`);
    const a = generateLocalReceiptNo(ts);
    const b = generateLocalReceiptNo(ts);
    expect(a).toMatch(/^OFF-[0-9a-z]+-\d+$/);
    expect(a).not.toBe(b); // the internal sequence advances
  });
});
