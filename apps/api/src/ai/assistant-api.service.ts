import { Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

/**
 * AP7 Assistant API keys — org-scoped programmatic access to the
 * assistant. Only the SHA-256 hash of a key is ever stored; the
 * plaintext is returned exactly once at creation. Authentication
 * resolves the key to (organizationId, createdById) and every chat
 * call then runs through the ordinary ChatService pipeline (kill
 * switch, daily caps, planner boundary, tool RBAC with the key
 * creator's membership role, full audit) — the API key opens no
 * side door around any of it.
 */

const KEY_PREFIX = "qos_ai_";

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

@Injectable()
export class AssistantApiService {
  constructor(private readonly prisma: PrismaService) {}

  private p(): any { return this.prisma as any; }

  async createKey(orgId: string, createdById: string, name: string) {
    const plaintext = KEY_PREFIX + randomBytes(24).toString("base64url");
    const row = await this.p().assistantApiKey.create({
      data: {
        organizationId: orgId,
        name: name.trim().slice(0, 80) || "API key",
        keyPrefix: plaintext.slice(0, 14),
        keyHash: hashApiKey(plaintext),
        createdById,
      },
    });
    // The plaintext leaves the server exactly here, exactly once.
    return { key: plaintext, record: this.publicRow(row) };
  }

  async listKeys(orgId: string) {
    const rows = await this.p().assistantApiKey.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return (rows as any[]).map((r) => this.publicRow(r));
  }

  async revokeKey(orgId: string, keyId: string) {
    const row = await this.p().assistantApiKey.findFirst({ where: { id: keyId, organizationId: orgId } });
    if (!row) throw new NotFoundException("API key not found");
    if (row.revokedAt) return this.publicRow(row);
    const updated = await this.p().assistantApiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
    return this.publicRow(updated);
  }

  /** Resolve a presented key to its org + creator, or null. */
  async authenticate(plaintext: string | undefined): Promise<{ organizationId: string; userId: string; keyId: string } | null> {
    if (!plaintext || !plaintext.startsWith(KEY_PREFIX)) return null;
    const row = await this.p().assistantApiKey.findFirst({ where: { keyHash: hashApiKey(plaintext) } });
    if (!row || row.revokedAt) return null;
    await this.p().assistantApiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return { organizationId: row.organizationId, userId: row.createdById, keyId: row.id };
  }

  private publicRow(r: any) {
    return {
      id: r.id,
      name: r.name,
      keyPrefix: r.keyPrefix,
      createdById: r.createdById,
      lastUsedAt: r.lastUsedAt ?? null,
      revokedAt: r.revokedAt ?? null,
      createdAt: r.createdAt,
    };
  }
}
