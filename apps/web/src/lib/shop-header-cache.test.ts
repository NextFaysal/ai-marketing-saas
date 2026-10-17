import { beforeEach, describe, expect, it } from "vitest";
import {
  SHOP_HEADER_CACHE_TTL_MS,
  clearShopHeaderCache,
  getCachedCartCount,
  getCachedWishlistCount,
  invalidateCartCount,
  invalidateWishlistCount,
  setCachedCartCount,
  setCachedWishlistCount,
} from "./shop-header-cache";

describe("shop-header-cache (ED5)", () => {
  beforeEach(() => clearShopHeaderCache());

  it("misses when empty and hits within the TTL", () => {
    expect(getCachedCartCount("org-a", 1_000)).toBeNull();
    setCachedCartCount("org-a", 3, 1_000);
    expect(getCachedCartCount("org-a", 1_000 + SHOP_HEADER_CACHE_TTL_MS - 1)).toBe(3);
  });

  it("expires at the TTL boundary", () => {
    setCachedWishlistCount("org-a", 2, 5_000);
    expect(getCachedWishlistCount("org-a", 5_000 + SHOP_HEADER_CACHE_TTL_MS)).toBeNull();
  });

  it("keeps orgs and badge kinds separate", () => {
    setCachedCartCount("org-a", 1, 0);
    setCachedCartCount("org-b", 9, 0);
    setCachedWishlistCount("org-a", 4, 0);
    expect(getCachedCartCount("org-a", 1)).toBe(1);
    expect(getCachedCartCount("org-b", 1)).toBe(9);
    expect(getCachedWishlistCount("org-a", 1)).toBe(4);
    expect(getCachedWishlistCount("org-b", 1)).toBeNull();
  });

  it("invalidates a single org entry only", () => {
    setCachedCartCount("org-a", 1, 0);
    setCachedCartCount("org-b", 2, 0);
    setCachedWishlistCount("org-a", 5, 0);
    invalidateCartCount("org-a");
    invalidateWishlistCount("org-a");
    expect(getCachedCartCount("org-a", 1)).toBeNull();
    expect(getCachedWishlistCount("org-a", 1)).toBeNull();
    expect(getCachedCartCount("org-b", 1)).toBe(2);
  });
});
