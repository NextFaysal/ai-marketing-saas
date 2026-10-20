import { smsSegments } from "./sms-segments";
import { findLinks } from "./link-tracking";
import { catalogText, type ApiLocale } from "../i18n/catalog/send-locale";

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

export function composeCheck(input: { channel: string; subject?: string; body: string }, locale: ApiLocale = "bn"): ComposeWarning[] {
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
      message: catalogText("messaging.composeSpamWords", locale, { words: matched.join(", ") }),
    });
  }

  // Shouting subject: enough letters to judge, mostly uppercase.
  const letters = [...subject].filter((ch) => ch.toLowerCase() !== ch.toUpperCase());
  if (letters.length >= 10) {
    const upper = letters.filter((ch) => ch === ch.toUpperCase()).length;
    if (upper / letters.length > 0.6) {
      warnings.push({
        code: "CAPS_SUBJECT",
        message: catalogText("messaging.composeCapsSubject", locale),
      });
    }
  }

  const linkCount = findLinks(body).length + findLinks(subject).length;
  if (linkCount > COMPOSE_MAX_LINKS) {
    warnings.push({
      code: "MANY_LINKS",
      message: catalogText("messaging.composeManyLinks", locale, { count: linkCount, max: COMPOSE_MAX_LINKS }),
    });
  }

  if (input.channel === "email" && !subject.trim()) {
    warnings.push({
      code: "MISSING_SUBJECT",
      message: catalogText("messaging.composeMissingSubject", locale),
    });
  }

  if (input.channel === "sms") {
    const seg = smsSegments(body);
    if (seg.parts > COMPOSE_MAX_SMS_PARTS) {
      warnings.push({
        code: "SMS_PARTS",
        message: catalogText("messaging.composeSmsParts", locale, { parts: seg.parts, max: COMPOSE_MAX_SMS_PARTS }),
      });
    }
  }

  if (body.length > COMPOSE_BODY_MAX) {
    warnings.push({
      code: "BODY_TOO_LONG",
      message: catalogText("messaging.composeBodyTooLong", locale, { length: body.length, max: COMPOSE_BODY_MAX }),
    });
  }

  return warnings;
}
