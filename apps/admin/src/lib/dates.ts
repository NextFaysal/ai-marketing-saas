// Shared date/time formatting for the Admin Console (AN11).
//
// Every admin page used to hardcode its own
// `new Date(v).toLocaleString("bn-BD")` (or the Date/Time variants).
// This is the ONE helper they all route through now. It deliberately
// calls the exact same Intl-backed methods with the exact same
// locale/options each call site used before, so what any page
// displays is byte-identical to before — only the duplication is
// gone. `kind` selects which of the three original methods runs;
// `options` is passed through untouched (one call site — the
// overview's "today" line — formats with weekday/day/month/year).
export function fmtDateTime(
  value: string | number | Date,
  kind: "datetime" | "date" | "time" = "datetime",
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (kind === "date") return d.toLocaleDateString("bn-BD", options);
  if (kind === "time") return d.toLocaleTimeString("bn-BD", options);
  return d.toLocaleString("bn-BD", options);
}
