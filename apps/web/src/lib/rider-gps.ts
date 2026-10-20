/**
 * NF9 (FB4) — rider live-GPS shared web helpers/types.
 *
 * The SERVER is the source of truth for freshness: every fix
 * payload carries `stale` + `ageMs` computed server-side
 * against the 5-minute threshold. These helpers only FORMAT
 * what the server returned — the web never re-decides whether
 * a fix counts as live, and never invents a location.
 */

import type { UiLocale } from "./i18n/dict";

export const RIDER_FIX_STALE_THRESHOLD_MS = 5 * 60 * 1000;

export interface RiderFixView {
  lat: number;
  lng: number;
  accuracy: number | null;
  recordedAt: string;
  ageMs: number | null;
  stale: boolean;
  mapsUrl: string;
}

export interface RiderShareStateView {
  hasLink: boolean;
  sharingEnabled: boolean;
  sharing: boolean;
  revoked: boolean;
  expiresAt: string | null;
}

export interface FleetEntryView {
  assignmentId: string;
  assignmentStatus: string;
  assignedAt: string;
  riderId: string;
  riderName: string | null;
  riderPhone: string | null;
  orderId: string;
  orderNumber: string | null;
  orderStatus: string | null;
  sharing: RiderShareStateView;
  location: RiderFixView | null;
}

export interface FleetRiderView {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  sharing: RiderShareStateView;
}

export interface FleetView {
  entries: FleetEntryView[];
  riders: FleetRiderView[];
}

export interface CustomerRiderLocationView extends RiderFixView {
  riderName: string | null;
}

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

export function bnDigits(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/**
 * Human age label for a fix, from the SERVER-provided ageMs.
 * MB6: optional locale (default "bn") — the bn path is
 * BYTE-IDENTICAL to the original bn-only rendering (the
 * bn-by-design rider/[token] page keeps calling it with no
 * locale); "en" renders the equivalent English with Latin digits.
 */
export function fixAgeLabel(ageMs: number | null | undefined, locale: UiLocale = "bn"): string {
  if (locale === "en") {
    if (ageMs == null || !Number.isFinite(ageMs)) return "Time unavailable";
    const seconds = Math.floor(ageMs / 1000);
    if (seconds < 45) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }
  if (ageMs == null || !Number.isFinite(ageMs)) return "সময় পাওয়া যায়নি";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 45) return "সবেমাত্র";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${bnDigits(minutes)} মিনিট আগে`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${bnDigits(hours)} ঘণ্টা আগে`;
  const days = Math.floor(hours / 24);
  return `${bnDigits(days)} দিন আগে`;
}

/** Coordinates line exactly as stored — no rounding theatre. */
export function coordsLabel(fix: { lat: number; lng: number }): string {
  return `${fix.lat}, ${fix.lng}`;
}
