import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiRichAnswer, AiToolTransparency, buildRichBlocks, hasStoppedMarker, visibleToolCalls } from "./ai-rich";

const overview = {
  tool: "get_analytics_overview", status: "success",
  display: { range: { from: "2026-10-03", to: "2026-10-09" }, orders: 42, revenue: "BDT 84000.00", adSpend: "BDT 12000.00", contributionMarginPercent: 36.9, cogsCoveragePercent: 90 },
};

describe("buildRichBlocks — renders only supplied data", () => {
  it("analytics overview → stat tiles from the known numeric/string fields present in display", () => {
    const blocks = buildRichBlocks([overview]);
    expect(blocks).toHaveLength(1);
    const b = blocks[0] as Extract<(typeof blocks)[number], { kind: "stats" }>;
    expect(b.tiles).toEqual([
      { label: "অর্ডার", value: "42" },
      { label: "Revenue", value: "BDT 84000.00" },
      { label: "Ad Spend", value: "BDT 12000.00" },
      { label: "Margin", value: "36.9%" },
      { label: "COGS Coverage", value: "90%" },
    ]);
    // Fields absent from the fixture (mer, ROAS, profit…) never appear.
    expect(JSON.stringify(blocks)).not.toContain("MER");
    expect(JSON.stringify(blocks)).not.toContain("Contribution Profit");
  });

  it("compare_periods → delta tiles with before/after and the supplied % (null % renders no delta)", () => {
    const blocks = buildRichBlocks([{
      tool: "compare_periods", status: "success",
      display: {
        current: { orders: 50, revenue: "BDT 90000.00" },
        previous: { orders: 40, revenue: "BDT 80000.00" },
        deltasPercent: { orders: 25, revenue: null },
      },
    }]);
    const b = blocks[0] as Extract<(typeof blocks)[number], { kind: "deltas" }>;
    expect(b.tiles).toEqual([
      { label: "অর্ডার", current: "50", previous: "40", deltaPercent: 25 },
      { label: "Revenue", current: "BDT 90000.00", previous: "BDT 80000.00", deltaPercent: null },
    ]);
  });

  it("campaign performance → bar rows whose widths are relative to the largest supplied spend", () => {
    const blocks = buildRichBlocks([{
      tool: "get_campaign_performance", status: "success",
      display: { campaigns: [
        { name: "ঈদ অফার", platform: "meta", spend: "BDT 10000.00", clicks: 500 },
        { name: "রিমার্কেটিং", platform: "meta", spend: "BDT 5000.00", clicks: 900 },
      ] },
    }]);
    const b = blocks[0] as Extract<(typeof blocks)[number], { kind: "bars" }>;
    expect(b.rows).toEqual([
      { label: "ঈদ অফার", value: "BDT 10000.00", widthPercent: 100 },
      { label: "রিমার্কেটিং", value: "BDT 5000.00", widthPercent: 50 },
    ]);
  });

  it("product profit and courier performance → bar rows from their supplied arrays", () => {
    const profit = buildRichBlocks([{
      tool: "get_product_profit", status: "success",
      display: { products: [{ name: "শাড়ি", grossProfit: "BDT 3000.00" }, { name: "কুর্তি", grossProfit: "BDT 1500.00" }] },
    }]);
    expect((profit[0] as any).rows.map((r: any) => r.widthPercent)).toEqual([100, 50]);
    const courier = buildRichBlocks([{
      tool: "get_courier_performance", status: "success",
      display: { providers: [{ provider: "steadfast", total: 20, delivered: 18 }, { provider: "pathao", total: 10, delivered: 7 }] },
    }]);
    expect((courier[0] as any).rows).toEqual([
      { label: "steadfast", value: "20টি শিপমেন্ট", widthPercent: 100 },
      { label: "pathao", value: "10টি শিপমেন্ট", widthPercent: 50 },
    ]);
  });

  it("list_products → a table with only the columns the supplied rows carry", () => {
    const blocks = buildRichBlocks([{
      tool: "list_products", status: "success",
      display: { products: [
        { name: "শাড়ি", sku: "SH-1", price: "BDT 1200.00", stock: 7 },
        { name: "কুর্তি", price: "BDT 900.00" },
      ] },
    }]);
    const b = blocks[0] as Extract<(typeof blocks)[number], { kind: "table" }>;
    expect(b.columns).toEqual(["নাম", "SKU", "দাম", "স্টক"]);
    expect(b.rows).toEqual([
      ["শাড়ি", "SH-1", "BDT 1200.00", "7"],
      ["কুর্তি", "—", "BDT 900.00", "—"],
    ]);
  });

  it("unknown tools, missing displays, error entries and truncated displays render nothing", () => {
    expect(buildRichBlocks([{ tool: "get_anomalies", status: "success", display: { anomalies: [] } }])).toEqual([]);
    expect(buildRichBlocks([{ tool: "get_analytics_overview", status: "success" }])).toEqual([]);
    expect(buildRichBlocks([{ tool: "get_analytics_overview", status: "error", display: { orders: 1 } }])).toEqual([]);
    expect(buildRichBlocks([{ tool: "get_analytics_overview", status: "success", display: { truncated: true, preview: "{}" } }])).toEqual([]);
    expect(buildRichBlocks([])).toEqual([]);
    expect(buildRichBlocks(null)).toEqual([]);
  });

  it("the __stopped marker is excluded from tool lists and detected separately", () => {
    const calls = [
      { tool: "get_analytics_overview", status: "success", display: { orders: 3 } },
      { tool: "__stopped", status: "stopped" },
    ];
    expect(visibleToolCalls(calls).map((t) => t.tool)).toEqual(["get_analytics_overview"]);
    expect(hasStoppedMarker(calls)).toBe(true);
    expect(hasStoppedMarker([calls[0]])).toBe(false);
    expect(JSON.stringify(buildRichBlocks(calls))).not.toContain("__stopped");
  });
});

