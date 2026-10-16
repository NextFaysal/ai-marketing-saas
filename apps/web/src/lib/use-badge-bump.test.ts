// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { shouldBumpBadge, useBadgeBump } from "./use-badge-bump";

/**
 * ED11 (EB4) — the cart-badge bump fires ONLY on an increase:
 * never on first observation, never on a decrease or a repeat.
 */
describe("shouldBumpBadge", () => {
  it("bumps only on a strict increase over a known previous count", () => {
    expect(shouldBumpBadge(1, 2)).toBe(true);
    expect(shouldBumpBadge(0, 1)).toBe(true);
    expect(shouldBumpBadge(2, 2)).toBe(false);
    expect(shouldBumpBadge(3, 1)).toBe(false);
    expect(shouldBumpBadge(null, 5)).toBe(false);
    expect(shouldBumpBadge(undefined, 5)).toBe(false);
    expect(shouldBumpBadge(1, Number.NaN)).toBe(false);
  });
});

describe("useBadgeBump", () => {
  it("increments the key on each increase and only then", () => {
    const { result, rerender } = renderHook(({ n }) => useBadgeBump(n), {
      initialProps: { n: 0 },
    });
    expect(result.current).toBe(0); // initial observation: no bump
    act(() => rerender({ n: 2 }));
    expect(result.current).toBe(1); // increase → bump
    act(() => rerender({ n: 2 }));
    expect(result.current).toBe(1); // same count: no bump
    act(() => rerender({ n: 1 }));
    expect(result.current).toBe(1); // decrease: no bump
    act(() => rerender({ n: 4 }));
    expect(result.current).toBe(2); // increase again → bump
  });
});
