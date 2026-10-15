import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { bdPhoneMatchKey, normalizeBdPhone } from "../orders/phone-utils";

/**
 * ON4 — org phone blocklist (BlockedPhone). Stored rows keep
 * the canonical phone + the last-10-digits match key; lookups
 * match on EITHER, at comparison time only — stored customer /
 * order phones are never rewritten. A blocklist read failure
 * must never kill a checkout, so isBlocked fails open (false)
 * and says so nowhere in the customer-facing flow.
 */
@Injectable()
export class BlockedPhoneService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private table(): any {
    return (this.prisma as any).blockedPhone;
  }

  async isBlocked(orgId: string, rawPhone: unknown): Promise<boolean> {
    try {
      if (!rawPhone) return false;
      const key = bdPhoneMatchKey(rawPhone);
      const canonical = normalizeBdPhone(rawPhone);
      if (!key && !canonical) return false;
      const table = this.table();
      if (!table?.findFirst) return false;
      const ors: any[] = [];
      if (key) ors.push({ phoneKey: key });
      if (canonical) ors.push({ phone: canonical });
      const row = await table.findFirst({
        where: { organizationId: orgId, OR: ors },
      });
      return Boolean(row);
    } catch {
      return false;
    }
  }

  async list(orgId: string) {
    const table = this.table();
    if (!table?.findMany) return [];
    const rows = (await table.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    }).catch(() => [])) ?? [];
    return rows;
  }

  async add(orgId: string, actorId: string, dto: { phone?: string; reason?: string }) {
    const canonical = normalizeBdPhone(dto?.phone ?? "");
    if (!canonical) {
      throw new BadRequestException("ফোন নম্বরটি সঠিক বাংলাদেশি মোবাইল নম্বর নয়");
    }
    const phoneKey = bdPhoneMatchKey(canonical)!;
    const table = this.table();
    if (!table?.create) throw new BadRequestException("ব্লকলিস্ট সুবিধাটি এই ডিপ্লয়মেন্টে নেই");
    const existing = table.findFirst
      ? await table.findFirst({ where: { organizationId: orgId, phoneKey } }).catch(() => null)
      : null;
    if (existing) {
      throw new BadRequestException("এই নম্বরটি ইতিমধ্যে ব্লকলিস্টে আছে");
    }
    let row: any;
    try {
      row = await table.create({
        data: {
          organizationId: orgId,
          phone: canonical,
          phoneKey,
          reason: dto?.reason?.trim() ? dto.reason.trim().slice(0, 300) : null,
          createdById: actorId ?? null,
        },
      });
    } catch (e: any) {
      // Unique (organizationId, phoneKey) race → the duplicate message.
      if (String(e?.code ?? "").includes("P2002") || /unique/i.test(String(e?.message ?? ""))) {
        throw new BadRequestException("এই নম্বরটি ইতিমধ্যে ব্লকলিস্টে আছে");
      }
      throw e;
    }
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "orders.blocked_phone_added",
      entityType: "BlockedPhone", entityId: row.id, metadata: { phoneKey },
    }).catch(() => undefined);
    return row;
  }

  async remove(orgId: string, actorId: string, id: string) {
    const table = this.table();
    const row = table?.findFirst
      ? await table.findFirst({ where: { id, organizationId: orgId } }).catch(() => null)
      : null;
    if (!row) throw new NotFoundException("Blocked phone not found in this organization");
    await table.delete({ where: { id: row.id } });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "orders.blocked_phone_removed",
      entityType: "BlockedPhone", entityId: row.id, metadata: { phoneKey: row.phoneKey },
    }).catch(() => undefined);
    return { deleted: true, id: row.id };
  }
}
