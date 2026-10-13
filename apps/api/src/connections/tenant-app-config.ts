import { decryptJson } from "../integrations/crypto";

/**
 * CC3 — resolve a tenant's OWN app credentials (TenantAppConfig)
 * for one platform, decrypted for immediate use. This is the one
 * shared reader: the connections module writes these rows
 * (verify-before-save), and the connect flows (InboxService
 * messaging connect, SocialOAuthService TikTok OAuth) read them
 * when a connection is made with appSource="own".
 *
 * Defensive by design (platform-config precedent): a missing
 * table/row or an undecryptable secret reads as null — "no own
 * app configured" — and the CALLER decides whether that is a
 * refusal (connect flows) or a flag (overview). Plaintext exists
 * only in this return value, in memory; it is never logged,
 * audited or returned by any API.
 */
export interface TenantAppCreds {
  appId: string;
  appSecret: string;
  status: string; // verified | configured
}

export async function resolveTenantAppConfig(
  prisma: any,
  organizationId: string,
  platform: "meta" | "tiktok",
): Promise<TenantAppCreds | null> {
  try {
    const row = await prisma.tenantAppConfig?.findFirst?.({ where: { organizationId, platform } });
    if (!row?.appId || !row?.encryptedSecret) return null;
    const payload = decryptJson<{ appSecret?: string }>(row.encryptedSecret);
    if (!payload?.appSecret) return null;
    return { appId: String(row.appId), appSecret: payload.appSecret, status: String(row.status ?? "configured") };
  } catch {
    return null;
  }
}
