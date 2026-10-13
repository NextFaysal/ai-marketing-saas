// IN4 (Inbox Next): presentation helpers for the layered SLA
// chain. The SERVER computes each conversation's SLA position
// (slaState "warning" at 75% of its effective limit, "breached"
// past it; slaDueAt the effective deadline) with the same
// layered policy as the breach folder and the sweep — these
// helpers only format that verdict for the card. They never
// re-derive a deadline the server did not state.

export interface SlaChip {
  tone: "warning" | "breached";
  label: string;
}

export function slaChipInfo(
  conv: { slaState?: string | null; slaDueAt?: string | null },
  nowMs: number,
): SlaChip | null {
  if (!conv.slaState || !conv.slaDueAt) return null;
  const due = new Date(conv.slaDueAt).getTime();
  if (!Number.isFinite(due)) return null;
  if (conv.slaState === "breached") {
    const over = Math.floor((nowMs - due) / 60000);
    return {
      tone: "breached",
      label: over > 0 ? `🚨 SLA breach — ${over} মিনিট পেরিয়ে গেছে` : "🚨 SLA breach",
    };
  }
  if (conv.slaState === "warning") {
    const left = Math.max(0, Math.ceil((due - nowMs) / 60000));
    return {
      tone: "warning",
      label: left > 0 ? `⏰ SLA সতর্কতা — আর ${left} মিনিট` : "⏰ SLA সতর্কতা — সময় প্রায় শেষ",
    };
  }
  return null;
}

/**
 * Parses one SLA minutes input from the settings card: blank
 * means "no override" (null), a valid integer 1..10080 is the
 * override, anything else is invalid (undefined) so the UI can
 * refuse to save garbage instead of the API having to reject it.
 */
export function parseSlaMinutesInput(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > 10080) return undefined;
  return n;
}
