import { checkSlugLocally } from "@repo/contracts";
import { platformSetting } from "./platform-settings";

/**
 * TD1 — the single slug-availability decision used by BOTH
 * OrganizationsService.create (enforcement) and
 * GET /organizations/slug-available (the onboarding picker's live
 * check). There is deliberately no second implementation: whatever
 * the picker shows is exactly what create will decide.
 *
 * Format + reserved rules come from @repo/contracts (one source of
 * truth). On top of the code lists, a SUPER admin can add names at
 * runtime through the platform setting "reservedSlugsExtra" (an
 * array of slug strings, or { slugs: [...] }) — read through the
 * same defensive platformSetting path as every other M33 setting,
 * so a missing/partial table simply means "no extras".
 *
 * TD11 adds one more refusal on top: the slug cooldown. A
 * permanently deleted org leaves a SlugTombstone row; while it is
 * unreleased and unexpired the name answers reason "cooldown"
 * (distinct from the permanent "reserved"), with the exact date
 * it frees up in the message.
 */
export const RESERVED_SLUGS_EXTRA_KEY = "reservedSlugsExtra";

/** TD11: how long a permanently deleted org's slug stays parked. */
export const SLUG_TOMBSTONE_COOLDOWN_DAYS = 180;

export type SlugAvailabilityReason = "ok" | "taken" | "reserved" | "invalid" | "cooldown";

export interface SlugAvailability {
  slug: string;
  available: boolean;
  reason: SlugAvailabilityReason;
  message: string;
  /** ML10: catalog code (+ params) for the refusal, so API error
   * paths render in the request locale; `message` keeps the bn
   * text for the onboarding picker payload. */
  code?: string;
  params?: Record<string, unknown>;
}

export const SLUG_AVAILABILITY_MESSAGES: Record<Exclude<SlugAvailabilityReason, "cooldown">, string> = {
  ok: "এই নামটি খালি আছে — এটি দিয়েই আপনার দোকানের ঠিকানা হবে।",
  taken: "এই নামে ইতিমধ্যে একটি দোকান আছে — অন্য নাম বেছে নিন।",
  reserved: "এই নামটি সংরক্ষিত — প্ল্যাটফর্মের নিজের বা বিভ্রান্তিকর নাম হওয়ায় এটি দোকানের ঠিকানা হিসেবে ব্যবহার করা যাবে না।",
  invalid: "নামের আকার ঠিক নেই — ছোট হাতের ইংরেজি অক্ষর, সংখ্যা ও একক হাইফেন ব্যবহার করুন (শুরুতে, শেষে বা পরপর হাইফেন নয়), ৩–৬০ অক্ষরের মধ্যে।",
};

/** TD11: the cooldown message names the exact date the name frees
 * up — a distinct reason from "reserved" (which is permanent). */
export function slugCooldownMessage(expiresAt: Date): string {
  const date = new Date(expiresAt).toLocaleDateString("bn-BD");
  return `এই নামটি সম্প্রতি মুছে ফেলা একটি দোকানের ছিল — পুরনো ঠিকানা অন্যের হাতে যাওয়া ঠেকাতে ${date} পর্যন্ত নামটি নেওয়া যাবে না।`;
}

export async function reservedSlugExtras(prisma: any): Promise<string[]> {
  const raw: any = await platformSetting(prisma, RESERVED_SLUGS_EXTRA_KEY);
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.slugs) ? raw.slugs : [];
  return list.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
}

export async function slugAvailability(prisma: any, rawSlug: unknown): Promise<SlugAvailability> {
  const slug = typeof rawSlug === "string" ? rawSlug : "";
  const extras = await reservedSlugExtras(prisma);
  const local = checkSlugLocally(slug, extras);
  if (!local.ok) {
    return {
      slug, available: false, reason: local.reason, message: SLUG_AVAILABILITY_MESSAGES[local.reason],
      code: local.reason === "reserved" ? "common.slugReserved" : "common.slugInvalidFormat",
    };
  }
  const taken = await prisma.organization.findUnique({ where: { slug } });
  if (taken) {
    return { slug, available: false, reason: "taken", message: SLUG_AVAILABILITY_MESSAGES.taken };
  }
  // TD11: slug cooldown — a permanently deleted org's slug stays
  // parked until its tombstone expires or a SUPER admin releases
  // it. Expired/released rows remain as history and block
  // nothing. A schema without the table (older fake/client)
  // simply means "no tombstones".
  const tombstone = (await prisma.slugTombstone?.findUnique?.({ where: { slug } }).catch(() => null)) ?? null;
  if (tombstone && !tombstone.releasedAt && new Date(tombstone.expiresAt).getTime() > Date.now()) {
    return {
      slug, available: false, reason: "cooldown", message: slugCooldownMessage(new Date(tombstone.expiresAt)),
      code: "common.slugCooldown",
      params: { date: new Date(tombstone.expiresAt).toLocaleDateString("bn-BD") },
    };
  }
  return { slug, available: true, reason: "ok", message: SLUG_AVAILABILITY_MESSAGES.ok };
}
