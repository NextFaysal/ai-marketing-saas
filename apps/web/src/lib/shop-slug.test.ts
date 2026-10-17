import { describe, it, expect } from "vitest";
import { slugifyShopName, localSlugProblem, shopSubdomainHost, SHOP_ADDRESS_SUFFIX } from "./shop-slug";

describe("TD2 shop-slug helpers", () => {
  it("slugifies business names the way onboarding always has", () => {
    expect(slugifyShopName("Dhaka Fashion House")).toBe("dhaka-fashion-house");
    expect(slugifyShopName("  Mirpur Electronics!! ")).toBe("mirpur-electronics");
    expect(slugifyShopName("A  --  B")).toBe("a-b");
  });
  it("flags local format and reserved problems instantly", () => {
    expect(localSlugProblem("dhaka-fashion")).toBeNull();
    expect(localSlugProblem("-bad")).toBe("invalid");
    expect(localSlugProblem("bad--slug")).toBe("invalid");
    expect(localSlugProblem("ab")).toBe("invalid");
    expect(localSlugProblem("dashboard")).toBe("reserved");
    expect(localSlugProblem("fake")).toBe("reserved");
    expect(localSlugProblem("my-admin-shop")).toBe("reserved");
  });
  it("builds the shop address on the platform apex domain", () => {
    expect(shopSubdomainHost("dhaka-fashion")).toBe("dhaka-fashion.qosprey.com");
    expect(SHOP_ADDRESS_SUFFIX).toBe(".qosprey.com");
  });
});
