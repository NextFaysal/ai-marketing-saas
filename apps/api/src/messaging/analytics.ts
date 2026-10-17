import { SPAM_WORDS_BN, SPAM_WORDS_EN } from "./compose-check";
import { dhakaHour } from "./messaging-ai";

/**
 * MX16 — pure helpers for Analytics & AI v2. Kept free of Prisma
 * so the funnel aggregation, the A/B auto-winner statistics,
 * the subject-line heuristic and the per-recipient send-time
 * statistic are pinned by unit specs exactly as shipped.
 *
 * Honesty rules that live here:
 * - A funnel stage a channel cannot report stays `null`, never
 *   0 (the broadcastFunnel rule in messaging.service.ts).
 * - Revenue figures are ASSOCIATION only: the audit (see
 *   docs/messaging-mx15-acceptance.md §5) found NO honest join
 *   between a broadcast delivery and Touchpoint /
 *   AttributionCredit, so nothing in this module — or in any
 *   consumer of it — may call a revenue figure "attribution".
 * - The auto-winner is NOT AI: it is a documented two-proportion
 *   z-test under an explicit opt-in, with a stated minimum
 *   sample, and it never fires twice, on a tie, or below the
 *   significance threshold.
 * - The subject score is a HEURISTIC with its factors shown —
 *   never a measured or predicted open rate.
 */

// ---------------------------------------------------------------------------
// Shared labels
// ---------------------------------------------------------------------------

/** The one label every revenue/order figure in MX16 analytics
 * carries, in API payloads, CSV exports and scheduled reports. */
export const ASSOCIATION_LABEL_BN =
  "সম্পর্ক (association) — প্রাপক কাস্টমারদের পাঠানোর পর ৭ দিনের অর্ডার; Broadcast-টি যে এই অর্ডারের কারণ, তার প্রমাণ নয়। Touchpoint/AttributionCredit-এর সঙ্গে Messaging Delivery-র কোনো সৎ join নেই, তাই Attribution দাবি করা হয় না।";

export const ASSOCIATION_METHOD_BN =
  "প্রাপক কাস্টমারদের পাঠানোর পর ৭ দিনের অর্ডার (সম্পর্ক, কারণের প্রমাণ নয়)";

// ---------------------------------------------------------------------------
// Comparative analytics — funnel aggregation
// ---------------------------------------------------------------------------

/** The funnel shape broadcastFunnel produces (per broadcast). */
export interface BroadcastFunnelShape {
  audience: number;
  sent: number;
  failed: number;
  skipped: number;
  delivered: number | null;
  read: number | null;
  opened: number | null;
  clickedRecipients: number | null;
  totalClicks: number | null;
}

export interface ChannelFunnel {
  channel: string;
  broadcasts: number;
  audience: number;
  sent: number;
  failed: number;
  skipped: number;
  delivered: number | null;
  read: number | null;
  opened: number | null;
  clickedRecipients: number | null;
  totalClicks: number | null;
}

const NULLABLE_STAGES = ["delivered", "read", "opened", "clickedRecipients", "totalClicks"] as const;

/**
 * Aggregate per-broadcast funnels into per-channel funnels (and,
 * when called with one synthetic channel, the grand total).
 * A nullable stage sums ONLY the broadcasts that can report it:
 * if NO broadcast in the group can report the stage, the group
 * figure stays `null` — never a fabricated 0. (Within one
 * channel the capability is uniform except email `opened`,
 * which exists only for HTML broadcasts — the sum then covers
 * exactly the HTML broadcasts, stated in the UI copy.)
 */
