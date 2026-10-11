import { randomBytes } from "crypto";

/**
 * CX6 — public tracking token + link helpers, shared by
 * CourierService (auto-notify + public page data) and InboxService
 * (manual shareTracking). The token format mirrors the ReportShare
 * pattern (M59): 24 random bytes, base64url. The token is the only
 * credential on the public page — knowing it is what grants access,
 * exactly like a report share link. Kept as a pure module so the
 * inbox service can use it without a module cycle (CourierModule
 * imports InboxModule, never the reverse).
 */
export function newTrackingToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Tenant web base for customer-facing links (same WEB_URL
 * convention as payments / social OAuth link building). */
export function webBaseUrl(): string {
  return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function trackingLinkFor(token: string): string {
  return `${webBaseUrl()}/t/${token}`;
}
