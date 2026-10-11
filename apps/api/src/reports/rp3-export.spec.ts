import { runToCsv, ReportExportService } from "./report-export.service";

/** Reports Advanced RP3: CSV carries a BOM, money is
 *  rendered as major units, nulls stay empty (never a
 *  fabricated 0.00), the print view is branded and
 *  escaped. */
describe("RP3 exports", () => {
  it("CSV: BOM, headers, formatted money, TOTAL row, empty for null", () => {
    const csv = runToCsv({
      dimension: "day", metrics: ["orders", "revenue", "aov"],
      rows: [{ label: "2026-10-11", values: { orders: 4, revenue: "200000", aov: "50000" } }, { label: "2026-10-12", values: { orders: 0, revenue: "0", aov: null } }],
      totals: { orders: 4, revenue: "200000", aov: "50000" },
    });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Date,Orders,Revenue,AOV");
    expect(csv).toContain('2026-10-11,4,"2,000.00",500.00'); // thousands separators are quoted per CSV rules
    expect(csv).toContain("2026-10-12,0,0.00,");
    expect(csv).toContain('TOTAL,4,"2,000.00",500.00');
  });

  it("print HTML escapes the report name and uses the org brand color", async () => {
    const custom: any = {
      get: async () => ({ id: "s1", name: "<script>x</script>", dimension: "platform", metrics: ["spend"], rangePreset: "last_7d" }),
      runSaved: async () => ({ dimension: "platform", metrics: ["spend"], range: { from: "2026-10-05", to: "2026-10-11" }, rows: [{ label: "meta", values: { spend: "15000" } }], totals: { spend: "15000" } }),
    };
    const prisma: any = { organization: { findUnique: async () => ({ name: "Shop", brandName: "Amar Dokan", primaryColor: "#123456" }) } };
    const html = await new ReportExportService(prisma, custom).savedPrintHtml("org", "s1");
    expect(html).toContain("Amar Dokan");
    expect(html).toContain("#123456");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("150.00");
    expect(html).toContain("window.print()");
  });
});
