import { parseLeadsCsv, minorToMajor, toCsv } from "./csv";

const HEADER = "name,phone,email,source,stage,tags,value,next_follow_up_at";

describe("parseLeadsCsv (CRM C3)", () => {
  it("parses a full row: aliases, tags on | and ;, taka value kept as string", () => {
    const r = parseLeadsCsv(`${HEADER}\nSara Ahmed,+8801711-000000,sara@example.com,WhatsApp,Qualified,vip|wholesale;dhaka,2500.50,2026-10-20`);
    expect(r.errors).toHaveLength(0);
    expect(r.totalRows).toBe(1);
    expect(r.rows[0]).toMatchObject({
      rowNumber: 1, name: "Sara Ahmed", phone: "+8801711-000000",
      email: "sara@example.com", source: "whatsapp", stage: "qualified",
      tags: ["vip", "wholesale", "dhaka"], value: "2500.50", nextFollowUpAt: "2026-10-20",
    });
  });

  it("defaults source=manual and stage=new; name is the only required column", () => {
    const r = parseLeadsCsv(`name\nJust A Name`);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0].source).toBe("manual");
    expect(r.rows[0].stage).toBe("new");
    expect(r.rows[0].tags).toEqual([]);
  });

  it("rejects a missing name with a row error and keeps other rows", () => {
    const r = parseLeadsCsv(`name,phone\n,01711000000\nGood Name,01711000001`);
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toEqual([{ row: 1, message: "Missing required column: name" }]);
  });

  it("rejects invalid source and stage values with the offending value in the message", () => {
    const r = parseLeadsCsv(`${HEADER}\nA,01711000000,,tiktok,new,,,\nB,01711000001,,manual,banana,,,`);
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].row).toBe(1);
    expect(r.errors[0].message).toContain('Invalid source: "tiktok"');
    expect(r.errors[1].row).toBe(2);
    expect(r.errors[1].message).toContain('Invalid stage: "banana"');
  });

  it("facebook_lead_ads is not importable (reserved for Meta webhook ingestion)", () => {
    const r = parseLeadsCsv(`name,source\nA,facebook_lead_ads`);
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].message).toContain("Invalid source");
  });

  it("rejects invalid money and invalid follow-up dates instead of guessing", () => {
    const badMoney = parseLeadsCsv(`name,value\nA,abc`);
    expect(badMoney.errors[0].message).toContain("Invalid value");
    const neg = parseLeadsCsv(`name,value\nA,-50`);
    expect(neg.errors[0].message).toContain("cannot be negative");
    const badDate = parseLeadsCsv(`name,next_follow_up_at\nA,not-a-date`);
    expect(badDate.errors[0].message).toContain("Invalid next_follow_up_at");
  });

  it("maps friendly header aliases (Customer Name / Mobile / Lead Value / Follow Up Date)", () => {
    const r = parseLeadsCsv(`Customer Name,Mobile,Lead Value,Follow Up Date\nKarim,01711000002,1000,2026-11-01`);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]).toMatchObject({ name: "Karim", phone: "01711000002", value: "1000", nextFollowUpAt: "2026-11-01" });
  });
});

describe("CSV writing helpers (CRM C3 exports)", () => {
  it("minorToMajor is exact integer math", () => {
    expect(minorToMajor(250050n)).toBe("2500.50");
    expect(minorToMajor(0n)).toBe("0.00");
    expect(minorToMajor(5n)).toBe("0.05");
    expect(minorToMajor(1000000007n)).toBe("10000000.07");
  });

  it("toCsv quotes commas, quotes and newlines (scorecard discipline)", () => {
    const out = toCsv(["a", "b"], [["x,y", 'say "hi"'], ["line\nbreak", "plain"]]);
    expect(out).toBe('a,b\n"x,y","say ""hi"""\n"line\nbreak",plain');
  });
});
