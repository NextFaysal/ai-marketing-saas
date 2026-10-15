/**
 * IN1: pure helpers for message search + advanced filters + saved
 * views in the inbox page.
 *
 * Two filter shapes exist on purpose:
 * - the UI shape (what the page state holds): amounts are TAKA
 *   strings as typed by the agent ("1500"), dates are `yyyy-mm-dd`
 *   (or full ISO) strings, everything optional.
 * - the API/saved shape (what listConversations understands and
 *   what a saved view stores): amounts are MINOR units (paisa)
 *   numbers, dates are ISO strings — exactly the keys the API's
 *   sanitizeSavedViewFilters whitelists.
 * These helpers convert between the two and split a server search
 * snippet for highlighting. No fetching, no state — unit-tested.
 */

export interface InboxUiFilters {
  q: string;
  channel: string;
  status: string;
  assignee: string;
  tag: string;
  unreadOnly: boolean;
  spamOnly: boolean;
  sort: string;
  // IN1b advanced (UI shape)
  dateFrom: string;
  dateTo: string;
  amountMin: string; // taka, as typed
  amountMax: string; // taka, as typed
  intent: string;
  sentiment: string;
}

export const EMPTY_UI_FILTERS: InboxUiFilters = {
  q: "", channel: "", status: "", assignee: "", tag: "", unreadOnly: false,
  spamOnly: false, sort: "recent",
  dateFrom: "", dateTo: "", amountMin: "", amountMax: "", intent: "", sentiment: "",
};

const takaToMinor = (v: string): number | undefined => {
  const n = Number(String(v ?? "").trim());
  return String(v ?? "").trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};
const minorToTaka = (v: unknown): string => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? String(Math.round(n) / 100) : "";
};
// A date-only value means the agent's whole day: `dateTo` at
// 23:59:59.999 so "today" really includes today.
const dayEndIso = (v: string): string | undefined => {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T23:59:59.999`).toISOString();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};
const dayStartIso = (v: string): string | undefined => {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000` : s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};
// Saved dates are ISO; the date inputs want yyyy-mm-dd back.
const isoToDay = (v: unknown): string => {
  if (typeof v !== "string" || !v.trim()) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

/** UI filters (+ the active smart folder) → query params for
 * GET /inbox/conversations. Only non-default values are sent. */
export function uiFiltersToParams(f: InboxUiFilters, folder: string): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.channel) p.set("channel", f.channel);
  if (f.status) p.set("status", f.status);
  if (f.assignee) p.set("assignee", f.assignee);
  if (f.tag) p.set("tag", f.tag);
  if (f.unreadOnly) p.set("unread", "1");
  if (f.spamOnly) p.set("spam", "1");
  if (f.sort !== "recent") p.set("sort", f.sort);
  if (folder) p.set("folder", folder);
  const from = dayStartIso(f.dateFrom); if (from) p.set("dateFrom", from);
  const to = dayEndIso(f.dateTo); if (to) p.set("dateTo", to);
  const min = takaToMinor(f.amountMin); if (min !== undefined) p.set("amountMin", String(min));
  const max = takaToMinor(f.amountMax); if (max !== undefined) p.set("amountMax", String(max));
  if (f.intent) p.set("intent", f.intent);
  if (f.sentiment) p.set("sentiment", f.sentiment);
  return p;
}

/** UI filters (+ folder) → the API/saved shape stored in a saved
 * view. Mirrors the server whitelist; unknown/empty keys omitted. */
export function uiFiltersToSaved(f: InboxUiFilters, folder: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.q.trim()) out.q = f.q.trim();
  if (f.channel) out.channel = f.channel;
  if (f.status) out.status = f.status;
  if (f.assignee) out.assignee = f.assignee;
  if (f.tag.trim()) out.tag = f.tag.trim();
  if (f.unreadOnly) out.unreadOnly = true;
  if (f.spamOnly) out.spamOnly = true;
  if (f.sort === "unread") out.sort = "unread";
  if (folder) out.folder = folder;
  const from = dayStartIso(f.dateFrom); if (from) out.dateFrom = from;
  const to = dayEndIso(f.dateTo); if (to) out.dateTo = to;
  const min = takaToMinor(f.amountMin); if (min !== undefined) out.amountMin = min;
  const max = takaToMinor(f.amountMax); if (max !== undefined) out.amountMax = max;
  if (f.intent) out.intent = f.intent;
  if (f.sentiment) out.sentiment = f.sentiment;
  return out;
}

/** A saved view's stored filters → UI filters + folder, merged
 * over the empty defaults so a partial/old view can never break
 * the page state shape. */
export function savedToUiFilters(saved: Record<string, unknown> | null | undefined): { filters: InboxUiFilters; folder: string } {
  const s = (saved && typeof saved === "object") ? saved : {};
  const str = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : "");
  return {
    filters: {
      ...EMPTY_UI_FILTERS,
      q: str("q"), channel: str("channel"), status: str("status"),
      assignee: str("assignee"), tag: str("tag"),
      unreadOnly: s.unreadOnly === true, spamOnly: s.spamOnly === true,
      sort: s.sort === "unread" ? "unread" : "recent",
      dateFrom: isoToDay(s.dateFrom), dateTo: isoToDay(s.dateTo),
      amountMin: minorToTaka(s.amountMin), amountMax: minorToTaka(s.amountMax),
      intent: str("intent"), sentiment: str("sentiment"),
    },
    folder: ["sla", "vip", "handover", "snoozed"].includes(str("folder")) ? str("folder") : "",
  };
}

/** True when any IN1b advanced filter is active (drives the
 * panel's "active" styling + the clear button). */
export function hasAdvancedFilters(f: InboxUiFilters): boolean {
  return Boolean(f.dateFrom || f.dateTo || f.amountMin || f.amountMax || f.intent || f.sentiment);
}

/** Split a server snippet at the match offsets for <mark>
 * highlighting. Offsets that don't fit degrade to no highlight —
 * the snippet text itself is never altered. */
export function splitSnippet(snippet: string, matchStart: number, matchLength: number): { before: string; match: string; after: string } {
  const s = String(snippet ?? "");
  if (!Number.isFinite(matchStart) || !Number.isFinite(matchLength) || matchStart < 0 || matchLength <= 0 || matchStart + matchLength > s.length) {
    return { before: s, match: "", after: "" };
  }
  return { before: s.slice(0, matchStart), match: s.slice(matchStart, matchStart + matchLength), after: s.slice(matchStart + matchLength) };
}
