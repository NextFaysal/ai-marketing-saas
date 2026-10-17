import { formatMinor } from "@repo/contracts";
import { isWithinSchedule } from "./working-hours";

/**
 * Milestone 76 (Business Command Center, part 2): the Business
 * Brain — pure builders that turn the Command Center data
 * (Milestone 75 profile + policies + knowledge documents)
 * into verified fact lines the AI may quote. Every number
 * here comes from a stored row; a missing fact produces NO
 * line, never a guess. The number guard in the autopilot
 * admits a reply only when its numbers appear in these
 * lines, so richer lines = more questions answerable.
 */

const STOPWORDS = new Set([
  "আমি", "আমার", "আপনার", "কি", "কী", "কে", "কেন", "কখন", "কোথায়", "আছে", "আছেন", "হবে", "হয়", "দিন", "বলুন", "চাই", "টা", "টি",
  "the", "a", "an", "is", "are", "do", "does", "you", "your", "i", "me", "my", "please", "ki", "ache", "ase", "koto", "eta", "oi",
]);

/** Bengali + Latin tokenizer for keyword matching. Marks
 * (\p{M}) are essential: Bengali vowel signs (া ি ো ়) are
 * combining marks, not letters — without them every word
 * shatters at its first vowel sign. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [])
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * SA-B3: the number guard's extraction, shared. Numbers in a
 * text, normalized (Bengali digits -> Latin, thousands
 * separators stripped, numeric-normalized so "১,২০০" and "1200"
 * compare equal). This is the EXACT logic the inbox autopilot's
 * deterministic guard has always run (InboxService.extractNumbers
 * delegates here since SA-B3) — the Answer Store's live
 * re-verification compares stored-answer numbers against live
 * source numbers with the same extraction, so a stored answer is
 * judged by precisely the rule that admitted it.
 */
export function extractGuardNumbers(input: string): string[] {
  const normalized = String(input ?? "").replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d).toString()).replace(/,/g, "");
  return (normalized.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
}

export interface KnowledgeMatch { doc: any; score: number }

/**
 * Deterministic keyword matching over knowledge documents —
 * no embeddings, no external service. Title hits weigh
 * double. A document needs a real overlap (>= 2, or a title
 * hit) so generic words never drag in irrelevant answers.
 */
export function matchKnowledge(text: string, docs: any[], limit = 2): KnowledgeMatch[] {
  const query = new Set(tokenize(text));
  if (!query.size) return [];
  const scored: KnowledgeMatch[] = [];
  for (const doc of docs ?? []) {
    const titleTokens = tokenize(String(doc.title ?? ""));
    const bodyTokens = tokenize(String(doc.content ?? ""));
    let score = 0;
    let titleHit = false;
    for (const t of query) {
      if (titleTokens.includes(t)) { score += 2; titleHit = true; }
      if (bodyTokens.includes(t)) score += 1;
    }
    if (score >= 2 || (titleHit && score >= 1)) scored.push({ doc, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

const money = (minor: unknown, currency = "BDT") =>
  minor == null ? null : formatMinor(BigInt(minor as any), currency);

/** Delivery facts from the Command Center profile. */
export function deliveryFactLines(profile: any): string[] {
  if (!profile) return [];
  const lines: string[] = [];
  const inside = money(profile.deliveryChargeInsideMinor);
  const outside = money(profile.deliveryChargeOutsideMinor);
  if (inside) lines.push(`ঢাকার ভিতরে ডেলিভারি চার্জ: ${inside}`);
  if (outside) lines.push(`ঢাকার বাইরে ডেলিভারি চার্জ: ${outside}`);
  if (profile.deliveryDaysInside != null) lines.push(`ঢাকায় ডেলিভারি সময়: ${profile.deliveryDaysInside} দিন`);
  if (profile.deliveryDaysOutside != null) lines.push(`ঢাকার বাইরে ডেলিভারি সময়: ${profile.deliveryDaysOutside} দিন`);
  const free = money(profile.freeDeliveryAboveMinor);
  if (free) lines.push(`${free} বা তার বেশি অর্ডারে ডেলিভারি ফ্রি`);
  if (profile.minOrderMinor != null && money(profile.minOrderMinor)) lines.push(`ন্যূনতম অর্ডার: ${money(profile.minOrderMinor)}`);
  return lines;
}

/** Payment facts from the Command Center profile. */
export function paymentFactLines(profile: any): string[] {
  if (!profile) return [];
  const lines: string[] = [];
  if (profile.codAvailable === true) lines.push("ক্যাশ অন ডেলিভারি (COD) সুবিধা আছে");
  if (profile.codAvailable === false) lines.push("ক্যাশ অন ডেলিভারি সুবিধা নেই — অগ্রিম পেমেন্ট করতে হয়");
  if (profile.bkashNumber) lines.push(`বিকাশ নম্বর: ${profile.bkashNumber}`);
  if (profile.nagadNumber) lines.push(`নগদ নম্বর: ${profile.nagadNumber}`);
  if (profile.advancePaymentPercent != null) lines.push(`অগ্রিম পেমেন্ট: মোট মূল্যের ${profile.advancePaymentPercent}%`);
  if (profile.paymentNote) lines.push(`পেমেন্ট নির্দেশনা: ${String(profile.paymentNote).replace(/\s+/g, " ").slice(0, 300)}`);
  return lines;
}

/** Contact + address facts. */
export function contactFactLines(profile: any): string[] {
  if (!profile) return [];
  const lines: string[] = [];
  if (profile.contactPhone) lines.push(`যোগাযোগের ফোন: ${profile.contactPhone}`);
  if (profile.contactEmail) lines.push(`যোগাযোগের ইমেইল: ${profile.contactEmail}`);
  const addr = [profile.address, profile.city].filter(Boolean).join(", ");
  if (addr) lines.push(`ঠিকানা: ${addr}`);
  if (profile.websiteUrl) lines.push(`ওয়েবসাইট: ${profile.websiteUrl}`);
  return lines;
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_BN: Record<string, string> = { sun: "রবিবার", mon: "সোমবার", tue: "মঙ্গলবার", wed: "বুধবার", thu: "বৃহস্পতিবার", fri: "শুক্রবার", sat: "শনিবার" };

/** Business-hours facts: today's window + open verdict. */
export function hoursFactLines(profile: any, now = new Date()): string[] {
  const hours = profile?.businessHours;
  if (!hours?.windows) return [];
  const tz = typeof hours.timezone === "string" && hours.timezone ? hours.timezone : "Asia/Dhaka";
  let dayKey = "sun";
  try {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now).toLowerCase().slice(0, 3);
    if (DAY_KEYS.includes(wd)) dayKey = wd;
  } catch { /* default tz math below still uses the stored windows */ }
  const today = (hours.windows as Record<string, [string, string][]>)[dayKey] ?? [];
  const lines: string[] = [];
  if (today.length) {
    lines.push(`আজ (${DAY_BN[dayKey]}) খোলা: ${today.map(([s, e]) => `${s}–${e}`).join(", ")}`);
    lines.push(isWithinSchedule({ timezone: tz, windows: hours.windows }, now) ? "এই মুহূর্তে ব্যবসা খোলা আছে" : "এই মুহূর্তে ব্যবসা বন্ধ আছে");
  } else {
    lines.push(`আজ (${DAY_BN[dayKey]}) ব্যবসা বন্ধ`);
  }
  if (profile.returnWindowDays != null) lines.push(`রিটার্নের সময়সীমা: ${profile.returnWindowDays} দিন`);
  return lines;
}
