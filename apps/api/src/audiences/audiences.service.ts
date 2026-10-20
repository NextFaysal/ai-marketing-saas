import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { graphDelete, graphGet, graphPost, metaTokenForAccount } from "../common/meta-graph";
import { hashEmail, hashPhone } from "../conversions/conversions.service";
import { computeRfm, RFM_SEGMENTS } from "../messaging/rfm";
import { decryptJson } from "../integrations/crypto";
import { GoogleAdsClient, GoogleAdsSecrets } from "../ads/google/google.client";
import { TikTokManage } from "../ads/tiktok/tiktok.client";
import { badRequest, notFound } from "../i18n/api-exception";

const MAX_CONTACTS = 10000;
const BATCH = 1000;
/** CA7: the fixed lookback window for per-audience
 *  performance rollups (stated in every payload that
 *  carries them — never an implied "all time"). */
export const AUDIENCE_PERFORMANCE_WINDOW_DAYS = 90;

/** OU4: the management-client surface AudiencesService uses for
 *  Google Customer Match. Structurally the real
 *  GoogleAdsClient(secrets).campaignManage() result; specs inject
 *  fakes through AudiencesDeps instead of touching Google. */
export interface GoogleManageLike {
  createCustomerMatchList(customerId: string, name: string, description?: string): Promise<{ resourceName: string; userListId: string }>;
  uploadCustomerMatch(customerId: string, userListResourceName: string, identifiers: { hashedEmail?: string; hashedPhone?: string }[]): Promise<{ jobResourceName: string; operations: number }>;
  getUserList(customerId: string, userListId: string): Promise<{ name?: string; sizeForDisplay?: string; approximateCount: number | null }>;
}

/** OU4: the TikTokManage surface AudiencesService uses. */
export interface TikTokManageLike {
  createCustomAudience(advertiserId: string, name: string, hashedLines: string[]): Promise<{ audienceExternalId: string; filePath: string }>;
  updateCustomAudience(advertiserId: string, audienceId: string, hashedLines: string[]): Promise<{ filePath: string }>;
  getCustomAudience(advertiserId: string, audienceId: string): Promise<{ size: number | null; status?: string; name?: string }>;
  createLookalikeAudience(advertiserId: string, input: { name: string; sourceAudienceId: string; country: string; tier: "NARROW" | "BALANCED" | "BROAD" }): Promise<{ audienceExternalId: string }>;
}

/** OU4: optional test seams. When a factory is absent the real
 *  clients are constructed from the account's decrypted secrets,
 *  exactly like the production path. */
export interface AudiencesDeps {
  googleManageFactory?: (secrets: GoogleAdsSecrets) => GoogleManageLike;
  tiktokManageFactory?: (accessToken: string) => TikTokManageLike;
}

