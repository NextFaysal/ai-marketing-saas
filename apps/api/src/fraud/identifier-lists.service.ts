import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { deviceHashPrefix, maskIdentifier, normalizeIdentifier } from "./identifier-utils";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * GB3 (GC9): staff-managed blocked / trusted identifier lists
 * (BlockedIdentifier / TrustedIdentifier — phone | email | ip).
 *
 * Lookup discipline (ON4 precedent):
 *  - isBlocked fails OPEN: any table error / missing table
 *    (partial deployment) reads as "not blocked", so a list
 *    outage can never kill a checkout.
 *  - isTrustedPhone fails CLOSED for the bypass: an error
 *    reads as "not trusted", so an outage never grants the
 *    gate bypass.
 *
 * Audit discipline: metadata is { kind, masked } only — NEVER
 * a raw email / ip / full phone (phone: the matchKey only,
 * mirroring BlockedPhoneService; ip: first segment + mask).
 */

export type IdentifierListName = "blocked" | "trusted";

const INVALID_MESSAGES: Record<string, string> = {
  phone: "ফোন নম্বরটি সঠিক বাংলাদেশি মোবাইল নম্বর নয়",
  email: "ইমেইল ঠিকানাটি সঠিক নয়",
  ip: "IP ঠিকানাটি সঠিক নয়",
  device: "ডিভাইস হ্যাশটি সঠিক নয় (64-অক্ষরের hex হতে হবে)",
};

@Injectable()
export class IdentifierListsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private table(list: IdentifierListName): any {
    return list === "blocked"
      ? (this.prisma as any).blockedIdentifier
      : (this.prisma as any).trustedIdentifier;
  }

  /** Audit-safe mask: phone → matchKey only (ON4 precedent),
   * email → maskIdentifier, ip → first segment + "•••" so the
   * raw ip never lands in audit metadata. */
  private auditMask(kind: string, value: string, matchKey: string): string {
    if (kind === "phone") return matchKey;
    if (kind === "device") return deviceHashPrefix(value);
    if (kind === "ip") {
      const first = value.split(/[.:]/)[0] ?? "";
      return `${first}•••`;
    }
    return maskIdentifier(kind, value);
  }

  private async auditChange(
    orgId: string, actorId: string, list: IdentifierListName,
    verb: "added" | "removed", row: any,
  ) {
    await this.audit?.log({
      organizationId: orgId,
      userId: actorId,
      action: `orders.${list}_identifier_${verb}`,
      entityType: list === "blocked" ? "BlockedIdentifier" : "TrustedIdentifier",
      entityId: row.id,
      metadata: {
        kind: row.kind,
        masked: this.auditMask(String(row.kind), String(row.value ?? ""), String(row.matchKey ?? "")),
      },
    }).catch(() => undefined);
  }

  async list(orgId: string, list: IdentifierListName, kind?: string) {
    const table = this.table(list);
    if (!table?.findMany) return [];
    const where: any = { organizationId: orgId };
    if (kind) where.kind = kind;
    const rows = (await table.findMany({
      where,
      orderBy: { createdAt: "desc" },
    }).catch(() => [])) ?? [];
    return rows;
  }

  async add(
    orgId: string,
    actorId: string,
    list: IdentifierListName,
    dto: { kind?: string; value?: string; reason?: string },
  ) {
    const kind = String(dto?.kind ?? "");
    if (!["phone", "email", "ip", "device"].includes(kind)) {
      throw badRequest("fraud.invalidTypeSendPhoneEmailIp");
    }
    const norm = normalizeIdentifier(kind, dto?.value ?? "");
    if (!norm) {
      throw new BadRequestException(INVALID_MESSAGES[kind] ?? "শনাক্তকারীটি সঠিক নয়");
    }
    const table = this.table(list);
    if (!table?.create) throw badRequest("fraud.theListFacilityIsNotAvailable");
    const existing = table.findFirst
      ? await table.findFirst({
          where: { organizationId: orgId, kind, matchKey: norm.matchKey },
        }).catch(() => null)
      : null;
    if (existing) {
      throw badRequest("fraud.alreadyOnTheList");
    }
    let row: any;
    try {
      row = await table.create({
        data: {
          organizationId: orgId,
          kind,
          value: norm.value,
          matchKey: norm.matchKey,
          reason: dto?.reason?.trim() ? dto.reason.trim().slice(0, 300) : null,
          createdById: actorId ?? null,
        },
      });
    } catch (e: any) {
      // Unique (organizationId, kind, matchKey) race → duplicate.
      if (String(e?.code ?? "").includes("P2002") || /unique/i.test(String(e?.message ?? ""))) {
        throw badRequest("fraud.alreadyOnTheList");
      }
      throw e;
    }
    await this.auditChange(orgId, actorId, list, "added", row);
    return row;
  }

  async remove(orgId: string, actorId: string, list: IdentifierListName, id: string) {
    const table = this.table(list);
    const row = table?.findFirst
      ? await table.findFirst({ where: { id, organizationId: orgId } }).catch(() => null)
      : null;
    if (!row) throw notFound("fraud.identifierNotFoundInThisOrganization");
    await table.delete({ where: { id: row.id } });
    await this.auditChange(orgId, actorId, list, "removed", row);
    return { deleted: true, id: row.id };
  }

  // ---------- checkout-gate matchers ----------

  /** Fail OPEN (ON4 precedent): any error → not blocked. */
  async isBlocked(
    orgId: string,
    input: { phoneKey?: string | null; email?: string | null; ip?: string | null; deviceHash?: string | null },
  ): Promise<{ blocked: boolean; kind: string | null }> {
    try {
      const table = this.table("blocked");
      if (!table?.findFirst) return { blocked: false, kind: null };
      const checks: Array<{ kind: string; matchKey: string }> = [];
      if (input.phoneKey) checks.push({ kind: "phone", matchKey: String(input.phoneKey) });
      if (input.email) {
        const norm = normalizeIdentifier("email", input.email);
        if (norm) checks.push({ kind: "email", matchKey: norm.matchKey });
      }
      if (input.ip) {
        const norm = normalizeIdentifier("ip", input.ip);
        if (norm) checks.push({ kind: "ip", matchKey: norm.matchKey });
      }
      if (input.deviceHash) {
        const norm = normalizeIdentifier("device", input.deviceHash);
        if (norm) checks.push({ kind: "device", matchKey: norm.matchKey });
      }
      for (const check of checks) {
        const row = await table.findFirst({
          where: { organizationId: orgId, kind: check.kind, matchKey: check.matchKey },
        }).catch(() => null);
        if (row) return { blocked: true, kind: check.kind };
      }
      return { blocked: false, kind: null };
    } catch {
      return { blocked: false, kind: null };
    }
  }

  /** Fail CLOSED for the bypass: any error → not trusted. */
  async isTrustedPhone(orgId: string, phoneKey: string | null | undefined): Promise<boolean> {
    try {
      if (!phoneKey) return false;
      const table = this.table("trusted");
      if (!table?.findFirst) return false;
      const row = await table.findFirst({
        where: { organizationId: orgId, kind: "phone", matchKey: String(phoneKey) },
      }).catch(() => null);
      return Boolean(row);
    } catch {
      return false;
    }
  }
}
