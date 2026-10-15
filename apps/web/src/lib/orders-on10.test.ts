import { describe, expect, it } from "vitest";
import {
  buildPrintJobsPath, mergeOrderIds, parseOrderIdsInput, printJobStatusLabel,
  printTypeLabel, templatePayload, validateTemplateForm, type PrintTemplate,
} from "./orders-on10";

describe("orders-on10 helpers", () => {
  it("parses pasted ids on whitespace/commas/newlines and dedupes loudly", () => {
    const out = parseOrderIdsInput("a1, b2\nc3  a1,,b2 ; d4");
    expect(out.ids).toEqual(["a1", "b2", "c3", "d4"]);
    expect(out.duplicatesDropped).toBe(2);
    expect(parseOrderIdsInput("")).toEqual({ ids: [], duplicatesDropped: 0 });
  });

  it("merge puts the selection first and counts cross-source duplicates", () => {
    const out = mergeOrderIds(["s1", "s2"], "s2 p1");
    expect(out.ids).toEqual(["s1", "s2", "p1"]);
    expect(out.duplicatesDropped).toBe(1);
  });

  it("labels types + job statuses in Bengali, partial jobs name the dropped count", () => {
    expect(printTypeLabel("challans")).toBe("ডেলিভারি চালান");
    expect(printTypeLabel("mystery")).toBe("mystery");
    const base = { id: "j1", organizationId: "o", type: "labels", orderIds: [], orderCount: 3, error: null, createdById: null, createdAt: null };
    expect(printJobStatusLabel({ ...base, status: "done", failedOrderIds: [] })).toBe("হয়েছে");
    expect(printJobStatusLabel({ ...base, status: "done", failedOrderIds: ["x"] })).toBe("হয়েছে (1টি বাদ)");
    expect(printJobStatusLabel({ ...base, status: "failed", failedOrderIds: [] })).toBe("ব্যর্থ");
  });

  it("template validation mirrors the API (logo scheme + caps)", () => {
    const empty: PrintTemplate = { logoUrl: null, footerText: null, termsText: null, invoiceNote: null, updatedAt: null };
    expect(validateTemplateForm(empty)).toBeNull();
    expect(validateTemplateForm({ ...empty, logoUrl: "ftp://x/y.png" })).toMatch(/https?/);
    expect(validateTemplateForm({ ...empty, logoUrl: "https://shop.example/logo.png" })).toBeNull();
    expect(validateTemplateForm({ ...empty, footerText: "x".repeat(201) })).toMatch(/200/);
  });

  it("template payload trims and maps empty → null (full replace)", () => {
    expect(templatePayload({ logoUrl: "  https://a.b/l.png ", footerText: "  ", termsText: " শর্ত ", invoiceNote: null, updatedAt: null }))
      .toEqual({ logoUrl: "https://a.b/l.png", footerText: null, termsText: "শর্ত", invoiceNote: null });
  });

  it("builds the paged history path", () => {
    expect(buildPrintJobsPath("org-1", 2, 50)).toBe("/organizations/org-1/orders/print-jobs?page=2&pageSize=50");
  });
});
