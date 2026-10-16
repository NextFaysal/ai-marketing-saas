/**
 * AB2 (AX3 Gift Cards) — pure gift-card helpers: code generation
 * + normalization + hashing, product gift-card config validation,
 * and the effective status / balance readers. No DB, no IO
 * (except node:crypto randomness for code generation). Money is
 * BigInt minor units everywhere.
 *
 * Code discipline (mirrors the AB1 referral-code discipline):
 *  - A code is `QG-XXXX-XXXX-XXXX` — 12 characters from an
 *    unambiguous alphabet (no I / O / 0 / 1).
 *  - The full code is NEVER stored in plaintext: the canonical
 *    form's SHA-256 (hashGiftCardCode) is the lookup key, and
 *    surfaces show only the prefix + last4.
 *  - Expiry is LAZY: a card whose expiresAt has passed reads as
 *    "expired" (and balances as 0) through effectiveGiftCardStatus
 *    / giftCardEffectiveBalanceMinor even before the expiry sweep
 *    writes the stored status.
 */
import { createHash, randomBytes } from "node:crypto";

export const GIFT_CARD_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const CODE_BODY_PATTERN = new RegExp(
  `^[${GIFT_CARD_CODE_ALPHABET}]{12}$`,
);
const CODE_UNDASHED_PATTERN = new RegExp(
  `^QG[${GIFT_CARD_CODE_ALPHABET}]{12}$`,
);
const CODE_DASHED_PATTERN = new RegExp(
  `^QG(?:-[${GIFT_CARD_CODE_ALPHABET}]{4}){3}$`,
);

