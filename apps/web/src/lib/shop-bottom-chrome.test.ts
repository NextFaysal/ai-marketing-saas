import { afterEach, describe, expect, it, vi } from "vitest";
import { getState, setBuyBarActive, subscribe } from "./shop-bottom-chrome";

describe("shop bottom-chrome store (ED7)", () => {
  afterEach(() => {
    setBuyBarActive(false);
  });

  it("starts with no buy bar active", () => {
    expect(getState()).toEqual({ buyBarActive: false });
  });

  it("set notifies subscribers with the new state", () => {
    const fn = vi.fn();
    const unsub = subscribe(fn);
    setBuyBarActive(true);
    expect(getState().buyBarActive).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    setBuyBarActive(false);
    expect(getState().buyBarActive).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2);
    unsub();
  });

  it("does not notify when the value is unchanged", () => {
    const fn = vi.fn();
    const unsub = subscribe(fn);
    setBuyBarActive(false);
    expect(fn).not.toHaveBeenCalled();
    unsub();
  });

  it("unsubscribe stops further notifications", () => {
    const fn = vi.fn();
    const unsub = subscribe(fn);
    unsub();
    setBuyBarActive(true);
    expect(fn).not.toHaveBeenCalled();
  });

  it("multiple subscribers are all notified", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribe(a);
    const unsubB = subscribe(b);
    setBuyBarActive(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unsubA();
    unsubB();
  });
});
