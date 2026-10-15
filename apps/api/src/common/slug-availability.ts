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
 */
export const RESERVED_SLUGS_EXTRA_KEY = "reservedSlugsExtra";

export type SlugAvailabilityReason = "ok" | "taken" | "reserved" | "invalid";

export interface SlugAvailability {
  slug: string;
  available: boolean;
  reason: SlugAvailabilityReason;
  message: string;
}

export const SLUG_AVAILABILITY_MESSAGES: Record<SlugAvailabilityReason, string> = {
  ok: "এই নামটি খালি আছে — এটি দিয়েই আপনার দোকানের ঠিকানা হবে।",
  taken: "এই নামে ইতিমধ্যে একটি দোকান আছে — অন্য নাম বেছে নিন।",
  reserved: "এই নামটি সংরক্ষিত — প্ল্যাটফর্মের নিজের বা বিভ্রান্তিকর নাম হওয়ায় এটি দোকানের ঠিকানা হিসেবে ব্যবহার করা যাবে না।",
  invalid: "নামের আকার ঠিক নেই — ছোট হাতের ইংরেজি অক্ষর, সংখ্যা ও একক হাইফেন ব্যবহার করুন (শুরুতে, শেষে বা পরপর হাইফেন নয়), ৩–৬০ অক্ষরের মধ্যে।",
};

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
    return { slug, available: false, reason: local.reason, message: SLUG_AVAILABILITY_MESSAGES[local.reason] };
  }
  const taken = await prisma.organization.findUnique({ where: { slug } });
  if (taken) {
    return { slug, available: false, reason: "taken", message: SLUG_AVAILABILITY_MESSAGES.taken };
  }
  return { slug, available: true, reason: "ok", message: SLUG_AVAILABILITY_MESSAGES.ok };
}
