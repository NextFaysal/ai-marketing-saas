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

  /** Campaign Builder Next CN6: the first-party sources the
   *  builder's Audience Studio can turn into a Meta custom
   *  audience through THIS service (never a second system).
   *  buyers / recent_purchasers read real Order rows;
   *  product_viewers read the first-party tracker's
   *  product_view events joined to identified Visitors;
   *  cart_abandoners read EC10's AbandonedStoreCheckout
   *  (status "open"). A source with no reachable contacts
   *  yields an empty list and createCustom refuses honestly. */
  static readonly STUDIO_SOURCES = ["buyers", "recent_purchasers", "product_viewers", "cart_abandoners"] as const;
  static readonly RECENT_PURCHASER_WINDOWS = ["30", "60", "90"] as const;
  /** Revenue-bearing order statuses are EXCLUDED for buyer
   *  sources (the DailyMetricAggregate discipline: cancelled /
   *  refunded / failed orders never made a buyer). */
  private static readonly NON_BUYER_STATUSES = ["cancelled", "refunded", "failed"];

  private async buyerCustomerIds(organizationId: string, windowDays?: number): Promise<string[]> {
    const rows = await (this.prisma as any).order.findMany({
      where: { organizationId }, take: 50000,
      select: { customerId: true, status: true, isPractice: true, placedAt: true, createdAt: true },
    }).catch(() => []);
    const since = windowDays ? Date.now() - windowDays * 86_400_000 : null;
    const ids = new Set<string>();
    for (const r of rows ?? []) {
      if (!r.customerId) continue;
      if (r.isPractice) continue;
      if (AudiencesService.NON_BUYER_STATUSES.includes(String(r.status ?? "").toLowerCase())) continue;
      if (since != null) {
        const t = new Date(r.placedAt ?? r.createdAt ?? 0).getTime();
        if (!(t >= since)) continue;
      }
      ids.add(r.customerId);
    }
    return [...ids].slice(0, MAX_CONTACTS);
  }

  private async contactsFor(organizationId: string, source: string, segment?: string): Promise<[string, string][]> {
    let people: { email?: string | null; phone?: string | null }[] = [];
    if (source === "buyers" || source === "recent_purchasers") {
      let windowDays: number | undefined;
      if (source === "recent_purchasers") {
        if (!segment || !(AudiencesService.RECENT_PURCHASER_WINDOWS as readonly string[]).includes(segment)) {
          throw new BadRequestException(`recent_purchasers needs a window of ${AudiencesService.RECENT_PURCHASER_WINDOWS.join(", ")} days (segment)`);
        }
        windowDays = Number(segment);
      }
      const ids = await this.buyerCustomerIds(organizationId, windowDays);
      if (ids.length) {
        people = await (this.prisma as any).customer.findMany({
          where: { id: { in: ids } }, select: { email: true, phone: true },
        });
      }
    } else if (source === "product_viewers") {
      const events = await (this.prisma as any).trackingEvent.findMany({
        where: { organizationId, type: "product_view" }, take: 50000, select: { visitorId: true },
      }).catch(() => []);
      const visitorIds = [...new Set((events ?? []).map((e: any) => e.visitorId).filter(Boolean))].slice(0, MAX_CONTACTS) as string[];
      if (visitorIds.length) {
        people = await (this.prisma as any).visitor.findMany({
          where: { id: { in: visitorIds } }, select: { email: true, phone: true },
        });
      }
    } else if (source === "cart_abandoners") {
      people = await (this.prisma as any).abandonedStoreCheckout.findMany({
        where: { organizationId, status: "open" }, take: MAX_CONTACTS,
        select: { email: true, phone: true },
      }).catch(() => []);
    } else if (source === "customers") {
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
      throw new BadRequestException("source must be customers, leads, rfm_segment, buyers, recent_purchasers, product_viewers or cart_abandoners");
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

  /** CN6: the Audience Studio source catalogue. Counts are
   *  REAL gathered-contact counts (the same pairs createCustom
   *  would upload, hashed-pair count), never estimates. A source
   *  whose data cannot be gathered reports available:false with
   *  the reason — the studio shows that instead of a fake count.
   *  RFM rows come from computeRfm (real orders) and are counted
   *  per segment over customers carrying an email or phone. */
  async sourceCatalog(organizationId: string) {
    const out: { key: string; source: string; segment?: string; label: string; available: boolean; reason?: string; contactCount: number | null }[] = [];
    const probe = async (key: string, source: string, segment: string | undefined, label: string) => {
      try {
        const pairs = await this.contactsFor(organizationId, source, segment);
        out.push({ key, source, ...(segment ? { segment } : {}), label, available: pairs.length > 0, ...(pairs.length ? {} : { reason: "এই Source-এ Email/Phone-সহ কোনো Contact পাওয়া যায়নি" }), contactCount: pairs.length });
      } catch (e) {
        out.push({ key, source, ...(segment ? { segment } : {}), label, available: false, reason: e instanceof Error ? e.message.slice(0, 160) : "source unavailable", contactCount: null });
      }
    };
    await probe("buyers", "buyers", undefined, "ক্রেতা (Buyers — অন্তত একটি সফল Order আছে)");
    for (const w of AudiencesService.RECENT_PURCHASER_WINDOWS) {
      await probe(`recent_purchasers_${w}`, "recent_purchasers", w, `সাম্প্রতিক ক্রেতা (শেষ ${w} দিনে কিনেছেন)`);
    }
    await probe("product_viewers", "product_viewers", undefined, "Product Viewer (ট্র্যাকারে Product দেখেছেন, Email/Phone চেনা)");
    await probe("cart_abandoners", "cart_abandoners", undefined, "Cart Abandoner (EC10 — খোলা Abandoned Checkout)");
    await probe("customers", "customers", undefined, "সব Customer");
    await probe("leads", "leads", undefined, "সব Lead");
    try {
      const rows = await computeRfm(this.prisma, organizationId);
      for (const seg of RFM_SEGMENTS) {
        const n = rows.filter((r) => r.segment === seg && (r.email || r.phone)).length;
        out.push({ key: `rfm_${seg}`, source: "rfm_segment", segment: seg, label: `RFM Segment: ${seg}`, available: n > 0, ...(n ? {} : { reason: "এই Segment-এ Email/Phone-সহ কোনো Customer নেই" }), contactCount: n });
      }
    } catch (e) {
      for (const seg of RFM_SEGMENTS) {
        out.push({ key: `rfm_${seg}`, source: "rfm_segment", segment: seg, label: `RFM Segment: ${seg}`, available: false, reason: e instanceof Error ? e.message.slice(0, 160) : "RFM unavailable", contactCount: null });
      }
    }
    return out;
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