export function aggregateFunnels(
  rows: { channel: string; funnel: BroadcastFunnelShape }[],
): ChannelFunnel[] {
  const byChannel = new Map<string, { channel: string; funnels: BroadcastFunnelShape[] }>();
  for (const r of rows) {
    const g = byChannel.get(r.channel) ?? { channel: r.channel, funnels: [] };
    g.funnels.push(r.funnel);
    byChannel.set(r.channel, g);
  }
  const out: ChannelFunnel[] = [];
  for (const g of byChannel.values()) {
    const sum = (pick: (f: BroadcastFunnelShape) => number) => g.funnels.reduce((s, f) => s + pick(f), 0);
    const stage = (key: (typeof NULLABLE_STAGES)[number]): number | null => {
      const vals = g.funnels.map((f) => f[key]).filter((v): v is number => typeof v === "number");
      return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
    };
    out.push({
      channel: g.channel,
      broadcasts: g.funnels.length,
      audience: sum((f) => f.audience),
      sent: sum((f) => f.sent),
      failed: sum((f) => f.failed),
      skipped: sum((f) => f.skipped),
      delivered: stage("delivered"),
      read: stage("read"),
      opened: stage("opened"),
      clickedRecipients: stage("clickedRecipients"),
      totalClicks: stage("totalClicks"),
    });
  }
  return out.sort((a, b) => a.channel.localeCompare(b.channel));
}

/** CSV for the comparative analytics — built from the SAME
 * aggregate objects the on-screen tables render, so the export
 * numbers match the screen by construction (spec-proven). A
 * null stage exports as an EMPTY cell, never 0. */
export function buildAnalyticsCsv(input: {
  range: { from: string; to: string };
  broadcasts: {
    id: string; name: string; channel: string; status: string; sentAt: string | null;
    funnel: BroadcastFunnelShape;
    revenueAssociation: { orders: number; totalMinor: string } | null;
  }[];
  channels: ChannelFunnel[];
}): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  lines.push(`# মেসেজিং তুলনামূলক Analytics (MX16) · সময়সীমা: ${input.range.from} থেকে ${input.range.to} (ঢাকা)`);
  lines.push(`# আয়/অর্ডারের সব সংখ্যা: ${ASSOCIATION_LABEL_BN}`);
  lines.push("# Broadcast অনুযায়ী");
  lines.push(["broadcastId", "name", "channel", "status", "sentAt", "audience", "sent", "failed", "skipped", "delivered", "read", "opened", "clickedRecipients", "totalClicks", "associatedOrders", "associatedRevenueMinor"].join(","));
  for (const b of input.broadcasts) {
    lines.push([
      b.id, b.name, b.channel, b.status, b.sentAt ?? "",
      b.funnel.audience, b.funnel.sent, b.funnel.failed, b.funnel.skipped,
      b.funnel.delivered, b.funnel.read, b.funnel.opened, b.funnel.clickedRecipients, b.funnel.totalClicks,
      b.revenueAssociation ? b.revenueAssociation.orders : "",
      b.revenueAssociation ? b.revenueAssociation.totalMinor : "",
    ].map(esc).join(","));
  }
  lines.push("# Channel অনুযায়ী Funnel");
  lines.push(["channel", "broadcasts", "audience", "sent", "failed", "skipped", "delivered", "read", "opened", "clickedRecipients", "totalClicks"].join(","));
  for (const c of input.channels) {
    lines.push([
      c.channel, c.broadcasts, c.audience, c.sent, c.failed, c.skipped,
      c.delivered, c.read, c.opened, c.clickedRecipients, c.totalClicks,
    ].map(esc).join(","));
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// A/B auto-winner — two-proportion z-test (NOT AI)
// ---------------------------------------------------------------------------

/**
 * The stated rule (named in code AND UI):
 * - Test: two-proportion z-test (pooled), two-sided.
 * - Minimum sample: AUTO_WINNER_MIN_SAMPLE successful sends PER
 *   VARIANT before any decision may be taken. 100 is chosen
 *   because below it a z-test on typical messaging rates
 *   (1–40%) cannot distinguish real differences from noise at
 *   the stated confidence without absurd effect sizes — the
 *   MS7 suggestion's 30-send floor is a *suggestion* floor, not
 *   a licence to re-route real recipients.
 * - Significance: |z| ≥ 1.96, i.e. two-sided p < 0.05 (95%
 *   confidence). An exact tie, or |z| below the critical value,
 *   is NO decision — the test simply keeps running.
 */
export const AUTO_WINNER_MIN_SAMPLE = 100;
export const AUTO_WINNER_ALPHA = 0.05;
export const AUTO_WINNER_Z_CRITICAL = 1.96;
export const AUTO_WINNER_TEST_NAME = "two-proportion z-test (pooled, two-sided), alpha 0.05, |z| >= 1.96";
export const AUTO_WINNER_RULE_TEXT_BN =
  `Auto-winner নিয়ম: প্রতি Variant-এ কমপক্ষে ${AUTO_WINNER_MIN_SAMPLE}টি সফল পাঠানো (sent) হলে তবেই সিদ্ধান্ত; ` +
  "দুই-অনুপাতের z-test (pooled, two-sided) — |z| ≥ 1.96 (p < 0.05, 95% confidence) হলেই কেবল জয়ী ঘোষণা হয়। " +
  "সমান হার বা threshold-এর নিচে কোনো সিদ্ধান্ত হয় না; সিদ্ধান্ত একবারই হয়। এটি AI নয় — একটি নির্দিষ্ট পরিসংখ্যান-নিয়ম।";

/** Standard normal CDF via the Abramowitz–Stegun erf
 * approximation (error < 1.5e-7) — enough for the stated
 * threshold decision and the reported p-value. */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

export interface VariantStat { sent: number; success: number }

export function twoProportionZTest(a: VariantStat, b: VariantStat): { z: number; pValue: number; rateA: number; rateB: number } {
  const rateA = a.sent > 0 ? a.success / a.sent : 0;
  const rateB = b.sent > 0 ? b.success / b.sent : 0;
  const pooled = a.sent + b.sent > 0 ? (a.success + b.success) / (a.sent + b.sent) : 0;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / Math.max(1, a.sent) + 1 / Math.max(1, b.sent)));
  const z = se > 0 ? (rateA - rateB) / se : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { z, pValue, rateA, rateB };
}

