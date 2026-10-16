// EB6/ED16 — layout accessibility pins (source-light).
// The shop skip link renders t.common.skipToContent; both locales
// must carry the key with the exact strings the layout depends on.
// (Full-layout renders need heavy Next/server mocking, so the
// structural pin lives in ui-eb6.test.tsx for SkipLink itself and
// in shop-i18n.test.ts for overall dict key parity.)
import { describe, expect, it } from "vitest";
import { shopDicts } from "./shop-i18n";

describe("EB6 shop skip-link dictionary entry", () => {
  it("has skipToContent in bn with the exact Bengali string", () => {
    expect(shopDicts.bn.common.skipToContent).toBe("মূল কন্টেন্টে যান");
  });

  it("has skipToContent in en with the exact English string", () => {
    expect(shopDicts.en.common.skipToContent).toBe("Skip to main content");
  });
});
