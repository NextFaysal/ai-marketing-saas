import { Role } from "@repo/db";

// Higher rank means more privilege. SUPER_ADMIN is platform level, handled separately.
export const ROLE_RANK: Record<Role, number> = {
  SUPER_ADMIN: 999,
  OWNER: 100,
  ADMIN: 80,
  MARKETING_MANAGER: 60,
  ADVERTISER: 50,
  SUPPORT_AGENT: 40,
  ANALYST: 30,
  VIEWER: 10,
};

export function hasRoleAtLeast(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

// Actions that always need OWNER or ADMIN inside an organization.
export const ADMIN_ACTIONS = ["org.invite", "org.settings", "billing.manage", "wallet.manage"] as const;
export function canPerformAdminAction(role: Role): boolean {
  return hasRoleAtLeast(role, "ADMIN" as Role);
}