export type AutoWinnerMetric = "readRate" | "clickRate" | "openRate";

/**
 * Pick the ONE metric the channel honestly reports, from both
 * variants' funnels (the same capability logic as
 * broadcastFunnel): WhatsApp/on-site report read; email reports
 * clicks (and opens for HTML); SMS reports clicks. Push and
 * Telegram report none of read/open/click in this system
 * (their funnels carry null for every engagement stage), so
 * the metric is null and the auto-winner REFUSES for that
 * broadcast with the reason — it never invents a metric.
 */
export function pickAutoWinnerMetric(
  channel: string,
  a: BroadcastFunnelShape,
  b: BroadcastFunnelShape,
): { metric: AutoWinnerMetric; a: VariantStat; b: VariantStat } | null {
  const pair = (pick: (f: BroadcastFunnelShape) => number | null): { a: VariantStat; b: VariantStat } | null => {
    const av = pick(a);
    const bv = pick(b);
    if (av === null || bv === null) return null;
    return { a: { sent: a.sent, success: av }, b: { sent: b.sent, success: bv } };
  };
  if (channel === "whatsapp" || channel === "onsite") {
    const r = pair((f) => f.read);
    return r ? { metric: "readRate", ...r } : null;
  }
  if (channel === "email") {
    const c = pair((f) => f.clickedRecipients);
    if (c) return { metric: "clickRate", ...c };
    const o = pair((f) => f.opened);
    return o ? { metric: "openRate", ...o } : null;
  }
  if (channel === "sms") {
    const c = pair((f) => f.clickedRecipients);
    return c ? { metric: "clickRate", ...c } : null;
  }
  return null;
}

export interface AutoWinnerDecision {
  decided: boolean;
  winner: "A" | "B" | null;
  reason: string;
  metric: AutoWinnerMetric | null;
  z: number | null;
  pValue: number | null;
  a: VariantStat | null;
  b: VariantStat | null;
}

/**
 * The decision itself — pure, so every guardrail is spec-pinned:
 * disabled ⇒ no; already decided ⇒ no (never twice); a cascade
 * broadcast ⇒ no (the cascade owns per-channel content; there
 * is no single winning content to switch to); no honest metric
 * ⇒ no, with the reason; below the minimum sample on EITHER
 * side ⇒ no; tie or |z| below critical ⇒ no.
 */
