import { describe, expect, it } from "vitest";
import { buildExpressPayload, paymentMethodLabelBn, preselectPaymentMethod } from "./express-checkout";

describe("AB4 express checkout payload", () => {
  it("includes only defined optional keys", () => {
    expect(buildExpressPayload({ cartToken: "t1" })).toEqual({ cartToken: "t1" });
    expect(buildExpressPayload({
      cartToken: "t1", addressId: "a1", paymentMethod: "cod",
      fieldAnswers: { size: "L" }, termsAccepted: true, idempotencyKey: "k1",
    })).toEqual({
      cartToken: "t1", addressId: "a1", paymentMethod: "cod",
      fieldAnswers: { size: "L" }, termsAccepted: true, idempotencyKey: "k1",
    });
    expect(buildExpressPayload({ cartToken: "t1", fieldAnswers: {} })).toEqual({ cartToken: "t1" });
  });

  it("preselects only legacy manual kinds from the most recent order", () => {
    expect(preselectPaymentMethod([{ paymentMethod: "bkash" }, { paymentMethod: "cod" }])).toBe("bkash");
    expect(preselectPaymentMethod([{ paymentMethod: "online" }])).toBeUndefined();
    expect(preselectPaymentMethod([])).toBeUndefined();
    expect(preselectPaymentMethod(null)).toBeUndefined();
  });

  it("labels payment methods in Bengali", () => {
    expect(paymentMethodLabelBn("cod")).toBe("ক্যাশ অন ডেলিভারি");
    expect(paymentMethodLabelBn("bkash")).toBe("বিকাশ (ম্যানুয়াল)");
    expect(paymentMethodLabelBn(null)).toBe("ক্যাশ অন ডেলিভারি");
  });
});
