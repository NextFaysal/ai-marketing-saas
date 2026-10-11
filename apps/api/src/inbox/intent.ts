/**
 * Deterministic intent + sentiment classification for inbound chat
 * messages (Bengali + English). This is a transparent heuristic, NOT an
 * ML model: agents see it as an estimate with a confidence score, and
 * the grounded auto-reply engine only acts when confidence is high and
 * real business data backs the answer.
 */
export type Intent = "price" | "stock" | "delivery" | "order_status" | "payment" | "complaint" | "greeting" | "order_intent" | "other";
export interface Classification { intent: Intent; confidence: number; sentiment: "negative" | "positive" | null }

interface Rule { intent: Intent; phrases: string[]; words: string[]; base: number }
const RULES: Rule[] = [
  { intent: "complaint", base: 88, phrases: ["খুব খারাপ", "প্রতারণা", "অভিযোগ করতে চাই", "রিফান্ড চাই", "refund chai", "damaged product", "ভাঙা পণ্য", "নষ্ট পণ্য"], words: ["অভিযোগ", "complaint", "প্রতারক", "fraud", "রিফান্ড", "refund", "ভাঙা", "নষ্ট", "বাজে সার্ভিস", "হতাশ"] },
  { intent: "order_status", base: 85, phrases: ["order status", "অর্ডার স্ট্যাটাস", "আমার অর্ডার", "পার্সেল কোথায়", "ডেলিভারি পাইনি", "tracking", "ট্র্যাকিং", "কবে পাব", "order kothay"], words: ["অর্ডার", "পার্সেল", "parcel", "ট্র্যাক", "পাইনি", "আসেনি"] },
  { intent: "price", base: 85, phrases: ["দাম কত", "কত টাকা", "price koto", "dam koto", "কত দাম", "প্রাইস কত"], words: ["দাম", "price", "প্রাইস", "dam", "খরচ কত"] },
  { intent: "stock", base: 82, phrases: ["স্টক আছে", "stock আছে", "available আছে", "আছে কি", "in stock"], words: ["স্টক", "stock", "available", "এভেইলেবল"] },
  { intent: "delivery", base: 82, phrases: ["ডেলিভারি চার্জ", "delivery charge", "কতদিন লাগবে", "ডেলিভারি কত", "কুরিয়ার চার্জ", "হোম ডেলিভারি"], words: ["ডেলিভারি", "delivery", "কুরিয়ার", "courier", "শিপিং", "shipping"] },
  { intent: "payment", base: 82, phrases: ["ক্যাশ অন ডেলিভারি", "cash on delivery", "cod হবে", "cod available", "বিকাশে পেমেন্ট", "পেমেন্ট কিভাবে"], words: ["বিকাশ", "bkash", "নগদ", "nagad", "cod", "পেমেন্ট", "payment"] },
  { intent: "order_intent", base: 88, phrases: ["অর্ডার করতে চাই", "অর্ডার করব", "কিনতে চাই", "নিতে চাই", "order korte chai", "order korbo", "kinte chai", "nite chai", "order korte", "আমি কিনব", "অর্ডার দিতে চাই"], words: ["কিনব"] },
  { intent: "greeting", base: 75, phrases: ["আসসালামু আলাইকুম", "আসসালামুয়ালাইকুম", "hello", "hi ", "সালাম", "হ্যালো", "ভাইয়া", "আপু"], words: ["সালাম", "hello", "হাই"] },
];

const NEGATIVE_WORDS = ["খুব খারাপ", "বাজে", "প্রতারণা", "প্রতারক", "রাগ", "বিরক্তিকর", "হতাশ", "fraud", "angry", "বাজে সার্ভিস", "ধোঁকা", "😡", "😠"];

/**
 * Inbox Next-Gen P3: positive sentiment, curated BN + EN. Entries are
 * chosen to avoid colliding with complaint / order / price phrases
 * (e.g. bare "ভালো" is deliberately NOT here — "ভালো না" would flip a
 * complaint positive; "ভালো লেগেছে" is the safe form). Negative
 * always wins when both fire (see classifyIntent).
 */
