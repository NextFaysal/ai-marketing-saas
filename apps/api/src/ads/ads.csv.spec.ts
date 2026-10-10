import { parseAdSpendCsv } from "./ads.csv";

describe("parseAdSpendCsv", () => {
  it("parses a Meta-style export row", () => {
    const csv = "date,campaign_name,amount_spent,impressions,clicks,conversions,conversion_value,currency\n2026-10-01,Eid Sale,1250.50,50000,1000,25,43750.00,BDT";
    const r = parseAdSpendCsv(csv);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0].spendMinor).toBe(125050n);
    expect(r.rows[0].conversionValueMinor).toBe(4375000n);
    expect(r.rows[0].campaignName).toBe("Eid Sale");
    expect(r.rows[0].campaignExternalId).toBe("");
  });
  it("reports bad dates and bad spend per row", () => {
    const csv = "date,spend\n01/10/2026,100\n2026-10-02,abc\n2026-10-03,200";
    const r = parseAdSpendCsv(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(2);
  });
});