@Injectable()
export class AudiencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly deps?: AudiencesDeps,
  ) {}

  private googleManage(secrets: GoogleAdsSecrets): GoogleManageLike {
    return this.deps?.googleManageFactory ? this.deps.googleManageFactory(secrets) : new GoogleAdsClient(secrets).campaignManage();
  }

  private tiktokManage(accessToken: string): TikTokManageLike {
    return this.deps?.tiktokManageFactory ? this.deps.tiktokManageFactory(accessToken) : new TikTokManage(accessToken);
  }

  /** OU4: platform is derived from the record's / dto's AdAccount —
   *  AudienceRecord deliberately has NO platform column (no
   *  migration in this batch). A missing table/account returns
   *  null and the caller falls through to the legacy Meta path,
   *  whose own resolver reports the real resolution error. */
  private async adAccountFor(organizationId: string, adAccountId: string): Promise<any | null> {
    try {
      return await (this.prisma as any).adAccount.findFirst({ where: { id: adAccountId, organizationId } }) ?? null;
    } catch { return null; }
  }

  private platformOf(account: any): string {
    return String(account?.platform ?? "meta").toLowerCase();
  }

  /** Secrets resolution mirroring PublishingService.accountSecrets:
   *  adAccount.integrationId → integration.credential → decryptJson. */
  private async platformSecrets(organizationId: string, account: any, platform: string): Promise<any> {
    if (!account || this.platformOf(account) !== platform || !account.integrationId) {
      throw badRequest("audiences.thisAdAccountIsNotConnected", { platform: platform });
    }
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: account.integrationId, organizationId }, include: { credential: true },
    });
    if (!integration?.credential) throw badRequest("audiences.credentialsAreMissingReconnectTheAccount", { platform: platform });
    return decryptJson<any>(integration.credential.encryptedData);
  }

  /** TikTok DMP file rule: one identifier type per file, so use
   *  email hashes when any exist, else phone hashes. Phone-only
   *  pairs are therefore not mixed into an email file. */
  private tiktokLines(pairs: [string, string][]): string[] {
    const emails = pairs.map((p) => p[0]).filter(Boolean);
    if (emails.length) return emails;
    return pairs.map((p) => p[1]).filter(Boolean);
  }

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
          throw badRequest("audiences.recentPurchasersNeedsAWindowOf", { p1: AudiencesService.RECENT_PURCHASER_WINDOWS.join(", ") });
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
        throw badRequest("audiences.segmentMustBeOneOf", { p1: RFM_SEGMENTS.join(", ") });
      }
      const rows = await computeRfm(this.prisma, organizationId);
      const ids = rows.filter((r) => r.segment === segment).map((r) => r.customerId);
      if (ids.length) {
        people = await (this.prisma as any).customer.findMany({
          where: { id: { in: ids.slice(0, MAX_CONTACTS) } }, select: { email: true, phone: true },
        });
      }
    } else {
      throw badRequest("audiences.sourceMustBeCustomersLeadsRfm");
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
    // OU4: resolve the account's platform FIRST and branch —
    // Meta keeps its existing path below unchanged; Google goes
    // to Customer Match and TikTok to the DMP custom-audience API.
    const account = await this.adAccountFor(organizationId, dto.adAccountId);
    const platform = this.platformOf(account);
    if (platform === "google") return this.createCustomGoogle(organizationId, actorId, dto, account);
    if (platform === "tiktok") return this.createCustomTikTok(organizationId, actorId, dto, account);
    const pairs = await this.contactsFor(organizationId, dto.source, dto.segment);
    if (pairs.length === 0) throw badRequest("audiences.noContactsWithAnEmailOr");
    const { account: metaAccount, token } = await metaTokenForAccount(this.prisma, organizationId, dto.adAccountId).catch((e) => {
      throw new BadRequestException(e instanceof Error ? e.message : "Meta account resolution failed");
    });
    const record = await (this.prisma as any).audienceRecord.create({
      data: {
        organizationId, adAccountId: dto.adAccountId, name: dto.name, kind: "custom",
        source: dto.source, sourceDetail: dto.segment ?? null, status: "building", createdById: actorId,
      },
    });
    try {
      const created = await graphPost(token, `/${metaAccount.externalId}/customaudiences`, {
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
      // CA8: creation IS a full sync of the current
      // segment — seed the membership snapshot so the
      // first refreshMembership can diff against it (and
      // delete departures) instead of starting blind.
      // writeSnapshot never throws: a snapshot failure
      // degrades the next sync to a baseline sync, it
      // never fails a creation Meta already confirmed.
      await this.writeSnapshot(organizationId, record.id, pairs);
    } catch (e) {
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id },
        data: { status: "failed", error: e instanceof Error ? e.message : "Audience creation failed" },
      });
    }
    return (this.prisma as any).audienceRecord.findUnique({ where: { id: record.id } });
  }

  /** OU4: Google Customer Match custom audience. Same record +
   *  failure discipline as Meta: the record counts as built only
   *  when Google confirmed the user list AND accepted the offline
   *  upload job; size comes from Google on refresh, never here. */
  private async createCustomGoogle(organizationId: string, actorId: string, dto: {
    adAccountId: string; name: string; source: string; segment?: string;
  }, account: any) {
    const pairs = await this.contactsFor(organizationId, dto.source, dto.segment);
    if (pairs.length === 0) throw badRequest("audiences.noContactsWithAnEmailOr");
    const secrets = await this.platformSecrets(organizationId, account, "google");
    if (!account.externalId) throw badRequest("audiences.googleAdAccountHasNoCustomer");
    const customerId = String(account.externalId);
    const record = await (this.prisma as any).audienceRecord.create({
      data: {
        organizationId, adAccountId: dto.adAccountId, name: dto.name, kind: "custom",
        source: dto.source, sourceDetail: dto.segment ?? null, status: "building", createdById: actorId,
      },
    });
    try {
      const manage = this.googleManage(secrets);
      const created = await manage.createCustomerMatchList(customerId, dto.name,
        `Built by Qosprey AI Marketing SaaS from ${dto.source}${dto.segment ? ` (${dto.segment})` : ""}`);
      if (!created?.userListId) throw new Error("Google returned no user list id; creation is NOT confirmed");
      await manage.uploadCustomerMatch(customerId, created.resourceName,
        pairs.map(([e, p]) => ({ hashedEmail: e || undefined, hashedPhone: p || undefined })));
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id },
        data: { externalAudienceId: String(created.userListId), lastSyncedAt: new Date(), error: null },
      });
      await this.audit.log({ organizationId, userId: actorId, action: "audience.created", entityType: "AudienceRecord", entityId: record.id, metadata: { contacts: pairs.length, platform: "google" } });
    } catch (e) {
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id },
        data: { status: "failed", error: e instanceof Error ? e.message : "Audience creation failed" },
      });
    }
    return (this.prisma as any).audienceRecord.findUnique({ where: { id: record.id } });
  }

  /** OU4: TikTok DMP custom audience (hashed file upload — see
   *  tiktokLines for the one-identifier-type-per-file rule). */
  private async createCustomTikTok(organizationId: string, actorId: string, dto: {
    adAccountId: string; name: string; source: string; segment?: string;
  }, account: any) {
    const pairs = await this.contactsFor(organizationId, dto.source, dto.segment);
    if (pairs.length === 0) throw badRequest("audiences.noContactsWithAnEmailOr");
    const secrets = await this.platformSecrets(organizationId, account, "tiktok");
    if (!secrets.accessToken) throw badRequest("audiences.tiktokCredentialsAreMissingAccesstokenReconnect");
    const advertiserId = secrets.advertiserId ?? account.externalId;
    if (!advertiserId) throw badRequest("audiences.tiktokAdAccountHasNoAdvertiser");
    const record = await (this.prisma as any).audienceRecord.create({
      data: {
        organizationId, adAccountId: dto.adAccountId, name: dto.name, kind: "custom",
        source: dto.source, sourceDetail: dto.segment ?? null, status: "building", createdById: actorId,
      },
    });
    try {
      const manage = this.tiktokManage(String(secrets.accessToken));
      const created = await manage.createCustomAudience(String(advertiserId), dto.name, this.tiktokLines(pairs));
      if (!created?.audienceExternalId) throw new Error("TikTok returned no audience id; creation is NOT confirmed");
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id },
        data: { externalAudienceId: String(created.audienceExternalId), lastSyncedAt: new Date(), error: null },
      });
      await this.audit.log({ organizationId, userId: actorId, action: "audience.created", entityType: "AudienceRecord", entityId: record.id, metadata: { contacts: pairs.length, platform: "tiktok" } });
    } catch (e) {
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id },
        data: { status: "failed", error: e instanceof Error ? e.message : "Audience creation failed" },
      });
    }
    return (this.prisma as any).audienceRecord.findUnique({ where: { id: record.id } });
  }

  // ---------- CA8: membership snapshot (full-sync state) ----------
  /** The snapshot is the pair set the last successful sync
   *  established on Meta. Missing delegate/table or missing
   *  row both read as "no baseline" (null) — the sync then
   *  runs as a baseline sync (upload all, delete none). */
  private async readSnapshot(recordId: string): Promise<Map<string, [string, string]> | null> {
    const d = (this.prisma as any).audienceMembershipSnapshot;
    if (!d?.findFirst) return null;
    const row = await d.findFirst({ where: { audienceRecordId: recordId } }).catch(() => null);
    if (!row) return null;
    const map = new Map<string, [string, string]>();
    for (const p of Array.isArray(row.pairs) ? row.pairs : []) {
      if (Array.isArray(p) && p.length >= 2) map.set(`${p[0]}|${p[1]}`, [String(p[0]), String(p[1])]);
    }
    return map;
  }

  /** Persist the snapshot. NEVER throws — snapshot trouble
   *  degrades the next sync (baseline re-upload, or a
   *  retried deletion), it must never fail a sync Meta
   *  already confirmed. */
  private async writeSnapshot(organizationId: string, recordId: string, pairs: Iterable<[string, string]>) {
    const d = (this.prisma as any).audienceMembershipSnapshot;
    if (!d?.findFirst) return;
    try {
      const list = [...pairs];
      const existing = await d.findFirst({ where: { audienceRecordId: recordId } }).catch(() => null);
      const data = { organizationId, audienceRecordId: recordId, pairs: list, memberCount: list.length, syncedAt: new Date() };
      if (existing) await d.update({ where: { id: existing.id }, data });
      else await d.create({ data });
    } catch { /* documented above — deliberately swallowed */ }
  }

  /** Membership refresh — OU4 + CA8 union: the record's
   *  account platform decides the path. Google/TikTok go to
   *  refreshMembershipCrossPlatform (append-style upload;
   *  those platforms report no synchronous received count).
   *  Meta runs CA8's full membership sync: diff the CURRENT
   *  segment against the snapshot the last sync established,
   *  upload additions, DELETE departures, and never wipe the
   *  audience on an empty or failed source read. */
  async refreshMembership(organizationId: string, actorId: string, recordId: string) {
    const record = await (this.prisma as any).audienceRecord.findFirst({ where: { id: recordId, organizationId } });
    if (!record) throw notFound("audiences.audienceNotFound");
    // OU4: branch by the record's account platform.
    const account = await this.adAccountFor(organizationId, record.adAccountId);
    const platform = this.platformOf(account);
    if (record.kind !== "custom" || !record.externalAudienceId) {
      throw new BadRequestException(platform === "meta"
        ? "Only a built custom audience with a Meta id can be refreshed"
        : `Only a built custom audience with a ${platform} id can be refreshed`);
    }
    // OU4 + CA8 union: Google/TikTok keep OU4's cross-platform
    // refresh (append-style upload — no snapshot/delete path
    // exists for those platforms); Meta runs CA8's snapshot
    // full-sync below.
    if (platform === "google" || platform === "tiktok") {
      const pairs = await this.contactsFor(organizationId, record.source, record.sourceDetail ?? undefined);
      if (pairs.length === 0) throw badRequest("audiences.noContactsWithAnEmailOr");
      return this.refreshMembershipCrossPlatform(organizationId, actorId, record, account, platform, pairs);
    }
    let pairs: [string, string][];
    try {
      pairs = await this.contactsFor(organizationId, record.source, record.sourceDetail ?? undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Membership source read failed";
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id },
        data: { error: `সদস্য তালিকা পড়া যায়নি — Meta-তে কোনো পরিবর্তন করা হয়নি: ${msg}` },
      }).catch(() => undefined);
      throw new BadRequestException(msg);
    }
    const previous = await this.readSnapshot(record.id);
    const priorCount = previous ? previous.size : (record.lastMembershipCount ?? 0);
    if (pairs.length === 0) {
      if (priorCount > 0) {
        const reason = "Source এখন খালি ফিরেছে, কিন্তু Audience-এ আগের সদস্য আছে — নিরাপত্তার জন্য এই Sync-এ কোনো সদস্য যোগ বা মোছা হয়নি (খালি Source দিয়ে Audience মুছে ফেলা হয় না)";
        await (this.prisma as any).audienceRecord.update({ where: { id: record.id }, data: { error: reason } }).catch(() => undefined);
        await this.audit.log({ organizationId, userId: actorId, action: "audience.membership_sync_skipped", entityType: "AudienceRecord", entityId: record.id, metadata: { reason, priorCount } }).catch(() => undefined);
        return { ...record, uploaded: 0, added: 0, removed: 0, receivedByMeta: 0, deletionsSkipped: true, skipReason: reason };
      }
      throw badRequest("audiences.noContactsWithAnEmailOr");
    }
    const { token } = await metaTokenForAccount(this.prisma, organizationId, record.adAccountId).catch((e) => {
      throw new BadRequestException(e instanceof Error ? e.message : "Meta account resolution failed");
    });
    const keyOf = (p: [string, string]) => `${p[0]}|${p[1]}`;
    const current = new Map<string, [string, string]>(pairs.map((p) => [keyOf(p), p]));
    const baseline = previous === null;
    const additions: [string, string][] = baseline ? [...current.values()] : [...current.values()].filter((p) => !previous.has(keyOf(p)));
    const departures: [string, string][] = baseline ? [] : [...previous.values()].filter((p) => !current.has(keyOf(p)));
    const schema = ["EMAIL_SHA256", "PHONE_SHA256"];
    let received = 0;
    try {
      for (let i = 0; i < additions.length; i += BATCH) {
        const chunk = additions.slice(i, i + BATCH);
        const res = await graphPost(token, `/${record.externalAudienceId}/users`, {
          payload: JSON.stringify({ schema, data: chunk }),
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
    let removed = 0;
    try {
      for (let i = 0; i < departures.length; i += BATCH) {
        const chunk = departures.slice(i, i + BATCH);
        await graphDelete(token, `/${record.externalAudienceId}/users`, {
          payload: JSON.stringify({ schema, data: chunk }),
        });
        removed += chunk.length;
      }
    } catch (e) {
      // Additions DID land on Meta; departures did not.
      // Persist previous ∪ additions so the departed pairs
      // stay in the snapshot and are retried next sync.
      const retry = new Map<string, [string, string]>(previous ?? []);
      for (const p of additions) retry.set(keyOf(p), p);
      await this.writeSnapshot(organizationId, record.id, retry.values());
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id },
        data: { error: e instanceof Error ? e.message : "Membership removal failed", lastMembershipSyncAt: new Date(), lastMembershipCount: retry.size },
      }).catch(() => undefined);
      throw new BadRequestException(e instanceof Error ? e.message : "Membership removal failed");
    }
    await this.writeSnapshot(organizationId, record.id, current.values());
    const updated = await (this.prisma as any).audienceRecord.update({
      where: { id: record.id },
      data: { lastMembershipSyncAt: new Date(), lastMembershipCount: current.size, error: null },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "audience.membership_refreshed", entityType: "AudienceRecord", entityId: record.id, metadata: { contacts: current.size, added: additions.length, removed, received, baseline } });
    return { ...updated, uploaded: additions.length, added: additions.length, removed, receivedByMeta: received, deletionsSkipped: false, ...(baseline ? { baselineEstablished: true } : {}) };
  }

  /** OU4: membership refresh for Google / TikTok. Google and
   *  TikTok report NO synchronous received count, so none is
   *  stored or returned — only the uploaded pair count, exactly
   *  like Meta's lastMembershipCount discipline. */
  private async refreshMembershipCrossPlatform(
    organizationId: string, actorId: string, record: any, account: any,
    platform: "google" | "tiktok", pairs: [string, string][],
  ) {
    try {
      if (platform === "google") {
        const secrets = await this.platformSecrets(organizationId, account, "google");
        if (!account.externalId) throw new Error("Google ad account has no customer id (externalId); reconnect the account");
        const customerId = String(account.externalId);
        const resourceName = `customers/${customerId.replace(/-/g, "")}/userLists/${record.externalAudienceId}`;
        await this.googleManage(secrets).uploadCustomerMatch(customerId, resourceName,
          pairs.map(([e, p]) => ({ hashedEmail: e || undefined, hashedPhone: p || undefined })));
      } else {
        const secrets = await this.platformSecrets(organizationId, account, "tiktok");
        if (!secrets.accessToken) throw new Error("tiktok credentials are missing accessToken; reconnect the account");
        const advertiserId = secrets.advertiserId ?? account.externalId;
        if (!advertiserId) throw new Error("TikTok ad account has no advertiser id (externalId); reconnect the account");
        // TikTok file rule: one identifier type per file — email
        // hashes when any exist, else phone hashes (see tiktokLines).
        await this.tiktokManage(String(secrets.accessToken)).updateCustomAudience(
          String(advertiserId), String(record.externalAudienceId), this.tiktokLines(pairs));
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
    await this.audit.log({ organizationId, userId: actorId, action: "audience.membership_refreshed", entityType: "AudienceRecord", entityId: record.id, metadata: { contacts: pairs.length, platform } });
    return { ...updated, uploaded: pairs.length };
  }

  /** Scheduler entry: refresh every built custom audience of the org.
   *  CA8(b): the same run also refreshes size/status for
   *  EVERY built record (lookalikes included — membership
   *  sync covers custom only) and the CA7 performance
   *  rollups, so the one audience_refresh job keeps the
   *  whole audience picture current. Each leg reports its
   *  own counts; one leg failing never blocks the others. */
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
    let sizesRefreshed = 0; const sizeErrors: string[] = [];
    const built = await (this.prisma as any).audienceRecord.findMany({ where: { organizationId } }).catch(() => []);
    for (const rec of built ?? []) {
      if (!rec.externalAudienceId || rec.status === "failed") continue;
      try { await this.refresh(organizationId, rec.id); sizesRefreshed++; }
      catch (e) { sizeErrors.push(`${rec.name}: ${e instanceof Error ? e.message : "size refresh failed"}`); }
    }
    let performanceRefreshed = false; let performanceError: string | undefined;
    try { await this.refreshPerformanceRollups(organizationId); performanceRefreshed = true; }
    catch (e) { performanceError = e instanceof Error ? e.message : "performance rollup refresh failed"; }
    return { audiences: records.length, refreshed, errors, sizesRefreshed, sizeErrors, performanceRefreshed, ...(performanceError ? { performanceError } : {}) };
  }

  async createLookalike(organizationId: string, actorId: string, dto: {
    adAccountId: string; name: string; sourceAudienceRecordId: string; country: string; ratio?: number;
  }) {
    // OU4: branch by the destination account's platform first.
    const destAccount = await this.adAccountFor(organizationId, dto.adAccountId);
    const destPlatform = this.platformOf(destAccount);
    if (destPlatform === "google") {
      // Honest limit: Google Ads offers NO API-created lookalike —
      // similar audiences are auto-generated by Google from a
      // Customer Match list, so there is nothing to create here.
      throw badRequest("audiences.googleAdsOffersNoApiCreated");
    }
    if (destPlatform === "tiktok") return this.createLookalikeTikTok(organizationId, actorId, dto, destAccount);
    const source = await (this.prisma as any).audienceRecord.findFirst({ where: { id: dto.sourceAudienceRecordId, organizationId } });
    if (!source?.externalAudienceId) throw badRequest("audiences.sourceAudienceHasNoMetaAudience");
    const ratio = dto.ratio ?? 0.01;
    if (ratio < 0.01 || ratio > 0.20) throw badRequest("audiences.ratioMustBeBetween001");
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

  /** OU4: TikTok lookalike. TikTok expresses size as a tier, not
   *  Meta's ratio: ratio ≤0.05 → NARROW, ≤0.10 → BALANCED, else
   *  BROAD. The source record must belong to a TikTok account and
   *  already carry a TikTok audience id. */
  private async createLookalikeTikTok(organizationId: string, actorId: string, dto: {
    adAccountId: string; name: string; sourceAudienceRecordId: string; country: string; ratio?: number;
  }, account: any) {
    const source = await (this.prisma as any).audienceRecord.findFirst({ where: { id: dto.sourceAudienceRecordId, organizationId } });
    if (!source?.externalAudienceId) throw badRequest("audiences.sourceAudienceHasNoTiktokAudience");
    const sourceAccount = await this.adAccountFor(organizationId, source.adAccountId);
    if (!sourceAccount || this.platformOf(sourceAccount) !== "tiktok") {
      throw badRequest("audiences.sourceAudienceDoesNotBelongTo");
    }
    const ratio = dto.ratio ?? 0.01;
    if (ratio < 0.01 || ratio > 0.20) throw badRequest("audiences.ratioMustBeBetween001");
    const tier: "NARROW" | "BALANCED" | "BROAD" = ratio <= 0.05 ? "NARROW" : ratio <= 0.10 ? "BALANCED" : "BROAD";
    const secrets = await this.platformSecrets(organizationId, account, "tiktok");
    if (!secrets.accessToken) throw badRequest("audiences.tiktokCredentialsAreMissingAccesstokenReconnect");
    const advertiserId = secrets.advertiserId ?? account.externalId;
    if (!advertiserId) throw badRequest("audiences.tiktokAdAccountHasNoAdvertiser");
    const record = await (this.prisma as any).audienceRecord.create({
      data: {
        organizationId, adAccountId: dto.adAccountId, name: dto.name, kind: "lookalike",
        source: "tiktok", sourceDetail: `from ${source.name}`, status: "building", createdById: actorId,
      },
    });
    try {
      const created = await this.tiktokManage(String(secrets.accessToken)).createLookalikeAudience(String(advertiserId), {
        name: dto.name, sourceAudienceId: String(source.externalAudienceId), country: dto.country, tier,
      });
      if (!created?.audienceExternalId) throw new Error("TikTok returned no lookalike audience id; creation is NOT confirmed");
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id }, data: { externalAudienceId: String(created.audienceExternalId), lastSyncedAt: new Date(), error: null },
      });
    } catch (e) {
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id }, data: { status: "failed", error: e instanceof Error ? e.message : "Lookalike creation failed" },
      });
    }
    await this.audit.log({ organizationId, userId: actorId, action: "audience.lookalike_created", entityType: "AudienceRecord", entityId: record.id, metadata: { country: dto.country, ratio, platform: "tiktok", tier } });
    return (this.prisma as any).audienceRecord.findUnique({ where: { id: record.id } });
  }

  /** Pull the platform's own delivery status + approximate count. */
  async refresh(organizationId: string, recordId: string) {
    const record = await (this.prisma as any).audienceRecord.findFirst({ where: { id: recordId, organizationId } });
    if (!record) throw notFound("audiences.audienceNotFound");
    // OU4: branch by the record's account platform.
    const account = await this.adAccountFor(organizationId, record.adAccountId);
    const platform = this.platformOf(account);
    if (platform === "google") {
      if (!record.externalAudienceId) throw badRequest("audiences.thisAudienceWasNeverConfirmedBy");
      const secrets = await this.platformSecrets(organizationId, account, "google");
      if (!account.externalId) throw badRequest("audiences.googleAdAccountHasNoCustomer");
      const info = await this.googleManage(secrets).getUserList(String(account.externalId), String(record.externalAudienceId));
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id },
        data: {
          // Google's size_for_display is often a RANGE (the client
          // only parses a plain number into approximateCount) — a
          // range keeps the old count, never a guessed midpoint.
          approximateCount: info.approximateCount != null ? Number(info.approximateCount) : record.approximateCount,
          status: "ready",
          lastSyncedAt: new Date(),
        },
      });
      return (this.prisma as any).audienceRecord.findUnique({ where: { id: record.id } });
    }
    if (platform === "tiktok") {
      if (!record.externalAudienceId) throw badRequest("audiences.thisAudienceWasNeverConfirmedBy3");
      const secrets = await this.platformSecrets(organizationId, account, "tiktok");
      if (!secrets.accessToken) throw badRequest("audiences.tiktokCredentialsAreMissingAccesstokenReconnect");
      const advertiserId = secrets.advertiserId ?? account.externalId;
      if (!advertiserId) throw badRequest("audiences.tiktokAdAccountHasNoAdvertiser");
      const info = await this.tiktokManage(String(secrets.accessToken)).getCustomAudience(String(advertiserId), String(record.externalAudienceId));
      await (this.prisma as any).audienceRecord.update({
        where: { id: record.id },
        data: {
          approximateCount: info.size != null ? Number(info.size) : record.approximateCount,
          status: "ready",
          lastSyncedAt: new Date(),
        },
      });
      return (this.prisma as any).audienceRecord.findUnique({ where: { id: record.id } });
    }
    if (!record.externalAudienceId) throw badRequest("audiences.thisAudienceWasNeverConfirmedBy2");
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
    if (!dto.targeting || typeof dto.targeting !== "object") throw badRequest("audiences.targetingMustBeAnObject");
    return (this.prisma as any).savedAudience.create({ data: { organizationId, name: dto.name, targeting: dto.targeting, createdById: actorId } });
  }
  async deleteSaved(organizationId: string, id: string) {
    const row = await (this.prisma as any).savedAudience.findFirst({ where: { id, organizationId } });
    if (!row) throw notFound("audiences.savedAudienceNotFound");
    await (this.prisma as any).savedAudience.delete({ where: { id } });
    return { deleted: true };
  }

  // ---------- CA7: per-audience performance history ----------
  /** Classify every PUBLISHED ad set of the org by the
   *  audience it used. Attribution is deliberately strict:
   *  a set counts toward an audience only when its stored
   *  targeting names EXACTLY ONE audience source — a
   *  savedAudienceId that resolves to our SavedAudience, or
   *  exactly one distinct customAudienceId that resolves to
   *  our AudienceRecord. Sets naming 2+ sources are
   *  AMBIGUOUS (excluded, counted); a set naming one
   *  external id we do not own is UNKNOWN (excluded,
   *  counted); a set naming none is simply not an
   *  audience-attributed set. DailyAdMetric has no audience
   *  dimension, so this join is the only honest derivation —
   *  spend is never split across audiences. */
  private async audienceAttributionMap(organizationId: string) {
    const p = this.prisma as any;
    const plans = p.campaignPlan?.findMany ? await p.campaignPlan.findMany({ where: { organizationId } }).catch(() => []) : [];
    const planIds = new Set((plans ?? []).map((pl: any) => pl.id));
    const planAccount = new Map((plans ?? []).map((pl: any) => [pl.id, pl.adAccountId]));
    const adSets = p.campaignAdSet?.findMany ? await p.campaignAdSet.findMany({ where: {} }).catch(() => []) : [];
    const records = p.audienceRecord?.findMany ? await p.audienceRecord.findMany({ where: { organizationId } }).catch(() => []) : [];
    const saved = p.savedAudience?.findMany ? await p.savedAudience.findMany({ where: { organizationId } }).catch(() => []) : [];
    const recordByExt = new Map<string, any>((records ?? []).filter((r: any) => r.externalAudienceId).map((r: any) => [String(r.externalAudienceId), r]));
    const savedById = new Map<string, any>((saved ?? []).map((s: any) => [String(s.id), s]));
    const perSet = new Map<string, { key: string; kind: string; recordId: string | null; savedId: string | null; name: string; adAccountId: string | null }>();
    const coverage = { adSetsWithAudience: 0, adSetsCounted: 0, adSetsAmbiguousExcluded: 0, adSetsUnknownExcluded: 0, adSetsWithoutAudience: 0 };
    for (const s of adSets ?? []) {
      if (!planIds.has(s.planId) || !s.externalAdSetId) continue;
      const t = s.targeting ?? {};
      const includes: string[] = [...new Set<string>((Array.isArray(t.customAudienceIds) ? t.customAudienceIds : []).map(String).filter(Boolean))];
      const sources: { type: "saved" | "ext"; id: string }[] = [];
      if (t.savedAudienceId && savedById.has(String(t.savedAudienceId))) sources.push({ type: "saved", id: String(t.savedAudienceId) });
      for (const ext of includes) sources.push({ type: "ext", id: ext });
      if (!sources.length) { coverage.adSetsWithoutAudience++; continue; }
      coverage.adSetsWithAudience++;
      if (sources.length >= 2) { coverage.adSetsAmbiguousExcluded++; continue; }
      const src = sources[0];
      if (src.type === "saved") {
        const sv = savedById.get(src.id);
        perSet.set(String(s.externalAdSetId), { key: `saved:${src.id}`, kind: "saved", recordId: null, savedId: src.id, name: String(sv?.name ?? src.id), adAccountId: planAccount.get(s.planId) ? String(planAccount.get(s.planId)) : null });
        coverage.adSetsCounted++;
      } else {
        const rec = recordByExt.get(src.id);
        if (!rec) { coverage.adSetsUnknownExcluded++; continue; }
        perSet.set(String(s.externalAdSetId), { key: `record:${rec.id}`, kind: String(rec.kind ?? "custom"), recordId: rec.id, savedId: null, name: String(rec.name ?? src.id), adAccountId: rec.adAccountId ? String(rec.adAccountId) : (planAccount.get(s.planId) ? String(planAccount.get(s.planId)) : null) });
        coverage.adSetsCounted++;
      }
    }
    return { perSet, coverage };
  }

  /** CA7: recompute the per-audience rollups for the fixed
   *  window from REAL DailyAdMetric rows (per-ad-set rows
   *  only — the planPerformance counting rule: a row counts
   *  when adExternalId is empty). Audiences whose sets left
   *  the window keep a row, visibly zeroed with a fresh
   *  computedAt, instead of stale numbers living forever. */
  async refreshPerformanceRollups(organizationId: string) {
    const p = this.prisma as any;
    if (!p.audiencePerformanceRollup?.findMany) return this.listPerformance(organizationId);
    const windowDays = AUDIENCE_PERFORMANCE_WINDOW_DAYS;
    const since = new Date(Date.now() - windowDays * 86400000);
    const { perSet, coverage } = await this.audienceAttributionMap(organizationId);
    type Tot = { key: string; kind: string; recordId: string | null; savedId: string | null; name: string; adAccountId: string | null; spendMinor: bigint; impressions: number; clicks: number; conversions: number; adSets: Set<string> };
    const totals = new Map<string, Tot>();
    type Attr = { key: string; kind: string; recordId: string | null; savedId: string | null; name: string; adAccountId: string | null };
    const ensure = (attr: Attr, extId: string): Tot => {
      let t = totals.get(attr.key);
      if (!t) { t = { key: attr.key, kind: attr.kind, recordId: attr.recordId, savedId: attr.savedId, name: attr.name, adAccountId: attr.adAccountId, spendMinor: 0n, impressions: 0, clicks: 0, conversions: 0, adSets: new Set() }; totals.set(attr.key, t); }
      t.adSets.add(extId);
      return t;
    };
    for (const [extId, attr] of perSet.entries()) ensure(attr, extId);
    if (perSet.size && p.dailyAdMetric?.findMany) {
      const rows = await p.dailyAdMetric.findMany({ where: { organizationId, date: { gte: since } }, take: 50000 }).catch(() => []);
      for (const r of rows ?? []) {
        if ((r.adExternalId ?? "") !== "") continue;
        if (r.date && new Date(r.date) < since) continue;
        const attr = perSet.get(String(r.adSetExternalId ?? ""));
        if (!attr) continue;
        const t = ensure(attr, String(r.adSetExternalId));
        try { t.spendMinor += BigInt(r.spendMinor ?? 0); } catch { /* a malformed row never poisons the rollup */ }
        t.impressions += Number(r.impressions ?? 0) || 0;
        t.clicks += Number(r.clicks ?? 0) || 0;
        t.conversions += Number(r.platformConversions ?? 0) || 0;
      }
    }
    const now = new Date();
    const seen = new Set<string>();
    for (const t of totals.values()) {
      seen.add(t.key);
      const data = {
        organizationId, audienceKey: t.key, audienceKind: t.kind, audienceRecordId: t.recordId, savedAudienceId: t.savedId,
        name: t.name, adAccountId: t.adAccountId, spendMinor: t.spendMinor, impressions: t.impressions, clicks: t.clicks,
        conversions: t.conversions, windowDays, adSetsCounted: t.adSets.size, computedAt: now,
      };
      const existing = await p.audiencePerformanceRollup.findFirst({ where: { organizationId, audienceKey: t.key } });
      if (existing) await p.audiencePerformanceRollup.update({ where: { id: existing.id }, data });
      else await p.audiencePerformanceRollup.create({ data });
    }
    const existingRows = await p.audiencePerformanceRollup.findMany({ where: { organizationId } }).catch(() => []);
    for (const row of existingRows ?? []) {
      if (seen.has(row.audienceKey)) continue;
      await p.audiencePerformanceRollup.update({
        where: { id: row.id },
        data: { spendMinor: 0n, impressions: 0, clicks: 0, conversions: 0, adSetsCounted: 0, windowDays, computedAt: now },
      }).catch(() => undefined);
    }
    await this.audit?.log?.({ organizationId, userId: "system", action: "audience.performance_refreshed", entityType: "AudiencePerformanceRollup", entityId: organizationId, metadata: { windowDays, audiences: seen.size, ...coverage } }).catch(() => undefined);
    return this.listPerformance(organizationId);
  }

  /** CA7 read path: stored rollups + the honest coverage
   *  note (computed live, so the exclusion counts always
   *  describe the org's CURRENT ad sets). CPA/CTR derived
   *  here, never stored; a division with no denominator is
   *  null, never 0. */
  async listPerformance(organizationId: string) {
    const p = this.prisma as any;
    const empty = { windowDays: AUDIENCE_PERFORMANCE_WINDOW_DAYS, refreshedAt: null as Date | null, coverage: null as any, items: [] as any[] };
    if (!p.audiencePerformanceRollup?.findMany) return empty;
    const rows = await p.audiencePerformanceRollup.findMany({ where: { organizationId }, take: 500 }).catch(() => []);
    const { coverage } = await this.audienceAttributionMap(organizationId).catch(() => ({ coverage: null }));
    const refreshedAt = (rows ?? []).reduce((max: Date | null, r: any) => (r.computedAt && (!max || new Date(r.computedAt) > max) ? new Date(r.computedAt) : max), null);
    const items = (rows ?? []).map((r: any) => AudiencesService.rollupView(r)).sort((a: any, b: any) => b.spend - a.spend);
    return { windowDays: AUDIENCE_PERFORMANCE_WINDOW_DAYS, refreshedAt, coverage, items };
  }

  /** The one read-shape of a rollup row (money in BDT,
   *  CPA/CTR derived, null when the denominator is 0 —
   *  shared by listPerformance and the builder's Audience
   *  Studio so the two surfaces can never drift). */
  static rollupView(r: any) {
    const spend = Number(BigInt(r.spendMinor ?? 0)) / 100;
    const conversions = Number(r.conversions ?? 0);
    const impressions = Number(r.impressions ?? 0);
    const clicks = Number(r.clicks ?? 0);
    return {
      audienceKey: r.audienceKey, kind: r.audienceKind,
      audienceRecordId: r.audienceRecordId ?? null, savedAudienceId: r.savedAudienceId ?? null,
      name: r.name, adAccountId: r.adAccountId ?? null,
      spend, impressions, clicks, conversions,
      cpa: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : null,
      ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : null,
      windowDays: r.windowDays, adSetsCounted: r.adSetsCounted, computedAt: r.computedAt,
    };
  }
}
