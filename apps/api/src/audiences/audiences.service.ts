import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { graphGet, graphPost, metaTokenForAccount } from "../common/meta-graph";
import { hashEmail, hashPhone } from "../conversions/conversions.service";
import { computeRfm, RFM_SEGMENTS } from "../messaging/rfm";

const MAX_CONTACTS = 10000;
const BATCH = 1000;

@Injectable()
export class AudiencesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(organizationId: string) {
    return (this.prisma as any).audienceRecord.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100,
    });
  }

  private async contactsFor(organizationId: string, source: string, segment?: string): Promise<[string, string][]> {
    let people: { email?: string | null; phone?: string | null }[] = [];
    if (source === "customers") {
      people = await (this.prisma as any).customer.findMany({
        where: { organizationId, mergedIntoId: null }, take: MAX_CONTACTS,
        select: { email: true, phone: true },
      });
    } else if (source === "leads") {
      people = await (this.prisma as any).lead.findMany({
        where: { organizationId, mergedIntoId: null }, take: MAX_CONTACTS,
        select: { email: true, phone: true },
      });
    } else if (source === "rfm_segment") {
      if (!segment || !(RFM_SEGMENTS as readonly string[]).includes(segment)) {
        throw new BadRequestException(`segment must be one of ${RFM_SEGMENTS.join(", ")}`);
      }
      const rows = await computeRfm(this.prisma, organizationId);
      const ids = rows.filter((r) => r.segment === segment).map((r) => r.customerId);
      if (ids.length) {
        people = await (this.prisma as any).customer.findMany({
          where: { id: { in: ids.slice(0, MAX_CONTACTS) } }, select: { email: true, phone: true },
        });
      }
    } else {
      throw new BadRequestException("source must be customers, leads or rfm_segment");
    }
    const pairs: [string, string][] = [];
    for (const p of people) {
      const em = hashEmail(p.email); const ph = hashPhone(p.phone);
      if (em || ph) pairs.push([em ?? "", ph ?? ""]);
    }
    return pairs;
  }

  /** Build a Meta custom audience from first-party contacts. Contacts
   * leave the server only as SHA-256 hashes (Meta's documented user
   * data format). The record counts as built only when Meta created
   * the audience AND accepted the user batches; the audience size
   * comes from Meta's approximate_count on refresh, never estimated. */
  async createCustom(organizationId: string, actorId: string, dto: {
    adAccountId: string; name: string; source: string; segment?: string;
  }) {
    const pairs = await this.contactsFor(organizationId, dto.source, dto.segment);
    if (pairs.length === 0) throw new BadRequestException("No contacts with an email or phone were found for this source — nothing to upload");
    const { account, token } = await metaTokenForAccount(this.prisma, organizationId, dto.adAccountId).catch((e) => {
      throw new BadRequestException(e instanceof Error ? e.message : "Meta account resolution failed");
    });
    const record = await (this.prisma as any).audienceRecord.create({
      data: {
        organizationId, adAccountId: dto.adAccountId, name: dto.name, kind: "custom",
        source: dto.source, sourceDetail: dto.segment ?? null, status: "building", createdById: actorId,
      },
    });
    try {
      const created = await graphPost(token, `/${account.externalId}/customaudiences`, {
        name: dto.name, subtype: "CUSTOM", customer_file_source: "USER_PROVIDED_ONLY",
        description: `Built by Qosprey AI Marketing SaaS from ${dto.source}${dto.segment ? ` (${dto.segment})` : ""}`,
      });
      if (!created?.id) throw new Error("Meta returned no audience id; creation is NOT confirmed");
      let received = 0;
      for (let i = 0; i < pairs.length; i += BATCH) {
        const chunk = pairs.slice(i, i + BATCH);
        const res = await graphPost(token, `/${created.id}/users`, {
          payload: JSON.stringify({ schema: ["EMAIL_SHA256", "PHONE_SHA256"], data: chunk }),
        });
        received += Number(res?.num_received ?? 0);
      }
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id },
        data: { externalAudienceId: String(created.id), lastSyncedAt: new Date(), error: null },
      });
      await this.audit.log({ organizationId, userId: actorId, action: "audience.created", entityType: "AudienceRecord", entityId: record.id, metadata: { contacts: pairs.length, received } });
    } catch (e) {
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id },
        data: { status: "failed", error: e instanceof Error ? e.message : "Audience creation failed" },
      });
    }
    return (this.prisma as any).audienceRecord.findUnique({ where: { id: record.id } });
  }

  /** Membership refresh (Phase J): re-gather the record's source
   * contacts and APPEND them to the existing Meta audience (hashed,
   * batched, same path as creation). Meta deduplicates server-side;
   * counts Meta reports back are stored, nothing is estimated. */
  async refreshMembership(organizationId: string, actorId: string, recordId: string) {
    const record = await (this.prisma as any).audienceRecord.findFirst({ where: { id: recordId, organizationId } });
    if (!record) throw new NotFoundException("Audience not found");
    if (record.kind !== "custom" || !record.externalAudienceId) {
      throw new BadRequestException("Only a built custom audience with a Meta id can be refreshed");
    }
    const pairs = await this.contactsFor(organizationId, record.source, record.sourceDetail ?? undefined);
    if (pairs.length === 0) throw new BadRequestException("No contacts with an email or phone were found for this source — nothing to upload");
    const { token } = await metaTokenForAccount(this.prisma, organizationId, record.adAccountId).catch((e) => {
      throw new BadRequestException(e instanceof Error ? e.message : "Meta account resolution failed");
    });
    const BATCH = 1000;
    let received = 0;
    try {
      for (let i = 0; i < pairs.length; i += BATCH) {
        const chunk = pairs.slice(i, i + BATCH);
        const res = await graphPost(token, `/${record.externalAudienceId}/users`, {
          payload: JSON.stringify({ schema: ["EMAIL_SHA256", "PHONE_SHA256"], data: chunk }),
        });
        received += Number(res?.num_received ?? 0);
      }
    } catch (e) {
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id },
        data: { error: e instanceof Error ? e.message : "Membership refresh failed" },
      }).catch(() => undefined);
      throw new BadRequestException(e instanceof Error ? e.message : "Membership refresh failed");
    }
    const updated = await (this.prisma as any).audienceRecord.update({
      where: { id: record.id },
      data: { lastMembershipSyncAt: new Date(), lastMembershipCount: pairs.length, error: null },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "audience.membership_refreshed", entityType: "AudienceRecord", entityId: record.id, metadata: { contacts: pairs.length, received } });
    return { ...updated, uploaded: pairs.length, receivedByMeta: received };
  }

  /** Scheduler entry: refresh every built custom audience of the org. */
  async refreshAllMemberships(organizationId: string, actorId: string) {
    const records = await (this.prisma as any).audienceRecord.findMany({
      where: { organizationId, kind: "custom" },
    });
    let refreshed = 0; const errors: string[] = [];
    for (const record of records) {
      if (!record.externalAudienceId) continue;
      try { await this.refreshMembership(organizationId, actorId, record.id); refreshed++; }
      catch (e) { errors.push(`${record.name}: ${e instanceof Error ? e.message : "refresh failed"}`); }
    }
    return { audiences: records.length, refreshed, errors };
  }

  async createLookalike(organizationId: string, actorId: string, dto: {
    adAccountId: string; name: string; sourceAudienceRecordId: string; country: string; ratio?: number;
  }) {
    const source = await (this.prisma as any).audienceRecord.findFirst({ where: { id: dto.sourceAudienceRecordId, organizationId } });
    if (!source?.externalAudienceId) throw new BadRequestException("Source audience has no Meta audience id yet (build or refresh it first)");
    const ratio = dto.ratio ?? 0.01;
    if (ratio < 0.01 || ratio > 0.20) throw new BadRequestException("ratio must be between 0.01 and 0.20");
    const { account, token } = await metaTokenForAccount(this.prisma, organizationId, dto.adAccountId).catch((e) => {
      throw new BadRequestException(e instanceof Error ? e.message : "Meta account resolution failed");
    });
    const record = await (this.prisma as any).audienceRecord.create({
      data: {
        organizationId, adAccountId: dto.adAccountId, name: dto.name, kind: "lookalike",
        source: "meta", sourceDetail: `from ${source.name}`, status: "building", createdById: actorId,
      },
    });
    try {
      const created = await graphPost(token, `/${account.externalId}/customaudiences`, {
        name: dto.name, subtype: "LOOKALIKE", origin_audience_id: source.externalAudienceId,
        lookalike_spec: JSON.stringify({ type: "similarity", ratio, country: dto.country }),
      });
      if (!created?.id) throw new Error("Meta returned no audience id; creation is NOT confirmed");
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id }, data: { externalAudienceId: String(created.id), lastSyncedAt: new Date() },
      });
    } catch (e) {
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id }, data: { status: "failed", error: e instanceof Error ? e.message : "Lookalike creation failed" },
      });
    }
    await this.audit.log({ organizationId, userId: actorId, action: "audience.lookalike_created", entityType: "AudienceRecord", entityId: record.id, metadata: { country: dto.country, ratio } });
    return (this.prisma as any).audienceRecord.findUnique({ where: { id: record.id } });
  }

  /** Pull Meta's own delivery status + approximate count. */
  async refresh(organizationId: string, recordId: string) {
    const record = await (this.prisma as any).audienceRecord.findFirst({ where: { id: recordId, organizationId } });
    if (!record) throw new NotFoundException("Audience not found");
    if (!record.externalAudienceId) throw new BadRequestException("This audience was never confirmed by Meta");
    const { token } = await metaTokenForAccount(this.prisma, organizationId, record.adAccountId);
    const res = await graphGet(token, `/${record.externalAudienceId}`, { fields: "approximate_count,delivery_status" });
    const code = Number(res?.delivery_status?.code ?? 0);
    await (this.prisma as any).audienceRecord.update({
      where: { id: record.id },
      data: {
        approximateCount: res?.approximate_count != null ? Number(res.approximate_count) : record.approximateCount,
        status: code === 200 ? "ready" : record.status,
        lastSyncedAt: new Date(),
      },
    });
    return (this.prisma as any).audienceRecord.findUnique({ where: { id: record.id } });
  }

  // ---------- Saved audiences ----------
  async listSaved(organizationId: string) {
    return (this.prisma as any).savedAudience.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100 });
  }
  async createSaved(organizationId: string, actorId: string, dto: { name: string; targeting: Record<string, unknown> }) {
    if (!dto.targeting || typeof dto.targeting !== "object") throw new BadRequestException("targeting must be an object");
    return (this.prisma as any).savedAudience.create({ data: { organizationId, name: dto.name, targeting: dto.targeting, createdById: actorId } });
  }
  async deleteSaved(organizationId: string, id: string) {
    const row = await (this.prisma as any).savedAudience.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException("Saved audience not found");
    await (this.prisma as any).savedAudience.delete({ where: { id } });
    return { deleted: true };
  }
}
