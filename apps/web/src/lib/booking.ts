// NF4 (FB2) — Service & Appointment booking page helpers.
// Pure logic (labels, slot/time formatting, grouping, payload
// builders) + the thin API wrappers the dashboard and public
// pages share — same split as lib/live-commerce.ts: the pages
// own fetching/state, everything testable lives here.
import type { UiLocale } from "@repo/contracts";
import { apiFetch, API_URL } from "./api";
import { crmBn, crmEn } from "./i18n/crm";
import { interpolate } from "./i18n/lookup";

/** crm dictionary for the given UI locale (bn is the default). */
const D = (locale?: string) => (locale === "en" ? crmEn : crmBn);

// ---------- Types (mirror booking.service pub* shapes) ----------

export interface ServiceOfferingView {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceMinor: string; // BigInt-safe string
  bufferMinutes: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceStaffView {
  id: string;
  organizationId: string;
  membershipId: string;
  displayName: string | null;
  memberName: string | null;
  memberEmail: string | null;
  active: boolean;
}

export interface AvailabilityRow {
  weekday: number; // 0 = Sunday … 6 = Saturday (JS convention)
  startMinute: number;
  endMinute: number;
}

export interface ServiceBookingView {
  id: string;
  organizationId: string;
  serviceId: string;
  staffId: string;
  customerId: string | null;
  guestName: string;
  guestPhone: string;
  startAt: string;
  endAt: string;
  status: string; // pending | confirmed | cancelled | completed | no_show
  statusLabel: string;
  source: string; // storefront | dashboard
  depositRequiredMinor: string;
  depositState: string; // not_required | unpaid_manual | paid_manual
  depositLabel: string;
  reminderSentAt: string | null;
  reminderStatus: string | null;
  note: string | null;
  serviceName?: string | null;
  staffName?: string | null;
}

export interface SlotsResponse {
  serviceId: string;
  staffId: string;
  date: string;
  timezone: string;
  slots: string[]; // ISO instants
}

export interface PublicServiceList {
  orgSlug: string;
  orgName: string;
  /** MB4 (CD-3): shop storefront locale from the API (bn default). */
  locale?: string;
  services: ServiceOfferingView[];
}

export interface PublicStaffList {
  orgSlug: string;
  staff: Array<{ id: string; name: string }>;
}

// ---------- Labels ----------

const STATUS_CLS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  confirmed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-rose-100 text-rose-700",
  completed: "bg-sky-100 text-sky-700",
  no_show: "bg-slate-200 text-slate-600",
};

const STATUS_KEY = {
  pending: "zzBookStatusPending",
  confirmed: "zzBookStatusConfirmed",
  cancelled: "zzBookStatusCancelled",
  completed: "zzBookStatusCompleted",
  no_show: "zzBookStatusNoShow",
} as const;

/** Status chips for the given UI locale (bn default). */
export function bookingStatusChips(locale: UiLocale = "bn"): Record<string, { label: string; cls: string }> {
  const d = D(locale);
  return Object.fromEntries(
    Object.entries(STATUS_KEY).map(([k, key]) => [k, { label: d[key], cls: STATUS_CLS[k] }]),
  );
}

export const BOOKING_STATUS_CHIP: Record<string, { label: string; cls: string }> = bookingStatusChips("bn");

export function bookingStatusChip(status: string, locale: UiLocale = "bn"): { label: string; cls: string } {
  return bookingStatusChips(locale)[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
}

const DEPOSIT_KEY = {
  not_required: "zzBookDepositNotRequired",
  unpaid_manual: "zzBookDepositUnpaid",
  paid_manual: "zzBookDepositPaid",
} as const;

/** Deposit state labels for the given UI locale (bn default). */
export function depositStateLabels(locale: UiLocale = "bn"): Record<string, string> {
  const d = D(locale);
  return Object.fromEntries(Object.entries(DEPOSIT_KEY).map(([k, key]) => [k, d[key]]));
}

export const DEPOSIT_STATE_LABELS: Record<string, string> = depositStateLabels("bn");

export function depositStateLabel(state: string, locale: UiLocale = "bn"): string {
  return depositStateLabels(locale)[state] ?? state;
}

const WEEKDAY_KEY: Record<number, keyof typeof crmBn> = {
  6: "zzBookWeekdaySat",
  0: "zzBookWeekdaySun",
  1: "zzBookWeekdayMon",
  2: "zzBookWeekdayTue",
  3: "zzBookWeekdayWed",
  4: "zzBookWeekdayThu",
  5: "zzBookWeekdayFri",
};

/** Weekday rows in DISPLAY order (Saturday first, the BD week),
 * each carrying its JS weekday number (0 = Sunday … 6 = Saturday),
 * labelled for the given UI locale (bn default). */
export function weekdayRows(locale: UiLocale = "bn"): ReadonlyArray<{ weekday: number; label: string }> {
  const d = D(locale);
  return [6, 0, 1, 2, 3, 4, 5].map((weekday) => ({ weekday, label: d[WEEKDAY_KEY[weekday]] }));
}

export const WEEKDAY_ROWS: ReadonlyArray<{ weekday: number; label: string }> = weekdayRows("bn");

export function weekdayLabel(weekday: number, locale: UiLocale = "bn"): string {
  return weekdayRows(locale).find((r) => r.weekday === weekday)?.label ?? interpolate(D(locale).zzBookDayFallback, { n: weekday });
}

// ---------- Time helpers ----------

/** 600 → "10:00" (minutes from midnight → HH:mm). */
export function minutesToTime(minutes: number): string {
  const m = Math.max(0, Math.min(1440, Math.trunc(minutes)));
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** "10:30" → 630; anything malformed → null. */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh > 24 || mm > 59 || (hh === 24 && mm !== 0)) return null;
  return hh * 60 + mm;
}

