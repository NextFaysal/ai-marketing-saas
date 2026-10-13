import { smsSegments } from "./sms-segments";
import { findLinks } from "./link-tracking";

/**
 * MS5 — compose check: deterministic, advisory-only warnings for
 * a message being composed (spam-trigger words, shouting subject,
 * link stuffing, missing subject, SMS part count, over-long body).
 * Pure + spec-pinned. A warning NEVER blocks a send — it is shown
 * in the composer so the merchant can decide.
 */
export const SPAM_WORDS_EN = [
  "free money", "guaranteed income", "act now", "cash prize",
  "risk-free", "100% free", "you won", "lottery",
] as const;

export const SPAM_WORDS_BN = [
  "সম্পূর্ণ ফ্রি", "টাকা জিতুন", "নিশ্চিত আয়", "লটারি",
] as const;

export const COMPOSE_BODY_MAX = 10000;
export const COMPOSE_MAX_LINKS = 3;
export const COMPOSE_MAX_SMS_PARTS = 3;

export interface ComposeWarning { code: string; message: string }

export function composeCheck(input: { channel: string; subject?: string; body: string }): ComposeWarning[] {
  const warnings: ComposeWarning[] = [];
  const body = String(input.body ?? "");
  const subject = String(input.subject ?? "");
  const haystack = `${subject}\n${body}`.toLowerCase();

  const matched = [
    ...SPAM_WORDS_EN.filter((w) => haystack.includes(w)),
    ...SPAM_WORDS_BN.filter((w) => haystack.includes(w)),
  ];
  if (matched.length) {
    warnings.push({
      code: "SPAM_WORD",
      message: `স্প্যাম-ঝুঁকির শব্দ পাওয়া গেছে: ${matched.join(", ")} — এসব শব্দ ডেলিভারি কমিয়ে দিতে পারে।`,
    });
  }

  // Shouting subject: enough letters to judge, mostly uppercase.
  const letters = [...subject].filter((ch) => ch.toLowerCase() !== ch.toUpperCase());
  if (letters.length >= 10) {
    const upper = letters.filter((ch) => ch === ch.toUpperCase()).length;
    if (upper / letters.length > 0.6) {
      warnings.push({
        code: "CAPS_SUBJECT",
        message: "বিষয়ের বেশিরভাগ অক্ষর বড় হাতের (ALL CAPS) — স্প্যাম ফিল্টরে আটকে যাওয়ার ঝুঁকি থাকে।",
      });
    }
  }

  const linkCount = findLinks(body).length + findLinks(subject).length;
  if (linkCount > COMPOSE_MAX_LINKS) {
    warnings.push({
      code: "MANY_LINKS",
      message: `বার্তায় ${linkCount}টি লিংক আছে — ${COMPOSE_MAX_LINKS}টির বেশি লিংক স্প্যাম-ঝুঁকি বাড়ায়।`,
    });
  }

  if (input.channel === "email" && !subject.trim()) {
    warnings.push({
      code: "MISSING_SUBJECT",
      message: "ইমেইলের বিষয় (subject) খালি — একটি বিষয় যোগ করুন।",
    });
  }

  if (input.channel === "sms") {
    const seg = smsSegments(body);
    if (seg.parts > COMPOSE_MAX_SMS_PARTS) {
      warnings.push({
        code: "SMS_PARTS",
        message: `এই SMS-টি ${seg.parts} পার্টে পাঠানো হবে — ${COMPOSE_MAX_SMS_PARTS} পার্টের বেশি হলে খরচ বেড়ে যায়।`,
      });
    }
  }

  if (body.length > COMPOSE_BODY_MAX) {
    warnings.push({
      code: "BODY_TOO_LONG",
      message: `বার্তাটি ${body.length} অক্ষরের — ${COMPOSE_BODY_MAX} অক্ষরের বেশি লম্বা বার্তা অনেক প্রোভাইডারে কেটে যেতে পারে।`,
    });
  }

  return warnings;
}
