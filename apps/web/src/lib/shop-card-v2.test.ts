import { describe, expect, it } from "vitest";
import { SHOP_THEMES, isV2Tokens, themeOf } from "./shop-theme";

/**
 * ED8 — ProductCard v2 detection pin.
 *
 * A full jsdom render of ProductCard is impractical in this app's
 * vitest setup: ProductCard imports through the "@/…" alias (vitest
 * here has no "@" alias — see components/MediaImage.test.tsx) plus
 * next/link and the client wishlist/quick-view islands. So the v2
 * branch's contract is pinned at the level ProductCard itself
 * branches on: isV2Tokens(tokens) + the v2-only token fields the
 * branch renders (cardBodyClass / cardPriceClass). If a legacy
 * theme ever gained those fields, or v2 lost them, the card's
 * branch selection would silently change — this spec fails first.
 */
describe("ED8 ProductCard v2 token contract", () => {
  it("v2 tokens are detected as v2 and carry the v2 body/price classes", () => {
    const v2 = themeOf("v2");
    expect(isV2Tokens(v2)).toBe(true);
    expect(v2.cardBodyClass).toBe(SHOP_THEMES.v2.cardBodyClass);
    // The v2 price renders in the brand colour via the token var.
    expect(v2.cardPriceClass).toContain("text-[var(--brand)]");
    expect(v2.cardBodyClass).toContain("text-[var(--ink-body)]");
    // The v2 card surface itself is token-native.
    expect(v2.cardClass).toContain("bg-[var(--surface)]");
  });

  it("legacy tokens are NOT v2 and omit every v2-only class", () => {
    for (const id of ["classic", "bold", "minimal"] as const) {
      const tokens = themeOf(id);
      expect(isV2Tokens(tokens)).toBe(false);
      expect(tokens.cardBodyClass).toBeUndefined();
      expect(tokens.cardPriceClass).toBeUndefined();
      expect(tokens.cardClass).not.toContain("var(--brand)");
      expect(tokens.cardClass).not.toContain("var(--surface)");
    }
    // Unknown ids resolve to classic, hence never to v2.
    expect(isV2Tokens(themeOf(undefined))).toBe(false);
    expect(isV2Tokens(themeOf("nope"))).toBe(false);
  });
});
