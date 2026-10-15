"use client";
import { useEffect } from "react";
import { captureAffiliateRef } from "@/lib/affiliate-ref";

/**
 * EC32 — shop home is a server component, so the ?ref capture
 * (a location + localStorage read) rides this tiny client
 * child. Renders nothing.
 */
export function AffiliateRefCapture({ orgSlug }: { orgSlug: string }) {
  useEffect(() => {
    captureAffiliateRef(orgSlug);
  }, [orgSlug]);
  return null;
}
