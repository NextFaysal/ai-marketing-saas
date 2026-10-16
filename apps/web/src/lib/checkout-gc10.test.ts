import { describe, expect, it } from "vitest";
import {
  buildInitiatePayload,
  depositAmountForKind,
  depositKindForPaymentMethod,
  depositStateLines,
  depositSummaryLines,
  hasOutstandingMinor,
  isDepositFullyPaid,
  isOnlineCheckoutContext,
  isTerminalPaymentKind,
  onlineOptionLabel,
  onlineSelectionValue,
  parseOnlineSelection,
  paymentStateKind,
} from "./checkout-gc10";

/**
 * GC10 — checkout payment helpers. The pinned honesty rule:
 * only the polled server state "verified_paid" may ever map
 * to "paid" — a browser-return flag like ?payment=verifying
 * or "received" must NEVER render as a payment success.
 */
describe("GC10 online selection values", () => {
  it("round-trips own + platform selections", () => {
    expect(parseOnlineSelection(onlineSelectionValue({ provider: "bkash", source: "own", sandbox: false })))
      .toEqual({ provider: "bkash", source: "own" });
    expect(parseOnlineSelection(onlineSelectionValue({ provider: "sslcommerz", source: "platform", sandbox: true })))
      .toEqual({ provider: "sslcommerz", source: "platform" });
  });

  it("GC11 own shurjopay/aamarpay selections round-trip with real labels", () => {
    expect(parseOnlineSelection(onlineSelectionValue({ provider: "shurjopay", source: "own", sandbox: true })))
      .toEqual({ provider: "shurjopay", source: "own" });
    expect(parseOnlineSelection(onlineSelectionValue({ provider: "aamarpay", source: "own", sandbox: false })))
      .toEqual({ provider: "aamarpay", source: "own" });
    expect(onlineOptionLabel({ provider: "shurjopay", source: "own", sandbox: true }))
      .toBe("অনলাইনে পেমেন্ট — ShurjoPay");
    expect(onlineOptionLabel({ provider: "aamarpay", source: "own", sandbox: false }))
      .toBe("অনলাইনে পেমেন্ট — aamarPay");
  });

  it("legacy / malformed values are not online selections", () => {
    expect(parseOnlineSelection("cod")).toBeNull();
    expect(parseOnlineSelection("bkash")).toBeNull();
    expect(parseOnlineSelection("online:own:nagad")).toBeNull();
    expect(parseOnlineSelection("online:weird:bkash")).toBeNull();
    expect(parseOnlineSelection("")).toBeNull();
    expect(parseOnlineSelection(null)).toBeNull();
    expect(parseOnlineSelection(undefined)).toBeNull();
  });
});

describe("GC10 honest labels", () => {
  it("platform rows say প্ল্যাটফর্ম গেটওয়ে; own rows do not", () => {
    expect(onlineOptionLabel({ provider: "bkash", source: "platform", sandbox: false }))
      .toBe("অনলাইনে পেমেন্ট (প্ল্যাটফর্ম গেটওয়ে) — bKash");
    expect(onlineOptionLabel({ provider: "sslcommerz", source: "own", sandbox: true }))
      .toBe("অনলাইনে পেমেন্ট — SSLCommerz");
  });
});

describe("GC10 success-page context + state kinds", () => {
  it("online context: stored online_pending or any ?payment= flag", () => {
    expect(isOnlineCheckoutContext("online_pending", null)).toBe(true);
    expect(isOnlineCheckoutContext("advance_unverified", "verifying")).toBe(true);
    expect(isOnlineCheckoutContext(null, "initiate_failed")).toBe(true);
    expect(isOnlineCheckoutContext("cod_due", null)).toBe(false);
    expect(isOnlineCheckoutContext("cod_due", "")).toBe(false);
    expect(isOnlineCheckoutContext(null, null)).toBe(false);
  });

  it("ONLY verified_paid is paid — verifying/received/unknown stay pending", () => {
    expect(paymentStateKind("verified_paid")).toBe("paid");
    expect(paymentStateKind("verifying")).toBe("pending");
    expect(paymentStateKind("received")).toBe("pending");
    expect(paymentStateKind("pending")).toBe("pending");
    expect(paymentStateKind("initiated")).toBe("pending");
    expect(paymentStateKind(null)).toBe("pending");
    expect(paymentStateKind(undefined)).toBe("pending");
    expect(paymentStateKind("failed")).toBe("failed");
    expect(paymentStateKind("cancelled")).toBe("cancelled");
    expect(paymentStateKind("none")).toBe("none");
  });

  it("terminal kinds stop polling; pending/none do not", () => {
    expect(isTerminalPaymentKind("paid")).toBe(true);
    expect(isTerminalPaymentKind("failed")).toBe(true);
    expect(isTerminalPaymentKind("cancelled")).toBe(true);
    expect(isTerminalPaymentKind("pending")).toBe(false);
    expect(isTerminalPaymentKind("none")).toBe(false);
  });
});

