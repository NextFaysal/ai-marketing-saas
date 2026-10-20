import { HttpException, HttpStatus } from "@nestjs/common";
import { tooManyRequests } from "../i18n";
import { planResourceLimits } from "./platform-settings";
import { todayDhakaKey } from "./plan-limit-checks";

/**
 * AB8 (AX21) — shared ApiUsageDaily counter helper.
 *
 * Verified before building: nothing in-tree incremented
 * ApiUsageDaily (the table was only READ, by the billing usage
 * payload in OrganizationsService). This helper is the single
 * write path: incrementApiUsage upserts today's (Asia/Dhaka)
 * row and adds 1. Every function here is fully failure-isolated
 * — usage accounting must never break the request it counts,
 * so reads degrade to 0 / "allow" and writes swallow errors.
 */

export async function incrementApiUsage(prisma: any, organizationId: string): Promise<void> {
  try {
    const table = prisma?.apiUsageDaily;
    if (!table?.upsert) return;
    const day = todayDhakaKey();
    await table.upsert({
      where: { organizationId_day: { organizationId, day } },
      create: { organizationId, day, count: 1 },
      update: { count: { increment: 1 } },
    });
  } catch {
    /* failure-isolated: accounting never breaks the request */
  }
}

export async function apiUsageToday(prisma: any, organizationId: string): Promise<number> {
  try {
    const table = prisma?.apiUsageDaily;
    if (!table?.findUnique) return 0;
    const row = await table.findUnique({
      where: { organizationId_day: { organizationId, day: todayDhakaKey() } },
    });
    return typeof row?.count === "number" ? row.count : 0;
  } catch {
    return 0;
  }
}

/**
 * Refuse with 429 only on a POSITIVELY-KNOWN breach: the plan
 * carries an apiDailyLimit and today's counted usage is already
 * at/over it. No limit (null) = unlimited; any read failure
 * allows the request (never blocks on missing limit info).
 */
export async function assertWithinApiDailyLimit(prisma: any, organizationId: string): Promise<void> {
  let limit: number | null = null;
  try {
    const limits = await planResourceLimits(prisma, organizationId);
    limit = limits?.apiDailyLimit ?? null;
  } catch {
    return; // failure-isolated read → allow
  }
  if (limit == null) return;
  const used = await apiUsageToday(prisma, organizationId);
  if (used >= limit) {
    throw tooManyRequests("common.dailyApiLimitReached", { limit, used });
  }
}
