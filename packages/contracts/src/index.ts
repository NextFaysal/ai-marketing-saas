import { z } from "zod";

export const roleSchema = z.enum([
  "SUPER_ADMIN", "OWNER", "ADMIN", "MARKETING_MANAGER",
  "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER",
]);
export type Role = z.infer<typeof roleSchema>;

export const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---------- TD1: slug / shop-subdomain rules ----------
// An organization's slug IS its public shop address:
// {slug}.qosprey.com. One source of truth for the format and the
// reserved-name rules lives here; the contracts schema, the API
// (OrganizationsService.create + GET /organizations/slug-available)
// and the web onboarding picker all consume these helpers — there
// is deliberately no second copy of the rules anywhere.
export const PLATFORM_APEX_DOMAIN = "qosprey.com";
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 60;
/** Lowercase letters/digits in single-hyphen-separated groups:
 * never a leading/trailing hyphen, never consecutive hyphens. */
export const SLUG_FORMAT_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Class 1 — the platform's own names (TD plan §TD1). */
export const RESERVED_SYSTEM_SLUGS = [
  "app", "admin", "api", "media", "www", "mail", "dashboard", "login",
  "register", "logout", "shop", "store", "support", "help", "pricing",
  "blog", "docs", "status", "cdn", "assets", "static", "webhook",
  "webhooks", "oauth", "auth", "account", "billing", "settings",
  "platform", "system", "root", "home", "official-site",
] as const;

/** Class 2 — misleading / impersonation names (owner examples:
 * "fake", "orgnail") plus a starter profanity list. */
export const RESERVED_MISLEADING_SLUGS = [
  "qosprey", "fake", "official", "verified", "original", "orgnail",
  "genuine", "authentic",
  // starter profanity/abuse list (exact names only)
  "porn", "porno", "sex", "xxx", "adult", "casino", "gambling",
] as const;

/** Class 3 — names reserved for future platform products. */
export const RESERVED_FUTURE_SLUGS = [
  "pay", "wallet", "ads", "ai", "inbox", "crm",
] as const;

export const RESERVED_SLUGS: ReadonlySet<string> = new Set<string>([
  ...RESERVED_SYSTEM_SLUGS,
  ...RESERVED_MISLEADING_SLUGS,
  ...RESERVED_FUTURE_SLUGS,
]);

/** Substring rule (TD plan §TD1): a slug merely CONTAINING one of
 * these is also refused — "my-admin-shop", "supportbd",
 * "officialstore" are impersonation-shaped even when not exact. */
export const RESERVED_SLUG_SUBSTRINGS = ["admin", "support", "official"] as const;

/** Format-only problem, independent of reservation/taken state. */
export function slugFormatInvalid(slug: unknown): boolean {
  if (typeof slug !== "string") return true;
  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) return true;
  return !SLUG_FORMAT_REGEX.test(slug);
}

/** Reserved check: code lists + substring rule + caller-supplied
 * extra names (the API passes SUPER-added platform-setting names).
 * Extras are exact names, normalised to lowercase. */
export function isReservedSlug(slug: string, extra?: Iterable<string>): boolean {
  const s = String(slug ?? "");
  if (RESERVED_SLUGS.has(s)) return true;
  for (const part of RESERVED_SLUG_SUBSTRINGS) if (s.includes(part)) return true;
  if (extra) {
    for (const name of extra) {
      if (String(name).trim().toLowerCase() === s) return true;
    }
  }
  return false;
}

export type SlugLocalCheck =
  | { ok: true }
  | { ok: false; reason: "invalid" | "reserved" };

/** Everything about a slug that can be decided WITHOUT the
 * database. "taken" is decided by the API on top of this. */
export function checkSlugLocally(slug: unknown, extra?: Iterable<string>): SlugLocalCheck {
  if (slugFormatInvalid(slug)) return { ok: false, reason: "invalid" };
  if (isReservedSlug(slug as string, extra)) return { ok: false, reason: "reserved" };
  return { ok: true };
}

export function shopSubdomainHost(slug: string): string {
  return `${slug}.${PLATFORM_APEX_DOMAIN}`;
}

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().regex(SLUG_FORMAT_REGEX, "slug must be lowercase letters, numbers and single hyphens (no leading, trailing or consecutive hyphens)").min(SLUG_MIN_LENGTH).max(SLUG_MAX_LENGTH),
  country: z.string().length(2).default("BD"),
  timezone: z.string().default("Asia/Dhaka"),
  currency: z.string().length(3).default("BDT"),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: roleSchema.exclude(["SUPER_ADMIN", "OWNER"]),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateBusinessProfileSchema = z.object({
  description: z.string().max(2000).optional(),
  industry: z.string().max(100).optional(),
  businessModel: z.string().max(100).optional(),
  websiteUrl: z.string().url().optional().or(z.literal("")),
  goals: z.string().max(2000).optional(),
  brandVoice: z.string().max(1000).optional(),
  uniqueSellingPoints: z.string().max(2000).optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  contactPhone: z.string().max(30).optional(),
});
export type UpdateBusinessProfileInput = z.infer<typeof updateBusinessProfileSchema>;

