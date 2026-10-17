import { describe, expect, it } from "vitest";
import {
  FRAUD_NETWORK_PAST_BN,
  FRAUD_NETWORK_SHARED_BN,
  FRAUD_NETWORK_UNAVAILABLE_BN,
  fraudNetworkToggleDisabled,
  networkSignalBody,
  networkSignalHeading,
  type FraudNetworkSignal,
} from "./fraud-network-nf13";

// NF13 (FB5) — web helper pins: the network signal is always
// labelled as combined multi-shop data (never the shop's own
// score), insufficient_data shows no counts, and the card's
// honesty strings (hash-only sharing; past aggregates cannot
// be removed; server-not-live message) stay verbatim.
describe("fraud-network-nf13 helpers", () => {
  const ok: FraudNetworkSignal = {
    status: "ok", delivered: 7, returnedFailed: 3, codRefusals: 2,
    contributingOrgCount: 5, total: 10,
  };

  it("ok signal heading names the contributing-shop count as combined network data", () => {
    expect(networkSignalHeading(ok)).toBe("নেটওয়ার্ক তথ্য (5টি দোকানের সম্মিলিত)");
    expect(networkSignalBody(ok)).toBe("ডেলিভারি: 7টি · রিটার্ন/ব্যর্থ: 3টি · COD প্রত্যাখ্যান: 2টি");
  });

  it("insufficient_data shows the honest line and NO counts", () => {
    const sig: FraudNetworkSignal = { status: "insufficient_data", contributingOrgCount: 2 };
    expect(networkSignalHeading(sig)).toBe("নেটওয়ার্ক তথ্য");
    expect(networkSignalBody(sig)).toBe("নেটওয়ার্কে এখনো যথেষ্ট তথ্য নেই");
  });

  it("not_opted_in / unavailable / missing signals render nothing", () => {
    expect(networkSignalHeading({ status: "not_opted_in" })).toBeNull();
    expect(networkSignalBody({ status: "not_opted_in" })).toBeNull();
    expect(networkSignalHeading({ status: "unavailable" })).toBeNull();
    expect(networkSignalBody(null)).toBeNull();
    expect(networkSignalHeading(undefined)).toBeNull();
  });

  it("card honesty strings stay verbatim", () => {
    expect(FRAUD_NETWORK_UNAVAILABLE_BN).toBe("এই সুবিধাটি সার্ভারে এখনো চালু হয়নি");
    expect(FRAUD_NETWORK_SHARED_BN).toContain("শুধু সংখ্যা");
    expect(FRAUD_NETWORK_SHARED_BN).toContain("hash");
    expect(FRAUD_NETWORK_SHARED_BN).toContain("কিছুই শেয়ার হয় না");
    expect(FRAUD_NETWORK_PAST_BN).toContain("সরানো যায় না");
    expect(FRAUD_NETWORK_PAST_BN).toContain("ভবিষ্যতের অবদান");
  });

  it("toggle is disabled until settings load AND the server says available", () => {
    expect(fraudNetworkToggleDisabled(null)).toBe(true);
    expect(fraudNetworkToggleDisabled(undefined)).toBe(true);
    expect(fraudNetworkToggleDisabled({ available: false, enabled: false, enabledAt: null })).toBe(true);
    expect(fraudNetworkToggleDisabled({ available: true, enabled: false, enabledAt: null })).toBe(false);
    expect(fraudNetworkToggleDisabled({ available: true, enabled: true, enabledAt: "2026-10-17T00:00:00.000Z" })).toBe(false);
  });
});
