"use client";
import { useEffect } from "react";
import { captureFirstTouchAttribution } from "@/lib/shop-tracking";

/**
 * AB7 (AX19) — shop surfaces are server components, so the
 * first-touch utm/click capture from window.location.search
 * rides this tiny client child (same pattern as
 * AffiliateRefCapture). It writes into the tracking client's
 * own storage (`tp_sess`, sessionStorage) only when no session
 * payload exists yet — first-touch wins. Renders nothing.
 */
export function AttributionCapture() {
  useEffect(() => {
    captureFirstTouchAttribution();
  }, []);
  return null;
}