/** Slot button label: the slot instant's HH:mm in the given zone. */
export function slotTimeLabel(iso: string, timezone = "Asia/Dhaka"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, hourCycle: "h23", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

/** "HH:mm" of an ISO instant in the given zone (form prefill). */
export function isoToTimeLabel(iso: string, timezone = "Asia/Dhaka"): string {
  return slotTimeLabel(iso, timezone);
}

/** Today (or an offset day) as YYYY-MM-DD in the given zone. */
export function ymdInZone(timezone = "Asia/Dhaka", offsetDays = 0, now = new Date()): string {
  const target = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(target);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/** UTC ISO bounds [from, to] of one org-local calendar date —
 * the bookings list filter for a picked day. */
export function dayRangeUtcIso(date: string, timezone = "Asia/Dhaka"): { from: string; to: string } {
  const zonedStart = (ymd: string, minutes: number): Date => {
    const [y, mo, d] = ymd.split("-").map(Number);
    const guess = Date.UTC(y, (mo ?? 1) - 1, d ?? 1) + minutes * 60_000;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return new Date(guess - (asUtc - Math.floor(guess / 1000) * 1000));
  };
  return {
    from: zonedStart(date, 0).toISOString(),
    // Inclusive end for the API's lte filter: 1ms before the
    // next local midnight, so a midnight booking shows once.
    to: new Date(zonedStart(date, 1440).getTime() - 1).toISOString(),
  };
}

// ---------- Availability editing ----------

/** Client mirror of the server rule so the editor can complain
 * before the round-trip: returns a Bengali error or null. */
export function availabilityError(rows: AvailabilityRow[], locale: UiLocale = "bn"): string | null {
  const d = D(locale);
  for (const r of rows) {
    if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) return d.zzBookAvailBadWeekday;
    if (!(r.startMinute >= 0) || !(r.endMinute <= 1440) || r.startMinute >= r.endMinute) {
      return d.zzBookAvailBadRange;
    }
  }
  const sorted = [...rows].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].weekday === sorted[i - 1].weekday && sorted[i].startMinute < sorted[i - 1].endMinute) {
      return d.zzBookAvailOverlap;
    }
  }
  return null;
}

/** Editor state (one row per weekday, enabled flag) → API rows. */
export function editorRowsToApi(
  editor: Array<{ weekday: number; enabled: boolean; start: string; end: string }>,
): AvailabilityRow[] {
  const rows: AvailabilityRow[] = [];
  for (const e of editor) {
    if (!e.enabled) continue;
    const startMinute = timeToMinutes(e.start);
    const endMinute = timeToMinutes(e.end);
    if (startMinute === null || endMinute === null) continue;
    rows.push({ weekday: e.weekday, startMinute, endMinute });
  }
  return rows;
}

/** API rows → editor state (first window per weekday wins in the
 * simple editor; additional windows stay visible as a note). */
export function apiRowsToEditor(rows: AvailabilityRow[]): Array<{
  weekday: number; enabled: boolean; start: string; end: string; extraWindows: number;
}> {
  return WEEKDAY_ROWS.map(({ weekday }) => {
    const day = rows.filter((r) => r.weekday === weekday).sort((a, b) => a.startMinute - b.startMinute);
    if (!day.length) return { weekday, enabled: false, start: "10:00", end: "18:00", extraWindows: 0 };
    return {
      weekday, enabled: true,
      start: minutesToTime(day[0].startMinute), end: minutesToTime(day[0].endMinute),
      extraWindows: day.length - 1,
    };
  });
}

// ---------- Booking list helpers ----------

export interface StaffBookingGroup {
  staffId: string;
  staffName: string;
  bookings: ServiceBookingView[];
}

/** Group a day's bookings by staff, each group time-ordered. */
export function groupBookingsByStaff(bookings: ServiceBookingView[], locale: UiLocale = "bn"): StaffBookingGroup[] {
  const groups = new Map<string, StaffBookingGroup>();
  for (const b of [...bookings].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const key = b.staffId;
    if (!groups.has(key)) {
      groups.set(key, { staffId: key, staffName: b.staffName ?? D(locale).zzBookStaffFallback, bookings: [] });
    }
    groups.get(key)!.bookings.push(b);
  }
  return [...groups.values()];
}

/** Which status action buttons a booking shows (mirrors the
 * server transition table — the server still has the last word). */
