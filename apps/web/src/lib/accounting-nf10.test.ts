import { describe, expect, it } from "vitest";
import {
  ACCOUNTING_DISCLAIMER,
  accountTypeLabel,
  directionLabel,
  matchStateLabel,
  sourceTypeLabel,
} from "./accounting-nf10";

describe("NF10 accounting web helpers", () => {
  it("the disclaimer is byte-identical to the API's verbatim disclaimer", () => {
    expect(ACCOUNTING_DISCLAIMER).toBe("এটি একটি হিসাব-সহায়ক টুল — অডিট করা বা বিধিবদ্ধ হিসাব নয়।");
  });

  it("account type labels cover the five double-entry types", () => {
    for (const t of ["asset", "liability", "equity", "income", "expense"]) {
      expect(accountTypeLabel(t)).not.toBe(t);
    }
    expect(accountTypeLabel("unknown-x")).toBe("unknown-x");
    expect(accountTypeLabel(null)).toBe("—");
  });

  it("source + match-state + direction labels are human Bengali, unknown passes through", () => {
    expect(sourceTypeLabel("order")).toContain("অর্ডার");
    expect(sourceTypeLabel("courier_charge")).toContain("কুরিয়ার");
    expect(matchStateLabel("suggested")).toBe("প্রস্তাবিত মিল");
    expect(matchStateLabel("matched")).toBe("মিল নিশ্চিত");
    expect(directionLabel("credit")).toContain("জমা");
    expect(directionLabel("debit")).toContain("Debit");
  });
});
