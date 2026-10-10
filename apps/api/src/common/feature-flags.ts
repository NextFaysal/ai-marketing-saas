/**
 * Milestone 40 (Admin Phase A4): feature-flag enforcement.
 * Flags are per-org OPT-OUT switches set from the Admin Console:
 * no row (or a row with enabled=true) means the feature is ON —
 * exactly the behavior before flags were enforced. A row with
 * enabled=false turns the feature OFF for that one org.
 * Reads are defensive: any failure means "enabled", so a flag
 * lookup can never take a production flow down.
 */
export async function orgFlagEnabled(prisma: any, organizationId: string, key: string): Promise<boolean> {
  try {
    const row = await prisma.orgFeatureFlag?.findUnique({
      where: { organizationId_key: { organizationId, key } },
    });
    if (!row) return true;
    return row.enabled !== false;
  } catch {
    return true;
  }
}

export const FLAG_DISABLED_MESSAGE = (feature: string) =>
  `This feature (${feature}) is disabled for this organization by the platform team.`;