describe("AiRichAnswer (rendered markup)", () => {
  it("renders exactly the fixture's numbers — nothing beyond them", () => {
    const html = renderToStaticMarkup(<AiRichAnswer toolCalls={[overview]} />);
    expect(html).toContain("42");
    expect(html).toContain("BDT 84000.00");
    expect(html).toContain("36.9%");
    expect(html).not.toContain("999");
    expect(html).not.toContain("__stopped");
  });

  it("renders nothing when there is nothing renderable", () => {
    expect(renderToStaticMarkup(<AiRichAnswer toolCalls={[{ tool: "get_anomalies", status: "success" }]} />)).toBe("");
    expect(renderToStaticMarkup(<AiRichAnswer toolCalls={null} />)).toBe("");
  });
});

describe("AiToolTransparency (GV1 shared component)", () => {
  it("renders tool chips with status, hides __ markers, shows the stopped chip", () => {
    const html = renderToStaticMarkup(
      <AiToolTransparency toolCalls={[
        { tool: "get_analytics_overview", status: "success" },
        { tool: "get_campaign_performance", status: "error" },
        { tool: "__stopped", status: "stopped" },
      ]} />,
    );
    expect(html).toContain("get_analytics_overview");
    expect(html).toContain("get_campaign_performance");
    expect(html).toContain("থামানো হয়েছে");
    expect(html).not.toContain("__stopped");
  });
  it("renders nothing without visible tools or a stop marker", () => {
    expect(renderToStaticMarkup(<AiToolTransparency toolCalls={[]} />)).toBe("");
    expect(renderToStaticMarkup(<AiToolTransparency toolCalls={null} />)).toBe("");
    expect(renderToStaticMarkup(<AiToolTransparency toolCalls={[{ tool: "__stopped", status: "stopped" }]} />)).toContain("থামানো হয়েছে");
  });
});
