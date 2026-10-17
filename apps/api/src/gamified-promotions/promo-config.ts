import { BadRequestException } from "@nestjs/common";

/**
 * NF6 (FB3) — gamified-promotion config shapes + pure helpers.
 *
 * The campaign `config` Json is validated HERE at save time
 * (staff writes) and re-validated defensively at play time, so
 * a hand-edited row can never produce a broken wheel/quiz or a
 * prize the coupon engine would refuse. All merchant-facing
 * failures are Bengali 400s (the discounts.ts pattern).
 *
 * Prize kinds deliberately reuse the StoreDiscount vocabulary:
 * percent (1–90) | fixed (minor units, >= 1). "none" is the
 * wheel's "nothing" segment. free_shipping is NOT a prize kind
 * in NF6 v1 (a wheel prize must be a plain price discount).
 */

export const PROMO_KINDS = ["spin_wheel", "quiz", "group_buy"] as const;
export const PRIZE_KINDS = ["none", "percent", "fixed"] as const;
export const PLACEMENT_TRIGGERS = ["delay_seconds", "scroll_percent", "exit_intent"] as const;

/** The honest group-buy copy shown to shoppers (dashboard +
 * storefront share this exact string): v1 takes NO prepayment. */
export const GROUP_BUY_NO_PREPAYMENT_NOTE =
  "গ্রুপ বাইয়ে কোনো অগ্রিম পেমেন্ট নেওয়া হয় না। নির্দিষ্ট সংখ্যক ক্রেতা যোগ দিলেই ছাড়ের কুপন চালু হবে — কুপন কোডটি দিয়ে চেকআউটের সময় নিজে অর্ডার সম্পন্ন করবেন।";

export interface WheelSegment {
  label: string;
  weight: number;
  prizeKind: "none" | "percent" | "fixed";
  prizeValue: number; // percent 1-90 | fixed minor units; 0 when none
}

export interface WheelConfig {
  segments: WheelSegment[];
  couponExpiryHours: number;
}

export interface QuizOption {
  text: string;
  categoryId?: string;
  categoryName?: string;
  tagSlug?: string;
}

export interface QuizQuestion {
  text: string;
  options: QuizOption[];
}

export interface QuizConfig {
  questions: QuizQuestion[];
  completionCoupon: { kind: "percent" | "fixed"; value: number } | null;
  couponExpiryHours: number;
}

export interface GroupBuyConfig {
  productId: string;
  requiredBuyers: number;
  discountKind: "percent" | "fixed";
  discountValue: number;
  couponExpiryHours: number;
}

function bad(msg: string): BadRequestException {
  return new BadRequestException(msg);
}

function expiryHours(raw: unknown): number {
  if (raw === undefined || raw === null) return 72;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 24 * 30) {
    throw bad("কুপনের মেয়াদ ১ থেকে ৭২০ ঘণ্টার মধ্যে হতে হবে");
  }
  return n;
}

function prizeFields(raw: any, label: string): { prizeKind: "none" | "percent" | "fixed"; prizeValue: number } {
  const kind = String(raw?.prizeKind ?? "none");
  if (!(PRIZE_KINDS as readonly string[]).includes(kind)) {
    throw bad(`${label}: পুরস্কারের ধরন সঠিক নয়`);
  }
  if (kind === "none") return { prizeKind: "none", prizeValue: 0 };
  const value = Number(raw?.prizeValue);
  if (kind === "percent" && (!Number.isInteger(value) || value < 1 || value > 90)) {
    throw bad(`${label}: শতাংশ ছাড় ১ থেকে ৯০-এর মধ্যে হতে হবে`);
  }
  if (kind === "fixed" && (!Number.isInteger(value) || value < 1)) {
    throw bad(`${label}: নির্দিষ্ট ছাড়ের পরিমাণ সঠিক নয়`);
  }
  return { prizeKind: kind as "percent" | "fixed", prizeValue: value };
}

export function validateWheelConfig(raw: unknown): WheelConfig {
  const cfg = (raw ?? {}) as any;
  const segmentsRaw = cfg.segments;
  if (!Array.isArray(segmentsRaw) || segmentsRaw.length < 2 || segmentsRaw.length > 12) {
    throw bad("স্পিন হুইলে ২ থেকে ১২টি সেগমেন্ট থাকতে হবে");
  }
  const segments: WheelSegment[] = segmentsRaw.map((s: any, i: number) => {
    const label = String(s?.label ?? "").trim();
    if (!label) throw bad(`সেগমেন্ট ${i + 1}: লেবেল আবশ্যক`);
    const weight = Number(s?.weight);
    if (!Number.isInteger(weight) || weight < 0 || weight > 10000) {
      throw bad(`সেগমেন্ট ${i + 1}: ওজন ০ থেকে ১০০০০-এর মধ্যে পূর্ণসংখ্যা হতে হবে`);
    }
    return { label: label.slice(0, 80), weight, ...prizeFields(s, `সেগমেন্ট ${i + 1}`) };
  });
  if (segments.reduce((a, s) => a + s.weight, 0) <= 0) {
    throw bad("অন্তত একটি সেগমেন্টের ওজন ০-এর বেশি হতে হবে");
  }
  return { segments, couponExpiryHours: expiryHours(cfg.couponExpiryHours) };
}

export function totalWeight(config: WheelConfig): number {
  return config.segments.reduce((a, s) => a + s.weight, 0);
}

/**
 * The ONLY place a spin outcome is decided: a server-drawn
 * roll in [0, totalWeight) walks the segment weights. Anything
 * a client submits about the outcome is never an input here.
 */