describe("AB4 deposit state + initiate purpose", () => {
  it("deposit_paid maps to its own kind (never full paid) and stops polling", () => {
    expect(paymentStateKind("deposit_paid")).toBe("deposit_paid");
    expect(paymentStateKind("deposit_paid")).not.toBe("paid");
    expect(isTerminalPaymentKind("deposit_paid")).toBe(true);
  });

  it("initiate payload omits purpose by default (legacy byte-identical) and includes it when given", () => {
    const base = { orderId: "o1", orderNumber: "N1", provider: "bkash" as const, source: "own" as const };
    expect(buildInitiatePayload(base)).toEqual({ orderId: "o1", orderNumber: "N1", provider: "bkash", source: "own" });
    expect(buildInitiatePayload({ ...base, purpose: "deposit" }).purpose).toBe("deposit");
    expect(buildInitiatePayload({ ...base, purpose: "balance" }).purpose).toBe("balance");
  });

  it("deposit kind follows the payment-method radio value", () => {
    expect(depositKindForPaymentMethod("cod")).toBe("cod");
    expect(depositKindForPaymentMethod("bkash")).toBe("manual");
    expect(depositKindForPaymentMethod("nagad")).toBe("manual");
    expect(depositKindForPaymentMethod("online:own:bkash")).toBe("online");
    expect(depositKindForPaymentMethod(null)).toBe("manual");
  });

  it("amount picking is per-kind; a null amount means deposit does not apply", () => {
    const dep = { note: "অগ্রিম আবশ্যক", amounts: { cod: "20000", online: null, manual: "20000" } };
    expect(depositAmountForKind(dep, "cod")).toBe("20000");
    expect(depositAmountForKind(dep, "online")).toBeNull();
    expect(depositAmountForKind(null, "cod")).toBeNull();
    expect(depositSummaryLines({ totalMinor: "100000", deposit: dep, kind: "online" })).toBeNull();
  });

  it("summary lines carry the server total + deposit and the display-only remainder", () => {
    const dep = { note: "অগ্রিম আবশ্যক", amounts: { cod: "20000", online: "20000", manual: null } };
    expect(depositSummaryLines({ totalMinor: "100000", deposit: dep, kind: "cod" }))
      .toEqual({ totalMinor: "100000", depositMinor: "20000", dueAfterMinor: "80000", note: "অগ্রিম আবশ্যক" });
  });

  it("deposit state lines + fully-paid / outstanding checks", () => {
    const fmt = (m: string) => `৳${Number(m) / 100}`;
    expect(depositStateLines({ dueMinor: "20000", paidMinor: "20000", outstandingMinor: "80000" }, fmt))
      .toEqual(["মোট ডিপোজিট: ৳200", "পরিশোধিত: ৳200", "বাকি: ৳800"]);
    expect(depositStateLines(null, fmt)).toEqual([]);
    expect(isDepositFullyPaid({ dueMinor: "20000", paidMinor: "20000", outstandingMinor: "80000" })).toBe(true);
    expect(isDepositFullyPaid({ dueMinor: "20000", paidMinor: "5000", outstandingMinor: "95000" })).toBe(false);
    expect(isDepositFullyPaid({ dueMinor: "0", paidMinor: "0", outstandingMinor: "0" })).toBe(false);
    expect(hasOutstandingMinor("1")).toBe(true);
    expect(hasOutstandingMinor("0")).toBe(false);
    expect(hasOutstandingMinor(null)).toBe(false);
  });
});
