import { normalizeTags } from "../inbox/inbox.service";
import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { createAgentNotification } from "../common/agent-notify";
import { parseMoneyToMinor } from "@repo/contracts";
import { EventsService } from "../common/events.service";
import { AuditService } from "../audit/audit.service";
import { minorToMajor, parseLeadsCsv, toCsv } from "../imports/csv";
import { CustomFieldsService, renderCustomFieldValue } from "./custom-fields.service";
import { classifyDue, dhakaDayKey, dhakaDayStartUtc, followUpDateFor, followUpNotificationText, normalizeFollowUpDefaults, validateFollowUpDefaults } from "./lead-followups";
import { scoreLead, type LeadScore } from "./lead-score";
import { LeadAssignmentService } from "./lead-assignment.service";
import { badRequest, notFound } from "../i18n/api-exception";

export const LEAD_STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
export const LEAD_SOURCES = ["manual", "whatsapp", "messenger", "woocommerce", "website"] as const;

// CX10: Default stage follow-up intervals in days
// Integration note: the owner's CX10 variant stamped follow-ups
// from this static map unconditionally. The integrated behaviour
// is the settings-driven CX10 (per-org CrmSetting hours; no setting
// → no stamp, per the platform's opt-in discipline). This map is
// retained as the SUGGESTED defaults for the settings UI.
export const DEFAULT_STAGE_FOLLOWUP_DAYS: Record<string, number> = {
  new: 1,
  contacted: 3,
  qualified: 2,
  proposal: 5,
  won: 30,
  lost: 60,
};

/** CRM C6: every source string a Lead row can honestly carry —
 * the manual-create vocabulary above, plus what the ingestion
 * paths write: the channel name (InboxService auto-lead),
 * "webchat" (WebchatService) and "facebook_lead_ads" (Meta
 * leadgen; see the Lead.source schema comment). The funnel
 * reports all of these (in this order) plus any other source
 * present in the org's data. */
export const FUNNEL_SOURCES = [
  "manual", "whatsapp", "messenger", "instagram", "telegram", "email",
  "website", "webchat", "woocommerce", "facebook_lead_ads",
] as const;

/** CRM C3: leads CSV import row cap (the orders importer has no row
 * cap of its own — only the DTO's 2 MB text cap — so the package
 * plan's fallback applies: 1000 data rows, clear 400 beyond). */
export const LEAD_IMPORT_ROW_CAP = 1000;

/** Phone dedupe key: digits only, last 10 — the same discipline as
 * duplicates() below. Keys shorter than 6 digits are too weak to
 * dedupe on and return null (the row is then never skipped). */
export function leadPhoneKey(phone?: string | null): string | null {
  if (!phone) return null;
  const key = String(phone).replace(/\D/g, "").slice(-10);
  return key.length >= 6 ? key : null;
}