// ---------- Money helpers (shared by web forms and API) ----------
// Money is stored as integer minor units. "1250.50" BDT -> 125050 poisha.
export function parseMoneyToMinor(input: string | number): bigint {
  const raw = String(input).trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error(`Invalid money value: ${input}`);
  }
  const negative = raw.startsWith("-");
  const [whole, frac = ""] = (negative ? raw.slice(1) : raw).split(".");
  const minor = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return negative ? -minor : minor;
}

export function formatMinor(minor: bigint | number, currency = "BDT"): string {
  const value = typeof minor === "bigint" ? minor : BigInt(Math.round(minor));
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100n;
  const frac = String(abs % 100n).padStart(2, "0");
  return `${negative ? "-" : ""}${currency} ${whole.toString()}.${frac}`;
}

// ---------- Products ----------
export const productStatusSchema = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);

export const createProductSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(5000).optional(),
  category: z.string().max(100).optional(),
  sku: z.string().max(100).optional(),
  status: productStatusSchema.default("ACTIVE"),
  price: z.string(), // decimal string, converted to minor units server-side
  compareAtPrice: z.string().optional(),
  currency: z.string().length(3).default("BDT"),
  stockQuantity: z.number().int().min(0).optional(),
  imageUrl: z.string().url().optional().or(z.literal("")),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const setProductCostSchema = z.object({
  cost: z.string(), // decimal string -> minor units
  currency: z.string().length(3).default("BDT"),
  variantId: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
});
export type SetProductCostInput = z.infer<typeof setProductCostSchema>;

export const createVariantSchema = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().max(100).optional(),
  price: z.string().optional(),
  stockQuantity: z.number().int().min(0).optional(),
});
export type CreateVariantInput = z.infer<typeof createVariantSchema>;

// ---------- Policies & knowledge ----------
export const policyTypeSchema = z.enum(["shipping", "delivery", "refund", "return", "cancellation", "payment", "custom"]);
export const upsertPolicySchema = z.object({
  type: policyTypeSchema,
  title: z.string().min(2).max(200),
  content: z.string().min(2).max(10000),
});
export type UpsertPolicyInput = z.infer<typeof upsertPolicySchema>;

export const createKnowledgeDocSchema = z.object({
  title: z.string().min(2).max(200),
  content: z.string().min(2).max(10000),
  kind: z.enum(["faq", "note", "claim", "template"]).default("faq"),
});
export type CreateKnowledgeDocInput = z.infer<typeof createKnowledgeDocSchema>;

// ---------- Bangladesh districts (EC8: native storefront shipping zones) ----------
// The canonical 64 districts of Bangladesh, in Bengali, grouped by
// division. Shared by the API (zone matching: "ঢাকা" === inside Dhaka)
// and the web shop/checkout district pickers. Do not add upazilas or
// cities here — district_list shipping zones match these names exactly.
export const BD_DISTRICTS = [
  // ঢাকা বিভাগ + ময়মনসিংহ বিভাগ
  "ঢাকা", "ফরিদপুর", "গাজীপুর", "গোপালগঞ্জ", "জামালপুর", "কিশোরগঞ্জ",
  "মাদারীপুর", "মানিকগঞ্জ", "মুন্সিগঞ্জ", "ময়মনসিংহ", "নারায়ণগঞ্জ",
  "নরসিংদী", "নেত্রকোণা", "রাজবাড়ী", "শরীয়তপুর", "শেরপুর", "টাঙ্গাইল",
  // রাজশাহী বিভাগ
  "বগুড়া", "জয়পুরহাট", "নওগাঁ", "নাটোর", "চাঁপাইনবাবগঞ্জ", "পাবনা",
  "রাজশাহী", "সিরাজগঞ্জ",
  // রংপুর বিভাগ
  "দিনাজপুর", "গাইবান্ধা", "কুড়িগ্রাম", "লালমনিরহাট", "নীলফামারী",
  "পঞ্চগড়", "রংপুর", "ঠাকুরগাঁও",
  // বরিশাল বিভাগ
  "বরগুনা", "বরিশাল", "ভোলা", "ঝালকাঠি", "পটুয়াখালী", "পিরোজপুর",
  // চট্টগ্রাম বিভাগ
  "বান্দরবান", "ব্রাহ্মণবাড়িয়া", "চাঁদপুর", "চট্টগ্রাম", "কুমিল্লা",
  "কক্সবাজার", "ফেনী", "খাগড়াছড়ি", "লক্ষ্মীপুর", "নোয়াখালী", "রাঙ্গামাটি",
  // খুলনা বিভাগ
  "খুলনা", "যশোর", "ঝিনাইদহ", "মাগুরা", "বাগেরহাট", "সাতক্ষীরা",
  "চুয়াডাঙ্গা", "কুষ্টিয়া", "মেহেরপুর", "নড়াইল",
  // সিলেট বিভাগ
  "সিলেট", "হবিগঞ্জ", "মৌলভীবাজার", "সুনামগঞ্জ",
] as const;
export type BdDistrict = (typeof BD_DISTRICTS)[number];

// ---------- CSV import ----------
// Milestone 2 transport: the browser reads the file and sends its text.
// Large files move to S3 + worker processing in a later milestone.
export const csvProductImportSchema = z.object({
  fileName: z.string().max(200).optional(),
  csvText: z.string().min(1).max(2_000_000),
});
export type CsvProductImportInput = z.infer<typeof csvProductImportSchema>;
