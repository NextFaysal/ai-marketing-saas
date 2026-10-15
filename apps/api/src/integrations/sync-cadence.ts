/**
 * CC30 (Connect Center Next) — per-connection sync cadence, the
 * CC18 leftover. CC18 shipped pause only: the automation job
 * system is per-org (templates + intervals on the JOB), so a
 * per-CONNECTION minimum interval had nowhere to live. It lives
 * on the Integration row (`syncIntervalMinutes`, null = off).
 *
 * Semantics (pinned by cc30-cadence.spec.ts):
 * - SCHEDULED syncs only. The automation dispatch passes
 *   { scheduled: true }; manual HTTP triggers and the admin
 *   retry path pass nothing and are NEVER cadence-gated — a
 *   human asking now means now.
 * - CC18's syncPaused is checked BEFORE this gate in every sync
 *   entry point, so a paused connection still records its
 *   "sync_paused" skip and pause always wins over cadence.
 * - The window is per (integration, kind): each sync stream of
 *   a store (products / orders / customers / reviews) is
 *   throttled against ITS OWN last run. Comparing across kinds
 *   would let a products sync starve the same store's orders
 *   sync, which is not what a cadence means.
 * - "Last sync" = the latest REAL SyncJob row for the
 *   (integration, kind), read by startedAt. CC18's recorded
 *   "sync_paused" marker rows are refusals, not syncs, and are
 *   excluded — a paused period must not extend the window.
 * - A skipped cycle creates NO SyncJob row (unlike the paused
 *   skip, which is a tenant-visible state change recorded in
 *   the per-connection history). The skip marker returned here
 *   becomes the automation job's run result, which is where a
 *   cadence skip is recorded. Because no row is written, a
 *   cadence skip can never extend its own window.
 */

export interface SyncCadenceSkip {
  skipped: true;
  reason: "sync_interval";
  integrationId: string;
  kind: string;
  syncIntervalMinutes: number;
  lastSyncAt: Date;
  nextEligibleAt: Date;
}

export async function cadenceSkip(
  prisma: any,
  integration: any,
  kind: string,
  now: Date = new Date(),
): Promise<SyncCadenceSkip | null> {
  const interval = integration?.syncIntervalMinutes;
  if (!integration || typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0) {
    return null;
  }
  const rows = await (prisma as any).syncJob.findMany({
    where: { integrationId: integration.id, kind },
    orderBy: { startedAt: "desc" },
    take: 5,
  }).catch(() => []);
  const latest = (rows ?? []).find((j: any) => j?.error !== "sync_paused");
  if (!latest?.startedAt) return null;
  const startedAt = new Date(latest.startedAt);
  const ageMs = now.getTime() - startedAt.getTime();
  if (ageMs < 0 || ageMs >= interval * 60_000) return null;
  return {
    skipped: true,
    reason: "sync_interval",
    integrationId: integration.id,
    kind,
    syncIntervalMinutes: interval,
    lastSyncAt: startedAt,
    nextEligibleAt: new Date(startedAt.getTime() + interval * 60_000),
  };
}
