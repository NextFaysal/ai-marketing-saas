/**
 * OU1 (One-Umbrella OB1): pure helpers for the dashboard
 * Organization switcher. The switcher lists what
 * `GET /organizations` (OrganizationsService.listMine) returns —
 * the signed-in user's ACTIVE memberships only, each organization
 * row spread with `myRole` added. These helpers hold no state and
 * do no I/O, so the switching rules stay unit-testable; the
 * component (app/dashboard/OrgSwitcher.tsx) owns the effects.
 *
 * Switching architecture (honest): every dashboard page reads the
 * org id from localStorage at mount via getOrganizationId(), so a
 * switch stores the new id and performs a FULL page reload. There
 * is no client-side org context to patch in place — a partial
 * switch would leave stale org-scoped data on screen.
 */

import type { UiLocale } from "./i18n/dict";
import { sharedBn, sharedEn } from "./i18n/shared";

/** MB2 F2: badge/role copy resolves through the `shared`
 * namespace; locale defaults to "bn" so existing callers/tests
 * stay byte-identical. */
const SD = (locale: UiLocale = "bn"): typeof sharedBn =>
  locale === "en" ? sharedEn : sharedBn;

export interface SwitcherOrg {
  id: string;
  name: string;
  slug?: string;
  currency?: string;
  myRole?: string;
  /** ORG4 (Organization Next OB1): the platform status rides
   * along in listMine (ACTIVE | SUSPENDED | DELETED). */
  status?: string;
  /** ORG3: tenant-side archive timestamp (null/absent = live). */
  archivedAt?: string | null;
}

/** ORG4: a platform-stopped org (suspended, or soft-deleted by
 * the platform) — its members are locked out by TenantGuard and
 * the dashboard shows the explanation screen instead. */
export function orgSuspended(org: SwitcherOrg): boolean {
  return Boolean(org.status) && org.status !== "ACTIVE";
}

/** ORG3: the org's own OWNER archived it — data intact, work
 * paused until restored. */
export function orgArchived(org: SwitcherOrg): boolean {
  return Boolean(org.archivedAt);
}

/** Badge text for the switcher rows / button: suspension (the
 * harder stop) wins over archive when both somehow apply. */
export function orgStateBadge(org: SwitcherOrg, locale: UiLocale = "bn"): string | null {
  const d = SD(locale);
  if (orgSuspended(org)) return d.orgBadgeSuspended;
  if (orgArchived(org)) return d.orgBadgeArchived;
  return null;
}

/** The stored org wins when it is still one of the user's ACTIVE
 * memberships; otherwise the first membership (listMine order:
 * oldest first) — the same fallback the dashboard layout applies
 * on first login. A stored id whose membership was suspended no
 * longer appears in listMine, so it can never be reselected here. */
export function resolveCurrentOrgId(orgs: SwitcherOrg[], storedId: string | null): string | null {
  if (orgs.length === 0) return null;
  if (storedId && orgs.some((o) => o.id === storedId)) return storedId;
  return orgs[0].id;
}

/** A switch only happens when the target differs from the
 * resolved current org; re-selecting the current org is a no-op
 * (the caller just closes the menu — no reload storm). */
export function isSwitchNeeded(orgs: SwitcherOrg[], storedId: string | null, targetId: string): boolean {
  return resolveCurrentOrgId(orgs, storedId) !== targetId;
}

/** Labels for the membership roles the API can return (Role
 * enum), per locale. The bn record stays the pinned source;
 * unknown roles render as-is rather than vanishing. */
export function roleLabelsFor(locale: UiLocale = "bn"): Record<string, string> {
  const d = SD(locale);
  return {
    OWNER: d.roleOwner,
    ADMIN: d.roleAdmin,
    MARKETING_MANAGER: d.roleMarketingManager,
    ADVERTISER: d.roleAdvertiser,
    SUPPORT_AGENT: d.roleSupportAgent,
    ANALYST: d.roleAnalyst,
    VIEWER: d.roleViewer,
    SUPER_ADMIN: d.roleSuperAdmin,
  };
}

export function roleLabel(role: string | undefined | null, locale: UiLocale = "bn"): string {
  if (!role) return "";
  return roleLabelsFor(locale)[role] ?? role;
}

/** Single-org users get a quiet state, not a cluttered menu: the
 * multi-org affordances only fully open with 2+ memberships. */
