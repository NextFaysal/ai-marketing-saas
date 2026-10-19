// Shared date/time formatting for the Admin Console (AN11 → ML7).
//
// Every admin page routes through this ONE helper. It delegates to
// the shared @repo/contracts formatters with the ACTIVE admin locale
// (threaded in from the AdminLocale context by each call site), so
// bn renders Bengali digits / বাংলা dates and en renders the en-IN
// long forms — the pinned contracts formats. No local Intl usage
// remains. `kind` selects date / time / datetime; the only option is
// `weekday` (the overview's "today" line), which maps to contracts'
// fmtDate/fmtDateTime `{ weekday: true }`.
import { fmtDate, fmtDateTime as fmtDateTimeC, fmtTime, type UiLocale } from "@repo/contracts";

export function fmtDateTime(
  locale: UiLocale,
  value: string | number | Date,
  kind: "datetime" | "date" | "time" = "datetime",
  options?: { weekday?: boolean },
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (kind === "date") return fmtDate(locale, d, options);
  if (kind === "time") return fmtTime(locale, d);
  return fmtDateTimeC(locale, d, options);
}
