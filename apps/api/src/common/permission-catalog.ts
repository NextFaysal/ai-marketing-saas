import { Role } from "@repo/db";
import { hasRoleAtLeast } from "./permissions";

/**
 * Milestone 72 (Team W3): the custom-access permission catalog.
 *
 * Roles stay the baseline (a fixed hierarchy, RolesGuard).
 * Custom access layers per-member GRANTS and DENIES over the
 * areas below, enforced by RolesGuard only on endpoints
 * tagged @PermissionArea(...):
 *   - a DENY blocks the member even when their role passes;
 *   - a GRANT admits the member even when their role is below
 *     the endpoint's requirement — EXCEPT owner-only gates
 *     (an endpoint whose @Roles is exactly ["OWNER"]), which
 *     are never grantable;
 *   - overrides never apply to the OWNER's own membership
 *     (the owner cannot be locked out of their own org);
 *   - untagged endpoints keep pure role behavior.
 *
 * `minRole` is the baseline: the lowest role that has the
 * area by role alone. It drives the editor's "role default"
 * display and the effective-access preview.
 */
export interface PermissionAreaDef {
  key: string;
  labelBn: string;
  label: string;
  minRole: Role;
  noteBn: string;
}

export const PERMISSION_AREAS: PermissionAreaDef[] = [
  { key: "inbox", labelBn: "ইনবক্স ও মেসেজিং", label: "Inbox & messaging", minRole: "SUPPORT_AGENT" as Role, noteBn: "কথোপকথন দেখা, জবাব দেওয়া, টিম ও অটোমেশন সেটিং" },
  { key: "orders", labelBn: "অর্ডার", label: "Orders", minRole: "SUPPORT_AGENT" as Role, noteBn: "অর্ডার দেখা ও হাতে অর্ডার তোলা" },
  { key: "customers", labelBn: "গ্রাহক ও লিড", label: "Customers & leads", minRole: "SUPPORT_AGENT" as Role, noteBn: "গ্রাহক তালিকা, লিড বোর্ড, CRM" },
  { key: "courier", labelBn: "কুরিয়ার", label: "Courier", minRole: "SUPPORT_AGENT" as Role, noteBn: "কুরিয়ার বুকিং, শিপমেন্ট, চার্জ" },
  { key: "campaigns", labelBn: "ক্যাম্পেইন", label: "Campaigns", minRole: "MARKETING_MANAGER" as Role, noteBn: "বিজ্ঞাপন ক্যাম্পেইন তৈরি ও প্রকাশ, ব্রডকাস্ট" },
  { key: "social", labelBn: "সোশ্যাল পোস্ট", label: "Social posts", minRole: "MARKETING_MANAGER" as Role, noteBn: "সোশ্যাল মিডিয়া পোস্ট তৈরি, শিডিউল ও প্রকাশ" },
  { key: "ads", labelBn: "বিজ্ঞাপন ব্যবস্থাপনা", label: "Ads management", minRole: "ADVERTISER" as Role, noteBn: "অডিয়েন্স, ক্রিয়েটিভ, ক্যাটালগ, রূপান্তর" },
  { key: "ai", labelBn: "AI সহকারী ও জ্ঞানভান্ডার", label: "AI assistant & knowledge", minRole: "MARKETING_MANAGER" as Role, noteBn: "AI চ্যাট, রিপোর্ট, ব্যবসার তথ্য" },
  { key: "analytics", labelBn: "অ্যানালিটিক্স", label: "Analytics", minRole: "ANALYST" as Role, noteBn: "বিক্রি/লাভের হিসাব, প্রতিযোগী, অ্যাট্রিবিউশন" },
  { key: "automations", labelBn: "অটোমেশন", label: "Automations", minRole: "MARKETING_MANAGER" as Role, noteBn: "ওয়ার্কফ্লো, নির্ধারিত কাজ, নিয়ম" },
  { key: "integrations", labelBn: "ইন্টিগ্রেশন ও ইমপোর্ট", label: "Integrations & imports", minRole: "ADMIN" as Role, noteBn: "স্টোর/চ্যানেল যুক্ত করা, CSV ইমপোর্ট" },
  { key: "billing", labelBn: "বিলিং", label: "Billing", minRole: "ADMIN" as Role, noteBn: "প্ল্যান, পেমেন্ট, সাবস্ক্রিপশন" },
  { key: "team", labelBn: "টিম ব্যবস্থাপনা", label: "Team management", minRole: "ADMIN" as Role, noteBn: "সদস্য, ভূমিকা, আমন্ত্রণ" },
  { key: "settings", labelBn: "সেটিংস", label: "Settings", minRole: "ADMIN" as Role, noteBn: "ব্যবসার প্রোফাইল ও Organization সেটিং" },
];

