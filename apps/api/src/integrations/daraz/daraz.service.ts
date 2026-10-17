import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { decryptJson, encryptJson } from "../crypto";
import {
  DARAZ_NOT_LIVE_MESSAGE,
  DarazDevAdapterClient,
  DarazDevAdapterError,
  type DarazCredentials,
} from "./daraz.client";

export const DARAZ_PROVIDER = "daraz";
/** The only config status a Daraz connection can have today:
 * credentials are sealed per-org but NOT verified and NOT
 * connected — the CC3 "configured" honesty pattern for a
 * platform with no usable credential-check path. The
 * Integration row's status stays DISCONNECTED, always. */
export const DARAZ_CONFIG_STATUS = "configured_not_verified";

export interface SaveDarazConfigDto {
  appKey?: string;
  appSecret?: string;
  accessToken?: string;
  refreshToken?: string;
}

/**
 * OU3 — per-org Daraz config surface over the existing
 * Integration + IntegrationCredential models (no new tables).
 * Verify-before-save runs on every save: the adapter's verify
 * refuses (no evidenced Daraz endpoint + no approved merchant
 * app — spike doc §3/§5), so a save can only ever produce an
 * honestly-labelled unverified config, never a connection.
 */
@Injectable()
export class DarazService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private async integration(orgId: string): Promise<any | null> {
    const rows = await (this.prisma as any).integration.findMany({
      where: { organizationId: orgId, provider: DARAZ_PROVIDER },
      include: { credential: true },
      orderBy: { createdAt: "asc" },
    });
    return rows?.[0] ?? null;
  }

  private readCreds(integration: any): DarazCredentials {
    const encrypted = integration?.credential?.encryptedData ?? null;
    if (!encrypted) return {};
    try {
      return decryptJson<DarazCredentials>(encrypted);
    } catch {
      return {};
    }
  }

  async getConfig(orgId: string) {
    const integration = await this.integration(orgId);
    const creds = integration ? this.readCreds(integration) : {};
    const configured = Boolean(creds.appKey && creds.appSecret);
    return {
      provider: DARAZ_PROVIDER,
      live: false,
      developmentAdapter: true,
      configured,
      verified: false,
      connected: false,
      configStatus: configured ? DARAZ_CONFIG_STATUS : null,
      // App Key is the app's public identifier (client_id), safe
      // to show back; secrets/tokens are NEVER returned.
      appKey: configured ? (creds.appKey ?? null) : null,
      hasAppSecret: Boolean(creds.appSecret),
      hasAccessToken: Boolean(creds.accessToken),
      hasRefreshToken: Boolean(creds.refreshToken),
      message: DARAZ_NOT_LIVE_MESSAGE,
    };
  }

  /** Verify-before-save: verification is attempted FIRST and
   * cannot pass today (adapter refusal). Following CC3, the
   * credentials are then sealed as "configured_not_verified" —
   * the response says plainly that nothing was verified and
   * nothing is connected. */
  async saveConfig(orgId: string, actorId: string, dto: SaveDarazConfigDto) {
    const appKey = dto.appKey?.trim();
    const appSecret = dto.appSecret?.trim();
    if (!appKey || !appSecret) {
      throw new BadRequestException("Daraz এর জন্য App Key ও App Secret দুটোই দরকার");
    }
    const creds: DarazCredentials = {
      appKey,
      appSecret,
      ...(dto.accessToken?.trim() ? { accessToken: dto.accessToken.trim() } : {}),
      ...(dto.refreshToken?.trim() ? { refreshToken: dto.refreshToken.trim() } : {}),
    };
    const verification = await this.runVerify(creds);
    const encrypted = encryptJson({ ...creds, configStatus: DARAZ_CONFIG_STATUS });
    const existing = await this.integration(orgId);
    if (existing) {
      // Status is forced DISCONNECTED on every save: a Daraz row
      // must never read as CONNECTED while the adapter is a
      // development adapter.
      await (this.prisma as any).integration.update({
        where: { id: existing.id },
        data: { status: "DISCONNECTED", externalAccountId: appKey, lastError: verification.reason },
      });
      if (existing.credential) {
        await (this.prisma as any).integrationCredential.update({
          where: { integrationId: existing.id },
          data: { encryptedData: encrypted },
        });
      } else {
        await (this.prisma as any).integrationCredential.create({
          data: { integrationId: existing.id, encryptedData: encrypted },
        });
      }
    } else {
      const created = await (this.prisma as any).integration.create({
        data: {
          organizationId: orgId,
          provider: DARAZ_PROVIDER,
          status: "DISCONNECTED",
          externalAccountId: appKey,
          lastError: verification.reason,
        },
      });
      await (this.prisma as any).integrationCredential.create({
        data: { integrationId: created.id, encryptedData: encrypted },
      });
    }
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "daraz.config_saved",
      entityType: "Integration",
      metadata: { provider: DARAZ_PROVIDER, verified: false, configStatus: DARAZ_CONFIG_STATUS },
    });
    return { ...(await this.getConfig(orgId)), verification };
  }

  private async runVerify(creds: DarazCredentials): Promise<{ verified: false; reason: string }> {
    try {
      await new DarazDevAdapterClient(creds).verify();
      // Unreachable while the adapter refuses; kept honest if a
      // future real client lands: a resolved verify must still
      // be backed by the client's own evidence, so treat any
      // unexpected resolution as unverified rather than success.
      return { verified: false, reason: "verify_unexpectedly_resolved" };
    } catch (e) {
      if (e instanceof DarazDevAdapterError) return { verified: false, reason: e.message };
      throw e;
    }
  }

  /** Standalone verify: reports the honest unverified result.
   * It never returns verified:true in the adapter's current
   * state, and it saves nothing. */
  async verify(orgId: string) {
    const integration = await this.integration(orgId);
    if (!integration) {
      return { verified: false, live: false, reason: "Daraz config এখনো সেভ করা হয়নি" };
    }
    const result = await this.runVerify(this.readCreds(integration));
    return { ...result, live: false };
  }

  async removeConfig(orgId: string, actorId: string) {
    const integration = await this.integration(orgId);
    if (!integration) return { configured: false };
    await (this.prisma as any).integrationCredential
      .delete({ where: { integrationId: integration.id } })
      .catch(() => undefined);
    await (this.prisma as any).integration.delete({ where: { id: integration.id } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "daraz.config_removed",
      entityType: "Integration", entityId: integration.id, metadata: { provider: DARAZ_PROVIDER },
    });
    return { configured: false };
  }
}