function groupCodeBody(body: string): string {
  return `QG-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

/** Generate a fresh canonical gift-card code: QG-XXXX-XXXX-XXXX. */
export function generateGiftCardCode(): string {
  const bytes = randomBytes(12);
  let body = "";
  for (let i = 0; i < 12; i++) {
    body += GIFT_CARD_CODE_ALPHABET[bytes[i] % GIFT_CARD_CODE_ALPHABET.length];
  }
  return groupCodeBody(body);
}

/**
 * Normalize a user-entered code to the canonical dashed form, or
 * null when it is not a well-formed gift-card code. Accepts the
 * canonical dashed form, the undashed 14-char form (QG + 12), or
 * a bare 12-char body (the QG prefix is added). Input is trimmed,
 * uppercased, and spaces are removed before matching; every body
 * character must belong to the code alphabet.
 */
export function normalizeGiftCardCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toUpperCase().replace(/\s/g, "");
  let body: string | null = null;
  if (CODE_DASHED_PATTERN.test(s)) {
    body = s.replace(/-/g, "").slice(2);
  } else if (CODE_UNDASHED_PATTERN.test(s)) {
    body = s.slice(2);
  } else if (CODE_BODY_PATTERN.test(s)) {
    body = s;
  }
  if (!body) return null;
  return groupCodeBody(body);
}

/** SHA-256 hex of the canonical code — the DB lookup key. */
export function hashGiftCardCode(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------- product gift-card config ----------

export interface GiftCardConfig {
  presetAmountsMinor: number[];
  allowCustomAmount: boolean;
  minAmountMinor?: number | null;
  maxAmountMinor?: number | null;
}

function isPositiveSafeAmount(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

/**
 * Validate + normalize a Product.giftCardConfig. Throws Error
 * with a stable reason key; callers map it to a Bengali 400 via
 * GIFT_CARD_CONFIG_MESSAGES (the validatePromotionConfig
 * pattern).
 */
export function validateGiftCardConfig(raw: unknown): GiftCardConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("gift_card_config_invalid");
  }
  const cfg = raw as Record<string, unknown>;

  const rawPresets = cfg.presetAmountsMinor ?? [];
  if (!Array.isArray(rawPresets) || rawPresets.length > 20) {
    throw new Error("gift_card_presets_invalid");
  }
  for (const p of rawPresets) {
    if (!isPositiveSafeAmount(p) || p > 100_000_000) {
      throw new Error("gift_card_presets_invalid");
    }
  }
  const presetAmountsMinor = [...new Set(rawPresets as number[])].sort((a, b) => a - b);

  let allowCustomAmount = false;
  if (cfg.allowCustomAmount !== undefined && cfg.allowCustomAmount !== null) {
    if (typeof cfg.allowCustomAmount !== "boolean") {
      throw new Error("gift_card_allow_custom_invalid");
    }
    allowCustomAmount = cfg.allowCustomAmount;
  }

  let minAmountMinor: number | null = null;
  if (cfg.minAmountMinor !== undefined && cfg.minAmountMinor !== null) {
    if (!isPositiveSafeAmount(cfg.minAmountMinor)) {
      throw new Error("gift_card_min_invalid");
    }
    minAmountMinor = cfg.minAmountMinor;
  }
  let maxAmountMinor: number | null = null;
  if (cfg.maxAmountMinor !== undefined && cfg.maxAmountMinor !== null) {
    if (!isPositiveSafeAmount(cfg.maxAmountMinor)) {
      throw new Error("gift_card_max_invalid");
    }
    maxAmountMinor = cfg.maxAmountMinor;
  }
  if (minAmountMinor != null && maxAmountMinor != null && minAmountMinor > maxAmountMinor) {
    throw new Error("gift_card_min_gt_max");
  }

  // At least ONE way to pick an amount must exist.
  if (presetAmountsMinor.length === 0 && !allowCustomAmount) {
    throw new Error("gift_card_no_amounts");
  }
  // A custom amount with no presets to guide it needs a floor.
  if (allowCustomAmount && presetAmountsMinor.length === 0 && minAmountMinor == null) {
    throw new Error("gift_card_min_required");
  }
  if (minAmountMinor != null && maxAmountMinor != null) {
    for (const p of presetAmountsMinor) {
      if (p < minAmountMinor || p > maxAmountMinor) {
        throw new Error("gift_card_preset_out_of_range");
      }
    }
  }

  return { presetAmountsMinor, allowCustomAmount, minAmountMinor, maxAmountMinor };
}

export const GIFT_CARD_CONFIG_MESSAGES: Record<string, string> = {
  gift_card_config_invalid: "গিফট কার্ড কনফিগ সঠিক নয়",
  gift_card_presets_invalid:
    "গিফট কার্ডের preset পরিমাণগুলো সঠিক নয় (সর্বোচ্চ ২০টি ধনাত্মক পূর্ণ সংখ্যা)",
  gift_card_allow_custom_invalid: "কাস্টম পরিমাণের অনুমতির মান সঠিক নয়",
  gift_card_min_invalid: "গিফট কার্ডের সর্বনিম্ন পরিমাণ সঠিক নয়",
  gift_card_max_invalid: "গিফট কার্ডের সর্বোচ্চ পরিমাণ সঠিক নয়",
  gift_card_min_gt_max: "সর্বনিম্ন পরিমাণ সর্বোচ্চ পরিমাণের বেশি হতে পারবে না",
  gift_card_no_amounts: "কমপক্ষে একটি preset পরিমাণ দিন অথবা কাস্টম পরিমাণ চালু করুন",
  gift_card_min_required: "কাস্টম পরিমাণের জন্য সর্বনিম্ন পরিমাণ দেওয়া আবশ্যক",
  gift_card_preset_out_of_range: "Preset পরিমাণগুলো সর্বনিম্ন–সর্বোচ্চ সীমার মধ্যে হতে হবে",
};

/** Is `amountMinor` a selectable face value under this config? */
export function isGiftCardAmountAllowed(cfg: GiftCardConfig, amountMinor: bigint): boolean {
  if (amountMinor <= 0n) return false;
  for (const p of cfg.presetAmountsMinor ?? []) {
    if (BigInt(p) === amountMinor) return true;
  }
  if (!cfg.allowCustomAmount) return false;
  if (cfg.minAmountMinor != null && amountMinor < BigInt(cfg.minAmountMinor)) return false;
  if (cfg.maxAmountMinor != null && amountMinor > BigInt(cfg.maxAmountMinor)) return false;
  return true;
}

// ---------- effective status / balance (lazy expiry) ----------

/**
 * The status a reader should act on: "void" and "expired" are
 * terminal and never change; an "active" / "depleted" card whose
 * expiresAt has passed reads as "expired" (the sweep persists it
 * eventually — readers never wait for the sweep).
 */
export function effectiveGiftCardStatus(
  card: { status: string; expiresAt?: Date | string | null },
  now: Date = new Date(),
): string {
  const status = String(card?.status ?? "");
  if (status === "void") return "void";
  if (status === "expired") return "expired";
  if ((status === "active" || status === "depleted") && card?.expiresAt != null) {
    const t = new Date(card.expiresAt).getTime();
    if (!Number.isNaN(t) && t < now.getTime()) return "expired";
  }
  return status;
}

/** Spendable balance: 0 for an (effectively) expired / void card. */
export function giftCardEffectiveBalanceMinor(
  card: { status: string; expiresAt?: Date | string | null; balanceCache?: unknown },
  now: Date = new Date(),
): bigint {
  const status = effectiveGiftCardStatus(card, now);
  if (status === "expired" || status === "void") return 0n;
  try {
    return BigInt((card as any)?.balanceCache ?? 0);
  } catch {
    return 0n;
  }
}
