import { describe, expect, it } from "vitest";
import { shopInstallDismissedKey } from "../app/shop/[orgSlug]/ShopInstallBar";

/**
 * NF14 (FB5) — install-bar dismissal persistence contract.
 *
 * The dismissal behaviour itself lives in ShopInstallBar (a
 * localStorage read in its mount effect + a write in dismiss());
 * it had NO test coverage before NF14. What is pinned here is
 * the persistence KEY contract the behaviour rides on: the key
 * is per-shop, so dismissing one shop's bar can never silence
 * another shop's bar on the same device.
 */
describe("NF14 shopInstallDismissedKey", () => {
  it("is the documented per-shop localStorage key", () => {
    expect(shopInstallDismissedKey("alpha-shop")).toBe("shop-install-dismissed:alpha-shop");
    expect(shopInstallDismissedKey("beta-shop")).toBe("shop-install-dismissed:beta-shop");
  });

  it("differs per shop (one shop's dismissal never leaks to another)", () => {
    expect(shopInstallDismissedKey("alpha-shop")).not.toBe(shopInstallDismissedKey("beta-shop"));
  });
});
