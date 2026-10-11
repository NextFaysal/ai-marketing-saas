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

/** Reject unknown area keys in a write payload (strict). */
export function findUnknownAreas(raw: { grants?: unknown; denies?: unknown }): string[] {
  const bad: string[] = [];
  for (const v of [raw?.grants, raw?.denies]) {
    if (!Array.isArray(v)) continue;
    for (const k of v) if (typeof k !== "string" || !AREA_BY_KEY.has(k)) bad.push(String(k));
  }
  return bad;
}

export type AccessSource = "owner" | "role" | "grant" | "deny" | "none";
export interface EffectiveAccessEntry {
  key: string; labelBn: string; label: string; minRole: Role;
  allowed: boolean; source: AccessSource;
}

/** What this member can actually reach, area by area. */
export function effectiveAccess(role: Role, overridesRaw: unknown): EffectiveAccessEntry[] {
  const overrides = normalizeOverrides(overridesRaw);
  return PERMISSION_AREAS.map((a) => {
    if (role === "OWNER") return { ...a, allowed: true, source: "owner" as AccessSource };
    if (overrides.denies.includes(a.key)) return { ...a, allowed: false, source: "deny" as AccessSource };
    if (hasRoleAtLeast(role, a.minRole)) return { ...a, allowed: true, source: "role" as AccessSource };
    if (overrides.grants.includes(a.key)) return { ...a, allowed: true, source: "grant" as AccessSource };
    return { ...a, allowed: false, source: "none" as AccessSource };
  });
}
