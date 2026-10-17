// EB5/ED12 — commerce navigation structure pins.
// The hub page (/dashboard/commerce) links these destinations; every
// one of them must be reachable from the sidebar nav data, and every
// commerce nav item must sit in exactly one task-grouped section.
import { describe, expect, it } from "vitest";
import { COMMERCE_NAV_ITEMS, COMMERCE_NAV_SECTIONS, NAV_ITEMS } from "./nav";

// The exact href set the commerce hub page linked to before EB5
// (grep of app/dashboard/commerce/page.tsx at base 3d4c4c7d).
const HUB_HREFS = [
  "/dashboard/commerce/abandoned",
  "/dashboard/commerce/accounting",
  "/dashboard/commerce/affiliates",
  "/dashboard/commerce/bundles",
  "/dashboard/commerce/discounts",
  "/dashboard/commerce/feeds",
  "/dashboard/commerce/finance",
  "/dashboard/commerce/gift-cards",
  "/dashboard/commerce/installments",
  "/dashboard/commerce/inventory-intelligence",
  "/dashboard/commerce/landings",
  "/dashboard/commerce/loyalty",
  "/dashboard/commerce/promotions",
  "/dashboard/commerce/purchasing",
  "/dashboard/commerce/questions",
  "/dashboard/commerce/quotes",
  "/dashboard/commerce/reconciliation",
  "/dashboard/commerce/reports",
  "/dashboard/commerce/reviews",
  "/dashboard/commerce/storefront",
  "/dashboard/commerce/subscriptions",
  "/dashboard/commerce/sync",
  "/dashboard/commerce/warehouse",
  "/dashboard/orders",
  "/dashboard/products",
];

const ALL_ITEMS = [...NAV_ITEMS, ...COMMERCE_NAV_ITEMS];
const SECTION_HREFS = COMMERCE_NAV_SECTIONS.flatMap((s) => [...s.hrefs]);

describe("commerce nav (ED12)", () => {
  it("every hub destination is in a nav section", () => {
    for (const href of HUB_HREFS) {
      expect(SECTION_HREFS, href).toContain(href);
    }
  });

  it("every section href resolves to exactly one nav item", () => {
    for (const href of SECTION_HREFS) {
      expect(ALL_ITEMS.filter((i) => i.href === href), href).toHaveLength(1);
    }
  });

  it("no href appears in two sections", () => {
    expect(new Set(SECTION_HREFS).size).toBe(SECTION_HREFS.length);
  });

  it("every commerce nav item is placed in a section", () => {
    for (const item of COMMERCE_NAV_ITEMS) {
      expect(SECTION_HREFS, item.href).toContain(item.href);
    }
  });

  it("no duplicate hrefs across all nav items", () => {
    const hrefs = ALL_ITEMS.map((i) => i.href as string);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("sections carry the six task groups from the plan", () => {
    const titles = COMMERCE_NAV_SECTIONS.map((s) => s.title);
    for (const t of ["কমার্স — বিক্রি", "কমার্স — ক্যাটালগ", "কমার্স — গ্রাহক", "কমার্স — অপারেশন", "কমার্স — বৃদ্ধি", "কমার্স — টাকা"]) {
      expect(titles).toContain(t);
    }
  });
});
