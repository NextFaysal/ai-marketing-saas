/**
 * MS7 — pure helpers for the per-broadcast report. Kept free of
 * Prisma so the funnel arithmetic, the failure-reason grouping
 * and the A/B suggestion rule are pinned by unit specs exactly
 * as shipped.
 */

/**
 * The recipient key of a DELIVERY row, derived with the same
 * rule sendToRecipient uses for the MS5 link token / MS7 open
 * token: `recipientId ? "${type}:${id}" : "${type}:${address}"`.
 * For email (the only pixel channel) the address IS the channel
 * address, so the two derivations coincide exactly; csv/test
 * deliveries record recipientId null by design (recordDelivery).
 */
export function deliveryRecipientKey(d: { recipientType: string; recipientId?: string | null; address: string }): string {
  return d.recipientId ? `${d.recipientType}:${d.recipientId}` : `${d.recipientType}:${d.address}`;
}

/**
 * Normalize a provider failure into its stable, groupable form:
 * emails → <address>, UUIDs → <id>, long digit runs (phone /
 * reference numbers) → <number>, remaining digit runs → <n>,
 * whitespace collapsed, capped at 80 chars. Two recipients
 * failing for the same provider reason group together even
 * though their raw errors embed different addresses/ids.
 */
export function normalizeFailureReason(error: unknown): string {
  let s = String(error ?? "").trim();
  if (!s) return "Unknown error";
  s = s
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<address>")
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "<id>")
    .replace(/\+?\d[\d\s-]{6,}\d/g, "<number>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > 80) s = `${s.slice(0, 79)}…`;
  return s || "Unknown error";
}

/** Group raw failure errors: top `topN` normalized reasons by
 * count, everything else summed into one "other" bucket. */
export function groupFailureReasons(errors: (string | null | undefined)[], topN = 10): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of errors) {
    const key = normalizeFailureReason(e);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  if (sorted.length <= topN) return sorted;
  const head = sorted.slice(0, topN);
  const other = sorted.slice(topN).reduce((sum, r) => sum + r.count, 0);
  return [...head, { reason: "other", count: other }];
}

export interface FunnelLite {
  sent: number;
  read: number | null;
  clickedRecipients: number | null;
}

/**
 * MS7 — the A/B winner SUGGESTION. A suggestion only, never an
 * action: nothing here sends, picks or mutates anything. Basis
 * prefers the read rate (WhatsApp), falls back to the click
 * rate; a variant pair with fewer than 30 sends on either side,
 * no comparable signal, or an exact tie yields leader null
 * with the reason in the note.
 */
export function abSuggestion(variants: { A?: FunnelLite | null; B?: FunnelLite | null }): {
  basis: "readRate" | "clickRate" | null;
  leader: "A" | "B" | null;
  note: string;
} {
  const a = variants.A ?? null;
  const b = variants.B ?? null;
  if (!a || !b) {
    return { basis: null, leader: null, note: "দুটি ভ্যারিয়েন্টের ডেটাই পাওয়া যায়নি — পরামর্শ দেওয়া যাচ্ছে না।" };
  }
  const basis: "readRate" | "clickRate" | null =
    a.read !== null && b.read !== null ? "readRate"
    : a.clickedRecipients !== null && b.clickedRecipients !== null ? "clickRate"
    : null;
  if (!basis) {
    return { basis: null, leader: null, note: "এই চ্যানেলে তুলনার মতো read/click ডেটা পাওয়া যায় না — পরামর্শ দেওয়া যাচ্ছে না।" };
  }
  if (a.sent < 30 || b.sent < 30) {
    return { basis, leader: null, note: `নমুনা খুব ছোট (A: ${a.sent}টি, B: ${b.sent}টি পাঠানো; কমপক্ষে ৩০টি করে দরকার) — পরামর্শ দেওয়া হচ্ছে না।` };
  }
  const rate = (f: FunnelLite) => (basis === "readRate" ? (f.read ?? 0) / f.sent : (f.clickedRecipients ?? 0) / f.sent);
  const ra = rate(a);
  const rb = rate(b);
  const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
  if (ra === rb) {
    return { basis, leader: null, note: `দুটি ভ্যারিয়েন্টের হার সমান (${pct(ra)}) — কোনোটিকেই এগিয়ে বলা যাচ্ছে না।` };
  }
  const leader = ra > rb ? "A" : "B";
  return {
    basis, leader,
    note: `${basis === "readRate" ? "Read" : "Click"} হার — A: ${pct(ra)}, B: ${pct(rb)}। এটি শুধু পরামর্শ; কিছুই স্বয়ংক্রিয়ভাবে পাঠানো বা বেছে নেওয়া হয়নি।`,
  };
}
