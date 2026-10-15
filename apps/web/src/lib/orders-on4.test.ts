import { describe, expect, it } from "vitest";
import { COD_CALL_OUTCOMES, FRAUD_BAND_LABEL, codCallOutcomeLabel } from "./orders-on4";

describe("FRAUD_BAND_LABEL", () => {
  it("has a Bengali label + chip class for every persisted band", () => {
    expect(FRAUD_BAND_LABEL.low.text).toBe("কম ঝুঁকি");
    expect(FRAUD_BAND_LABEL.medium.text).toBe("মাঝারি ঝুঁকি");
    expect(FRAUD_BAND_LABEL.high.text).toBe("উচ্চ ঝুঁকি");
    expect(FRAUD_BAND_LABEL.low.cls).toContain("emerald");
    expect(FRAUD_BAND_LABEL.medium.cls).toContain("amber");
    expect(FRAUD_BAND_LABEL.high.cls).toContain("rose");
  });
});

describe("COD_CALL_OUTCOMES / codCallOutcomeLabel", () => {
  it("carries exactly the four fixed API outcome keys", () => {
    expect(COD_CALL_OUTCOMES.map((o) => o.key)).toEqual([
      "confirmed", "rejected", "unreachable", "callback_requested",
    ]);
  });
  it("labels known outcomes in Bengali", () => {
    expect(codCallOutcomeLabel("confirmed")).toBe("নিশ্চিত");
    expect(codCallOutcomeLabel("rejected")).toBe("প্রত্যাখ্যান");
    expect(codCallOutcomeLabel("unreachable")).toBe("পাইনি");
    expect(codCallOutcomeLabel("callback_requested")).toBe("পরে কল করবে");
  });
  it("missing outcome renders as a dash, unknown passes through", () => {
    expect(codCallOutcomeLabel(null)).toBe("—");
    expect(codCallOutcomeLabel(undefined)).toBe("—");
    expect(codCallOutcomeLabel("")).toBe("—");
    expect(codCallOutcomeLabel("something_else")).toBe("something_else");
  });
});
