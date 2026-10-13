import { NAV_ITEMS } from "./nav";

/**
 * Global Assistant helpers (pure, unit-tested).
 *
 * Page-awareness is deliberately narrow: the only thing that leaves
 * the browser is a dashboard *section path* ("/dashboard/orders") —
 * never free text, never a full URL, never record ids. The API
 * re-validates the same shape and uses it only as a compose-time
 * interpretation hint; it is never stored on the message.
 */

const SECTION_RE = /^\/dashboard(\/[a-z0-9-]+)?$/;

/** Reduce any dashboard pathname to its section path, or undefined
 *  when the path is not a plain dashboard section. */
export function pageContextFor(pathname: string | null | undefined): string | undefined {
  if (!pathname) return undefined;
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0 || parts[0] !== "dashboard") return undefined;
  const section = parts.length >= 2 ? `/dashboard/${parts[1].toLowerCase()}` : "/dashboard";
  return SECTION_RE.test(section) ? section : undefined;
}

/** Human label for the current section, from the nav registry
 *  (longest href prefix wins); falls back to "Dashboard". */
export function pageLabelFor(pathname: string | null | undefined): string {
  if (!pathname) return "Dashboard";
  let best: (typeof NAV_ITEMS)[number] | undefined;
  for (const item of NAV_ITEMS) {
    const href = item.href as string;
    // The root item matches exactly only — otherwise every unknown
    // dashboard path would be labelled "Overview" (same rule the
    // dashboard layout uses for its current-page title).
    const hit = href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    if (hit && (!best || href.length > (best.href as string).length)) best = item;
  }
  return best?.label ?? "Dashboard";
}

const DEFAULT_SUGGESTIONS = [
  "গত ৭ দিনে বিক্রি কেমন ছিল?",
  "আমার সবচেয়ে ভালো ক্যাম্পেইন কোনগুলো?",
  "কোনো অস্বাভাবিক কিছু ঘটেছে কি?",
];

const SECTION_SUGGESTIONS: Record<string, string[]> = {
  "/dashboard/orders": [
    "কোন অর্ডারগুলোর ফলো-আপ দরকার?",
    "গত ৭ দিনে বিক্রি কেমন ছিল?",
    "কুরিয়ারদের পারফরম্যান্স কেমন?",
  ],
  "/dashboard/campaigns": [
    "আমার সবচেয়ে ভালো ক্যাম্পেইন কোনগুলো?",
    "কোন পণ্যে সবচেয়ে বেশি লাভ হয়?",
    "গত ৭ দিনে বিক্রি কেমন ছিল?",
  ],
  "/dashboard/campaign-builder": [
    "আমার সবচেয়ে ভালো ক্যাম্পেইন কোনগুলো?",
    "কোন পণ্যে সবচেয়ে বেশি লাভ হয়?",
    "কাস্টমার সেগমেন্টগুলো দেখাও",
  ],
  "/dashboard/inbox": [
    "কোন অর্ডারগুলোর ফলো-আপ দরকার?",
    "কাস্টমার সেগমেন্টগুলো দেখাও",
    "কোনো অস্বাভাবিক কিছু ঘটেছে কি?",
  ],
  "/dashboard/products": [
    "স্টকের অবস্থা কেমন?",
    "কোন পণ্যে সবচেয়ে বেশি লাভ হয়?",
    "Which products have the best margin?",
  ],
  "/dashboard/customers": [
    "কাস্টমার সেগমেন্টগুলো দেখাও",
    "কোন অর্ডারগুলোর ফলো-আপ দরকার?",
    "গত ৭ দিনে বিক্রি কেমন ছিল?",
  ],
  "/dashboard/analytics": [
    "গত ৭ দিনে বিক্রি কেমন ছিল?",
    "কুরিয়ারদের পারফরম্যান্স কেমন?",
    "কোনো অস্বাভাবিক কিছু ঘটেছে কি?",
  ],
  "/dashboard/profit": [
    "কোন পণ্যে সবচেয়ে বেশি লাভ হয়?",
    "আমার সবচেয়ে ভালো ক্যাম্পেইন কোনগুলো?",
    "Which products have the best margin?",
  ],
};

/** Starter suggestions for the panel: section-specific when the
 *  section has a curated set, otherwise the proven defaults (the
 *  same texts the AI page offers — every one maps to a real tool). */
export function suggestionsFor(pathname: string | null | undefined): string[] {
  const ctx = pageContextFor(pathname);
  return (ctx && SECTION_SUGGESTIONS[ctx]) || DEFAULT_SUGGESTIONS;
}

/**
 * GV2 (G5) FAB badge label. The proposals list endpoint returns at
 * most 50 rows, so a count of 50 can only be displayed honestly as
 * "50+". Zero (or a failed fetch, handled by the caller as 0/null)
 * hides the badge.
 */
export function pendingBadgeLabel(count: number | null | undefined): string | null {
  if (!count || count <= 0) return null;
  return count >= 50 ? "50+" : String(count);
}

export interface BriefingLike {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  readAt?: string | null;
  createdAt: string;
}

/**
 * GV2 (G5) briefing selection: the latest `ai_briefing` notification
 * created on the user's *local* today. Yesterday's briefing, other
 * notification types, and unparseable rows never qualify — when
 * nothing qualifies the panel shows no card at all.
 */
export function pickTodaysBriefing<T extends BriefingLike>(items: readonly T[] | null | undefined, now: Date = new Date()): T | null {
  if (!items) return null;
  const sameLocalDay = (d: Date) => d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  let best: T | null = null;
  let bestTime = -Infinity;
  for (const n of items) {
    if (n.type !== "ai_briefing") continue;
    const t = new Date(n.createdAt).getTime();
    if (!Number.isFinite(t) || !sameLocalDay(new Date(t))) continue;
    if (t > bestTime) { best = n; bestTime = t; }
  }
  return best;
}

/**
 * G6 select-to-ask: normalize a dashboard text selection into a
 * quote for the composer. Returns null for selections too short to
 * be a meaningful question target; caps at 500 chars with an
 * ellipsis marker. Whitespace collapses — selections spanning table
 * rows read as one line.
 */
export function selectionQuote(raw: string): string | null {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (text.length < 10) return null;
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}
