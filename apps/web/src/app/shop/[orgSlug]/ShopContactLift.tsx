"use client";
import React from "react";
import { useBottomLiftPx } from "@/lib/shop-bottom-chrome";

/**
 * ED9 — client wrapper that lifts the (server-rendered) floating
 * contact buttons above the v2 bottom nav / a page buy bar.
 *
 * Why this shape: a CSS transform on an ancestor of a `fixed`
 * element re-anchors that element to the ancestor, so the
 * buttons cannot simply be wrapped and translated. Instead this
 * wrapper is itself `fixed inset-0` (viewport-sized, z-40,
 * pointer-events-none) and ShopContactButtons' root is
 * `absolute bottom-5 right-5` inside it — absolute against a
 * fixed inset-0 box is pixel-identical to the old fixed
 * positioning. The lift is applied as a translateY on the inner
 * box; at lift 0 there is no transform at all, so rendering is
 * identical to before ED9.
 */
export function ShopContactLift({ children }: { children: React.ReactNode }) {
  const lift = useBottomLiftPx();
  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <div
        className="absolute inset-0"
        style={lift > 0 ? { transform: `translateY(-${lift}px)` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