export function decideAutoWinner(input: {
  enabled: boolean;
  alreadyDecided: boolean;
  hasCascade: boolean;
  channel: string;
  funnelA: BroadcastFunnelShape;
  funnelB: BroadcastFunnelShape;
}): AutoWinnerDecision {
  const none = (reason: string, extra: Partial<AutoWinnerDecision> = {}): AutoWinnerDecision => ({
    decided: false, winner: null, reason, metric: null, z: null, pValue: null, a: null, b: null, ...extra,
  });
  if (input.alreadyDecided) return none("already_decided");
  if (!input.enabled) return none("disabled");
  if (input.hasCascade) return none("cascade_not_supported");
  const picked = pickAutoWinnerMetric(input.channel, input.funnelA, input.funnelB);
  if (!picked) return none("metric_unavailable");
  const { metric, a, b } = picked;
  if (a.sent < AUTO_WINNER_MIN_SAMPLE || b.sent < AUTO_WINNER_MIN_SAMPLE) {
    return none("min_sample_not_met", { metric, a, b });
  }
  const { z, pValue, rateA, rateB } = twoProportionZTest(a, b);
  if (rateA === rateB) return none("tie", { metric, z, pValue, a, b });
  if (Math.abs(z) < AUTO_WINNER_Z_CRITICAL) return none("not_significant", { metric, z, pValue, a, b });
  return {
    decided: true,
    winner: rateA > rateB ? "A" : "B",
    reason: "significant",
    metric, z, pValue, a, b,
  };
}

// ---------------------------------------------------------------------------
// Per-recipient send-time suggestion — a DETERMINISTIC statistic
// ---------------------------------------------------------------------------

/** Minimum engagement events for ONE recipient before a modal
 * hour is shown at all. Below this the answer is "insufficient
 * data" with the real count — never a fabricated time. */
export const RECIPIENT_SEND_TIME_MIN_EVENTS = 5;

export interface RecipientSendTime {
  available: boolean;
  totalEvents: number;
  minEvents: number;
  /** Modal Asia/Dhaka hour (0–23); ties go to the earlier hour. */
  modalHour: number | null;
  modalHourEvents: number;
  buckets: { hour: number; events: number }[];
}

/** Modal Dhaka hour of one recipient's real engagement
 * timestamps (MessageLinkClick.createdAt + delivery
 * openedAt/readAt). A statistic from this recipient's own past
 * engagement — NOT AI and NOT a promise about future sends. */
export function recipientSendTimeFromEvents(timestamps: Date[]): RecipientSendTime {
  const counts = new Array<number>(24).fill(0);
  let total = 0;
  for (const t of timestamps) {
    if (!(t instanceof Date) || Number.isNaN(t.getTime())) continue;
    counts[dhakaHour(t)] += 1;
    total += 1;
  }
  const buckets = counts.map((events, hour) => ({ hour, events }));
  let modalHour: number | null = null;
  let modalHourEvents = 0;
  for (const b of buckets) {
    if (b.events > modalHourEvents) { modalHour = b.hour; modalHourEvents = b.events; }
  }
  return {
    available: total >= RECIPIENT_SEND_TIME_MIN_EVENTS,
    totalEvents: total,
    minEvents: RECIPIENT_SEND_TIME_MIN_EVENTS,
    modalHour: total >= RECIPIENT_SEND_TIME_MIN_EVENTS ? modalHour : null,
    modalHourEvents,
    buckets,
  };
}

// ---------------------------------------------------------------------------
// Subject-line quality — a HEURISTIC score with its factors shown
// ---------------------------------------------------------------------------

export interface SubjectQualityFactor {
  code: string;
  label: string;
  points: number;
  maxPoints: number;
  detail: string;
}

export interface SubjectQuality {
  /** Always the literal "heuristic" — this is a rule-based
   * score, NOT a measured or predicted open rate. */
  method: "heuristic";
  score: number;
  maxScore: 100;
  factors: SubjectQualityFactor[];
  spamWordsMatched: string[];
  label: string;
}