export function pickWheelSegment(config: WheelConfig, roll: number): number {
  const total = totalWeight(config);
  let r = Math.floor(roll);
  if (r < 0) r = 0;
  if (r >= total) r = total - 1;
  let acc = 0;
  for (let i = 0; i < config.segments.length; i++) {
    acc += config.segments[i].weight;
    if (r < acc) return i;
  }
  return config.segments.length - 1;
}

/** The mapping key one quiz option votes for (null = no vote). */
export function optionKey(opt: QuizOption): string | null {
  if (opt.categoryId) return `cat:${opt.categoryId}`;
  if (opt.tagSlug) return `tag:${opt.tagSlug}`;
  if (opt.categoryName) return `catname:${opt.categoryName}`;
  return null;
}

export function validateQuizConfig(raw: unknown): QuizConfig {
  const cfg = (raw ?? {}) as any;
  const questionsRaw = cfg.questions;
  if (!Array.isArray(questionsRaw) || questionsRaw.length < 1 || questionsRaw.length > 10) {
    throw bad("কুইজে ১ থেকে ১০টি প্রশ্ন থাকতে হবে");
  }
  const questions: QuizQuestion[] = questionsRaw.map((q: any, qi: number) => {
    const text = String(q?.text ?? "").trim();
    if (!text) throw bad(`প্রশ্ন ${qi + 1}: প্রশ্নের লেখা আবশ্যক`);
    const optsRaw = q?.options;
    if (!Array.isArray(optsRaw) || optsRaw.length < 2 || optsRaw.length > 6) {
      throw bad(`প্রশ্ন ${qi + 1}: ২ থেকে ৬টি অপশন থাকতে হবে`);
    }
    const options: QuizOption[] = optsRaw.map((o: any, oi: number) => {
      const opt: QuizOption = { text: String(o?.text ?? "").trim() };
      if (!opt.text) throw bad(`প্রশ্ন ${qi + 1}, অপশন ${oi + 1}: লেখা আবশ্যক`);
      if (o?.categoryId) opt.categoryId = String(o.categoryId);
      if (o?.tagSlug) opt.tagSlug = String(o.tagSlug);
      if (o?.categoryName) opt.categoryName = String(o.categoryName);
      if (!optionKey(opt)) {
        throw bad(`প্রশ্ন ${qi + 1}, অপশন ${oi + 1}: প্রতিটি অপশনের সঙ্গে একটি ক্যাটাগরি বা ট্যাগ যুক্ত করতে হবে`);
      }
      return opt;
    });
    return { text: text.slice(0, 300), options };
  });
  let completionCoupon: QuizConfig["completionCoupon"] = null;
  if (cfg.completionCoupon != null) {
    const { prizeKind, prizeValue } = prizeFields(
      { prizeKind: cfg.completionCoupon.kind, prizeValue: cfg.completionCoupon.value },
      "সমাপনী কুপন",
    );
    if (prizeKind === "none") throw bad("সমাপনী কুপনের ধরন সঠিক নয়");
    completionCoupon = { kind: prizeKind, value: prizeValue };
  }
  return { questions, completionCoupon, couponExpiryHours: expiryHours(cfg.couponExpiryHours) };
}

/**
 * Score a completed quiz: each answer votes for its option's
 * mapping key; the winner is the highest tally, ties broken by
 * the EARLIEST first vote (deterministic — same answers always
 * give the same result). Returns the winning key or null when
 * no answer carried a mapping (impossible post-validation).
 */
export function scoreQuiz(config: QuizConfig, answers: number[]): string | null {
  const tally = new Map<string, { count: number; firstAt: number }>();
  answers.forEach((answerIdx, qi) => {
    const opt = config.questions[qi]?.options[answerIdx];
    if (!opt) return;
    const key = optionKey(opt);
    if (!key) return;
    const cur = tally.get(key);
    if (cur) cur.count += 1;
    else tally.set(key, { count: 1, firstAt: qi });
  });
  let winner: string | null = null;
  let best = -1;
  let bestFirst = Number.POSITIVE_INFINITY;
  for (const [key, v] of tally.entries()) {
    if (v.count > best || (v.count === best && v.firstAt < bestFirst)) {
      winner = key;
      best = v.count;
      bestFirst = v.firstAt;
    }
  }
  return winner;
}

export function validateGroupBuyConfig(raw: unknown): GroupBuyConfig {
  const cfg = (raw ?? {}) as any;
  const productId = String(cfg.productId ?? "").trim();
  if (!productId) throw bad("গ্রুপ বাইয়ের জন্য একটি পণ্য বেছে নিতে হবে");
  const requiredBuyers = Number(cfg.requiredBuyers);
  if (!Number.isInteger(requiredBuyers) || requiredBuyers < 2 || requiredBuyers > 1000) {
    throw bad("গ্রুপ বাইয়ে ২ থেকে ১০০০ জন ক্রেতা লাগতে পারে");
  }
  const { prizeKind, prizeValue } = prizeFields(
    { prizeKind: cfg.discountKind, prizeValue: cfg.discountValue },
    "গ্রুপ বাই ছাড়",
  );
  if (prizeKind === "none") throw bad("গ্রুপ বাইয়ের ছাড়ের ধরন সঠিক নয়");
  return {
    productId,
    requiredBuyers,
    discountKind: prizeKind,
    discountValue: prizeValue,
    couponExpiryHours: expiryHours(cfg.couponExpiryHours),
  };
}

/** Shopper-facing discount label, derived from the same
 * kind/value the coupon engine will honour — never free text. */
export function discountLabel(kind: string, value: number): string {
  if (kind === "percent") return `${value}% ছাড়`;
  if (kind === "fixed") return `৳${value / 100} ছাড়`;
  return "";
}
