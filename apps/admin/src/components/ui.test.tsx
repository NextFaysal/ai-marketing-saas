import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Chart,
  DataTable,
  dismissToast,
  loadLastFilters,
  loadSavedViews,
  storeLastFilters,
  storeSavedViews,
  type SavedView,
  toast,
  ToastHost,
} from "./ui";

// ---------------------------------------------------------------------------
// Hermetic localStorage stub (node environment — no jsdom in this app,
// following the web app's renderToStaticMarkup test pattern). SavedViews
// and last-filters read/write through the global `localStorage`, so a
// plain in-memory implementation is a faithful stand-in.
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

beforeEach(() => { storage.clear(); });

describe("SavedViews — load/save round-trip + corrupt storage (ADNX17)", () => {
  it("round-trips views through storage unchanged", () => {
    const views: SavedView[] = [
      { name: "সক্রিয় Org", state: { q: "ঢাকা", status: "ACTIVE" } },
      { name: "ঝুঁকিপূর্ণ", state: { risk: "high" } },
    ];
    storeSavedViews("orgs", views);
    expect(loadSavedViews("orgs")).toEqual(views);
    // A different page key is independent.
    expect(loadSavedViews("users")).toEqual([]);
  });

  it("degrades corrupt / non-array / malformed entries to safe results", () => {
    storage.setItem("admin_saved_views_orgs", "{not json");
    expect(loadSavedViews("orgs")).toEqual([]);
    storage.setItem("admin_saved_views_orgs", JSON.stringify({ name: "x" }));
    expect(loadSavedViews("orgs")).toEqual([]);
    // Malformed entries are dropped; valid ones survive, and
    // non-string state values are filtered out (the loader's
    // documented contract).
    storage.setItem("admin_saved_views_orgs", JSON.stringify([
      null,
      { name: 42, state: {} },
      { name: "ঠিক আছে", state: { a: "1", b: 2, c: null } },
    ]));
    expect(loadSavedViews("orgs")).toEqual([{ name: "ঠিক আছে", state: { a: "1" } }]);
  });

  it("last-filters round-trip + corrupt storage", () => {
    storeLastFilters("tickets", { status: "open", q: "" });
    expect(loadLastFilters("tickets")).toEqual({ status: "open", q: "" });
    storage.setItem("admin_last_filters_tickets", "[1,2]");
    expect(loadLastFilters("tickets")).toBeNull();
    storage.setItem("admin_last_filters_tickets", "broken{");
    expect(loadLastFilters("tickets")).toBeNull();
  });
});

describe("Toast store — push / dismiss (ADNX17)", () => {
  it("pushed toasts render in the host; dismiss removes exactly its own", () => {
    vi.useFakeTimers();
    try {
      const a = toast("সংরক্ষণ হয়েছে।", "success");
      const b = toast("ব্যর্থ হয়েছে।", "error");
      let html = renderToStaticMarkup(<ToastHost />);
      expect(html).toContain("সংরক্ষণ হয়েছে।");
      expect(html).toContain("ব্যর্থ হয়েছে।");
      expect(html).toContain("atoast-success");
      expect(html).toContain("atoast-error");
      dismissToast(a);
      html = renderToStaticMarkup(<ToastHost />);
      expect(html).not.toContain("সংরক্ষণ হয়েছে।");
      expect(html).toContain("ব্যর্থ হয়েছে।");
      dismissToast(b);
      // Host renders nothing at all when the store is empty.
      expect(renderToStaticMarkup(<ToastHost />)).toBe("");
      // Dismissing an unknown id is a no-op, never an error.
      dismissToast(999999);
      expect(renderToStaticMarkup(<ToastHost />)).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DataTable — card-mode data-label rendering (ADNX17)", () => {
  const table = (cards: boolean) => renderToStaticMarkup(
    <DataTable cards={cards}>
      <thead><tr><th className="ath">নাম</th><th className="ath">অবস্থা</th></tr></thead>
      <tbody>
        <tr>
          <td data-label="নাম" className="atd">করিম ট্রেডার্স</td>
          <td data-label="অবস্থা" className="atd">ACTIVE</td>
        </tr>
      </tbody>
    </DataTable>,
  );

  it("card mode carries the card classes + every cell's data-label", () => {
    const html = table(true);
    expect(html).toContain("atable-cards");
    expect(html).toContain("atable-wrap");
    expect(html).toContain('data-label="নাম"');
    expect(html).toContain('data-label="অবস্থা"');
    expect(html).toContain("করিম ট্রেডার্স");
  });

  it("cards={false} drops the card class but keeps the wrap + labels", () => {
    const html = table(false);
    expect(html).not.toContain("atable-cards");
    expect(html).toContain("atable-wrap");
    expect(html).toContain('data-label="নাম"');
  });
});

describe("Chart — data-table fallback renders the same numbers (ADNX17)", () => {
  const points = [
    { label: "জানু", value: 1200 },
    { label: "ফেব্রু", value: 3400 },
    { label: "মার্চ", value: 0 },
  ];
  const fmt = (v: number) => `৳${v}`;

  it("chart readout shows the last point's exact formatted value", () => {
    const html = renderToStaticMarkup(<Chart points={points} formatValue={fmt} seriesLabel="আয়" />);
    expect(html).toContain("মার্চ: ৳0");
    expect(html).toContain("ডেটা টেবিল দেখুন");
    expect(html).toContain('role="img"');
  });

  it("fallback table lists every point with the same formatting", () => {
    const html = renderToStaticMarkup(<Chart points={points} formatValue={fmt} seriesLabel="আয়" defaultShowTable />);
    for (const p of points) {
      expect(html).toContain(p.label);
      expect(html).toContain(fmt(p.value));
    }
    expect(html).toContain('data-label="আয়"');
    expect(html).toContain('data-label="মান"');
  });

  it("empty points render the empty state, never a blank chart", () => {
    const html = renderToStaticMarkup(<Chart points={[]} formatValue={fmt} seriesLabel="আয়" />);
    expect(html).toContain("চার্টের কোনো ডেটা নেই।");
  });
});
