/**
 * EC8 staff-zone money helper: staff type TAKA in the zone form,
 * the API wants integer-minor (poisha) decimal strings.
 *
 * Conversion is pure string arithmetic — no floats — so "60.50"
 * is exactly "6050" and "0.07" is exactly "7". Invalid input
 * returns null (never a rounded guess): empty, negative, more
 * than 2 decimal places, or any non-numeric content.
 */
export function takaToMinorString(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim().replace(/,/g, "");
  if (!raw) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  const minor = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return minor.toString();
}

/** Minor string -> taka display/edit string: "6050" -> "60.50", "6000" -> "60". */
export function minorToTakaString(minor: string | number | null | undefined): string {
  if (minor === null || minor === undefined || minor === "") return "";
  let value: bigint;
  try {
    value = BigInt(String(minor).trim());
  } catch {
    return "";
  }
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const body = frac === 0n ? whole.toString() : `${whole.toString()}.${String(frac).padStart(2, "0")}`;
  return negative ? `-${body}` : body;
}

/** Minor string -> "৳60.50" display (falls back to "—"). */
export function formatMinorTaka(minor: string | number | null | undefined): string {
  if (minor === null || minor === undefined || minor === "") return "—";
  const taka = minorToTakaString(minor);
  if (!taka) return "—";
  const [whole, frac] = taka.split(".");
  const grouped = Number(whole).toLocaleString("en-IN");
  return frac ? `৳${grouped}.${frac}` : `৳${grouped}`;
}