/**
 * Heuristic subject-line score (0–100) with every factor shown:
 * length, personalization token, spam-word overlap against the
 * SAME org-visible MX15/MS5 word lists the checklist shows,
 * shouting, and punctuation stuffing. Deterministic, no AI, and
 * labelled heuristic in the payload itself.
 */
export function subjectQualityScore(subjectInput: string): SubjectQuality {
  const subject = String(subjectInput ?? "");
  const factors: SubjectQualityFactor[] = [];

  const len = [...subject].length;
  const lengthPoints = len === 0 ? 0 : len < 10 ? 10 : len <= 60 ? 30 : len <= 90 ? 18 : 8;
  factors.push({
    code: "LENGTH", label: "দৈর্ঘ্য", points: lengthPoints, maxPoints: 30,
    detail: len === 0 ? "বিষয় খালি।" : `বিষয় ${len} অক্ষরের — ১০–৬০ অক্ষর সাধারণত সবচেয়ে পড়তে সুবিধাজনক (heuristic ধারণা)।`,
  });

  const hasToken = /\{\{\s*[a-zA-Z][a-zA-Z0-9_]*\s*\}\}/.test(subject);
  factors.push({
    code: "PERSONALIZATION", label: "ব্যক্তিগতকরণ টোকেন", points: hasToken ? 20 : 0, maxPoints: 20,
    detail: hasToken ? "একটি {{variable}} টোকেন আছে (যেমন {{name}})।" : "কোনো {{variable}} টোকেন নেই — থাকলে প্রতিটি প্রাপকের নামে বার্তা সাজে।",
  });

  const haystack = subject.toLowerCase();
  const spamWordsMatched = [
    ...SPAM_WORDS_EN.filter((w) => haystack.includes(w)),
    ...SPAM_WORDS_BN.filter((w) => subject.includes(w)),
  ];
  factors.push({
    code: "SPAM_WORDS", label: "স্প্যাম-শব্দ (তালিকা-ভিত্তিক)", points: spamWordsMatched.length ? 0 : 25, maxPoints: 25,
    detail: spamWordsMatched.length
      ? `চেকলিস্টের org-দৃশ্যমান তালিকার শব্দ মিলেছে: ${spamWordsMatched.join(", ")}।`
      : "চেকলিস্টের org-দৃশ্যমান স্প্যাম-শব্দ তালিকার কোনো শব্দ মেলেনি।",
  });

  const letters = [...subject].filter((ch) => ch.toLowerCase() !== ch.toUpperCase());
  const upperRatio = letters.length ? letters.filter((ch) => ch === ch.toUpperCase()).length / letters.length : 0;
  const shouting = letters.length >= 10 && upperRatio > 0.6;
  factors.push({
    code: "SHOUTING", label: "চিৎকার (ALL CAPS)", points: shouting ? 0 : 15, maxPoints: 15,
    detail: shouting ? "বিষয়ের বেশিরভাগ অক্ষর বড় হাতের — স্প্যাম ফিল্টরে ঝুঁকি বাড়ায়।" : "বিষয় ALL CAPS নয়।",
  });

  const bangs = (subject.match(/!/g) ?? []).length;
  const questions = (subject.match(/\?/g) ?? []).length;
  const punctPoints = bangs + questions > 2 ? 2 : 10;
  factors.push({
    code: "PUNCTUATION", label: "বিরামচিহ্নের আধিক্য", points: punctPoints, maxPoints: 10,
    detail: bangs + questions > 2 ? `বিষয়ে ${bangs + questions}টি !/? আছে — ২টির বেশি হলে স্প্যাম-ঝুঁকি বাড়ে (heuristic)।` : "বিরামচিহ্ন স্বাভাবিক মাত্রায় আছে।",
  });

  const score = factors.reduce((s, f) => s + f.points, 0);
  return {
    method: "heuristic",
    score,
    maxScore: 100,
    factors,
    spamWordsMatched,
    label: "Heuristic স্কোর — এটি কোনো মাপা বা পূর্বাভাসকৃত Open Rate নয়; নিচের প্রতিটি Factor-এর ভিত্তিতে হিসাব করা একটি নিয়ম-ভিত্তিক মান।",
  };
}