@Injectable()
export class LeadsService {
  /** CRM C5: the auto-assignment engine. Nest injects the
   * module provider; direct constructions in older unit specs
   * fall back to an instance bound to the same Prisma client
   * (whose defensive reads degrade to strategy "off" when the
   * CrmSetting table is absent from a partial fake). */
  private readonly assigner: LeadAssignmentService;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly events?: EventsService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly customFields?: CustomFieldsService,
    @Optional() assignment?: LeadAssignmentService,
  ) {
    this.assigner = assignment ?? new LeadAssignmentService(prisma);
  }

  private async log(leadId: string, userId: string | null, type: string, content: string) {
    await (this.prisma as any).leadActivity.create({ data: { leadId, userId, type, content } });
  }

  private toPublic(lead: any) {
    return { ...lead, valueMinor: lead.valueMinor != null ? String(lead.valueMinor) : null };
  }

  async create(organizationId: string, actorId: string, dto: {
    name: string; phone?: string; email?: string; source?: string; stage?: string;
    value?: string; currency?: string; notes?: string; nextFollowUpAt?: string;
    // Service-level only (the public create DTO does not expose it):
    // the C3 CSV importer passes the row's tags through the same
    // creation path instead of a second write.
    tags?: string[];
    // CRM C4: validated against the org's lead CustomFieldDefs.
    customFields?: Record<string, unknown> | null;
    // CRM C5: an EXPLICIT owner (service-level only). When the
    // key is present at all — a user id, or null for deliberately
    // unassigned — it wins verbatim: auto-assignment is skipped
    // and the round-robin cursor never moves. When absent, the
    // org's strategy decides (see LeadAssignmentService).
    ownerUserId?: string | null;
  }, opts: { skipRequiredCustomFields?: boolean } = {}) {
    if (dto.source && !(LEAD_SOURCES as readonly string[]).includes(dto.source)) throw badRequest("crm.invalidSource");
    if (dto.stage && !(LEAD_STAGES as readonly string[]).includes(dto.stage)) throw badRequest("crm.invalidStage");
    // CRM C4: required defs are enforced on create (unless the
    // caller is the CSV importer — bulk legacy rows carry no custom
    // values; see docs/crm-c4-acceptance.md). Types are ALWAYS
    // validated when values are supplied.
    let customFields: Record<string, unknown> | null = null;
    if (this.customFields) {
      const sanitized = await this.customFields.validateAndSanitize(organizationId, "lead", dto.customFields ?? {}, {
        forCreate: !opts.skipRequiredCustomFields,
      });
      const merged = this.customFields.mergeValues(null, sanitized);
      customFields = Object.keys(merged).length ? merged : null;
    } else if (dto.customFields && Object.keys(dto.customFields).length) {
      throw badRequest("crm.customFieldsAreNotAvailableIn");
    }
    const explicitOwner = dto.ownerUserId !== undefined;
    // CX10: no explicit follow-up date → the org's per-stage
    // default (CrmSetting.followUpDefaultsByStage) stamps
    // now + hours for the created stage, when one exists. An
    // explicit date (manual DTO or a CSV row's date — the importer
    // passes it through this same path) ALWAYS wins.
    let nextFollowUpAt: Date | null = dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null;
    if (!dto.nextFollowUpAt) {
      const stamped = followUpDateFor(await this.followUpSetting(organizationId), dto.stage ?? "new", new Date());
      if (stamped) nextFollowUpAt = stamped;
    }
    const lead = await (this.prisma as any).lead.create({
      data: {
        organizationId, name: dto.name, phone: dto.phone ?? null, email: dto.email?.toLowerCase() ?? null,
        source: dto.source ?? "manual", stage: dto.stage ?? "new",
        valueMinor: dto.value !== undefined ? parseMoneyToMinor(dto.value) : null,
        currency: dto.currency ?? "BDT", notes: dto.notes ?? null,
        // CRM C5: the provisional owner is the explicit choice, or
        // (pre-C5 behaviour) the creator. With a strategy on and
        // no explicit owner, assignNewLead below immediately
        // replaces it — or clears it when nobody is eligible, so
        // the lead honestly stays unassigned.
        ownerUserId: explicitOwner ? dto.ownerUserId : actorId,
        tags: dto.tags ? normalizeTags(dto.tags) : [],
        customFields,
        nextFollowUpAt,
      },
    });
    await this.log(lead.id, actorId, "created", `Lead created (source: ${lead.source})`);
    // CRM C5: auto-assignment runs only when no explicit owner
    // was supplied. It never throws into lead creation — a
    // failure leaves the provisional owner in place.
    let finalLead = lead;
    if (!explicitOwner) {
      const outcome = await this.assigner.assignNewLead(organizationId, lead.id).catch(() => null);
      if (outcome?.kind === "picked") finalLead = { ...lead, ownerUserId: outcome.userId };
      else if (outcome?.kind === "none") finalLead = { ...lead, ownerUserId: null };
    }
    this.events?.emit("lead.created", {
      organizationId,
      context: { leadId: lead.id, name: lead.name, email: lead.email, phone: lead.phone, stage: lead.stage, source: lead.source },
    });
    return this.toPublic(finalLead);
  }

  // ---------- CRM C5: lead auto-assignment setting ----------

  async getAssignmentSetting(organizationId: string) {
    return this.assigner.getSetting(organizationId);
  }

  async updateAssignmentSetting(organizationId: string, strategy: string) {
    return this.assigner.updateSetting(organizationId, strategy);
  }

  // ---------- CX10: per-stage follow-up default intervals ----------

  /** The org's CrmSetting row, or null when there is none (or the
   * table is absent from a partial test fake) — null means "no
   * defaults", i.e. pre-CX10 behaviour. Defensive like the
   * assignment service's reads. */
  private async followUpSetting(organizationId: string): Promise<any | null> {
    try {
      const row = await (this.prisma as any).crmSetting?.findUnique({ where: { organizationId } });
      return row ?? null;
    } catch {
      return null;
    }
  }

  async getFollowUpSetting(organizationId: string) {
    const row = await this.followUpSetting(organizationId);
    return { followUpDefaultsByStage: normalizeFollowUpDefaults(row?.followUpDefaultsByStage) };
  }

  /** Validates strictly (Bengali 400 on a bad stage / hours), then
   * upserts ONLY the followUpDefaultsByStage field on the org's
   * CrmSetting row — the assignment strategy/cursor are untouched.
   * An empty map (or null) clears the defaults back to null. */
  async updateFollowUpSetting(organizationId: string, raw: unknown) {
    let cleaned: ReturnType<typeof validateFollowUpDefaults>;
    try {
      cleaned = validateFollowUpDefaults(raw);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : "Invalid follow-up defaults");
    }
    const value = Object.keys(cleaned).length ? cleaned : null;
    const p = this.prisma as any;
    const existing = await p.crmSetting.findUnique({ where: { organizationId } }).catch(() => null);
    if (existing) {
      await p.crmSetting.update({ where: { organizationId }, data: { followUpDefaultsByStage: value } });
    } else {
      await p.crmSetting.create({ data: { organizationId, followUpDefaultsByStage: value } });
    }
    return { followUpDefaultsByStage: value };
  }

  async list(organizationId: string, filters: { stage?: string; source?: string; search?: string; sort?: string } = {}) {
    const items = await (this.prisma as any).lead.findMany({
      where: {
        organizationId,
        ...(filters.stage ? { stage: filters.stage } : {}),
        ...(filters.source ? { source: filters.source } : {}),
        ...(filters.search ? { OR: [
          { name: { contains: filters.search, mode: "insensitive" } },
          { phone: { contains: filters.search } },
          { email: { contains: filters.search, mode: "insensitive" } },
        ] } : {}),
      },
      orderBy: { updatedAt: "desc" }, take: 200,
    });
    // Merged leads disappear from the pipeline (their history lives on
    // the surviving lead).
    const visible = items.filter((l: any) => !l.mergedIntoId);
    // CRM C2: every row carries its compute-on-read score.
    const scores = await this.scoresFor(organizationId, visible);
    const out = visible.map((l: any) => ({ ...this.toPublic(l), score: scores.get(l.id) ?? null }));
    // sort=score: a score only exists after computing it over the
    // fetched candidates, so the sort applies to this same capped
    // candidate set (the list's existing take: 200) — documented in
    // docs/crm-c2-acceptance.md.
    if (filters.sort === "score") out.sort((a: any, b: any) => (b.score?.score ?? 0) - (a.score?.score ?? 0));
    return out;
  }

  // ---------- CRM C2: lead scoring (compute-on-read) ----------

  /** Delivered-order counts per customer id (status vocabulary
   * matches M50: completed | delivered). Best-effort: if the order
   * table is unavailable the counts are simply 0. */
  private async deliveredCounts(organizationId: string, customerIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!customerIds.length) return map;
    try {
      const rows = await (this.prisma as any).order?.findMany?.({
        where: { organizationId, customerId: { in: customerIds }, status: { in: ["completed", "delivered"] } },
        select: { customerId: true }, take: 5000,
      });
      for (const o of (rows ?? []) as any[]) map.set(o.customerId, (map.get(o.customerId) ?? 0) + 1);
    } catch { /* orders unavailable → all zero */ }
    return map;
  }

  /** Bulk-scores a page of leads with two extra queries total: one
   * for their activities, one for their customers' delivered
   * orders. Pure scoring lives in lead-score.ts (scoreLead). */
  private async scoresFor(organizationId: string, leads: any[]): Promise<Map<string, LeadScore>> {
    const map = new Map<string, LeadScore>();
    if (!leads.length) return map;
    const ids = leads.map((l) => l.id);
    let activities: any[] = [];
    try {
      activities = await (this.prisma as any).leadActivity.findMany({
        where: { leadId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 5000,
      });
    } catch { activities = []; }
    const byLead = new Map<string, { count: number; last: Date | null }>();
    for (const a of activities as any[]) {
      const cur = byLead.get(a.leadId) ?? { count: 0, last: null };
      cur.count += 1;
      const t = a.createdAt ? new Date(a.createdAt) : null;
      if (t && !Number.isNaN(t.getTime()) && (!cur.last || t > cur.last)) cur.last = t;
      byLead.set(a.leadId, cur);
    }
    const customerIds = [...new Set(leads.map((l) => l.customerId).filter(Boolean))] as string[];
    const delivered = await this.deliveredCounts(organizationId, customerIds);
    const now = new Date();
    for (const lead of leads) {
      const act = byLead.get(lead.id);
      map.set(lead.id, scoreLead({
        stage: lead.stage,
        valueMinor: lead.valueMinor == null ? null : Number(lead.valueMinor),
        activityCount: act?.count ?? 0,
        lastActivityAt: act?.last ?? null,
        lastContactedAt: lead.lastContactedAt ?? null,
        createdAt: lead.createdAt,
        nextFollowUpAt: lead.nextFollowUpAt ?? null,
        customerId: lead.customerId ?? null,
        deliveredOrderCount: lead.customerId ? delivered.get(lead.customerId) ?? 0 : 0,
      }, now));
    }
    return map;
  }

  // ---------- CRM C1: follow-up reminders ----------

  private async ownerNameMap(organizationId: string): Promise<Map<string, string>> {
    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId }, include: { user: true }, take: 200,
    }).catch(() => []);
    const map = new Map<string, string>();
    for (const m of memberships as any[]) {
      if (m.userId) map.set(m.userId, m.user?.name ?? m.user?.email ?? "সদস্য");
    }
    return map;
  }

  /** Open (not won/lost, not merged) leads whose follow-up is due:
   * nextFollowUpAt before tomorrow's Dhaka day-start. */
  private async dueFollowUpLeads(organizationId: string, now: Date) {
    const startTomorrow = new Date(dhakaDayStartUtc(now).getTime() + 86400000);
    return (this.prisma as any).lead.findMany({
      where: {
        organizationId, mergedIntoId: null, stage: { notIn: ["won", "lost"] },
        nextFollowUpAt: { not: null, lt: startTomorrow },
      },
      orderBy: { nextFollowUpAt: "asc" }, take: 500,
    }) as Promise<any[]>;
  }

  /** "আজকের ফলোআপ" board data: due-today group + overdue group
   * (oldest first), with server-side Asia/Dhaka day bounds. */
  async followUps(organizationId: string, now = new Date()) {
    const rows = await this.dueFollowUpLeads(organizationId, now);
    const names = await this.ownerNameMap(organizationId);
    const dueToday: any[] = [];
    const overdue: any[] = [];
    for (const lead of rows) {
      const due = classifyDue(lead.nextFollowUpAt, now);
      if (!due) continue;
      const row = {
        ...this.toPublic(lead),
        ownerName: lead.ownerUserId ? names.get(lead.ownerUserId) ?? null : null,
        due,
      };
      (due.bucket === "today" ? dueToday : overdue).push(row);
    }
    overdue.sort((a, b) => new Date(a.nextFollowUpAt).getTime() - new Date(b.nextFollowUpAt).getTime());
    return { dueToday, overdue, counts: { dueToday: dueToday.length, overdue: overdue.length } };
  }

  /**
   * The `lead_followup_sweep` automation job body. For every due
   * lead it notifies the lead's owner (when that user is still an
   * ACTIVE member of the org); unassigned leads and leads whose
   * owner left/was suspended fall back to the org's ACTIVE
   * OWNER/ADMIN members.
   *
   * Dedupe: at most one reminder per lead per Dhaka day. The
   * marker is a LeadActivity of type "followup_reminded" — visible
   * in the lead's own timeline (auditable) and checked against
   * today's Dhaka day-start before notifying, so re-runs (manual
   * run-now, scheduler + worker double-dispatch) are no-ops.
   * The marker is written only AFTER the notifications succeed,
   * so a partial failure retries cleanly on the next run.
   */
  async sweepFollowUpReminders(organizationId: string, now = new Date()) {
    const candidates = await this.dueFollowUpLeads(organizationId, now);
    if (!candidates.length) return { candidates: 0, notified: 0, notifications: 0, deduped: 0, noRecipient: 0 };
    const startToday = dhakaDayStartUtc(now);
    const ids = candidates.map((l) => l.id);
    const markers = await (this.prisma as any).leadActivity.findMany({
      where: { leadId: { in: ids }, type: "followup_reminded", createdAt: { gte: startToday } }, take: 1000,
    }).catch(() => []);
    const reminded = new Set((markers as any[]).map((m) => m.leadId));

    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId, status: "ACTIVE" }, take: 200,
    }).catch(() => []);
    const activeIds = new Set((memberships as any[]).map((m) => m.userId as string));
    const adminIds = [...new Set((memberships as any[])
      .filter((m) => ["OWNER", "ADMIN"].includes(m.role))
      .map((m) => m.userId as string))];

    let notified = 0, notifications = 0, deduped = 0, noRecipient = 0;
    for (const lead of candidates) {
      if (reminded.has(lead.id)) { deduped++; continue; }
      const recipients = lead.ownerUserId && activeIds.has(lead.ownerUserId) ? [lead.ownerUserId] : adminIds;
      if (!recipients.length) { noRecipient++; continue; }
      const due = classifyDue(lead.nextFollowUpAt, now);
      if (!due) continue;
      const { title, body } = followUpNotificationText(lead, due);
      for (const userId of recipients) {
        await createAgentNotification(this.prisma as any, { organizationId, userId, type: "lead_followup", title, body, conversationId: null });
        notifications++;
      }
      await this.log(lead.id, null, "followup_reminded",
        `সিস্টেম: ফলোআপ রিমাইন্ডার পাঠানো হয়েছে (${dhakaDayKey(now)}, ${due.label}, প্রাপক ${recipients.length} জন)।`);
      notified++;
    }
    return { candidates: candidates.length, notified, notifications, deduped, noRecipient };
  }

  // ---------- CRM C3: CSV import / export ----------

  /**
   * Bulk lead import (parser: parseLeadsCsv in imports/csv.ts, the
   * same Papa + header-alias dialect as products/orders). Every
   * created row goes through this.create() — identical validation,
   * LeadActivity "created" row, owner = the importing user and
   * lead.created event as a manual create.
   *
   * DEDUPE (skip, never overwrite): a row whose phone key (digits
   * only, last 10; see leadPhoneKey) matches an existing NON-MERGED
   * lead of the SAME org is skipped and reported with that lead's
   * id. Rows created earlier in the same file join the key set, so
   * a phone repeated inside one file also skips. Rows without a
   * usable phone key are never deduped. One audit entry per batch
   * (action "leads_import" with the counts), plus an ImportJob row
   * (kind "leads") like the other importers.
   */
  async importLeadsCsv(organizationId: string, actorId: string, dto: { csvText: string; fileName?: string }) {
    const { rows, errors, totalRows } = parseLeadsCsv(dto.csvText);
    if (totalRows > LEAD_IMPORT_ROW_CAP) {
      throw badRequest("crm.atMostRowsCanBeImported", { LEAD_IMPORT_ROW_CAP: LEAD_IMPORT_ROW_CAP, totalRows: totalRows });
    }
    const job = await (this.prisma as any).importJob.create({
      data: { organizationId, kind: "leads", status: "PENDING", fileName: dto.fileName ?? null, createdById: actorId },
    });
    const existing = await (this.prisma as any).lead.findMany({
      where: { organizationId }, select: { id: true, phone: true, mergedIntoId: true }, take: 10000,
    }).catch(() => []);
    const byPhone = new Map<string, string>();
    for (const l of existing as any[]) {
      if (l.mergedIntoId) continue;
      const key = leadPhoneKey(l.phone);
      if (key && !byPhone.has(key)) byPhone.set(key, l.id);
    }
    const rowErrors = [...errors];
    const created: { row: number; leadId: string }[] = [];
    const skipped: { row: number; leadId: string; phone: string }[] = [];
    for (const row of rows) {
      const key = leadPhoneKey(row.phone);
      if (key && byPhone.has(key)) {
        skipped.push({ row: row.rowNumber, leadId: byPhone.get(key)!, phone: row.phone! });
        continue;
      }
      try {
        const lead = await this.create(organizationId, actorId, {
          name: row.name, phone: row.phone, email: row.email, source: row.source, stage: row.stage,
          tags: row.tags, value: row.value, notes: row.notes, nextFollowUpAt: row.nextFollowUpAt,
          // CRM C4: imported rows carry no custom values, so a
          // required def must not fail every row of a bulk import.
          // The lead simply has no value for the field until edited.
        }, { skipRequiredCustomFields: true });
        created.push({ row: row.rowNumber, leadId: lead.id });
        if (key) byPhone.set(key, lead.id);
      } catch (e) {
        rowErrors.push({ row: row.rowNumber, message: e instanceof Error ? e.message : "Failed to save row" });
      }
    }
    const updated = await (this.prisma as any).importJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED", totalRows, successRows: created.length,
        failedRows: rowErrors.length, skippedRows: skipped.length,
        errors: rowErrors.slice(0, 200), completedAt: new Date(),
      },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "leads_import",
      entityType: "ImportJob", entityId: job.id,
      metadata: { totalRows, created: created.length, skipped: skipped.length, failed: rowErrors.length, fileName: dto.fileName ?? null },
    });
    return { ...updated, details: { created, skipped } };
  }

  /**
   * CSV export of the org's non-merged leads (newest first, capped
   * at 5000 rows). `value` is written back in taka (major units) so
   * an export can be re-imported as-is. CRM C4 appends the org's
   * custom-field columns after the core columns (see the marked
   * section below).
   */
  async exportCsv(organizationId: string): Promise<string> {
    const leads = await (this.prisma as any).lead.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: 5000,
    });
    const visible = (leads as any[]).filter((l) => !l.mergedIntoId);
    const headers = ["id", "name", "phone", "email", "source", "stage", "tags", "value", "currency", "next_follow_up_at", "notes", "created_at"];
    const rows = visible.map((l) => [
      l.id, l.name, l.phone ?? "", l.email ?? "", l.source, l.stage,
      (l.tags ?? []).join("|"),
      l.valueMinor != null ? minorToMajor(BigInt(l.valueMinor)) : "",
      l.currency,
      l.nextFollowUpAt ? new Date(l.nextFollowUpAt).toISOString() : "",
      l.notes ?? "",
      l.createdAt ? new Date(l.createdAt).toISOString() : "",
    ]);
    // CRM C4: the org's non-archived lead custom fields are
    // appended as extra columns, headered by LABEL, in def order.
    if (this.customFields) {
      const defs = await this.customFields.activeDefs(organizationId, "lead");
      if (defs.length) {
        headers.push(...defs.map((d: any) => d.label));
        rows.forEach((row, i) => {
          const cf = (visible[i] as any).customFields ?? {};
          for (const d of defs as any[]) row.push(renderCustomFieldValue(cf[d.key]));
        });
      }
    }
    return toCsv(headers, rows);
  }

  /** Groups of unmerged leads sharing a phone number (last 10 digits). */
  async duplicates(organizationId: string) {
    const all = await (this.prisma as any).lead.findMany({ where: { organizationId }, take: 500 });
    const groups = new Map<string, any[]>();
    for (const lead of all) {
      if (lead.mergedIntoId || !lead.phone) continue;
      const key = String(lead.phone).replace(/\D/g, "").slice(-10);
      if (key.length < 6) continue;
      const list = groups.get(key) ?? [];
      list.push(lead);
      groups.set(key, list);
    }
    return [...groups.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([key, list]) => ({
        phoneKey: key,
        leads: list.map((l: any) => ({ id: l.id, name: l.name, phone: l.phone, stage: l.stage, source: l.source, createdAt: l.createdAt })),
      }));
  }

  /**
   * Merge a duplicate lead INTO the target lead: activities and
   * conversations move, tags union, the source is marked merged (never
   * deleted - its history stays auditable through the target).
   */
  async merge(organizationId: string, actorId: string, targetId: string, sourceId: string) {
    if (targetId === sourceId) throw badRequest("crm.cannotMergeALeadIntoItself");
    const target = await this.getOrThrow(organizationId, targetId);
    const source = await this.getOrThrow(organizationId, sourceId);
    if (source.mergedIntoId) throw badRequest("crm.sourceLeadIsAlreadyMerged");
    if (target.mergedIntoId) throw badRequest("crm.targetLeadIsItselfMergedInto");

    const activities = await (this.prisma as any).leadActivity.findMany({ where: { leadId: sourceId }, take: 500 });
    for (const a of activities) {
      await (this.prisma as any).leadActivity.update({ where: { id: a.id }, data: { leadId: targetId } });
    }
    const convs = await (this.prisma as any).channelConversation.findMany({ where: { leadId: sourceId }, take: 200 });
    for (const c of convs) {
      await (this.prisma as any).channelConversation.update({ where: { id: c.id }, data: { leadId: targetId } });
    }
    const mergedTags = normalizeTags([...(target.tags ?? []), ...(source.tags ?? [])]);
    // CRM C4: custom fields follow the same merge discipline —
    // the survivor keeps its own values, gaps fill from the source.
    let customFieldsFill: Record<string, unknown> | undefined;
    if (this.customFields) {
      const filled = this.customFields.fillGaps(target.customFields ?? null, source.customFields ?? null);
      if (Object.keys(filled).length || target.customFields) customFieldsFill = filled;
    }
    await (this.prisma as any).lead.update({
      where: { id: targetId },
      data: { tags: mergedTags, ...(customFieldsFill !== undefined ? { customFields: customFieldsFill } : {}) },
    });
    await (this.prisma as any).lead.update({ where: { id: sourceId }, data: { mergedIntoId: targetId } });
    await this.log(targetId, actorId, "merged", `Duplicate lead "${source.name}" (${sourceId}) merged into this lead: ${activities.length} activities, ${convs.length} conversations moved.`);
    // The merge is recorded as a lead activity above (this service has
    // no audit dependency; the activity + mergedIntoId are the record).
    return this.getOne(organizationId, targetId);
  }

  private async getOrThrow(organizationId: string, leadId: string) {
    const lead = await (this.prisma as any).lead.findFirst({ where: { id: leadId, organizationId } });
    if (!lead) throw notFound("crm.leadNotFoundInThisOrganization");
    return lead;
  }

  async getOne(organizationId: string, leadId: string) {
    const lead = await this.getOrThrow(organizationId, leadId);
    const activities = await (this.prisma as any).leadActivity.findMany({
      where: { leadId }, orderBy: { createdAt: "desc" }, take: 50,
    });
    // CRM C2: detail carries the same compute-on-read score (its own
    // uncapped activity query inside scoresFor, not the display page).
    const scores = await this.scoresFor(organizationId, [lead]);
    return { ...this.toPublic(lead), activities, score: scores.get(lead.id) ?? null };
  }

  async update(organizationId: string, actorId: string, leadId: string, dto: {
    name?: string; phone?: string; email?: string; stage?: string; value?: string | null;
    notes?: string; ownerUserId?: string | null; nextFollowUpAt?: string | null; tags?: string[];
    // CRM C4: partial custom-field write (null = clear all values).
    customFields?: Record<string, unknown> | null;
  }) {
    const lead = await this.getOrThrow(organizationId, leadId);
    if (dto.stage && !(LEAD_STAGES as readonly string[]).includes(dto.stage)) throw badRequest("crm.invalidStage");
    const data: Record<string, unknown> = {};
    if (dto.customFields !== undefined) {
      if (dto.customFields === null) data.customFields = null;
      else if (this.customFields) {
        const sanitized = await this.customFields.validateAndSanitize(organizationId, "lead", dto.customFields, { forCreate: false });
        data.customFields = this.customFields.mergeValues(lead.customFields ?? null, sanitized);
      } else if (Object.keys(dto.customFields).length) {
        throw badRequest("crm.customFieldsAreNotAvailableIn");
      }
    }
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email?.toLowerCase();
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.ownerUserId !== undefined) data.ownerUserId = dto.ownerUserId;
    if (dto.value !== undefined) data.valueMinor = dto.value === null ? null : parseMoneyToMinor(dto.value);
    if (dto.tags !== undefined) data.tags = normalizeTags(dto.tags);
    const fromStage = lead.stage;
    const stageChanged = dto.stage && dto.stage !== fromStage;
    if (dto.stage) { data.stage = dto.stage; data.lastContactedAt = new Date(); }
    if (dto.nextFollowUpAt !== undefined) data.nextFollowUpAt = dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null;
    // CX10: a stage change WITHOUT an explicit nextFollowUpAt in
    // the same update re-stamps from the NEW stage's default, when
    // one exists. No default → data.nextFollowUpAt stays unset, so
    // the existing value is kept verbatim — including on won/lost
    // (a stage change never silently clears a follow-up).
    if (stageChanged && dto.nextFollowUpAt === undefined) {
      const stamped = followUpDateFor(await this.followUpSetting(organizationId), dto.stage!, new Date());
      if (stamped) data.nextFollowUpAt = stamped;
    }
    const updated = await (this.prisma as any).lead.update({ where: { id: leadId }, data });
    if (stageChanged) {
      await this.log(leadId, actorId, "stage_change", `Stage: ${fromStage} -> ${dto.stage}`);
      this.events?.emit("lead.stage_changed", {
        organizationId,
        context: { leadId, name: updated.name, email: updated.email, phone: updated.phone, stage: dto.stage, previousStage: fromStage },
      });
    }
    return this.toPublic(updated);
  }

  async addNote(organizationId: string, actorId: string, leadId: string, content: string) {
    await this.getOrThrow(organizationId, leadId);
    await this.log(leadId, actorId, "note", content.slice(0, 2000));
    await (this.prisma as any).lead.update({ where: { id: leadId }, data: { lastContactedAt: new Date() } });
    return this.getOne(organizationId, leadId);
  }

  async pipeline(organizationId: string) {
    const leads = await (this.prisma as any).lead.findMany({ where: { organizationId }, select: { stage: true, valueMinor: true } });
    const byStage: Record<string, { count: number; valueMinor: string }> = {};
    for (const stage of LEAD_STAGES) byStage[stage] = { count: 0, valueMinor: "0" };
    let totalValue = 0n;
    for (const lead of leads) {
      const bucket = byStage[lead.stage] ?? (byStage[lead.stage] = { count: 0, valueMinor: "0" });
      bucket.count++;
      const value = lead.valueMinor != null ? BigInt(lead.valueMinor) : 0n;
      bucket.valueMinor = String(BigInt(bucket.valueMinor) + value);
      if (lead.stage !== "lost") totalValue += value;
    }
    return { byStage, totalLeads: leads.length, openPipelineValueMinor: String(totalValue) };
  }

  // ---------- CRM C6: lead funnel report ----------

  /**
   * Source-by-source funnel over the leads CREATED in the last
   * `days` Asia/Dhaka calendar days (today included): the window
   * is [start of (today − days + 1), start of tomorrow) in Dhaka
   * day bounds — the same solver as the C1 follow-up board.
   *
   * Definitions (also printed on the Leads page and in
   * docs/crm-c6-acceptance.md):
   *  - every figure is computed from real Lead rows of THIS org;
   *  - merged leads (mergedIntoId NOT NULL) are EXCLUDED
   *    everywhere — their history lives on the surviving lead,
   *    so counting them would double-count;
   *  - won = stage "won" among the window's leads; wonRate =
   *    won / created, and conversionRate = converted / created,
   *    where converted = customerId NOT NULL;
   *  - a rate is null when created = 0 (an empty source has no
   *    rate — never a fabricated 0);
   *  - wonValueMinor sums valueMinor over the WON leads only
   *    (BigInt, serialized as a string like everywhere else).
   * Sources: the known vocabulary first (fixed order), then any
   * other source strings present in the data, alphabetically.
   */
  async funnel(organizationId: string, daysInput?: number | string | null, now = new Date()) {
    const days = daysInput === undefined || daysInput === null || daysInput === "" ? 30 : Number(daysInput);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw badRequest("crm.daysMustBeAnIntegerBetween");
    }
    const end = new Date(dhakaDayStartUtc(now).getTime() + 86400000);
    const start = new Date(end.getTime() - days * 86400000);
    const rows = await (this.prisma as any).lead.findMany({
      where: { organizationId, mergedIntoId: null, createdAt: { gte: start, lt: end } },
      take: 20000,
    });
    interface Bucket { source: string; created: number; byStage: Record<string, number>; won: number; converted: number; wonValue: bigint }
    const blank = (source: string): Bucket => ({
      source, created: 0,
      byStage: Object.fromEntries(LEAD_STAGES.map((s) => [s, 0])),
      won: 0, converted: 0, wonValue: 0n,
    });
    const buckets = new Map<string, Bucket>();
    for (const s of FUNNEL_SOURCES) buckets.set(s, blank(s));
    const totals = blank("total");
    const add = (b: Bucket, lead: any) => {
      b.created++;
      if (b.byStage[lead.stage] !== undefined) b.byStage[lead.stage]++;
      if (lead.stage === "won") {
        b.won++;
        if (lead.valueMinor != null) b.wonValue += BigInt(lead.valueMinor);
      }
      if (lead.customerId) b.converted++;
    };
    for (const lead of rows as any[]) {
      let b = buckets.get(lead.source);
      if (!b) { b = blank(lead.source); buckets.set(lead.source, b); }
      add(b, lead);
      add(totals, lead);
    }
    const finalize = (b: Bucket) => ({
      source: b.source, created: b.created, byStage: b.byStage, won: b.won,
      wonRate: b.created ? Math.round((b.won / b.created) * 10000) / 10000 : null,
      converted: b.converted,
      conversionRate: b.created ? Math.round((b.converted / b.created) * 10000) / 10000 : null,
      wonValueMinor: String(b.wonValue),
    });
    const known = FUNNEL_SOURCES.map((s) => buckets.get(s)!);
    const extras = [...buckets.values()]
      .filter((b) => !(FUNNEL_SOURCES as readonly string[]).includes(b.source))
      .sort((a, b) => a.source.localeCompare(b.source));
    return {
      days, windowStart: start.toISOString(), windowEnd: end.toISOString(),
      sources: [...known, ...extras].map(finalize),
      totals: finalize(totals),
    };
  }

  async convertToCustomer(organizationId: string, actorId: string, leadId: string) {
    const lead = await this.getOrThrow(organizationId, leadId);
    if (lead.customerId) {
      const existing = await (this.prisma as any).customer.findUnique({ where: { id: lead.customerId } });
      return { lead: this.toPublic(lead), customer: existing, alreadyConverted: true };
    }
    let customer = null;
    if (lead.email) customer = await (this.prisma as any).customer.findFirst({ where: { organizationId, email: lead.email } });
    if (!customer && lead.phone) customer = await (this.prisma as any).customer.findFirst({ where: { organizationId, phone: lead.phone } });
    if (!customer) {
      const [firstName, ...rest] = String(lead.name).trim().split(/\s+/);
      customer = await (this.prisma as any).customer.create({
        data: { organizationId, source: "lead", firstName, lastName: rest.join(" ") || null, email: lead.email ?? null, phone: lead.phone ?? null },
      });
    }
    const updated = await (this.prisma as any).lead.update({ where: { id: leadId }, data: { customerId: customer.id } });
    await this.log(leadId, actorId, "converted", `Converted to customer ${customer.id}`);
    return { lead: this.toPublic(updated), customer, alreadyConverted: false };
  }

  async delete(organizationId: string, leadId: string) {
    await this.getOrThrow(organizationId, leadId);
    await (this.prisma as any).lead.delete({ where: { id: leadId } });
    return { deleted: true };
  }
}
