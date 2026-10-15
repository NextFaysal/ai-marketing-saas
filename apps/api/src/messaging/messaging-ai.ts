/**
 * MS9 — the DETERMINISTIC half of Messaging AI: pure helpers for
 * the send-time suggestion (the org's own engagement events,
 * bucketed by Asia/Dhaka hour) and the segment suggestions (RFM
 * counts → audiences the composer can actually select). No LLM
 * is involved in either suggestion — both are computed from real
 * rows, and both refuse honestly below their data thresholds
 * instead of dressing a guess up as advice. Pure + exported so
 * the spec can pin the threshold and timezone math exactly.
 */

/** Minimum engagement events (last 90 days) before a send-time
 * suggestion is shown at all. Below this the endpoint reports
 * the real count and says the data is not enough. */
export const SEND_TIME_MIN_EVENTS = 100;

/** The Asia/Dhaka hour (0–23) of a timestamp. Dhaka is UTC+6
 * year-round (no DST since 2009), computed through Intl so the
 * rule stays correct even if that ever changes. */
export function dhakaHour(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka", hour: "numeric", hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return Number.isFinite(hour) ? hour % 24 : 0;
}

export interface SendTimeSummary {
  totalEvents: number;
  /** All 24 Dhaka hours with their event counts. */
  buckets: { hour: number; events: number }[];
  /** Top 3 hours by events (ties → earlier hour first). */
  bestHours: { hour: number; events: number }[];
}

export function summarizeSendTimeEvents(timestamps: Date[]): SendTimeSummary {
  const counts = new Array<number>(24).fill(0);
  for (const t of timestamps) {
    if (!(t instanceof Date) || Number.isNaN(t.getTime())) continue;
    counts[dhakaHour(t)] += 1;
  }
  const buckets = counts.map((events, hour) => ({ hour, events }));
  const bestHours = [...buckets]
    .filter((b) => b.events > 0)
    .sort((a, b) => b.events - a.events || a.hour - b.hour)
    .slice(0, 3);
  return { totalEvents: timestamps.length, buckets, bestHours };
}

/** Minimum RFM segment size before a segment suggestion fires. */
export const SEGMENT_SUGGESTION_MIN_SIZE = 20;

export interface SegmentSuggestion {
  kind: string;
  /** Present only when the suggestion maps to an audience the
   * composer can select verbatim (audienceType "segment"). */
  audienceType?: string;
  audienceSegment?: string;
  size: number;
  reason: string;
}

/**
 * The segment rules, from REAL RFM counts only. Every segment
 * suggestion maps to audienceType "segment" + the RFM segment of
 * the same name — a suggestion the composer cannot act on is
 * never emitted. Sorted by size descending (ties by segment
 * name) so the biggest opportunity is first and the order is
 * deterministic.
 */
export function segmentSuggestionsFromCounts(counts: Record<string, number>): SegmentSuggestion[] {
  const rules: { segment: string; kind: string; reason: (size: number) => string }[] = [
    {
      segment: "at_risk", kind: "winback_at_risk",
      reason: (n) => `${n} জন কাস্টমার "At Risk" সেগমেন্টে আছেন — আগে নিয়মিত কিনতেন, এখন অনেকদিন অর্ডার করেননি। একটি Win-back Broadcast পাঠানোর কথা ভাবুন।`,
    },
    {
      segment: "lost", kind: "reactivate_lost",
      reason: (n) => `${n} জন কাস্টমার "Lost" সেগমেন্টে আছেন — দীর্ঘদিন কোনো অর্ডার নেই। একটি পুনরায় সক্রিয় করার (Reactivation) অফার পাঠানো যেতে পারে।`,
    },
    {
      segment: "champions", kind: "early_access_champions",
      reason: (n) => `${n} জন কাস্টমার "Champions" সেগমেন্টে আছেন — আপনার সেরা কাস্টমার। নতুন পণ্য বা অফারের Early Access সবার আগে এদের দিন।`,
    },
    {
      segment: "new", kind: "welcome_new",
      reason: (n) => `${n} জন কাস্টমার "New" সেগমেন্টে আছেন — সম্প্রতি প্রথম অর্ডার করেছেন। একটি Welcome / দ্বিতীয় অর্ডারের উৎসাহমূলক Broadcast পাঠানো যেতে পারে।`,
    },
  ];
  const out: SegmentSuggestion[] = [];
  for (const rule of rules) {
    const size = Number(counts[rule.segment] ?? 0);
    if (size >= SEGMENT_SUGGESTION_MIN_SIZE) {
      out.push({
        kind: rule.kind, audienceType: "segment", audienceSegment: rule.segment,
        size, reason: rule.reason(size),
      });
    }
  }
  return out.sort((a, b) => b.size - a.size || String(a.audienceSegment).localeCompare(String(b.audienceSegment)));
}
