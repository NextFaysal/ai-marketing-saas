/**
 * AD health band — the single source of truth for AdAccount
 * connection health. Extracted (AA5) from the inline computation
 * in AdsService.listAccounts() so the tenant list and the admin
 * operator board can never drift: same bands, same 48h stale
 * threshold, same wording. Pure function — no I/O, no DI.
 *
 * Bands:
 * - sourceType "api" + syncDisabled → "sync_disabled" (AD5: sync
 *   deliberately off — NOT stale, no sync is expected to run)
 * - no integrationId → "disconnected" for api accounts,
 *   "manual" for csv/manual accounts
 * - integrationId present but integration row missing →
 *   "disconnected" (dangling pointer)
 * - integration ERROR → "error", DISCONNECTED → "disconnected"
 * - integration CONNECTED → "stale" when lastSyncAt is null,
 *   unparseable, or older than AD_HEALTH_STALE_MS, else
 *   "connected"
 * - any other integration status → "disconnected"
 */
export const AD_HEALTH_STALE_MS = 48 * 3600 * 1000;

export function computeAdAccountHealth(
  account: { sourceType?: string | null; syncDisabled?: boolean | null; integrationId?: string | null },
  integration: { status?: string | null; lastSyncAt?: unknown } | null | undefined,
  now: number,
): string {
  if (account.sourceType === "api" && account.syncDisabled) {
    return "sync_disabled";
  }
  if (!account.integrationId) {
    return account.sourceType === "api" ? "disconnected" : "manual";
  }
  if (!integration) {
    return "disconnected";
  }
  if (integration.status === "ERROR") return "error";
  if (integration.status === "DISCONNECTED") return "disconnected";
  if (integration.status === "CONNECTED") {
    const last = integration.lastSyncAt
      ? new Date(integration.lastSyncAt as any).getTime()
      : null;
    return last === null || Number.isNaN(last) || now - last > AD_HEALTH_STALE_MS
      ? "stale"
      : "connected";
  }
  return "disconnected";
}
