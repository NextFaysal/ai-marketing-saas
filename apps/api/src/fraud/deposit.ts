/**
 * AB4 (AX5a): deposit / advance-collection rules — pure
 * evaluation over the org's BusinessProfile deposit fields, the
 * sibling of evaluateCodRules (same file family, same discipline:
 * all checkout surfaces must judge a deposit identically).
 *
 * A deposit is a PAYMENT slice of the order total, never a
 * discount: the total always comes from evaluateCheckout; the
 * deposit only says how much of it is collected up front.
 *
 * Rules:
 *  - depositMode null / anything but "percent"|"fixed" → OFF.
 *  - "percent": depositPercent must be an integer 1–90 (an
 *    out-of-range config reads as OFF — never guessed);
 *    amount = floor(total × pct / 100); a 0 result is OFF for
 *    that order (there is nothing meaningful to collect).
 *  - "fixed": depositFixedMinor must be > 0; amount is capped
 *    at the order total (a fixed deposit larger than the order
 *    is just a full prepayment).
 *  - depositAppliesTo: "cod" covers COD orders only, "online"
 *    covers gateway-paid orders only, "all" covers cod + online
 *    + manual. For MANUAL orders the amount is informational —
 *    it is the advance the buyer is expected to claim through
 *    the existing manual-advance path; only gateway initiation
 *    (online kind) and COD orders get the real collection flow.
 *  - total ≤ 0 → OFF.
 */

export interface DepositProfile {
  depositMode?: string | null;
  depositPercent?: number | string | null;
  depositFixedMinor?: bigint | string | number | null;
  depositAppliesTo?: string | null;
  depositNote?: string | null;
}

export type DepositKind = "cod" | "online" | "manual";

export interface DepositQuote {
  active: boolean;
  mode: "percent" | "fixed" | null;
  amountMinor: bigint;
  note: string | null;
}

export const DEPOSIT_OFF: DepositQuote = { active: false, mode: null, amountMinor: 0n, note: null };

export const DEFAULT_DEPOSIT_NOTE = "অর্ডার নিশ্চিত করতে ডিপোজিট পরিশোধ করুন — বাকি টাকা ডেলিভারির সময় দিলেই হবে।";

function toBigIntOrNull(value: unknown): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
}

export function depositFor(
  profile: DepositProfile | null | undefined,
  input: { totalMinor: bigint; kind: DepositKind },
): DepositQuote {
  const p = profile ?? {};
  const mode = String(p.depositMode ?? "").trim().toLowerCase();
  if (mode !== "percent" && mode !== "fixed") return DEPOSIT_OFF;

  const appliesTo = String(p.depositAppliesTo ?? "cod").trim().toLowerCase();
  const covered =
    appliesTo === "all"
      ? true
      : appliesTo === "online"
        ? input.kind === "online"
        : input.kind === "cod"; // "cod" + any unknown value = the safe default
  if (!covered) return DEPOSIT_OFF;

  let total: bigint;
  try {
    total = BigInt(input.totalMinor as any);
  } catch {
    return DEPOSIT_OFF;
  }
  if (total <= 0n) return DEPOSIT_OFF;

  let amount: bigint;
  if (mode === "percent") {
    const pctRaw = Number(p.depositPercent ?? NaN);
    if (!Number.isInteger(pctRaw) || pctRaw < 1 || pctRaw > 90) return DEPOSIT_OFF;
    amount = (total * BigInt(pctRaw)) / 100n;
    if (amount <= 0n) return DEPOSIT_OFF;
  } else {
    const fixed = toBigIntOrNull(p.depositFixedMinor);
    if (fixed === null || fixed <= 0n) return DEPOSIT_OFF;
    amount = fixed > total ? total : fixed;
  }

  const note = String(p.depositNote ?? "").trim() || DEFAULT_DEPOSIT_NOTE;
  return { active: true, mode, amountMinor: amount, note };
}

/** The deposit slice of a profile, for settings serialization. */
export function depositConfigOf(profile: DepositProfile | null | undefined) {
  const p = profile ?? {};
  const fixed = toBigIntOrNull(p.depositFixedMinor);
  return {
    mode: p.depositMode === "percent" || p.depositMode === "fixed" ? p.depositMode : null,
    percent: p.depositPercent != null && Number.isFinite(Number(p.depositPercent)) ? Number(p.depositPercent) : null,
    fixedMinor: fixed !== null ? fixed.toString() : null,
    appliesTo: ["cod", "online", "all"].includes(String(p.depositAppliesTo ?? ""))
      ? String(p.depositAppliesTo)
      : "cod",
    note: p.depositNote ?? null,
  };
}
