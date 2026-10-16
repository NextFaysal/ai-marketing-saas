import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { isMemberConnectionDenied } from "../common/permission-catalog";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { LlmFactory, providerForOrg } from "../ai/llm/llm.factory";
import { estimateTokens } from "../ai/llm/llm.types";
import { formatMinor } from "@repo/contracts";
import { SEND_TIME_MIN_EVENTS, segmentSuggestionsFromCounts, summarizeSendTimeEvents } from "./messaging-ai";
import { AuditService } from "../audit/audit.service";
import { EmailProvider } from "./email.provider";
import { MetaMessagingClient } from "../inbox/meta-messaging.client";
import { decryptJson } from "../integrations/crypto";
import { SmsProvider, normalizeBdPhone, normalizePhoneGeneric } from "./sms.provider";
import { renderTemplate } from "./render";
import { issueUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";
import {
  AudienceDefinitionError, AudienceDefinition, AudienceFacts,
  validateAudienceDefinition, matchesAudienceDefinition, parseAddressList,
} from "./audience-rules";
import { computeOrderAggregates, computeRfm, computeLastOrders } from "./rfm";
import { TEMPLATE_VARIABLES } from "./variables";
import { rewriteBroadcastLinks, verifyLinkToken, apiPublicUrl } from "./link-tracking";
import { issueOpenToken, verifyOpenToken } from "./open-token";
import { deliveryRecipientKey, groupFailureReasons, abSuggestion } from "./delivery-report";
import { parseRecurrence, nextOccurrence, Recurrence, RecurrenceValidationError } from "./recurrence";
import { JOURNEY_PRESETS } from "./journey-presets";
import { composeCheck } from "./compose-check";
import { productSnippetText, productSnippetHtml } from "./composer-blocks";
import { smsSegments } from "./sms-segments";
import {
  TenantSmtpConfig, TenantSmsConfig,
  tenantSmtpFromRow, tenantSmsFromRow, senderConfigSafeView,
} from "./sender-config";
import { effectiveSmtpConfig, seal } from "../common/platform-config";
import { resolveTxt } from "node:dns/promises";

/** MS3: rows read per cursor step on every audience base scan —
 * no audience path issues one unbounded findMany anymore. */
export const AUDIENCE_SCAN_CHUNK = 500;
/** MS3: a csv audience may hold at most this many addresses
 * (aligned with the highest per-send plan cap). */
export const CSV_AUDIENCE_CAP = 5000;

/** MS9: the ONE AI usage feature for both messaging draft
 * endpoints (copy drafts + subject variants share the daily
 * cap and the accounting — stated in the B5 acceptance). */
export const MESSAGING_AI_FEATURE = "messaging_copy";

/** MS1: recipients processed per chunk; the row is re-read between
 * chunks so a pause/cancel lands within one chunk of being set. */
export const BROADCAST_CHUNK_SIZE = 50;
/** MS1: entries a single sweep run processes per broadcast. */
export const BROADCAST_SWEEP_MAX_ENTRIES = 200;
/** MS1: a "sending" row untouched for this long is treated as
 * interrupted (crashed request/process) and recovered by the sweep. */
export const BROADCAST_STALE_MS = 10 * 60 * 1000;

/** MS1: one materialized recipient in Broadcast.recipientSnapshot.
 * MS3: a "csv" entry's id is the normalized address itself (the
 * A/B split key is type:address for csv, per the builder design);
 * its MessageDelivery rows record recipientId null (see
 * recordDelivery) because there is no org entity behind it. */
export interface SnapshotEntry {
  type: "customer" | "lead" | "csv" | "test";
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: "pending" | "sent" | "failed" | "skipped";
  attempts: number;
  error?: string;
  providerMessageId?: string;
  address?: string;
  /** MS5: real per-recipient personalization vars, built at
   * prepare time from actual customer/lead/order rows (see
   * buildSnapshotVars + messaging/variables.ts). Entries stamped
   * before MS5 have no vars — processBroadcast reads them
   * defensively as {}. */
  vars?: Record<string, unknown>;
}

/**
 * MS2 — the ONE address normalization for the preference store:
 * email → trimmed lowercase; phone channels → the gateway form
 * (normalizeBdPhone) when the number parses as BD, else digits
 * only. Send paths and preference writes both go through this, so
 * a stored opt-out always compares equal to a send-time lookup.
 */
export function normalizePrefAddress(channel: string, raw: string): string {
  const value = String(raw ?? "").trim();
  if (channel === "email") return value.toLowerCase();
  return normalizeBdPhone(value) ?? value.replace(/\D/g, "");
}

/** The address a recipient is reached at on `channel`, normalized
 * the preference-store way ("" when the recipient has none). */
export function recipientPrefAddress(channel: string, recipient: Recipient): string {
  const raw = channel === "email" ? recipient.email : recipient.phone;
  return raw ? normalizePrefAddress(channel, raw) : "";
}

/** Tenant web base for customer-facing links (WEB_URL precedent:
 * courier/tracking-token.ts). */
export function webBaseUrl(): string {
  return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export interface Recipient { type: "customer" | "lead" | "csv" | "test"; id: string | null; name: string; email?: string | null; phone?: string | null }

/**
 * CX10 — preview address masking. A preview sample must never
 * carry a full address: email → first char + "***@" + domain;
 * phone → first 3 chars + "***" + last 2 chars (017***89 style).
 * Pure + exported so the spec can pin the exact shapes.
 */
export function maskEmailAddress(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`;
}

export function maskPhoneAddress(phone: string): string {
  if (phone.length <= 5) return "***";
  return `${phone.slice(0, 3)}***${phone.slice(-2)}`;
}

/** The masked address a recipient would be reached at on `channel`
 * (email channel → email; sms/whatsapp → phone). */
export function maskRecipientAddress(channel: string, recipient: Recipient): string {
  if (channel === "email") return recipient.email ? maskEmailAddress(recipient.email) : "";
  return recipient.phone ? maskPhoneAddress(recipient.phone) : "";
}

export interface BroadcastResolution {
  recipients: Recipient[];
  /** Audience size BEFORE any exclusion. */
  audienceTotal: number;
  /** How many the previous-recipient exclusion dropped (0 when the flag is off). */
  excludedPreviousCount: number;
  /** MS2: dropped for an opted_out MessagePreference on this channel. */
  excludedSuppressedCount: number;
  /** MS2: dropped by the per-recipient frequency cap (rolling 24h). */
  excludedFrequencyCount: number;
  /** MS2: dropped because WhatsApp opt-in is required and absent. */
  excludedNoOptInCount: number;
  /** MS3: csv-audience entries that failed channel validation
   * (counted, never silently dropped). 0 for other audience types. */
  invalidCount: number;
}

/** MS3: the extra audience inputs the new audience types carry
 * (inline definition / saved id / raw csv list). */
export interface AudienceExtras {
  audienceDefinition?: unknown;
  audienceSavedId?: string;
  audienceCsv?: unknown;
}

/** MS4: gateway display names for the per-org provider status. */
export const SMS_GATEWAY_LABELS: Record<string, string> = {
  sslwireless: "SSL Wireless (BD)",
  bulksmsbd: "BulkSMS BD",
  alphasms: "Alpha SMS (sms.net.bd)",
};

/**
 * MS8 — the workflow-engine port the journey-preset installer
 * needs. The dependency between the modules runs ONE way
 * (WorkflowsModule imports MessagingModule; WorkflowsService
 * already injects MessagingService), and there is no forwardRef
 * anywhere in this codebase — so instead of messaging importing
 * workflows, WorkflowsService REGISTERS itself here on module
 * init (registerWorkflowCreator below). The port's create path
 * is the REAL WorkflowsService.create, validator included.
 */
export interface WorkflowCreatorPort {
  create(organizationId: string, actorId: string, dto: { name: string; trigger: string; conditions?: unknown; steps: any[] }): Promise<any>;
  update(organizationId: string, workflowId: string, dto: { enabled?: boolean }, actorId?: string): Promise<any>;
}

@Injectable()
export class MessagingService {
  /** MS9: the LLM factory, used ONLY by the messaging AI draft
   * endpoints. Optional constructor arg: AiModule imports
   * MessagingModule (never the reverse — no module cycle), so
   * MessagingModule provides its OWN LlmFactory instance; the
   * class is dependency-free and reads the same effective
   * platform config, so the two instances behave identically.
   * Specs that construct the service with the historical 4 args
   * get a real factory instance (never called on non-AI paths);
   * MS9 specs inject a fake factory as the 5th arg. */
  private readonly llm: LlmFactory;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailProvider,
    private readonly sms: SmsProvider,
    @Optional() llm?: LlmFactory,
  ) {
    this.llm = llm ?? new LlmFactory();
  }

  /** MS8: the registered workflow engine (see the port above).
   * Null in a deployment/test that never boots WorkflowsModule —
   * the preset installer then refuses honestly. */
  private workflowCreator: WorkflowCreatorPort | null = null;

  registerWorkflowCreator(creator: WorkflowCreatorPort) {
    this.workflowCreator = creator;
  }

  /** MS4 seam (social-import precedent): specs substitute this so
   * domain-health never touches live DNS. */
  txtResolver: (name: string) => Promise<string[][]> = async (name: string) => resolveTxt(name);

  /**
   * MS4 — per-org provider status: for THIS org, which path a
   * send would take (tenant config → platform fallback → none).
   * `configured` keeps its pre-MS4 meaning ("a send can happen"),
   * now evaluated for the requesting org. Without an orgId only
   * the platform view is returned (back-compat shape + fields).
   */
  async providerStatus(organizationId?: string) {
    const platformEmail = this.email.isConfigured();
    const platformSms = this.sms.isConfigured();
    let tenantSmtp: TenantSmtpConfig | null = null;
    let tenantSms: TenantSmsConfig | null = null;
    if (organizationId) {
      const row = await this.getSenderConfigRow(organizationId);
      tenantSmtp = tenantSmtpFromRow(row);
      tenantSms = tenantSmsFromRow(row);
    }
    const emailPath = tenantSmtp ? "tenant" : platformEmail ? "platform" : "none";
    const smsGateway = tenantSms ? tenantSms.gateway : platformSms ? "sslwireless" : null;
    const smsPath = tenantSms ? "tenant" : platformSms ? "platform" : "none";
    return {
      email: {
        configured: emailPath !== "none", transport: "SMTP", path: emailPath,
        tenantConfigured: Boolean(tenantSmtp), platformConfigured: platformEmail,
      },
      sms: {
        configured: smsPath !== "none",
        provider: smsGateway ? SMS_GATEWAY_LABELS[smsGateway] : "কোনো SMS Gateway নেই",
        gateway: smsGateway, path: smsPath,
        tenantConfigured: Boolean(tenantSms), platformConfigured: platformSms,
      },
    };
  }

  // ---------- Templates ----------
  async createTemplate(organizationId: string, actorId: string, dto: { name: string; channel: string; subject?: string; body: string; htmlBody?: string | null }) {
    if (!["email", "sms"].includes(dto.channel)) throw new BadRequestException("channel must be email or sms");
    if (dto.channel === "email" && !dto.subject) throw new BadRequestException("Email templates need a subject");
    // MS5: HTML is an email-only part — on sms it is REJECTED with
    // an honest 400, never silently stored or ignored.
    if (dto.htmlBody && dto.channel !== "email") throw new BadRequestException("htmlBody is only allowed for email templates (SMS has no HTML part)");
    const template = await (this.prisma as any).messageTemplate.create({
      data: { organizationId, name: dto.name, channel: dto.channel, subject: dto.subject ?? null, body: dto.body, htmlBody: dto.htmlBody ?? null, createdById: actorId },
    });
    return template;
  }

  /** MS5: the personalization variables per audience entity —
   * the API-side source of truth (messaging/variables.ts). */
  getTemplateVariables() {
    return TEMPLATE_VARIABLES;
  }

  /** MS5: advisory compose warnings (pure compose-check module;
   * never blocks a send). */
  checkCompose(dto: { channel: string; subject?: string; body: string }) {
    if (!["email", "sms", "whatsapp"].includes(dto.channel)) throw new BadRequestException("channel must be email, sms or whatsapp");
    return { warnings: composeCheck(dto) };
  }

  /**
   * MS5 — products for the composer picker, from REAL Product
   * rows of this org. A product's public URL exists only when it
   * has a slug: Product.slug is the PER-PRODUCT checkout slug —
   * GET /public/checkout/:slug resolves ONE product by slug
   * (ProductsService.getPublicProductBySlug) and the dashboard
   * products page builds the same `${origin}/checkout/${slug}`
   * link per product. So the snippet URL is
   * `${WEB_URL}/checkout/${slug}` when a slug exists and null
   * when it does not — no URL pattern is fabricated for
   * slug-less products (their snippet is name + price only).
   */
  async listComposerProducts(organizationId: string) {
    const rows: any[] = await (this.prisma as any).product.findMany({
      where: { organizationId, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 100,
    });
    return rows.map((p: any) => {
      const url = p.slug ? `${webBaseUrl()}/checkout/${p.slug}` : null;
      const snippetInput = { name: p.name, priceMinor: p.priceMinor, currency: p.currency ?? "BDT", url };
      return {
        id: p.id, name: p.name, priceMinor: String(p.priceMinor), currency: p.currency ?? "BDT",
        imageUrl: p.imageUrl ?? null, url,
        snippetText: productSnippetText(snippetInput),
        snippetHtml: productSnippetHtml(snippetInput),
      };
    });
  }

  async listTemplates(organizationId: string, channel?: string) {
    return (this.prisma as any).messageTemplate.findMany({
      where: { organizationId, ...(channel ? { channel } : {}) }, orderBy: { createdAt: "desc" },
    });
  }

  async getTemplate(organizationId: string, templateId: string) {
    const template = await (this.prisma as any).messageTemplate.findFirst({ where: { id: templateId, organizationId } });
    if (!template) throw new NotFoundException("Template not found");
    return template;
  }

  async updateTemplate(organizationId: string, templateId: string, dto: { name?: string; subject?: string; body?: string; htmlBody?: string | null }) {
    const existing = await this.getTemplate(organizationId, templateId);
    // MS5: the EXISTING template's channel decides — htmlBody on
    // a non-email template is an honest 400.
    if (dto.htmlBody !== undefined && existing.channel !== "email") {
      throw new BadRequestException("htmlBody is only allowed for email templates (SMS has no HTML part)");
    }
    return (this.prisma as any).messageTemplate.update({ where: { id: templateId }, data: { ...dto } });
  }

  async deleteTemplate(organizationId: string, templateId: string) {
    await this.getTemplate(organizationId, templateId);
    await (this.prisma as any).messageTemplate.delete({ where: { id: templateId } });
    return { deleted: true };
  }

  // ---------- Audience ----------

  /**
   * MS3 — cursor-chunked base scan (take AUDIENCE_SCAN_CHUNK,
   * cursor on id, id-ascending). No audience path issues one
   * unbounded findMany anymore; a scan always walks the full set.
   */
  private async scanChunked(model: any, where: any): Promise<any[]> {
    const rows: any[] = [];
    let cursor: string | undefined;
    for (;;) {
      const chunk = await model.findMany({
        where, orderBy: { id: "asc" }, take: AUDIENCE_SCAN_CHUNK,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const list = Array.isArray(chunk) ? chunk : [];
      rows.push(...list);
      if (list.length < AUDIENCE_SCAN_CHUNK) break;
      cursor = list[list.length - 1]?.id;
      if (!cursor) break;
    }
    return rows;
  }

  private static customerName(c: any): string {
    return [c.firstName, c.lastName].filter(Boolean).join(" ") || "Customer";
  }

  private static daysSince(value: unknown): number {
    const t = value ? new Date(value as any).getTime() : NaN;
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
  }

  /** MS3 — validate a builder definition, converting the pure
   * module's error into the API's 400 with the message verbatim. */
  private assertValidDefinition(raw: unknown): AudienceDefinition {
    try {
      return validateAudienceDefinition(raw);
    } catch (e) {
      if (e instanceof AudienceDefinitionError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  async resolveAudience(organizationId: string, channel: string, audienceType: string, audienceStage?: string, audienceSegment?: string, extras?: AudienceExtras): Promise<Recipient[]> {
    return (await this.resolveAudienceInternal(organizationId, channel, audienceType, audienceStage, audienceSegment, extras)).recipients;
  }

  private async resolveAudienceInternal(organizationId: string, channel: string, audienceType: string, audienceStage?: string, audienceSegment?: string, extras?: AudienceExtras): Promise<{ recipients: Recipient[]; invalidCount: number }> {
    const channelField = channel === "email" ? "email" : "phone";
    const hasAddress = (row: any) => (channelField === "email" ? row.email : row.phone);
    if (audienceType === "customers") {
      const rows = await this.scanChunked((this.prisma as any).customer, { organizationId });
      return {
        invalidCount: 0,
        recipients: rows
          .filter(hasAddress)
          .map((c: any) => ({ type: "customer" as const, id: c.id, name: MessagingService.customerName(c), email: c.email, phone: c.phone })),
      };
    }
    if (audienceType === "leads_stage") {
      if (!audienceStage) throw new BadRequestException("audienceStage is required for leads_stage audience");
      const rows = await this.scanChunked((this.prisma as any).lead, { organizationId, stage: audienceStage });
      return {
        invalidCount: 0,
        recipients: rows
          .filter(hasAddress)
          .map((l: any) => ({ type: "lead" as const, id: l.id, name: l.name, email: l.email, phone: l.phone })),
      };
    }
    if (audienceType === "segment") {
      if (!audienceSegment) throw new BadRequestException("audienceSegment is required for segment audience");
      const rows = await computeRfm(this.prisma as any, organizationId);
      return {
        invalidCount: 0,
        recipients: rows
          .filter((r) => r.segment === audienceSegment)
          .filter((r) => (channelField === "email" ? r.email : r.phone))
          .map((r) => ({ type: "customer" as const, id: r.customerId, name: r.name, email: r.email, phone: r.phone })),
      };
    }
    if (audienceType === "custom") {
      const def = this.assertValidDefinition(extras?.audienceDefinition);
      return { invalidCount: 0, recipients: await this.resolveCustomAudience(organizationId, channel, def) };
    }
    if (audienceType === "saved") {
      if (!extras?.audienceSavedId) throw new BadRequestException("audienceSavedId is required for saved audience");
      const saved = await (this.prisma as any).messagingSavedAudience?.findFirst({
        where: { id: extras.audienceSavedId, organizationId },
      }).catch(() => null);
      if (!saved) {
        // Deliberate (MS3): deleting a saved audience a DRAFT still
        // references is allowed — the draft then fails HERE,
        // honestly, instead of silently widening to something else.
        throw new BadRequestException("Saved audience no longer exists — it may have been deleted. Choose another audience.");
      }
      const def = this.assertValidDefinition(saved.definition);
      return { invalidCount: 0, recipients: await this.resolveCustomAudience(organizationId, channel, def) };
    }
    if (audienceType === "csv") {
      return this.resolveCsvAudience(organizationId, channel, extras?.audienceCsv);
    }
    throw new BadRequestException("audienceType must be customers, leads_stage, segment, custom, saved or csv");
  }

  /**
   * MS3 — a validated builder definition over customers or leads.
   * Order facts come from the DATABASE aggregates
   * (computeOrderAggregates — the RFM partition approach); RFM
   * segments come from computeRfm itself, computed ONLY when a
   * condition actually needs them.
   */
  private async resolveCustomAudience(organizationId: string, channel: string, def: AudienceDefinition): Promise<Recipient[]> {
    const channelField = channel === "email" ? "email" : "phone";
    if (def.entity === "leads") {
      const rows = await this.scanChunked((this.prisma as any).lead, { organizationId });
      return rows
        .filter((l: any) => matchesAudienceDefinition(def, {
          source: l.source ?? null,
          createdDaysAgo: MessagingService.daysSince(l.createdAt),
          hasEmail: !!l.email, hasPhone: !!l.phone,
          customFields: l.customFields && typeof l.customFields === "object" ? l.customFields : null,
          stage: l.stage ?? null,
          tags: Array.isArray(l.tags) ? l.tags : [],
          valueMinor: l.valueMinor === null || l.valueMinor === undefined ? null : Number(l.valueMinor),
        }))
        .filter((l: any) => (channelField === "email" ? l.email : l.phone))
        .map((l: any) => ({ type: "lead" as const, id: l.id, name: l.name, email: l.email, phone: l.phone }));
    }
    const rows = await this.scanChunked((this.prisma as any).customer, { organizationId });
    const needsAggregates = def.conditions.some((c) => ["orders_count", "total_spent_minor", "last_order_days_ago"].includes(c.field));
    const needsRfm = def.conditions.some((c) => c.field === "rfm_segment");
    const aggregates = needsAggregates || needsRfm ? await computeOrderAggregates(this.prisma as any, organizationId) : null;
    let segmentByCustomer: Map<string, string> | null = null;
    if (needsRfm) {
      const rfmRows = await computeRfm(this.prisma as any, organizationId);
      segmentByCustomer = new Map(rfmRows.map((r) => [r.customerId, r.segment]));
    }
    const now = Date.now();
    return rows
      .filter((c: any) => {
        const agg = aggregates?.get(c.id);
        const facts: AudienceFacts = {
          source: c.source ?? null,
          createdDaysAgo: MessagingService.daysSince(c.createdAt),
          hasEmail: !!c.email, hasPhone: !!c.phone,
          customFields: c.customFields && typeof c.customFields === "object" ? c.customFields : null,
          ordersCount: agg?.frequency ?? 0,
          totalSpentMinor: agg ? Number(agg.monetary) : 0,
          lastOrderDaysAgo: agg ? Math.max(0, Math.floor((now - agg.last) / 86400000)) : null,
          rfmSegment: segmentByCustomer?.get(c.id) ?? null,
          address: c.address && typeof c.address === "object" && !Array.isArray(c.address) ? c.address : null,
        };
        return matchesAudienceDefinition(def, facts);
      })
      .filter((c: any) => (channelField === "email" ? c.email : c.phone))
      .map((c: any) => ({ type: "customer" as const, id: c.id, name: MessagingService.customerName(c), email: c.email, phone: c.phone }));
  }

  /**
   * MS3 — a pasted address list. Each valid address is matched to
   * an existing customer (first) or lead of THIS org to recover
   * the name + entity id; unmatched addresses stay sendable as
   * { type: "csv" } recipients keyed by their normalized address.
   * Invalid entries are COUNTED (invalidCount), never silently
   * dropped. Matching keys use the same normalization as the
   * preference store, so a csv recipient and an opt-out for the
   * same address always compare equal downstream.
   */
  private async resolveCsvAudience(organizationId: string, channel: string, rawCsv: unknown): Promise<{ recipients: Recipient[]; invalidCount: number }> {
    const addresses = parseAddressList(rawCsv);
    if (!addresses.length) throw new BadRequestException("audienceCsv has no addresses — paste at least one email address or phone number");
    if (addresses.length > CSV_AUDIENCE_CAP) {
      throw new BadRequestException(`CSV audience has ${addresses.length} addresses, over the cap of ${CSV_AUDIENCE_CAP}. Split the list instead of silently truncating it.`);
    }
    const valid: string[] = [];
    let invalidCount = 0;
    for (const a of addresses) {
      const ok = channel === "email"
        ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.trim().toLowerCase())
        : Boolean(normalizeBdPhone(a) ?? normalizePhoneGeneric(a));
      if (ok) valid.push(a); else invalidCount++;
    }
    const keyOf = (raw: string) => normalizePrefAddress(channel, raw);
    const customers = await this.scanChunked((this.prisma as any).customer, { organizationId });
    const leads = await this.scanChunked((this.prisma as any).lead, { organizationId });
    const customerByKey = new Map<string, any>();
    for (const c of customers) {
      const raw = channel === "email" ? c.email : c.phone;
      if (raw) { const k = keyOf(raw); if (!customerByKey.has(k)) customerByKey.set(k, c); }
    }
    const leadByKey = new Map<string, any>();
    for (const l of leads) {
      const raw = channel === "email" ? l.email : l.phone;
      if (raw) { const k = keyOf(raw); if (!leadByKey.has(k)) leadByKey.set(k, l); }
    }
    const recipients: Recipient[] = [];
    const seenRecipients = new Set<string>();
    for (const a of valid) {
      const key = keyOf(a);
      const customer = customerByKey.get(key);
      if (customer) {
        // The same person pasted in two forms (local + +880)
        // matches ONE customer — they are ONE recipient.
        if (seenRecipients.has(`customer:${customer.id}`)) continue;
        seenRecipients.add(`customer:${customer.id}`);
        recipients.push({ type: "customer", id: customer.id, name: MessagingService.customerName(customer), email: customer.email, phone: customer.phone });
        continue;
      }
      const lead = leadByKey.get(key);
      if (lead) {
        if (seenRecipients.has(`lead:${lead.id}`)) continue;
        seenRecipients.add(`lead:${lead.id}`);
        recipients.push({ type: "lead", id: lead.id, name: lead.name, email: lead.email, phone: lead.phone });
        continue;
      }
      recipients.push({
        type: "csv", id: key, name: a,
        email: channel === "email" ? a : null,
        phone: channel === "email" ? null : a,
      });
    }
    return { recipients, invalidCount };
  }

  // ---------- MS3: saved audiences ----------

  async createSavedAudience(organizationId: string, actorId: string, dto: { name: string; definition: unknown }) {
    const name = String(dto.name ?? "").trim();
    if (!name) throw new BadRequestException("A saved audience needs a name");
    const definition = this.assertValidDefinition(dto.definition);
    const row = await (this.prisma as any).messagingSavedAudience.create({
      data: { organizationId, name, definition, createdById: actorId },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.audience_create", entityType: "MessagingSavedAudience", entityId: row.id, metadata: { name, entity: definition.entity, conditions: definition.conditions.length } });
    return row;
  }

  async listSavedAudiences(organizationId: string) {
    return (this.prisma as any).messagingSavedAudience.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" },
    });
  }

  private async getSavedAudienceOrThrow(organizationId: string, audienceId: string) {
    const row = await (this.prisma as any).messagingSavedAudience.findFirst({ where: { id: audienceId, organizationId } });
    if (!row) throw new NotFoundException("Saved audience not found");
    return row;
  }

  async updateSavedAudience(organizationId: string, actorId: string, audienceId: string, dto: { name?: string; definition?: unknown }) {
    const existing = await this.getSavedAudienceOrThrow(organizationId, audienceId);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) throw new BadRequestException("A saved audience needs a name");
      data.name = name;
    }
    if (dto.definition !== undefined) data.definition = this.assertValidDefinition(dto.definition);
    const row = Object.keys(data).length
      ? await (this.prisma as any).messagingSavedAudience.update({ where: { id: existing.id }, data })
      : existing;
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.audience_update", entityType: "MessagingSavedAudience", entityId: audienceId, metadata: { fields: Object.keys(data) } });
    return row;
  }

  async deleteSavedAudience(organizationId: string, actorId: string, audienceId: string) {
    const existing = await this.getSavedAudienceOrThrow(organizationId, audienceId);
    await (this.prisma as any).messagingSavedAudience.delete({ where: { id: existing.id } });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.audience_delete", entityType: "MessagingSavedAudience", entityId: audienceId, metadata: { name: existing.name } });
    return { deleted: true };
  }

  // ---------- MS4: per-tenant senders & providers ----------

  /** Defensive read (B1 pattern): a missing table/model (pre-MS4
   * migration) or any read failure reads as "no tenant config". */
  private async getSenderConfigRow(organizationId: string): Promise<any | null> {
    try {
      return await (this.prisma as any).messagingSenderConfig?.findUnique({ where: { organizationId } }) ?? null;
    } catch {
      return null;
    }
  }

  private async resolveTenantSmtp(organizationId: string): Promise<TenantSmtpConfig | null> {
    return tenantSmtpFromRow(await this.getSenderConfigRow(organizationId));
  }

  private async resolveTenantSms(organizationId: string): Promise<TenantSmsConfig | null> {
    return tenantSmsFromRow(await this.getSenderConfigRow(organizationId));
  }

  /** The safe view only — secrets never leave the server. */
  async getSenderSettings(organizationId: string) {
    const row = await this.getSenderConfigRow(organizationId);
    return senderConfigSafeView(row, {
      emailConfigured: this.email.isConfigured(),
      smsConfigured: this.sms.isConfigured(),
    });
  }

  private async upsertSenderConfig(organizationId: string, data: Record<string, unknown>) {
    return (this.prisma as any).messagingSenderConfig.upsert({
      where: { organizationId },
      update: data,
      create: { organizationId, ...data },
    });
  }

  /**
   * MS4 — save the org's own SMTP. VERIFY BEFORE SAVE is the
   * discipline: a real nodemailer handshake runs against the
   * submitted (or merged) config FIRST; a failure throws 400 with
   * the SMTP server's error verbatim and NOTHING is persisted.
   * Omitting the password on an update keeps the stored one;
   * `clear: true` wipes the tenant email fields (platform
   * fallback resumes).
   */
  async updateTenantEmail(organizationId: string, actorId: string, dto: {
    smtpHost?: string; smtpPort?: number; smtpUser?: string; smtpPass?: string;
    fromAddress?: string; fromName?: string; dkimSelector?: string; clear?: boolean;
  }) {
    if (dto.clear) {
      const row = await this.upsertSenderConfig(organizationId, {
        smtpHost: null, smtpPort: null, smtpUser: null, smtpPassEncrypted: null,
        fromAddress: null, fromName: null, dkimSelector: null,
      });
      await this.audit.log({ organizationId, userId: actorId, action: "messaging.sender_email_clear", entityType: "MessagingSenderConfig", entityId: row.id });
      return senderConfigSafeView(row, { emailConfigured: this.email.isConfigured(), smsConfigured: this.sms.isConfigured() });
    }
    const existing = await this.getSenderConfigRow(organizationId);
    const candidate = tenantSmtpFromRow({
      smtpHost: dto.smtpHost ?? existing?.smtpHost ?? null,
      smtpPort: dto.smtpPort ?? existing?.smtpPort ?? null,
      smtpUser: dto.smtpUser ?? existing?.smtpUser ?? null,
      smtpPassEncrypted: dto.smtpPass ? seal(dto.smtpPass) : (existing?.smtpPassEncrypted ?? null),
      fromAddress: dto.fromAddress ?? existing?.fromAddress ?? null,
      fromName: dto.fromName ?? existing?.fromName ?? null,
    });
    if (!candidate) {
      throw new BadRequestException("Tenant SMTP needs at least a host and a From address (and a decryptable stored password, if one is set)");
    }
    try {
      if (typeof (this.email as any).verifyTenantSmtp !== "function") throw new Error("Tenant SMTP verification is unavailable");
      await this.email.verifyTenantSmtp(candidate);
    } catch (e: any) {
      throw new BadRequestException(`SMTP verification failed — nothing was saved: ${e?.message ?? String(e)}`);
    }
    const row = await this.upsertSenderConfig(organizationId, {
      smtpHost: candidate.host,
      smtpPort: candidate.port,
      smtpUser: candidate.user ?? null,
      smtpPassEncrypted: candidate.pass ? seal(candidate.pass) : null,
      fromAddress: candidate.from,
      fromName: candidate.fromName ?? null,
      dkimSelector: dto.dkimSelector !== undefined ? (dto.dkimSelector || null) : (existing?.dkimSelector ?? null),
    });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.sender_email_update", entityType: "MessagingSenderConfig", entityId: row.id, metadata: { host: candidate.host, from: candidate.from, passwordChanged: Boolean(dto.smtpPass) } });
    return senderConfigSafeView(row, { emailConfigured: this.email.isConfigured(), smsConfigured: this.sms.isConfigured() });
  }

  /**
   * MS4 — save the org's SMS gateway. No honest pre-save check
   * exists for these gateways (no documented verify/balance
   * endpoint we rely on), so the config is saved and the FIRST
   * real send is the proof — stated plainly in the response.
   * Omitting the API key keeps the stored one.
   */
  async updateTenantSms(organizationId: string, actorId: string, dto: {
    smsGateway?: string; smsApiKey?: string; smsSenderId?: string; smsApiUrl?: string; clear?: boolean;
  }) {
    if (dto.clear) {
      const row = await this.upsertSenderConfig(organizationId, {
        smsGateway: null, smsApiKeyEncrypted: null, smsSenderId: null, smsApiUrl: null,
      });
      await this.audit.log({ organizationId, userId: actorId, action: "messaging.sender_sms_clear", entityType: "MessagingSenderConfig", entityId: row.id });
      return { ...senderConfigSafeView(row, { emailConfigured: this.email.isConfigured(), smsConfigured: this.sms.isConfigured() }), note: "Tenant SMS configuration cleared; sends fall back to the platform gateway." };
    }
    const existing = await this.getSenderConfigRow(organizationId);
    const gateway = dto.smsGateway ?? existing?.smsGateway ?? null;
    if (!gateway || !["sslwireless", "bulksmsbd", "alphasms"].includes(gateway)) {
      throw new BadRequestException("smsGateway must be sslwireless, bulksmsbd or alphasms");
    }
    const senderId = dto.smsSenderId ?? existing?.smsSenderId ?? null;
    if (!senderId) throw new BadRequestException("An SMS sender ID is required");
    const apiKeyEncrypted = dto.smsApiKey ? seal(dto.smsApiKey) : (existing?.smsApiKeyEncrypted ?? null);
    if (!apiKeyEncrypted) throw new BadRequestException("An SMS API key is required");
    const row = await this.upsertSenderConfig(organizationId, {
      smsGateway: gateway,
      smsApiKeyEncrypted: apiKeyEncrypted,
      smsSenderId: senderId,
      smsApiUrl: dto.smsApiUrl !== undefined ? (dto.smsApiUrl || null) : (existing?.smsApiUrl ?? null),
    });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.sender_sms_update", entityType: "MessagingSenderConfig", entityId: row.id, metadata: { gateway, senderId, keyChanged: Boolean(dto.smsApiKey) } });
    return {
      ...senderConfigSafeView(row, { emailConfigured: this.email.isConfigured(), smsConfigured: this.sms.isConfigured() }),
      note: "Saved. SMS gateways offer no pre-save verification here — the first real send is the proof; a gateway rejection will surface verbatim on that send.",
    };
  }

  /** MS4 — the org's own per-unit rates for preview estimates. */
  async updateSenderRates(organizationId: string, actorId: string, dto: {
    smsCostPerPartMinor?: number | null; whatsappCostPerMessageMinor?: number | null; emailCostPerMessageMinor?: number | null;
  }) {
    const data: Record<string, unknown> = {};
    for (const key of ["smsCostPerPartMinor", "whatsappCostPerMessageMinor", "emailCostPerMessageMinor"] as const) {
      if (dto[key] !== undefined) {
        const v = dto[key];
        if (v !== null && (!Number.isInteger(v) || (v as number) < 0)) {
          throw new BadRequestException(`${key} must be a non-negative integer (minor units) or null`);
        }
        data[key] = v;
      }
    }
    const row = await this.upsertSenderConfig(organizationId, data);
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.sender_rates_update", entityType: "MessagingSenderConfig", entityId: row.id, metadata: data as any });
    return senderConfigSafeView(row, { emailConfigured: this.email.isConfigured(), smsConfigured: this.sms.isConfigured() });
  }

  /**
   * MS4 — a real test email to the given address through the SAME
   * resolution a broadcast would use (tenant SMTP first, platform
   * fallback), reporting which path carried it. Sent counts only
   * on a provider message id; errors surface verbatim.
   */
  async sendSenderTestEmail(organizationId: string, actorId: string, to: string) {
    const address = String(to ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new BadRequestException("A valid test recipient email address is required");
    const tenantSmtp = await this.resolveTenantSmtp(organizationId);
    const subject = "Test email — আপনার প্রেরক সেটিংস পরীক্ষা";
    const text = "এটি একটি পরীক্ষামূলক ইমেইল। আপনার Messaging প্রেরক সেটিংস সঠিকভাবে কাজ করছে। (This is a test email from your Messaging sender settings.)";
    let result: { providerMessageId: string };
    let path: "tenant" | "platform";
    if (tenantSmtp && typeof (this.email as any).sendTenant === "function") {
      result = await this.email.sendTenant(organizationId, tenantSmtp, { to: address, subject, text });
      path = "tenant";
    } else if (this.email.isConfigured()) {
      result = await this.email.send({ to: address, subject, text });
      path = "platform";
    } else {
      throw new BadRequestException("No email path is configured for this organization: save your own SMTP settings or ask the platform admin to configure platform SMTP.");
    }
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.sender_test_send", entityType: "MessagingSenderConfig", metadata: { path, to: address, providerMessageId: result.providerMessageId } });
    return { sent: true, path, providerMessageId: result.providerMessageId };
  }

  /**
   * MS4 — SPF/DKIM health for the sending domain (the tenant
   * From domain when tenant SMTP is set, else the platform
   * From's). DNS goes through the injectable txtResolver seam.
   * A resolver failure reports UNKNOWN — never "missing": absence
   * of records and inability to look are different facts.
   */
  async getDomainHealth(organizationId: string) {
    const row = await this.getSenderConfigRow(organizationId);
    const tenantSmtp = tenantSmtpFromRow(row);
    const platformCfg = effectiveSmtpConfig();
    const fromAddress = tenantSmtp?.from ?? platformCfg?.from ?? null;
    const source = tenantSmtp ? "tenant" : fromAddress ? "platform" : "none";
    const domain = fromAddress?.includes("@") ? fromAddress.split("@").pop()!.toLowerCase() : null;
    if (!domain) {
      return {
        domain: null, source,
        spf: { status: "unknown" as const, reason: "No From address is configured (tenant or platform), so there is no sending domain to check." },
        dkim: { status: "not_checked" as const, reason: "No sending domain is configured." },
      };
    }
    let txtRecords: string[] | null = null;
    let lookupError: string | null = null;
    try {
      const lists = await this.txtResolver(domain);
      txtRecords = lists.map((parts) => parts.join(""));
    } catch (e: any) {
      lookupError = e?.message ?? String(e);
    }
    const spf = lookupError
      ? { status: "unknown" as const, reason: `DNS lookup failed, so SPF could not be determined: ${lookupError}` }
      : (() => {
          const record = (txtRecords ?? []).find((t) => t.toLowerCase().startsWith("v=spf1"));
          return record
            ? { status: "found" as const, record }
            : { status: "missing" as const, reason: `No SPF (v=spf1) TXT record was found on ${domain}.` };
        })();
    const selector = row?.dkimSelector ? String(row.dkimSelector) : null;
    let dkim: { status: string; record?: string; reason?: string; selector?: string };
    if (!selector) {
      dkim = { status: "not_checked", reason: "No DKIM selector is set in your sender settings, so DKIM was not checked. Add the selector your mail provider gave you to check it here." };
    } else if (lookupError) {
      dkim = { status: "unknown", selector, reason: `DNS lookup failed, so DKIM could not be determined: ${lookupError}` };
    } else {
      let dkimRecords: string[] | null = null;
      let dkimError: string | null = null;
      try {
        const lists = await this.txtResolver(`${selector}._domainkey.${domain}`);
        dkimRecords = lists.map((parts) => parts.join(""));
      } catch (e: any) {
        dkimError = e?.message ?? String(e);
      }
      if (dkimError) {
        dkim = { status: "unknown", selector, reason: `DNS lookup failed, so DKIM could not be determined: ${dkimError}` };
      } else {
        const record = (dkimRecords ?? []).find((t) => /v=DKIM1/i.test(t) || /(^|[;\s])p=/.test(t));
        dkim = record
          ? { status: "found", selector, record }
          : { status: "missing", selector, reason: `No DKIM record was found at ${selector}._domainkey.${domain}.` };
      }
    }
    return { domain, source, spf, dkim };
  }

  // ---------- MS2: preferences & settings ----------

  /**
   * MS2 — the org's messaging settings with the schema defaults
   * applied. Defensive: a missing row (every pre-MS2 org) or a
   * missing table (pre-migration) reads as the defaults —
   * frequencyCapPerDay 1, whatsappOptInRequired false — never a
   * crash, so older fake-prisma fixtures stay green untouched.
   */
  async getMessagingSetting(organizationId: string): Promise<{ frequencyCapPerDay: number; whatsappOptInRequired: boolean; linkTrackingEnabled: boolean }> {
    // MS5: linkTrackingEnabled defaults TRUE (the schema default)
    // — a missing row, a pre-MS5 row without the column, or a
    // missing table all read as ON.
    const fallback = { frequencyCapPerDay: 1, whatsappOptInRequired: false, linkTrackingEnabled: true };
    try {
      const row = await (this.prisma as any).messagingSetting?.findFirst({ where: { organizationId } });
      if (!row) return fallback;
      return {
        frequencyCapPerDay: Number.isInteger(row.frequencyCapPerDay) ? row.frequencyCapPerDay : fallback.frequencyCapPerDay,
        whatsappOptInRequired: row.whatsappOptInRequired === true,
        linkTrackingEnabled: row.linkTrackingEnabled !== false,
      };
    } catch {
      return fallback;
    }
  }

  /** MS2 — strict settings write (leads followup-setting pattern):
   * cap must be an integer 0..20 (0 = off); opt-in a real boolean.
   * MS5 adds linkTrackingEnabled (a real boolean). */
  async updateMessagingSetting(organizationId: string, actorId: string, dto: { frequencyCapPerDay?: number; whatsappOptInRequired?: boolean; linkTrackingEnabled?: boolean }) {
    const current = await this.getMessagingSetting(organizationId);
    let frequencyCapPerDay = current.frequencyCapPerDay;
    let whatsappOptInRequired = current.whatsappOptInRequired;
    let linkTrackingEnabled = current.linkTrackingEnabled;
    if (dto.frequencyCapPerDay !== undefined) {
      if (!Number.isInteger(dto.frequencyCapPerDay) || dto.frequencyCapPerDay < 0 || dto.frequencyCapPerDay > 20) {
        throw new BadRequestException("frequencyCapPerDay must be an integer between 0 and 20 (0 = off)");
      }
      frequencyCapPerDay = dto.frequencyCapPerDay;
    }
    if (dto.whatsappOptInRequired !== undefined) {
      if (typeof dto.whatsappOptInRequired !== "boolean") throw new BadRequestException("whatsappOptInRequired must be a boolean");
      whatsappOptInRequired = dto.whatsappOptInRequired;
    }
    if (dto.linkTrackingEnabled !== undefined) {
      if (typeof dto.linkTrackingEnabled !== "boolean") throw new BadRequestException("linkTrackingEnabled must be a boolean");
      linkTrackingEnabled = dto.linkTrackingEnabled;
    }
    const data = { frequencyCapPerDay, whatsappOptInRequired, linkTrackingEnabled };
    const existing = await (this.prisma as any).messagingSetting.findFirst({ where: { organizationId } }).catch(() => null);
    const row = existing
      ? await (this.prisma as any).messagingSetting.update({ where: { id: existing.id }, data })
      : await (this.prisma as any).messagingSetting.create({ data: { organizationId, ...data } });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.settings_update", entityType: "MessagingSetting", entityId: row.id, metadata: data });
    return {
      frequencyCapPerDay: row.frequencyCapPerDay, whatsappOptInRequired: row.whatsappOptInRequired,
      linkTrackingEnabled: typeof row.linkTrackingEnabled === "boolean" ? row.linkTrackingEnabled : linkTrackingEnabled,
    };
  }

  /** MS2 — upsert one preference row (the unique org+channel+
   * address row flips in place; the latest status/source wins). */
  async setPreference(organizationId: string, input: {
    channel: string; address: string; status: "opted_out" | "opted_in"; source: string;
    recipientType?: string | null; recipientId?: string | null; note?: string | null;
  }) {
    const address = normalizePrefAddress(input.channel, input.address);
    const data = {
      status: input.status, source: input.source,
      recipientType: input.recipientType ?? null, recipientId: input.recipientId ?? null,
      note: input.note ?? null,
    };
    const existing = await (this.prisma as any).messagePreference.findFirst({
      where: { organizationId, channel: input.channel, address },
    }).catch(() => null);
    if (existing) {
      return (this.prisma as any).messagePreference.update({ where: { id: existing.id }, data });
    }
    return (this.prisma as any).messagePreference.create({
      data: { organizationId, channel: input.channel, address, ...data },
    });
  }

  /** MS2 — the opted_out row for one (org, channel, address), or
   * null. Defensive: a missing table (pre-migration) means "no
   * preferences", never a crashed send. */
  private async findOptOut(organizationId: string, channel: string, normalizedAddress: string): Promise<any | null> {
    if (!normalizedAddress) return null;
    try {
      return await (this.prisma as any).messagePreference?.findFirst({
        where: { organizationId, channel, address: normalizedAddress, status: "opted_out" },
      }) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * CX10 + MS2 — THE shared broadcast resolver. prepareBroadcast
   * (the send path) and the preview endpoint both go through this
   * one function, so what the preview shows is exactly what a send
   * would target. Exclusion stages, in order:
   *  1. Previous recipients (only when excludePreviousRecipients is
   *     on): drop every recipient whose (recipientType, recipientId)
   *     has a MessageDelivery of THIS org with broadcastId != null
   *     and status "sent" — a previous CONFIRMED send. Failed
   *     deliveries do NOT exclude; ANY earlier broadcast counts
   *     regardless of channel; workflow sends never exclude; other
   *     orgs never exclude (org-scoped query). [CX10]
   *  2. Suppression (MS2, always on): drop recipients whose CHANNEL
   *     address has an opted_out MessagePreference — an email
   *     opt-out never blocks SMS, because the match is by the
   *     channel's own normalized address.
   *  3. Frequency cap (MS2, broadcasts only): drop recipients with
   *     >= frequencyCapPerDay CONFIRMED broadcast deliveries in the
   *     rolling last 24h, when the org's cap is > 0. A delivery
   *     without a readable timestamp cannot be shown to be inside
   *     the window, so it never counts.
   *  4. WhatsApp opt-in (MS2, only when the org setting is on and
   *     the channel is whatsapp): keep ONLY recipients with an
   *     opted_in preference for (org, whatsapp, phone).
   * Missing preference/setting tables read as "no preferences /
   * defaults" (defensive .catch), so pre-migration behaviour is
   * the CX10 behaviour.
   */
  async resolveBroadcastRecipients(organizationId: string, opts: {
    channel: string; audienceType: string; audienceStage?: string; audienceSegment?: string;
    excludePreviousRecipients?: boolean;
    excludePastDays?: number; excludeOptOut?: boolean;
  } & AudienceExtras): Promise<BroadcastResolution> {
    const { recipients: all, invalidCount } = await this.resolveAudienceInternal(organizationId, opts.channel, opts.audienceType, opts.audienceStage, opts.audienceSegment, opts);
    const audienceTotal = all.length;
    let recipients = all;
    let excludedPreviousCount = 0;
    if (opts.excludePreviousRecipients) {
      const deliveries = await (this.prisma as any).messageDelivery.findMany({
        where: { organizationId, broadcastId: { not: null }, status: "sent" },
        select: { recipientType: true, recipientId: true },
        take: 10000,
      });
      const seen = new Set(
        (deliveries as any[])
          .filter((d) => d.recipientId)
          .map((d) => `${d.recipientType}:${d.recipientId}`),
      );
      recipients = recipients.filter((r) => !seen.has(`${r.type}:${r.id}`));
      excludedPreviousCount = audienceTotal - recipients.length;
    }

    // Stage 1b (integration, owner CX10 variant) — recent-days
    // window exclusion: drop anyone with a delivery in the last
    // excludePastDays days (address OR recipient id match), the
    // semantics the owner's broadcast fields promise. Counted into
    // excludedPreviousCount (it is a previous-delivery exclusion).
    if (opts.excludePastDays && opts.excludePastDays > 0 && recipients.length) {
      const cutoff = new Date(Date.now() - opts.excludePastDays * 24 * 60 * 60 * 1000);
      const recentDeliveries = await (this.prisma as any).messageDelivery.findMany({
        where: { organizationId, createdAt: { gte: cutoff } },
        select: { address: true, recipientId: true },
        take: 50000,
      }).catch(() => []);
      const excludedAddresses = new Set((recentDeliveries as any[]).map((d) => d.address).filter(Boolean));
      const excludedIds = new Set((recentDeliveries as any[]).map((d) => d.recipientId).filter(Boolean));
      const before = recipients.length;
      recipients = recipients.filter((r) => {
        const addr = opts.channel === "email" ? r.email : r.phone;
        if (excludedIds.has(r.id)) return false;
        if (addr && excludedAddresses.has(addr)) return false;
        return true;
      });
      excludedPreviousCount += before - recipients.length;
    }

    // Stage 2 — suppression by this channel's normalized address.
    let excludedSuppressedCount = 0;
    let suppressedRows: any[] = [];
    try {
      suppressedRows = await (this.prisma as any).messagePreference.findMany({
        where: { organizationId, channel: opts.channel, status: "opted_out" },
        select: { address: true },
      }) ?? [];
    } catch { suppressedRows = []; }
    if (suppressedRows.length) {
      const suppressed = new Set(suppressedRows.map((p: any) => p.address));
      const before = recipients.length;
      recipients = recipients.filter((r) => !suppressed.has(recipientPrefAddress(opts.channel, r)));
      excludedSuppressedCount = before - recipients.length;
    }

    const setting = await this.getMessagingSetting(organizationId);

    // Stage 1c (integration, owner CX10 variant) — the
    // unsubscribed-column opt-out: only when the caller explicitly
    // passes excludeOptOut (the owner's DTO paths do; MS callers
    // omit it and keep pure MS2 preference behaviour).
    if (opts.excludeOptOut && recipients.length) {
      const [custOut, leadOut] = await Promise.all([
        (this.prisma as any).customer.findMany({ where: { organizationId, unsubscribed: true }, select: { id: true } }).catch(() => []),
        (this.prisma as any).lead.findMany({ where: { organizationId, unsubscribed: true }, select: { id: true } }).catch(() => []),
      ]);
      const outIds = new Set([...(custOut as any[]), ...(leadOut as any[])].map((r) => r.id));
      if (outIds.size) {
        const before = recipients.length;
        recipients = recipients.filter((r) => !outIds.has(r.id));
        excludedSuppressedCount += before - recipients.length;
      }
    }

    // Stage 3 — frequency cap over confirmed broadcast deliveries.
    let excludedFrequencyCount = 0;
    if (setting.frequencyCapPerDay > 0 && recipients.length) {
      const since = Date.now() - 24 * 3600 * 1000;
      const recent: any[] = await (this.prisma as any).messageDelivery.findMany({
        where: { organizationId, broadcastId: { not: null }, status: "sent" },
        select: { recipientType: true, recipientId: true, createdAt: true },
        take: 20000,
      }).catch(() => []);
      const counts = new Map<string, number>();
      for (const d of recent) {
        if (!d.recipientId) continue;
        const t = d.createdAt ? new Date(d.createdAt).getTime() : NaN;
        if (!Number.isFinite(t) || t < since) continue;
        const key = `${d.recipientType}:${d.recipientId}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const before = recipients.length;
      recipients = recipients.filter((r) => (counts.get(`${r.type}:${r.id}`) ?? 0) < setting.frequencyCapPerDay);
      excludedFrequencyCount = before - recipients.length;
    }

    // Stage 4 — WhatsApp opt-in required.
    let excludedNoOptInCount = 0;
    if (opts.channel === "whatsapp" && setting.whatsappOptInRequired) {
      let optInRows: any[] = [];
      try {
        optInRows = await (this.prisma as any).messagePreference.findMany({
          where: { organizationId, channel: "whatsapp", status: "opted_in" },
          select: { address: true },
        }) ?? [];
      } catch { optInRows = []; }
      const optedIn = new Set(optInRows.map((p: any) => p.address));
      const before = recipients.length;
      recipients = recipients.filter((r) => optedIn.has(recipientPrefAddress("whatsapp", r)));
      excludedNoOptInCount = before - recipients.length;
    }

    return {
      recipients, audienceTotal,
      excludedPreviousCount, excludedSuppressedCount, excludedFrequencyCount, excludedNoOptInCount,
      invalidCount,
    };
  }

  /**
   * CX10 — broadcast preview: counts + a masked sample of the
   * FINAL recipient set, runnable before any broadcast exists.
   * The sample carries name + masked address only — never a full
   * address, never a recipient id.
   */

  /**
   * CX10 (owner series): Audience preview before send — computes
   * total eligible, excluded count (opt-out & recent broadcasts),
   * and returns a masked sample. Integration: runs through the
   * SAME integrated resolver as sends (resolveBroadcastRecipients:
   * MS stages + the CX10 window/opt-out stages) — raw = no CX10
   * exclusions, filtered = with them.
   */
  async previewAudience(organizationId: string, input: {
    channel: string;
    audienceType: string;
    audienceStage?: string;
    audienceSegment?: string;
    excludePastDays?: number;
    excludeOptOut?: boolean;
  }) {
    const rawRes = await this.resolveBroadcastRecipients(organizationId, {
      channel: input.channel, audienceType: input.audienceType,
      audienceStage: input.audienceStage, audienceSegment: input.audienceSegment,
    });
    const totalRaw = rawRes.recipients.length;

    const filteredRes = await this.resolveBroadcastRecipients(organizationId, {
      channel: input.channel, audienceType: input.audienceType,
      audienceStage: input.audienceStage, audienceSegment: input.audienceSegment,
      excludePastDays: input.excludePastDays,
      excludeOptOut: input.excludeOptOut ?? true,
    });
    const filtered = filteredRes.recipients;
    const totalEligible = filtered.length;

    const sample = filtered.slice(0, 10).map((r) => {
      const rawContact = input.channel === "email" ? (r.email ?? "") : (r.phone ?? "");
      let masked = rawContact;
      if (input.channel === "email" && rawContact.includes("@")) {
        const [user, domain] = rawContact.split("@");
        masked = `${user.slice(0, 2)}***@${domain}`;
      } else if (rawContact.length >= 6) {
        masked = rawContact.slice(0, 3) + "****" + rawContact.slice(-3);
      }
      return {
        id: r.id,
        type: r.type,
        name: r.name,
        maskedContact: masked,
      };
    });

    return {
      totalRaw,
      totalEligible,
      excludedCount: Math.max(0, totalRaw - totalEligible),
      sample,
    };
  }

  async previewBroadcast(organizationId: string, dto: {
    channel: string; audienceType: string; audienceStage?: string; audienceSegment?: string;
    excludePreviousRecipients?: boolean;
    // MS3: the form's message body, used ONLY for the MS4 SMS
    // parts count in the cost estimate (never stored here).
    body?: string;
  } & AudienceExtras) {
    if (!["email", "sms", "whatsapp"].includes(dto.channel)) throw new BadRequestException("channel must be email, sms or whatsapp");
    const resolved = await this.resolveBroadcastRecipients(organizationId, dto);
    const { recipients } = resolved;
    return {
      audienceTotal: resolved.audienceTotal,
      excludedPreviousCount: resolved.excludedPreviousCount,
      excludedSuppressedCount: resolved.excludedSuppressedCount,
      excludedFrequencyCount: resolved.excludedFrequencyCount,
      excludedNoOptInCount: resolved.excludedNoOptInCount,
      invalidCount: resolved.invalidCount,
      total: recipients.length,
      sample: recipients.slice(0, 20).map((r) => ({
        type: r.type, name: r.name, address: maskRecipientAddress(dto.channel, r),
      })),
      costEstimate: await this.buildCostEstimate(organizationId, dto.channel, recipients.length, dto.body),
    };
  }

  /**
   * MS4 — a rate-based cost ESTIMATE for the preview, computed
   * ONLY from the org's own entered rates (MessagingSenderConfig).
   * No rate for the channel ⇒ null (the UI says the rate is not
   * set) — a price is never invented. SMS parts come from the
   * pure sms-segments helper over the form's current body; without
   * a body the parts (and therefore the total) stay unknown and
   * the basis says so.
   */
  private async buildCostEstimate(organizationId: string, channel: string, recipientCount: number, body?: string): Promise<{
    currency: "BDT"; smsParts?: number; totalMinor?: number; basis: string;
  } | null> {
    const row = await this.getSenderConfigRow(organizationId);
    if (!row) return null;
    const rateText = (minor: number) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
    if (channel === "sms") {
      const rate = row.smsCostPerPartMinor;
      if (rate === null || rate === undefined) return null;
      if (!body) {
        return { currency: "BDT", basis: `SMS rate is set (BDT ${rateText(rate)} per part) but no message body was provided, so the part count — and the total — cannot be estimated.` };
      }
      const seg = smsSegments(body);
      return {
        currency: "BDT", smsParts: seg.parts,
        totalMinor: recipientCount * seg.parts * rate,
        basis: `Estimate only: ${recipientCount} recipients × ${seg.parts} SMS part(s) (${seg.encoding}) × BDT ${rateText(rate)} per part at the rate you set. The gateway's actual charge may differ.`,
      };
    }
    if (channel === "whatsapp") {
      const rate = row.whatsappCostPerMessageMinor;
      if (rate === null || rate === undefined) return null;
      return {
        currency: "BDT", totalMinor: recipientCount * rate,
        basis: `Estimate only: ${recipientCount} recipients × BDT ${rateText(rate)} per WhatsApp message at the rate you set. Meta's actual charge may differ.`,
      };
    }
    if (channel === "email") {
      const rate = row.emailCostPerMessageMinor;
      if (rate === null || rate === undefined) return null;
      return {
        currency: "BDT", totalMinor: recipientCount * rate,
        basis: `Estimate only: ${recipientCount} recipients × BDT ${rateText(rate)} per email at the rate you set.`,
      };
    }
    return null;
  }

  async rfmReport(organizationId: string) {
    const { computeRfm, RFM_SEGMENTS } = await import("./rfm");
    const rows = await computeRfm(this.prisma as any, organizationId);
    const counts: Record<string, number> = {};
    const segmentStats: Record<string, { count: number; totalSpendMinor: string; avgRecencyDays: number; avgFrequency: number }> = {};
    for (const seg of RFM_SEGMENTS) {
      const segRows = rows.filter((r) => r.segment === seg);
      counts[seg] = segRows.length;
      const totalSpend = segRows.reduce((acc, r) => acc + BigInt(r.monetaryMinor || 0), 0n);
      const avgRecency = segRows.length > 0 ? Math.round(segRows.reduce((acc, r) => acc + r.recencyDays, 0) / segRows.length) : 0;
      const avgFreq = segRows.length > 0 ? Math.round((segRows.reduce((acc, r) => acc + r.frequency, 0) / segRows.length) * 10) / 10 : 0;
      segmentStats[seg] = {
        count: segRows.length,
        totalSpendMinor: String(totalSpend),
        avgRecencyDays: avgRecency,
        avgFrequency: avgFreq,
      };
    }
    return { totalCustomers: rows.length, segments: counts, segmentStats, rows: rows.slice(0, 500) };
  }

  // ---------- MS9: AI for messaging ----------

  /**
   * MS9 — the VisionService / creative-studio discipline,
   * feature-scoped to MESSAGING_AI_FEATURE: platform kill
   * switch first (403), then the per-feature daily cap counted
   * from AIUsageRecord (429) — both BEFORE any provider call,
   * so a blocked org never reaches provider HTTP.
   */
  private async checkMessagingAiLimit(organizationId: string) {
    const { killSwitches, effectiveLimits } = await import("../common/platform-settings");
    const ks = await killSwitches(this.prisma as any);
    if (ks.aiDisabledOrgIds.includes(organizationId)) {
      throw new HttpException("AI features are temporarily disabled for this organization by the platform team.", 403);
    }
    const baseline = Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 200);
    const { aiDaily: limit } = await effectiveLimits(this.prisma as any, organizationId, { aiDaily: baseline, broadcastCap: 1000 });
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await (this.prisma as any).aIUsageRecord.count({
      where: { organizationId, feature: MESSAGING_AI_FEATURE, createdAt: { gte: startOfDay } },
    });
    if (used >= limit) {
      throw new HttpException(
        `Daily AI generation limit reached for this organization (${limit}). Try again tomorrow or ask the platform team to raise your plan limit.`,
        429,
      );
    }
  }

  /** ONE usage record per completed call, written only after
   * the call produced a response (see the 502 rule on
   * draftMessagingCopy — an unparseable answer records
   * nothing). */
  private async recordMessagingAiUsage(organizationId: string, userId: string, provider: string, model: string, inputTokens: number, outputTokens: number, estimated: boolean) {
    await (this.prisma as any).aIUsageRecord.create({
      data: { organizationId, userId, feature: MESSAGING_AI_FEATURE, provider, model, inputTokens, outputTokens, estimated },
    });
  }

  private async messagingAiProvider(organizationId: string) {
    try {
      return await providerForOrg(this.llm, organizationId);
    } catch (e) {
      // A real provider named without a key / an unknown name:
      // an honest 502 with the configuration error verbatim —
      // never a silent fallback to template output.
      throw new HttpException(e instanceof Error ? e.message : "LLM is not configured.", 502);
    }
  }

  /** The org's BusinessProfile — the SAME row the inbox AI and
   * the assistant read — as prompt facts. Only fields that
   * actually exist; nothing is padded or invented. */
  private async businessProfileFacts(organizationId: string): Promise<string[]> {
    const profile = await (this.prisma as any).businessProfile?.findUnique({ where: { organizationId } }).catch(() => null);
    if (!profile) return [];
    const facts: string[] = [];
    if (profile.description) facts.push(`Business: ${profile.description}`);
    if (profile.industry) facts.push(`Industry: ${profile.industry}`);
    if (profile.brandVoice) facts.push(`Brand voice: ${profile.brandVoice}`);
    if (profile.uniqueSellingPoints) facts.push(`Unique selling points: ${profile.uniqueSellingPoints}`);
    if (profile.goals) facts.push(`Business goals: ${profile.goals}`);
    return facts;
  }

  /** Product facts from the REAL product row (creative-studio's
   * set). A foreign or missing product is a 404 — the AI is
   * never handed invented product facts. */
  private async productFactsOrThrow(organizationId: string, productId: string) {
    const product = await (this.prisma as any).product.findFirst({ where: { id: productId, organizationId } });
    if (!product) throw new NotFoundException("Product not found in this organization");
    const facts: string[] = [
      `Product name: ${product.name}`,
      `Price: ${formatMinor(BigInt(product.priceMinor), product.currency)}`,
    ];
    if (product.compareAtMinor !== null && product.compareAtMinor !== undefined) {
      facts.push(`Compare-at price: ${formatMinor(BigInt(product.compareAtMinor), product.currency)}`);
    }
    if (product.category) facts.push(`Category: ${product.category}`);
    if (product.description) facts.push(`Description: ${product.description}`);
    return { product, facts };
  }

  /** SMS drafts carry the segment helper's part count for the
   * exact text returned (the MS4 helper — never an estimate
   * invented by the model). */
  private withSmsParts(channel: string, variants: { subject?: string; body: string }[]) {
    if (channel !== "sms") return variants;
    return variants.map((v) => ({ ...v, smsParts: smsSegments(v.body).parts }));
  }

  /**
   * MS9 — AI copy drafts for a broadcast. The drafts are
   * RETURNED ONLY: nothing is saved as a broadcast or template
   * and nothing is ever sent from here (the composer fills its
   * fields only when the merchant clicks a variant). The prompt
   * is built from REAL context only — the org's BusinessProfile
   * fields that exist and, when a productId is given, that
   * product's row.
   */
  async draftMessagingCopy(organizationId: string, actorId: string, dto: {
    channel: string; goal: string; productId?: string; audienceHint?: string; language?: string;
  }) {
    if (!["email", "sms"].includes(dto.channel)) {
      throw new BadRequestException("channel must be email or sms for AI drafts (WhatsApp broadcasts send approved Meta templates only)");
    }
    const goal = String(dto.goal ?? "").trim();
    if (!goal) throw new BadRequestException("goal is required — say what this message should achieve");
    const language: "bn" | "en" = dto.language === "en" ? "en" : "bn";
    // Enforcement FIRST (creative-studio discipline): the kill
    // switch / cap run before even the product load.
    await this.checkMessagingAiLimit(organizationId);

    const facts: string[] = [];
    let product: any = null;
    if (dto.productId) {
      const loaded = await this.productFactsOrThrow(organizationId, dto.productId);
      product = loaded.product;
      facts.push(...loaded.facts);
    }
    facts.push(...(await this.businessProfileFacts(organizationId)));
    facts.push(`Campaign goal: ${goal}`);
    if (dto.audienceHint?.trim()) facts.push(`Audience: ${dto.audienceHint.trim()}`);
    const factsText = facts.join("\n");

    const provider = await this.messagingAiProvider(organizationId);
    if (!provider.isRealLlm) {
      // Dev-template path (creative-studio precedent): the dev
      // provider is NOT a model, so its output is never
      // presented as AI copy. Deterministic template variants
      // are assembled from the REAL facts above only and the
      // response labels them as dev templates.
      const variants = this.devCopyVariants(dto.channel, language, goal, product, facts);
      const outputText = variants.map((v) => `${v.subject ?? ""}\n${v.body}`).join("\n");
      await this.recordMessagingAiUsage(organizationId, actorId, "dev-template", "dev-template-v1", estimateTokens(factsText), estimateTokens(outputText), true);
      return {
        variants: this.withSmsParts(dto.channel, variants),
        providerLabel: "dev-template", isRealLlm: false,
        notice: language === "bn"
          ? "আসল AI (LLM) কনফিগার করা হয়নি — এগুলো Dev Template Adapter দিয়ে বানানো সাধারণ টেমপ্লেট, আসল AI জেনারেশন নয়।"
          : "No real AI (LLM) is configured — these are plain templates from the Dev Template Adapter, not real AI generation.",
      };
    }

    const systemPrompt = [
      dto.channel === "email"
        ? "You write marketing email copy for an ecommerce business."
        : "You write marketing SMS copy for an ecommerce business.",
      "Use ONLY the facts given. Never invent prices, discounts, stock, delivery promises, features or results.",
      language === "bn" ? "Write in Bengali (Bangla script)." : "Write in English.",
      dto.channel === "email"
        ? 'Return ONLY JSON {"variants":[{"subject":string,"body":string}]} with exactly 2 variants. The body is plain text; the personalization variables {{name}} and {{firstName}} may be used.'
        : 'Return ONLY JSON {"variants":[{"body":string}]} with exactly 2 variants. Keep each body short — at most 3 SMS parts (Bengali text bills as Unicode, roughly 200 characters). The personalization variable {{name}} may be used.',
    ].join("\n");

    let result: { text: string; model: string; inputTokens: number; outputTokens: number; tokensEstimated: boolean };
    try {
      result = await provider.complete(
        [{ role: "system", content: systemPrompt }, { role: "user", content: factsText }],
        { jsonMode: true, maxTokens: 1200 },
      );
    } catch (e: any) {
      throw new HttpException(e?.message ?? String(e), 502);
    }
    let parsed: any = null;
    try { parsed = JSON.parse(result.text); } catch { parsed = null; }
    const rawVariants: any[] = Array.isArray(parsed?.variants) ? parsed.variants : [];
    const variants: { subject?: string; body: string }[] = [];
    for (const raw of rawVariants) {
      const body = typeof raw?.body === "string" ? raw.body.trim() : "";
      if (!body) continue;
      const subject = typeof raw?.subject === "string" ? raw.subject.trim() : "";
      if (dto.channel === "email" && !subject) continue;
      variants.push({
        ...(dto.channel === "email" ? { subject: subject.slice(0, 200) } : {}),
        body: body.slice(0, 4000),
      });
      if (variants.length >= 2) break;
    }
    if (!variants.length) {
      // The provider answered but nothing usable could be
      // parsed: an honest 502 and NOTHING stored — no draft row
      // (there never is one) and no usage record either.
      throw new HttpException("AI উত্তর বোঝা যায়নি — আবার চেষ্টা করুন।", 502);
    }
    await this.recordMessagingAiUsage(organizationId, actorId, provider.name, result.model, result.inputTokens, result.outputTokens, result.tokensEstimated);
    return { variants: this.withSmsParts(dto.channel, variants), providerLabel: provider.name, isRealLlm: true };
  }

  /** The dev-template draft variants: merchant-supplied facts
   * (goal, product row, business USP) in fixed framing — the
   * creative-studio dev discipline. No discount, deadline,
   * stock or delivery claim is ever added by the template. */
  private devCopyVariants(channel: string, language: "bn" | "en", goal: string, product: any, facts: string[]): { subject?: string; body: string }[] {
    const price = product ? formatMinor(BigInt(product.priceMinor), product.currency) : null;
    const compare = product?.compareAtMinor !== null && product?.compareAtMinor !== undefined
      ? formatMinor(BigInt(product.compareAtMinor), product.currency) : null;
    const usp = facts.find((f) => f.startsWith("Unique selling points: "))?.slice("Unique selling points: ".length);
    const desc = product?.description ? String(product.description).slice(0, 200) : "";
    if (language === "bn") {
      const productLine = product ? `${product.name} — দাম ${price}${compare ? ` (আগের দাম ${compare})` : ""}।` : "";
      const v1Body = [productLine, goal, usp ? `${usp}` : "", desc, "বিস্তারিত জানতে আমাদের পেজে মেসেজ করুন।"].filter(Boolean).join(" ");
      const v2Body = [goal, productLine, desc, "পছন্দ হলে এখনই অর্ডার করুন।"].filter(Boolean).join(" ");
      return channel === "email"
        ? [{ subject: goal.slice(0, 200), body: v1Body }, { subject: (product ? `${product.name} — ${price}` : goal).slice(0, 200), body: v2Body }]
        : [{ body: v1Body }, { body: v2Body }];
    }
    const productLine = product ? `${product.name} — ${price}${compare ? ` (was ${compare})` : ""}.` : "";
    const v1Body = [productLine, goal, usp ? `${usp}` : "", desc, "Message our page for details."].filter(Boolean).join(" ");
    const v2Body = [goal, productLine, desc, "Order now if you like it."].filter(Boolean).join(" ");
    return channel === "email"
      ? [{ subject: goal.slice(0, 200), body: v1Body }, { subject: (product ? `${product.name} — ${price}` : goal).slice(0, 200), body: v2Body }]
      : [{ body: v1Body }, { body: v2Body }];
  }

  /**
   * MS9 — AI subject-line variants for the composer (email).
   * Same discipline as the copy drafts and the SAME usage
   * feature ("messaging_copy") — one shared cap, one ledger.
   */
  async draftMessagingSubjects(organizationId: string, actorId: string, dto: { subject: string; goal?: string }) {
    const subject = String(dto.subject ?? "").trim();
    if (!subject) throw new BadRequestException("subject is required");
    await this.checkMessagingAiLimit(organizationId);
    const provider = await this.messagingAiProvider(organizationId);
    if (!provider.isRealLlm) {
      const bengali = /[\u0980-\u09FE]/.test(subject); // Bengali Unicode block
      const variants = [
        subject,
        `🔔 ${subject}`,
        bengali ? `${subject} — বিস্তারিত ভেতরে` : `${subject} — details inside`,
      ];
      await this.recordMessagingAiUsage(organizationId, actorId, "dev-template", "dev-template-v1", estimateTokens(subject), estimateTokens(variants.join("\n")), true);
      return {
        variants, providerLabel: "dev-template", isRealLlm: false,
        notice: bengali
          ? "আসল AI (LLM) কনফিগার করা হয়নি — এগুলো Dev Template Adapter-এর সাধারণ রূপ, আসল AI প্রস্তাব নয়।"
          : "No real AI (LLM) is configured — these are plain Dev Template Adapter variants, not real AI suggestions.",
      };
    }
    const systemPrompt = [
      "You write email subject lines for an ecommerce business.",
      "Use ONLY the given subject and goal. Never invent prices, discounts or claims that are not in the subject.",
      "Keep the subject's own language (Bengali subjects stay in Bangla script).",
      'Return ONLY JSON {"variants":[string,string,string]} with exactly 3 alternative subject lines, each at most 120 characters.',
    ].join("\n");
    const userText = [`Original subject: ${subject}`, ...(dto.goal?.trim() ? [`Goal: ${dto.goal.trim()}`] : [])].join("\n");
    let result: { text: string; model: string; inputTokens: number; outputTokens: number; tokensEstimated: boolean };
    try {
      result = await provider.complete(
        [{ role: "system", content: systemPrompt }, { role: "user", content: userText }],
        { jsonMode: true, maxTokens: 400 },
      );
    } catch (e: any) {
      throw new HttpException(e?.message ?? String(e), 502);
    }
    let parsed: any = null;
    try { parsed = JSON.parse(result.text); } catch { parsed = null; }
    const rawList: any[] = Array.isArray(parsed?.variants) ? parsed.variants : [];
    const variants = rawList
      .filter((v) => typeof v === "string" && v.trim())
      .map((v) => String(v).trim().slice(0, 200))
      .slice(0, 3);
    if (!variants.length) {
      throw new HttpException("AI উত্তর বোঝা যায়নি — আবার চেষ্টা করুন।", 502);
    }
    await this.recordMessagingAiUsage(organizationId, actorId, provider.name, result.model, result.inputTokens, result.outputTokens, result.tokensEstimated);
    return { variants, providerLabel: provider.name, isRealLlm: true };
  }

  /**
   * MS9 — send-time suggestion, DETERMINISTIC (no LLM): the
   * org's OWN engagement events of the last 90 days —
   * MessageLinkClick rows plus deliveries' openedAt/readAt —
   * bucketed by Asia/Dhaka hour. Below SEND_TIME_MIN_EVENTS the
   * answer is an honest unavailable WITH the real count; the
   * method label states this is historical association, not a
   * promise.
   */
  async sendTimeSuggestion(organizationId: string) {
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    const [clicks, opened, read] = await Promise.all([
      (this.prisma as any).messageLinkClick.findMany({ where: { organizationId, createdAt: { gte: since } }, select: { createdAt: true }, take: 50000 }),
      (this.prisma as any).messageDelivery.findMany({ where: { organizationId, openedAt: { gte: since } }, select: { openedAt: true }, take: 50000 }),
      (this.prisma as any).messageDelivery.findMany({ where: { organizationId, readAt: { gte: since } }, select: { readAt: true }, take: 50000 }),
    ]);
    const stamps: Date[] = [
      ...(clicks ?? []).map((r: any) => new Date(r.createdAt)),
      ...(opened ?? []).map((r: any) => new Date(r.openedAt)),
      ...(read ?? []).map((r: any) => new Date(r.readAt)),
    ];
    const summary = summarizeSendTimeEvents(stamps);
    if (summary.totalEvents < SEND_TIME_MIN_EVENTS) {
      return {
        available: false, totalEvents: summary.totalEvents, minEvents: SEND_TIME_MIN_EVENTS,
        reason: `গত ৯০ দিনে মোট ${summary.totalEvents}টি Open/Read/Click ইভেন্ট আছে — পাঠানোর সেরা সময়ের নির্ভরযোগ্য পরামর্শের জন্য কমপক্ষে ${SEND_TIME_MIN_EVENTS}টি ইভেন্ট দরকার। আরও কিছু Broadcast পাঠিয়ে আবার দেখুন।`,
      };
    }
    return {
      available: true, totalEvents: summary.totalEvents, bestHours: summary.bestHours,
      method: "গত ৯০ দিনের আসল Open/Read/Click ইভেন্ট ঢাকার স্থানীয় সময়ের ঘণ্টা অনুযায়ী গোনা হয়েছে। এটি ঐতিহাসিক সম্পর্ক — কোন ঘণ্টায় পাঠালেই বেশি সাড়া মিলবে, এমন গ্যারান্টি নয়।",
    };
  }

  /**
   * MS9 — segment suggestions, DETERMINISTIC (no LLM): real
   * RFM counts through the pure rules in messaging-ai.ts (every
   * segment suggestion maps to a composer-selectable segment
   * audience), plus the WhatsApp opt-in advisory: when opt-in
   * is required and NOBODY has opted in, a WhatsApp broadcast
   * would reach zero people — that is said out loud, with no
   * audience attached (there is nothing to select for it).
   */
  async segmentSuggestion(organizationId: string) {
    const rows = await computeRfm(this.prisma as any, organizationId);
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.segment] = (counts[row.segment] ?? 0) + 1;
    const suggestions = segmentSuggestionsFromCounts(counts);
    const setting = await this.getMessagingSetting(organizationId);
    if (setting.whatsappOptInRequired) {
      const optedIn = await (this.prisma as any).messagePreference.count({
        where: { organizationId, channel: "whatsapp", status: "opted_in" },
      }).catch(() => 0);
      if (!optedIn) {
        suggestions.push({
          kind: "whatsapp_optin_empty",
          size: 0,
          reason: "WhatsApp Opt-in আবশ্যক করা আছে, কিন্তু এখনো কোনো প্রাপক Opt-in করেননি — এই অবস্থায় WhatsApp Broadcast পাঠালে সবাই বাদ পড়বেন। আগে Inbox বা দোকান থেকে Opt-in সংগ্রহ করুন।",
        });
      }
    }
    return suggestions;
  }

  // ---------- Single send (used by broadcasts AND workflows) ----------
  /**
   * MS2 guard, applied to EVERY send through here (broadcasts and
   * workflows alike): a recipient with an opted_out preference for
   * (org, channel, address) is never sent to — the provider is not
   * called; a "skipped" MessageDelivery records the decision with
   * the opt-out's source. Frequency cap and WhatsApp opt-in are
   * BROADCAST-only rules and live in the resolver, not here.
   *
   * Broadcast email (broadcastId set, channel email) also gains
   * the plain-text unsubscribe footer with a signed link; workflow
   * mail never does.
   */
  async sendToRecipient(organizationId: string, input: {
    channel: string; recipient: Recipient; subject?: string | null; body: string;
    // MS5: optional HTML part (email only), rendered with the
    // same vars as the text body. Empty/absent = exactly the
    // pre-MS5 text-only behaviour.
    htmlBody?: string | null;
    vars: Record<string, unknown>; broadcastId?: string; workflowRunId?: string;
  }): Promise<{ status: "sent" | "failed" | "skipped"; providerMessageId?: string; error?: string; address: string }> {
    if (input.channel === "email" || input.channel === "sms") {
      const prefAddress = recipientPrefAddress(input.channel, input.recipient);
      const optOut = await this.findOptOut(organizationId, input.channel, prefAddress);
      if (optOut) {
        const address = input.channel === "email"
          ? (input.recipient.email ?? "")
          : (normalizeBdPhone(input.recipient.phone ?? "") ?? normalizePhoneGeneric(input.recipient.phone ?? "") ?? (input.recipient.phone ?? ""));
        const error = `Recipient opted out (${optOut.source})`;
        await this.recordDelivery(organizationId, input, address, "skipped", undefined, error);
        return { status: "skipped", error, address };
      }
    }
    const mergedVars = { name: input.recipient.name, ...input.vars };
    let text = renderTemplate(input.body, mergedVars);
    // MS5: the HTML part, rendered with the same vars, sent to the
    // provider exactly as authored (no server-side rewriting
    // beyond the variable substitution + link tracking below).
    let html: string | undefined;
    if (input.channel === "email" && input.htmlBody) {
      html = renderTemplate(input.htmlBody, mergedVars);
    }
    // MS5 link tracking — BROADCAST path only (broadcastId set);
    // workflow sends are never rewritten. The org toggle controls
    // EVERYTHING: OFF ⇒ links go out exactly as authored on all
    // channels (no UTM, no wrap); ON ⇒ UTM append + signed wrap
    // on email (text + html) and SMS. WhatsApp is not rewritten
    // (its sends are template params, not free text).
    if (input.broadcastId && (input.channel === "email" || input.channel === "sms")) {
      const setting = await this.getMessagingSetting(organizationId);
      if (setting.linkTrackingEnabled) {
        const channelAddress = input.channel === "email" ? (input.recipient.email ?? "") : (input.recipient.phone ?? "");
        const recipientKey = input.recipient.id
          ? `${input.recipient.type}:${input.recipient.id}`
          : `${input.recipient.type}:${channelAddress}`;
        const ctx = { orgId: organizationId, broadcastId: input.broadcastId, channel: input.channel, recipientKey };
        text = rewriteBroadcastLinks(text, ctx);
        if (html) html = rewriteBroadcastLinks(html, ctx);
      }
    }
    if (input.channel === "email" && input.broadcastId && input.recipient.email) {
      // MS2: the footer is part of the body the provider receives —
      // appended AFTER link rewriting so the unsubscribe link
      // itself stays a direct link. MS5: the same footer is
      // appended to the HTML part as a <p> with the link. If a
      // token cannot be signed (JWT_SECRET unset — an environment
      // where auth itself cannot work), the mail still sends
      // without a footer in EITHER part rather than crashing.
      try {
        const token = issueUnsubscribeToken({
          orgId: organizationId, channel: "email",
          address: normalizePrefAddress("email", input.recipient.email),
        });
        const url = `${webBaseUrl()}/unsubscribe/${token}`;
        text += `\n\n—\nএই ইমেইলটি পেতে না চাইলে আনসাবস্ক্রাইব করুন: ${url}`;
        if (html) html += `<p>—<br>এই ইমেইলটি পেতে না চাইলে <a href="${url}">আনসাবস্ক্রাইব করুন</a></p>`;
      } catch { /* no footer without a signing secret */ }
    }
    // MS7: open tracking — a 1×1 pixel at the very end of the
    // HTML part of BROADCAST email (broadcastId set + an html
    // part exists). The token carries the MS5 recipientKey, so
    // the public pixel endpoint stamps openedAt on this exact
    // delivery. Text-only mail has no pixel and honestly never
    // reports opens; workflow mail (no broadcastId) never gets
    // one. Uses apiPublicUrl() — the MS5 redirect precedent
    // (localhost fallback when API_PUBLIC_URL is unset, NOT a
    // skip). If the token cannot be signed the mail still sends.
    if (input.channel === "email" && input.broadcastId && html) {
      try {
        const recipientKey = input.recipient.id
          ? `${input.recipient.type}:${input.recipient.id}`
          : `${input.recipient.type}:${input.recipient.email ?? ""}`;
        const openToken = issueOpenToken({ orgId: organizationId, broadcastId: input.broadcastId, recipientKey });
        html += `<img src="${apiPublicUrl()}/public/messaging/open/${openToken}" width="1" height="1" alt="" style="display:none">`;
      } catch { /* no pixel without a signing secret */ }
    }
    let address = "";
    try {
      if (input.channel === "email") {
        address = input.recipient.email ?? "";
        if (!address) throw new Error("Recipient has no email address");
        const subject = renderTemplate(input.subject ?? "", { name: input.recipient.name, ...input.vars });
        // MS4: this org's own SMTP when configured, else the
        // platform path (unchanged for every other caller).
        const tenantSmtp = await this.resolveTenantSmtp(organizationId);
        const mailInput = { to: address, subject, text, ...(html ? { html } : {}) };
        const result = tenantSmtp && typeof (this.email as any).sendTenant === "function"
          ? await this.email.sendTenant(organizationId, tenantSmtp, mailInput)
          : await this.email.send(mailInput);
        await this.recordDelivery(organizationId, input, address, "sent", result.providerMessageId);
        return { status: "sent", providerMessageId: result.providerMessageId, address };
      }
      if (input.channel === "sms") {
        const raw = input.recipient.phone ?? "";
        // MS4: BD numbers behave exactly as before; plausible
        // international numbers now pass in E.164 digits form.
        const normalized = normalizeBdPhone(raw) ?? normalizePhoneGeneric(raw);
        if (!normalized) throw new Error(`Phone number cannot be normalized for SMS: ${raw || "(empty)"}`);
        address = normalized;
        const reference = randomUUID().replace(/-/g, "").slice(0, 20);
        // MS4: this org's own gateway when configured, else the
        // platform SSL Wireless path (unchanged).
        const tenantSms = await this.resolveTenantSms(organizationId);
        const result = tenantSms && typeof (this.sms as any).sendWithGateway === "function"
          ? await this.sms.sendWithGateway(tenantSms.gateway, tenantSms, { to: normalized, text, reference })
          : await this.sms.send({ to: normalized, text, reference });
        await this.recordDelivery(organizationId, input, address, "sent", result.providerMessageId);
        return { status: "sent", providerMessageId: result.providerMessageId, address };
      }
      throw new Error(`Unknown channel: ${input.channel}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Send failed";
      await this.recordDelivery(organizationId, input, address || input.recipient.email || input.recipient.phone || "", "failed", undefined, message);
      return { status: "failed", error: message, address };
    }
  }

  private async recordDelivery(organizationId: string, input: { channel: string; recipient: Recipient; broadcastId?: string; workflowRunId?: string }, address: string, status: string, providerMessageId?: string, error?: string) {
    await (this.prisma as any).messageDelivery.create({
      data: {
        organizationId, broadcastId: input.broadcastId ?? null, workflowRunId: input.workflowRunId ?? null,
        channel: input.channel, recipientType: input.recipient.type,
        // MS3: a csv recipient has no org entity — its delivery
        // records recipientId null (the address column carries the
        // identity), never the address-as-id the snapshot uses.
        // MS5: the same applies to "test" recipients (broadcast /
        // template test sends) and to any recipient without an id.
        recipientId: input.recipient.type === "csv" || input.recipient.type === "test" || !input.recipient.id
          ? null : input.recipient.id,
        address, status, providerMessageId: providerMessageId ?? null, error: error ?? null,
      },
    }).catch(() => undefined); // delivery logging must never crash a send loop
  }

  // ---------- Broadcasts ----------
  async createBroadcast(organizationId: string, actorId: string, dto: {
    name: string; channel: string; templateId?: string; subject?: string; body?: string; htmlBody?: string | null; audienceType: string; audienceStage?: string; audienceSegment?: string;
    whatsappTemplateId?: string; templateParams?: string[];
    // MS6: rich WhatsApp template parameters (validated below).
    templateComponents?: { headerMediaUrl?: string; headerTextParams?: string[]; buttonParams?: { index: number; subType: "url" | "quick_reply"; text?: string; payload?: string }[] } | null;
    abTest?: boolean; abSubject?: string; abBody?: string; abWhatsappTemplateId?: string;
    // CX10: A/B variants inherit it via the shared base objects.
    excludePreviousRecipients?: boolean;
    excludePastDays?: number; excludeOptOut?: boolean;
    // MS1: create already scheduled (future time only).
    scheduledAt?: string;
    // MS8: recurrence shape ({ freq, interval, weekdays?,
    // endsAt? }) — validated strictly by recurrence.ts.
    recurrence?: unknown;
  } & AudienceExtras) {
    if (!["email", "sms", "whatsapp"].includes(dto.channel)) throw new BadRequestException("channel must be email, sms or whatsapp");
    // MS5: HTML is an email-only part — sms/whatsapp + htmlBody
    // is an honest 400, checked before any channel path runs.
    if (dto.htmlBody && dto.channel !== "email") throw new BadRequestException("htmlBody is only allowed for email broadcasts (SMS/WhatsApp have no HTML part)");
    // MS6: templateComponents is a WhatsApp-only input — any other
    // channel + templateComponents is an honest 400 (the MS5
    // htmlBody rule), never silently ignored. The shape is
    // validated here, before any channel path runs. MS10: the
    // validation itself lives in validateTemplateComponents —
    // create and PATCH share it verbatim.
    const templateComponents = this.validateTemplateComponents(dto.channel, dto.templateComponents ?? null);
    // MS3: the new audience types are validated AT CREATE (the
    // shared base objects below carry the fields to both A/B
    // variants and both channel paths).
    let audienceDefinition: AudienceDefinition | null = null;
    let audienceSavedId: string | null = null;
    let audienceCsv: string[] | null = null;
    if (dto.audienceType === "custom") {
      audienceDefinition = this.assertValidDefinition(dto.audienceDefinition);
    } else if (dto.audienceType === "saved") {
      if (!dto.audienceSavedId) throw new BadRequestException("audienceSavedId is required for saved audience");
      audienceSavedId = dto.audienceSavedId;
    } else if (dto.audienceType === "csv") {
      audienceCsv = parseAddressList(dto.audienceCsv);
      if (!audienceCsv.length) throw new BadRequestException("audienceCsv has no addresses — paste at least one email address or phone number");
      if (audienceCsv.length > CSV_AUDIENCE_CAP) {
        throw new BadRequestException(`CSV audience has ${audienceCsv.length} addresses, over the cap of ${CSV_AUDIENCE_CAP}. Split the list instead of silently truncating it.`);
      }
    }
    const scheduledAt: Date | null = dto.scheduledAt ? this.parseFutureScheduledAt(dto.scheduledAt) : null;
    // MS8: recurrence is validated strictly at create (unknown
    // freq/shape ⇒ 400, never reinterpreted). One generated
    // group id ties the whole chain (the abGroupId precedent);
    // A/B variants share it via the base objects below.
    let recurrence: Recurrence | null = null;
    let recurrenceGroupId: string | null = null;
    if (dto.recurrence != null) {
      try { recurrence = parseRecurrence(dto.recurrence); }
      catch (e) {
        throw new BadRequestException(e instanceof RecurrenceValidationError ? e.message : "Invalid recurrence");
      }
      recurrenceGroupId = randomUUID();
    }
    const initialStatus = scheduledAt ? "scheduled" : "draft";
    let subject = dto.subject ?? null;
    let body = dto.body ?? "";
    // MS5: the HTML part (email only, guarded above). When the
    // broadcast is built from a template, subject/body/htmlBody
    // ALL come from the template (the pre-MS5 semantics, extended).
    let htmlBody: string | null = dto.htmlBody ?? null;
    if (dto.channel === "whatsapp") {
      // WhatsApp broadcasts send a registered, Meta-approved template.
      // Free-form marketing messages outside the 24h window are not
      // allowed by Meta, so there is deliberately no body-only path.
      if (!dto.whatsappTemplateId) throw new BadRequestException("WhatsApp broadcasts need a registered template (whatsappTemplateId)");
      const tpl = await (this.prisma as any).whatsAppTemplate.findFirst({ where: { id: dto.whatsappTemplateId, organizationId } });
      if (!tpl) throw new NotFoundException("WhatsApp template not found in this organization");
      body = tpl.bodyText ?? `[WhatsApp template: ${tpl.name}]`;
      const baseWa = {
        organizationId, channel: "whatsapp", templateId: null,
        templateParams: dto.templateParams ?? [], templateComponents, subject: null,
        audienceType: dto.audienceType, audienceStage: dto.audienceStage ?? null, audienceSegment: dto.audienceSegment ?? null,
        audienceDefinition, audienceSavedId, audienceCsv,
        excludePreviousRecipients: dto.excludePreviousRecipients ?? false,
        excludePastDays: dto.excludePastDays ?? null, excludeOptOut: dto.excludeOptOut ?? true,
        status: initialStatus, scheduledAt, createdById: actorId,
        recurrence, recurrenceGroupId,
      };
      if (dto.abTest) {
        if (!dto.abWhatsappTemplateId) throw new BadRequestException("A/B WhatsApp broadcasts need a second template (abWhatsappTemplateId)");
        const tplB = await (this.prisma as any).whatsAppTemplate.findFirst({ where: { id: dto.abWhatsappTemplateId, organizationId } });
        if (!tplB) throw new NotFoundException("A/B WhatsApp template not found in this organization");
        const abGroupId = randomUUID();
        const a = await (this.prisma as any).broadcast.create({ data: { ...baseWa, name: `${dto.name} (A)`, whatsappTemplateId: tpl.id, body, abVariant: "A", abGroupId } });
        const b = await (this.prisma as any).broadcast.create({ data: { ...baseWa, name: `${dto.name} (B)`, whatsappTemplateId: tplB.id, body: tplB.bodyText ?? `[WhatsApp template: ${tplB.name}]`, abVariant: "B", abGroupId } });
        return { abGroupId, variants: [a, b] };
      }
      const broadcast = await (this.prisma as any).broadcast.create({
        data: { ...baseWa, name: dto.name, whatsappTemplateId: tpl.id, body },
      });
      return broadcast;
    }
    if (dto.templateId) {
      const template = await this.getTemplate(organizationId, dto.templateId);
      if (template.channel !== dto.channel) throw new BadRequestException("Template channel does not match the broadcast channel");
      subject = template.subject; body = template.body; htmlBody = template.htmlBody ?? null;
    }
    if (!body) throw new BadRequestException("Broadcast body is required (write one or choose a template)");
    if (dto.channel === "email" && !subject) throw new BadRequestException("Email broadcasts need a subject");
    const baseData = {
      organizationId, channel: dto.channel,
      audienceType: dto.audienceType, audienceStage: dto.audienceStage ?? null, audienceSegment: dto.audienceSegment ?? null,
      audienceDefinition, audienceSavedId, audienceCsv,
      excludePreviousRecipients: dto.excludePreviousRecipients ?? false,
      excludePastDays: dto.excludePastDays ?? null, excludeOptOut: dto.excludeOptOut ?? true,
      status: initialStatus, scheduledAt, createdById: actorId,
      recurrence, recurrenceGroupId,
    };
    if (dto.abTest) {
      if (!dto.abBody) throw new BadRequestException("A/B broadcasts need a variant B body (abBody)");
      const abGroupId = randomUUID();
      // MS5: htmlBody is stored on variant A only — there is no
      // abHtmlBody input, so variant B's htmlBody is null and its
      // sends stay text-only (honest asymmetry, not a silent copy).
      const a = await (this.prisma as any).broadcast.create({
        data: { ...baseData, name: `${dto.name} (A)`, templateId: dto.templateId ?? null, subject, body, htmlBody, abVariant: "A", abGroupId },
      });
      const b = await (this.prisma as any).broadcast.create({
        data: { ...baseData, name: `${dto.name} (B)`, templateId: null, subject: dto.abSubject ?? subject, body: dto.abBody, htmlBody: null, abVariant: "B", abGroupId },
      });
      return { abGroupId, variants: [a, b] };
    }
    const broadcast = await (this.prisma as any).broadcast.create({
      data: { ...baseData, name: dto.name, templateId: dto.templateId ?? null, subject, body, htmlBody },
    });
    return broadcast;
  }

  /** MS1: progress derived from the snapshot when one exists
   * (the authoritative per-recipient state), else from the
   * counters (pre-MS1 rows). The snapshot itself is NOT returned
   * in the list — it can hold up to the plan cap of recipients. */
  static broadcastProgress(broadcast: any): { total: number; sent: number; failed: number; skipped: number; pending: number } {
    const snap: SnapshotEntry[] | null = Array.isArray(broadcast?.recipientSnapshot) ? broadcast.recipientSnapshot : null;
    if (snap) {
      const count = (s: string) => snap.filter((e) => e.status === s).length;
      return { total: snap.length, sent: count("sent"), failed: count("failed"), skipped: count("skipped"), pending: count("pending") };
    }
    const total = Number(broadcast?.totalRecipients ?? 0);
    const sent = Number(broadcast?.sentCount ?? 0);
    const failed = Number(broadcast?.failedCount ?? 0);
    return { total, sent, failed, skipped: 0, pending: Math.max(0, total - sent - failed) };
  }

  /**
   * Broadcast list.
   * LEGACY mode (no opts argument — every pre-MS10 caller): the
   * bare array, newest first, take 50 — byte-unchanged behaviour
   * except ONE deliberate MS10 change: archived broadcasts are
   * excluded (archive means "put away"; ?archived=1 is the way
   * back in, in either mode).
   * PAGED mode (opts given): server-side name search (?q) and
   * status filter apply in the query itself, cursor-paginated
   * (cursor = createdAt + id, page size 50) returning
   * { items, nextCursor } — the MS7 deliveries pattern.
   */
  async listBroadcasts(organizationId: string, opts?: { q?: string; status?: string; cursor?: string; archived?: boolean }) {
    const shape = (rows: any[]) => rows.map((b) => {
      const { recipientSnapshot: _snapshot, ...rest } = b;
      return { ...rest, progress: MessagingService.broadcastProgress(b) };
    });
    if (!opts) {
      const rows = await (this.prisma as any).broadcast.findMany({
        where: { organizationId, archivedAt: null }, orderBy: { createdAt: "desc" }, take: 50,
      });
      return shape(rows as any[]);
    }
    const pageSize = 50;
    const where: Record<string, unknown> = { organizationId };
    if (!opts.archived) where.archivedAt = null;
    if (opts.status) where.status = opts.status;
    if (opts.q) where.name = { contains: opts.q };
    if (opts.cursor) {
      try {
        const after = JSON.parse(Buffer.from(opts.cursor, "base64url").toString("utf8")) as { c?: string; i?: string };
        if (after.c && after.i) {
          where.OR = [
            { createdAt: { lt: new Date(after.c) } },
            { createdAt: new Date(after.c), id: { lt: after.i } },
          ];
        }
      } catch { /* a malformed cursor restarts from the first page */ }
    }
    const rows: any[] = await (this.prisma as any).broadcast.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: pageSize + 1,
    });
    const page = rows.slice(0, pageSize);
    const last = page[page.length - 1];
    const nextCursor = rows.length > pageSize && last
      ? Buffer.from(JSON.stringify({ c: new Date(last.createdAt).toISOString(), i: last.id })).toString("base64url")
      : null;
    return { items: shape(page), nextCursor };
  }

  private async getBroadcastOrThrow(organizationId: string, broadcastId: string) {
    const broadcast = await (this.prisma as any).broadcast.findFirst({ where: { id: broadcastId, organizationId } });
    if (!broadcast) throw new NotFoundException("Broadcast not found");
    return broadcast;
  }

  /**
   * MS10 — the create-time validations that PATCH reuses
   * verbatim (extracted, never duplicated in a weaker form):
   * the MS6 templateComponents shape rules and the future-date
   * rule for scheduledAt (create + schedule + edit all share
   * the exact messages below).
   */
  private validateTemplateComponents(channel: string, input: unknown): { headerMediaUrl?: string; headerTextParams?: string[]; buttonParams?: { index: number; subType: "url" | "quick_reply"; text?: string; payload?: string }[] } | null {
    if (input == null) return null;
    if (channel !== "whatsapp") throw new BadRequestException("templateComponents is only allowed for WhatsApp broadcasts");
    const tc: any = input;
    if (typeof tc !== "object" || Array.isArray(tc)) throw new BadRequestException("templateComponents must be an object");
    if (tc.headerMediaUrl != null && !/^https?:\/\//i.test(String(tc.headerMediaUrl))) {
      throw new BadRequestException("templateComponents.headerMediaUrl must be an http(s) URL");
    }
    if (tc.headerTextParams != null && (!Array.isArray(tc.headerTextParams) || tc.headerTextParams.some((v: unknown) => typeof v !== "string"))) {
      throw new BadRequestException("templateComponents.headerTextParams must be an array of strings");
    }
    if (tc.buttonParams != null) {
      if (!Array.isArray(tc.buttonParams)) throw new BadRequestException("templateComponents.buttonParams must be an array");
      for (const b of tc.buttonParams as any[]) {
        if (!b || !Number.isInteger(b.index) || b.index < 0) throw new BadRequestException("templateComponents.buttonParams: index must be an integer ≥ 0");
        if (b.subType !== "url" && b.subType !== "quick_reply") throw new BadRequestException('templateComponents.buttonParams: subType must be "url" or "quick_reply"');
      }
    }
    return {
      ...(tc.headerMediaUrl != null ? { headerMediaUrl: String(tc.headerMediaUrl) } : {}),
      ...(Array.isArray(tc.headerTextParams) ? { headerTextParams: tc.headerTextParams.map((v: unknown) => String(v)) } : {}),
      ...(Array.isArray(tc.buttonParams) ? { buttonParams: tc.buttonParams } : {}),
    };
  }

  private parseFutureScheduledAt(value: string): Date {
    const when = new Date(value);
    if (Number.isNaN(when.getTime())) throw new BadRequestException("scheduledAt is not a valid date/time");
    if (when.getTime() <= Date.now()) throw new BadRequestException("scheduledAt must be in the future to schedule a broadcast");
    return when;
  }

  /**
   * MS5 — build the per-recipient personalization vars for a
   * prepared snapshot, from REAL rows only (variables.ts lists
   * exactly these keys per entity):
   *  - customer: a chunked (500) customer lookup for first/last
   *    name, order facts from computeOrderAggregates (frequency)
   *    + computeLastOrders (latest non-cancelled order). No
   *    orders ⇒ ordersCount 0 and EMPTY lastOrder* — never
   *    invented. The aggregate/last-order reads are defensive:
   *    a read failure degrades to the no-orders shape instead of
   *    failing the whole prepare.
   *  - lead: a chunked (500) lead lookup (stage/source/value).
   *  - csv (unmatched): { name: "", address: <the address id> }.
   * Returns an array parallel to `recipients`.
   */
  private async buildSnapshotVars(organizationId: string, recipients: Recipient[]): Promise<Record<string, unknown>[]> {
    const varsList: Record<string, unknown>[] = recipients.map(() => ({}));
    const money = (minor: unknown): string => {
      try { return (Number(BigInt(minor as any)) / 100).toFixed(2); } catch { return ""; }
    };

    const customerIdx = recipients.map((r, i) => ({ r, i })).filter(({ r }) => r.type === "customer" && r.id);
    if (customerIdx.length) {
      const ids = [...new Set(customerIdx.map(({ r }) => r.id!))];
      const customersById = new Map<string, any>();
      try {
        for (let s = 0; s < ids.length; s += 500) {
          const rows: any[] = await (this.prisma as any).customer.findMany({
            where: { organizationId, id: { in: ids.slice(s, s + 500) } },
            select: { id: true, firstName: true, lastName: true },
          });
          for (const c of rows ?? []) customersById.set(c.id, c);
        }
      } catch { /* fall back to the recipient's own fields */ }
      let aggregates = new Map<string, { frequency: number }>();
      try { aggregates = await computeOrderAggregates(this.prisma as any, organizationId); } catch { /* no readable orders ⇒ zero/empty */ }
      let lastOrders = new Map<string, { externalNumber: string | null; totalMinor: string }>();
      try { lastOrders = await computeLastOrders(this.prisma as any, organizationId, ids); } catch { /* same */ }
      for (const { r, i } of customerIdx) {
        const c = customersById.get(r.id!);
        const last = lastOrders.get(r.id!);
        varsList[i] = {
          name: r.name,
          firstName: c?.firstName ?? "",
          lastName: c?.lastName ?? "",
          email: r.email ?? "",
          phone: r.phone ?? "",
          lastOrderNumber: last?.externalNumber ?? "",
          lastOrderTotal: last ? money(last.totalMinor) : "",
          ordersCount: aggregates.get(r.id!)?.frequency ?? 0,
        };
      }
    }

    const leadIdx = recipients.map((r, i) => ({ r, i })).filter(({ r }) => r.type === "lead" && r.id);
    if (leadIdx.length) {
      const ids = [...new Set(leadIdx.map(({ r }) => r.id!))];
      const leadsById = new Map<string, any>();
      try {
        for (let s = 0; s < ids.length; s += 500) {
          const rows: any[] = await (this.prisma as any).lead.findMany({
            where: { organizationId, id: { in: ids.slice(s, s + 500) } },
            select: { id: true, name: true, email: true, phone: true, stage: true, source: true, valueMinor: true },
          });
          for (const l of rows ?? []) leadsById.set(l.id, l);
        }
      } catch { /* fall back to the recipient's own fields */ }
      for (const { r, i } of leadIdx) {
        const l = leadsById.get(r.id!);
        varsList[i] = {
          name: l?.name ?? r.name,
          email: l?.email ?? r.email ?? "",
          phone: l?.phone ?? r.phone ?? "",
          stage: l?.stage ?? "",
          source: l?.source ?? "",
          value: l?.valueMinor !== null && l?.valueMinor !== undefined ? money(l.valueMinor) : "",
        };
      }
    }

    recipients.forEach((r, i) => {
      if (r.type === "csv") varsList[i] = { name: "", address: r.id ?? "" };
    });
    return varsList;
  }

  // ---------- MS1: async send engine ----------

  /**
   * MS1 — prepare: everything the pre-MS1 sendBroadcast checked at
   * send time, now separated so scheduling, the sweep and retries
   * share it. Resolves through the ONE shared resolver (CX10 + MS2
   * stages), applies the deterministic A/B hash split, stamps the
   * recipient snapshot (all pending) and moves the broadcast to
   * "sending". A broadcast that already has a snapshot is never
   * re-prepared (its recipient set is frozen).
   */
  async prepareBroadcast(organizationId: string, broadcastId: string, opts?: { fromSweep?: boolean }) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    // MS10: archived broadcasts never prepare — for the sweep
    // this surfaces as a per-broadcast error in its result,
    // never a silent skip or a send.
    if ((broadcast as any).archivedAt) {
      throw new BadRequestException("This broadcast is archived — unarchive it to send.");
    }
    if (broadcast.status === "cancelled") {
      throw new BadRequestException("This broadcast was cancelled and can never be sent.");
    }
    if (broadcast.status === "sent") {
      throw new BadRequestException("This broadcast was already sent (or is sending). Create a new broadcast to send again.");
    }
    if (broadcast.recipientSnapshot) {
      throw new BadRequestException("This broadcast was already sent (or is sending). Create a new broadcast to send again.");
    }
    if (broadcast.status === "sending" || broadcast.status === "paused") {
      throw new BadRequestException("This broadcast was already sent (or is sending). Create a new broadcast to send again.");
    }
    // MS1 schedule rule (locked): a manual send of a broadcast
    // whose schedule is still in the future is REFUSED — cancel
    // the schedule first (schedule endpoint with null), so a
    // scheduled send can never be fired early by accident. The
    // sweep prepares due broadcasts with fromSweep, and a due
    // (past) schedule no longer blocks a manual send either.
    if (!opts?.fromSweep && broadcast.status === "scheduled" && broadcast.scheduledAt && new Date(broadcast.scheduledAt).getTime() > Date.now()) {
      throw new BadRequestException(`This broadcast is scheduled for ${new Date(broadcast.scheduledAt).toISOString()}. Cancel the schedule to send it now.`);
    }
    const resolved = await this.resolveBroadcastRecipients(organizationId, {
      channel: broadcast.channel, audienceType: broadcast.audienceType,
      audienceStage: broadcast.audienceStage ?? undefined, audienceSegment: broadcast.audienceSegment ?? undefined,
      excludePreviousRecipients: !!broadcast.excludePreviousRecipients,
      excludePastDays: broadcast.excludePastDays ?? undefined,
      excludeOptOut: broadcast.excludeOptOut ?? true,
      audienceDefinition: broadcast.audienceDefinition ?? undefined,
      audienceSavedId: broadcast.audienceSavedId ?? undefined,
      audienceCsv: broadcast.audienceCsv ?? undefined,
    });
    let recipients = resolved.recipients;
    if (broadcast.abGroupId && broadcast.abVariant) {
      // Deterministic split: each recipient belongs to exactly one
      // variant across the whole A/B group.
      const want = broadcast.abVariant === "A" ? 0 : 1;
      recipients = recipients.filter((r) => {
        const key = `${r.type}:${r.id}`;
        let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
        return h % 2 === want;
      });
    }
    const { killSwitches, effectiveLimits } = await import("../common/platform-settings");
    const ks = await killSwitches(this.prisma as any);
    if (ks.broadcastsPaused) {
      throw new BadRequestException("Broadcasts are temporarily paused platform-wide by the platform team (incident mode). Try again later.");
    }
    const baselineCap = Number(process.env.BROADCAST_MAX_RECIPIENTS ?? 1000);
    const { broadcastCap: max } = await effectiveLimits(this.prisma as any, organizationId, { aiDaily: 200, broadcastCap: baselineCap });
    if (recipients.length === 0) {
      const excluded = resolved.excludedPreviousCount + resolved.excludedSuppressedCount + resolved.excludedFrequencyCount + resolved.excludedNoOptInCount;
      throw new BadRequestException(resolved.audienceTotal > 0 && excluded > 0
        ? `Audience is empty after exclusions: ${resolved.audienceTotal} in the audience, ${excluded} excluded (previous recipients ${resolved.excludedPreviousCount}, opted out ${resolved.excludedSuppressedCount}, frequency cap ${resolved.excludedFrequencyCount}, no WhatsApp opt-in ${resolved.excludedNoOptInCount}).`
        : "Audience is empty: no recipients with a usable address for this channel");
    }
    if (recipients.length > max) {
      throw new BadRequestException(`Audience has ${recipients.length} recipients, over the per-send cap of ${max}. Narrow the audience (e.g. a lead stage) instead of silently truncating.`);
    }
    // MS5: real personalization vars per recipient, built AFTER
    // resolution + the A/B split (only the recipients who will
    // actually be sent to get vars).
    const varsList = await this.buildSnapshotVars(organizationId, recipients);
    const snapshot: SnapshotEntry[] = recipients.map((r, i) => ({
      // The resolver never yields a null id (entity rows have
      // ids; a csv recipient's id is its normalized address).
      type: r.type, id: r.id ?? "", name: r.name,
      email: r.email ?? null, phone: r.phone ?? null,
      status: "pending", attempts: 0,
      vars: varsList[i],
    }));
    const updated = await (this.prisma as any).broadcast.update({
      where: { id: broadcastId },
      data: { status: "sending", recipientSnapshot: snapshot, totalRecipients: snapshot.length, sentCount: 0, failedCount: 0 },
    });
    return updated;
  }

  /**
   * MS1 — process: work through pending snapshot entries in
   * chunks of BROADCAST_CHUNK_SIZE. Between chunks the row is
   * re-read: a "paused" row stops the loop leaving the rest
   * pending; a "cancelled" row marks the rest skipped (reason
   * "cancelled") and stays cancelled. Snapshot + counters persist
   * per chunk; counters are DERIVED from the snapshot, so they can
   * never claim more than the deliveries actually recorded.
   * Final-status rule (locked): sent>0 with any failed/skipped ⇒
   * partial; sent>0 alone ⇒ sent; sent=0 ⇒ failed (including a
   * fully-skipped audience — nothing reached anyone).
   */
  async processBroadcast(organizationId: string, broadcastId: string, opts?: { maxEntries?: number; chunkSize?: number }): Promise<{
    status: string; processed: number; sent: number; failed: number; skipped: number; pending: number; finalized: boolean; stopped?: "paused" | "cancelled";
  }> {
    const chunkSize = Math.max(1, opts?.chunkSize ?? BROADCAST_CHUNK_SIZE);
    const maxEntries = opts?.maxEntries ?? Number.POSITIVE_INFINITY;
    const delayMs = Number(process.env.BROADCAST_CHUNK_DELAY_MS ?? 0);
    let broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    let snapshot: SnapshotEntry[] = Array.isArray(broadcast.recipientSnapshot) ? broadcast.recipientSnapshot : [];
    let processed = 0;
    let stopped: "paused" | "cancelled" | undefined;
    // WhatsApp: resolve the sender ONCE for the whole run. A build
    // failure (no connected integration / template gone) becomes
    // an honest per-entry failure below — never a stuck row.
    let waSend: ((entry: SnapshotEntry) => Promise<{ status: "sent" | "failed" | "skipped"; providerMessageId?: string; error?: string; address: string }>) | null = null;
    let waBuildError: string | null = null;
    if (broadcast.channel === "whatsapp") {
      // CC27: the send-time deny re-check keys on the broadcast's
      // CREATING member (recorded on the row at creation).
      try { waSend = await this.createWhatsAppSender(organizationId, broadcast, broadcastId, broadcast.createdById ?? null); }
      catch (e) { waBuildError = e instanceof Error ? e.message : "WhatsApp sender unavailable"; }
    }

    const counts = () => ({
      sent: snapshot.filter((e) => e.status === "sent").length,
      failed: snapshot.filter((e) => e.status === "failed").length,
      skipped: snapshot.filter((e) => e.status === "skipped").length,
      pending: snapshot.filter((e) => e.status === "pending").length,
    });
    const persist = async (status?: string) => {
      const c = counts();
      const data: Record<string, unknown> = { recipientSnapshot: snapshot, sentCount: c.sent, failedCount: c.failed };
      if (status) data.status = status;
      await (this.prisma as any).broadcast.update({ where: { id: broadcastId }, data });
    };

    while (processed < maxEntries) {
      // Re-read between chunks: external pause/cancel lands here.
      const fresh = await this.getBroadcastOrThrow(organizationId, broadcastId);
      if (fresh.status === "paused") { stopped = "paused"; break; }
      if (fresh.status === "cancelled") {
        stopped = "cancelled";
        let changed = false;
        for (const e of snapshot) if (e.status === "pending") { e.status = "skipped"; e.error = "cancelled"; changed = true; }
        if (changed) await persist();
        break;
      }
      if (Array.isArray(fresh.recipientSnapshot)) snapshot = fresh.recipientSnapshot;
      broadcast = fresh;
      const pendingIdx: number[] = [];
      snapshot.forEach((e, i) => { if (e.status === "pending" && processed + pendingIdx.length < maxEntries) pendingIdx.push(i); });
      const chunk = pendingIdx.slice(0, chunkSize);
      if (!chunk.length) break;
      for (const idx of chunk) {
        const entry = snapshot[idx];
        entry.attempts = (entry.attempts ?? 0) + 1;
        const result = broadcast.channel === "whatsapp"
          ? waBuildError
            ? await this.failWhatsAppEntry(organizationId, entry, broadcastId, waBuildError)
            : await waSend!(entry)
          : await this.sendToRecipient(organizationId, {
              channel: broadcast.channel,
              recipient: { type: entry.type, id: entry.id, name: entry.name, email: entry.email, phone: entry.phone },
              subject: broadcast.subject, body: broadcast.body,
              // MS5: the snapshot entry's real vars (pre-MS5
              // entries have none — read defensively as {}).
              vars: entry.vars ?? {},
              htmlBody: broadcast.htmlBody ?? null,
              broadcastId,
            });
        entry.status = result.status;
        entry.address = result.address;
        if (result.providerMessageId) entry.providerMessageId = result.providerMessageId;
        if (result.error) entry.error = result.error; else delete entry.error;
        processed++;
      }
      await persist();
      const morePending = snapshot.some((e) => e.status === "pending");
      if (morePending && delayMs > 0 && processed < maxEntries) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    const c = counts();
    let finalized = false;
    let status = String(broadcast.status ?? "sending");
    if (!stopped && c.pending === 0) {
      status = c.sent > 0 && (c.failed > 0 || c.skipped > 0) ? "partial" : c.sent > 0 ? "sent" : "failed";
      await (this.prisma as any).broadcast.update({
        where: { id: broadcastId },
        data: { status, recipientSnapshot: snapshot, sentCount: c.sent, failedCount: c.failed, sentAt: new Date() },
      });
      finalized = true;
      // MS8: a finalized recurring broadcast chains its next
      // instance here — the ONE place every finalize path
      // (sweep, manual send, resume, retry) flows through.
      // Best-effort: a chain failure must never fail the send
      // that just finished.
      await this.chainRecurrence(organizationId, broadcastId).catch(() => undefined);
    } else if (stopped === "paused") {
      status = "paused";
    } else if (stopped === "cancelled") {
      status = "cancelled";
    }
    return { status, processed, ...c, finalized, ...(stopped ? { stopped } : {}) };
  }

  /**
   * MS8 — chain the next instance of a recurring broadcast.
   * Runs ONLY on finalize (status sent | partial | failed):
   * the next occurrence is computed from THIS instance's
   * original scheduledAt (so the chain never drifts by
   * processing delays; a manual one-off send of a draft anchors
   * on its sentAt instead). The next instance is a FRESH
   * broadcast — same name (no suffix), same content / audience /
   * settings, NO snapshot (its audience re-resolves at its own
   * prepare, so suppression, opt-outs and the frequency cap are
   * evaluated fresh) — created in "scheduled" status holding
   * the recurrence; the finalized row's recurrence is cleared,
   * so exactly ONE pending instance per group ever holds it.
   * A paused or cancelled instance never finalizes, so its
   * chain ends there — documented behaviour, spec-pinned.
   * When no next occurrence exists (endsAt passed) the chain
   * simply ends: the recurrence is still cleared.
   */
  private async chainRecurrence(organizationId: string, broadcastId: string): Promise<void> {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    const raw = (broadcast as any).recurrence;
    if (!raw) return;
    if (!["sent", "partial", "failed"].includes(String(broadcast.status))) return;
    let rec: Recurrence;
    try {
      rec = parseRecurrence(raw);
    } catch {
      // A stored recurrence that no longer parses (hand-edited
      // row): end the chain honestly instead of erroring on
      // every later finalize.
      await (this.prisma as any).broadcast.update({ where: { id: broadcastId }, data: { recurrence: null } }).catch(() => undefined);
      return;
    }
    const anchor = broadcast.scheduledAt
      ? new Date(broadcast.scheduledAt)
      : broadcast.sentAt ? new Date(broadcast.sentAt) : new Date();
    const next = nextOccurrence(rec, anchor);
    const groupId = (broadcast as any).recurrenceGroupId ?? broadcast.id;
    await (this.prisma as any).broadcast.update({ where: { id: broadcastId }, data: { recurrence: null } });
    if (!next) return;
    await (this.prisma as any).broadcast.create({
      data: {
        organizationId, name: broadcast.name, channel: broadcast.channel,
        templateId: broadcast.templateId ?? null,
        whatsappTemplateId: broadcast.whatsappTemplateId ?? null,
        templateParams: broadcast.templateParams ?? undefined,
        templateComponents: broadcast.templateComponents ?? undefined,
        subject: broadcast.subject ?? null, body: broadcast.body, htmlBody: broadcast.htmlBody ?? null,
        audienceType: broadcast.audienceType, audienceStage: broadcast.audienceStage ?? null,
        audienceSegment: broadcast.audienceSegment ?? null,
        audienceDefinition: broadcast.audienceDefinition ?? undefined,
        audienceSavedId: broadcast.audienceSavedId ?? null,
        audienceCsv: broadcast.audienceCsv ?? undefined,
        abVariant: broadcast.abVariant ?? null, abGroupId: broadcast.abGroupId ?? null,
        excludePreviousRecipients: broadcast.excludePreviousRecipients ?? false,
        status: "scheduled", scheduledAt: next,
        recurrence: rec, recurrenceGroupId: groupId,
        createdById: broadcast.createdById,
      },
    });
  }

  /**
   * The existing send endpoint's contract, kept: prepare (when
   * needed) + process to completion synchronously, returning the
   * updated broadcast row — now with the progress the engine
   * tracked. A paused-mid-send broadcast returns in "paused".
   */
  async sendBroadcast(organizationId: string, actorId: string, broadcastId: string) {
    let broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    // MS10: an archived broadcast refuses to send until it is
    // unarchived (prepareBroadcast carries the same guard for
    // the sweep/resume paths that reach the engine without
    // passing through here).
    if ((broadcast as any).archivedAt) {
      throw new BadRequestException("This broadcast is archived — unarchive it to send.");
    }
    if (!broadcast.recipientSnapshot) {
      broadcast = await this.prepareBroadcast(organizationId, broadcastId);
    } else if (broadcast.status === "sent" || broadcast.status === "cancelled") {
      throw new BadRequestException(broadcast.status === "cancelled"
        ? "This broadcast was cancelled and can never be sent."
        : "This broadcast was already sent (or is sending). Create a new broadcast to send again.");
    }
    const result = await this.processBroadcast(organizationId, broadcastId);
    const updated = await this.getBroadcastOrThrow(organizationId, broadcastId);
    await this.audit.log({
      organizationId, userId: actorId, action: "broadcast.send", entityType: "Broadcast", entityId: broadcastId,
      metadata: { channel: updated.channel, total: result.sent + result.failed + result.skipped, sent: result.sent, failed: result.failed, skipped: result.skipped, status: result.status },
    });
    const { recipientSnapshot: _snapshot, ...rest } = updated as any;
    return { ...rest, progress: MessagingService.broadcastProgress(updated) };
  }

  /** MS1 — schedule a draft (or move a schedule). A null time
   * cancels the schedule and returns the broadcast to draft.
   * MS8: `recurrenceInput` (when present in the call) sets,
   * replaces or — as null — clears the broadcast's recurrence
   * alongside the schedule; when absent the stored recurrence
   * is untouched. Cancelling a schedule deliberately does NOT
   * clear a recurrence: the chain simply waits until the
   * broadcast is scheduled or sent again. */
  async scheduleBroadcast(organizationId: string, actorId: string, broadcastId: string, scheduledAt: string | null, recurrenceInput?: unknown) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    // MS10: an archived broadcast refuses scheduling too.
    if ((broadcast as any).archivedAt) {
      throw new BadRequestException("This broadcast is archived — unarchive it to schedule.");
    }
    if (scheduledAt === null) {
      if (broadcast.status !== "scheduled") throw new BadRequestException("Only a scheduled broadcast has a schedule to cancel");
      const updated = await (this.prisma as any).broadcast.update({ where: { id: broadcastId }, data: { status: "draft", scheduledAt: null } });
      await this.audit.log({ organizationId, userId: actorId, action: "broadcast.schedule_cancel", entityType: "Broadcast", entityId: broadcastId, metadata: {} });
      return updated;
    }
    if (broadcast.status !== "draft" && broadcast.status !== "scheduled") {
      throw new BadRequestException(`Only a draft broadcast can be scheduled (this one is ${broadcast.status})`);
    }
    const when = this.parseFutureScheduledAt(scheduledAt);
    const data: Record<string, unknown> = { status: "scheduled", scheduledAt: when };
    if (recurrenceInput !== undefined) {
      if (recurrenceInput === null) {
        data.recurrence = null;
        data.recurrenceGroupId = null;
      } else {
        try { data.recurrence = parseRecurrence(recurrenceInput); }
        catch (e) {
          throw new BadRequestException(e instanceof RecurrenceValidationError ? e.message : "Invalid recurrence");
        }
        data.recurrenceGroupId = (broadcast as any).recurrenceGroupId ?? randomUUID();
      }
    }
    const updated = await (this.prisma as any).broadcast.update({ where: { id: broadcastId }, data });
    await this.audit.log({
      organizationId, userId: actorId, action: "broadcast.schedule", entityType: "Broadcast", entityId: broadcastId,
      metadata: { scheduledAt: when.toISOString(), ...(recurrenceInput !== undefined ? { recurrence: data.recurrence ?? null } : {}) },
    });
    return updated;
  }

  /** MS1 — pause: from "sending" (takes effect between chunks) or
   * "scheduled" (the sweep will skip it until resumed). */
  async pauseBroadcast(organizationId: string, actorId: string, broadcastId: string) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    if (broadcast.status !== "sending" && broadcast.status !== "scheduled") {
      throw new BadRequestException(`Only a sending or scheduled broadcast can be paused (this one is ${broadcast.status})`);
    }
    const updated = await (this.prisma as any).broadcast.update({ where: { id: broadcastId }, data: { status: "paused" } });
    await this.audit.log({ organizationId, userId: actorId, action: "broadcast.pause", entityType: "Broadcast", entityId: broadcastId, metadata: { from: broadcast.status } });
    return updated;
  }

  /** MS1 — resume a paused broadcast. With a snapshot it processes
   * to completion synchronously (the send endpoint's discipline);
   * a paused schedule with no snapshot returns to "scheduled"
   * (or, if its time already passed, sends now). */
  async resumeBroadcast(organizationId: string, actorId: string, broadcastId: string) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    if (broadcast.status !== "paused") throw new BadRequestException(`Only a paused broadcast can be resumed (this one is ${broadcast.status})`);
    await this.audit.log({ organizationId, userId: actorId, action: "broadcast.resume", entityType: "Broadcast", entityId: broadcastId, metadata: {} });
    if (!broadcast.recipientSnapshot) {
      if (broadcast.scheduledAt && new Date(broadcast.scheduledAt).getTime() > Date.now()) {
        return (this.prisma as any).broadcast.update({ where: { id: broadcastId }, data: { status: "scheduled" } });
      }
      return this.sendBroadcast(organizationId, actorId, broadcastId);
    }
    await (this.prisma as any).broadcast.update({ where: { id: broadcastId }, data: { status: "sending" } });
    const result = await this.processBroadcast(organizationId, broadcastId);
    const updated = await this.getBroadcastOrThrow(organizationId, broadcastId);
    const { recipientSnapshot: _snapshot, ...rest } = updated as any;
    return { ...rest, progress: MessagingService.broadcastProgress(updated), resumed: result };
  }

  /** MS1 — cancel: terminal, from draft/scheduled/paused/sending.
   * Pending snapshot entries are marked skipped ("cancelled") so
   * progress tells the truth; a cancelled broadcast can never be
   * sent, prepared or retried. */
  async cancelBroadcast(organizationId: string, actorId: string, broadcastId: string) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    if (!["draft", "scheduled", "paused", "sending"].includes(broadcast.status)) {
      throw new BadRequestException(`A ${broadcast.status} broadcast cannot be cancelled`);
    }
    let snapshot = broadcast.recipientSnapshot;
    if (Array.isArray(snapshot)) {
      snapshot = (snapshot as SnapshotEntry[]).map((e) => (e.status === "pending" ? { ...e, status: "skipped" as const, error: "cancelled" } : e));
    }
    const updated = await (this.prisma as any).broadcast.update({
      where: { id: broadcastId },
      data: { status: "cancelled", ...(snapshot ? { recipientSnapshot: snapshot } : {}) },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "broadcast.cancel", entityType: "Broadcast", entityId: broadcastId, metadata: { from: broadcast.status } });
    return updated;
  }

  /** MS1 — retry ONLY the failed snapshot entries of a finished
   * broadcast. Attempts are kept (they accumulate honestly); the
   * double-send guard is unchanged: a fully-sent broadcast has no
   * failed entries and refuses. */
  async retryFailedBroadcast(organizationId: string, actorId: string, broadcastId: string) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    if (!["sent", "partial", "failed"].includes(broadcast.status)) {
      throw new BadRequestException(`Only a finished broadcast (sent/partial/failed) can retry failures (this one is ${broadcast.status})`);
    }
    const snapshot: SnapshotEntry[] = Array.isArray(broadcast.recipientSnapshot) ? broadcast.recipientSnapshot : [];
    const failedCount = snapshot.filter((e) => e.status === "failed").length;
    if (!failedCount) throw new BadRequestException("This broadcast has no failed recipients to retry");
    const reset = snapshot.map((e) => (e.status === "failed" ? { ...e, status: "pending" as const } : e));
    await (this.prisma as any).broadcast.update({ where: { id: broadcastId }, data: { status: "sending", recipientSnapshot: reset } });
    await this.audit.log({ organizationId, userId: actorId, action: "broadcast.retry_failed", entityType: "Broadcast", entityId: broadcastId, metadata: { retrying: failedCount } });
    const result = await this.processBroadcast(organizationId, broadcastId);
    const updated = await this.getBroadcastOrThrow(organizationId, broadcastId);
    const { recipientSnapshot: _snapshot, ...rest } = updated as any;
    return { ...rest, progress: MessagingService.broadcastProgress(updated), retried: result };
  }

  // ---------- MS10: broadcast management (edit / clone / delete / archive) ----------

  /**
   * MS10 — edit a broadcast. WHY paused is editable: the send
   * path renders AT SEND TIME from the broadcast row —
   * processBroadcast re-reads the row between chunks and passes
   * broadcast.subject/body/htmlBody + the snapshot entry's vars
   * to the sender; the snapshot stores per-recipient VARS only,
   * never rendered text. So editing content on a PAUSED
   * broadcast honestly changes what the REMAINING (pending)
   * recipients receive, and changes nothing already sent. The
   * web's confirm copy says exactly this.
   *
   * Matrix: draft + scheduled → content AND scheduledAt (via
   * the shared future-date rule; null unschedules to draft, the
   * scheduleBroadcast semantics). paused → content only.
   * sending / sent / partial / failed / cancelled → 400 naming
   * the status. Archived → 400 (unarchive first). The channel
   * itself is immutable — a different channel is a different
   * broadcast. All field rules are create's own (shared
   * validators + the same template checks/messages).
   */
  async updateBroadcast(organizationId: string, actorId: string, broadcastId: string, dto: {
    name?: string; subject?: string | null; body?: string; htmlBody?: string | null;
    templateId?: string | null; whatsappTemplateId?: string; templateParams?: string[];
    templateComponents?: unknown; scheduledAt?: string | null;
  }) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    if ((broadcast as any).archivedAt) {
      throw new BadRequestException("This broadcast is archived — unarchive it before editing.");
    }
    if (!["draft", "scheduled", "paused"].includes(broadcast.status)) {
      throw new BadRequestException(`A ${broadcast.status} broadcast cannot be edited (only draft, scheduled or paused)`);
    }
    const channel: string = broadcast.channel;
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) throw new BadRequestException("Broadcast name is required");
      data.name = name;
    }
    if (dto.scheduledAt !== undefined) {
      if (broadcast.status === "paused") {
        throw new BadRequestException("A paused broadcast's schedule cannot be changed here — resume or cancel it instead");
      }
      if (dto.scheduledAt === null) {
        if (broadcast.status === "scheduled") {
          data.status = "draft";
          data.scheduledAt = null;
        } else {
          // Draft + null: already unscheduled — a harmless
          // no-op, not an error (the edit form always sends the
          // field).
          data.scheduledAt = null;
        }
      } else {
        data.scheduledAt = this.parseFutureScheduledAt(dto.scheduledAt);
        data.status = "scheduled";
      }
    }
    if (channel === "whatsapp") {
      if (dto.templateId !== undefined || dto.subject !== undefined || dto.htmlBody !== undefined) {
        throw new BadRequestException("WhatsApp broadcasts have no subject/htmlBody/templateId — edit the WhatsApp template fields instead");
      }
      if (dto.whatsappTemplateId !== undefined && dto.whatsappTemplateId !== broadcast.whatsappTemplateId) {
        const tpl = await (this.prisma as any).whatsAppTemplate.findFirst({ where: { id: dto.whatsappTemplateId, organizationId } });
        if (!tpl) throw new NotFoundException("WhatsApp template not found in this organization");
        data.whatsappTemplateId = tpl.id;
        // Create derives the stored body from the template —
        // an edit that swaps the template does the same.
        data.body = tpl.bodyText ?? `[WhatsApp template: ${tpl.name}]`;
      }
      if (dto.templateParams !== undefined) {
        if (!Array.isArray(dto.templateParams) || dto.templateParams.some((v) => typeof v !== "string")) {
          throw new BadRequestException("templateParams must be an array of strings");
        }
        data.templateParams = dto.templateParams;
      }
      if (dto.templateComponents !== undefined) {
        data.templateComponents = this.validateTemplateComponents(channel, dto.templateComponents);
      }
      if (dto.body !== undefined) {
        throw new BadRequestException("WhatsApp broadcast body comes from its template — change the template instead of the body");
      }
    } else {
      if (dto.whatsappTemplateId !== undefined || dto.templateComponents !== undefined) {
        throw new BadRequestException("whatsappTemplateId/templateComponents are only for WhatsApp broadcasts");
      }
      if (dto.templateId !== undefined) {
        if (dto.templateId === null) {
          data.templateId = null;
        } else {
          // Create's exact checks: the template must exist in
          // this org and its channel must match.
          const template = await this.getTemplate(organizationId, dto.templateId);
          if (template.channel !== channel) throw new BadRequestException("Template channel does not match the broadcast channel");
          data.templateId = template.id;
        }
      }
      if (dto.subject !== undefined) data.subject = dto.subject;
      if (dto.body !== undefined) data.body = dto.body;
      if (dto.htmlBody !== undefined) {
        // MS5's rule, shared with create: HTML is email-only.
        if (dto.htmlBody && channel !== "email") throw new BadRequestException("htmlBody is only allowed for email broadcasts (SMS/WhatsApp have no HTML part)");
        data.htmlBody = dto.htmlBody;
      }
    }
    // Create's closing invariants, evaluated on the MERGED row:
    // a body is always required, and email always needs a
    // subject — an edit may not hollow a broadcast out.
    const mergedBody = data.body !== undefined ? data.body : broadcast.body;
    if (!mergedBody) throw new BadRequestException("Broadcast body is required (write one or choose a template)");
    const mergedSubject = data.subject !== undefined ? data.subject : broadcast.subject;
    if (channel === "email" && !mergedSubject) throw new BadRequestException("Email broadcasts need a subject");
    const updated = await (this.prisma as any).broadcast.update({ where: { id: broadcastId }, data });
    await this.audit.log({
      organizationId, userId: actorId, action: "broadcast.update", entityType: "Broadcast", entityId: broadcastId,
      metadata: { fields: Object.keys(data), status: broadcast.status },
    });
    const { recipientSnapshot: _snapshot, ...rest } = updated as any;
    return { ...rest, progress: MessagingService.broadcastProgress(updated) };
  }

  /**
   * MS10 — clone a broadcast into a NEW draft. Content and
   * audience are copied (the chainRecurrence field list is the
   * precedent); the send state is NOT: no snapshot, no counters,
   * no deliveries, no schedule, no recurrence. An A/B variant
   * clones as a SINGLE normal draft (never half a pair) — the
   * response says so when the source was a variant.
   */
  async cloneBroadcast(organizationId: string, actorId: string, broadcastId: string) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    const clone = await (this.prisma as any).broadcast.create({
      data: {
        organizationId, name: `${broadcast.name} (কপি)`, channel: broadcast.channel,
        templateId: broadcast.templateId ?? null,
        whatsappTemplateId: broadcast.whatsappTemplateId ?? null,
        templateParams: broadcast.templateParams ?? undefined,
        templateComponents: broadcast.templateComponents ?? undefined,
        subject: broadcast.subject ?? null, body: broadcast.body, htmlBody: broadcast.htmlBody ?? null,
        audienceType: broadcast.audienceType, audienceStage: broadcast.audienceStage ?? null,
        audienceSegment: broadcast.audienceSegment ?? null,
        audienceDefinition: broadcast.audienceDefinition ?? undefined,
        audienceSavedId: broadcast.audienceSavedId ?? null,
        audienceCsv: broadcast.audienceCsv ?? undefined,
        excludePreviousRecipients: broadcast.excludePreviousRecipients ?? false,
        status: "draft", createdById: actorId,
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "broadcast.clone", entityType: "Broadcast", entityId: clone.id,
      metadata: { clonedFrom: broadcastId, sourceStatus: broadcast.status },
    });
    return {
      ...clone,
      clonedFrom: broadcastId,
      ...(broadcast.abVariant
        ? { cloneNote: "A/B জুটির একটি Variant কপি হয়েছে — কপিটি একক সাধারণ Draft, A/B জুটি নয়।" }
        : {}),
    };
  }

  /**
   * MS10 — delete a broadcast. Only draft/cancelled: a sent
   * broadcast's row anchors its delivery history, so the
   * sent-family refuses and points at archive instead. (The
   * delivery rows themselves survive with broadcastId nulled —
   * the schema's onDelete: SetNull.)
   */
  async deleteBroadcast(organizationId: string, actorId: string, broadcastId: string) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    if (!["draft", "cancelled"].includes(broadcast.status)) {
      throw new BadRequestException(`A ${broadcast.status} broadcast cannot be deleted — only draft or cancelled broadcasts can. Archive it instead to keep its delivery history.`);
    }
    await (this.prisma as any).broadcast.delete({ where: { id: broadcastId } });
    await this.audit.log({
      organizationId, userId: actorId, action: "broadcast.delete", entityType: "Broadcast", entityId: broadcastId,
      metadata: { name: broadcast.name, status: broadcast.status },
    });
    return { deleted: true, id: broadcastId };
  }

  /**
   * MS10 — archive / unarchive. Archiving hides the broadcast
   * from the default list and blocks send/schedule until it is
   * unarchived (the guards live in sendBroadcast /
   * prepareBroadcast / scheduleBroadcast). A broadcast that is
   * mid-send cannot be archived — pause or let it finish first.
   */
  async setBroadcastArchived(organizationId: string, actorId: string, broadcastId: string, archived: boolean) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    if (archived && broadcast.status === "sending") {
      throw new BadRequestException("A broadcast that is sending cannot be archived — pause it or let it finish first");
    }
    const updated = await (this.prisma as any).broadcast.update({
      where: { id: broadcastId },
      data: { archivedAt: archived ? new Date() : null },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: archived ? "broadcast.archive" : "broadcast.unarchive",
      entityType: "Broadcast", entityId: broadcastId, metadata: { status: broadcast.status },
    });
    const { recipientSnapshot: _snapshot, ...rest } = updated as any;
    return { ...rest, progress: MessagingService.broadcastProgress(updated) };
  }

  /**
   * MS1 — the broadcast_send_sweep body: (a) start due scheduled
   * broadcasts, (b) recover stale "sending" rows (updatedAt older
   * than BROADCAST_STALE_MS — a crashed request/process). Each
   * broadcast gets at most BROADCAST_SWEEP_MAX_ENTRIES per run and
   * simply stays "sending" for the next run when more remain.
   * Per-broadcast failures are reported, never hidden, and never
   * stop the other broadcasts.
   */
  async runDueBroadcasts(organizationId: string): Promise<{
    started: number; recovered: number; processed: number; finalized: number;
    errors: { broadcastId: string; error: string }[];
  }> {
    const out = { started: 0, recovered: 0, processed: 0, finalized: 0, errors: [] as { broadcastId: string; error: string }[] };
    const now = new Date();
    const due: any[] = await (this.prisma as any).broadcast.findMany({
      where: { organizationId, status: "scheduled", scheduledAt: { lte: now } },
      orderBy: { scheduledAt: "asc" }, take: 10,
    }).catch(() => []);
    for (const b of due) {
      try {
        if (!b.recipientSnapshot) await this.prepareBroadcast(organizationId, b.id, { fromSweep: true });
        const r = await this.processBroadcast(organizationId, b.id, { maxEntries: BROADCAST_SWEEP_MAX_ENTRIES });
        out.started++; out.processed += r.processed; if (r.finalized) out.finalized++;
        await this.audit.log({ organizationId, userId: "system", action: "broadcast.sweep_send", entityType: "Broadcast", entityId: b.id, metadata: { kind: "scheduled", processed: r.processed, status: r.status } }).catch(() => undefined);
      } catch (e) {
        out.errors.push({ broadcastId: b.id, error: e instanceof Error ? e.message : "Sweep send failed" });
      }
    }
    const staleBefore = new Date(Date.now() - BROADCAST_STALE_MS);
    const stale: any[] = await (this.prisma as any).broadcast.findMany({
      where: { organizationId, status: "sending", updatedAt: { lt: staleBefore } },
      orderBy: { updatedAt: "asc" }, take: 10,
    }).catch(() => []);
    for (const b of stale) {
      try {
        const r = await this.processBroadcast(organizationId, b.id, { maxEntries: BROADCAST_SWEEP_MAX_ENTRIES });
        out.recovered++; out.processed += r.processed; if (r.finalized) out.finalized++;
        await this.audit.log({ organizationId, userId: "system", action: "broadcast.sweep_send", entityType: "Broadcast", entityId: b.id, metadata: { kind: "recovery", processed: r.processed, status: r.status } }).catch(() => undefined);
      } catch (e) {
        out.errors.push({ broadcastId: b.id, error: e instanceof Error ? e.message : "Sweep recovery failed" });
      }
    }
    return out;
  }

  /**
   * MS1 — builds the per-recipient WhatsApp sender for one
   * processBroadcast run (integration + template resolved ONCE,
   * not per recipient). A build failure throws BEFORE any send;
   * processBroadcast turns that into an honest per-entry failure
   * for every pending entry instead of a stuck "sending" row.
   * Each send counts "sent" only with a Meta message id, and the
   * MS2 suppression guard applies here too (sendToRecipient's
   * guard covers email/sms only — WhatsApp sends through Meta).
   */
  private async createWhatsAppSender(organizationId: string, broadcast: any, broadcastId: string, denyActorId?: string | null) {
    const integration = await (this.prisma as any).integration.findFirst({
      where: { organizationId, provider: "whatsapp", status: "CONNECTED" }, include: { credential: true },
    });
    if (!integration?.credential) throw new BadRequestException("No connected WhatsApp integration for this organization");
    // CC27: send-time deny re-check. A WhatsApp broadcast resolves
    // to THIS WhatsApp Integration — a connection target — so the
    // CREATING member's deny-list is re-checked here, at send
    // time (the sweep may run long after creation; a deny granted
    // in between must stop the send). The throw lands in
    // processBroadcast's build-error path: every pending entry is
    // recorded failed with this reason — the path's native
    // failure record — and nothing is sent. SMS/Email broadcasts
    // send through MessagingSenderConfig rows, which are NOT
    // connection targets, so they carry no deny gate (documented
    // in the B12 acceptance; no mapping is invented for them).
    if (denyActorId && await isMemberConnectionDenied(this.prisma as any, organizationId, denyActorId, integration.id)) {
      throw new ForbiddenException("এই WhatsApp অ্যাকাউন্টে ব্রডকাস্ট পাঠানোর অনুমতি ব্রডকাস্টের লেখককে দেওয়া হয়নি — Connect Center-এর অ্যাক্সেস সেটিংসে তার এই কানেকশনের অনুমতি প্রত্যাহার করা হয়েছে।");
    }
    const template = await (this.prisma as any).whatsAppTemplate.findFirst({ where: { id: broadcast.whatsappTemplateId, organizationId } });
    if (!template) throw new NotFoundException("WhatsApp template not found");
    const secrets = decryptJson(integration.credential.encryptedData) as any;
    const client = new MetaMessagingClient({ accessToken: secrets.accessToken, phoneNumberId: secrets.phoneNumberId });
    const paramsTemplate: string[] = Array.isArray(broadcast.templateParams) ? broadcast.templateParams : [];
    return async (entry: SnapshotEntry): Promise<{ status: "sent" | "failed" | "skipped"; providerMessageId?: string; error?: string; address: string }> => {
      const recipient: Recipient = { type: entry.type, id: entry.id, name: entry.name, email: entry.email, phone: entry.phone };
      const normalized = normalizeBdPhone(entry.phone ?? "") ?? normalizePhoneGeneric(entry.phone ?? "");
      const address = normalized ?? (entry.phone ?? "");
      const optOut = await this.findOptOut(organizationId, "whatsapp", recipientPrefAddress("whatsapp", recipient));
      if (optOut) {
        const error = `Recipient opted out (${optOut.source})`;
        await this.recordDelivery(organizationId, { channel: "whatsapp", recipient, broadcastId }, address, "skipped", undefined, error);
        return { status: "skipped", error, address };
      }
      try {
        if (!normalized) throw new Error(`Phone number cannot be normalized for WhatsApp: ${entry.phone || "(empty)"}`);
        // MS5: {name} keeps its exact behaviour; additionally any
        // {key} present in the entry's real vars is substituted.
        const substitute = (p: unknown): string => {
          let out = String(p).replaceAll("{name}", entry.name);
          for (const [key, value] of Object.entries(entry.vars ?? {})) {
            out = out.replaceAll(`{${key}}`, value === null || value === undefined ? "" : String(value));
          }
          return out;
        };
        const params = paramsTemplate.map(substitute);
        // MS6: rich params from the broadcast's stored
        // templateComponents. A media URL is sent as an IMAGE
        // header (templates whose header is video/document are
        // out of scope for this field). Header text params and
        // button text/payload get the same per-recipient
        // substitution as the body params. Rich is passed ONLY
        // when at least one part exists, so legacy broadcasts
        // keep byte-identical send bodies.
        const tc: any = (broadcast as any).templateComponents ?? null;
        let rich: { headerTextParams?: string[]; headerMedia?: { kind: "image"; link: string }; buttonParams?: { index: number; subType: "url" | "quick_reply"; text?: string; payload?: string }[] } | undefined;
        if (tc && typeof tc === "object") {
          const built: NonNullable<typeof rich> = {};
          if (tc.headerMediaUrl) built.headerMedia = { kind: "image", link: String(tc.headerMediaUrl) };
          if (Array.isArray(tc.headerTextParams) && tc.headerTextParams.length) {
            built.headerTextParams = tc.headerTextParams.map(substitute);
          }
          if (Array.isArray(tc.buttonParams) && tc.buttonParams.length) {
            built.buttonParams = tc.buttonParams.map((b: any) => ({
              index: b.index, subType: b.subType,
              ...(b.text != null ? { text: substitute(b.text) } : {}),
              ...(b.payload != null ? { payload: substitute(b.payload) } : {}),
            }));
          }
          if (built.headerMedia || built.headerTextParams || built.buttonParams) rich = built;
        }
        const { messageId } = await client.sendWhatsAppTemplate(normalized, template.name, template.language, params, rich);
        await this.recordDelivery(organizationId, { channel: "whatsapp", recipient, broadcastId }, address, "sent", messageId);
        return { status: "sent", providerMessageId: messageId, address };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Send failed";
        await this.recordDelivery(organizationId, { channel: "whatsapp", recipient, broadcastId }, address, "failed", undefined, message);
        return { status: "failed", error: message, address };
      }
    };
  }

  /** A WhatsApp entry whose sender could not be built at all
   * (no connected integration / template missing): recorded as a
   * failed delivery with the verbatim build error. */
  private async failWhatsAppEntry(organizationId: string, entry: SnapshotEntry, broadcastId: string, error: string): Promise<{ status: "failed"; providerMessageId?: string; error: string; address: string }> {
    const recipient: Recipient = { type: entry.type, id: entry.id, name: entry.name, email: entry.email, phone: entry.phone };
    const address = normalizeBdPhone(entry.phone ?? "") ?? normalizePhoneGeneric(entry.phone ?? "") ?? (entry.phone ?? "");
    await this.recordDelivery(organizationId, { channel: "whatsapp", recipient, broadcastId }, address, "failed", undefined, error);
    return { status: "failed" as const, error, address };
  }

  /**
   * Deliveries of one broadcast.
   * LEGACY mode (no opts argument — every pre-MS7 caller): the
   * bare array, newest first, take 200 — byte-unchanged
   * behaviour. The controller preserves this exactly: it passes
   * opts only when a filter query param is present.
   * PAGED mode (opts given): filter by send status and/or an
   * address substring, cursor-paginated (cursor = createdAt +
   * id, page size 50) returning { items, nextCursor } (IN9
   * precedent).
   */
  async listDeliveries(organizationId: string, broadcastId: string, opts?: { status?: string; q?: string; cursor?: string }) {
    if (!opts) {
      return (this.prisma as any).messageDelivery.findMany({
        where: { organizationId, broadcastId }, orderBy: { createdAt: "desc" }, take: 200,
      });
    }
    const pageSize = 50;
    const where: Record<string, unknown> = { organizationId, broadcastId };
    if (opts.status) where.status = opts.status;
    if (opts.q) where.address = { contains: opts.q };
    if (opts.cursor) {
      try {
        const after = JSON.parse(Buffer.from(opts.cursor, "base64url").toString("utf8")) as { c?: string; i?: string };
        if (after.c && after.i) {
          where.OR = [
            { createdAt: { lt: new Date(after.c) } },
            { createdAt: new Date(after.c), id: { lt: after.i } },
          ];
        }
      } catch { /* a malformed cursor restarts from the first page */ }
    }
    const rows: any[] = await (this.prisma as any).messageDelivery.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: pageSize + 1,
    });
    const items = rows.slice(0, pageSize);
    const last = items[items.length - 1];
    const nextCursor = rows.length > pageSize && last
      ? Buffer.from(JSON.stringify({ c: new Date(last.createdAt).toISOString(), i: last.id })).toString("base64url")
      : null;
    return { items, nextCursor };
  }

  /**
   * MS7 — audited CSV export of a broadcast's deliveries (IN10
   * export discipline, following exportPreferencesCsv). Walks
   * the deliveries in id order in chunks of 1000, capped at
   * 10000 rows; when more rows exist beyond the cap the file
   * starts with an honest "# truncated" marker line instead of
   * silently ending.
   */
  async exportDeliveriesCsv(organizationId: string, actorId: string, broadcastId: string): Promise<string> {
    await this.getBroadcastOrThrow(organizationId, broadcastId);
    const CAP = 10000;
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines: string[] = [];
    let total = 0;
    let truncated = false;
    let lastId: string | undefined;
    for (;;) {
      const rows: any[] = await (this.prisma as any).messageDelivery.findMany({
        where: { organizationId, broadcastId, ...(lastId ? { id: { gt: lastId } } : {}) },
        orderBy: { id: "asc" }, take: 1000,
      });
      if (!rows.length) break;
      for (const r of rows) {
        if (total >= CAP) { truncated = true; break; }
        lines.push([r.address, r.channel, r.status, r.deliveryStatus ?? "", r.providerMessageId ?? "", r.error ?? "", r.createdAt ? new Date(r.createdAt).toISOString() : ""].map(esc).join(","));
        total++;
        lastId = r.id;
      }
      if (truncated || rows.length < 1000) break;
    }
    if (!truncated && total >= CAP && lastId) {
      // Exactly at the cap: probe whether anything remains.
      const more = await (this.prisma as any).messageDelivery.findFirst({
        where: { organizationId, broadcastId, id: { gt: lastId } }, select: { id: true },
      }).catch(() => null);
      if (more) truncated = true;
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "broadcast.deliveries_export",
      entityType: "Broadcast", entityId: broadcastId, metadata: { rows: total, truncated },
    });
    const header = "address,channel,status,deliveryStatus,providerMessageId,error,createdAt";
    const marker = truncated ? `# truncated: প্রথম ${CAP}টি রেকর্ড দেওয়া হয়েছে — আরও ডেলিভারি বাকি আছে\n` : "";
    return marker + header + (lines.length ? `\n${lines.join("\n")}` : "");
  }

  // ---------- MS7: post-send delivery lifecycle ----------

  /**
   * A WhatsApp status webhook for a message that is NOT an inbox
   * ChannelMessage may belong to a broadcast delivery (matched
   * by the Meta message id stored in providerMessageId). Called
   * best-effort from the inbox webhook path — every failure is
   * swallowed here AND by the caller, so a pre-migration
   * database (no MS7 columns) or a missing delivery can never
   * break webhook processing (IN6 precedent).
   *
   * Monotonic rule (pinned by the ms7 spec): delivered(1) <
   * read(2); an update applies only when it strengthens the
   * current state, and "read" also stamps deliveredAt when
   * absent. "failed" applies ONLY from the untouched (null)
   * state — a failed arriving after a confirmed delivery/read
   * never erases deliveredAt/readAt, and once failed, later
   * delivered/read are ignored (Meta's failed is terminal for
   * that message). "sent" carries no lifecycle information (the
   * send outcome already recorded it) and is ignored. The send
   * outcome `status` is NEVER touched — MS1's final-status math
   * is unaffected.
   */
  async applyWhatsAppDeliveryStatus(organizationId: string, externalId: string, status: string, error?: string): Promise<{ applied: boolean }> {
    try {
      if (!externalId || !["delivered", "read", "failed"].includes(status)) return { applied: false };
      const delivery = await (this.prisma as any).messageDelivery.findFirst({
        where: { organizationId, providerMessageId: externalId, channel: "whatsapp", broadcastId: { not: null } },
      });
      if (!delivery) return { applied: false };
      const rank = (s: string | null | undefined) => (s === "read" ? 2 : s === "delivered" ? 1 : 0);
      const current: string | null = delivery.deliveryStatus ?? null;
      const now = new Date();
      if (status === "failed") {
        if (current !== null) return { applied: false };
        await (this.prisma as any).messageDelivery.update({
          where: { id: delivery.id },
          data: { deliveryStatus: "failed", ...(error ? { error } : {}) },
        });
        return { applied: true };
      }
      if (current === "failed") return { applied: false };
      if (rank(status) <= rank(current)) return { applied: false };
      const data: Record<string, unknown> = { deliveryStatus: status };
      if (status === "delivered") data.deliveredAt = delivery.deliveredAt ?? now;
      if (status === "read") {
        data.readAt = delivery.readAt ?? now;
        data.deliveredAt = delivery.deliveredAt ?? now;
      }
      await (this.prisma as any).messageDelivery.update({ where: { id: delivery.id }, data });
      return { applied: true };
    } catch {
      return { applied: false };
    }
  }

  /**
   * The open pixel endpoint's write side. A verified token
   * stamps openedAt on the matching broadcast delivery — first
   * hit only; repeat opens never move the timestamp. The
   * delivery is found by walking the broadcast's deliveries and
   * deriving each row's key with the SAME rule the send used
   * (see deliveryRecipientKey) — exact for email, the only
   * channel with a pixel. A token whose delivery no longer
   * exists writes nothing and still succeeds (the pixel must
   * never error in a mail client); a BAD token throws 400
   * before any write (the controller then serves no image).
   */
  async performOpenTracking(token: string): Promise<{ ok: boolean }> {
    const payload = verifyOpenToken(token);
    if (!payload) throw new BadRequestException("এই ট্র্যাকিং পিক্সেলটি অবৈধ বা মেয়াদোত্তীর্ণ।");
    let lastId: string | undefined;
    for (let guard = 0; guard < 40; guard++) {
      const rows: any[] = await (this.prisma as any).messageDelivery.findMany({
        where: { organizationId: payload.orgId, broadcastId: payload.broadcastId, ...(lastId ? { id: { gt: lastId } } : {}) },
        orderBy: { id: "asc" }, take: 500,
      }).catch(() => []);
      if (!rows.length) break;
      const match = rows.find((d) => deliveryRecipientKey(d) === payload.recipientKey);
      if (match) {
        if (!match.openedAt) {
          await (this.prisma as any).messageDelivery.update({
            where: { id: match.id }, data: { openedAt: new Date() },
          }).catch(() => undefined);
        }
        return { ok: true };
      }
      lastId = rows[rows.length - 1].id;
      if (rows.length < 500) break;
    }
    return { ok: true };
  }

  /** Walk ALL delivery rows of a broadcast in id order (chunked,
   * capped at 20000 rows — far above the 5000-recipient plan cap
   * plus retries) for report aggregation. */
  private async walkDeliveries(organizationId: string, broadcastId: string): Promise<any[]> {
    const out: any[] = [];
    let lastId: string | undefined;
    while (out.length < 20000) {
      const rows: any[] = await (this.prisma as any).messageDelivery.findMany({
        where: { organizationId, broadcastId, ...(lastId ? { id: { gt: lastId } } : {}) },
        orderBy: { id: "asc" }, take: 1000,
      }).catch(() => []);
      if (!rows.length) break;
      out.push(...rows);
      lastId = rows[rows.length - 1].id;
      if (rows.length < 1000) break;
    }
    return out;
  }

  /**
   * MS7 — one broadcast's funnel + failure reasons. Counts are
   * PER RECIPIENT: sent/failed/skipped come from the snapshot
   * progress (the authoritative per-recipient truth — retries
   * write extra delivery ROWS and must not double-count), while
   * delivered/read/opened aggregate the delivery rows' lifecycle
   * fields by recipient key. A stage the channel cannot produce
   * is null, NEVER 0:
   *  - delivered/read: WhatsApp webhooks only. Email over SMTP
   *    has no delivery signal; platform SMS has no documented
   *    DLR query API (verify-first outcome (c) — see the B4
   *    acceptance), and tenant-gateway DLR is out of scope.
   *  - opened: HTML email broadcasts only (the pixel); a
   *    text-only broadcast honestly reports null.
   *  - clicked: link tracking wraps broadcast email/SMS links
   *    only — WhatsApp template links are Meta-side, never
   *    wrapped, so WhatsApp clicks are null, not 0.
   */
  private async broadcastFunnel(organizationId: string, broadcast: any) {
    const progress = MessagingService.broadcastProgress(broadcast);
    const deliveries = await this.walkDeliveries(organizationId, broadcast.id);
    const deliveredKeys = new Set<string>();
    const readKeys = new Set<string>();
    const openedKeys = new Set<string>();
    const failedErrors: (string | null)[] = [];
    for (const d of deliveries) {
      if (d.status === "failed") failedErrors.push(d.error ?? null);
      if (d.status !== "sent") continue;
      const key = deliveryRecipientKey(d);
      if (d.deliveryStatus === "delivered" || d.deliveryStatus === "read" || d.deliveredAt) deliveredKeys.add(key);
      if (d.deliveryStatus === "read" || d.readAt) readKeys.add(key);
      if (d.openedAt) openedKeys.add(key);
    }
    let totalClicks = 0;
    const clickedKeys = new Set<string>();
    {
      let lastId: string | undefined;
      for (let guard = 0; guard < 40; guard++) {
        const clicks: any[] = await (this.prisma as any).messageLinkClick.findMany({
          where: { organizationId, broadcastId: broadcast.id, ...(lastId ? { id: { gt: lastId } } : {}) },
          orderBy: { id: "asc" }, take: 1000,
        }).catch(() => []);
        if (!clicks.length) break;
        for (const c of clicks) { totalClicks++; clickedKeys.add(c.recipientKey); }
        lastId = clicks[clicks.length - 1].id;
        if (clicks.length < 1000) break;
      }
    }
    const channel = String(broadcast.channel);
    return {
      audience: progress.total,
      sent: progress.sent,
      failed: progress.failed,
      skipped: progress.skipped,
      delivered: channel === "whatsapp" ? deliveredKeys.size : null,
      read: channel === "whatsapp" ? readKeys.size : null,
      opened: channel === "email" && broadcast.htmlBody ? openedKeys.size : null,
      clickedRecipients: channel === "whatsapp" ? null : clickedKeys.size,
      totalClicks: channel === "whatsapp" ? null : totalClicks,
      failureReasons: groupFailureReasons(failedErrors),
    };
  }

  /**
   * MS7 — revenue ASSOCIATION (never claimed causation): real
   * Order rows of the snapshot's CUSTOMER recipients created in
   * the 7 days after the broadcast was sent. Cancelled and
   * practice orders are excluded. csv/lead recipients have no
   * customer orders and are excluded by construction — the
   * method label in the payload says exactly what was counted.
   * Null when the broadcast was never sent (no window exists).
   */
  private async broadcastRevenue(organizationId: string, broadcast: any) {
    const method = "প্রাপক কাস্টমারদের পাঠানোর পর ৭ দিনের অর্ডার (সম্পর্ক, কারণের প্রমাণ নয়)";
    if (!broadcast.sentAt) return null;
    const snapshot: SnapshotEntry[] = Array.isArray(broadcast.recipientSnapshot) ? broadcast.recipientSnapshot : [];
    const customerIds = [...new Set(snapshot.filter((e) => e.type === "customer" && e.id).map((e) => e.id))];
    const start = new Date(broadcast.sentAt);
    const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
    let orders = 0;
    let total = BigInt(0);
    for (let s = 0; s < customerIds.length; s += 500) {
      const rows: any[] = await (this.prisma as any).order.findMany({
        where: {
          organizationId, customerId: { in: customerIds.slice(s, s + 500) },
          createdAt: { gte: start, lt: end }, status: { not: "cancelled" }, isPractice: false,
        },
        select: { totalMinor: true },
      }).catch(() => []);
      for (const o of rows ?? []) {
        orders++;
        try { total += BigInt(o.totalMinor ?? 0); }
        catch { total += BigInt(Math.trunc(Number(o.totalMinor ?? 0)) || 0); }
      }
    }
    return { windowDays: 7, orders, totalMinor: total.toString(), customerRecipients: customerIds.length, method };
  }

  /**
   * MS7 — replies: WhatsApp conversations of snapshot
   * recipients (matched by normalized phone against
   * ChannelConversation.externalContactId) holding at least one
   * inbound message after the broadcast was sent. Counted per
   * conversation. Other channels have no such signal in this
   * system, so the count is null rather than invented.
   */
  private async broadcastReplies(organizationId: string, broadcast: any) {
    const method = "পাঠানোর পর প্রাপকদের WhatsApp কথোপকথনে আসা ইনবাউন্ড জবাব — ফোন নম্বর (externalContactId) মিলিয়ে গোনা";
    if (broadcast.channel !== "whatsapp" || !broadcast.sentAt) return { count: null, method };
    const snapshot: SnapshotEntry[] = Array.isArray(broadcast.recipientSnapshot) ? broadcast.recipientSnapshot : [];
    const phones = [...new Set(snapshot
      .map((e) => normalizeBdPhone(e.phone ?? "") ?? normalizePhoneGeneric(e.phone ?? "") ?? (e.phone ?? ""))
      .filter(Boolean))];
    const conversationIds: string[] = [];
    for (let s = 0; s < phones.length; s += 500) {
      const rows: any[] = await (this.prisma as any).channelConversation.findMany({
        where: { organizationId, channel: "whatsapp", externalContactId: { in: phones.slice(s, s + 500) } },
        select: { id: true },
      }).catch(() => []);
      for (const r of rows ?? []) conversationIds.push(r.id);
    }
    const replied = new Set<string>();
    for (let s = 0; s < conversationIds.length; s += 200) {
      const rows: any[] = await (this.prisma as any).channelMessage.findMany({
        where: { conversationId: { in: conversationIds.slice(s, s + 200) }, direction: "in", createdAt: { gt: new Date(broadcast.sentAt) } },
        select: { conversationId: true },
      }).catch(() => []);
      for (const r of rows ?? []) replied.add(r.conversationId);
    }
    return { count: replied.size, method };
  }

  /** MS7 — the per-broadcast report: funnel, normalized failure
   * reasons, labelled revenue association + WhatsApp replies,
   * and (for A/B broadcasts) both variants' funnels with the
   * winner SUGGESTION — a suggestion only; nothing auto-sends
   * or auto-picks, ever. */
  async getBroadcastReport(organizationId: string, broadcastId: string) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    const funnel = await this.broadcastFunnel(organizationId, broadcast);
    const revenue = await this.broadcastRevenue(organizationId, broadcast);
    const replies = await this.broadcastReplies(organizationId, broadcast);
    let ab: { groupId: string; variants: Record<string, unknown>; suggestion: unknown } | null = null;
    if (broadcast.abGroupId) {
      const rows: any[] = await (this.prisma as any).broadcast.findMany({
        where: { organizationId, abGroupId: broadcast.abGroupId }, orderBy: { abVariant: "asc" },
      }).catch(() => []);
      const variants: Record<string, unknown> = {};
      const lite: Record<string, { sent: number; read: number | null; clickedRecipients: number | null }> = {};
      for (const v of rows) {
        const f = v.id === broadcast.id ? funnel : await this.broadcastFunnel(organizationId, v);
        variants[String(v.abVariant ?? "")] = f;
        lite[String(v.abVariant ?? "")] = { sent: f.sent, read: f.read, clickedRecipients: f.clickedRecipients };
      }
      ab = {
        groupId: broadcast.abGroupId,
        variants,
        suggestion: abSuggestion({ A: lite.A, B: lite.B }),
      };
    }
    return {
      broadcast: {
        id: broadcast.id, name: broadcast.name, channel: broadcast.channel,
        status: broadcast.status, abVariant: broadcast.abVariant ?? null, abGroupId: broadcast.abGroupId ?? null,
        sentAt: broadcast.sentAt ?? null, scheduledAt: broadcast.scheduledAt ?? null,
        recurrence: (broadcast as any).recurrence ?? null,
        recurrenceGroupId: (broadcast as any).recurrenceGroupId ?? null,
      },
      funnel,
      failureReasons: funnel.failureReasons,
      revenue,
      replies: replies.count,
      repliesMethod: replies.method,
      ab,
    };
  }

  // ---------- MS5: test sends ----------

  /** The synthetic "test" recipient: type "test", id null (its
   * deliveries record recipientId null — see recordDelivery). */
  private static testRecipient(channel: string, to: string): Recipient {
    return {
      type: "test", id: null, name: "Test",
      email: channel === "email" ? to : null,
      phone: channel === "email" ? null : to,
    };
  }

  /**
   * MS5 — test-send a BROADCAST's current content to ONE address
   * through the same resolved sender path a real send would use,
   * with vars { name: "Test" } and explicit test markers (email:
   * "[TEST] " subject prefix + a banner in both parts; sms: the
   * banner). The send runs WITH the broadcastId, so the delivery
   * records broadcastId + recipientType "test" + recipientId null
   * and the email unsubscribe footer renders exactly as in a real
   * broadcast — but the broadcast row, its snapshot and its
   * counters are NEVER touched (nothing here writes to the
   * broadcast table). WhatsApp goes through the same template
   * sender a real run builds. A provider failure returns the
   * failed result (error verbatim) and records a failed delivery,
   * exactly like a real send.
   */
  async testSendBroadcast(organizationId: string, actorId: string, broadcastId: string, toInput: string) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    const to = String(toInput ?? "").trim();
    if (!to) throw new BadRequestException("A test recipient address is required (to)");
    let result: { status: "sent" | "failed" | "skipped"; providerMessageId?: string; error?: string; address: string };
    if (broadcast.channel === "whatsapp") {
      // CC27: a test send is the TESTER's own send through the
      // resolved account — the gate keys on the acting member.
      const sender = await this.createWhatsAppSender(organizationId, broadcast, broadcastId, actorId);
      const entry: SnapshotEntry = {
        type: "test", id: "", name: "Test", email: null, phone: to,
        status: "pending", attempts: 0, vars: { name: "Test" },
      };
      result = await sender(entry);
    } else {
      const isEmail = broadcast.channel === "email";
      result = await this.sendToRecipient(organizationId, {
        channel: broadcast.channel,
        recipient: MessagingService.testRecipient(broadcast.channel, to),
        subject: isEmail && broadcast.subject ? `[TEST] ${broadcast.subject}` : broadcast.subject,
        body: `🧪 এটি একটি টেস্ট বার্তা — আসল গ্রাহকদের কাছে যায়নি।\n\n${broadcast.body}`,
        htmlBody: broadcast.htmlBody
          ? `<p>🧪 এটি একটি টেস্ট বার্তা — আসল গ্রাহকদের কাছে যায়নি।</p>${broadcast.htmlBody}`
          : (broadcast.htmlBody ?? null),
        vars: { name: "Test" },
        broadcastId,
      });
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "broadcast.test_send", entityType: "Broadcast", entityId: broadcastId,
      metadata: { channel: broadcast.channel, to: result.address, status: result.status },
    });
    return result;
  }

  /**
   * MS5 — test-send a TEMPLATE directly to one address. Same
   * helper discipline, but WITHOUT a broadcastId: no unsubscribe
   * footer and no link rewriting, because this is not a broadcast.
   */
  async testSendTemplate(organizationId: string, actorId: string, templateId: string, toInput: string) {
    const template = await this.getTemplate(organizationId, templateId);
    const to = String(toInput ?? "").trim();
    if (!to) throw new BadRequestException("A test recipient address is required (to)");
    const result = await this.sendToRecipient(organizationId, {
      channel: template.channel,
      recipient: MessagingService.testRecipient(template.channel, to),
      subject: template.subject, body: template.body,
      htmlBody: template.htmlBody ?? null,
      vars: { name: "Test" },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "template.test_send", entityType: "MessageTemplate", entityId: templateId,
      metadata: { channel: template.channel, to: result.address, status: result.status },
    });
    return result;
  }

  // ---------- MS5: public link redirect ----------

  /**
   * The public tracked-link redirect: verify the signed token,
   * record the click, hand back the original (UTM'd) URL for the
   * controller's 302. A bad/tampered/expired token is a Bengali
   * 400 — NOTHING is recorded and there is no redirect.
   */
  async performLinkRedirect(token: string): Promise<{ url: string }> {
    const payload = verifyLinkToken(token);
    if (!payload) throw new BadRequestException("এই লিংকটি অবৈধ বা মেয়াদোত্তীর্ণ। মূল বার্তার লিংকটি আবার চেষ্টা করুন।");
    await (this.prisma as any).messageLinkClick.create({
      data: {
        organizationId: payload.orgId, broadcastId: payload.broadcastId,
        recipientKey: payload.recipientKey, url: payload.url,
      },
    });
    return { url: payload.url };
  }

  // ---------- MS2: preference management ----------

  /** Validate + normalize one manually-entered address for its
   * channel. Email must look like an email; phone channels must
   * normalize to a BD number or at least 10 digits. */
  private validatePrefAddress(channel: string, raw: string): string {
    if (!["email", "sms", "whatsapp"].includes(channel)) throw new BadRequestException("channel must be email, sms or whatsapp");
    const address = normalizePrefAddress(channel, raw ?? "");
    if (channel === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new BadRequestException(`Invalid email address: ${raw}`);
    } else if (address.replace(/\D/g, "").length < 10) {
      throw new BadRequestException(`Invalid phone number: ${raw}`);
    }
    return address;
  }

  async listPreferences(organizationId: string, filter?: { status?: string; channel?: string }) {
    return (this.prisma as any).messagePreference.findMany({
      where: {
        organizationId,
        ...(filter?.status ? { status: filter.status } : {}),
        ...(filter?.channel ? { channel: filter.channel } : {}),
      },
      orderBy: { updatedAt: "desc" }, take: 200,
    });
  }

  async addPreference(organizationId: string, actorId: string, dto: { channel: string; address: string; status?: string; note?: string }) {
    const status = dto.status ?? "opted_out";
    if (!["opted_out", "opted_in"].includes(status)) throw new BadRequestException("status must be opted_out or opted_in");
    const address = this.validatePrefAddress(dto.channel, dto.address);
    const row = await this.setPreference(organizationId, {
      channel: dto.channel, address, status: status as "opted_out" | "opted_in", source: "manual", note: dto.note ?? null,
    });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.preference_add", entityType: "MessagePreference", entityId: row.id, metadata: { channel: dto.channel, address, status } });
    return row;
  }

  async removePreference(organizationId: string, actorId: string, preferenceId: string) {
    const row = await (this.prisma as any).messagePreference.findFirst({ where: { id: preferenceId, organizationId } });
    if (!row) throw new NotFoundException("Preference not found");
    await (this.prisma as any).messagePreference.delete({ where: { id: preferenceId } });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.preference_remove", entityType: "MessagePreference", entityId: preferenceId, metadata: { channel: row.channel, address: row.address, status: row.status } });
    return { deleted: true };
  }

  /** Bulk opt-out import: per-row results, never all-or-nothing
   * and never silent — bad rows come back with their error. */
  async importPreferences(organizationId: string, actorId: string, dto: { channel: string; addresses: string[] }) {
    if (!["email", "sms", "whatsapp"].includes(dto.channel)) throw new BadRequestException("channel must be email, sms or whatsapp");
    if (!Array.isArray(dto.addresses) || dto.addresses.length === 0) throw new BadRequestException("addresses must be a non-empty array");
    if (dto.addresses.length > 1000) throw new BadRequestException("Import is capped at 1000 addresses per request");
    let imported = 0;
    const errors: { address: string; error: string }[] = [];
    for (const raw of dto.addresses) {
      try {
        const address = this.validatePrefAddress(dto.channel, String(raw ?? ""));
        await this.setPreference(organizationId, { channel: dto.channel, address, status: "opted_out", source: "import" });
        imported++;
      } catch (e) {
        errors.push({ address: String(raw ?? ""), error: e instanceof Error ? e.message : "Invalid address" });
      }
    }
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.preferences_import", entityType: "MessagePreference", entityId: organizationId, metadata: { channel: dto.channel, imported, failed: errors.length } });
    return { imported, errors };
  }

  /** CSV of the org's opted_out rows (audited, IN10 export
   * discipline). */
  async exportPreferencesCsv(organizationId: string, actorId: string): Promise<string> {
    const rows: any[] = await (this.prisma as any).messagePreference.findMany({
      where: { organizationId, status: "opted_out" }, orderBy: { updatedAt: "desc" }, take: 5000,
    });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.preferences_export", entityType: "MessagePreference", entityId: organizationId, metadata: { rows: rows.length } });
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["channel,address,source,note,updatedAt"];
    for (const r of rows) lines.push([r.channel, r.address, r.source, r.note ?? "", r.updatedAt ? new Date(r.updatedAt).toISOString() : ""].map(esc).join(","));
    return lines.join("\n");
  }

  // ---------- MS2: public unsubscribe ----------

  /** GET side of the public page: validate only. Returns nothing
   * sensitive — the channel and the MASKED address. */
  inspectUnsubscribeToken(token: string) {
    const payload = verifyUnsubscribeToken(token);
    if (!payload) throw new BadRequestException("এই আনসাবস্ক্রাইব লিংকটি অবৈধ বা মেয়াদোত্তীর্ণ। নতুন ইমেইলের লিংক ব্যবহার করুন।");
    return {
      valid: true, channel: payload.channel,
      address: payload.channel === "email" ? maskEmailAddress(payload.address) : maskPhoneAddress(payload.address),
    };
  }

  /** POST side: the actual opt-out write (source unsubscribe_link). */
  async performUnsubscribe(token: string) {
    const payload = verifyUnsubscribeToken(token);
    if (!payload) throw new BadRequestException("এই আনসাবস্ক্রাইব লিংকটি অবৈধ বা মেয়াদোত্তীর্ণ। নতুন ইমেইলের লিংক ব্যবহার করুন।");
    await this.setPreference(payload.orgId, {
      channel: payload.channel, address: payload.address, status: "opted_out", source: "unsubscribe_link",
    });
    return { ok: true, message: "আপনাকে আনসাবস্ক্রাইব করা হয়েছে। এই ঠিকানায় আর কোনো Broadcast ইমেইল যাবে না।" };
  }

  // ---------- MS2: inbound STOP / START keywords ----------

  /**
   * WhatsApp inbound keyword hook (called best-effort from the
   * inbox ingest for whatsapp conversations only). Exact
   * whole-message match after trimming, case-insensitive for the
   * Latin keywords: STOP set → opted_out, START set → opted_in,
   * flipping the SAME preference row (source inbound_keyword).
   * No auto-reply is sent and the message flow is untouched.
   * Messenger is deliberately NOT hooked: no broadcast or workflow
   * send path can address a Messenger PSID today, so a preference
   * keyed by PSID could never match a send — recording it would
   * be dead data (see the B1 acceptance).
   */
  async handleInboundKeyword(organizationId: string, channel: string, senderAddress: string, text: string): Promise<{ matched: boolean; action?: "opted_out" | "opted_in" }> {
    if (channel !== "whatsapp") return { matched: false };
    const normalized = String(text ?? "").trim();
    if (!normalized || !senderAddress) return { matched: false };
    const upper = normalized.toUpperCase();
    const STOP = ["STOP", "STOP ALL", "UNSUBSCRIBE", "বন্ধ করুন", "স্টপ"];
    const START = ["START", "চালু করুন"];
    const isStop = STOP.some((k) => upper === k.toUpperCase());
    const isStart = !isStop && START.some((k) => upper === k.toUpperCase());
    if (!isStop && !isStart) return { matched: false };
    const status = isStop ? "opted_out" : "opted_in";
    await this.setPreference(organizationId, {
      channel: "whatsapp", address: senderAddress, status, source: "inbound_keyword",
    });
    return { matched: true, action: status };
  }

  // ---------- MS8: messaging journey presets ----------

  /** The journey catalogue (messaging/journey-presets.ts) —
   * every preset audited against the triggers/steps the
   * workflow engine really executes; see that module for the
   * audit, including why winback_sweep was dropped. */
  listJourneyPresets() {
    return JOURNEY_PRESETS.map((p) => ({
      key: p.key, name: p.name, descriptionBn: p.descriptionBn, flow: p.flow,
      trigger: p.trigger, channel: p.channel, templateName: p.template.name,
    }));
  }

  /**
   * Install one journey preset for this org:
   *  1. a REAL MessageTemplate row is created through
   *     createTemplate (editable afterwards like any template);
   *  2. a Workflow is created through the REAL
   *     WorkflowsService.create (registered port) — so the
   *     engine's own validator checks the preset's shape and
   *     the template's existence, never a copied rule;
   *  3. the workflow is then set enabled: false (the
   *     installPreset discipline: a human reviews before it
   *     can act).
   * Installing twice creates a second template set + workflow —
   * no silent dedupe; the response names the created workflow
   * id. Without a registered workflow engine the install
   * refuses honestly (the AutomationService optional-service
   * precedent).
   */
  async installJourneyPreset(organizationId: string, actorId: string, key: string, dto?: { name?: string }) {
    const preset = JOURNEY_PRESETS.find((p) => p.key === key);
    if (!preset) throw new NotFoundException("Journey preset not found");
    if (!this.workflowCreator) {
      throw new BadRequestException("Workflow engine is not available in this deployment");
    }
    const template = await this.createTemplate(organizationId, actorId, {
      name: preset.template.name, channel: preset.channel,
      ...(preset.template.subject ? { subject: preset.template.subject } : {}),
      body: preset.template.body,
    });
    const workflow = await this.workflowCreator.create(organizationId, actorId, {
      name: dto?.name?.trim() || preset.name,
      trigger: preset.trigger,
      steps: preset.steps(template.id),
    });
    const disabled = await this.workflowCreator.update(organizationId, workflow.id, { enabled: false }, actorId);
    await this.audit.log({
      organizationId, userId: actorId, action: "messaging.journey_preset_install",
      entityType: "Workflow", entityId: workflow.id,
      metadata: { preset: key, templateId: template.id },
    });
    return { preset: key, workflow: disabled, template, enabled: false };
  }
}