export const PERMISSION_AREA_KEYS: string[] = PERMISSION_AREAS.map((a) => a.key);
const AREA_BY_KEY = new Map(PERMISSION_AREAS.map((a) => [a.key, a]));

export interface PermissionOverrides { grants: string[]; denies: string[] }

/** Sanitize stored/requested overrides: known keys only,
 * deduped, and a key can never be both — deny wins. */
export function normalizeOverrides(raw: unknown): PermissionOverrides {
  const src = (raw && typeof raw === "object" ? raw : {}) as { grants?: unknown; denies?: unknown };
  const clean = (v: unknown): string[] =>
    Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === "string" && AREA_BY_KEY.has(k)))] : [];
  const denies = clean(src.denies);
  const grants = clean(src.grants).filter((k) => !denies.includes(k));
  return { grants, denies };
}

/**
 * CC17 (Connect Center Advanced): sanitize a member's stored
 * CONNECTION deny-list (Membership.deniedConnections) — a JSON
 * array of connection target ids (Integration / SocialAccount
 * row ids) the member may not USE. Kept apart from
 * PermissionOverrides above: those are strictly permission-area
 * keys, these are row ids. Strings only, deduped, capped.
 */
export function normalizeDeniedConnections(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 64);
  return [...new Set(ids.map((v) => v.trim()))].slice(0, 500);
}

/**
 * Is this member denied the use of this connection target?
 * M72 semantics: the OWNER is never restricted, and a user with
 * no membership row is not decided here (callers keep their
 * existing behaviour for non-members/system actors).
 */
export function isConnectionDenied(
  membership: { role?: string | null; deniedConnections?: unknown } | null | undefined,
  targetId: string | null | undefined,
): boolean {
  if (!membership || !targetId) return false;
  if (membership.role === "OWNER") return false;
  return normalizeDeniedConnections(membership.deniedConnections).includes(targetId);
}

/**
 * CC27 (Connect Center Next): the async form of the deny check
 * for send/publish/sync paths that do not already hold a
 * membership row — reads the actor's ACTIVE membership
 * defensively (the codebase's safeFindMany discipline: a failed
 * lookup means "no deny-list to enforce", never a crash that
 * takes the path down) and applies isConnectionDenied. Returns
 * true ONLY on a positive recorded denial. A null/blank actor or
 * target is never a denial — paths whose actor is not recorded
 * stay ungated BY DESIGN and are listed as such in
 * docs/connect-center-b12-acceptance.md.
 */
export async function isMemberConnectionDenied(
  prisma: any,
  organizationId: string,
  userId: string | null | undefined,
  targetId: string | null | undefined,
): Promise<boolean> {
  if (!userId || !targetId) return false;
  const membership = await prisma?.membership?.findFirst?.({
    where: { organizationId, userId, status: "ACTIVE" },
  }).catch(() => null);
  if (!membership) return false;
  return isConnectionDenied(membership, targetId);
}

/** Reject unknown area keys in a write payload (strict). */
export function findUnknownAreas(raw: { grants?: unknown; denies?: unknown }): string[] {
  const bad: string[] = [];
  for (const v of [raw?.grants, raw?.denies]) {
    if (!Array.isArray(v)) continue;
    for (const k of v) if (typeof k !== "string" || !AREA_BY_KEY.has(k)) bad.push(String(k));
  }
  return bad;
}

