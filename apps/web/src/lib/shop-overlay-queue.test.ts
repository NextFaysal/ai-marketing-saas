import { describe, expect, it } from "vitest";
import {
  OVERLAY_PRIORITIES,
  createOverlayQueue,
} from "./shop-overlay-queue";
import { computeBottomLiftPx } from "./shop-bottom-chrome";

describe("shop overlay queue (ED9)", () => {
  it("grants the highest-priority requester, not the first", () => {
    const q = createOverlayQueue(OVERLAY_PRIORITIES);
    q.request("social");
    q.request("push");
    q.request("popup");
    expect(q.active()).toBe("popup");
    expect(q.snapshot()).toEqual(["popup", "push", "social"]);
  });

  it("keeps at most one active id", () => {
    const q = createOverlayQueue(OVERLAY_PRIORITIES);
    q.request("social");
    q.request("install");
    expect(q.active()).toBe("install");
    expect(q.snapshot()).toHaveLength(2);
  });

  it("release of the active id frees the next-highest waiter", () => {
    const q = createOverlayQueue(OVERLAY_PRIORITIES);
    q.request("social");
    q.request("install");
    q.request("push");
    expect(q.active()).toBe("install");
    q.release("install");
    expect(q.active()).toBe("push");
    q.release("push");
    expect(q.active()).toBe("social");
    q.release("social");
    expect(q.active()).toBeNull();
  });

  it("re-request is idempotent", () => {
    const q = createOverlayQueue(OVERLAY_PRIORITIES);
    q.request("push");
    q.request("push");
    q.request("push");
    expect(q.snapshot()).toEqual(["push"]);
    expect(q.active()).toBe("push");
  });

  it("releasing a non-active id just dequeues it", () => {
    const q = createOverlayQueue(OVERLAY_PRIORITIES);
    q.request("social");
    q.request("popup");
    q.release("social");
    expect(q.active()).toBe("popup");
    expect(q.snapshot()).toEqual(["popup"]);
    // Releasing an id that never asked is a no-op.
    q.release("install");
    expect(q.active()).toBe("popup");
  });

  it("unknown ids sort below every known priority", () => {
    const q = createOverlayQueue(OVERLAY_PRIORITIES);
    q.request("mystery");
    q.request("social");
    expect(q.active()).toBe("social");
  });

  it("priority ladder matches the brief: popup 40 > install 30 > push 20 > social 10", () => {
    expect(OVERLAY_PRIORITIES).toEqual({
      popup: 40,
      install: 30,
      push: 20,
      social: 10,
    });
  });
});

describe("bottom lift max computation (ED9)", () => {
  it("is the max of nav and buy-bar lifts", () => {
    expect(computeBottomLiftPx(64, 0)).toBe(64);
    expect(computeBottomLiftPx(64, 72)).toBe(72);
    expect(computeBottomLiftPx(80, 72)).toBe(80);
    expect(computeBottomLiftPx(0, 0)).toBe(0);
  });

  it("treats negative / non-finite inputs as no lift", () => {
    expect(computeBottomLiftPx(-5, Number.NaN)).toBe(0);
    expect(computeBottomLiftPx(Number.POSITIVE_INFINITY, 10)).toBe(10);
  });
});
