/**
 * IN10b: opt-in masking for internal notes.
 *
 * An agent writing an internal note may paste a customer's
 * bKash/Nagad transaction id, card number or phone number. When
 * the agent ticks "mask sensitive info", the note is stored with
 * those identifiers masked — the note keeps its meaning (who,
 * what, how much is untouched: amounts and order numbers are NOT
 * identifiers of this shape) while the raw secrets do not sit in
 * every note reader's screen forever.
 *
 * Deliberately conservative and PURE (unit-tested):
 *  - Bangladeshi mobile numbers (01[3-9]xxxxxxxx, optional +880 /
 *    880 prefix): first 5 digits + *** + last 3.
 *  - Long digit runs of 13–19 digits (card-like): all but the
 *    last 4 masked.
 *  - Alphanumeric tokens of 10–24 chars containing BOTH letters
 *    and digits (the shape of bKash/Nagad TrxIDs): first 3 +
 *    *** + last 2.
 * Anything else is returned byte-identical. Masking is one-way:
 * the original text is never stored anywhere when masking is on.
 */
export function maskSensitiveText(text: string): string {
  let out = String(text ?? "");
  // Card-like long digit runs first (a phone is 11 digits, below
  // this floor, so the two rules can never fight).
  out = out.replace(/\d{13,19}/g, (m) => `${"*".repeat(Math.max(0, m.length - 4))}${m.slice(-4)}`);
  // Bangladeshi mobile numbers, with or without the country code.
  out = out.replace(/(\+?880|0)(1[3-9]\d{8})/g, (m) => `${m.slice(0, 5)}***${m.slice(-3)}`);
  // Transaction-id shaped tokens: 10–24 alphanumerics with at
  // least one letter AND one digit. The lookaheads keep plain
  // words ("delivery", "confirmed") and plain numbers (amounts,
  // order ids) untouched.
  out = out.replace(/\b(?=[A-Za-z0-9]{10,24}\b)(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{10,24}\b/g,
    (m) => `${m.slice(0, 3)}***${m.slice(-2)}`);
  return out;
}
