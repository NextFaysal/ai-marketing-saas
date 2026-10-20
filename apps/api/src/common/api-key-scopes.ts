/**
 * Admin Polish AP3: scopes for admin API keys.
 *
 * A grant is `area:read`, `area:write` or `area:*`;
 * the single grant `*` means full access. Keys whose
 * stored scope list is EMPTY keep the historical
 * full access (they predate scopes) — the console
 * labels them as such; newly created keys default to
 * what the creator ticks, and an explicit empty
 * selection at creation means read-nothing (the
 * service requires at least one grant or "*").
 */
import { badRequest } from "../i18n/api-exception";

export const API_KEY_AREAS = ["tenants", "billing", "growth", "admins", "system"] as const;
export type ApiKeyArea = (typeof API_KEY_AREAS)[number];

const SEGMENT_AREA: Record<string, ApiKeyArea> = {
  orgs: "tenants",
  billing: "billing",
  payments: "billing",
  referrals: "growth",
  users: "admins",
  security: "admins",
  totp: "admins",
  "api-keys": "admins",
  "view-as": "admins",
  "platform-config": "system",
  system: "system",
  health: "system",
  settings: "system",
  changelog: "system",
  analytics: "system",
};

/** Which grant a request needs, from its method + path. */
export function requiredGrant(method: string, url: string): string {
  const path = String(url).split("?")[0];
  const idx = path.indexOf("/admin/");
  const rest = idx >= 0 ? path.slice(idx + "/admin/".length) : "";
  const segment = rest.split("/").filter(Boolean)[0] ?? "";
  const area: ApiKeyArea = SEGMENT_AREA[segment] ?? "system";
  const verb = ["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase()) ? "read" : "write";
  return `${area}:${verb}`;
}

export function hasScope(scopes: string[] | null | undefined, grant: string): boolean {
  const list = scopes ?? [];
  if (!list.length) return true; // legacy keys: full access (documented)
  if (list.includes("*") || list.includes(grant)) return true;
  const area = grant.split(":")[0];
  return list.includes(`${area}:*`);
}

const GRANT_RE = /^(\*|[a-z]+:(read|write|\*))$/;

export function validateScopes(input: unknown): string[] {
  if (input === undefined || input === null) return ["*"];
  if (!Array.isArray(input)) throw badRequest("common.apiKeyScopesMustBeArray");
  const out = [...new Set(input.map((s) => String(s).trim()).filter(Boolean))];
  for (const g of out) {
    if (!GRANT_RE.test(g)) throw badRequest("common.apiKeyScopeGrantUnknown", { grant: g });
    if (g !== "*") {
      const area = g.split(":")[0];
      if (!(API_KEY_AREAS as readonly string[]).includes(area)) throw badRequest("common.apiKeyScopeAreaUnknown", { area });
    }
  }
  if (!out.length) throw badRequest("common.apiKeyScopesChooseAtLeastOne");
  return out;
}
