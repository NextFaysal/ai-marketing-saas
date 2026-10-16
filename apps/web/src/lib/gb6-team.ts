/**
 * GB6 (GC16): pure helpers for Staff — custom roles, member /
 * own sessions + login history, and notification preferences.
 * Side-effect free so they are unit-testable like orders-on*.
 * The server stays the authority; these helpers only shape
 * payloads for the fixed GB6 API contracts (organizations +
 * auth controllers) and validate the forms before sending.
 */

// --- Notification categories ---------------------------------------
/**
 * MIRROR of apps/api/src/common/agent-notify.ts
 * NOTIFICATION_CATEGORIES (keys + Bengali labels). The task
 * brief for GB6 specifies the web hardcodes this catalog
 * rather than fetching it, so the settings toggles render
 * without depending on a preferences fetch; keep this list in
 * sync with the API file when categories change. (Note: the
 * my-notification-preferences GET does also return a
 * `categories` array — this mirror is the render source so the
 * UI is stable even if that payload shape changes.)
 */
export interface NotificationCategory { key: string; labelBn: string; label: string }

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  { key: "orders", labelBn: "অর্ডার", label: "Orders" },
  { key: "inbox", labelBn: "ইনবক্স", label: "Inbox" },
  { key: "inventory", labelBn: "ইনভেন্টরি", label: "Inventory" },
  { key: "billing", labelBn: "বিলিং", label: "Billing" },
  { key: "marketing", labelBn: "মার্কেটিং", label: "Marketing" },
  { key: "automation", labelBn: "অটোমেশন", label: "Automation" },
  { key: "leads", labelBn: "লিড", label: "Leads" },
  { key: "general", labelBn: "সাধারণ", label: "General" },
];

export const NOTIFICATION_CATEGORY_KEYS: string[] = NOTIFICATION_CATEGORIES.map((c) => c.key);

/** A category is ON unless it is in mutedCategories. */
export function isCategoryEnabled(mutedCategories: readonly string[], key: string): boolean {
  return !mutedCategories.includes(key);
}

/**
 * Toggle one category: muting adds the key, unmuting removes
 * it. The result is deduped, restricted to known catalog keys
 * and returned in CATALOG order so the PATCH payload is
 * deterministic (the server validates keys and dedupes too).
 */
export function toggleMutedCategory(mutedCategories: readonly string[], key: string): string[] {
  if (!NOTIFICATION_CATEGORY_KEYS.includes(key)) return [...mutedCategories];
  const next = new Set(mutedCategories.filter((k) => NOTIFICATION_CATEGORY_KEYS.includes(k)));
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return NOTIFICATION_CATEGORY_KEYS.filter((k) => next.has(k));
}

// --- Custom roles ----------------------------------------------------

export interface CustomRole {
  id: string;
  name: string;
  areas: string[];
  presetKey?: string | null;
  memberCount: number;
}

export interface PresetRoleProfile {
  key: string;
  label: string;
  labelBn: string;
  noteBn: string;
  areas: string[];
}

export interface CustomRolesResponse {
  roles: CustomRole[];
  presetProfiles: PresetRoleProfile[];
}

/**
 * Build a POST /custom-roles payload.
 * Server contract (createCustomRole): presetKey must be sent
 * ALONE — an explicit name/areas alongside it is a 400, so
 * the preset path returns exactly { presetKey }. The scratch
 * path requires a 1–60 char name and at least one area.
 */
export function buildCustomRolePayload(input:
  | { mode: "preset"; presetKey: string }
  | { mode: "scratch"; name: string; areas: readonly string[] },
): { payload: { presetKey: string } | { name: string; areas: string[] } | null; errors: string[] } {
  if (input.mode === "preset") {
    const presetKey = input.presetKey.trim();
    if (!presetKey) return { payload: null, errors: ["একটি প্রিসেট বেছে নিন।"] };
    return { payload: { presetKey }, errors: [] };
  }
  const errors: string[] = [];
  const name = input.name.trim();
  if (name.length < 1 || name.length > 60) errors.push("কাস্টম রোলের নাম ১–৬০ অক্ষরের হতে হবে।");
  const areas = [...new Set(input.areas)];
  if (areas.length === 0) errors.push("কমপক্ষে একটি অনুমতির এলাকা বেছে নিন।");
  if (errors.length) return { payload: null, errors };
  return { payload: { name, areas }, errors: [] };
}

/** Build a PATCH /custom-roles/:id payload (name + areas). */
export function buildCustomRoleUpdatePayload(
  name: string,
  areas: readonly string[],
): { payload: { name: string; areas: string[] } | null; errors: string[] } {
  const out = buildCustomRolePayload({ mode: "scratch", name, areas });
  if (!out.payload || "presetKey" in out.payload) return { payload: null, errors: out.errors };
  return { payload: out.payload, errors: [] };
}

// --- Sessions + login history ----------------------------------------

export interface OwnSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip?: string | null;
  userAgent?: string | null;
  /** auth/sessions only: true for the session making the
   * request. Member session rows (org endpoint) have no flag. */
  current?: boolean;
}

export interface MemberSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface LoginHistoryRow {
  id?: string;
  success: boolean;
  email: string;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export function isCurrentSession(session: Pick<OwnSession, "current">): boolean {
  return session.current === true;
}

/**
 * Whether the settings page offers a revoke button for an own
 * session. The API (AuthService.revokeMySession) revokes ANY
 * of the caller's own sessions including the current one —
 * revoking the current session invalidates the very token in
 * use, i.e. it logs the user out immediately. The UI therefore
 * DISABLES revoke for the current session (documented choice)
 * rather than offering a one-click self-logout with no undo.
 */
export function canRevokeOwnSession(session: Pick<OwnSession, "current">): boolean {
  return !isCurrentSession(session);
}