export function bookingActions(status: string, locale: UiLocale = "bn"): Array<{ key: string; label: string }> {
  const d = D(locale);
  if (status === "pending") {
    return [
      { key: "confirm", label: d.zzBookActionConfirm },
      { key: "cancel", label: d.zzBookActionCancel },
    ];
  }
  if (status === "confirmed") {
    return [
      { key: "complete", label: d.zzBookActionComplete },
      { key: "no-show", label: d.zzBookActionNoShow },
      { key: "cancel", label: d.zzBookActionCancel },
    ];
  }
  return [];
}

// ---------- Dashboard API ----------

const base = (orgId: string) => `/organizations/${orgId}/booking`;

export function fetchServices(orgId: string) {
  return apiFetch<ServiceOfferingView[]>(`${base(orgId)}/services`);
}

export function createService(orgId: string, body: {
  name: string; description?: string | null; durationMinutes: number;
  priceMinor: string; bufferMinutes?: number;
}) {
  return apiFetch<ServiceOfferingView>(`${base(orgId)}/services`, {
    method: "POST", body: JSON.stringify(body),
  });
}

export function updateService(orgId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<ServiceOfferingView>(`${base(orgId)}/services/${id}`, {
    method: "PATCH", body: JSON.stringify(body),
  });
}

export function fetchStaff(orgId: string) {
  return apiFetch<ServiceStaffView[]>(`${base(orgId)}/staff`);
}

export function addStaff(orgId: string, membershipId: string, displayName?: string) {
  return apiFetch<ServiceStaffView>(`${base(orgId)}/staff`, {
    method: "POST", body: JSON.stringify({ membershipId, displayName: displayName || null }),
  });
}

export function setStaffActive(orgId: string, staffId: string, active: boolean) {
  return apiFetch<ServiceStaffView>(`${base(orgId)}/staff/${staffId}/active`, {
    method: "POST", body: JSON.stringify({ active }),
  });
}

export function fetchAvailability(orgId: string, staffId: string) {
  return apiFetch<{ staffId: string; rows: AvailabilityRow[] }>(`${base(orgId)}/staff/${staffId}/availability`);
}

export function saveAvailability(orgId: string, staffId: string, rows: AvailabilityRow[]) {
  return apiFetch<{ staffId: string; rows: AvailabilityRow[] }>(`${base(orgId)}/staff/${staffId}/availability`, {
    method: "PUT", body: JSON.stringify({ rows }),
  });
}

export function fetchSlots(orgId: string, serviceId: string, staffId: string, date: string) {
  const qs = new URLSearchParams({ serviceId, staffId, date });
  return apiFetch<SlotsResponse>(`${base(orgId)}/slots?${qs.toString()}`);
}

export function fetchBookings(orgId: string, filters: { from?: string; to?: string; staffId?: string; status?: string }) {
  const qs = new URLSearchParams();
  if (filters.from) qs.set("from", filters.from);
  if (filters.to) qs.set("to", filters.to);
  if (filters.staffId) qs.set("staffId", filters.staffId);
  if (filters.status) qs.set("status", filters.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<ServiceBookingView[]>(`${base(orgId)}/bookings${suffix}`);
}

export function createBooking(orgId: string, body: {
  serviceId: string; staffId: string; startAt: string;
  guestName: string; guestPhone: string; note?: string | null;
}) {
  return apiFetch<ServiceBookingView>(`${base(orgId)}/bookings`, {
    method: "POST", body: JSON.stringify(body),
  });
}

export function bookingAction(orgId: string, bookingId: string, action: string) {
  return apiFetch<ServiceBookingView>(`${base(orgId)}/bookings/${bookingId}/${action}`, { method: "POST" });
}

export function markDepositPaid(orgId: string, bookingId: string) {
  return apiFetch<ServiceBookingView>(`${base(orgId)}/bookings/${bookingId}/deposit-paid`, { method: "POST" });
}

// ---------- Public (storefront) API ----------

async function publicFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data as any)?.message ?? interpolate(crmBn.zzBookRequestFailed, { status: res.status }));
  }
  return data as T;
}

export function fetchPublicServices(orgSlug: string) {
  return publicFetch<PublicServiceList>(`/public/booking/${encodeURIComponent(orgSlug)}/services`);
}

export function fetchPublicStaff(orgSlug: string) {
  return publicFetch<PublicStaffList>(`/public/booking/${encodeURIComponent(orgSlug)}/staff`);
}

export function fetchPublicSlots(orgSlug: string, serviceId: string, staffId: string, date: string) {
  const qs = new URLSearchParams({ serviceId, staffId, date });
  return publicFetch<SlotsResponse>(`/public/booking/${encodeURIComponent(orgSlug)}/slots?${qs.toString()}`);
}

export function submitPublicBooking(orgSlug: string, body: {
  serviceId: string; staffId: string; date: string; startTime: string;
  guestName: string; guestPhone: string; note?: string | null;
}) {
  return publicFetch<ServiceBookingView>(`/public/booking/${encodeURIComponent(orgSlug)}/book`, {
    method: "POST", body: JSON.stringify(body),
  });
}