/**
 * GB6 (GC16): preset role profiles. Deliberately NOT new Role
 * enum values — the linear rank hierarchy cannot express the
 * FINANCE subset (billing's minRole is ADMIN, so an enum
 * FINANCE would need rank >= 80 and would inherit every ADMIN
 * area) nor INVENTORY_MANAGER (products/inventory controllers
 * are role-list endpoints with no area tag). Instead a profile
 * is a named bundle of permission AREAS, materialized per org
 * as a CustomRole row with presetKey set; a member assigned
 * that custom role reaches exactly the listed areas (plus any
 * per-member grants, minus any denies) on area-tagged
 * endpoints. The profile governs area surfaces only — the
 * member's base preset role still governs role-list endpoints.
 */
export interface PresetRoleProfile {
  key: string;
  label: string;
  labelBn: string;
  areas: string[];
  noteBn: string;
}

export const PRESET_ROLE_PROFILES: PresetRoleProfile[] = [
  {
    key: "ORDER_MANAGER",
    label: "Order Manager",
    labelBn: "অর্ডার ম্যানেজার",
    areas: ["inbox", "orders", "customers", "courier", "analytics"],
    noteBn: "অর্ডার, ইনবক্স, গ্রাহক, কুরিয়ার ও অ্যানালিটিক্স — দৈনন্দিন অর্ডার পরিচালনার জন্য",
  },
  {
    key: "INVENTORY_MANAGER",
    label: "Inventory Manager",
    labelBn: "ইনভেন্টরি ম্যানেজার",
    areas: ["orders", "analytics"],
    noteBn: "গুদাম/ক্রয়/ফুলফিলমেন্ট সবই “orders” এরিয়ার আওতায়; পণ্য/ইনভেন্টরি লেখা সদস্যের মূল ভূমিকা দিয়েই নিয়ন্ত্রিত থাকে",
  },
  {
    key: "FINANCE",
    label: "Finance",
    labelBn: "ফাইন্যান্স",
    areas: ["billing", "analytics", "orders", "customers"],
    noteBn: "বিলিং, অ্যানালিটিক্স, অর্ডার ও গ্রাহক — হিসাব-নিকাশ ও পেমেন্টের জন্য",
  },
];

export function presetProfile(key: unknown): PresetRoleProfile | undefined {
  if (typeof key !== "string") return undefined;
  return PRESET_ROLE_PROFILES.find((p) => p.key === key);
}

export type AccessSource = "owner" | "role" | "grant" | "deny" | "custom" | "none";
export interface EffectiveAccessEntry {
  key: string; labelBn: string; label: string; minRole: Role;
  allowed: boolean; source: AccessSource;
}

/** What this member can actually reach, area by area.
 * GB6 (GC16): when `customAreas` (a member's CustomRole areas)
 * is provided and the role is not OWNER, the custom role is the
 * baseline instead of the role rank: an area is allowed iff the
 * custom role lists it (source "custom"). Denies still close an
 * area outright and grants still add one. Two-argument calls
 * behave exactly as before. */
export function effectiveAccess(role: Role, overridesRaw: unknown, customAreas?: string[]): EffectiveAccessEntry[] {
  const overrides = normalizeOverrides(overridesRaw);
  const hasCustom = Array.isArray(customAreas);
  const custom = hasCustom ? customAreas!.filter((k) => AREA_BY_KEY.has(k)) : [];
  return PERMISSION_AREAS.map((a) => {
    if (role === "OWNER") return { ...a, allowed: true, source: "owner" as AccessSource };
    if (overrides.denies.includes(a.key)) return { ...a, allowed: false, source: "deny" as AccessSource };
    if (hasCustom) {
      if (custom.includes(a.key)) return { ...a, allowed: true, source: "custom" as AccessSource };
      if (overrides.grants.includes(a.key)) return { ...a, allowed: true, source: "grant" as AccessSource };
      return { ...a, allowed: false, source: "none" as AccessSource };
    }
    if (hasRoleAtLeast(role, a.minRole)) return { ...a, allowed: true, source: "role" as AccessSource };
    if (overrides.grants.includes(a.key)) return { ...a, allowed: true, source: "grant" as AccessSource };
    return { ...a, allowed: false, source: "none" as AccessSource };
  });
}
