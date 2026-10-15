import { createHash } from "node:crypto";
import { decryptJson } from "../../integrations/crypto";

/**
 * CC8 — resolve a tenant's OWN LLM configuration (OrgLlmConfig):
 * provider + decrypted API key, for immediate in-memory use. This
 * is the one shared reader (tenant-app-config.ts precedent): the
 * connections module writes the row (verify-before-save) and
 * LlmFactory.forOrg reads it when an AI call carries an
 * organizationId.
 *
 * Defensive by design: a missing table/row, a disabled row or an
 * undecryptable key reads as null — "no own LLM configured" — and
 * the caller falls back to the platform LLM resolution, exactly
 * as before CC8. Plaintext exists only in this return value, in
 * memory; it is never logged, audited or returned by any API.
 */
export interface OrgLlmCreds {
  provider: string; // openai | anthropic | gemini
  apiKey: string;
  model?: string;
  status: string; // verified | configured
}

export async function resolveOrgLlmConfig(
  prisma: any,
  organizationId: string,
): Promise<OrgLlmCreds | null> {
  try {
    const row = await prisma.orgLlmConfig?.findUnique?.({ where: { organizationId } });
    if (!row?.provider || !row?.encryptedData) return null;
    if (row.isEnabled === false) return null;
    const payload = decryptJson<{ apiKey?: string }>(row.encryptedData);
    if (!payload?.apiKey) return null;
    return {
      provider: String(row.provider),
      apiKey: payload.apiKey,
      model: row.model ? String(row.model) : undefined,
      status: String(row.status ?? "configured"),
    };
  } catch {
    return null;
  }
}

/** Cache fingerprint for a tenant provider instance — a hash of
 * the key, never the key itself. */
export function orgLlmFingerprint(creds: OrgLlmCreds): string {
  const hash = createHash("sha256").update(creds.apiKey).digest("hex").slice(0, 16);
  return `${creds.provider}:${creds.model ?? ""}:${hash}`;
}