const POSITIVE_WORDS = [
  "ধন্যবাদ", "শুকরিয়া", "চমৎকার", "দারুণ", "অসাধারণ", "খুব সুন্দর", "সুন্দর হয়েছে",
  "ভালো লেগেছে", "সুন্দর", "খুশি", "সন্তুষ্ট", "পারফেক্ট",
  "thank you", "thanks", "great service", "excellent", "awesome", "amazing",
  "love it", "loved it", "perfect", "very happy", "so happy", "satisfied",
  "👍", "❤️", "😍", "😊", "🥰",
];

const GREETING_ONLY = /^(\s*)(আসসালামু আলাইকুম|আসসালামুয়ালাইকুম|সালাম|hello|hi|হ্যালো|হাই|ভাইয়া|আপু)(\s|!|।|\.)*$/i;

export function classifyIntent(rawText: string): Classification {
  const text = ` ${String(rawText ?? "").toLowerCase()} `;
  // Negative ALWAYS wins: a complaint that also says "thanks" is
  // still a complaint. Positive only fires when no negative hit.
  const sentiment: Classification["sentiment"] = NEGATIVE_WORDS.some((w) => text.includes(w))
    ? "negative"
    : POSITIVE_WORDS.some((w) => text.includes(w)) ? "positive" : null;
  if (GREETING_ONLY.test(String(rawText ?? "").trim())) return { intent: "greeting", confidence: 90, sentiment };

  let best: { intent: Intent; score: number } = { intent: "other", score: 0 };
  for (const rule of RULES) {
    let score = 0;
    for (const p of rule.phrases) if (text.includes(p)) score = Math.max(score, rule.base);
    if (score === 0) {
      const hits = rule.words.filter((w) => text.includes(w)).length;
      if (hits > 0) score = Math.min(rule.base - 12, 55 + hits * 8);
    }
    // Complaint signals win ties: a missed complaint costs more than a
    // missed price question.
    if (score > best.score || (score > 0 && score === best.score && rule.intent === "complaint")) best = { intent: rule.intent, score };
  }
  if (sentiment === "negative" && ["price", "stock", "delivery", "payment", "greeting"].includes(best.intent)) {
    return { intent: "complaint", confidence: Math.max(best.score, 72), sentiment };
  }
  return { intent: best.intent, confidence: best.score, sentiment };
}

/**
 * Inbox Next-Gen P3: thread mood from a set of message texts,
 * computed with the same deterministic classifier (used at read
 * time — per-message sentiment was never persisted, only intent).
 * negative = -1, positive = +1, unclassified = 0; the sign of the
 * sum decides, an all-zero sum over a non-empty list is "neutral",
 * and an empty list has no mood at all (null).
 */
export function moodFromMessages(texts: string[]): "positive" | "neutral" | "negative" | null {
  if (!texts.length) return null;
  let sum = 0;
  for (const t of texts) {
    const s = classifyIntent(t).sentiment;
    if (s === "negative") sum -= 1;
    else if (s === "positive") sum += 1;
  }
  return sum > 0 ? "positive" : sum < 0 ? "negative" : "neutral";
}

/** COD confirmation replies: short affirmative / negative answers only. */
export function parseCodReply(rawText: string): "confirmed" | "declined" | null {
  const t = String(rawText ?? "").trim().toLowerCase();
  if (t.length === 0 || t.length > 30) return null;
  const yes = ["হ্যাঁ", "হ্যা", "হুম", "yes", "y", "confirm", "কনফার্ম", "ওকে", "ok", "আচ্ছা ঠিক আছে", "ঠিক আছে", "👍"];
  const no = ["না", "no", "n", "cancel", "বাতিল", "ক্যানসেল", "লাগবে না", "চাই না", "👎"];
  if (yes.some((w) => t === w || t.startsWith(w + " ") || t.startsWith(w + "!"))) return "confirmed";
  if (no.some((w) => t === w || t.startsWith(w + " ") || t.startsWith(w + "!"))) return "declined";
  return null;
}
