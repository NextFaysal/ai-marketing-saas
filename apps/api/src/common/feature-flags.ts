import { orgPlan, platformSetting, PLAN_TIERS } from "./platform-settings";

/**
 * Milestone 40 (Admin Phase A4): feature-flag enforcement.
 * Flags are per-org OPT-OUT switches set from the Admin Console:
 * no row (or a row with enabled=true) means the feature is ON —
 * exactly the behavior before flags were enforced. A row with
 * enabled=false turns the feature OFF for that one org.
 * Reads are defensive: any failure means "enabled", so a flag
 * lookup can never take a production flow down.
 *
 * Admin Advanced AA7: a PLAN-DEFAULT layer now sits between the
 * org row and the built-in ON. Resolution order:
 *   1. explicit org row (OrgFeatureFlag) — always wins;
 *   2. the operator-set plan default for the org's CURRENT
 *      subscription tier (SystemSetting "planFlagDefaults",
 *      sparse — only explicitly-set flag×tier entries exist);
 *   3. ON.
 * Because the tier is read live from the latest subscription,
 * changing an org's plan changes its flag defaults too.
 * Unknown flag keys are never plan-gated: the plan layer applies
 * only to KNOWN_FLAG_KEYS (AdminService.KNOWN_FLAGS mirrors this
 * list for the console's flag editor).
 */
export const KNOWN_FLAG_KEYS = ["dayparting", "portfolio", "creative_library", "order_bot", "offline_conversions", "agency_portfolio"] as const;

/** AA7: the sanitized sparse plan-default map stored in
 * SystemSetting "planFlagDefaults": { [flagKey]: { [tier]: boolean } }.
 * Only known flags, known tiers and real booleans survive; anything
 * else in the stored value is ignored (defensive — a hand-edited or
 * legacy row can never break resolution). Never throws. */
export async function planFlagDefaults(prisma: any): Promise<Record<string, Record<string, boolean>>> {
  try {
    const raw = (await platformSetting(prisma, "planFlagDefaults")) as any;
    const out: Record<string, Record<string, boolean>> = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const key of KNOWN_FLAG_KEYS) {
      const perTier = raw[key];
      if (!perTier || typeof perTier !== "object" || Array.isArray(perTier)) continue;
      const tiers: Record<string, boolean> = {};
      for (const tier of PLAN_TIERS) {
        if (typeof perTier[tier] === "boolean") tiers[tier] = perTier[tier];
      }
      if (Object.keys(tiers).length) out[key] = tiers;
    }
    return out;
  } catch {
    return {};
  }
}

export async function orgFlagEnabled(prisma: any, organizationId: string, key: string): Promise<boolean> {
  try {
    const row = await prisma.orgFeatureFlag?.findUnique({
      where: { organizationId_key: { organizationId, key } },
    });
    if (row) return row.enabled !== false;
    // AA7: plan-default layer (known flags only). The tier is read
    // ONLY when a default for this flag exists at all, so flag
    // checks without any operator defaults keep their old cost.
    if ((KNOWN_FLAG_KEYS as readonly string[]).includes(key)) {
      const perTier = (await planFlagDefaults(prisma))[key];
      if (perTier) {
        const tier = await orgPlan(prisma, organizationId);
        if (typeof perTier[tier] === "boolean") return perTier[tier];
      }
    }
    return true;
  } catch {
    return true;
  }
}

export const FLAG_DISABLED_MESSAGE = (feature: string) =>
  `This feature (${feature}) is disabled for this organization by the platform team.`;
