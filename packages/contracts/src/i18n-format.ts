// ML2 — locale-aware formatting (Multi-Language program, MB1).
//
// Pure, dependency-free wrappers over Intl so every surface (web,
// admin, API-generated documents/notifications) formats numbers,
// money, dates, times and relative times EXACTLY the same way:
//
//   BN ("bn-BD"): Bengali digits (০-৯), lakh grouping (১,০০,০০০),
//                 money ৳১,৫০০, date ১৯ অক্টোবর, ২০২৬ (Intl inserts
//                 the comma), time ২:৩০ PM (Node full-icu renders the
//                 bn-BD dayPeriod in Latin "AM/PM" — pinned in tests).
//   EN ("en-IN"): Latin digits, Indian grouping (1,00,000),
//                 money ৳1,500, date 19 October 2026 (day-first long —
//                 verified against en-IN in Node full-icu, so no
//                 en-GB fallback is needed), time 2:30 pm.
//
// Money is MAJOR units (taka) in fmtMoney and MINOR units (paisa,
// 100 = ৳1) in fmtMoneyMinor. The ৳ symbol is prefixed with NO space
// in both locales. Negative amounts render as -৳1,500.

import {
  intlLocaleOf,
  normalizeUiLocale,
  type UiLocale,
} from "./i18n";

function intlOf(locale: UiLocale): string {
  return intlLocaleOf(normalizeUiLocale(locale));
}

function toDate(date: Date | string | number): Date {
  return date instanceof Date ? date : new Date(date);
}

// ---------- Numbers ----------

export function fmtNumber(
  locale: UiLocale,
  value: number,
  opts?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(intlOf(locale), opts).format(value);
}

// ---------- Money ----------

export interface FmtMoneyOptions {
  /** ISO currency code; only "BDT" (the default) maps to the ৳ symbol. */
  currency?: string;
  /** Set false to render the bare grouped number with no symbol. */
  showSymbol?: boolean;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

function moneyPrefix(opts?: FmtMoneyOptions): string {
  if (opts?.showSymbol === false) return "";
  if (opts?.currency && opts.currency !== "BDT") return `${opts.currency} `;
  return "৳";
}

/** Format a MAJOR-unit amount (taka). Fraction digits appear only
 * when the amount is non-integer: minimum 0 / maximum 2 by default. */
export function fmtMoney(
  locale: UiLocale,
  amountMajor: number,
  opts?: FmtMoneyOptions,
): string {
  const formatted = new Intl.NumberFormat(intlOf(locale), {
    minimumFractionDigits: opts?.minimumFractionDigits ?? 0,
    maximumFractionDigits: opts?.maximumFractionDigits ?? 2,
  }).format(Math.abs(amountMajor));
  return `${amountMajor < 0 ? "-" : ""}${moneyPrefix(opts)}${formatted}`;
}

/** Localise a single ASCII digit through the locale's numbering system. */
function localiseDigits(intlLocale: string, digits: string): string {
  const fmt = new Intl.NumberFormat(intlLocale, { useGrouping: false });
  return digits.replace(/\d/g, (d) => fmt.format(Number(d)));
}

function decimalSeparator(intlLocale: string): string {
  const parts = new Intl.NumberFormat(intlLocale).formatToParts(1.1);
  return parts.find((p) => p.type === "decimal")?.value ?? ".";
}

/**
 * Format MINOR units (paisa, 100 = ৳1) — the storage format used
 * across the platform (see parseMoneyToMinor / formatMinor in
 * index.ts). Bigint-safe: the taka part is split with /100 and the
 * paisa remainder with %100 as bigints, and the taka part is passed
 * to Intl as a bigint so no precision is lost. Two fraction digits
 * are kept ONLY when the paisa remainder is non-zero.
 */
export function fmtMoneyMinor(
  locale: UiLocale,
  minor: bigint | number,
  opts?: FmtMoneyOptions,
): string {
  const intlLocale = intlOf(locale);
  const value = typeof minor === "bigint" ? minor : BigInt(Math.round(minor));
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100n;
  const frac = abs % 100n;

  let formatted: string;
  if (frac === 0n) {
    formatted = new Intl.NumberFormat(intlLocale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(whole);
  } else {
    const wholeFormatted = new Intl.NumberFormat(intlLocale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(whole);
    const fracFormatted = localiseDigits(
      intlLocale,
      String(frac).padStart(2, "0"),
    );
    formatted = `${wholeFormatted}${decimalSeparator(intlLocale)}${fracFormatted}`;
  }
  return `${negative ? "-" : ""}${moneyPrefix(opts)}${formatted}`;
}

// ---------- Dates & times ----------

/**
 * Long, day-first date:
 *   bn → "১৯ অক্টোবর, ২০২৬" (Intl bn-BD long form, comma included)
 *   en → "19 October 2026"
 * With `weekday: true` the long weekday is prepended by Intl
 * ("সোমবার, ১৯ অক্টোবর, ২০২৬" / "Monday, 19 October 2026").
 */
export function fmtDate(
  locale: UiLocale,
  date: Date | string | number,
  opts?: { weekday?: boolean },
): string {
  return new Intl.DateTimeFormat(intlOf(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(opts?.weekday ? { weekday: "long" as const } : {}),
  }).format(toDate(date));
}

/** 12-hour clock: bn → "২:৩০ PM", en → "2:30 pm" (Intl casing). */
export function fmtTime(
  locale: UiLocale,
  date: Date | string | number,
): string {
  return new Intl.DateTimeFormat(intlOf(locale), {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(toDate(date));
}

/** Long date + 12-hour time: en → "19 October 2026 at 2:30 pm". */
export function fmtDateTime(
  locale: UiLocale,
  date: Date | string | number,
  opts?: { weekday?: boolean },
): string {
  return new Intl.DateTimeFormat(intlOf(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(opts?.weekday ? { weekday: "long" as const } : {}),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(toDate(date));
}

// ---------- Relative time ----------

const RELATIVE_UNITS: ReadonlyArray<{
  unit: Intl.RelativeTimeFormatUnit;
  ms: number;
}> = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
  { unit: "second", ms: 1000 },
];

/**
 * Relative time via Intl.RelativeTimeFormat with numeric:"auto"
 * (so -1 day renders as "yesterday" / "গতকাল"), choosing the largest
 * sensible unit from the diff against `now`.
 */
export function fmtRelative(
  locale: UiLocale,
  date: Date | string | number,
  now: Date = new Date(),
): string {
  const diffMs = toDate(date).getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const picked =
    RELATIVE_UNITS.find((u) => absMs >= u.ms) ??
    RELATIVE_UNITS[RELATIVE_UNITS.length - 1];
  const value = Math.round(diffMs / picked.ms);
  return new Intl.RelativeTimeFormat(intlOf(locale), {
    numeric: "auto",
  }).format(value, picked.unit);
}