export function switcherMode(orgs: SwitcherOrg[]): "empty" | "single" | "multi" {
  if (orgs.length === 0) return "empty";
  if (orgs.length === 1) return "single";
  return "multi";
}

// ---------- ORG8 (Organization Next OB2): list personalization ----------
//
// Search + per-user pin + recent ordering for the switcher.
// V1 storage is client-side only: localStorage under a key
// namespaced by the signed-in user's id (decoded from the access
// token's `sub`), so two people sharing one browser never see
// each other's pins. The trade-off is recorded honestly: pins
// and recency are PER DEVICE — a server-side preference store
// is future work, not part of this batch. Everything below is
// pure; the component owns localStorage I/O.

export interface OrgListPrefs {
  /** Org ids the user pinned, in the order they pinned them. */
  pinnedIds: string[];
  /** Org ids by last use, most recent first. */
  recentIds: string[];
}

export function emptyOrgListPrefs(): OrgListPrefs {
  return { pinnedIds: [], recentIds: [] };
}

export function orgSwitcherPrefsKey(userId: string | null | undefined): string {
  return `orgSwitcherPrefs:${userId && userId.trim() ? userId.trim() : "anon"}`;
}

/** Tolerant parse of a stored prefs blob: anything unexpected
 * (old shape, hand-edited, corrupt) degrades to empty prefs
 * rather than breaking the switcher. */
export function parseOrgListPrefs(raw: string | null): OrgListPrefs {
  if (!raw) return emptyOrgListPrefs();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyOrgListPrefs();
    const ids = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
    return { pinnedIds: ids((parsed as any).pinnedIds), recentIds: ids((parsed as any).recentIds) };
  } catch {
    return emptyOrgListPrefs();
  }
}

/** Read the user id (`sub`) out of a JWT access token without
 * verifying it — the value only namespaces a local preference
 * key, so a forged token could at worst show someone their own
 * wrong pins on their own browser. Never use this for auth. */
export function userIdFromAccessToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64);
    const json = decodeURIComponent(
      binary.split("").map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
    );
    const payload = JSON.parse(json) as { sub?: unknown };
    return typeof payload?.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Case-insensitive substring search over name and slug. An
 * empty/blank query returns the list untouched (same order). */
export function filterSwitcherOrgs(orgs: SwitcherOrg[], query: string): SwitcherOrg[] {
  const q = query.trim().toLowerCase();
  if (!q) return orgs;
  return orgs.filter(
    (o) => o.name.toLowerCase().includes(q) || (o.slug ?? "").toLowerCase().includes(q),
  );
}

/** Display order: pinned first (in pin order), then most
 * recently used, then everything else in the incoming
 * (listMine) order. Ids that are not in the list (stale prefs
 * for an org the user left) are ignored; no org appears twice. */
export function orderSwitcherOrgs(orgs: SwitcherOrg[], prefs: OrgListPrefs): SwitcherOrg[] {
  const byId = new Map(orgs.map((o) => [o.id, o]));
  const seen = new Set<string>();
  const out: SwitcherOrg[] = [];
  const push = (id: string) => {
    const org = byId.get(id);
    if (org && !seen.has(id)) {
      seen.add(id);
      out.push(org);
    }
  };
  prefs.pinnedIds.forEach(push);
  prefs.recentIds.forEach(push);
  orgs.forEach((o) => push(o.id));
  return out;
}

/** Record a use: the org moves to the front of the recent list
 * (deduplicated), capped so the stored blob stays small. */
export function touchRecentOrg(prefs: OrgListPrefs, orgId: string, cap = 10): OrgListPrefs {
  return {
    pinnedIds: [...prefs.pinnedIds],
    recentIds: [orgId, ...prefs.recentIds.filter((id) => id !== orgId)].slice(0, Math.max(1, cap)),
  };
}

/** Pin an org, or unpin it if it is already pinned. Pin order
 * is append order — the newest pin goes last among pins. */
export function togglePinnedOrg(prefs: OrgListPrefs, orgId: string): OrgListPrefs {
  const pinned = prefs.pinnedIds.includes(orgId);
  return {
    pinnedIds: pinned ? prefs.pinnedIds.filter((id) => id !== orgId) : [...prefs.pinnedIds, orgId],
    recentIds: [...prefs.recentIds],
  };
}

export function isPinnedOrg(prefs: OrgListPrefs, orgId: string): boolean {
  return prefs.pinnedIds.includes(orgId);
}
