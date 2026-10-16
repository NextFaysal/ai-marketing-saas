import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

/**
 * AB8 (AX21) Merchant Developer API keys — org-scoped programmatic
 * access to the versioned /v1/merchant surface. Mirrors the
 * AssistantApiKey plumbing (apps/api/src/ai/assistant-api.service.ts):
 * only the SHA-256 hash of a token is ever stored; the plaintext
 * (`qk_live_…`) is returned exactly once at creation.
 *
 * keyPrefix decision (documented): the schema comment says
 * "first 8 chars of the token, for display", but the token's
 * first 8 chars are the literal "qk_live_" for EVERY key, which
 * is useless for display. We therefore store the first 8 chars
 * of the token's RANDOM segment in keyPrefix; UIs display it as
 * `qk_live_<keyPrefix>…`, which identifies a key without ever
 * storing more of the secret than a short hint.
 */

export const MERCHANT_API_KEY_PREFIX = "qk_live_";

export const MERCHANT_API_SCOPES = [
  "products:read",
  "products:write",
  "orders:read",
  "customers:read",
] as const;
export type MerchantApiScope = (typeof MERCHANT_API_SCOPES)[number];

/** SHA-256 hex of the full token — the hashApiKey-style helper. */
export function hashMerchantApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Validate a requested scope set: must be a non-empty array and a
 * subset of MERCHANT_API_SCOPES. Returns the deduped scopes in
 * request order. Anything else is a 400 listing the allowed scopes.
 */
export function validateScopes(input: unknown): string[] {
  const allowed = MERCHANT_API_SCOPES.join(", ");
  if (!Array.isArray(input) || input.length === 0) {
    throw new BadRequestException(
      `অন্তত একটি scope দিতে হবে — অনুমোদিত scope: ${allowed} (at least one scope is required; allowed scopes: ${allowed})`,
    );
  }
  const invalid = input.filter(
    (s) => typeof s !== "string" || !(MERCHANT_API_SCOPES as readonly string[]).includes(s),
  );
  if (invalid.length > 0) {
    throw new BadRequestException(
      `অজানা scope: ${invalid.map(String).join(", ")} — অনুমোদিত scope: ${allowed} (unknown scope; allowed scopes: ${allowed})`,
    );
  }
  return [...new Set(input as string[])];
}

@Injectable()
export class MerchantApiService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private p(): any {
    return this.prisma as any;
  }

  private async auditLog(input: Parameters<AuditService["log"]>[0]): Promise<void> {
    try {
      await this.audit?.log(input);
    } catch {
      /* AuditService is itself failure-isolated; belt and braces */
    }
  }

  async createKey(orgId: string, createdById: string, input: { name?: string; scopes?: unknown }) {
    const scopes = validateScopes(input?.scopes);
    const name = (input?.name ?? "").trim().slice(0, 80) || "Merchant API key";
    const random = randomBytes(32).toString("base64url"); // 43 chars
    const plaintext = MERCHANT_API_KEY_PREFIX + random;
    const row = await this.p().merchantApiKey.create({
      data: {
        organizationId: orgId,
        name,
        // First 8 chars of the RANDOM segment — see class comment.
        keyPrefix: random.slice(0, 8),
        keyHash: hashMerchantApiKey(plaintext),
        scopes,
        status: "active",
        createdById,
      },
    });
    await this.auditLog({
      organizationId: orgId,
      userId: createdById,
      action: "merchant_api_key.create",
      entityType: "MerchantApiKey",
      entityId: row.id,
      // NEVER the token or its hash.
      metadata: { name, scopes },
    });
    // The plaintext leaves the server exactly here, exactly once.
    return { key: plaintext, record: this.publicRow(row) };
  }

  async listKeys(orgId: string) {
    const rows = await this.p().merchantApiKey.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return (rows as any[]).map((r) => this.publicRow(r));
  }

  async revokeKey(orgId: string, keyId: string, actorId?: string) {
    const row = await this.p().merchantApiKey.findFirst({
      where: { id: keyId, organizationId: orgId },
    });
    if (!row) throw new NotFoundException("Merchant API key not found");
    if (row.status === "revoked") return this.publicRow(row);
    const updated = await this.p().merchantApiKey.update({
      where: { id: keyId },
      data: { status: "revoked" },
    });
    await this.auditLog({
      organizationId: orgId,
      userId: actorId,
      action: "merchant_api_key.revoke",
      entityType: "MerchantApiKey",
      entityId: row.id,
      metadata: { name: row.name, scopes: Array.isArray(row.scopes) ? row.scopes : [] },
    });
    return this.publicRow(updated);
  }

  /** Resolve a presented token to its org + key, or null. */
  async authenticate(
    plaintext: string | undefined,
  ): Promise<{ organizationId: string; keyId: string; scopes: string[]; createdById: string } | null> {
    if (!plaintext || !plaintext.startsWith(MERCHANT_API_KEY_PREFIX)) return null;
    const row = await this.p().merchantApiKey.findFirst({
      where: { keyHash: hashMerchantApiKey(plaintext) },
    });
    if (!row || row.status !== "active") return null;
    // lastUsedAt is stamped THROTTLED: only when never used or
    // the last stamp is older than 60 seconds.
    const last = row.lastUsedAt ? new Date(row.lastUsedAt).getTime() : 0;
    if (!row.lastUsedAt || Date.now() - last > 60_000) {
      await this.p()
        .merchantApiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }
    return {
      organizationId: row.organizationId,
      keyId: row.id,
      scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
      createdById: row.createdById,
    };
  }

  private publicRow(r: any) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      name: r.name,
      // Display as `qk_live_<keyPrefix>…`.
      keyPrefix: r.keyPrefix,
      scopes: Array.isArray(r.scopes) ? r.scopes : [],
      status: r.status ?? "active",
      createdById: r.createdById,
      lastUsedAt: r.lastUsedAt ?? null,
      createdAt: r.createdAt,
    };
  }
}
