import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { isMemberConnectionDenied } from "../common/permission-catalog";
import { randomBytes, randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ApiException, badRequest, conflict, forbidden, notFound, unauthorized, unprocessable } from "../i18n";
import { LlmFactory, providerForOrg } from "../ai/llm/llm.factory";
import { resolveOwnerLanguageForOrg } from "../ai/owner-language";
import { estimateTokens } from "../ai/llm/llm.types";
import { formatMinor } from "@repo/contracts";
import { SEND_TIME_MIN_EVENTS, segmentSuggestionsFromCounts, summarizeSendTimeEvents } from "./messaging-ai";
import { AuditService } from "../audit/audit.service";
import { EmailProvider } from "./email.provider";
import { MetaMessagingClient } from "../inbox/meta-messaging.client";
import { decryptJson } from "../integrations/crypto";
import { SmsProvider, normalizeBdPhone, normalizePhoneGeneric } from "./sms.provider";
import { renderTemplate } from "./render";
import { issueUnsubscribeToken, verifyUnsubscribeToken, issuePreferenceToken, verifyPreferenceToken, issueOptInToken, verifyOptInToken } from "./unsubscribe-token";
import { classifyCsvRows, parseContactsCsv, CsvImportMapping } from "./csv-import";
import * as QRCode from "qrcode";
import {
  AudienceDefinitionError, AudienceDefinition, AudienceFacts,
  validateAudienceDefinition, matchesAudienceDefinition, parseAddressList,
} from "./audience-rules";
import { computeOrderAggregates, computeRfm, computeLastOrders, RFM_SEGMENTS } from "./rfm";
import { TEMPLATE_VARIABLES } from "./variables";
import { rewriteBroadcastLinks, verifyLinkToken, apiPublicUrl } from "./link-tracking";
import { issueOpenToken, verifyOpenToken } from "./open-token";
import { deliveryRecipientKey, groupFailureReasons, abSuggestion } from "./delivery-report";
import { parseRecurrence, nextOccurrence, Recurrence, RecurrenceValidationError } from "./recurrence";
import { JOURNEY_PRESETS, journeyPresetForLocale } from "./journey-presets";
import { JOURNEY_PRESETS_V2, UNAVAILABLE_JOURNEY_PRESETS, journeyPresetV2ForLocale } from "./journey-presets-v2";
import { composeCheck } from "./compose-check";
import { composeCheckV2 } from "./compose-check-v2";
import { aggregateChannelHealth, isHardRecipientFailure, decideBudget, BOUNCE_COMPLAINT_NOTE, BudgetDecision } from "./governance";
import {
  ASSOCIATION_LABEL_BN, AUTO_WINNER_MIN_SAMPLE, AUTO_WINNER_RULE_TEXT_BN, AUTO_WINNER_TEST_NAME, autoWinnerRuleTextFor,
  aggregateFunnels, buildAnalyticsCsv, decideAutoWinner, recipientSendTimeFromEvents, subjectQualityScore,
  type BroadcastFunnelShape,
} from "./analytics";
import { parseFinanceRange } from "../finance/finance-common";
import { productSnippetText, productSnippetHtml, couponSnippetText, couponSnippetHtml } from "./composer-blocks";
import { smsSegments } from "./sms-segments";
import { qualityGuardDecision, resolveWhatsAppRateMinor } from "./whatsapp-rich";
import {
  TenantSmtpConfig, TenantSmsConfig,
  tenantSmtpFromRow, tenantSmsFromRow, tenantSmsFromGatewayRow, smsGatewayKey, senderConfigSafeView,
} from "./sender-config";
import {
  CascadeChannel, CascadeConfig, SmsCircuitBreaker,
  parseCascadeConfig, readCascadeConfig, resolveAttemptOrder, engagementStats, cascadeBreakdown,
} from "./cascade";
import { isQuietHoursActive, isValidHhMm, isValidTimeZone } from "./quiet-hours";
import { EmailBlock, BrandKit, validateEmailBlocks, renderEmailBlocks, discountLabel } from "./email-blocks";
import {
  PersonalizationConfig, SegmentBlockConfig, UniqueCouponConfig,
  PersonalizationConfigError, parsePersonalizationConfig, readPersonalizationConfig,
  buildUniqueCouponCode, pickRecommendations, renderRecommendationBlock, applyDynamicBlocks,
  UNIQUE_COUPON_VARIABLE,
} from "./personalization";
import { FESTIVAL_TEMPLATE_PACKS, festivalPackForLocale } from "./festival-templates";
import { catalogText, normalizeApiLocale, resolveDocumentLocale } from "../i18n/catalog/send-locale";
import {
  EngagementContact, EngagementThresholds, DEFAULT_ENGAGEMENT_THRESHOLDS,
  ENGAGEMENT_FORMULA_TEXT, PREDICTIVE_SEGMENT_RULES,
  computeEngagementScore, predictiveSegmentsFor, isHeldOut,
} from "./engagement";
import { NOTIFICATION_EVENTS, mergeConfig } from "../order-notifications/order-notifications";
import { effectiveSmtpConfig, seal } from "../common/platform-config";
import { resolveTxt } from "node:dns/promises";
import {
  BROADCAST_PERSONALIZATION_SAMPLE_MAX,
  BroadcastPersonalizationService,
  PersonalTier,
  assertTier2HookPlaceholder,
  normalizePersonalizationConfig,
  renderPersonalizedBody,
} from "./broadcast-personalization.service";

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

/** MS2 + MX6: the RESERVED inbound WhatsApp keywords. STOP set
 * → opted_out, START set → opted_in, recorded by
 * handleInboundKeyword (source inbound_keyword). MX6 keyword
 * campaigns can NEVER claim any of these (the rule validator
 * refuses them with the same normalization): opt-out/opt-in
 * bookkeeping is exclusive and supreme, and campaign matching
 * never runs for a STOP/START message. */
export const KEYWORD_RESERVED_STOP = ["STOP", "STOP ALL", "UNSUBSCRIBE", "বন্ধ করুন", "স্টপ"];
export const KEYWORD_RESERVED_START = ["START", "চালু করুন"];

/** MX6: the ONE keyword normalization, shared by the MS2 hook,
 * the rule validator, the duplicate-claim check and inbound
 * campaign matching: trim, then uppercase compare (a no-op for
 * Bengali script, case-insensitive for Latin — exactly the MS2
 * rule). */
export function normalizeKeywordText(text: unknown): string {
  return String(text ?? "").trim().toUpperCase();
}

/** MX6: is this normalized text one of the reserved STOP/START
 * keywords? Compares with the same normalization on both sides. */
export function isReservedKeyword(normalizedUpper: string): boolean {
  return [...KEYWORD_RESERVED_STOP, ...KEYWORD_RESERVED_START]
    .some((k) => normalizeKeywordText(k) === normalizedUpper);
}

/** MS1: recipients processed per chunk; the row is re-read between
 * chunks so a pause/cancel lands within one chunk of being set. */
export const BROADCAST_CHUNK_SIZE = 50;
/** MS1: entries a single sweep run processes per broadcast. */
export const BROADCAST_SWEEP_MAX_ENTRIES = 200;
/** MS1: a "sending" row untouched for this long is treated as
 * interrupted (crashed request/process) and recovered by the sweep. */
export const BROADCAST_STALE_MS = 10 * 60 * 1000;

/** MX3: platform defaults for the per-org marketing sweep caps
 * (MessagingSetting.marketingMaxBroadcastsPerSweep /
 * marketingMaxEntriesPerSweep). The broadcasts cap is a TOTAL
 * budget for one org's sweep run, shared by the due phase and
 * the stale-recovery phase (due first); each phase still
 * fetches at most MARKETING_SWEEP_PHASE_MAX, the historical
 * fetch size. A null setting therefore reproduces the pre-MX3
 * sweep exactly: up to 10 due + up to 10 stale broadcasts, each
 * processed for at most BROADCAST_SWEEP_MAX_ENTRIES entries. */
export const MARKETING_SWEEP_DEFAULT_MAX_BROADCASTS = 20;
export const MARKETING_SWEEP_PHASE_MAX = 10;
export const MARKETING_SWEEP_MAX_BROADCASTS_LIMIT = 50;
export const MARKETING_SWEEP_MAX_ENTRIES_LIMIT = 5000;
/** MX3: fallback when an org's timezone cannot be read or is
 * not a valid IANA zone. Matches the Organization.timezone
 * schema default — the org row itself always carries a zone. */
export const QUIET_HOURS_FALLBACK_TIMEZONE = "Asia/Dhaka";

/** MX1: recipients written per createMany chunk at prepare time
 * (the streaming resolver feeds the writer in slices of this
 * size — never one giant write, never a giant Json snapshot). */
export const BROADCAST_RECIPIENT_WRITE_CHUNK = 500;

/** MX1: the dedupe key of one recipient within one broadcast —
 * `${type}:${id}` (the MS1 A/B split key precedent; for csv the
 * id IS the normalized address). The BroadcastRecipient unique
 * constraint on (broadcastId, dedupeKey) makes a duplicate row
 * impossible even when audience sources overlap. */
export function recipientDedupeKey(recipient: { type: string; id: string | null; pushSubscriptionId?: string | null; telegramChatId?: string | null }): string {
  // MX12: a push recipient is identified by its SUBSCRIPTION,
  // not by the contact — one customer with two subscribed
  // devices is two recipients (two rows, two deliveries).
  if (recipient.pushSubscriptionId) return `push:${recipient.pushSubscriptionId}`;
  // MX13: a telegram recipient is identified by its CHAT — the
  // chat is the addressable unit (a customer who talked to the
  // bot from two chats is two reachable chats).
  if (recipient.telegramChatId) return `telegram:${recipient.telegramChatId}`;
  return `${recipient.type}:${recipient.id ?? ""}`;
}

/** MX13 — one inline URL button of a telegram broadcast. The
 * Bot API renders these as reply_markup.inline_keyboard URL
 * buttons under the message text. */
export interface TelegramButton { label: string; url: string }

/** MX13 — the telegram inline-button rule, shared by broadcast
 * create + edit and pinned by the MX13 spec: at most 4 buttons;
 * each label 1–64 chars; each URL an https URL (Telegram refuses
 * anything else for URL buttons) of at most 2048 chars. Empty /
 * absent reads as null (text-only message). Throws an Error
 * whose message is the client-facing 400 text. */
export function validateTelegramButtons(raw: unknown): TelegramButton[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw badRequest("messaging.telegramButtonsMustBeArrayOfLabel");
  if (raw.length === 0) return null;
  if (raw.length > 4) throw badRequest("messaging.telegramButtonsMayCarryAtMost4");
  const out: TelegramButton[] = [];
  for (const b of raw as any[]) {
    const label = String(b?.label ?? "").trim();
    const url = String(b?.url ?? "").trim();
    if (!label || label.length > 64) throw badRequest("messaging.eachTelegramButtonNeedsALabelOf");
    let ok = url.length > 0 && url.length <= 2048;
    if (ok) { try { ok = new URL(url).protocol === "https:"; } catch { ok = false; } }
    if (!ok) throw badRequest("messaging.telegramButtonNeedsAnHttpsUrl", { label });
    out.push({ label, url });
  }
  return out;
}

/** MX12 — the push click-through URL rule, shared by broadcast
 * create + edit and pinned by the MX12 spec: the shop service
 * worker opens this URL on notification click, and the base
 * WebPush system (AX16 validateSend) accepts ONLY shop-relative
 * paths — an absolute/external URL is refused so a push can
 * never send visitors off the shop's own pages. Empty/absent
 * reads as null (the worker then opens the shop root). Throws
 * an Error whose message is the client-facing 400 text. */
export function validatePushUrl(raw: unknown): string | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const url = String(raw).trim();
  if (!url.startsWith("/") || url.startsWith("//") || url.length > 500) {
    throw badRequest("messaging.pushUrlMustBeAShopRelativePath");
  }
  return url;
}

/** MX14 — the on-site click-through URL rule, shared by broadcast
 * create + edit and pinned by the MX14 spec: the customer opens
 * the notification inside their shop account, and the click is
 * resolved against the SHOP's own pages — the exact shop-relative
 * discipline of MX12's validatePushUrl (an absolute/external URL
 * is refused so an onsite notification can never send a customer
 * off the shop). Empty/absent reads as null (opening the
 * notification then only marks it read). Throws an Error whose
 * message is the client-facing 400 text. */
export function validateOnsiteUrl(raw: unknown): string | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const url = String(raw).trim();
  if (!url.startsWith("/") || url.startsWith("//") || url.length > 500) {
    throw badRequest("messaging.onsiteUrlMustBeAShopRelativePath");
  }
  return url;
}

/** MS1: one materialized recipient in Broadcast.recipientSnapshot.
 * MS3: a "csv" entry's id is the normalized address itself (the
 * A/B split key is type:address for csv, per the builder design);
 * its MessageDelivery rows record recipientId null (see
 * recordDelivery) because there is no org entity behind it. */
export interface SnapshotEntry {
  type: "customer" | "lead" | "csv" | "test" | "push" | "telegram";
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
  /** MX8: per-recipient personalization state (same shape as
   * BroadcastRecipient.personalization — see the schema). On the
   * snapshot path it rides inside the entry, which the engine
   * persists with the snapshot after every chunk, giving the
   * same resume-idempotency guarantee as the recipient table. */
  personalization?: Record<string, unknown>;
  /** MX12: for channel "push" entries, the WebPushSubscription
   * this entry sends to + its endpoint (the channel address —
   * the preference-store identity for push). Carried in the
   * snapshot Json exactly like vars, so the legacy snapshot
   * engine sends push the same way the recipient-table engine
   * does. Absent on every non-push entry. */
  pushSubscriptionId?: string;
  pushEndpoint?: string;
  /** MX13: for channel "telegram" entries, the chat id this
   * entry sends to (the channel address — the preference-store
   * identity for telegram). Carried in the snapshot Json
   * exactly like the push identity, so the legacy snapshot
   * engine sends telegram the same way the recipient-table
   * engine does. Absent on every non-telegram entry. */
  telegramChatId?: string;
  /** SA-B20 (G2): which personalisation tier produced this
   * entry's vars — stamped ONLY when the broadcast's
   * personalisation was enabled at prepare. Absent on every
   * pre-G2 / non-personalised entry. */
  personalTier?: PersonalTier;
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
  // MX12: the push channel's address IS the subscription
  // endpoint — it is stored/compared trimmed, exactly as the
  // WebPushSubscription row carries it (no phone-style
  // normalization applies to a URL).
  if (channel === "push") return value;
  // MX13: the telegram channel's address IS the chat id — it is
  // stored/compared trimmed, exactly as the ChannelConversation
  // row carries it in externalContactId (no phone-style
  // normalization applies to a chat id).
  if (channel === "telegram") return value;
  // MX14: the onsite channel's address IS the customer id — the
  // notification center is keyed by the org-scoped Customer row,
  // so the preference-store identity for onsite is that id,
  // stored/compared trimmed, exactly as the Customer row
  // carries it (no phone-style normalization applies to an id).
  if (channel === "onsite") return value;
  return normalizeBdPhone(value) ?? value.replace(/\D/g, "");
}

/** The address a recipient is reached at on `channel`, normalized
 * the preference-store way ("" when the recipient has none). */
export function recipientPrefAddress(channel: string, recipient: Recipient): string {
  // MX12: push reaches a recipient at their subscription
  // endpoint, never at an email/phone — a push opt-out stored
  // under the endpoint therefore matches exactly here.
  // MX13: telegram reaches a recipient at their chat id, never
  // at an email/phone — a telegram opt-out stored under the
  // chat id therefore matches exactly here.
  // MX14: onsite reaches a recipient at their CUSTOMER identity
  // (the notification-center account), never at an email/phone —
  // an onsite opt-out stored under the customer id therefore
  // matches exactly here. A recipient without a customer id
  // (lead/csv/test) has no onsite address at all.
  const raw = channel === "email" ? recipient.email : channel === "push" ? recipient.pushEndpoint : channel === "telegram" ? recipient.telegramChatId : channel === "onsite" ? recipient.id : recipient.phone;
  return raw ? normalizePrefAddress(channel, raw) : "";
}

/** Tenant web base for customer-facing links (WEB_URL precedent:
 * courier/tracking-token.ts). */
export function webBaseUrl(): string {
  return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export interface Recipient {
  type: "customer" | "lead" | "csv" | "test" | "push" | "telegram"; id: string | null; name: string;
  email?: string | null; phone?: string | null;
  /** MX12: channel "push" only — the WebPushSubscription this
   * recipient is reached through, and its endpoint (the push
   * channel address). A customer recipient may carry these
   * (identified subscription); an anonymous subscription is a
   * recipient of type "push" whose id IS the subscription id. */
  pushSubscriptionId?: string | null;
  pushEndpoint?: string | null;
  /** MX13: channel "telegram" only — the Telegram chat id this
   * recipient is reached at (the telegram channel address). A
   * customer/lead recipient may carry it (a conversation linked
   * to that contact); a conversation linked to neither is a
   * recipient of type "telegram" whose id IS the conversation
   * id. */
  telegramChatId?: string | null;
}

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
  if (channel === "push") {
    // MX12: a preview sample never carries a full endpoint (it
    // is a per-browser credential-like URL) — origin + mask.
    const endpoint = recipient.pushEndpoint ?? "";
    if (!endpoint) return "";
    try { return `${new URL(endpoint).origin}/***`; } catch { return "***"; }
  }
  if (channel === "telegram") {
    // MX13: a chat id is masked like a phone number — a preview
    // sample never carries the full id.
    return recipient.telegramChatId ? maskPhoneAddress(recipient.telegramChatId) : "";
  }
  if (channel === "onsite") {
    // MX14: the onsite address is a customer id — a preview
    // sample never carries a full internal id.
    return recipient.id ? `${String(recipient.id).slice(0, 2)}***` : "";
  }
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
  /** MX10: dropped because the address is a PENDING double
   * opt-in signup (not yet confirmed) on this channel. */
  excludedPendingCount: number;
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
/**
 * MX6 — the inbox-reply port for keyword-campaign auto-replies.
 * MessagingService.sendToRecipient covers email|sms ONLY; there
 * is no per-recipient WhatsApp send in messaging. The real
 * WhatsApp conversation send lives in InboxService, and Inbox
 * already depends on Messaging (never the reverse — no cycle),
 * so InboxService REGISTERS this port on module init, exactly
 * like the MS8 workflow-creator pattern below. The port's send
 * goes through the inbox's real conversation send path
 * (ChannelMessage row + deliverText), so a reply counts as sent
 * ONLY when that path returns a platform message id.
 */
export interface InboxReplyPort {
  sendConversationText(organizationId: string, conversationId: string, text: string): Promise<{ providerMessageId: string }>;
}

/**
 * MX12 — the web-push send port. The real push send (the org's
 * sealed VAPID keypair + the `web-push` library + marking a
 * dead subscription "gone") lives in the webpush module
 * (AX16); Messaging must not import it or write its tables, so
 * WebPushService REGISTERS this port on module init (the MS8 /
 * MX6 pattern). The port receives ONLY the subscription id +
 * the rendered payload — it loads the subscription row itself,
 * sends, and returns the push service's real outcome:
 *  - "sent": the push service accepted (2xx from
 *    sendNotification);
 *  - "gone": 404/410 — the port has ALREADY marked the
 *    subscription row gone, so future resolves skip it;
 *  - "failed": anything else, with the real error text.
 * Messaging records "sent" as a sent delivery and both other
 * outcomes as failed deliveries carrying the real reason.
 * An absent port (WebpushModule never booted) makes every push
 * send fail honestly with that reason — never a fake success.
 */
export interface PushSendPort {
  sendPush(organizationId: string, input: {
    subscriptionId: string; title: string; body: string; url?: string | null;
  }): Promise<{ outcome: "sent" | "gone" | "failed"; statusCode?: number | null; error?: string }>;
}

/**
 * MX13 — the telegram send port. The real Telegram send (the
 * org's sealed bot token + the Bot API) lives in the inbox
 * module (TelegramService owns the Integration rows and the
 * TelegramClient); Messaging must not import it, so
 * TelegramService REGISTERS this port on module init (the MS8 /
 * MX6 / MX12 pattern). The port receives ONLY the chat id + the
 * rendered text + the optional inline URL buttons, sends
 * through the org's connected bot, and returns Telegram's real
 * outcome:
 *  - "sent": Telegram accepted and returned a message_id —
 *    the ONLY shape messaging records as a sent delivery;
 *  - "failed": anything else (bot blocked 403, chat not found
 *    400, no connected bot, …) with Telegram's real description.
 * An absent port (InboxModule never booted) makes every
 * telegram send fail honestly with that reason — never a fake
 * success.
 */
export interface TelegramSendPort {
  sendTelegram(organizationId: string, input: {
    chatId: string; text: string; buttons?: TelegramButton[] | null;
  }): Promise<{ outcome: "sent" | "failed"; messageId?: string; error?: string }>;
}

export interface WorkflowCreatorPort {
  create(organizationId: string, actorId: string, dto: { name: string; trigger: string; conditions?: unknown; steps: any[]; journey?: unknown }): Promise<any>;
  // MX4: the update dto is widened to the full definition
  // (WorkflowsService.update has always accepted these — the
  // port simply never declared them) plus the MX4 journey meta.
  update(organizationId: string, workflowId: string, dto: { enabled?: boolean; name?: string; trigger?: string; conditions?: unknown; steps?: any[]; journey?: unknown }, actorId?: string): Promise<any>;
  // MX4: read side for the journey builder (list + runs). The
  // journey endpoints call these defensively — a registered
  // creator without them reads as "engine not available".
  list?(organizationId: string): Promise<any[]>;
  listRuns?(organizationId: string, filters?: { workflowId?: string; status?: string; take?: number }): Promise<any[]>;
}

/**
 * MX4 — journey-usable triggers: the WORKFLOW_TRIGGERS whose
 * event context can resolve a recipient through the engine's
 * resolveRecipient (leadId → lead, customerId → customer, or
 * contactEmail/contactPhone fallback), verified against
 * workflows.service.ts (resolveRecipient + enrichContext +
 * the MS8 journey-presets audit):
 *  - order_created / order_delivered / order_cod_confirmed:
 *    the event carries an orderId; enrichContext fills
 *    customerId and resolveRecipient resolves the customer.
 *  - lead_created / lead_stage_changed: the context carries a
 *    leadId (enrichContext also fills contact fields).
 *  - cart_abandoned: contactEmail/contactPhone fallback.
 *  - inbox_message_received: the conversation context;
 *    enrichContext fills leadId/customerId from the
 *    conversation row.
 * Deliberately excluded: schedule (its context is
 * { date, scheduledFor, dayOfWeek } — NO recipient at all, the
 * exact reason MS8 dropped winback_sweep), inbox_unanswered
 * and the conversation/order-status/shipment triggers (ops
 * automations whose contexts are not customer-journey
 * recipients in the audited sense; they stay available in the
 * Workflows page itself).
 */
export const JOURNEY_TRIGGERS: { trigger: string; labelBn: string; labelEn: string }[] = [
  { trigger: "order_created", labelBn: "নতুন অর্ডার তৈরি হলে", labelEn: "When a new order is created" },
  { trigger: "order_delivered", labelBn: "অর্ডার ডেলিভারি হলে", labelEn: "When an order is delivered" },
  { trigger: "order_cod_confirmed", labelBn: "COD অর্ডার কনফার্ম হলে", labelEn: "When a COD order is confirmed" },
  { trigger: "lead_created", labelBn: "নতুন লিড তৈরি হলে", labelEn: "When a new lead is created" },
  { trigger: "lead_stage_changed", labelBn: "লিডের স্টেজ বদলালে", labelEn: "When a lead's stage changes" },
  { trigger: "cart_abandoned", labelBn: "কার্ট পরিত্যক্ত হলে (Abandoned Cart)", labelEn: "When a cart is abandoned (Abandoned Cart)" },
  { trigger: "inbox_message_received", labelBn: "ইনবক্সে নতুন বার্তা এলে", labelEn: "When a new message arrives in the inbox" },
];

/** MX4 — the step types the journey builder may use. A subset
 * of the engine's STEP_TYPES: customer-facing sends, flow
 * control and tagging. Everything else the engine can do
 * (webhooks, AI, team notifications, …) stays in the Workflows
 * page — a journey is a customer path, not an ops automation. */
export const JOURNEY_STEP_TYPES: { type: string; labelBn: string; labelEn: string }[] = [
  { type: "wait", labelBn: "অপেক্ষা", labelEn: "Wait" },
  { type: "send_email", labelBn: "ইমেইল পাঠান", labelEn: "Send email" },
  { type: "send_sms", labelBn: "SMS পাঠান", labelEn: "Send SMS" },
  { type: "condition", labelBn: "শর্ত (মিললে এগিয়ে যান)", labelEn: "Condition (continue if matched)" },
  { type: "branch", labelBn: "শাখা (Branch — দুই পথ)", labelEn: "Branch (two paths)" },
  { type: "add_tag", labelBn: "ট্যাগ যোগ করুন", labelEn: "Add a tag" },
];

/** MX4 — step types allowed INSIDE a branch arm in a journey.
 * Mirrors the messaging-side rule (the engine validator
 * additionally refuses wait + nested branch in arms; condition
 * is excluded here because an arm is a send/tag sequence, not
 * a second decision level). */
export const JOURNEY_ARM_STEP_TYPES = ["send_email", "send_sms", "add_tag"];

/**
 * MX4 — condition fields the journey builder offers. The
 * context fields (total / status / source / stage) are the
 * ones enrichContext really supplies for the journey
 * triggers (order total/status/source; lead stage/source).
 * purchasedSinceEntry + customerTags are the MX4 resume-time
 * journey facts (workflows.service.ts resumeRuns) — they are
 * populated when a waiting run RESUMES, so a condition on
 * them belongs after a wait step.
 * journeyOpened / journeyClicked are deliberately ABSENT:
 * the workflow-send tracking extension that would feed them
 * was NOT built (the MS5 spec pins "workflow sends are NEVER
 * rewritten" — see docs/messaging-mx4-acceptance.md), so
 * offering them would advertise a signal that can never fire.
 */
export const JOURNEY_CONDITION_FIELDS: { field: string; labelBn: string; labelEn: string; ops: string[]; kind: "number" | "string" | "boolean" }[] = [
  { field: "total", labelBn: "অর্ডারের মোট টাকা (Total)", labelEn: "Order total (Total)", ops: ["eq", "neq", "gt", "gte", "lt", "lte"], kind: "number" },
  { field: "status", labelBn: "অর্ডারের অবস্থা (Status)", labelEn: "Order status (Status)", ops: ["eq", "neq"], kind: "string" },
  { field: "source", labelBn: "উৎস (Source)", labelEn: "Source", ops: ["eq", "neq", "contains"], kind: "string" },
  { field: "stage", labelBn: "লিডের স্টেজ (Stage)", labelEn: "Lead stage (Stage)", ops: ["eq", "neq"], kind: "string" },
  { field: "purchasedSinceEntry", labelBn: "যাত্রা শুরুর পর কেনাকাটা করেছেন", labelEn: "Has purchased since the journey started", ops: ["eq"], kind: "boolean" },
  { field: "customerTags", labelBn: "কাস্টমার/লিডের ট্যাগ", labelEn: "Customer/lead tags", ops: ["contains"], kind: "string" },
];

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

  /** SA-B20 (G2): the personalisation collaborator — injected
   * by MessagingModule; specs constructing the service with the
   * historical args get a lazily-built instance over the same
   * prisma + llm (the LlmFactory fallback pattern above). It is
   * only ever CALLED when a broadcast's personalisation is
   * enabled, so non-G2 paths never touch it. */
  private personalizationSvc: BroadcastPersonalizationService | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailProvider,
    private readonly sms: SmsProvider,
    @Optional() llm?: LlmFactory,
    @Optional() personalization?: BroadcastPersonalizationService,
  ) {
    this.llm = llm ?? new LlmFactory();
    this.personalizationSvc = personalization ?? null;
  }

  private personalization(): BroadcastPersonalizationService {
    if (!this.personalizationSvc) {
      this.personalizationSvc = new BroadcastPersonalizationService(this.prisma as any, this.llm);
    }
    return this.personalizationSvc;
  }

  /** MS8: the registered workflow engine (see the port above).
   * Null in a deployment/test that never boots WorkflowsModule —
   * the preset installer then refuses honestly. */
  private workflowCreator: WorkflowCreatorPort | null = null;

  registerWorkflowCreator(creator: WorkflowCreatorPort) {
    this.workflowCreator = creator;
  }

  /** MX6: the registered inbox-reply port (see InboxReplyPort).
   * Null when InboxModule never booted — a keyword auto-reply
   * then records itself as skipped with that reason, never as
   * sent. */
  private inboxReplyPort: InboxReplyPort | null = null;

  registerInboxReplyPort(port: InboxReplyPort) {
    this.inboxReplyPort = port;
  }

  /** MX12: the registered web-push send port (see PushSendPort).
   * Null when WebpushModule never booted — push sends then fail
   * per-recipient with the honest "port not available" reason. */
  private pushSendPort: PushSendPort | null = null;

  registerPushSendPort(port: PushSendPort) {
    this.pushSendPort = port;
  }

  /** MX13: the registered telegram send port (see
   * TelegramSendPort). Null when InboxModule never booted —
   * telegram sends then fail per-recipient with the honest
   * "port not available" reason. */
  private telegramSendPort: TelegramSendPort | null = null;

  registerTelegramSendPort(port: TelegramSendPort) {
    this.telegramSendPort = port;
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
        provider: smsGateway ? SMS_GATEWAY_LABELS[smsGateway] : catalogText("messaging.smsGatewayNone", organizationId ? await resolveDocumentLocale(this.prisma as any, organizationId) : "bn"),
        gateway: smsGateway, path: smsPath,
        tenantConfigured: Boolean(tenantSms), platformConfigured: platformSms,
      },
    };
  }

  // ---------- Templates ----------
  async createTemplate(organizationId: string, actorId: string, dto: { name: string; channel: string; subject?: string; body?: string; htmlBody?: string | null; blocks?: unknown }) {
    if (!["email", "sms"].includes(dto.channel)) throw badRequest("messaging.channelMustBeEmailOrSms");
    if (dto.channel === "email" && !dto.subject) throw badRequest("messaging.emailTemplatesNeedASubject");
    // MS5: HTML is an email-only part — on sms it is REJECTED with
    // an honest 400, never silently stored or ignored.
    if (dto.htmlBody && dto.channel !== "email") throw badRequest("messaging.htmlBodyIsOnlyAllowedForEmail");
    // MX7: a block-built email template — the blocks are the
    // source; body/htmlBody are RENDERED from them (brand kit +
    // real catalog rows at this moment) into the same fields the
    // send path already uses. An explicit body/htmlBody alongside
    // blocks is refused (two sources would drift).
    let body = dto.body;
    let htmlBody: string | null = dto.htmlBody ?? null;
    let blocks: EmailBlock[] | null = null;
    let emptySlots: { index: number; type: string; reason: string }[] = [];
    if (dto.blocks !== undefined && dto.blocks !== null) {
      if (dto.channel !== "email") throw badRequest("messaging.blocksAreOnlyAllowedForEmail");
      if (dto.body || dto.htmlBody) throw badRequest("messaging.withBlocksBodyHtmlBodyAreRendered");
      const rendered = await this.renderBlocksForOrg(organizationId, dto.blocks);
      blocks = rendered.blocks; body = rendered.body; htmlBody = rendered.htmlBody; emptySlots = rendered.emptySlots;
    }
    if (!blocks && !body) throw badRequest("messaging.templateBodyIsRequiredWriteOne");
    const template = await (this.prisma as any).messageTemplate.create({
      data: { organizationId, name: dto.name, channel: dto.channel, subject: dto.subject ?? null, body, htmlBody, blocks: blocks ?? undefined, version: 1, createdById: actorId },
    });
    await this.snapshotTemplateVersion(organizationId, actorId, template);
    return blocks ? { ...template, emptySlots } : template;
  }

  // ---------- MX7: brand kit + block rendering ----------
  /** The org's brand kit, read from the ONE central place —
   * the Organization row's Org Settings branding (M59 brandName /
   * logoUrl / primaryColor + MX7 brandFont / brandSecondaryColor).
   * No brand data is stored anywhere in messaging. logoUrl is
   * returned as stored (a relative /public/branding path or an
   * absolute CDN URL — both are what the org's other surfaces
   * already use). */
  async getBrandKit(organizationId: string): Promise<BrandKit & { brandName: string | null }> {
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    return {
      brandName: org?.brandName ?? org?.name ?? null,
      logoUrl: org?.logoUrl ?? null,
      primaryColor: org?.primaryColor ?? null,
      secondaryColor: org?.brandSecondaryColor ?? null,
      font: org?.brandFont ?? null,
    };
  }

  /** Validate + render blocks for this org: product slots resolve
   * from REAL Product rows (same slug-URL rule as the composer
   * picker), coupon slots from REAL StoreDiscount rows (active
   * only). Missing rows are not an error — the slot renders empty
   * and the reason is reported in emptySlots. */
  async renderBlocksForOrg(organizationId: string, rawBlocks: unknown) {
    let blocks: EmailBlock[];
    try { blocks = validateEmailBlocks(rawBlocks); } catch (e: any) { throw new BadRequestException(e?.message ?? "Invalid blocks"); }
    const productIds = [...new Set(blocks.filter((b) => b.type === "product" && b.productId).map((b) => b.productId!))];
    const discountIds = [...new Set(blocks.filter((b) => b.type === "coupon" && b.discountId).map((b) => b.discountId!))];
    const products = new Map<string, any>();
    if (productIds.length) {
      const rows: any[] = await (this.prisma as any).product.findMany({ where: { organizationId, id: { in: productIds }, status: "ACTIVE" } });
      for (const p of rows) products.set(p.id, { name: p.name, priceMinor: p.priceMinor, currency: p.currency ?? "BDT", url: p.slug ? `${webBaseUrl()}/checkout/${p.slug}` : null, imageUrl: p.imageUrl ?? null });
    }
    const discounts = new Map<string, any>();
    if (discountIds.length && (this.prisma as any).storeDiscount) {
      const rows: any[] = await (this.prisma as any).storeDiscount.findMany({ where: { organizationId, id: { in: discountIds }, active: true } });
      for (const d of rows) discounts.set(d.id, { code: d.code, kind: d.kind, value: d.value });
    }
    const brand = await this.getBrandKit(organizationId);
    const rendered = renderEmailBlocks(blocks, { brand, products, discounts });
    return { blocks, ...rendered };
  }

  /** MX7: real StoreDiscount rows for the builder's coupon-slot
   * picker (the org coupon store — StoreDiscount, unique per org
   * by code). Active rows only; value semantics are the row's own
   * (percent 1-90 | fixed minor units | free_shipping). */
  async listComposerDiscounts(organizationId: string) {
    if (!(this.prisma as any).storeDiscount) return [];
    const rows: any[] = await (this.prisma as any).storeDiscount.findMany({
      where: { organizationId, active: true }, orderBy: { createdAt: "desc" }, take: 100,
    });
    return rows.map((d: any) => ({ id: d.id, code: d.code, kind: d.kind, value: d.value, minOrderMinor: d.minOrderMinor != null ? String(d.minOrderMinor) : null, endsAt: d.endsAt ?? null }));
  }

  /** MX7: snapshot the template's current content as a version
   * row. Guarded by table presence so pre-MX7 fake-prisma specs
   * (and any deployment mid-migration) keep the exact old
   * behaviour — versioning is additive bookkeeping, never a
   * reason to fail a template write. */
  private async snapshotTemplateVersion(organizationId: string, actorId: string, template: any) {
    const table = (this.prisma as any).messageTemplateVersion;
    if (!table?.create) return;
    await table.create({
      data: {
        organizationId, templateId: template.id, version: template.version ?? 1,
        name: template.name, channel: template.channel, subject: template.subject ?? null,
        body: template.body, htmlBody: template.htmlBody ?? null, blocks: template.blocks ?? null,
        createdById: actorId,
      },
    }).catch(() => undefined);
  }

  async listTemplateVersions(organizationId: string, templateId: string) {
    await this.getTemplate(organizationId, templateId);
    const table = (this.prisma as any).messageTemplateVersion;
    if (!table?.findMany) return [];
    return table.findMany({ where: { organizationId, templateId }, orderBy: { version: "desc" } });
  }

  /** MX7: restore a prior version — creates a NEW version whose
   * content copies the target snapshot (history is append-only;
   * the restored-from version stays viewable). */
  async restoreTemplateVersion(organizationId: string, actorId: string, templateId: string, version: number) {
    const template = await this.getTemplate(organizationId, templateId);
    const table = (this.prisma as any).messageTemplateVersion;
    if (!table?.findFirst) throw badRequest("messaging.templateVersioningIsNotAvailableIn");
    const target = await table.findFirst({ where: { organizationId, templateId, version } });
    if (!target) throw notFound("messaging.templateVersionNotFound");
    const nextVersion = (template.version ?? 1) + 1;
    const updated = await (this.prisma as any).messageTemplate.update({
      where: { id: templateId },
      data: { name: target.name, subject: target.subject ?? null, body: target.body, htmlBody: target.htmlBody ?? null, blocks: target.blocks ?? null, version: nextVersion },
    });
    await this.snapshotTemplateVersion(organizationId, actorId, updated);
    return updated;
  }

  // ---------- MX7: content library (saved blocks) ----------
  async createContentBlock(organizationId: string, actorId: string, dto: { name: string; block: unknown }) {
    let blocks: EmailBlock[];
    try { blocks = validateEmailBlocks([dto.block]); } catch (e: any) { throw new BadRequestException(e?.message ?? "Invalid block"); }
    const block = blocks[0];
    return (this.prisma as any).messagingContentBlock.create({
      data: { organizationId, name: dto.name, kind: block.type, data: block, createdById: actorId },
    });
  }

  async listContentBlocks(organizationId: string, kind?: string) {
    return (this.prisma as any).messagingContentBlock.findMany({
      where: { organizationId, ...(kind ? { kind } : {}) }, orderBy: { createdAt: "desc" },
    });
  }

  async updateContentBlock(organizationId: string, blockId: string, dto: { name?: string; block?: unknown }) {
    const existing = await (this.prisma as any).messagingContentBlock.findFirst({ where: { id: blockId, organizationId } });
    if (!existing) throw notFound("messaging.contentBlockNotFound");
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.block !== undefined) {
      let blocks: EmailBlock[];
      try { blocks = validateEmailBlocks([dto.block]); } catch (e: any) { throw new BadRequestException(e?.message ?? "Invalid block"); }
      data.data = blocks[0]; data.kind = blocks[0].type;
    }
    return (this.prisma as any).messagingContentBlock.update({ where: { id: blockId }, data });
  }

  async deleteContentBlock(organizationId: string, blockId: string) {
    const existing = await (this.prisma as any).messagingContentBlock.findFirst({ where: { id: blockId, organizationId } });
    if (!existing) throw notFound("messaging.contentBlockNotFound");
    await (this.prisma as any).messagingContentBlock.delete({ where: { id: blockId } });
    return { deleted: true };
  }

  // ---------- MX7: festival template pack ----------
  listFestivalPacks() {
    return FESTIVAL_TEMPLATE_PACKS.map((p) => ({ key: p.key, name: p.name, nameBn: p.nameBn, subject: p.subject, blocks: p.blocks, subjectEn: p.subjectEn, blocksEn: p.blocksEn }));
  }

  /** Install one festival design as a REAL MessageTemplate via
   * createTemplate (blocks stay unfilled slots — the org picks
   * real products/discounts in the builder afterwards). */
  async installFestivalPack(organizationId: string, actorId: string, key: string) {
    const pack = FESTIVAL_TEMPLATE_PACKS.find((p) => p.key === key);
    if (!pack) throw notFound("messaging.festivalTemplatePackNotFound");
    // MB4 (D-MB4-8): platform pack content installs in the
    // org's dashboardLocale; the installed copy is merchant-owned.
    const locale = await resolveDocumentLocale(this.prisma as any, organizationId);
    const content = festivalPackForLocale(pack, locale);
    const template = await this.createTemplate(organizationId, actorId, {
      name: pack.name, channel: "email", subject: content.subject, body: "", blocks: content.blocks,
    });
    return { pack: pack.key, template };
  }

  /** MS5: the personalization variables per audience entity —
   * the API-side source of truth (messaging/variables.ts). */
  getTemplateVariables() {
    return TEMPLATE_VARIABLES;
  }

  /** MS5: advisory compose warnings (pure compose-check module;
   * never blocks a send). */
  checkCompose(dto: { channel: string; subject?: string; body: string }) {
    if (!["email", "sms", "whatsapp", "push", "telegram", "onsite"].includes(dto.channel)) throw badRequest("messaging.channelMustBeEmailSmsWhatsapp");
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
    if (!template) throw notFound("messaging.templateNotFound");
    return template;
  }

  async updateTemplate(organizationId: string, templateId: string, dto: { name?: string; subject?: string; body?: string; htmlBody?: string | null; blocks?: unknown }) {
    const existing = await this.getTemplate(organizationId, templateId);
    // MS5: the EXISTING template's channel decides — htmlBody on
    // a non-email template is an honest 400.
    if (dto.htmlBody !== undefined && existing.channel !== "email") {
      throw badRequest("messaging.htmlBodyIsOnlyAllowedForEmail");
    }
    const { blocks: rawBlocks, ...rest } = dto as any;
    const data: Record<string, unknown> = { ...rest };
    let emptySlots: { index: number; type: string; reason: string }[] | undefined;
    // MX7: blocks on update re-render body/htmlBody from the new
    // blocks (explicit body/htmlBody alongside is refused, as at
    // create). Explicit blocks: null detaches the builder source
    // (the template becomes hand-authored; body/htmlBody stay).
    if (rawBlocks !== undefined) {
      if (existing.channel !== "email") throw badRequest("messaging.blocksAreOnlyAllowedForEmail");
      if (rawBlocks === null) {
        data.blocks = null;
      } else {
        if (dto.body !== undefined || dto.htmlBody !== undefined) throw badRequest("messaging.withBlocksBodyHtmlBodyAreRendered");
        const rendered = await this.renderBlocksForOrg(organizationId, rawBlocks);
        data.blocks = rendered.blocks; data.body = rendered.body; data.htmlBody = rendered.htmlBody;
        emptySlots = rendered.emptySlots;
      }
    }
    // MX7 versioning: a CONTENT change (name/subject/body/htmlBody/
    // blocks) bumps the version and snapshots it; a no-op PATCH
    // (nothing actually differs) keeps the version.
    const contentChanged = ["name", "subject", "body", "htmlBody", "blocks"].some((k) => data[k] !== undefined && JSON.stringify(data[k] ?? null) !== JSON.stringify((existing as any)[k] ?? null));
    if (contentChanged) data.version = (existing.version ?? 1) + 1;
    const updated = await (this.prisma as any).messageTemplate.update({ where: { id: templateId }, data });
    if (contentChanged) {
      // The actor for a version snapshot: updateTemplate's route
      // has never carried an actor (pre-MX7 signature) — the
      // snapshot records the template's original creator rather
      // than inventing one.
      await this.snapshotTemplateVersion(organizationId, existing.createdById, updated);
    }
    return emptySlots ? { ...updated, emptySlots } : updated;
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
    await this.scanInChunks(model, where, async (chunk) => { rows.push(...chunk); });
    return rows;
  }

  /**
   * MX1 — the streaming form of scanChunked: each cursor page is
   * handed to `onChunk` as it is read and never accumulated by
   * the scan itself, so a caller that consumes chunk-by-chunk
   * (the MX1 prepare path) never holds the whole audience in one
   * in-memory array. Same cursor discipline (id-ascending, take
   * AUDIENCE_SCAN_CHUNK) as the collecting form.
   */
  private async scanInChunks(model: any, where: any, onChunk: (rows: any[]) => Promise<void>): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      const chunk = await model.findMany({
        where, orderBy: { id: "asc" }, take: AUDIENCE_SCAN_CHUNK,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const list = Array.isArray(chunk) ? chunk : [];
      if (list.length) await onChunk(list);
      if (list.length < AUDIENCE_SCAN_CHUNK) break;
      cursor = list[list.length - 1]?.id;
      if (!cursor) break;
    }
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
    const recipients: Recipient[] = [];
    const { invalidCount } = await this.resolveAudienceInChunks(
      organizationId, channel, audienceType, audienceStage, audienceSegment, extras,
      BROADCAST_RECIPIENT_WRITE_CHUNK,
      async (chunk) => { recipients.push(...chunk); },
    );
    return { recipients, invalidCount };
  }

  /**
   * MX1 — the streaming form of resolveAudienceInternal: resolved
   * recipients are handed to `onChunk` in slices of at most
   * `chunkSize` as the underlying scans page through the data —
   * the resolver itself never accumulates the whole audience.
   * The collecting form above is built on this one, so there is
   * still exactly ONE base resolver. Audience types whose source
   * is inherently a materialized set (segment via computeRfm,
   * csv via the stored address list — the latter hard-capped at
   * CSV_AUDIENCE_CAP) are sliced from that set in the same chunk
   * sizes; the DB-backed types (customers / leads_stage /
   * custom / saved) page through scanInChunks.
   */
  private async resolveAudienceInChunks(
    organizationId: string, channel: string, audienceType: string, audienceStage: string | undefined, audienceSegment: string | undefined,
    extras: AudienceExtras | undefined, chunkSize: number,
    onChunk: (recipients: Recipient[]) => Promise<void>,
  ): Promise<{ invalidCount: number }> {
    // MX12: push audiences resolve from WebPushSubscription
    // rows, never from contact address fields — a separate
    // resolver (below) owns that rule entirely.
    if (channel === "push") {
      return this.resolvePushAudienceInChunks(organizationId, audienceType, audienceSegment, chunkSize, onChunk);
    }
    // MX13: telegram audiences resolve from the org's telegram
    // ChannelConversation rows (the subscriber base — Telegram
    // bots cannot initiate contact, so every subscriber has
    // one), never from contact address fields — a separate
    // resolver (below) owns that rule entirely.
    if (channel === "telegram") {
      return this.resolveTelegramAudienceInChunks(organizationId, audienceType, audienceStage ?? null, audienceSegment ?? null, chunkSize, onChunk);
    }
    // MX14: onsite audiences resolve from the org's Customer
    // rows only — the notification center is keyed by the
    // customer account, so there is no anonymous reach and no
    // address to resolve leads/csv against. A separate resolver
    // (below) owns that rule entirely.
    if (channel === "onsite") {
      return this.resolveOnsiteAudienceInChunks(organizationId, audienceType, audienceSegment, chunkSize, onChunk);
    }
    const channelField = channel === "email" ? "email" : "phone";
    const hasAddress = (row: any) => (channelField === "email" ? row.email : row.phone);
    // Bounded buffer: flushes the moment it reaches chunkSize, so
    // at most chunkSize recipients are ever held by this layer.
    let buffer: Recipient[] = [];
    const emit = async (r: Recipient) => {
      buffer.push(r);
      if (buffer.length >= chunkSize) { const out = buffer; buffer = []; await onChunk(out); }
    };
    const flush = async () => { if (buffer.length) { const out = buffer; buffer = []; await onChunk(out); } };

    if (audienceType === "customers") {
      await this.scanInChunks((this.prisma as any).customer, { organizationId }, async (rows) => {
        for (const c of rows) {
          if (!hasAddress(c)) continue;
          await emit({ type: "customer" as const, id: c.id, name: MessagingService.customerName(c), email: c.email, phone: c.phone });
        }
      });
      await flush();
      return { invalidCount: 0 };
    }
    if (audienceType === "leads_stage") {
      if (!audienceStage) throw badRequest("messaging.audienceStageIsRequiredForLeadsStage");
      await this.scanInChunks((this.prisma as any).lead, { organizationId, stage: audienceStage }, async (rows) => {
        for (const l of rows) {
          if (!hasAddress(l)) continue;
          await emit({ type: "lead" as const, id: l.id, name: l.name, email: l.email, phone: l.phone });
        }
      });
      await flush();
      return { invalidCount: 0 };
    }
    if (audienceType === "segment") {
      if (!audienceSegment) throw badRequest("messaging.audienceSegmentIsRequiredForSegmentAudience");
      const rows = await computeRfm(this.prisma as any, organizationId);
      for (const r of rows) {
        if (r.segment !== audienceSegment) continue;
        if (!(channelField === "email" ? r.email : r.phone)) continue;
        await emit({ type: "customer" as const, id: r.customerId, name: r.name, email: r.email, phone: r.phone });
      }
      await flush();
      return { invalidCount: 0 };
    }
    if (audienceType === "custom") {
      const def = this.assertValidDefinition(extras?.audienceDefinition);
      await this.resolveCustomAudienceInChunks(organizationId, channel, def, chunkSize, onChunk);
      return { invalidCount: 0 };
    }
    if (audienceType === "saved") {
      if (!extras?.audienceSavedId) throw badRequest("messaging.audienceSavedIdIsRequiredForSavedAudience");
      const saved = await (this.prisma as any).messagingSavedAudience?.findFirst({
        where: { id: extras.audienceSavedId, organizationId },
      }).catch(() => null);
      if (!saved) {
        // Deliberate (MS3): deleting a saved audience a DRAFT still
        // references is allowed — the draft then fails HERE,
        // honestly, instead of silently widening to something else.
        throw badRequest("messaging.savedAudienceNoLongerExistsIt");
      }
      const def = this.assertValidDefinition(saved.definition);
      await this.resolveCustomAudienceInChunks(organizationId, channel, def, chunkSize, onChunk);
      return { invalidCount: 0 };
    }
    if (audienceType === "csv") {
      const { recipients, invalidCount } = await this.resolveCsvAudience(organizationId, channel, extras?.audienceCsv);
      for (let i = 0; i < recipients.length; i += chunkSize) await onChunk(recipients.slice(i, i + chunkSize));
      return { invalidCount };
    }
    throw badRequest("messaging.audienceTypeMustBeCustomersLeadsStage");
  }

  /**
   * MX12 — THE push audience resolution rule (recorded in
   * docs/messaging-mx12-acceptance.md): recipients come ONLY
   * from ACTIVE WebPushSubscription rows of this org — a "gone"
   * subscription is never resolved, and a subscription is
   * consent for PUSH ONLY (it never makes the contact reachable
   * on email/sms/whatsapp, and no email/phone audience ever
   * reaches a subscription). Supported audience types:
   *  - "push_subscribers": every active subscription of the
   *    org — the audience the base AX16 system itself uses,
   *    including anonymous storefront visitors.
   *  - "customers": only subscriptions carrying a customerId
   *    (identified subscribers), one recipient PER
   *    SUBSCRIPTION — a customer with two subscribed devices
   *    is two recipients (dedupe is by subscription, see
   *    recipientDedupeKey). The recipient keeps type/id of the
   *    customer (vars, revenue and frequency keys stay
   *    person-level) and carries the subscription identity
   *    alongside.
   *  - "segment": subscriptions whose customerId belongs to
   *    the named RFM segment (computeRfm, the same source the
   *    contact-address segment path uses).
   * Every other audience type is an honest 400 here (and at
   * create): subscriptions carry a customerId only — there is
   * no lead linkage to resolve leads_stage/custom/saved/csv
   * against, and inventing one would mis-target real people.
   * Customer name/email/phone are loaded from the real Customer
   * row when the subscription is identified (a since-deleted
   * customer degrades to an anonymous "push" recipient — the
   * subscription itself is still the org's real subscriber).
   */
  private async resolvePushAudienceInChunks(
    organizationId: string, audienceType: string, audienceSegment: string | undefined,
    chunkSize: number, onChunk: (recipients: Recipient[]) => Promise<void>,
  ): Promise<{ invalidCount: number }> {
    if (!["push_subscribers", "customers", "segment"].includes(audienceType)) {
      throw badRequest("messaging.audienceTypeAudienceTypeIsNotAvailableFor", { audienceType: audienceType });
    }
    let segmentCustomerIds: Set<string> | null = null;
    if (audienceType === "segment") {
      if (!audienceSegment) throw badRequest("messaging.audienceSegmentIsRequiredForSegmentAudience");
      const rows = await computeRfm(this.prisma as any, organizationId);
      segmentCustomerIds = new Set(rows.filter((r) => r.segment === audienceSegment).map((r) => r.customerId));
    }
    const subTable = (this.prisma as any).webPushSubscription;
    if (!subTable || typeof subTable.findMany !== "function") {
      throw badRequest("messaging.webPushSubscriptionsAreNotAvailable");
    }
    let buffer: Recipient[] = [];
    const emit = async (r: Recipient) => {
      buffer.push(r);
      if (buffer.length >= chunkSize) { const out = buffer; buffer = []; await onChunk(out); }
    };
    const flush = async () => { if (buffer.length) { const out = buffer; buffer = []; await onChunk(out); } };
    await this.scanInChunks(subTable, { organizationId, status: "active" }, async (subs) => {
      // Identified subscriptions: load their real customer rows
      // for this chunk (name + contact fields for vars/report).
      const customerIds = [...new Set((subs as any[]).map((sub) => sub.customerId).filter(Boolean))];
      const customersById = new Map<string, any>();
      if (customerIds.length) {
        const rows: any[] = await (this.prisma as any).customer.findMany({
          where: { organizationId, id: { in: customerIds } },
        }).catch(() => []);
        for (const c of rows ?? []) customersById.set(c.id, c);
      }
      for (const sub of subs as any[]) {
        const customer = sub.customerId ? customersById.get(sub.customerId) : null;
        if (audienceType === "customers" && !customer) continue;
        if (segmentCustomerIds && !(sub.customerId && segmentCustomerIds.has(sub.customerId))) continue;
        await emit({
          type: customer ? "customer" : "push",
          id: customer ? customer.id : sub.id,
          name: customer ? MessagingService.customerName(customer) : "Push subscriber",
          email: customer?.email ?? null,
          phone: customer?.phone ?? null,
          pushSubscriptionId: sub.id,
          pushEndpoint: sub.endpoint,
        });
      }
    });
    await flush();
    return { invalidCount: 0 };
  }

  /**
   * MX13 — telegram audiences resolve from the org's telegram
   * ChannelConversation rows (Conversation model via the
   * channelConversation delegate), never from contact address
   * fields. Telegram bots cannot initiate contact, so every
   * subscriber HAS such a conversation — it IS the subscriber
   * base (the order bot's BotSession rows are per-conversation
   * state-machine state, NOT a registry; no recipient is ever
   * resolved from them). The conversation's externalContactId
   * is the chat id (the telegram channel address — unusable
   * rows, a blank chat id, are skipped); its customerId/leadId
   * linkage, where the inbox identified the sender, upgrades
   * the recipient to that customer/lead. Supported:
   *   - telegram_subscribers: every telegram conversation of
   *     the org — anonymous ones as type "telegram" (id = the
   *     conversation id), linked ones as their customer/lead;
   *   - customers: conversations linked to a real Customer row;
   *   - leads_stage: conversations linked to a real Lead whose
   *     stage equals audienceStage (audienceStage is REQUIRED);
   *   - segment: conversations whose linked customer sits in
   *     the RFM segment (computeRfm, like other channels).
   * custom / saved / csv definitions are REFUSED: they are
   * keyed on email/phone addresses, and a chat id is neither —
   * resolving them against chats would fabricate an audience.
   * Dedupe is per chat id (the schema's unique
   * [organizationId, channel, externalContactId] already gives
   * one conversation per chat; the guard here keeps two rows
   * from ever double-emitting one chat defensively). The
   * suppression / pending / topic / frequency-cap stages apply
   * unchanged downstream with channel "telegram" and address =
   * chat id (recipientPrefAddress + normalizePrefAddress).
   */
  private async resolveTelegramAudienceInChunks(
    organizationId: string, audienceType: string, audienceStage: string | null, audienceSegment: string | null,
    chunkSize: number, onChunk: (recipients: Recipient[]) => Promise<void>,
  ): Promise<{ invalidCount: number }> {
    if (audienceType === "custom" || audienceType === "saved" || audienceType === "csv") {
      throw badRequest("messaging.customSavedAndCSVAudiencesAre");
    }
    if (audienceType === "leads_stage" && !audienceStage) {
      throw badRequest("messaging.audienceStageIsRequiredForTheLeads");
    }
    let segmentIds: Set<string> | null = null;
    if (audienceType === "segment") {
      if (!audienceSegment || !RFM_SEGMENTS.includes(audienceSegment as any)) {
        throw badRequest("messaging.audienceSegmentMustBeOneOfRFM", { RFM_SEGMENTSJoin: RFM_SEGMENTS.join(", ") });
      }
      const rfm = await computeRfm(this.prisma as any, organizationId);
      segmentIds = new Set(rfm.filter((r) => r.segment === audienceSegment).map((r) => r.customerId));
    }
    let buffer: Recipient[] = [];
    const emit = async (r: Recipient) => {
      buffer.push(r);
      if (buffer.length >= chunkSize) { const out = buffer; buffer = []; await onChunk(out); }
    };
    const flush = async () => { if (buffer.length) { const out = buffer; buffer = []; await onChunk(out); } };
    const seenChats = new Set<string>();
    await this.scanInChunks((this.prisma as any).channelConversation, { organizationId, channel: "telegram" }, async (rows) => {
      for (const conv of rows) {
        const chatId = typeof conv?.externalContactId === "string" ? conv.externalContactId.trim() : "";
        if (!chatId || seenChats.has(chatId)) continue;
        seenChats.add(chatId);
        // The linked contact rows are read only when the
        // audience needs them (or to upgrade the recipient).
        let customer: any = null;
        if (conv.customerId) {
          customer = await (this.prisma as any).customer.findFirst({ where: { id: conv.customerId, organizationId } }).catch(() => null);
        }
        if (audienceType === "customers") {
          if (!customer) continue;
          await emit({ type: "customer", id: customer.id, name: MessagingService.customerName(customer), email: customer.email ?? null, phone: customer.phone ?? null, telegramChatId: chatId });
          continue;
        }
        if (audienceType === "segment") {
          if (!customer || !segmentIds!.has(customer.id)) continue;
          await emit({ type: "customer", id: customer.id, name: MessagingService.customerName(customer), email: customer.email ?? null, phone: customer.phone ?? null, telegramChatId: chatId });
          continue;
        }
        let lead: any = null;
        if (conv.leadId) {
          lead = await (this.prisma as any).lead.findFirst({ where: { id: conv.leadId, organizationId } }).catch(() => null);
        }
        if (audienceType === "leads_stage") {
          if (!lead || lead.stage !== audienceStage) continue;
          await emit({ type: "lead", id: lead.id, name: lead.name, email: lead.email ?? null, phone: lead.phone ?? null, telegramChatId: chatId });
          continue;
        }
        // telegram_subscribers (the channel's default audience):
        // the conversation itself is the recipient; identified
        // conversations upgrade to their customer, else lead.
        if (customer) {
          await emit({ type: "customer", id: customer.id, name: MessagingService.customerName(customer), email: customer.email ?? null, phone: customer.phone ?? null, telegramChatId: chatId });
        } else if (lead) {
          await emit({ type: "lead", id: lead.id, name: lead.name, email: lead.email ?? null, phone: lead.phone ?? null, telegramChatId: chatId });
        } else {
          await emit({ type: "telegram", id: conv.id, name: conv.contactName ?? "Telegram subscriber", telegramChatId: chatId });
        }
      }
    });
    await flush();
    return { invalidCount: 0 };
  }

  /**
   * MX14 — THE onsite audience resolution rule (recorded in
   * docs/messaging-mx14-acceptance.md): recipients are the org's
   * CUSTOMER rows — known identities only. The notification
   * center lives inside the shop account area (EC25: the account
   * identity IS the org-scoped Customer row, reached by phone-OTP
   * login), so a Customer row is exactly the identity a
   * notification can be delivered to; there is no anonymous
   * reach, no lead reach and no address-list reach on this
   * channel. Unlike email/sms, NO contact address is required:
   * the channel address is the customer id itself, so a customer
   * without an email/phone still receives the notification in
   * their center (a customer without a phone cannot complete the
   * phone-OTP login today — the notification waits in their
   * center; see the acceptance doc's limits register).
   * Supported audience types:
   *  - "customers": every Customer row of the org, one recipient
   *    per customer (dedupe is the shared `${type}:${id}` key —
   *    the scan is id-ascending over unique rows, so a customer
   *    can never be emitted twice).
   *  - "segment": customers whose id belongs to the named RFM
   *    segment (computeRfm, the same source every other channel
   *    uses — membership is by customerId, so no contact-address
   *    filter applies here either).
   * Every other audience type is an honest 400 here (and at
   * create): leads_stage names LEAD rows (no customer row to
   * notify), custom/saved definitions are keyed on email/phone
   * channel fields + address conditions, and csv is a pasted
   * address list — none of them can name a notification-center
   * account without fabricating an identity.
   * All resolver stages apply unchanged downstream with channel
   * "onsite" and address = customer id: suppression, pending
   * exclusion, topic choices, per-contact + org frequency caps,
   * the unsubscribed-column opt-out (customer rows), previous-
   * recipient and recent-days exclusions.
   */
  private async resolveOnsiteAudienceInChunks(
    organizationId: string, audienceType: string, audienceSegment: string | undefined,
    chunkSize: number, onChunk: (recipients: Recipient[]) => Promise<void>,
  ): Promise<{ invalidCount: number }> {
    if (!["customers", "segment"].includes(audienceType)) {
      throw badRequest("messaging.audienceTypeAudienceTypeIsNotAvailableFor2", { audienceType: audienceType });
    }
    let buffer: Recipient[] = [];
    const emit = async (r: Recipient) => {
      buffer.push(r);
      if (buffer.length >= chunkSize) { const out = buffer; buffer = []; await onChunk(out); }
    };
    const flush = async () => { if (buffer.length) { const out = buffer; buffer = []; await onChunk(out); } };
    if (audienceType === "segment") {
      if (!audienceSegment) throw badRequest("messaging.audienceSegmentIsRequiredForSegmentAudience");
      const rows = await computeRfm(this.prisma as any, organizationId);
      for (const r of rows) {
        if (r.segment !== audienceSegment) continue;
        await emit({ type: "customer" as const, id: r.customerId, name: r.name, email: r.email, phone: r.phone });
      }
      await flush();
      return { invalidCount: 0 };
    }
    await this.scanInChunks((this.prisma as any).customer, { organizationId }, async (rows) => {
      for (const c of rows) {
        await emit({ type: "customer" as const, id: c.id, name: MessagingService.customerName(c), email: c.email ?? null, phone: c.phone ?? null });
      }
    });
    await flush();
    return { invalidCount: 0 };
  }

  /**
   * MS3 — a validated builder definition over customers or leads.
   * Order facts come from the DATABASE aggregates
   * (computeOrderAggregates — the RFM partition approach); RFM
   * segments come from computeRfm itself, computed ONLY when a
   * condition actually needs them.
   */
  private async resolveCustomAudience(organizationId: string, channel: string, def: AudienceDefinition): Promise<Recipient[]> {
    const recipients: Recipient[] = [];
    await this.resolveCustomAudienceInChunks(organizationId, channel, def, BROADCAST_RECIPIENT_WRITE_CHUNK, async (chunk) => { recipients.push(...chunk); });
    return recipients;
  }

  /**
   * MX1 — the streaming form of resolveCustomAudience: entity
   * rows page through scanInChunks and each match is emitted in
   * bounded slices. The aggregate / RFM lookup maps are computed
   * exactly as before (only when a condition needs them).
   */
  private async resolveCustomAudienceInChunks(
    organizationId: string, channel: string, def: AudienceDefinition, chunkSize: number,
    onChunk: (recipients: Recipient[]) => Promise<void>,
  ): Promise<void> {
    const channelField = channel === "email" ? "email" : "phone";
    let buffer: Recipient[] = [];
    const emit = async (r: Recipient) => {
      buffer.push(r);
      if (buffer.length >= chunkSize) { const out = buffer; buffer = []; await onChunk(out); }
    };
    const flush = async () => { if (buffer.length) { const out = buffer; buffer = []; await onChunk(out); } };
    // MX11: engagement facts are built ONCE per resolve, only
    // when a condition actually reads them (the RFM discipline).
    const needsEngagement = def.conditions.some((c) => c.field === "engagement_score" || c.field === "predictive_segment");
    const engagementMap = needsEngagement ? await this.buildEngagementMap(organizationId).catch(() => null) : null;
    if (def.entity === "leads") {
      await this.scanInChunks((this.prisma as any).lead, { organizationId }, async (rows) => {
        for (const l of rows) {
          const matches = matchesAudienceDefinition(def, {
            source: l.source ?? null,
            createdDaysAgo: MessagingService.daysSince(l.createdAt),
            hasEmail: !!l.email, hasPhone: !!l.phone,
            customFields: l.customFields && typeof l.customFields === "object" ? l.customFields : null,
            stage: l.stage ?? null,
            tags: Array.isArray(l.tags) ? l.tags : [],
            valueMinor: l.valueMinor === null || l.valueMinor === undefined ? null : Number(l.valueMinor),
            engagementScore: engagementMap ? (engagementMap.get(`lead:${l.id}`)?.score ?? 0) : null,
            predictiveSegments: engagementMap ? (engagementMap.get(`lead:${l.id}`)?.segments ?? []) : [],
          });
          if (!matches) continue;
          if (!(channelField === "email" ? l.email : l.phone)) continue;
          await emit({ type: "lead" as const, id: l.id, name: l.name, email: l.email, phone: l.phone });
        }
      });
      await flush();
      return;
    }
    const needsAggregates = def.conditions.some((c) => ["orders_count", "total_spent_minor", "last_order_days_ago"].includes(c.field));
    const needsRfm = def.conditions.some((c) => c.field === "rfm_segment");
    const aggregates = needsAggregates || needsRfm ? await computeOrderAggregates(this.prisma as any, organizationId) : null;
    let segmentByCustomer: Map<string, string> | null = null;
    if (needsRfm) {
      const rfmRows = await computeRfm(this.prisma as any, organizationId);
      segmentByCustomer = new Map(rfmRows.map((r) => [r.customerId, r.segment]));
    }
    const now = Date.now();
    await this.scanInChunks((this.prisma as any).customer, { organizationId }, async (rows) => {
      for (const c of rows) {
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
          engagementScore: engagementMap ? (engagementMap.get(`customer:${c.id}`)?.score ?? 0) : null,
          predictiveSegments: engagementMap ? (engagementMap.get(`customer:${c.id}`)?.segments ?? []) : [],
        };
        if (!matchesAudienceDefinition(def, facts)) continue;
        if (!(channelField === "email" ? c.email : c.phone)) continue;
        await emit({ type: "customer" as const, id: c.id, name: MessagingService.customerName(c), email: c.email, phone: c.phone });
      }
    });
    await flush();
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
    if (!addresses.length) throw badRequest("messaging.audienceCsvHasNoAddressesPasteAt");
    if (addresses.length > CSV_AUDIENCE_CAP) {
      throw badRequest("messaging.cSVAudienceHasAddressesLengthAddressesOver", { addressesLength: addresses.length, CSV_AUDIENCE_CAP: CSV_AUDIENCE_CAP });
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
    if (!name) throw badRequest("messaging.aSavedAudienceNeedsAName");
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
    if (!row) throw notFound("messaging.savedAudienceNotFound");
    return row;
  }

  async updateSavedAudience(organizationId: string, actorId: string, audienceId: string, dto: { name?: string; definition?: unknown }) {
    const existing = await this.getSavedAudienceOrThrow(organizationId, audienceId);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) throw badRequest("messaging.aSavedAudienceNeedsAName");
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

  /**
   * MX2 — ALL tenant SMS gateways of this org in failover
   * order: the primary MessagingSenderConfig SMS config (its
   * smsPriority) interleaved by priority with the additional
   * MessagingSmsGatewayConfig rows (enabled + fully configured
   * only). Ties keep the primary first (insertion order). A
   * missing extra table (pre-MX2 deployment / fake fixture)
   * reads as "no extras" — the single-config behaviour.
   * Duplicate (gateway, senderId, key) configs are deduped so
   * the same gateway is never tried twice for one message.
   */
  private async resolveTenantSmsGateways(organizationId: string): Promise<TenantSmsConfig[]> {
    const out: TenantSmsConfig[] = [];
    const primary = await this.resolveTenantSms(organizationId);
    if (primary) out.push(primary);
    try {
      const rows: any[] = await (this.prisma as any).messagingSmsGatewayConfig?.findMany({
        where: { organizationId, isEnabled: true }, orderBy: { priority: "asc" },
      }) ?? [];
      for (const row of Array.isArray(rows) ? rows : []) {
        const cfg = tenantSmsFromGatewayRow(row);
        if (cfg) out.push(cfg);
      }
    } catch { /* no extras — single-config behaviour */ }
    const seen = new Set<string>();
    return out
      .map((cfg, i) => ({ cfg, i }))
      .sort((a, b) => (a.cfg.priority ?? 0) - (b.cfg.priority ?? 0) || a.i - b.i)
      .map(({ cfg }) => cfg)
      .filter((cfg) => {
        const key = `${cfg.gatewayKey ?? smsGatewayKey(cfg)}:${cfg.apiKey}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  /** MX2 — the safe (secret-free) list of additional SMS
   * gateways for the sender settings view. */
  private async listExtraSmsGatewaysSafe(organizationId: string): Promise<any[]> {
    try {
      const rows: any[] = await (this.prisma as any).messagingSmsGatewayConfig?.findMany({
        where: { organizationId }, orderBy: { priority: "asc" },
      }) ?? [];
      return (Array.isArray(rows) ? rows : []).map((r: any) => ({
        id: r.id, gateway: r.smsGateway, smsSenderId: r.smsSenderId, smsApiUrl: r.smsApiUrl ?? null,
        priority: r.priority ?? 10, isEnabled: r.isEnabled !== false,
        smsApiKeyConfigured: Boolean(r.smsApiKeyEncrypted),
      }));
    } catch { return []; }
  }

  /** MX2 — add an ADDITIONAL tenant SMS gateway (failover set).
   * Same honesty as updateTenantSms: no pre-save verification
   * exists for these gateways, so the first real send through
   * it is the proof — stated in the response note. */
  async addSmsGateway(organizationId: string, actorId: string, dto: {
    smsGateway?: string; smsApiKey?: string; smsSenderId?: string; smsApiUrl?: string; priority?: number;
  }) {
    if (!dto.smsGateway || !["sslwireless", "bulksmsbd", "alphasms"].includes(dto.smsGateway)) {
      throw badRequest("messaging.smsGatewayMustBeSslwirelessBulksmsbdOr");
    }
    if (!dto.smsSenderId) throw badRequest("messaging.anSMSSenderIDIsRequired");
    if (!dto.smsApiKey) throw badRequest("messaging.anSMSAPIKeyIsRequired");
    const priority = dto.priority === undefined ? 10 : dto.priority;
    if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
      throw badRequest("messaging.priorityMustBeAnIntegerBetween");
    }
    const row = await (this.prisma as any).messagingSmsGatewayConfig.create({
      data: {
        organizationId, smsGateway: dto.smsGateway, smsApiKeyEncrypted: seal(dto.smsApiKey),
        smsSenderId: dto.smsSenderId, smsApiUrl: dto.smsApiUrl || null, priority, isEnabled: true,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.sender_sms_gateway_add", entityType: "MessagingSmsGatewayConfig", entityId: row.id, metadata: { gateway: dto.smsGateway, senderId: dto.smsSenderId, priority } });
    return {
      id: row.id, gateway: row.smsGateway, smsSenderId: row.smsSenderId, priority: row.priority, isEnabled: true,
      note: "Saved as an additional failover gateway. SMS gateways offer no pre-save verification here — the first real send through it is the proof.",
    };
  }

  /** MX2 — remove an additional SMS gateway. The primary
   * config (MessagingSenderConfig) is NOT touched — clearing
   * it stays updateTenantSms's `clear` path. */
  async removeSmsGateway(organizationId: string, actorId: string, gatewayId: string) {
    const row = await (this.prisma as any).messagingSmsGatewayConfig?.findFirst({ where: { id: gatewayId, organizationId } }).catch(() => null);
    if (!row) throw notFound("messaging.sMSGatewayNotFound");
    await (this.prisma as any).messagingSmsGatewayConfig.delete({ where: { id: row.id } });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.sender_sms_gateway_remove", entityType: "MessagingSmsGatewayConfig", entityId: gatewayId, metadata: { gateway: row.smsGateway } });
    return { deleted: true };
  }

  /** The safe view only — secrets never leave the server. */
  async getSenderSettings(organizationId: string) {
    const row = await this.getSenderConfigRow(organizationId);
    const view = senderConfigSafeView(row, {
      emailConfigured: this.email.isConfigured(),
      smsConfigured: this.sms.isConfigured(),
    });
    // MX2: the additional failover gateways (secret-free view).
    return { ...view, smsGateways: await this.listExtraSmsGatewaysSafe(organizationId) };
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
      throw badRequest("messaging.tenantSMTPNeedsAtLeastA");
    }
    try {
      if (typeof (this.email as any).verifyTenantSmtp !== "function") throw new Error("Tenant SMTP verification is unavailable");
      await this.email.verifyTenantSmtp(candidate);
    } catch (e: any) {
      throw badRequest("messaging.sMTPVerificationFailedNothingWasSaved", { e: e?.message ?? String(e) });
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
      throw badRequest("messaging.smsGatewayMustBeSslwirelessBulksmsbdOr");
    }
    const senderId = dto.smsSenderId ?? existing?.smsSenderId ?? null;
    if (!senderId) throw badRequest("messaging.anSMSSenderIDIsRequired");
    const apiKeyEncrypted = dto.smsApiKey ? seal(dto.smsApiKey) : (existing?.smsApiKeyEncrypted ?? null);
    if (!apiKeyEncrypted) throw badRequest("messaging.anSMSAPIKeyIsRequired");
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
    whatsappMarketingCostPerMessageMinor?: number | null; whatsappUtilityCostPerMessageMinor?: number | null; whatsappAuthenticationCostPerMessageMinor?: number | null;
  }) {
    const data: Record<string, unknown> = {};
    for (const key of ["smsCostPerPartMinor", "whatsappCostPerMessageMinor", "emailCostPerMessageMinor", "whatsappMarketingCostPerMessageMinor", "whatsappUtilityCostPerMessageMinor", "whatsappAuthenticationCostPerMessageMinor"] as const) {
      if (dto[key] !== undefined) {
        const v = dto[key];
        if (v !== null && (!Number.isInteger(v) || (v as number) < 0)) {
          throw badRequest("messaging.keyMustBeANonNegative", { key: key });
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw badRequest("messaging.aValidTestRecipientEmailAddress");
    const tenantSmtp = await this.resolveTenantSmtp(organizationId);
    const locale = await resolveDocumentLocale(this.prisma as any, organizationId);
    const subject = catalogText("messaging.testEmailSubject", locale);
    const text = catalogText("messaging.testEmailText", locale);
    let result: { providerMessageId: string };
    let path: "tenant" | "platform";
    if (tenantSmtp && typeof (this.email as any).sendTenant === "function") {
      result = await this.email.sendTenant(organizationId, tenantSmtp, { to: address, subject, text });
      path = "tenant";
    } else if (this.email.isConfigured()) {
      result = await this.email.send({ to: address, subject, text });
      path = "platform";
    } else {
      throw badRequest("messaging.noEmailPathIsConfiguredFor");
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

  // ---------- MX15: governance (approval, budget, health, seeds) ----------

  /** MX15 — governance settings with the defensive-read
   * discipline of every other setting here: a missing row /
   * column / table reads as approval OFF and no caps, so
   * pre-MX15 fixtures and deployments behave byte-identically. */
  async getGovernanceSetting(organizationId: string): Promise<{
    approvalEnabled: boolean; broadcastCostCapMinor: number | null; monthlySpendCapMinor: number | null;
  }> {
    const fallback = { approvalEnabled: false, broadcastCostCapMinor: null as number | null, monthlySpendCapMinor: null as number | null };
    try {
      const row = await (this.prisma as any).messagingSetting?.findFirst({ where: { organizationId } });
      if (!row) return fallback;
      const cap = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);
      return {
        approvalEnabled: row.approvalEnabled === true,
        broadcastCostCapMinor: cap(row.broadcastCostCapMinor),
        monthlySpendCapMinor: cap(row.monthlySpendCapMinor),
      };
    } catch { return fallback; }
  }

  /** MX15 — an approver is an ACTIVE member of this org with
   * role OWNER or ADMIN (the roles that already govern sender /
   * settings writes). Defensive: an unreadable membership table
   * means NOT an approver (fail closed for approval decisions). */
  async isBroadcastApprover(organizationId: string, userId: string): Promise<boolean> {
    try {
      const m = await (this.prisma as any).membership?.findFirst({
        where: { organizationId, userId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } },
      });
      return !!m;
    } catch { return false; }
  }

  /** MX15 — true when this broadcast still needs an approval
   * decision under the org's CURRENT setting: approval is on AND
   * the row carries a pending/rejected approval state (or sits
   * in the pending_approval status). Broadcasts created while
   * approval was OFF carry no approval state and are never
   * retroactively gated. */
  private async approvalGateApplies(organizationId: string, broadcast: any): Promise<boolean> {
    if (!broadcast) return false;
    if (broadcast.status !== "pending_approval"
      && broadcast.approvalStatus !== "pending" && broadcast.approvalStatus !== "rejected") return false;
    const gov = await this.getGovernanceSetting(organizationId);
    return gov.approvalEnabled;
  }

  /** MX15 — the send/schedule/prepare gate. When approval is ON
   * and the broadcast awaits a decision, every path that could
   * queue, schedule or send it refuses with the state named. */
  async assertApprovalAllowsSend(organizationId: string, broadcast: any): Promise<void> {
    if (await this.approvalGateApplies(organizationId, broadcast)) {
      throw badRequest(broadcast.approvalStatus === "rejected" ? "messaging.broadcastRejectedInReviewCannotBe" : "messaging.broadcastPendingApprovalCannotBeSent");
    }
  }

  /** MX15 — approve a pending broadcast (four-eyes: the caller
   * must be an OWNER/ADMIN approver AND not the creator). The
   * decision + note land on the row and in the audit log. */
  async approveBroadcast(organizationId: string, actorId: string, broadcastId: string, note?: string) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    if (broadcast.status !== "pending_approval" || broadcast.approvalStatus !== "pending") {
      throw badRequest("messaging.thisBroadcastIsNotPendingApproval", { broadcastStatus: broadcast.status });
    }
    if (!(await this.isBroadcastApprover(organizationId, actorId))) {
      throw forbidden("messaging.onlyAnOWNEROrADMINMember");
    }
    if (broadcast.createdById === actorId) {
      throw forbidden("messaging.fourEyesRuleTheBroadcastS");
    }
    const approvalNote = note !== undefined && note !== null ? String(note).slice(0, 500) : null;
    const nextStatus = broadcast.scheduledAt && new Date(broadcast.scheduledAt).getTime() > Date.now() ? "scheduled" : "draft";
    const updated = await (this.prisma as any).broadcast.update({
      where: { id: broadcastId },
      data: { status: nextStatus, approvalStatus: "approved", approvedById: actorId, approvedAt: new Date(), approvalNote },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "broadcast.approve", entityType: "Broadcast", entityId: broadcastId,
      metadata: { createdById: broadcast.createdById, note: approvalNote, nextStatus },
    });
    const { recipientSnapshot: _s, ...rest } = updated as any;
    return { ...rest, progress: MessagingService.broadcastProgress(updated) };
  }

  /** MX15 — reject a pending broadcast: back to draft with the
   * rejected state kept, so the send gate still blocks it until
   * it is edited and re-submitted. Same four-eyes rule. */
  async rejectBroadcast(organizationId: string, actorId: string, broadcastId: string, note?: string) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    if (broadcast.status !== "pending_approval" || broadcast.approvalStatus !== "pending") {
      throw badRequest("messaging.thisBroadcastIsNotPendingApproval", { broadcastStatus: broadcast.status });
    }
    if (!(await this.isBroadcastApprover(organizationId, actorId))) {
      throw forbidden("messaging.onlyAnOWNEROrADMINMember2");
    }
    if (broadcast.createdById === actorId) {
      throw forbidden("messaging.fourEyesRuleTheBroadcastS2");
    }
    const approvalNote = note !== undefined && note !== null ? String(note).slice(0, 500) : null;
    const updated = await (this.prisma as any).broadcast.update({
      where: { id: broadcastId },
      data: { status: "draft", scheduledAt: null, approvalStatus: "rejected", approvedById: actorId, approvedAt: new Date(), approvalNote },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "broadcast.reject", entityType: "Broadcast", entityId: broadcastId,
      metadata: { createdById: broadcast.createdById, note: approvalNote },
    });
    const { recipientSnapshot: _s, ...rest } = updated as any;
    return { ...rest, progress: MessagingService.broadcastProgress(updated) };
  }

  /** MX15 — (re)submit a draft for approval: used after a
   * rejection (edit → submit again) and for a draft created
   * while approval was off that the org now wants reviewed.
   * Only meaningful while the org setting is ON. */
  async submitBroadcastForApproval(organizationId: string, actorId: string, broadcastId: string) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    const gov = await this.getGovernanceSetting(organizationId);
    if (!gov.approvalEnabled) throw badRequest("messaging.broadcastApprovalIsNotEnabledFor");
    if (broadcast.status !== "draft") {
      throw badRequest("messaging.onlyADraftBroadcastCanBe", { broadcastStatus: broadcast.status });
    }
    if (await this.isBroadcastApprover(organizationId, actorId)) {
      throw badRequest("messaging.approversOWNERADMINDoNotNeed");
    }
    const updated = await (this.prisma as any).broadcast.update({
      where: { id: broadcastId },
      data: { status: "pending_approval", approvalStatus: "pending", approvedById: null, approvedAt: null, approvalNote: null },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "broadcast.submit_approval", entityType: "Broadcast", entityId: broadcastId, metadata: {},
    });
    const { recipientSnapshot: _s, ...rest } = updated as any;
    return { ...rest, progress: MessagingService.broadcastProgress(updated) };
  }

  /** MX15 — the approval queue: broadcasts awaiting a decision. */
  async listApprovalQueue(organizationId: string) {
    const rows: any[] = await (this.prisma as any).broadcast.findMany({
      where: { organizationId, status: "pending_approval" }, orderBy: { createdAt: "asc" }, take: 100,
    }).catch(() => []);
    return rows.map((b: any) => {
      const { recipientSnapshot: _s, ...rest } = b;
      return { ...rest, progress: MessagingService.broadcastProgress(b) };
    });
  }

  /** MX15 — this calendar month's estimated spend (minor units)
   * from REAL sent broadcasts: each sent broadcast's confirmed
   * sentCount × the org-entered rate (buildCostEstimate). A sent
   * broadcast whose channel has no rate makes the figure
   * INCOMPLETE (never silently partial-as-total). */
  private async monthlySpendEstimate(organizationId: string, excludeBroadcastId?: string): Promise<{ totalMinor: number; complete: boolean }> {
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    let rows: any[] = [];
    try {
      rows = await (this.prisma as any).broadcast.findMany({
        where: { organizationId, sentAt: { gte: monthStart } }, take: 500,
      });
    } catch { return { totalMinor: 0, complete: false }; }
    let total = 0; let complete = true;
    for (const b of rows ?? []) {
      if (excludeBroadcastId && b.id === excludeBroadcastId) continue;
      const sent = Number(b.sentCount ?? 0);
      if (!sent) continue;
      let category: string | null = null;
      if (b.channel === "whatsapp" && b.whatsappTemplateId) {
        const tpl = await (this.prisma as any).whatsAppTemplate?.findFirst({ where: { id: b.whatsappTemplateId, organizationId } }).catch(() => null);
        category = tpl?.category ?? null;
      }
      const est = await this.buildCostEstimate(organizationId, b.channel, sent, b.body, category).catch(() => null);
      if (!est || typeof est.totalMinor !== "number") { complete = false; continue; }
      total += est.totalMinor;
    }
    return { totalMinor: total, complete };
  }

  /** MX15 — the budget decision for one broadcast about to send.
   * Estimate = org-entered rate × planned recipients (the same
   * buildCostEstimate the preview shows). Spend-based only —
   * there is no messaging balance to check against. */
  async checkBroadcastBudget(organizationId: string, broadcast: any, recipientCount: number): Promise<BudgetDecision> {
    const gov = await this.getGovernanceSetting(organizationId);
    const perBroadcastCapMinor = Number.isInteger((broadcast as any).budgetCapMinor) && (broadcast as any).budgetCapMinor > 0
      ? (broadcast as any).budgetCapMinor : gov.broadcastCostCapMinor;
    let category: string | null = null;
    if (broadcast.channel === "whatsapp" && broadcast.whatsappTemplateId) {
      const tpl = await (this.prisma as any).whatsAppTemplate?.findFirst({ where: { id: broadcast.whatsappTemplateId, organizationId } }).catch(() => null);
      category = tpl?.category ?? null;
    }
    const est = await this.buildCostEstimate(organizationId, broadcast.channel, recipientCount, broadcast.body, category).catch(() => null);
    let monthlySpentMinor: number | null = null;
    let monthlyEstimateComplete = true;
    if (gov.monthlySpendCapMinor !== null) {
      const m = await this.monthlySpendEstimate(organizationId, broadcast.id);
      monthlySpentMinor = m.totalMinor; monthlyEstimateComplete = m.complete;
    }
    return decideBudget({
      estimateMinor: est && typeof est.totalMinor === "number" ? est.totalMinor : null,
      basis: est?.basis ?? null,
      perBroadcastCapMinor, monthlyCapMinor: gov.monthlySpendCapMinor,
      monthlySpentMinor, monthlyEstimateComplete,
    });
  }

  /** MX15 — throwing form of the budget check, called by the
   * send choke point before any provider call of a fresh send. */
  async assertBudgetAllowsSend(organizationId: string, broadcast: any, recipientCount: number): Promise<BudgetDecision> {
    const decision = await this.checkBroadcastBudget(organizationId, broadcast, recipientCount);
    if (decision.decision === "block") {
      throw badRequest("messaging.budgetCapSpendBasedFromYour", { blockReason: decision.blockReason });
    }
    return decision;
  }

  /** MX15 — delivery health over a stated window, computed from
   * REAL MessageDelivery rows. Per-sender rates are null: a
   * delivery row carries no sender identity (the org has at most
   * one tenant SMTP + the platform path, chosen per send and not
   * recorded per delivery), so no per-sender figure is invented;
   * the SPF/DKIM domain-health view rides along instead. */
  async getDeliveryHealth(organizationId: string, daysInput?: number) {
    const days = Number.isInteger(daysInput) && (daysInput as number) >= 1 && (daysInput as number) <= 90 ? (daysInput as number) : 30;
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    let rows: any[] | null = null;
    try {
      rows = await (this.prisma as any).messageDelivery.findMany({
        where: { organizationId, createdAt: { gte: since } }, take: 50000,
        select: { channel: true, status: true, deliveryStatus: true, deliveredAt: true, readAt: true, error: true },
      });
    } catch { rows = null; }
    const domainHealth = await this.getDomainHealth(organizationId).catch(() => null);
    if (!rows) {
      return {
        windowDays: days, available: false,
        reason: "Delivery records could not be read, so no health figures are shown (never invented).",
        channels: [], totals: null, bounceRate: null, complaintRate: null, bounceComplaintNote: BOUNCE_COMPLAINT_NOTE,
        perSender: null, perSenderNote: "Per-sender rates are null: MessageDelivery rows record no sender identity, so no per-sender figure can be honestly computed.",
        domainHealth,
      };
    }
    const channels = aggregateChannelHealth(rows as any);
    const sent = rows.filter((r: any) => r.status === "sent").length;
    const failed = rows.filter((r: any) => r.status === "failed").length;
    return {
      windowDays: days, available: true, since: since.toISOString(),
      channels,
      totals: {
        deliveries: rows.length, sent, failed,
        skipped: rows.filter((r: any) => r.status === "skipped").length,
        failureRate: sent + failed > 0 ? Math.round((failed / (sent + failed)) * 10000) / 10000 : null,
        bounceRate: null, complaintRate: null,
      },
      bounceComplaintNote: BOUNCE_COMPLAINT_NOTE,
      perSender: null,
      perSenderNote: "Per-sender rates are null: MessageDelivery rows record no sender identity (tenant SMTP vs platform path is chosen per send and not stored per delivery), so no per-sender figure can be honestly computed. Domain (SPF/DKIM) health is shown instead.",
      domainHealth,
      autoSuppression: "WhatsApp webhook failures that identify the recipient as unreachable / not on WhatsApp now auto-suppress that address in the preference store (source \"auto_suppression\"). No email bounce/complaint webhook exists in this system, so no other channel has an auto-suppression path to close.",
    };
  }

  /** MX15 — pre-send checklist v2 (extends MS5's composeCheck;
   * the v1 warnings ride along verbatim). The recipient sample
   * is REAL: when an audience is supplied it is resolved through
   * the same resolver a send uses and its vars are built by the
   * same buildSnapshotVars — capped at 5 recipients. */
  async checkComposeV2(organizationId: string, dto: {
    channel: string; subject?: string; body: string; htmlBody?: string | null;
    audienceType?: string; audienceStage?: string; audienceSegment?: string;
  } & AudienceExtras) {
    if (!["email", "sms", "whatsapp", "push", "telegram", "onsite"].includes(dto.channel)) throw badRequest("messaging.channelMustBeEmailSmsWhatsapp");
    const setting = await this.getMessagingSetting(organizationId);
    let sampleVars: Record<string, unknown>[] | null = null;
    if (dto.audienceType) {
      try {
        const resolved = await this.resolveBroadcastRecipients(organizationId, {
          channel: dto.channel, audienceType: dto.audienceType, audienceStage: dto.audienceStage,
          audienceSegment: dto.audienceSegment,
          audienceDefinition: (dto as any).audienceDefinition, audienceSavedId: (dto as any).audienceSavedId,
          audienceCsv: (dto as any).audienceCsv, topic: (dto as any).topic,
        });
        const sample = resolved.recipients.slice(0, 5);
        if (sample.length) sampleVars = await this.buildSnapshotVars(organizationId, sample);
      } catch { sampleVars = null; }
    }
    const locale = await resolveDocumentLocale(this.prisma as any, organizationId);
    return composeCheckV2({
      channel: dto.channel, subject: dto.subject, body: dto.body, htmlBody: dto.htmlBody ?? null,
      linkTrackingEnabled: setting.linkTrackingEnabled, sampleVars, imageAssets: [], locale,
    });
  }

  // ---------- MX15: seed / test recipient list ----------

  async listSeedRecipients(organizationId: string) {
    const rows: any[] = await (this.prisma as any).messagingSeedRecipient?.findMany({
      where: { organizationId }, orderBy: { createdAt: "asc" }, take: 200,
    }).catch(() => []) ?? [];
    return rows;
  }

  async addSeedRecipient(organizationId: string, actorId: string, dto: { channel: string; address: string; label?: string }) {
    if (!["email", "sms", "whatsapp", "telegram"].includes(dto.channel)) {
      throw badRequest("messaging.channelMustBeEmailSmsWhatsapp2");
    }
    const address = this.validatePrefAddress(dto.channel, dto.address);
    const table = (this.prisma as any).messagingSeedRecipient;
    if (!table?.create) throw badRequest("messaging.seedRecipientStorageIsNotAvailable");
    const existing = await table.findFirst({ where: { organizationId, channel: dto.channel, address } }).catch(() => null);
    if (existing) return existing;
    const row = await table.create({
      data: { organizationId, channel: dto.channel, address, label: dto.label ? String(dto.label).slice(0, 100) : null, createdById: actorId },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.seed_add", entityType: "MessagingSeedRecipient", entityId: row.id, metadata: { channel: dto.channel, address } });
    return row;
  }

  async removeSeedRecipient(organizationId: string, actorId: string, seedId: string) {
    const table = (this.prisma as any).messagingSeedRecipient;
    const row = await table?.findFirst({ where: { id: seedId, organizationId } }).catch(() => null);
    if (!row) throw notFound("messaging.seedRecipientNotFound");
    await table.delete({ where: { id: seedId } });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.seed_remove", entityType: "MessagingSeedRecipient", entityId: seedId, metadata: { channel: row.channel, address: row.address } });
    return { deleted: true, id: seedId };
  }

  /** MX15 — one-click test send to a seed recipient, through the
   * EXISTING MS5 broadcast test-send path verbatim (no new send
   * machinery). The seed's channel must match the broadcast's. */
  async testSendBroadcastToSeed(organizationId: string, actorId: string, broadcastId: string, seedId: string) {
    const seed = await (this.prisma as any).messagingSeedRecipient?.findFirst({ where: { id: seedId, organizationId } }).catch(() => null);
    if (!seed) throw notFound("messaging.seedRecipientNotFound");
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    if (broadcast.channel !== seed.channel) {
      throw badRequest("messaging.seedRecipientIsAChannelAddress", { channel: seed.channel, channel2: broadcast.channel });
    }
    return this.testSendBroadcast(organizationId, actorId, broadcastId, seed.address);
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

  /**
   * MX9 — the WhatsApp quality guard switch. Defensive like the
   * other setting reads: a missing row / column / table reads as
   * OFF (the schema default), so pre-MX9 fixtures and deployments
   * behave byte-identically.
   */
  async getWhatsAppQualityGuardEnabled(organizationId: string): Promise<boolean> {
    try {
      const row = await (this.prisma as any).messagingSetting?.findFirst({ where: { organizationId } });
      return row?.whatsappQualityGuardEnabled === true;
    } catch {
      return false;
    }
  }

  /**
   * MX9 — refuse a NEW broadcast send through a template whose
   * REAL Meta-synced state is low (quality RED or status
   * REJECTED) when the org enabled the quality guard. Templates
   * with no synced quality data are never refused here. Called
   * at broadcast create (primary, A/B and cascade templates),
   * at broadcast edit (template swap) and again when the
   * WhatsApp sender is built at send time — a template that
   * turns RED between create and send stops the send, with this
   * reason recorded on every pending entry by the engine's
   * build-error path.
   */
  async assertWhatsAppTemplateNotQualityBlocked(organizationId: string, template: { name?: string | null; qualityRating?: string | null; status?: string | null } | null | undefined): Promise<void> {
    if (!template) return;
    const enabled = await this.getWhatsAppQualityGuardEnabled(organizationId);
    const locale = await resolveDocumentLocale(this.prisma as any, organizationId);
    const decision = qualityGuardDecision(enabled, template, locale);
    if (decision.blocked) throw new BadRequestException(decision.reason);
  }

  /**
   * MX3 — the org's timezone for quiet-hours evaluation:
   * Organization.timezone (a real schema field, default
   * "Asia/Dhaka"). Defensive: a missing delegate / row / value,
   * or a value Intl cannot evaluate, falls back to the schema
   * default — the decision + evidence are recorded in
   * docs/messaging-mx3-acceptance.md. MX3 adds NO timezone
   * field of its own: the org timezone already exists.
   */
  async getOrgTimezone(organizationId: string): Promise<string> {
    try {
      const org = await (this.prisma as any).organization?.findUnique?.({ where: { id: organizationId }, select: { timezone: true } });
      if (isValidTimeZone(org?.timezone)) return org.timezone;
    } catch { /* fall through to the schema default */ }
    return QUIET_HOURS_FALLBACK_TIMEZONE;
  }

  /**
   * MX3 — the org's marketing-stream controls: per-sweep caps
   * (null setting = platform defaults, i.e. pre-MX3 behaviour)
   * and the quiet-hours window evaluated against `now` in the
   * org's timezone. Defensive like getMessagingSetting: a
   * missing row / column / table reads as the defaults with
   * quiet hours OFF, so pre-MX3 fixtures and deployments are
   * byte-identical.
   */
  async getStreamSetting(organizationId: string, now: Date = new Date()): Promise<{
    marketingMaxBroadcastsPerSweep: number | null;
    marketingMaxEntriesPerSweep: number | null;
    effectiveMaxBroadcastsPerSweep: number;
    effectiveMaxEntriesPerSweep: number;
    quietHoursEnabled: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    timezone: string;
    quietHoursActive: boolean;
  }> {
    let row: any = null;
    try {
      row = await (this.prisma as any).messagingSetting?.findFirst({ where: { organizationId } });
    } catch { row = null; }
    const capBroadcasts = Number.isInteger(row?.marketingMaxBroadcastsPerSweep) && row.marketingMaxBroadcastsPerSweep >= 1
      ? row.marketingMaxBroadcastsPerSweep : null;
    const capEntries = Number.isInteger(row?.marketingMaxEntriesPerSweep) && row.marketingMaxEntriesPerSweep >= 1
      ? row.marketingMaxEntriesPerSweep : null;
    const quietHoursStart = isValidHhMm(row?.quietHoursStart) ? row.quietHoursStart : null;
    const quietHoursEnd = isValidHhMm(row?.quietHoursEnd) ? row.quietHoursEnd : null;
    const quietHoursEnabled = row?.quietHoursEnabled === true && quietHoursStart !== null && quietHoursEnd !== null;
    const timezone = await this.getOrgTimezone(organizationId);
    return {
      marketingMaxBroadcastsPerSweep: capBroadcasts,
      marketingMaxEntriesPerSweep: capEntries,
      effectiveMaxBroadcastsPerSweep: capBroadcasts ?? MARKETING_SWEEP_DEFAULT_MAX_BROADCASTS,
      effectiveMaxEntriesPerSweep: capEntries ?? BROADCAST_SWEEP_MAX_ENTRIES,
      quietHoursEnabled,
      quietHoursStart,
      quietHoursEnd,
      timezone,
      quietHoursActive: isQuietHoursActive(
        { enabled: quietHoursEnabled, start: quietHoursStart, end: quietHoursEnd, timezone }, now,
      ),
    };
  }

  /** MX3 — the settings-endpoint view: the MS2/MS5 fields plus
   * the stream controls (configured caps + quiet hours + the
   * org timezone they are evaluated in + whether the window is
   * active right now). getMessagingSetting itself keeps its
   * exact pre-MX3 shape for its internal callers. */
  async getMessagingSettingsView(organizationId: string) {
    const base = await this.getMessagingSetting(organizationId);
    const stream = await this.getStreamSetting(organizationId);
    const whatsappQualityGuardEnabled = await this.getWhatsAppQualityGuardEnabled(organizationId);
    // MX11: the predictive thresholds are part of the settings
    // view (org-visible, like every other threshold here).
    const engagementThresholds = await this.getEngagementThresholds(organizationId);
    // MX15: governance (approval switch + spend caps).
    const governance = await this.getGovernanceSetting(organizationId);
    // MX16: the A/B auto-winner org switch (default OFF).
    const abAutoWinnerEnabled = await this.getAbAutoWinnerEnabled(organizationId);
    return { ...base, ...stream, whatsappQualityGuardEnabled, ...engagementThresholds, ...governance, abAutoWinnerEnabled };
  }

  /** MX16 — the A/B auto-winner ORG switch. Defensive like
   * every other setting read: a missing row / column / table
   * reads as OFF (owner decision D3: default OFF), so pre-MX16
   * fixtures and deployments behave byte-identically — the
   * per-broadcast report winner stays a suggestion only. */
  async getAbAutoWinnerEnabled(organizationId: string): Promise<boolean> {
    try {
      const row = await (this.prisma as any).messagingSetting?.findFirst({ where: { organizationId } });
      return row?.abAutoWinnerEnabled === true;
    } catch { return false; }
  }

  /** MS2 — strict settings write (leads followup-setting pattern):
   * cap must be an integer 0..20 (0 = off); opt-in a real boolean.
   * MS5 adds linkTrackingEnabled (a real boolean).
   * MX3 adds the marketing-stream controls: the sweep caps are
   * null (platform default) or integers in range; quiet hours
   * are a real boolean plus strict "HH:mm" bounds — enabling
   * requires both bounds set (after this write) and different,
   * because an empty window can only ever confuse. */
  async updateMessagingSetting(organizationId: string, actorId: string, dto: {
    frequencyCapPerDay?: number; whatsappOptInRequired?: boolean; linkTrackingEnabled?: boolean;
    marketingMaxBroadcastsPerSweep?: number | null; marketingMaxEntriesPerSweep?: number | null;
    quietHoursEnabled?: boolean; quietHoursStart?: string | null; quietHoursEnd?: string | null;
    whatsappQualityGuardEnabled?: boolean;
    // MX11: predictive-segment thresholds (strict ranges below).
    churnRiskSilentDays?: number; likelyToBuyMinScore?: number; highLtvMinSpentMinor?: number;
    unengagedSuppressDays?: number; unengagedMinSends?: number;
    // MX15: governance — approval switch + spend caps (minor
    // units; null clears a cap).
    approvalEnabled?: boolean; broadcastCostCapMinor?: number | null; monthlySpendCapMinor?: number | null;
    // MX16: A/B auto-winner org switch (default OFF).
    abAutoWinnerEnabled?: boolean;
  }) {
    const current = await this.getMessagingSetting(organizationId);
    const stream = await this.getStreamSetting(organizationId);
    const thresholds = await this.getEngagementThresholds(organizationId);
    let churnRiskSilentDays = thresholds.churnRiskSilentDays;
    let likelyToBuyMinScore = thresholds.likelyToBuyMinScore;
    let highLtvMinSpentMinor = thresholds.highLtvMinSpentMinor;
    let unengagedSuppressDays = thresholds.unengagedSuppressDays;
    let unengagedMinSends = thresholds.unengagedMinSends;
    let whatsappQualityGuardEnabled = await this.getWhatsAppQualityGuardEnabled(organizationId);
    let frequencyCapPerDay = current.frequencyCapPerDay;
    let whatsappOptInRequired = current.whatsappOptInRequired;
    let linkTrackingEnabled = current.linkTrackingEnabled;
    let marketingMaxBroadcastsPerSweep = stream.marketingMaxBroadcastsPerSweep;
    let marketingMaxEntriesPerSweep = stream.marketingMaxEntriesPerSweep;
    let quietHoursEnabled = stream.quietHoursEnabled;
    let quietHoursStart = stream.quietHoursStart;
    let quietHoursEnd = stream.quietHoursEnd;
    if (dto.frequencyCapPerDay !== undefined) {
      if (!Number.isInteger(dto.frequencyCapPerDay) || dto.frequencyCapPerDay < 0 || dto.frequencyCapPerDay > 20) {
        throw badRequest("messaging.frequencyCapPerDayMustBeAnIntegerBetween");
      }
      frequencyCapPerDay = dto.frequencyCapPerDay;
    }
    if (dto.whatsappOptInRequired !== undefined) {
      if (typeof dto.whatsappOptInRequired !== "boolean") throw badRequest("messaging.whatsappOptInRequiredMustBeABoolean");
      whatsappOptInRequired = dto.whatsappOptInRequired;
    }
    if (dto.linkTrackingEnabled !== undefined) {
      if (typeof dto.linkTrackingEnabled !== "boolean") throw badRequest("messaging.linkTrackingEnabledMustBeABoolean");
      linkTrackingEnabled = dto.linkTrackingEnabled;
    }
    if (dto.marketingMaxBroadcastsPerSweep !== undefined) {
      if (dto.marketingMaxBroadcastsPerSweep !== null
        && (!Number.isInteger(dto.marketingMaxBroadcastsPerSweep) || dto.marketingMaxBroadcastsPerSweep < 1 || dto.marketingMaxBroadcastsPerSweep > MARKETING_SWEEP_MAX_BROADCASTS_LIMIT)) {
        throw badRequest("messaging.marketingMaxBroadcastsPerSweepMustBeNullPlatformDefa", { MARKETING_SWEEP_MAX_BROADCASTS_LIMIT: MARKETING_SWEEP_MAX_BROADCASTS_LIMIT });
      }
      marketingMaxBroadcastsPerSweep = dto.marketingMaxBroadcastsPerSweep;
    }
    if (dto.marketingMaxEntriesPerSweep !== undefined) {
      if (dto.marketingMaxEntriesPerSweep !== null
        && (!Number.isInteger(dto.marketingMaxEntriesPerSweep) || dto.marketingMaxEntriesPerSweep < 1 || dto.marketingMaxEntriesPerSweep > MARKETING_SWEEP_MAX_ENTRIES_LIMIT)) {
        throw badRequest("messaging.marketingMaxEntriesPerSweepMustBeNullPlatformDefault", { MARKETING_SWEEP_MAX_ENTRIES_LIMIT: MARKETING_SWEEP_MAX_ENTRIES_LIMIT });
      }
      marketingMaxEntriesPerSweep = dto.marketingMaxEntriesPerSweep;
    }
    if (dto.quietHoursEnabled !== undefined) {
      if (typeof dto.quietHoursEnabled !== "boolean") throw badRequest("messaging.quietHoursEnabledMustBeABoolean");
      quietHoursEnabled = dto.quietHoursEnabled;
    }
    if (dto.quietHoursStart !== undefined) {
      if (dto.quietHoursStart !== null && !isValidHhMm(dto.quietHoursStart)) {
        throw badRequest("messaging.quietHoursStartMustBeNullOrA");
      }
      quietHoursStart = dto.quietHoursStart;
    }
    if (dto.quietHoursEnd !== undefined) {
      if (dto.quietHoursEnd !== null && !isValidHhMm(dto.quietHoursEnd)) {
        throw badRequest("messaging.quietHoursEndMustBeNullOrA");
      }
      quietHoursEnd = dto.quietHoursEnd;
    }
    if (dto.whatsappQualityGuardEnabled !== undefined) {
      if (typeof dto.whatsappQualityGuardEnabled !== "boolean") throw badRequest("messaging.whatsappQualityGuardEnabledMustBeABoolean");
      whatsappQualityGuardEnabled = dto.whatsappQualityGuardEnabled;
    }
    // MX11: predictive thresholds — strict integer ranges, the
    // same discipline as the frequency cap.
    const thresholdField = (name: string, value: number | undefined, min: number, max: number, apply: (v: number) => void) => {
      if (value === undefined) return;
      if (!Number.isInteger(value) || value < min || value > max) {
        throw badRequest("messaging.nameMustBeAnIntegerBetween", { name: name, min: min, max: max });
      }
      apply(value);
    };
    thresholdField("churnRiskSilentDays", dto.churnRiskSilentDays, 1, 3650, (v) => { churnRiskSilentDays = v; });
    thresholdField("likelyToBuyMinScore", dto.likelyToBuyMinScore, 0, 100, (v) => { likelyToBuyMinScore = v; });
    thresholdField("highLtvMinSpentMinor", dto.highLtvMinSpentMinor, 0, 1000000000, (v) => { highLtvMinSpentMinor = v; });
    thresholdField("unengagedSuppressDays", dto.unengagedSuppressDays, 1, 3650, (v) => { unengagedSuppressDays = v; });
    thresholdField("unengagedMinSends", dto.unengagedMinSends, 1, 1000, (v) => { unengagedMinSends = v; });
    // MX15: governance fields — approval a real boolean; caps
    // null (cleared) or a positive integer of minor units.
    const governance = await this.getGovernanceSetting(organizationId);
    let approvalEnabled = governance.approvalEnabled;
    let broadcastCostCapMinor = governance.broadcastCostCapMinor;
    let monthlySpendCapMinor = governance.monthlySpendCapMinor;
    if (dto.approvalEnabled !== undefined) {
      if (typeof dto.approvalEnabled !== "boolean") throw badRequest("messaging.approvalEnabledMustBeABoolean");
      approvalEnabled = dto.approvalEnabled;
    }
    const capField = (name: string, value: number | null | undefined, apply: (v: number | null) => void) => {
      if (value === undefined) return;
      if (value !== null && (!Number.isInteger(value) || value < 1 || value > 1000000000)) {
        throw badRequest("messaging.nameMustBeNullNoCap", { name: name });
      }
      apply(value);
    };
    capField("broadcastCostCapMinor", dto.broadcastCostCapMinor, (v) => { broadcastCostCapMinor = v; });
    capField("monthlySpendCapMinor", dto.monthlySpendCapMinor, (v) => { monthlySpendCapMinor = v; });
    // MX16: auto-winner org switch — a real boolean.
    let abAutoWinnerEnabled = await this.getAbAutoWinnerEnabled(organizationId);
    if (dto.abAutoWinnerEnabled !== undefined) {
      if (typeof dto.abAutoWinnerEnabled !== "boolean") throw badRequest("messaging.abAutoWinnerEnabledMustBeABoolean");
      abAutoWinnerEnabled = dto.abAutoWinnerEnabled;
    }
    if (quietHoursEnabled) {
      if (!quietHoursStart || !quietHoursEnd) {
        throw badRequest("messaging.quietHoursStartAndQuietHoursEndAreBothRequired");
      }
      if (quietHoursStart === quietHoursEnd) {
        throw badRequest("messaging.quietHoursStartAndQuietHoursEndMustDifferAn");
      }
    }
    const data = {
      frequencyCapPerDay, whatsappOptInRequired, linkTrackingEnabled,
      marketingMaxBroadcastsPerSweep, marketingMaxEntriesPerSweep,
      quietHoursEnabled, quietHoursStart, quietHoursEnd,
      whatsappQualityGuardEnabled,
      churnRiskSilentDays, likelyToBuyMinScore, highLtvMinSpentMinor,
      unengagedSuppressDays, unengagedMinSends,
      approvalEnabled, broadcastCostCapMinor, monthlySpendCapMinor,
      abAutoWinnerEnabled,
    };
    const existing = await (this.prisma as any).messagingSetting.findFirst({ where: { organizationId } }).catch(() => null);
    const row = existing
      ? await (this.prisma as any).messagingSetting.update({ where: { id: existing.id }, data })
      : await (this.prisma as any).messagingSetting.create({ data: { organizationId, ...data } });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.settings_update", entityType: "MessagingSetting", entityId: row.id, metadata: data });
    return {
      frequencyCapPerDay: row.frequencyCapPerDay, whatsappOptInRequired: row.whatsappOptInRequired,
      linkTrackingEnabled: typeof row.linkTrackingEnabled === "boolean" ? row.linkTrackingEnabled : linkTrackingEnabled,
      marketingMaxBroadcastsPerSweep: row.marketingMaxBroadcastsPerSweep ?? null,
      marketingMaxEntriesPerSweep: row.marketingMaxEntriesPerSweep ?? null,
      quietHoursEnabled: row.quietHoursEnabled === true,
      quietHoursStart: row.quietHoursStart ?? null,
      quietHoursEnd: row.quietHoursEnd ?? null,
      whatsappQualityGuardEnabled: row.whatsappQualityGuardEnabled === true,
      churnRiskSilentDays: Number.isInteger(row.churnRiskSilentDays) ? row.churnRiskSilentDays : churnRiskSilentDays,
      likelyToBuyMinScore: Number.isInteger(row.likelyToBuyMinScore) ? row.likelyToBuyMinScore : likelyToBuyMinScore,
      highLtvMinSpentMinor: Number.isInteger(row.highLtvMinSpentMinor) ? row.highLtvMinSpentMinor : highLtvMinSpentMinor,
      unengagedSuppressDays: Number.isInteger(row.unengagedSuppressDays) ? row.unengagedSuppressDays : unengagedSuppressDays,
      unengagedMinSends: Number.isInteger(row.unengagedMinSends) ? row.unengagedMinSends : unengagedMinSends,
      approvalEnabled: row.approvalEnabled === true,
      broadcastCostCapMinor: Number.isInteger(row.broadcastCostCapMinor) ? row.broadcastCostCapMinor : broadcastCostCapMinor,
      monthlySpendCapMinor: Number.isInteger(row.monthlySpendCapMinor) ? row.monthlySpendCapMinor : monthlySpendCapMinor,
      abAutoWinnerEnabled: row.abAutoWinnerEnabled === true,
    };
  }

  /**
   * MX3 — the unified READ-ONLY transactional view (owner
   * decision D4: combined view only). Aggregates the org's
   * OrderNotificationSetting status (merged over the ON5
   * defaults via the module's own mergeConfig, so "enabled"
   * means exactly what the transactional engine itself would
   * use) and the latest OrderNotificationLog rows. NO writes,
   * NO sender changes, and NO changes to the commerce/orders
   * modules — plain prisma reads from here, each defensive
   * (.catch → empty/null) in the MS2 preference-read style, so
   * a missing table can never break Messaging. The
   * transactional SEND path (OrderNotificationService.notify,
   * Shop OTP) does not pass through this service at all — see
   * docs/messaging-mx3-acceptance.md for the code-path proof.
   */
  async getTransactionalOverview(organizationId: string): Promise<{
    setting: {
      configured: boolean;
      enabledEvents: number;
      totalEvents: number;
      channelsInUse: string[];
      events: { event: string; enabled: boolean; channels: string[] }[];
    } | null;
    recent: {
      id: string; orderId: string; orderRef: string; event: string; channel: string;
      status: string; providerMessageId: string | null; error: string | null; createdAt: unknown;
    }[];
    summary: { total: number | null; sent: number | null; failed: number | null };
  }> {
    // Setting status: the stored Json config merged over the
    // ON5 defaults. `configured` = a row exists at all.
    let setting: {
      configured: boolean; enabledEvents: number; totalEvents: number;
      channelsInUse: string[]; events: { event: string; enabled: boolean; channels: string[] }[];
    } | null = null;
    try {
      const table = (this.prisma as any).orderNotificationSetting;
      // No delegate at all (pre-ON5 deployment / fixture) ⇒ the
      // setting is honestly UNREADABLE here (null). A delegate
      // with no row is different: the ON5 defaults apply and
      // `configured` says no row exists.
      if (!table?.findFirst && !table?.findUnique) throw new Error("orderNotificationSetting unavailable");
      let row: any = null;
      if (table?.findFirst) row = await table.findFirst({ where: { organizationId } }).catch(() => null);
      if (!row && table?.findUnique) row = await table.findUnique({ where: { organizationId } }).catch(() => null);
      const merged = mergeConfig(row?.config ?? null);
      const events = NOTIFICATION_EVENTS.map((event) => ({
        event,
        enabled: merged[event]?.enabled === true,
        channels: [...(merged[event]?.channels ?? [])],
      }));
      setting = {
        configured: !!row,
        enabledEvents: events.filter((e) => e.enabled).length,
        totalEvents: events.length,
        channelsInUse: [...new Set(events.filter((e) => e.enabled).flatMap((e) => e.channels))],
        events,
      };
    } catch { setting = null; }
    // Recent log rows (latest 20), newest first. orderRef is the
    // order's human number when the relation resolves, else its
    // external id, else the raw orderId — never invented.
    let recent: {
      id: string; orderId: string; orderRef: string; event: string; channel: string;
      status: string; providerMessageId: string | null; error: string | null; createdAt: unknown;
    }[] = [];
    try {
      const rows: any[] = await (this.prisma as any).orderNotificationLog.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { order: { select: { externalNumber: true, externalId: true } } },
      });
      recent = (Array.isArray(rows) ? rows : []).map((r) => ({
        id: String(r.id),
        orderId: String(r.orderId),
        orderRef: r.order?.externalNumber ?? r.order?.externalId ?? String(r.orderId),
        event: String(r.event),
        channel: String(r.channel),
        status: String(r.status),
        providerMessageId: r.providerMessageId ?? null,
        error: r.error ?? null,
        createdAt: r.createdAt,
      }));
    } catch { recent = []; }
    // Count summary over ALL of the org's log rows (not just
    // the page above). A failed count read is null — never a
    // fabricated 0.
    const countWhere = async (where: Record<string, unknown>): Promise<number | null> => {
      try {
        const n = await (this.prisma as any).orderNotificationLog.count({ where });
        return typeof n === "number" ? n : null;
      } catch { return null; }
    };
    const summary = {
      total: await countWhere({ organizationId }),
      sent: await countWhere({ organizationId, status: "sent" }),
      failed: await countWhere({ organizationId, status: { in: ["failed_error", "failed_no_channel"] } }),
    };
    return { setting, recent, summary };
  }

  /** MS2 — upsert one preference row (the unique org+channel+
   * address row flips in place; the latest status/source wins).
   * MX10: status may also be "pending" (double opt-in), and every
   * CREATE or STATUS CHANGE records a MessageConsentEvent (the
   * consent history that begins at MX10) — best-effort and
   * defensive, so a pre-migration DB or a fake-prisma spec
   * without the table never breaks a preference write. */
  async setPreference(organizationId: string, input: {
    channel: string; address: string; status: "opted_out" | "opted_in" | "pending"; source: string;
    recipientType?: string | null; recipientId?: string | null; note?: string | null;
    actor?: string;
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
    const row = existing
      ? await (this.prisma as any).messagePreference.update({ where: { id: existing.id }, data })
      : await (this.prisma as any).messagePreference.create({
        data: { organizationId, channel: input.channel, address, ...data },
      });
    if (!existing || existing.status !== input.status) {
      await this.recordConsentEvent(organizationId, {
        channel: input.channel, address, fromStatus: existing?.status ?? null, toStatus: input.status,
        source: input.source, actor: input.actor ?? "system",
        recipientType: input.recipientType ?? existing?.recipientType ?? null,
        recipientId: input.recipientId ?? existing?.recipientId ?? null,
        note: input.note ?? null,
      });
    }
    return row;
  }

  /** MX10 — the consent-event write. History begins at MX10;
   * nothing before it is backfilled. Never throws. */
  async recordConsentEvent(organizationId: string, input: {
    channel: string; address: string; fromStatus?: string | null; toStatus: string;
    source: string; actor: string; recipientType?: string | null; recipientId?: string | null; note?: string | null;
  }): Promise<void> {
    try {
      const table = (this.prisma as any).messageConsentEvent;
      if (!table || typeof table.create !== "function") return;
      await table.create({
        data: {
          organizationId, channel: input.channel,
          address: normalizePrefAddress(input.channel, input.address),
          recipientType: input.recipientType ?? null, recipientId: input.recipientId ?? null,
          fromStatus: input.fromStatus ?? null, toStatus: input.toStatus,
          source: input.source, actor: input.actor, note: input.note ?? null,
        },
      });
    } catch { /* consent history is best-effort; the preference write already landed */ }
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
    /** MX10: the broadcast's topic (topic-preference stage). */
    topic?: string;
  } & AudienceExtras): Promise<BroadcastResolution> {
    const recipients: Recipient[] = [];
    const counts = await this.resolveBroadcastRecipientsInChunks(
      organizationId, opts, BROADCAST_RECIPIENT_WRITE_CHUNK,
      async (chunk) => { recipients.push(...chunk); },
    );
    return { recipients, ...counts };
  }

  /**
   * MX1 — the streaming form of THE shared resolver: the
   * exclusion stages are built ONCE (the same queries as the
   * collecting form always ran) into a per-recipient filter
   * applied in the original stage order, and resolved recipients
   * stream through it in chunks. The collecting form above is
   * built on this one, so preview and prepare read the identical
   * set — now including a prepare that never accumulates it.
   */
  async resolveBroadcastRecipientsInChunks(organizationId: string, opts: {
    channel: string; audienceType: string; audienceStage?: string; audienceSegment?: string;
    excludePreviousRecipients?: boolean;
    excludePastDays?: number; excludeOptOut?: boolean;
    topic?: string;
  } & AudienceExtras, chunkSize: number, onChunk: (recipients: Recipient[]) => Promise<void>): Promise<Omit<BroadcastResolution, "recipients">> {
    const filter = await this.buildBroadcastRecipientFilter(organizationId, opts);
    let audienceTotal = 0;
    const { invalidCount } = await this.resolveAudienceInChunks(
      organizationId, opts.channel, opts.audienceType, opts.audienceStage, opts.audienceSegment, opts, chunkSize,
      async (chunk) => {
        const kept: Recipient[] = [];
        for (const r of chunk) {
          audienceTotal++;
          if (filter.apply(r)) kept.push(r);
        }
        if (kept.length) await onChunk(kept);
      },
    );
    return { audienceTotal, ...filter.counts, invalidCount };
  }

  /**
   * MX1 — the exclusion stages of resolveBroadcastRecipients,
   * built once per resolve and applied per recipient in the
   * ORIGINAL order (previous → recent-days → suppression →
   * unsubscribed-column opt-out → frequency cap → WhatsApp
   * opt-in), so the stage counts and the final set are exactly
   * the pre-MX1 ones. Each stage's data comes from the same
   * query (and the same defensive .catch) as before.
   */
  private async buildBroadcastRecipientFilter(organizationId: string, opts: {
    channel: string;
    excludePreviousRecipients?: boolean;
    excludePastDays?: number; excludeOptOut?: boolean;
    /** MX10: when set, recipients whose preference-center topics
     * for this channel exclude it are dropped (suppression count). */
    topic?: string;
  }): Promise<{
    counts: { excludedPreviousCount: number; excludedSuppressedCount: number; excludedFrequencyCount: number; excludedNoOptInCount: number; excludedPendingCount: number };
    apply: (r: Recipient) => boolean;
  }> {
    const counts = { excludedPreviousCount: 0, excludedSuppressedCount: 0, excludedFrequencyCount: 0, excludedNoOptInCount: 0, excludedPendingCount: 0 };

    // Stage 1 — previous confirmed recipients (CX10).
    let prevSeen: Set<string> | null = null;
    if (opts.excludePreviousRecipients) {
      const deliveries = await (this.prisma as any).messageDelivery.findMany({
        where: { organizationId, broadcastId: { not: null }, status: "sent" },
        select: { recipientType: true, recipientId: true },
        take: 10000,
      });
      prevSeen = new Set(
        (deliveries as any[])
          .filter((d) => d.recipientId)
          .map((d) => `${d.recipientType}:${d.recipientId}`),
      );
    }

    // Stage 1b — recent-days window exclusion (CX10 variant),
    // counted into excludedPreviousCount.
    let excludedAddresses: Set<any> | null = null;
    let excludedIds: Set<any> | null = null;
    if (opts.excludePastDays && opts.excludePastDays > 0) {
      const cutoff = new Date(Date.now() - opts.excludePastDays * 24 * 60 * 60 * 1000);
      const recentDeliveries = await (this.prisma as any).messageDelivery.findMany({
        where: { organizationId, createdAt: { gte: cutoff } },
        select: { address: true, recipientId: true },
        take: 50000,
      }).catch(() => []);
      excludedAddresses = new Set((recentDeliveries as any[]).map((d) => d.address).filter(Boolean));
      excludedIds = new Set((recentDeliveries as any[]).map((d) => d.recipientId).filter(Boolean));
    }

    // Stage 2 — suppression by this channel's normalized address.
    let suppressed: Set<string> | null = null;
    try {
      const suppressedRows = await (this.prisma as any).messagePreference.findMany({
        where: { organizationId, channel: opts.channel, status: "opted_out" },
        select: { address: true },
      }) ?? [];
      if (suppressedRows.length) suppressed = new Set(suppressedRows.map((p: any) => p.address));
    } catch { suppressed = null; }

    // MX10 Stage 2b — pending double opt-in signups: a pending
    // address has NOT consented yet, so it receives no marketing
    // sends (excluded here at resolve time, not merely hidden).
    let pendingSet: Set<string> | null = null;
    try {
      const pendingRows = await (this.prisma as any).messagePreference.findMany({
        where: { organizationId, channel: opts.channel, status: "pending" },
        select: { address: true },
      }) ?? [];
      if (pendingRows.length) pendingSet = new Set(pendingRows.map((p: any) => p.address));
    } catch { pendingSet = null; }

    // MX10 — preference-center choices for this channel: topic
    // subscriptions + per-contact frequency caps. Loaded once;
    // missing columns (pre-migration) read as "no choices".
    let topicPrefs: Map<string, string[]> | null = null;
    let prefCaps: Map<string, number> | null = null;
    try {
      const choiceRows = await (this.prisma as any).messagePreference.findMany({
        where: { organizationId, channel: opts.channel },
        select: { address: true, topics: true, maxPerDay: true },
      }) ?? [];
      for (const row of choiceRows as any[]) {
        if (Array.isArray(row.topics)) (topicPrefs ??= new Map()).set(row.address, row.topics.map(String));
        if (typeof row.maxPerDay === "number") (prefCaps ??= new Map()).set(row.address, row.maxPerDay);
      }
    } catch { topicPrefs = null; prefCaps = null; }

    const setting = await this.getMessagingSetting(organizationId);

    // Stage 1c — the unsubscribed-column opt-out (CX10 variant),
    // counted into excludedSuppressedCount.
    let outIds: Set<any> | null = null;
    if (opts.excludeOptOut) {
      const [custOut, leadOut] = await Promise.all([
        (this.prisma as any).customer.findMany({ where: { organizationId, unsubscribed: true }, select: { id: true } }).catch(() => []),
        (this.prisma as any).lead.findMany({ where: { organizationId, unsubscribed: true }, select: { id: true } }).catch(() => []),
      ]);
      const set = new Set([...(custOut as any[]), ...(leadOut as any[])].map((r) => r.id));
      if (set.size) outIds = set;
    }

    // Stage 3 — frequency cap over confirmed broadcast deliveries.
    // MX10: a contact's own maxPerDay (preference center) applies
    // as min(org cap, contact cap), and on its own when the org
    // cap is off — the delivery counts are needed in both cases.
    let freqCounts: Map<string, number> | null = null;
    if (setting.frequencyCapPerDay > 0 || (prefCaps && prefCaps.size > 0)) {
      const since = Date.now() - 24 * 3600 * 1000;
      const recent: any[] = await (this.prisma as any).messageDelivery.findMany({
        where: { organizationId, broadcastId: { not: null }, status: "sent" },
        select: { recipientType: true, recipientId: true, createdAt: true },
        take: 20000,
      }).catch(() => []);
      freqCounts = new Map<string, number>();
      for (const d of recent) {
        if (!d.recipientId) continue;
        const t = d.createdAt ? new Date(d.createdAt).getTime() : NaN;
        if (!Number.isFinite(t) || t < since) continue;
        const key = `${d.recipientType}:${d.recipientId}`;
        freqCounts.set(key, (freqCounts.get(key) ?? 0) + 1);
      }
    }

    // Stage 4 — WhatsApp opt-in required.
    let optedIn: Set<string> | null = null;
    if (opts.channel === "whatsapp" && setting.whatsappOptInRequired) {
      let optInRows: any[] = [];
      try {
        optInRows = await (this.prisma as any).messagePreference.findMany({
          where: { organizationId, channel: "whatsapp", status: "opted_in" },
          select: { address: true },
        }) ?? [];
      } catch { optInRows = []; }
      optedIn = new Set(optInRows.map((p: any) => p.address));
    }

    const apply = (r: Recipient): boolean => {
      if (prevSeen && prevSeen.has(`${r.type}:${r.id}`)) { counts.excludedPreviousCount++; return false; }
      if (excludedAddresses && excludedIds) {
        const addr = opts.channel === "email" ? r.email : opts.channel === "push" ? r.pushEndpoint : opts.channel === "telegram" ? r.telegramChatId : opts.channel === "onsite" ? r.id : r.phone;
        if (excludedIds.has(r.id) || (addr && excludedAddresses.has(addr))) { counts.excludedPreviousCount++; return false; }
      }
      if (suppressed && suppressed.has(recipientPrefAddress(opts.channel, r))) { counts.excludedSuppressedCount++; return false; }
      if (pendingSet && pendingSet.has(recipientPrefAddress(opts.channel, r))) { counts.excludedPendingCount++; return false; }
      if (outIds && outIds.has(r.id)) { counts.excludedSuppressedCount++; return false; }
      if (freqCounts) {
        const prefCap = prefCaps?.get(recipientPrefAddress(opts.channel, r));
        const cap = prefCap !== undefined
          ? (setting.frequencyCapPerDay > 0 ? Math.min(setting.frequencyCapPerDay, prefCap) : prefCap)
          : (setting.frequencyCapPerDay > 0 ? setting.frequencyCapPerDay : null);
        if (cap !== null && (freqCounts.get(`${r.type}:${r.id}`) ?? 0) >= cap) { counts.excludedFrequencyCount++; return false; }
      }
      if (opts.topic && topicPrefs) {
        const topics = topicPrefs.get(recipientPrefAddress(opts.channel, r));
        if (topics && !topics.includes(opts.topic)) { counts.excludedSuppressedCount++; return false; }
      }
      if (optedIn && !optedIn.has(recipientPrefAddress("whatsapp", r))) { counts.excludedNoOptInCount++; return false; }
      return true;
    };
    return { counts, apply };
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
      const rawContact = input.channel === "email" ? (r.email ?? "") : input.channel === "push" ? (r.pushEndpoint ?? "") : input.channel === "telegram" ? (r.telegramChatId ?? "") : input.channel === "onsite" ? (r.id ?? "") : (r.phone ?? "");
      let masked = rawContact;
      if (input.channel === "push") {
        masked = maskRecipientAddress("push", r);
      } else if (input.channel === "telegram") {
        masked = maskRecipientAddress("telegram", r);
      } else if (input.channel === "onsite") {
        masked = maskRecipientAddress("onsite", r);
      } else if (input.channel === "email" && rawContact.includes("@")) {
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
    // MX9: the selected WhatsApp template (preview only) — its
    // stored Meta category selects the per-category rate.
    whatsappTemplateId?: string;
    // MX11: the form's holdout percentage (preview only) — the
    // SAME deterministic bucket as prepare, so the preview's
    // held-out count is exactly what a send would hold out.
    holdoutPercent?: number;
  } & AudienceExtras) {
    if (!["email", "sms", "whatsapp", "push", "telegram", "onsite"].includes(dto.channel)) throw badRequest("messaging.channelMustBeEmailSmsWhatsapp");
    if (dto.holdoutPercent !== undefined && dto.holdoutPercent !== null
      && (!Number.isInteger(dto.holdoutPercent) || dto.holdoutPercent < 1 || dto.holdoutPercent > 50)) {
      throw badRequest("messaging.holdoutPercentMustBeAnIntegerBetween");
    }
    const resolved = await this.resolveBroadcastRecipients(organizationId, dto);
    // MX11: preview shows the post-holdout set (what would
    // actually be sent to); the held-out count is reported too.
    const holdoutSplit = this.splitHoldout(resolved.recipients, dto.holdoutPercent ?? null);
    const recipients = holdoutSplit.kept;
    let whatsappCategory: string | null = null;
    if (dto.channel === "whatsapp" && dto.whatsappTemplateId) {
      const tpl = await (this.prisma as any).whatsAppTemplate?.findFirst({ where: { id: dto.whatsappTemplateId, organizationId } }).catch(() => null);
      whatsappCategory = tpl?.category ?? null;
    }
    return {
      audienceTotal: resolved.audienceTotal,
      excludedPreviousCount: resolved.excludedPreviousCount,
      excludedSuppressedCount: resolved.excludedSuppressedCount,
      excludedFrequencyCount: resolved.excludedFrequencyCount,
      excludedNoOptInCount: resolved.excludedNoOptInCount,
      excludedPendingCount: resolved.excludedPendingCount ?? 0,
      // MX11: present only when the form set a holdout, so a
      // pre-MX11 preview response is byte-identical.
      ...(dto.holdoutPercent ? { excludedHoldoutCount: holdoutSplit.heldOutCount } : {}),
      invalidCount: resolved.invalidCount,
      total: recipients.length,
      sample: recipients.slice(0, 20).map((r) => ({
        type: r.type, name: r.name, address: maskRecipientAddress(dto.channel, r),
      })),
      costEstimate: await this.buildCostEstimate(organizationId, dto.channel, recipients.length, dto.body, whatsappCategory),
    };
  }

  /**
   * SA-B20 (G2) — personalisation preview: runs the SAME
   * resolver stages as a send (suppressed recipients are
   * already excluded — they are never personalised and no LLM
   * call is spent on them), the SAME buildSnapshotVars and the
   * SAME personaliseRecipients core prepareBroadcast runs, then
   * renders up to K sample variants with renderPersonalizedBody
   * — the exact merge sendToRecipient performs. Tier 2 hooks
   * are generated ONLY for the sampled recipients; the counts
   * cover the whole resolved set from deterministic facts, and
   * the Tier 2 projection is an LLM CALL COUNT (no LLM money
   * rate exists in this tree — a price is never invented).
   * Sample labels are the staff's own CRM view: name + masked
   * address (the CX10 preview precedent), never a full address.
   */
  async previewBroadcastPersonalisation(organizationId: string, actorId: string, dto: {
    channel: string; body?: string; subject?: string;
    audienceType: string; audienceStage?: string; audienceSegment?: string;
    excludePreviousRecipients?: boolean;
    excludePastDays?: number; excludeOptOut?: boolean;
    personalization?: unknown;
    sampleSize?: number;
  } & AudienceExtras) {
    if (!["email", "sms", "whatsapp"].includes(dto.channel)) throw badRequest("messaging.channelMustBeEmailSmsOr");
    if (!dto.body) throw badRequest("messaging.broadcastBodyIsRequiredToPreview");
    const body = dto.body;
    const config = normalizePersonalizationConfig(dto.personalization, dto.channel);
    if (!config?.enabled) {
      throw badRequest("messaging.personalisationIsNotEnabledInThis");
    }
    assertTier2HookPlaceholder(body, config);
    const resolved = await this.resolveBroadcastRecipients(organizationId, {
      channel: dto.channel, audienceType: dto.audienceType,
      audienceStage: dto.audienceStage, audienceSegment: dto.audienceSegment,
      excludePreviousRecipients: dto.excludePreviousRecipients,
      excludePastDays: dto.excludePastDays, excludeOptOut: dto.excludeOptOut,
      audienceDefinition: dto.audienceDefinition, audienceSavedId: dto.audienceSavedId, audienceCsv: dto.audienceCsv,
    });
    const { recipients } = resolved;
    const sampleSize = Math.min(
      BROADCAST_PERSONALIZATION_SAMPLE_MAX,
      Math.max(1, Math.floor(dto.sampleSize ?? 3) || 3),
    );
    const sampleIndexes = new Set(recipients.map((_, i) => i).slice(0, sampleSize));
    const baseVarsList = await this.buildSnapshotVars(organizationId, recipients);
    const outcome = await this.personalization().personaliseRecipients({
      organizationId, channel: dto.channel,
      body, subject: dto.subject ?? null,
      recipients, baseVarsList, config, actorId,
      generateFor: (i) => sampleIndexes.has(i),
    });
    const samples = recipients.slice(0, sampleSize).map((r, i) => ({
      type: r.type,
      name: r.name,
      address: maskRecipientAddress(dto.channel, r),
      tier: outcome.tiers[i],
      body: renderPersonalizedBody(body, r, outcome.varsList[i]),
    }));
    return {
      audienceTotal: resolved.audienceTotal,
      excludedPreviousCount: resolved.excludedPreviousCount,
      excludedSuppressedCount: resolved.excludedSuppressedCount,
      excludedFrequencyCount: resolved.excludedFrequencyCount,
      excludedNoOptInCount: resolved.excludedNoOptInCount,
      invalidCount: resolved.invalidCount,
      counts: {
        total: outcome.counts.total,
        base: outcome.counts.base,
        tier1Memory: outcome.counts.memory,
        tier2Ai: outcome.counts.ai,
        tier2Eligible: outcome.counts.tier2Eligible,
        tier2Fallbacks: outcome.counts.tier2Fallbacks,
      },
      tier2FallbackReasons: outcome.tier2FallbackReasons,
      // Tier 2 cost surface: CALL COUNTS only (projected for
      // the full send at prepare; actually made for these
      // samples). No money figure — no LLM rate is configured.
      tier2LlmCallsProjected: config.tier2AiHook ? outcome.llmCallsProjected : 0,
      tier2LlmCallsMadeForPreview: outcome.llmCallsMade,
      samples,
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
  private async buildCostEstimate(organizationId: string, channel: string, recipientCount: number, body?: string, whatsappCategory?: string | null): Promise<{
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
      // MX9: when the preview names a template, its REAL Meta
      // category (as synced/stored) selects the org's per-category
      // rate when one is set, falling back to the flat rate. No
      // category rate and no flat rate ⇒ null (no figure at all).
      const resolved = resolveWhatsAppRateMinor(row, whatsappCategory ?? null);
      if (resolved.rateMinor === null) return null;
      const rate = resolved.rateMinor;
      return {
        currency: "BDT", totalMinor: recipientCount * rate,
        basis: resolved.basis === "category"
          ? `Estimate only: ${recipientCount} recipients × BDT ${rateText(rate)} per WhatsApp ${resolved.category} message at the per-category rate you set. Meta's actual charge may differ.`
          : `Estimate only: ${recipientCount} recipients × BDT ${rateText(rate)} per WhatsApp message at the rate you set. Meta's actual charge may differ.`,
      };
    }
    if (channel === "push") {
      // MX12: push has NO org-entered rate anywhere in the
      // sender config (and the push service itself charges the
      // org nothing per message) — following the convention,
      // no rate means NO cost figure, never an invented one.
      return null;
    }
    if (channel === "telegram") {
      // MX13: telegram has NO org-entered rate anywhere in the
      // sender config (the Bot API is free for bot owners) —
      // following the convention, no rate means NO cost
      // figure, never an invented one.
      return null;
    }
    if (channel === "onsite") {
      // MX14: onsite has NO provider at all — the send writes a
      // row into the customer's notification center in the
      // org's own database, so there is genuinely no provider
      // cost and NO org-entered rate. Following the convention,
      // no cost figure is returned (null), and the composer /
      // report surfaces say "no provider cost" in words —
      // never an invented 0 rate.
      return null;
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
    const { killSwitches, effectiveLimits, isAiDisabledForOrg } = await import("../common/platform-settings");
    const ks = await killSwitches(this.prisma as any);
    if (isAiDisabledForOrg(ks, organizationId)) {
      throw new ApiException(ks.aiGloballyPaused ? "messaging.aiPausedPlatformWide" : "messaging.aiDisabledForOrg", undefined, 403);
    }
    const baseline = Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 200);
    const { aiDaily: limit } = await effectiveLimits(this.prisma as any, organizationId, { aiDaily: baseline, broadcastCap: 1000 });
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await (this.prisma as any).aIUsageRecord.count({
      where: { organizationId, feature: MESSAGING_AI_FEATURE, createdAt: { gte: startOfDay } },
    });
    if (used >= limit) {
      throw new ApiException("messaging.dailyAIGenerationLimitReachedFor", { limit: limit }, 429);
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
    if (!product) throw notFound("messaging.productNotFoundInThisOrganization");
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
      throw badRequest("messaging.channelMustBeEmailOrSms2");
    }
    const goal = String(dto.goal ?? "").trim();
    if (!goal) throw badRequest("messaging.goalIsRequiredSayWhatThis");
    // MB5 (ML13, CD-8): an explicit dto language still wins;
    // the DEFAULT now comes from the one owner-facing resolver
    // (dto → org aiReplyLanguage → org dashboardLocale → the
    // actor's preferredLocale → bn) instead of a hardcoded bn.
    const language: "bn" | "en" = (
      await resolveOwnerLanguageForOrg(this.prisma as any, {
        organizationId,
        userId: actorId,
        dtoLanguage: dto.language,
      })
    ).language;
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
      throw new ApiException("messaging.theAIResponseCouldNotBe", 502);
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
    if (!subject) throw badRequest("messaging.subjectIsRequired");
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
      throw new ApiException("messaging.theAIResponseCouldNotBe", 502);
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
        reason: catalogText("messaging.sendTimeReason", await resolveDocumentLocale(this.prisma as any, organizationId), { events: summary.totalEvents, min: SEND_TIME_MIN_EVENTS }),
      };
    }
    return {
      available: true, totalEvents: summary.totalEvents, bestHours: summary.bestHours,
      method: catalogText("messaging.sendTimeMethod", await resolveDocumentLocale(this.prisma as any, organizationId)),
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
    const locale = await resolveDocumentLocale(this.prisma as any, organizationId);
    const suggestions = segmentSuggestionsFromCounts(counts, locale);
    const setting = await this.getMessagingSetting(organizationId);
    if (setting.whatsappOptInRequired) {
      const optedIn = await (this.prisma as any).messagePreference.count({
        where: { organizationId, channel: "whatsapp", status: "opted_in" },
      }).catch(() => 0);
      if (!optedIn) {
        suggestions.push({
          kind: "whatsapp_optin_empty",
          size: 0,
          reason: catalogText("messaging.segmentWhatsappOptInReason", locale),
        });
      }
    }
    return suggestions;
  }

  // ---------- MX11: engagement score, predictive segments, holdout ----------

  /**
   * MX11 — the org's predictive-segment thresholds from
   * MessagingSetting (the MessagingSetting pattern: one row per
   * org, strict ranges at write time). Defensive like every
   * other setting read: a missing row/column/table reads as the
   * documented defaults, so pre-MX11 fixtures behave identically.
   */
  async getEngagementThresholds(organizationId: string): Promise<EngagementThresholds> {
    const d = DEFAULT_ENGAGEMENT_THRESHOLDS;
    try {
      const row = await (this.prisma as any).messagingSetting?.findFirst({ where: { organizationId } });
      if (!row) return { ...d };
      const pick = (v: unknown, fallback: number, min: number, max: number) =>
        Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : fallback;
      return {
        churnRiskSilentDays: pick(row.churnRiskSilentDays, d.churnRiskSilentDays, 1, 3650),
        likelyToBuyMinScore: pick(row.likelyToBuyMinScore, d.likelyToBuyMinScore, 0, 100),
        highLtvMinSpentMinor: pick(row.highLtvMinSpentMinor, d.highLtvMinSpentMinor, 0, 1000000000),
        unengagedSuppressDays: pick(row.unengagedSuppressDays, d.unengagedSuppressDays, 1, 3650),
        unengagedMinSends: pick(row.unengagedMinSends, d.unengagedMinSends, 1, 1000),
      };
    } catch {
      return { ...d };
    }
  }

  /**
   * MX11 — THE engagement data plumbing: one bounded pass over
   * the org's real MessageDelivery rows (confirmed sends only —
   * broadcast AND workflow deliveries both count: engagement is
   * engagement, and MessageDelivery is the one shared store),
   * its MessageLinkClick rows, and the SAME computeOrderAggregates
   * the RFM/MS3 paths read (no second order-aggregation path).
   * Keyed "customer:<id>" / "lead:<id>" — the MessageLinkClick
   * recipientKey format. csv/test recipients have no entity id
   * behind their deliveries, so they honestly never appear here.
   * Missing tables read as empty (the MS2 defensive discipline).
   */
  async buildEngagementMap(organizationId: string): Promise<Map<string, EngagementContact>> {
    const thresholds = await this.getEngagementThresholds(organizationId);
    const now = Date.now();
    const deliveries: any[] = await (this.prisma as any).messageDelivery?.findMany({
      where: { organizationId, status: "sent" },
      select: {
        recipientType: true, recipientId: true, createdAt: true,
        deliveredAt: true, readAt: true, openedAt: true, deliveryStatus: true,
      },
      take: 50000,
    }).catch(() => []) ?? [];
    const clicks: any[] = await (this.prisma as any).messageLinkClick?.findMany({
      where: { organizationId }, select: { recipientKey: true, createdAt: true }, take: 50000,
    }).catch(() => []) ?? [];
    const aggregates = await computeOrderAggregates(this.prisma as any, organizationId).catch(() => new Map());

    interface Acc {
      type: "customer" | "lead"; id: string;
      sentCount: number; deliveredOnlyCount: number; openCount: number; clickCount: number;
      sendTimes: number[]; lastEngagementAt: number | null;
    }
    const accs = new Map<string, Acc>();
    const accFor = (type: "customer" | "lead", id: string): Acc => {
      const key = `${type}:${id}`;
      let acc = accs.get(key);
      if (!acc) {
        acc = { type, id, sentCount: 0, deliveredOnlyCount: 0, openCount: 0, clickCount: 0, sendTimes: [], lastEngagementAt: null };
        accs.set(key, acc);
      }
      return acc;
    };
    const engage = (acc: Acc, at: unknown) => {
      const t = at ? new Date(at as any).getTime() : NaN;
      if (Number.isFinite(t) && (acc.lastEngagementAt === null || t > acc.lastEngagementAt)) acc.lastEngagementAt = t;
    };
    for (const d of Array.isArray(deliveries) ? deliveries : []) {
      if ((d.recipientType !== "customer" && d.recipientType !== "lead") || !d.recipientId) continue;
      const acc = accFor(d.recipientType, String(d.recipientId));
      acc.sentCount++;
      const sentAt = d.createdAt ? new Date(d.createdAt).getTime() : NaN;
      if (Number.isFinite(sentAt)) acc.sendTimes.push(sentAt);
      const opened = Boolean(d.openedAt) || Boolean(d.readAt) || d.deliveryStatus === "read";
      const delivered = Boolean(d.deliveredAt) || d.deliveryStatus === "delivered" || d.deliveryStatus === "read";
      if (opened) {
        acc.openCount++;
        engage(acc, d.readAt ?? d.openedAt ?? d.createdAt);
      } else if (delivered) {
        acc.deliveredOnlyCount++;
        // A delivered signal alone is reachability, not
        // engagement — it never moves lastEngagementAt.
      }
    }
    for (const c of Array.isArray(clicks) ? clicks : []) {
      const key = String(c.recipientKey ?? "");
      const sep = key.indexOf(":");
      if (sep <= 0) continue;
      const type = key.slice(0, sep);
      const id = key.slice(sep + 1);
      if ((type !== "customer" && type !== "lead") || !id) continue;
      const acc = accFor(type, id);
      acc.clickCount++;
      engage(acc, c.createdAt);
    }
    // Customers whose only history is orders still get an entry:
    // an order IS engagement, and high-LTV needs them.
    for (const [customerId, agg] of aggregates as Map<string, { frequency: number; monetary: bigint; last: number }>) {
      const acc = accFor("customer", customerId);
      if (agg.last) engage(acc, new Date(agg.last));
      void acc;
    }

    const out = new Map<string, EngagementContact>();
    for (const [key, acc] of accs) {
      const agg = acc.type === "customer" ? (aggregates as Map<string, { frequency: number; monetary: bigint; last: number }>).get(acc.id) : undefined;
      const raw = {
        sentCount: acc.sentCount,
        deliveredOnlyCount: acc.deliveredOnlyCount,
        openCount: acc.openCount,
        clickCount: acc.clickCount,
        orderFrequency: agg?.frequency ?? 0,
        lastEngagementAt: acc.lastEngagementAt,
      };
      const score = computeEngagementScore(raw, now);
      const daysSinceLastEngagement = acc.lastEngagementAt === null
        ? null
        : Math.max(0, Math.floor((now - acc.lastEngagementAt) / 86400000));
      const segments = predictiveSegmentsFor({
        ...raw, score, totalSpentMinor: agg ? Number(agg.monetary) : 0,
        isCustomer: acc.type === "customer", daysSinceLastEngagement,
      }, thresholds);
      const sortedSends = [...acc.sendTimes].sort((a, b) => a - b);
      out.set(key, {
        type: acc.type, id: acc.id, ...raw,
        totalSpentMinor: agg ? Number(agg.monetary) : 0,
        score, segments, daysSinceLastEngagement,
        firstSendAt: sortedSends.length ? sortedSends[0] : null,
        lastSendAt: sortedSends.length ? sortedSends[sortedSends.length - 1] : null,
        sendsSinceLastEngagement: acc.lastEngagementAt === null
          ? acc.sentCount
          : acc.sendTimes.filter((t) => t > (acc.lastEngagementAt as number)).length,
      });
    }
    return out;
  }

  /**
   * MX11 — the engagement report: formula + segment rules in
   * plain language (verbatim from engagement.ts), the org's live
   * thresholds, per-segment counts and the top contacts by score
   * WITH their evidence (the raw counts the score came from).
   * Everything is labelled "rule-based estimate" — these are
   * deterministic rules over real records, not a model.
   * Contacts with no history at all are counted (score 0) but
   * listed only in the total, never dressed up as a segment.
   */
  async getEngagementReport(organizationId: string) {
    const thresholds = await this.getEngagementThresholds(organizationId);
    const map = await this.buildEngagementMap(organizationId);
    const customers = await this.scanChunked((this.prisma as any).customer, { organizationId }).catch(() => []);
    const leads = await this.scanChunked((this.prisma as any).lead, { organizationId }).catch(() => []);
    const nameOf = new Map<string, string>();
    for (const c of customers as any[]) nameOf.set(`customer:${c.id}`, MessagingService.customerName(c));
    for (const l of leads as any[]) nameOf.set(`lead:${l.id}`, String(l.name ?? ""));
    const totalContacts = (customers as any[]).length + (leads as any[]).length;
    const segmentCounts: Record<string, number> = { churn_risk: 0, likely_to_buy: 0, high_ltv: 0 };
    for (const contact of map.values()) {
      for (const s of contact.segments) segmentCounts[s] = (segmentCounts[s] ?? 0) + 1;
    }
    const rows = [...map.values()]
      .sort((a, b) => b.score - a.score || `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`))
      .slice(0, 200)
      .map((c) => ({
        type: c.type, id: c.id, name: nameOf.get(`${c.type}:${c.id}`) ?? "",
        score: c.score, segments: c.segments,
        sentCount: c.sentCount, openCount: c.openCount, clickCount: c.clickCount,
        orderFrequency: c.orderFrequency, totalSpentMinor: String(c.totalSpentMinor),
        lastEngagementAt: c.lastEngagementAt ? new Date(c.lastEngagementAt).toISOString() : null,
        daysSinceLastEngagement: c.daysSinceLastEngagement,
      }));
    return {
      label: "rule-based estimate",
      formula: ENGAGEMENT_FORMULA_TEXT,
      segmentRules: PREDICTIVE_SEGMENT_RULES.map((r) => ({
        segment: r.segment, label: r.label,
        rule: r.segment === "churn_risk"
          ? `${r.rule} (threshold: ${thresholds.churnRiskSilentDays} days)`
          : r.segment === "likely_to_buy"
            ? `${r.rule} (threshold: score ≥ ${thresholds.likelyToBuyMinScore})`
            : `${r.rule} (threshold: ৳${(thresholds.highLtvMinSpentMinor / 100).toLocaleString("en-IN")} total spent)`,
      })),
      thresholds,
      totalContacts,
      scoredContacts: map.size,
      zeroHistoryContacts: Math.max(0, totalContacts - map.size),
      segmentCounts,
      rows,
    };
  }

  /**
   * MX11 — natural-language segment draft. The org describes a
   * segment in free text; the LLM (through the MS9 guard path —
   * checkMessagingAiLimit FIRST: kill switch 403, daily cap 429,
   * both before any provider call) returns a DRAFT definition in
   * the MS3 evaluator's exact format. The draft is RETURNED ONLY:
   * nothing is saved here, ever — a human reviews it and creates
   * the audience through the existing saved-audience path.
   * A draft that fails the evaluator's strict validation is
   * returned AS-IS with the validation errors — never silently
   * corrected, never applied. With no real LLM configured there
   * is no honest draft (a template cannot write audience rules),
   * so that is a 502, exactly like an unconfigured provider.
   */
  async draftSegmentFromDescription(organizationId: string, actorId: string, dto: { description: string; entity?: string }) {
    const locale = await resolveDocumentLocale(this.prisma as any, organizationId);
    const description = String(dto.description ?? "").trim();
    if (!description) throw badRequest("messaging.descriptionIsRequiredDescribeTheSegment");
    if (description.length > 1000) throw badRequest("messaging.descriptionIsTooLongMax1000");
    const entity = dto.entity === "leads" ? "leads" : "customers";
    // MS9 guard path, verbatim: kill switch + daily cap BEFORE
    // the provider is even resolved.
    await this.checkMessagingAiLimit(organizationId);
    const provider = await this.messagingAiProvider(organizationId);
    if (!provider.isRealLlm) {
      throw new ApiException("messaging.aIIsNotConfiguredForThis", 502);
    }
    const { fieldsForEntity } = await import("./audience-rules");
    const fields = fieldsForEntity(entity as any);
    const vocabulary = Object.entries(fields)
      .map(([field, spec]) => `${field} (ops: ${spec.ops.join("|")}, value: ${spec.kind})`)
      .join("; ");
    const systemPrompt = [
      "You translate a merchant's plain-language description of a customer/lead segment into ONE audience definition for a strict rule evaluator.",
      `Return ONLY JSON of the exact shape {"entity":"${entity}","match":"all"|"any","conditions":[{"field":string,"op":string,"value":...,"key"?:string}]}.`,
      `Allowed fields for entity "${entity}": ${vocabulary}.`,
      "rfm_segment values: champions, loyal, big_spenders, at_risk, lost, new, regular. predictive_segment values: churn_risk, likely_to_buy, high_ltv (rule-based estimates computed from real delivery/click/order records).",
      "Use ONLY the allowed fields and ops. Never invent a field. At most 5 conditions. If the description cannot be expressed, return your best partial draft — it will be shown to a human with validation errors, so do not hide uncertainty by inventing fields.",
    ].join("\n");
    let result: { text: string; model: string; inputTokens: number; outputTokens: number; tokensEstimated: boolean };
    try {
      result = await provider.complete(
        [{ role: "system", content: systemPrompt }, { role: "user", content: `Segment description: ${description}` }],
        { jsonMode: true, maxTokens: 800 },
      );
    } catch (e: any) {
      throw new HttpException(e?.message ?? String(e), 502);
    }
    await this.recordMessagingAiUsage(organizationId, actorId, provider.name, result.model, result.inputTokens, result.outputTokens, result.tokensEstimated);
    let parsed: unknown = null;
    try { parsed = JSON.parse(result.text); } catch { parsed = null; }
    if (parsed === null || typeof parsed !== "object") {
      return {
        valid: false, draft: null, rawText: String(result.text ?? "").slice(0, 4000),
        errors: ["The AI response was not a JSON audience definition. Edit the raw response into the evaluator format, or describe the segment differently and try again."],
        providerLabel: provider.name, isRealLlm: true,
        notice: catalogText("messaging.audienceDraftInvalid", locale),
      };
    }
    try {
      const definition = validateAudienceDefinition(parsed);
      if (definition.entity !== entity) {
        return {
          valid: false, draft: parsed, rawText: null,
          errors: [`The draft describes entity "${definition.entity}" but "${entity}" was requested. Edit the draft's entity, or re-run for the other entity.`],
          providerLabel: provider.name, isRealLlm: true,
          notice: catalogText("messaging.audienceDraftInvalid", locale),
        };
      }
      return {
        valid: true, draft: definition, rawText: null, errors: [],
        providerLabel: provider.name, isRealLlm: true,
        notice: catalogText("messaging.audienceDraftOk", locale),
      };
    } catch (e) {
      return {
        valid: false, draft: parsed, rawText: null,
        errors: [e instanceof Error ? e.message : "The draft failed audience validation."],
        providerLabel: provider.name, isRealLlm: true,
        notice: catalogText("messaging.audienceDraftInvalid", locale),
      };
    }
  }

  /**
   * MX11 — unengaged suppression SUGGESTIONS. READ-ONLY: this
   * method performs no writes of any kind (the spec proves the
   * preference + consent tables are untouched by calling it).
   * A contact is suggested when they have received at least
   * unengagedMinSends confirmed messages AND have not engaged
   * (open/read/click/order) for at least unengagedSuppressDays —
   * never-engaged contacts count as silent since forever, with
   * sendsSinceLastEngagement = all their sends. Contacts already
   * opted out on EVERY channel they have an address for are not
   * suggested (there is nothing left to suppress); a partial
   * opt-out is shown in the evidence.
   */
  async listSuppressionSuggestions(organizationId: string) {
    const locale = await resolveDocumentLocale(this.prisma as any, organizationId);
    const thresholds = await this.getEngagementThresholds(organizationId);
    const map = await this.buildEngagementMap(organizationId);
    const customers = await this.scanChunked((this.prisma as any).customer, { organizationId }).catch(() => []);
    const leads = await this.scanChunked((this.prisma as any).lead, { organizationId }).catch(() => []);
    const contactRows = new Map<string, any>();
    for (const c of customers as any[]) contactRows.set(`customer:${c.id}`, { type: "customer", row: c, name: MessagingService.customerName(c) });
    for (const l of leads as any[]) contactRows.set(`lead:${l.id}`, { type: "lead", row: l, name: String(l.name ?? "") });
    const optedOut: any[] = await (this.prisma as any).messagePreference?.findMany({
      where: { organizationId, status: "opted_out" }, select: { channel: true, address: true },
    }).catch(() => []) ?? [];
    const optedOutKeys = new Set((optedOut as any[]).map((p) => `${p.channel}:${p.address}`));
    const now = Date.now();
    const suggestions: any[] = [];
    for (const contact of map.values()) {
      if (contact.sentCount < thresholds.unengagedMinSends) continue;
      const silentDays = contact.daysSinceLastEngagement ?? Number.POSITIVE_INFINITY;
      if (silentDays < thresholds.unengagedSuppressDays) continue;
      const entry = contactRows.get(`${contact.type}:${contact.id}`);
      if (!entry) continue;
      const row = entry.row;
      const channels: { channel: string; address: string }[] = [];
      if (row.email) channels.push({ channel: "email", address: String(row.email) });
      if (row.phone) { channels.push({ channel: "sms", address: String(row.phone) }); channels.push({ channel: "whatsapp", address: String(row.phone) }); }
      if (!channels.length) continue;
      const alreadyOut = channels.filter((c) => optedOutKeys.has(`${c.channel}:${normalizePrefAddress(c.channel, c.address)}`));
      if (alreadyOut.length === channels.length) continue;
      suggestions.push({
        type: contact.type, id: contact.id, name: entry.name,
        email: row.email ?? null, phone: row.phone ?? null,
        score: contact.score,
        totalSends: contact.sentCount,
        sendsSinceLastEngagement: contact.sendsSinceLastEngagement,
        lastEngagementAt: contact.lastEngagementAt ? new Date(contact.lastEngagementAt).toISOString() : null,
        daysSinceLastEngagement: contact.daysSinceLastEngagement,
        lastSendAt: contact.lastSendAt ? new Date(contact.lastSendAt).toISOString() : null,
        alreadyOptedOutChannels: alreadyOut.map((c) => c.channel),
        rule: `Rule-based estimate: at least ${thresholds.unengagedMinSends} confirmed sends and no open/read/click/order for at least ${thresholds.unengagedSuppressDays} days.`,
        computedAt: new Date(now).toISOString(),
      });
    }
    suggestions.sort((a, b) => b.sendsSinceLastEngagement - a.sendsSinceLastEngagement || String(a.id).localeCompare(String(b.id)));
    return {
      label: "rule-based estimate",
      thresholds: { unengagedSuppressDays: thresholds.unengagedSuppressDays, unengagedMinSends: thresholds.unengagedMinSends },
      note: catalogText("messaging.suppressionNote", locale),
      suggestions: suggestions.slice(0, 200),
      total: suggestions.length,
    };
  }

  /**
   * MX11 — apply suppression suggestions: the ONE write path,
   * an explicit human action. Each confirmed (channel, contact)
   * goes through the REAL preference store — setPreference with
   * source "manual", which also records the MX10 consent event —
   * so the resolver's suppression stage excludes them from the
   * next resolve, exactly like any other opt-out. Already-opted-out
   * and address-less items are reported as skipped, never faked.
   */
  async applySuppressionSuggestions(organizationId: string, actorId: string, dto: {
    channel: string; items: { type: string; id: string }[];
  }) {
    if (!["email", "sms", "whatsapp"].includes(dto.channel)) throw badRequest("messaging.channelMustBeEmailSmsOr");
    const items = Array.isArray(dto.items) ? dto.items.slice(0, 500) : [];
    if (!items.length) throw badRequest("messaging.itemsIsRequiredConfirmAtLeast");
    let applied = 0;
    const skipped: { type: string; id: string; reason: string }[] = [];
    for (const item of items) {
      if ((item.type !== "customer" && item.type !== "lead") || !item.id) {
        skipped.push({ type: String(item.type ?? ""), id: String(item.id ?? ""), reason: "Unknown contact type" });
        continue;
      }
      const table = item.type === "customer" ? (this.prisma as any).customer : (this.prisma as any).lead;
      const row = await table?.findFirst({ where: { id: item.id, organizationId } }).catch(() => null);
      if (!row) { skipped.push({ type: item.type, id: item.id, reason: "Contact not found in this organization" }); continue; }
      const address = dto.channel === "email" ? row.email : row.phone;
      if (!address) { skipped.push({ type: item.type, id: item.id, reason: `Contact has no ${dto.channel === "email" ? "email address" : "phone number"} for the ${dto.channel} channel` }); continue; }
      const existing = await (this.prisma as any).messagePreference?.findFirst({
        where: { organizationId, channel: dto.channel, address: normalizePrefAddress(dto.channel, String(address)), status: "opted_out" },
      }).catch(() => null);
      if (existing) { skipped.push({ type: item.type, id: item.id, reason: "Already opted out on this channel" }); continue; }
      await this.setPreference(organizationId, {
        channel: dto.channel, address: String(address), status: "opted_out", source: "manual",
        recipientType: item.type, recipientId: item.id,
        note: "MX11 unengaged suppression — human-confirmed from the suggestions list (rule-based estimate)",
        actor: `user:${actorId}`,
      });
      applied++;
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "messaging.suppression_apply", entityType: "MessagePreference",
      entityId: "", metadata: { channel: dto.channel, applied, skipped: skipped.length },
    });
    return { applied, skipped };
  }

  /**
   * MX11 — holdout split at prepare time: drop the deterministic
   * holdout bucket of the SAME hash the A/B split reads (see
   * engagement.ts). Applied BEFORE the A/B filter in both
   * prepare paths, so a recipient is held out OR in exactly one
   * variant. Returns the kept recipients + the held-out count;
   * the caller stamps the count on the Broadcast row (the report
   * reads it from there — held-out recipients are never written
   * as recipient rows/snapshot entries, so resume cannot re-roll).
   */
  private splitHoldout<T extends { type: string; id: string | null }>(recipients: T[], percent: number | null | undefined): { kept: T[]; heldOutCount: number } {
    if (!percent || percent <= 0) return { kept: recipients, heldOutCount: 0 };
    const kept: T[] = [];
    let heldOutCount = 0;
    for (const r of recipients) {
      if (isHeldOut(`${r.type}:${r.id}`, percent)) heldOutCount++;
      else kept.push(r);
    }
    return { kept, heldOutCount };
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
    // MX2: cascade attempt linking (stamped onto the delivery
    // row) + the run-scoped SMS circuit breaker shared by every
    // attempt of one broadcast run. Absent = pre-MX2 behaviour.
    recipientRowId?: string; attemptIndex?: number; cascadeGroupId?: string;
    smsBreaker?: SmsCircuitBreaker;
    // MX12: channel "push" only — the broadcast's click-through
    // URL, handed to the push port verbatim (already validated
    // shop-relative at create/edit).
    pushUrl?: string | null;
    // MX13: the broadcast's validated inline URL buttons for
    // channel "telegram" (null/absent = text-only message).
    telegramButtons?: TelegramButton[] | null;
    // MX14: channel "onsite" only — the broadcast's
    // shop-relative click-through URL, stamped onto the
    // notification row verbatim (already validated
    // shop-relative at create/edit).
    onsiteUrl?: string | null;
    // MX4: the workflow step position that produced this send
    // (engine stepRef format — "3" / "3.then.0"), stamped onto
    // the delivery row for per-step journey stats. Absent (all
    // broadcast sends, the coupon step) ⇒ the row's stepRef
    // stays null.
    stepRef?: string;
  }): Promise<{ status: "sent" | "failed" | "skipped"; providerMessageId?: string; error?: string; address: string; smsGatewayUsed?: string }> {
    if (input.channel === "email" || input.channel === "sms" || input.channel === "push" || input.channel === "telegram" || input.channel === "onsite") {
      const prefAddress = recipientPrefAddress(input.channel, input.recipient);
      const optOut = await this.findOptOut(organizationId, input.channel, prefAddress);
      // MX10: a PENDING double opt-in address has not consented —
      // the single-send guard treats it exactly like an opt-out
      // (provider never called, a skipped delivery records why).
      const pendingPref = !optOut && prefAddress ? await (this.prisma as any).messagePreference?.findFirst({
        where: { organizationId, channel: input.channel, address: prefAddress, status: "pending" },
      }).catch(() => null) : null;
      if (pendingPref) {
        const address = input.channel === "email"
          ? (input.recipient.email ?? "")
          : input.channel === "push"
            ? (input.recipient.pushEndpoint ?? "")
            : input.channel === "telegram"
              ? (input.recipient.telegramChatId ?? "")
              : input.channel === "onsite"
                ? (input.recipient.id ?? "")
                : (normalizeBdPhone(input.recipient.phone ?? "") ?? normalizePhoneGeneric(input.recipient.phone ?? "") ?? (input.recipient.phone ?? ""));
        const error = "Recipient has not confirmed double opt-in (pending)";
        await this.recordDelivery(organizationId, input, address, "skipped", undefined, error);
        return { status: "skipped", error, address };
      }
      if (optOut) {
        const address = input.channel === "email"
          ? (input.recipient.email ?? "")
          : input.channel === "push"
            ? (input.recipient.pushEndpoint ?? "")
            : input.channel === "telegram"
              ? (input.recipient.telegramChatId ?? "")
              : input.channel === "onsite"
                ? (input.recipient.id ?? "")
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
        // MB4 (ML11): the footer renders in the RECIPIENT's
        // language — CustomerMemory.languagePref for this email
        // address (mixed → bn), else the org default.
        let footerLocale = await resolveDocumentLocale(this.prisma as any, organizationId);
        try {
          const mem = await (this.prisma as any).customerMemory?.findFirst({
            where: { organizationId, customerKey: `email:${normalizePrefAddress("email", input.recipient.email)}` },
            select: { languagePref: true },
          });
          if (mem?.languagePref) footerLocale = normalizeApiLocale(mem.languagePref);
        } catch { /* org default stands */ }
        text += `\n\n—\n${catalogText("messaging.unsubscribeFooter", footerLocale, { url })}`;
        if (html) html += `<p>—<br>${catalogText("messaging.unsubscribeFooterHtml", footerLocale, { url })}</p>`;
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
      if (input.channel === "push") {
        // MX12: the send goes through the REGISTERED push port
        // (webpush module) — messaging never touches the
        // WebPushSubscription/WebPushCampaign tables and never
        // creates a parallel campaign. The port returns the
        // push service's real outcome; "gone" (404/410) is a
        // FAILED delivery here with the real reason, and the
        // port has already marked the subscription gone so
        // future resolves skip it. A missing subscription or an
        // absent port throws into the shared catch below, which
        // records the honest failure — never a fake success.
        address = input.recipient.pushEndpoint ?? "";
        const subscriptionId = input.recipient.pushSubscriptionId ?? null;
        if (!subscriptionId) throw new Error("Recipient has no web push subscription");
        if (!this.pushSendPort) throw new Error("Web Push send port is not available in this deployment (the web push module did not register) — push cannot be sent");
        const title = renderTemplate(input.subject ?? "", { name: input.recipient.name, ...input.vars });
        if (!title.trim()) throw new Error("Push broadcast has no title");
        const outcome = await this.pushSendPort.sendPush(organizationId, {
          subscriptionId, title, body: text, url: input.pushUrl ?? null,
        });
        if (outcome.outcome === "sent") {
          await this.recordDelivery(organizationId, input, address, "sent", undefined);
          return { status: "sent" as const, address };
        }
        const reason = outcome.error
          ?? (outcome.outcome === "gone" ? "Push subscription is gone (the push service reported it dead)" : "Push send failed");
        const error = outcome.statusCode ? `${reason} (HTTP ${outcome.statusCode})` : reason;
        await this.recordDelivery(organizationId, input, address, "failed", undefined, error);
        return { status: "failed" as const, error, address };
      }
      if (input.channel === "telegram") {
        // MX13: the send goes through the REGISTERED telegram
        // port (inbox module) — messaging never touches the
        // Integration credential rows and never calls the Bot
        // API itself. The port returns Telegram's real outcome;
        // "sent" carries the real message_id (stored as the
        // delivery's providerMessageId), anything else is a
        // FAILED delivery with Telegram's real description
        // (e.g. "Forbidden: bot was blocked by the user"). A
        // missing chat id or an absent port throws into the
        // shared catch below, which records the honest
        // failure — never a fake success.
        address = input.recipient.telegramChatId ?? "";
        if (!address.trim()) throw new Error("Recipient has no Telegram chat");
        if (!this.telegramSendPort) throw new Error("Telegram send port is not available in this deployment (the inbox module did not register) — telegram cannot be sent");
        const outcome = await this.telegramSendPort.sendTelegram(organizationId, {
          chatId: address.trim(), text, buttons: input.telegramButtons ?? null,
        });
        if (outcome.outcome === "sent" && outcome.messageId) {
          await this.recordDelivery(organizationId, input, address, "sent", outcome.messageId);
          return { status: "sent" as const, providerMessageId: outcome.messageId, address };
        }
        const error = outcome.outcome === "sent"
          ? "Telegram port reported sent without a message_id"
          : (outcome.error ?? "Telegram send failed");
        await this.recordDelivery(organizationId, input, address, "failed", undefined, error);
        return { status: "failed" as const, error, address };
      }
      if (input.channel === "onsite") {
        // MX14: the send IS a database write — creating the
        // customer's OnsiteNotification row places the message
        // in their shop-account notification center, and that
        // creation is the delivery itself (no external provider
        // exists for this channel, hence no provider cost and
        // no providerMessageId). The linked MessageDelivery is
        // written FIRST with deliveryStatus "delivered" +
        // deliveredAt stamped at creation: the row's presence in
        // the center is a real, observed delivered signal, not
        // an assumption (see the funnel note in
        // broadcastFunnel). "read" is stamped later by the
        // customer's real open action on the shop side, which
        // writes this delivery's readAt.
        // Resume idempotency: a crash between this write and the
        // engine persisting the recipient row's outcome leaves
        // the row pending, so a resume calls here again — the
        // existing-notification check (backed by the
        // (broadcastId, customerId) and deliveryId uniques)
        // makes that second call return "sent" WITHOUT creating
        // a second notification or a second delivery.
        address = input.recipient.id ?? "";
        if (input.recipient.type !== "customer" || !address) {
          throw new Error("Recipient has no customer account for an on-site notification");
        }
        const notifTable = (this.prisma as any).onsiteNotification;
        if (!notifTable || typeof notifTable.create !== "function") {
          throw new Error("On-site notification store is not available in this deployment (the MX14 migration has not run) — onsite cannot be sent");
        }
        if (input.broadcastId && typeof notifTable.findFirst === "function") {
          const existing = await notifTable.findFirst({
            where: { organizationId, broadcastId: input.broadcastId, customerId: address },
          }).catch(() => null);
          if (existing) return { status: "sent" as const, address };
        }
        const title = renderTemplate(input.subject ?? "", { name: input.recipient.name, ...input.vars });
        if (!title.trim()) throw new Error("On-site broadcast has no title");
        const now = new Date();
        const delivery = await (this.prisma as any).messageDelivery.create({
          data: {
            organizationId, broadcastId: input.broadcastId ?? null, workflowRunId: input.workflowRunId ?? null,
            stepRef: input.stepRef ?? null,
            cascadeGroupId: input.cascadeGroupId ?? null,
            recipientRowId: input.recipientRowId ?? null,
            attemptIndex: input.attemptIndex ?? null,
            channel: "onsite", recipientType: input.recipient.type, recipientId: address,
            address, status: "sent", providerMessageId: null, error: null,
            deliveryStatus: "delivered", deliveredAt: now,
          },
        });
        try {
          await notifTable.create({
            data: {
              organizationId, customerId: address,
              broadcastId: input.broadcastId ?? null, deliveryId: delivery?.id ?? null,
              title, body: text, url: input.onsiteUrl ?? null,
            },
          });
        } catch (e) {
          // The notification is the delivery — if it could not
          // be created, the delivery just written must not stand
          // as "sent": remove it (best effort) and fail honestly
          // through the shared catch, which records the failed
          // attempt. A unique-violation here means a concurrent
          // attempt already created this customer's notification
          // for this broadcast — that IS a successful delivery,
          // so the duplicate delivery row goes and "sent" stands.
          await (this.prisma as any).messageDelivery.delete({ where: { id: delivery.id } }).catch(() => undefined);
          if (input.broadcastId && typeof notifTable.findFirst === "function") {
            const existing = await notifTable.findFirst({
              where: { organizationId, broadcastId: input.broadcastId, customerId: address },
            }).catch(() => null);
            if (existing) return { status: "sent" as const, address };
          }
          throw e;
        }
        return { status: "sent" as const, address };
      }
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
        // MX2: with tenant gateways configured, they are tried
        // in failover (priority) order — a provider failure
        // moves to the next gateway; the run's circuit breaker
        // skips a gateway after SMS_CIRCUIT_BREAKER_THRESHOLD
        // consecutive failures. A delivery counts sent ONLY
        // when one gateway confirms; if every gateway fails,
        // the LAST gateway's error is thrown so the recorded
        // failure is the real final reason. The platform path
        // is used only when NO tenant gateway exists (MS4
        // semantics, unchanged).
        const tenantGateways = await this.resolveTenantSmsGateways(organizationId);
        if (tenantGateways.length && typeof (this.sms as any).sendWithGateway === "function") {
          let lastError: unknown = null;
          let usedGateway: string | undefined;
          let sent: { providerMessageId: string } | null = null;
          let attempted = 0;
          for (const cfg of tenantGateways) {
            const key = cfg.gatewayKey ?? smsGatewayKey(cfg);
            if (input.smsBreaker?.isOpen(key)) continue;
            attempted++;
            try {
              sent = await this.sms.sendWithGateway(cfg.gateway, cfg, { to: normalized, text, reference });
              input.smsBreaker?.recordSuccess(key);
              usedGateway = key;
              break;
            } catch (e) {
              lastError = e;
              input.smsBreaker?.recordFailure(key);
            }
          }
          if (!sent) {
            throw lastError instanceof Error
              ? lastError
              : new Error(attempted === 0
                ? "All configured SMS gateways are circuit-broken for this run (too many consecutive provider failures)"
                : "SMS send failed on every configured gateway");
          }
          await this.recordDelivery(organizationId, input, address, "sent", sent.providerMessageId);
          return { status: "sent", providerMessageId: sent.providerMessageId, address, smsGatewayUsed: usedGateway };
        }
        const tenantSms = tenantGateways[0] ?? null;
        const result = tenantSms && typeof (this.sms as any).sendWithGateway === "function"
          ? await this.sms.sendWithGateway(tenantSms.gateway, tenantSms, { to: normalized, text, reference })
          : await this.sms.send({ to: normalized, text, reference });
        await this.recordDelivery(organizationId, input, address, "sent", result.providerMessageId);
        return { status: "sent", providerMessageId: result.providerMessageId, address };
      }
      throw new Error(`Unknown channel: ${input.channel}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Send failed";
      await this.recordDelivery(organizationId, input, address || input.recipient.email || input.recipient.phone || input.recipient.telegramChatId || (input.channel === "onsite" ? (input.recipient.id ?? "") : ""), "failed", undefined, message);
      return { status: "failed", error: message, address };
    }
  }

  private async recordDelivery(organizationId: string, input: { channel: string; recipient: Recipient; broadcastId?: string; workflowRunId?: string; recipientRowId?: string; attemptIndex?: number; cascadeGroupId?: string; stepRef?: string }, address: string, status: string, providerMessageId?: string, error?: string) {
    await (this.prisma as any).messageDelivery.create({
      data: {
        organizationId, broadcastId: input.broadcastId ?? null, workflowRunId: input.workflowRunId ?? null,
        // MX4: per-step attribution for workflow sends (null
        // everywhere else, exactly as before).
        stepRef: input.stepRef ?? null,
        // MX2: cascade attempt linking — present only on
        // cascade attempts; every other delivery keeps nulls.
        cascadeGroupId: input.cascadeGroupId ?? null,
        recipientRowId: input.recipientRowId ?? null,
        attemptIndex: input.attemptIndex ?? null,
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
    // MX2: fallback cascade config — validated strictly by
    // cascade.ts (parseCascadeConfig); shape-only here.
    cascade?: unknown;
    // MX8: per-recipient personalization config — validated
    // strictly by personalization.ts (parsePersonalization
    // Config); shape-only here.
    personalization?: unknown;
    // SA-B20 (G2): the SAME input also carries the G2 config
    // ({ enabled, tier2AiHook? }) — validated by
    // broadcast-personalization.service.ts, persisted on the
    // row's `personalization` column (distinct from MX8's
    // personalizationConfig above).
    // MX10: optional topic tag (preference-center enforcement).
    topic?: string;
    // MX11: holdout percentage (1–50) — a deterministic bucket
    // of the resolved audience held out of the send for
    // comparison. Composes with A/B (same hash, disjoint
    // buckets — see messaging/engagement.ts).
    holdoutPercent?: number;
    // MX12: push click-through URL (shop-relative only — see
    // validatePushUrl). Channel "push" only.
    pushUrl?: string | null;
    // MX13: telegram inline URL buttons — shape-only here (a
    // Json array of {label, url}); validateTelegramButtons
    // enforces the real rules at create. Channel "telegram"
    // only.
    telegramButtons?: unknown;
    // MX14: onsite click-through URL (shop-relative only — see
    // validateOnsiteUrl). Channel "onsite" only.
    onsiteUrl?: string | null;
    // MX15: per-broadcast estimated-cost cap (minor units) —
    // overrides the org default for this broadcast.
    budgetCapMinor?: number;
    // MX16: per-pair A/B auto-winner override — true/false
    // stored on BOTH variants; absent = inherit the org switch.
    abAutoWinnerEnabled?: boolean;
  } & AudienceExtras) {
    if (!["email", "sms", "whatsapp", "push", "telegram", "onsite"].includes(dto.channel)) throw badRequest("messaging.channelMustBeEmailSmsWhatsapp");
    // MX11: the holdout percentage is validated AT CREATE —
    // an honest 400, never silently clamped or ignored.
    let holdoutPercent: number | null = null;
    if (dto.holdoutPercent !== undefined && dto.holdoutPercent !== null) {
      if (!Number.isInteger(dto.holdoutPercent) || dto.holdoutPercent < 1 || dto.holdoutPercent > 50) {
        throw badRequest("messaging.holdoutPercentMustBeAnIntegerBetween");
      }
      holdoutPercent = dto.holdoutPercent;
    }
    // MS5: HTML is an email-only part — sms/whatsapp + htmlBody
    // is an honest 400, checked before any channel path runs.
    if (dto.htmlBody && dto.channel !== "email") throw badRequest("messaging.htmlBodyIsOnlyAllowedForEmail2");
    // MS6: templateComponents is a WhatsApp-only input — any other
    // channel + templateComponents is an honest 400 (the MS5
    // htmlBody rule), never silently ignored. The shape is
    // validated here, before any channel path runs. MS10: the
    // validation itself lives in validateTemplateComponents —
    // create and PATCH share it verbatim.
    const templateComponents = this.validateTemplateComponents(dto.channel, dto.templateComponents ?? null);
    // MX2: the cascade config is validated AT CREATE (strict —
    // unknown channels, a missing primary channel, or fewer
    // than two channels are an honest 400, never reinterpreted).
    let cascadeConfig: CascadeConfig | null = null;
    if (dto.cascade != null) {
      try { cascadeConfig = parseCascadeConfig(dto.cascade, dto.channel); }
      catch (e) { if (e instanceof HttpException) throw e; throw new BadRequestException(e instanceof Error ? e.message : "Invalid cascade config"); }
      // A cascade INTO whatsapp needs a real approved-template
      // row of this org — checked now, at create, not at send.
      if (cascadeConfig && cascadeConfig.channels.includes("whatsapp") && dto.channel !== "whatsapp" && cascadeConfig.whatsappTemplateId) {
        const waTpl = await (this.prisma as any).whatsAppTemplate.findFirst({ where: { id: cascadeConfig.whatsappTemplateId, organizationId } });
        if (!waTpl) throw notFound("messaging.cascadeWhatsAppTemplateNotFoundIn");
        await this.assertWhatsAppTemplateNotQualityBlocked(organizationId, waTpl);
      }
    }
    // MX12: push-channel create rules, all honest 400s at
    // create (never discovered mid-send):
    //  - the cascade cannot include or fall back FROM push in
    //    this version (see the cascade verdict in
    //    docs/messaging-mx12-acceptance.md): CASCADE_CHANNELS
    //    stays email|sms|whatsapp, and parseCascadeConfig above
    //    already refuses a cascade whose channels name push or
    //    omit the primary channel — a push broadcast WITH any
    //    enabled cascade therefore never reaches storage.
    //  - pushUrl is validated by the ONE rule the base push
    //    system uses (shop-relative paths only).
    //  - the audience must be one the subscription resolver
    //    can express (the resolver re-checks at resolve time).
    let pushUrl: string | null = null;
    if (dto.channel === "push") {
      if (dto.templateId) throw badRequest("messaging.pushBroadcastsDoNotUseMessage");
      if (dto.whatsappTemplateId || dto.templateComponents) throw badRequest("messaging.whatsappTemplateIdTemplateComponentsAreOnlyForWhatsA");
      if (!["push_subscribers", "customers", "segment"].includes(dto.audienceType)) {
        throw badRequest("messaging.audienceTypeAudienceTypeIsNotAvailableFor", { audienceType: dto.audienceType });
      }
      try { pushUrl = validatePushUrl(dto.pushUrl); }
      catch (e) { if (e instanceof HttpException) throw e; throw new BadRequestException(e instanceof Error ? e.message : "Invalid pushUrl"); }
    } else if (dto.pushUrl !== undefined && dto.pushUrl !== null && String(dto.pushUrl).trim() !== "") {
      throw badRequest("messaging.pushUrlIsOnlyAllowedForPush");
    }
    // MX13: telegram-channel create rules, all honest 400s at
    // create (never discovered mid-send):
    //  - the cascade cannot include or fall back FROM telegram
    //    in this version (see the cascade verdict in
    //    docs/messaging-mx13-acceptance.md): CASCADE_CHANNELS
    //    stays email|sms|whatsapp — it has no telegram content
    //    slot — and parseCascadeConfig above already refuses a
    //    cascade whose channels name telegram or omit the
    //    primary channel, so a telegram broadcast WITH any
    //    enabled cascade never reaches storage.
    //  - telegram sends a free-text message through the org's
    //    bot: no message templates, no WhatsApp template
    //    inputs, and no subject (Telegram messages have none —
    //    the composer does not ask for one; a non-empty subject
    //    is refused rather than silently dropped).
    //  - the audience must be one the conversation resolver
    //    can express (the resolver re-checks at resolve time).
    //  - buttons are validated by validateTelegramButtons.
    let telegramButtons: TelegramButton[] | null = null;
    if (dto.channel === "telegram") {
      if (dto.templateId) throw badRequest("messaging.telegramBroadcastsDoNotUseMessage");
      if (dto.whatsappTemplateId || dto.templateComponents) throw badRequest("messaging.whatsappTemplateIdTemplateComponentsAreOnlyForWhatsA");
      if (dto.subject !== undefined && dto.subject !== null && String(dto.subject).trim() !== "") {
        throw badRequest("messaging.telegramBroadcastsHaveNoSubjectThe");
      }
      if (!["telegram_subscribers", "customers", "leads_stage", "segment"].includes(dto.audienceType)) {
        throw badRequest("messaging.audienceTypeAudienceTypeIsNotAvailableFor3", { audienceType: dto.audienceType });
      }
      try { telegramButtons = validateTelegramButtons(dto.telegramButtons); }
      catch (e) { if (e instanceof HttpException) throw e; throw new BadRequestException(e instanceof Error ? e.message : "Invalid telegramButtons"); }
    } else if (dto.telegramButtons !== undefined && dto.telegramButtons !== null
      && !(Array.isArray(dto.telegramButtons) && dto.telegramButtons.length === 0)) {
      throw badRequest("messaging.telegramButtonsIsOnlyAllowedForTelegram");
    }
    // MX14: onsite-channel create rules, all honest 400s at
    // create (never discovered mid-send):
    //  - the cascade cannot include or fall back FROM onsite
    //    in this version (see the cascade verdict in
    //    docs/messaging-mx14-acceptance.md): CASCADE_CHANNELS
    //    stays email|sms|whatsapp — it has no onsite content
    //    slot (title/url) — and parseCascadeConfig above
    //    already refuses a cascade whose channels name onsite
    //    or omit the primary channel, so an onsite broadcast
    //    WITH any enabled cascade never reaches storage.
    //  - onsite sends a title + body written directly on the
    //    broadcast into the customer's notification center: no
    //    message templates, no WhatsApp template inputs.
    //  - the audience must be one the customer resolver can
    //    express (the resolver re-checks at resolve time).
    //  - onsiteUrl is validated by validateOnsiteUrl (the
    //    MX12 shop-relative rule).
    let onsiteUrl: string | null = null;
    if (dto.channel === "onsite") {
      if (dto.templateId) throw badRequest("messaging.onSiteBroadcastsDoNotUse");
      if (dto.whatsappTemplateId || dto.templateComponents) throw badRequest("messaging.whatsappTemplateIdTemplateComponentsAreOnlyForWhatsA");
      if (!["customers", "segment"].includes(dto.audienceType)) {
        throw badRequest("messaging.audienceTypeAudienceTypeIsNotAvailableFor2", { audienceType: dto.audienceType });
      }
      try { onsiteUrl = validateOnsiteUrl(dto.onsiteUrl); }
      catch (e) { if (e instanceof HttpException) throw e; throw new BadRequestException(e instanceof Error ? e.message : "Invalid onsiteUrl"); }
    } else if (dto.onsiteUrl !== undefined && dto.onsiteUrl !== null && String(dto.onsiteUrl).trim() !== "") {
      throw badRequest("messaging.onsiteUrlIsOnlyAllowedForOnsite");
    }
    // SA-B20 (G2): the personalisation config is shape-validated
    // up front (Tier 2 + WhatsApp is a 400 here — Meta templates
    // have no free-text body); the {{aiHook}} placeholder check
    // runs below once the final body (dto / template / A/B) is
    // known. Null = off.
    const personalization = normalizePersonalizationConfig(dto.personalization, dto.channel);
    // MS3: the new audience types are validated AT CREATE (the
    // shared base objects below carry the fields to both A/B
    // variants and both channel paths).
    let audienceDefinition: AudienceDefinition | null = null;
    let audienceSavedId: string | null = null;
    let audienceCsv: string[] | null = null;
    if (dto.audienceType === "custom") {
      audienceDefinition = this.assertValidDefinition(dto.audienceDefinition);
    } else if (dto.audienceType === "saved") {
      if (!dto.audienceSavedId) throw badRequest("messaging.audienceSavedIdIsRequiredForSavedAudience");
      audienceSavedId = dto.audienceSavedId;
    } else if (dto.audienceType === "csv") {
      audienceCsv = parseAddressList(dto.audienceCsv);
      if (!audienceCsv.length) throw badRequest("messaging.audienceCsvHasNoAddressesPasteAt");
      if (audienceCsv.length > CSV_AUDIENCE_CAP) {
        throw badRequest("messaging.cSVAudienceHasAudienceCsvLengthAddressesOver", { audienceCsvLength: audienceCsv.length, CSV_AUDIENCE_CAP: CSV_AUDIENCE_CAP });
      }
    }
    // MX8: the personalization config is validated AT CREATE
    // (strict — a bad coupon kind/value, an oversized segment
    // block list or an invalid inline audience definition is an
    // honest 400, never reinterpreted at send time). A segment
    // block referencing a saved audience must name a REAL saved
    // audience of this org — checked now, not discovered mid-send.
    let personalizationConfig: PersonalizationConfig | null = null;
    // UNION (MX8 x SA-B20 G2, 2026-10-17): the create DTO's single
    // `personalization` input carries TWO vocabularies persisted on
    // two different columns — MX8's (uniqueCoupon / recommendations
    // / segmentBlocks -> the personalizationConfig column) and G2's
    // ({ enabled, tier2AiHook } -> the personalization column,
    // normalized above). The MX8 validation below applies only when
    // the input actually carries MX8 vocabulary: a G2-only config
    // must not die in the MX8 parser ("configures nothing"), and a
    // Tier-1 G2 config must not hit the MX8 channel refusals (G2
    // Tier 1 works on WhatsApp; only Tier 2 is refused there, by
    // the G2 normalizer itself).
    const rawPersonalization = dto.personalization as Record<string, unknown> | null | undefined;
    const hasMx8Shape = !!rawPersonalization && typeof rawPersonalization === "object" && !Array.isArray(rawPersonalization)
      && (rawPersonalization.uniqueCoupon != null || rawPersonalization.recommendations != null || rawPersonalization.segmentBlocks != null);
    if (dto.personalization != null && hasMx8Shape) {
      // MX8 personalization rewrites the free-text body/htmlBody
      // a plain email/sms send renders. WhatsApp sends Meta
      // templates (nothing to rewrite) and a cascade run owns
      // its per-channel content — combining them would silently
      // half-apply, so both are honest 400s at create.
      if (dto.channel === "whatsapp") {
        throw badRequest("messaging.personalizationIsNotAvailableForWhatsApp");
      }
      if (dto.channel === "push") {
        // MX12: the push payload is a length-capped title/body
        // (the base system's rule) — MX8 dynamic blocks append
        // content at send time and could silently overflow the
        // cap, so the combination is refused at create instead.
        throw badRequest("messaging.personalizationIsNotAvailableForPush");
      }
      if (dto.channel === "telegram") {
        // MX13: a telegram message is length-capped by the Bot
        // API itself (4096 chars, enforced at create below) —
        // MX8 dynamic blocks append content at send time and
        // could silently overflow it, so the combination is
        // refused at create instead (the MX12 push precedent).
        throw badRequest("messaging.personalizationIsNotAvailableForTelegram");
      }
      if (dto.channel === "onsite") {
        // MX14: an onsite notification is a length-capped
        // title/body stored verbatim in the customer's center
        // (caps enforced at create below) — MX8 dynamic blocks
        // append content at send time and could silently
        // overflow them, so the combination is refused at
        // create instead (the MX12/MX13 precedent).
        throw badRequest("messaging.personalizationIsNotAvailableForOnsite");
      }
      if (cascadeConfig) {
        throw badRequest("messaging.personalizationCannotBeCombinedWithA");
      }
      try { personalizationConfig = parsePersonalizationConfig(dto.personalization); }
      catch (e) {
        if (e instanceof HttpException) throw e; throw new BadRequestException(e instanceof PersonalizationConfigError ? e.message : "Invalid personalization config");
      }
      if (personalizationConfig?.segmentBlocks?.length) {
        for (const block of personalizationConfig.segmentBlocks) {
          if (block.savedAudienceId) {
            const saved = await (this.prisma as any).messagingSavedAudience?.findFirst?.({
              where: { id: block.savedAudienceId, organizationId },
            }).catch(() => null);
            if (!saved) throw notFound("messaging.segmentBlockSavedAudienceNotFound");
          }
        }
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
        if (e instanceof HttpException) throw e; throw new BadRequestException(e instanceof RecurrenceValidationError ? e.message : "Invalid recurrence");
      }
      recurrenceGroupId = randomUUID();
    }
    // MX15: budget cap validated AT CREATE like every other
    // strict field (a positive integer of minor units).
    let budgetCapMinor: number | null = null;
    if (dto.budgetCapMinor !== undefined && dto.budgetCapMinor !== null) {
      if (!Number.isInteger(dto.budgetCapMinor) || dto.budgetCapMinor < 1) {
        throw badRequest("messaging.budgetCapMinorMustBeAPositiveInteger");
      }
      budgetCapMinor = dto.budgetCapMinor;
    }
    // MX16: the per-pair auto-winner override is a real boolean
    // when given (never silently coerced).
    if (dto.abAutoWinnerEnabled !== undefined && typeof dto.abAutoWinnerEnabled !== "boolean") {
      throw badRequest("messaging.abAutoWinnerEnabledMustBeABoolean");
    }
    // MX15: approval workflow — when the org enabled it and the
    // creator is NOT an approver, the broadcast enters review
    // instead of draft/scheduled. When approval is OFF (the
    // default) nothing below changes a single stored field.
    const governanceAtCreate = await this.getGovernanceSetting(organizationId);
    const needsApproval = governanceAtCreate.approvalEnabled
      && !(await this.isBroadcastApprover(organizationId, actorId));
    const initialStatus = needsApproval ? "pending_approval" : scheduledAt ? "scheduled" : "draft";
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
      if (!dto.whatsappTemplateId) throw badRequest("messaging.whatsAppBroadcastsNeedARegisteredTemplate");
      const tpl = await (this.prisma as any).whatsAppTemplate.findFirst({ where: { id: dto.whatsappTemplateId, organizationId } });
      if (!tpl) throw notFound("messaging.whatsAppTemplateNotFoundInThis");
      await this.assertWhatsAppTemplateNotQualityBlocked(organizationId, tpl);
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
        cascadeConfig: cascadeConfig ?? undefined,
        topic: dto.topic ? String(dto.topic).trim() : null,
        holdoutPercent,
        ...(needsApproval ? { approvalStatus: "pending" } : {}),
        ...(budgetCapMinor !== null ? { budgetCapMinor } : {}),
        ...(dto.abAutoWinnerEnabled !== undefined ? { abAutoWinnerEnabled: dto.abAutoWinnerEnabled } : {}),
        personalization: personalization ?? undefined,
      };
      if (dto.abTest) {
        if (!dto.abWhatsappTemplateId) throw badRequest("messaging.aBWhatsAppBroadcastsNeedA");
        const tplB = await (this.prisma as any).whatsAppTemplate.findFirst({ where: { id: dto.abWhatsappTemplateId, organizationId } });
        if (!tplB) throw notFound("messaging.aBWhatsAppTemplateNotFound");
        await this.assertWhatsAppTemplateNotQualityBlocked(organizationId, tplB);
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
    let templateVersion: number | null = null;
    if (dto.templateId) {
      const template = await this.getTemplate(organizationId, dto.templateId);
      if (template.channel !== dto.channel) throw badRequest("messaging.templateChannelDoesNotMatchThe");
      subject = template.subject; body = template.body; htmlBody = template.htmlBody ?? null;
      // MX7: stamp the version the content is taken from, and —
      // for a block-built template — RE-RENDER the blocks NOW
      // (use time) so product/coupon slots and the brand kit
      // reflect the org's current real rows. The broadcast then
      // stores its own copy as always: later kit/catalog changes
      // never rewrite this broadcast or anything already sent.
      templateVersion = template.version ?? null;
      if (template.channel === "email" && Array.isArray(template.blocks) && template.blocks.length) {
        const rendered = await this.renderBlocksForOrg(organizationId, template.blocks);
        body = rendered.body; htmlBody = rendered.htmlBody;
      }
    }
    if (!body) throw badRequest("messaging.broadcastBodyIsRequiredWriteOne");
    if (dto.channel === "email" && !subject) throw badRequest("messaging.emailBroadcastsNeedASubject");
    if (dto.channel === "push") {
      // MX12: for push, `subject` carries the notification
      // TITLE and `body` the notification text — the exact
      // payload the shop service worker renders. Length caps
      // are the base push system's own (webpush validateSend:
      // title ≤ 120, body ≤ 300), enforced here at create so a
      // broadcast can never be stored in a shape the push
      // service would refuse at send time.
      if (!subject || !String(subject).trim()) throw badRequest("messaging.pushBroadcastsNeedATitleSubject");
      if (String(subject).length > 120) throw badRequest("messaging.pushTitleMustBeAtMost");
      if (String(body).length > 300) throw badRequest("messaging.pushBodyMustBeAtMost");
    }
    if (dto.channel === "telegram") {
      // MX13: Telegram's own Bot API hard cap — a message text
      // longer than 4096 characters is refused by Telegram at
      // send time, so it is refused here at create instead
      // (the MX12 push-cap precedent).
      if (String(body).length > 4096) throw badRequest("messaging.telegramMessageTextMustBeAt");
    }
    if (dto.channel === "onsite") {
      // MX14: for onsite, `subject` carries the notification
      // TITLE and `body` the notification text — the exact
      // content the customer's notification center renders.
      // The caps are this channel's own store rules (title
      // ≤ 120, the MX12 title precedent; body ≤ 2000, a full
      // in-center message — no provider imposes a cap here, so
      // the rule is stated as ours, not a provider's), enforced
      // at create so a stored notification is always renderable
      // as composed.
      if (!subject || !String(subject).trim()) throw badRequest("messaging.onSiteBroadcastsNeedATitle");
      if (String(subject).length > 120) throw badRequest("messaging.onSiteTitleMustBeAt");
      if (String(body).length > 2000) throw badRequest("messaging.onSiteBodyMustBeAt");
    }
    // SA-B20 (G2): the {{aiHook}} placeholder check against the
    // FINAL bodies (variant B gets the same config, so its body
    // must carry the placeholder too).
    assertTier2HookPlaceholder(body, personalization);
    if (dto.abTest && dto.abBody) assertTier2HookPlaceholder(dto.abBody, personalization);
    const baseData = {
      organizationId, channel: dto.channel,
      // MX12: the push click-through URL (null on every other
      // channel — validated above, push-only).
      pushUrl: dto.channel === "push" ? pushUrl : null,
      // MX13: the telegram inline URL buttons (null on every
      // other channel — validated above, telegram-only).
      telegramButtons: dto.channel === "telegram" ? telegramButtons : null,
      // MX14: the onsite click-through URL (null on every other
      // channel — validated above, onsite-only).
      onsiteUrl: dto.channel === "onsite" ? onsiteUrl : null,
      audienceType: dto.audienceType, audienceStage: dto.audienceStage ?? null, audienceSegment: dto.audienceSegment ?? null,
      audienceDefinition, audienceSavedId, audienceCsv,
      excludePreviousRecipients: dto.excludePreviousRecipients ?? false,
      excludePastDays: dto.excludePastDays ?? null, excludeOptOut: dto.excludeOptOut ?? true,
      status: initialStatus, scheduledAt, createdById: actorId,
      recurrence, recurrenceGroupId,
      cascadeConfig: cascadeConfig ?? undefined,
      personalizationConfig: personalizationConfig ?? undefined,
      topic: dto.topic ? String(dto.topic).trim() : null,
      holdoutPercent,
      ...(needsApproval ? { approvalStatus: "pending" } : {}),
      ...(budgetCapMinor !== null ? { budgetCapMinor } : {}),
      ...(dto.abAutoWinnerEnabled !== undefined ? { abAutoWinnerEnabled: dto.abAutoWinnerEnabled } : {}),
      personalization: personalization ?? undefined,
    };
    if (dto.abTest) {
      if (!dto.abBody) throw badRequest("messaging.aBBroadcastsNeedAVariant");
      const abGroupId = randomUUID();
      // MS5: htmlBody is stored on variant A only — there is no
      // abHtmlBody input, so variant B's htmlBody is null and its
      // sends stay text-only (honest asymmetry, not a silent copy).
      const a = await (this.prisma as any).broadcast.create({
        data: { ...baseData, name: `${dto.name} (A)`, templateId: dto.templateId ?? null, templateVersion, subject, body, htmlBody, abVariant: "A", abGroupId },
      });
      const b = await (this.prisma as any).broadcast.create({
        data: { ...baseData, name: `${dto.name} (B)`, templateId: null, subject: dto.abSubject ?? subject, body: dto.abBody, htmlBody: null, abVariant: "B", abGroupId },
      });
      return { abGroupId, variants: [a, b] };
    }
    const broadcast = await (this.prisma as any).broadcast.create({
      data: { ...baseData, name: dto.name, templateId: dto.templateId ?? null, templateVersion, subject, body, htmlBody },
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
    // MX1: recipient-table broadcasts carry a derived
    // skippedCount (written from the recipient rows per chunk);
    // rows without it (every pre-MX1 row) read 0, exactly as the
    // old fallback did.
    const skipped = Number(broadcast?.skippedCount ?? 0);
    return { total, sent, failed, skipped, pending: Math.max(0, total - sent - failed - skipped) };
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
    if (!broadcast) throw notFound("messaging.broadcastNotFound");
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
    if (channel !== "whatsapp") throw badRequest("messaging.templateComponentsIsOnlyAllowedForWhatsApp");
    const tc: any = input;
    if (typeof tc !== "object" || Array.isArray(tc)) throw badRequest("messaging.templateComponentsMustBeAnObject");
    if (tc.headerMediaUrl != null && !/^https?:\/\//i.test(String(tc.headerMediaUrl))) {
      throw badRequest("messaging.templateComponentsHeaderMediaUrlMustBeAnHttp");
    }
    if (tc.headerTextParams != null && (!Array.isArray(tc.headerTextParams) || tc.headerTextParams.some((v: unknown) => typeof v !== "string"))) {
      throw badRequest("messaging.templateComponentsHeaderTextParamsMustBeAnArray");
    }
    if (tc.buttonParams != null) {
      if (!Array.isArray(tc.buttonParams)) throw badRequest("messaging.templateComponentsButtonParamsMustBeAnArray");
      for (const b of tc.buttonParams as any[]) {
        if (!b || !Number.isInteger(b.index) || b.index < 0) throw badRequest("messaging.templateComponentsButtonParamsIndexMustBeAn");
        if (b.subType !== "url" && b.subType !== "quick_reply") throw badRequest("messaging.templateComponentsButtonParamsSubTypeMustBeUrl");
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
    if (Number.isNaN(when.getTime())) throw badRequest("messaging.scheduledAtIsNotAValidDate");
    if (when.getTime() <= Date.now()) throw badRequest("messaging.scheduledAtMustBeInTheFuture");
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
    // MX8: loyalty / gift-card balance vars from the real
    // Advanced ledgers (defensive — any read failure leaves the
    // vars unset, which renders empty, never an invented number).
    await this.addBalanceVars(organizationId, recipients, varsList);
    return varsList;
  }

  /**
   * MX8 — fill {{loyaltyPoints}} / {{giftCardBalance}} from the
   * REAL Advanced ledgers. NOTE: these two keys are deliberately
   * NOT added to TEMPLATE_VARIABLES — ms5-composer.spec.ts pins
   * that catalogue to exactly the MS5 keys ("lists exactly the
   * keys prepare builds"), and pins are never edited to fit a
   * new feature. The vars are built here and render normally;
   * they are documented in docs/messaging-mx8-acceptance.md
   * instead of the composer catalogue (recorded NOT BUILT
   * there, with this pin as the evidence).
   * Messaging reads these tables through
   * Prisma exactly like it already reads Customer/Order/Product/
   * StoreDiscount (the MX7 precedent — messaging imports no
   * commerce service; the module boundary is import-level).
   *  - Loyalty: LoyaltyService.checkoutSnapshot is the ledger's
   *    own read path and it returns the Customer
   *    .loyaltyBalanceCache the ledger maintains (null when the
   *    program is disabled or the customer was merged away).
   *    MX8 mirrors that read: program disabled ⇒ the var stays
   *    EMPTY (no program, no balance to report); enabled ⇒ the
   *    real cached balance, including a real 0 or a negative
   *    clawback balance, rendered as-is.
   *  - Gift cards are BEARER instruments — there is no per-
   *    customer balance API and no holder field. The honest
   *    per-recipient sum is over ACTIVE, unexpired GiftCard rows
   *    that are the recipient's own: addressed to their
   *    email/phone (the card's recipient fields), or bought by
   *    the customer with NO addressee (a self-purchase). A card
   *    bought by one customer for another person counts only
   *    for the addressee. No matching card ⇒ 0.00 for an
   *    identified customer/lead; csv recipients have no identity
   *    record to match against, so their var stays empty.
   */
  private async addBalanceVars(organizationId: string, recipients: Recipient[], varsList: Record<string, unknown>[]): Promise<void> {
    const money = (minor: bigint): string => (Number(minor) / 100).toFixed(2);
    // --- loyalty (customers only; the ledger is customer-keyed)
    try {
      const settingTable = (this.prisma as any).loyaltySetting;
      const setting = settingTable?.findFirst
        ? await settingTable.findFirst({ where: { organizationId } }).catch(() => null)
        : null;
      const custIdx = recipients.map((r, i) => ({ r, i })).filter(({ r }) => r.type === "customer" && r.id);
      if (setting?.enabled && custIdx.length) {
        const ids = [...new Set(custIdx.map(({ r }) => r.id!))];
        const balances = new Map<string, number>();
        for (let s = 0; s < ids.length; s += 500) {
          const rows: any[] = await (this.prisma as any).customer.findMany({
            where: { organizationId, id: { in: ids.slice(s, s + 500) } },
            select: { id: true, loyaltyBalanceCache: true, mergedIntoId: true },
          });
          for (const c of rows ?? []) {
            // checkoutSnapshot parity: a merged-away customer
            // reports no balance of its own.
            if (!c.mergedIntoId) balances.set(c.id, Number(c.loyaltyBalanceCache ?? 0));
          }
        }
        for (const { r, i } of custIdx) {
          if (balances.has(r.id!)) varsList[i] = { ...varsList[i], loyaltyPoints: balances.get(r.id!) };
        }
      }
    } catch { /* no readable ledger ⇒ vars stay empty */ }
    // --- gift cards (customers + leads, by real card linkage)
    try {
      const gc = (this.prisma as any).giftCard;
      if (!gc?.findMany) return;
      const targets = recipients.map((r, i) => ({ r, i })).filter(({ r }) => r.type === "customer" || r.type === "lead");
      if (!targets.length) return;
      const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
      for (let s = 0; s < targets.length; s += 500) {
        const chunk = targets.slice(s, s + 500);
        const customerIds = chunk.filter(({ r }) => r.type === "customer" && r.id).map(({ r }) => r.id!);
        const emails = [...new Set(chunk.map(({ r }) => (r.email ?? "").trim().toLowerCase()).filter(Boolean))];
        const phoneForms = [...new Set(chunk.flatMap(({ r }) => [String(r.phone ?? "").trim(), digits(r.phone)]).filter(Boolean))];
        const or: Record<string, unknown>[] = [];
        if (customerIds.length) or.push({ buyerCustomerId: { in: customerIds } });
        if (emails.length) or.push({ recipientEmail: { in: emails, mode: "insensitive" } });
        if (phoneForms.length) or.push({ recipientPhone: { in: phoneForms } });
        if (!or.length) continue;
        const cards: any[] = await gc.findMany({
          where: { organizationId, status: "active", OR: or },
          select: { buyerCustomerId: true, recipientEmail: true, recipientPhone: true, balanceCache: true, expiresAt: true },
        }).catch(() => []);
        const now = Date.now();
        for (const { r, i } of chunk) {
          const email = (r.email ?? "").trim().toLowerCase();
          const phone = digits(r.phone);
          let sum = 0n;
          for (const card of cards ?? []) {
            if (card.expiresAt && new Date(card.expiresAt).getTime() <= now) continue;
            const addrEmail = String(card.recipientEmail ?? "").trim().toLowerCase();
            const addrPhone = digits(card.recipientPhone);
            const addressedToMe = (addrEmail !== "" && addrEmail === email) || (addrPhone !== "" && addrPhone === phone);
            const selfBought = r.type === "customer" && r.id != null
              && card.buyerCustomerId === r.id && addrEmail === "" && addrPhone === "";
            if (!addressedToMe && !selfBought) continue;
            try { sum += BigInt(card.balanceCache ?? 0); } catch { /* an unreadable balance contributes nothing */ }
          }
          varsList[i] = { ...varsList[i], giftCardBalance: money(sum) };
        }
      }
    } catch { /* same honesty rule: empty, never invented */ }
  }

  // ---------- MX8: per-recipient dynamic personalization ----------

  /**
   * MX8 — issue ONE unique coupon for ONE recipient of ONE
   * broadcast: a real StoreDiscount row (the audit's verdict —
   * the platform Coupon model is plan-billing only), with
   * usageLimit 1 (the checkout evaluator refuses once
   * usedCount reaches it, and redeem() increments usedCount at
   * placement) AND perCustomerLimit 1 (counted from the
   * customer's stamped orders), origin "messaging_unique" and
   * sourceRef `<broadcastId>:<dedupeKey>` (the GB7 provenance
   * pattern, extended with the recipient key).
   * IDEMPOTENT by construction: before creating, any row already
   * carrying this exact sourceRef is reused — so even a crash
   * between the create and the state persist can never produce
   * a second coupon for the same recipient on resume.
   * Failure is RETURNED, never thrown: the recipient is sent to
   * without a coupon (variable empty) and the error is recorded
   * in their personalization state.
   */
  private async issueUniqueCoupon(
    organizationId: string, broadcastId: string, recipientKey: string, cfg: UniqueCouponConfig,
  ): Promise<{ code: string; discountId: string } | { error: string }> {
    const table = (this.prisma as any).storeDiscount;
    if (!table?.create || !table?.findFirst) return { error: "coupon store (StoreDiscount) is not available in this deployment" };
    const sourceRef = `${broadcastId}:${recipientKey}`;
    try {
      const existing = await table.findFirst({ where: { organizationId, origin: "messaging_unique", sourceRef } });
      if (existing?.code) return { code: String(existing.code), discountId: String(existing.id) };
    } catch { /* fall through to issuance */ }
    let lastError = "coupon issuance failed";
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = buildUniqueCouponCode(cfg.prefix, randomBytes(5).toString("hex"));
      try {
        const row = await table.create({
          data: {
            organizationId, code, kind: cfg.kind, value: cfg.value,
            endsAt: new Date(Date.now() + cfg.expiryDays * 86400_000),
            usageLimit: 1, perCustomerLimit: 1, usedCount: 0,
            active: true, origin: "messaging_unique", sourceRef,
          },
        });
        return { code: String(row.code ?? code), discountId: String(row.id) };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (!/unique|P2002/i.test(lastError)) return { error: lastError };
        // A code collision retries with fresh bytes; a sourceRef
        // claim won concurrently is picked up by the next loop's
        // create failing again — so re-check the claim first.
        try {
          const won = await table.findFirst({ where: { organizationId, origin: "messaging_unique", sourceRef } });
          if (won?.code) return { code: String(won.code), discountId: String(won.id) };
        } catch { /* keep retrying */ }
      }
    }
    return { error: lastError };
  }

  /** MX8 — the recipient's audience facts for ONE definition,
   * built with the resolver's exact rules (resolveCustomAudience
   * InChunks): aggregates/RFM are computed only when a condition
   * needs them, missing facts stay null (which the evaluator
   * reads as FALSE). Entity mismatch ⇒ null (never a member). */
  private async audienceFactsForRecipient(organizationId: string, entry: SnapshotEntry, def: AudienceDefinition): Promise<AudienceFacts | null> {
    if (!entry.id) return null;
    // MX11: engagement facts for this one contact, only when a
    // condition reads them (org-wide map, the RFM precedent in
    // this very method — computeRfm is likewise org-wide here).
    const needsEngagement = def.conditions.some((c) => c.field === "engagement_score" || c.field === "predictive_segment");
    const engagementMap = needsEngagement ? await this.buildEngagementMap(organizationId).catch(() => null) : null;
    if (def.entity === "leads") {
      if (entry.type !== "lead") return null;
      const l = await (this.prisma as any).lead?.findFirst?.({ where: { id: entry.id, organizationId } }).catch(() => null);
      if (!l) return null;
      return {
        source: l.source ?? null,
        createdDaysAgo: MessagingService.daysSince(l.createdAt),
        hasEmail: !!l.email, hasPhone: !!l.phone,
        customFields: l.customFields && typeof l.customFields === "object" ? l.customFields : null,
        stage: l.stage ?? null,
        tags: Array.isArray(l.tags) ? l.tags : [],
        valueMinor: l.valueMinor === null || l.valueMinor === undefined ? null : Number(l.valueMinor),
        engagementScore: engagementMap ? (engagementMap.get(`lead:${l.id}`)?.score ?? 0) : null,
        predictiveSegments: engagementMap ? (engagementMap.get(`lead:${l.id}`)?.segments ?? []) : [],
      };
    }
    if (entry.type !== "customer") return null;
    const c = await (this.prisma as any).customer?.findFirst?.({ where: { id: entry.id, organizationId } }).catch(() => null);
    if (!c) return null;
    const needsAggregates = def.conditions.some((cond) => ["orders_count", "total_spent_minor", "last_order_days_ago"].includes(cond.field));
    const needsRfm = def.conditions.some((cond) => cond.field === "rfm_segment");
    let agg: { frequency: number; monetary: bigint; last: number } | undefined;
    let segment: string | null = null;
    if (needsAggregates || needsRfm) {
      const aggregates = await computeOrderAggregates(this.prisma as any, organizationId).catch(() => null);
      agg = aggregates?.get(entry.id);
      if (needsRfm) {
        const rows = await computeRfm(this.prisma as any, organizationId).catch(() => []);
        segment = new Map((rows ?? []).map((r: any) => [r.customerId, r.segment])).get(entry.id) ?? null;
      }
    }
    const now = Date.now();
    return {
      source: c.source ?? null,
      createdDaysAgo: MessagingService.daysSince(c.createdAt),
      hasEmail: !!c.email, hasPhone: !!c.phone,
      customFields: c.customFields && typeof c.customFields === "object" ? c.customFields : null,
      ordersCount: agg?.frequency ?? 0,
      totalSpentMinor: agg ? Number(agg.monetary) : 0,
      lastOrderDaysAgo: agg ? Math.max(0, Math.floor((now - agg.last) / 86400000)) : null,
      rfmSegment: segment,
      address: c.address && typeof c.address === "object" && !Array.isArray(c.address) ? c.address : null,
      engagementScore: engagementMap ? (engagementMap.get(`customer:${c.id}`)?.score ?? 0) : null,
      predictiveSegments: engagementMap ? (engagementMap.get(`customer:${c.id}`)?.segments ?? []) : [],
    };
  }

  /** MX8 — resolve one segment block's definition: its own
   * inline definition, or the CURRENT definition of the saved
   * audience it references (the MS3 rule — a draft broadcast
   * reads the saved audience at use time; a missing/deleted one
   * matches NOBODY, never everybody). */
  private async segmentDefinitionFor(organizationId: string, block: SegmentBlockConfig): Promise<AudienceDefinition | null> {
    if (block.definition) return block.definition;
    if (!block.savedAudienceId) return null;
    const row = await (this.prisma as any).messagingSavedAudience?.findFirst?.({
      where: { id: block.savedAudienceId, organizationId },
    }).catch(() => null);
    if (!row?.definition) return null;
    try { return this.assertValidDefinition(row.definition); } catch { return null; }
  }

  /**
   * MX8 — the recommendation block for ONE recipient, from real
   * data only (see personalization.ts for the rule): the
   * recipient's most recent purchased category → in-stock ACTIVE
   * catalog products of that category they have not bought;
   * failing that, the category of products they VIEWED as an
   * identified visitor (Visitor matched by their own email or
   * phone — the MX5 honesty rule: an unidentified visitor has
   * no resolvable recipient, and an unmatched recipient has no
   * browsing signal). No signal ⇒ the org's fallback text or
   * nothing. csv recipients have no identity record and are
   * never recommended to. Every read is defensive: a failure
   * degrades to "no signal", never to an invented product.
   */
  private async recommendationForRecipient(
    organizationId: string, entry: SnapshotEntry, cfg: NonNullable<PersonalizationConfig["recommendations"]>,
  ): Promise<{ text: string; html: string; signal: string; productIds: string[] }> {
    const none = { text: "", html: "", signal: "none", productIds: [] as string[] };
    if (entry.type !== "customer" && entry.type !== "lead") return none;
    try {
      const productTable = (this.prisma as any).product;
      if (!productTable?.findMany) return none;
      // Purchased catalog products, most recent order first.
      const purchased: { productId: string; category: string | null }[] = [];
      const purchasedIds = new Set<string>();
      if (entry.type === "customer" && entry.id) {
        const orders: any[] = await (this.prisma as any).order.findMany({
          where: { organizationId, customerId: entry.id, status: { not: "cancelled" } },
          orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }], take: 20, select: { id: true },
        }).catch(() => []);
        if (orders?.length) {
          const items: any[] = await (this.prisma as any).orderItem.findMany({
            where: { orderId: { in: orders.map((o: any) => o.id) } }, select: { orderId: true, productId: true },
          }).catch(() => []);
          const byOrder = new Map<string, any[]>();
          for (const it of items ?? []) {
            if (!it.productId) continue;
            const arr = byOrder.get(it.orderId) ?? [];
            arr.push(it);
            byOrder.set(it.orderId, arr);
          }
          const orderedIds: string[] = [];
          for (const o of orders) {
            for (const it of byOrder.get(o.id) ?? []) {
              if (!purchasedIds.has(it.productId)) { purchasedIds.add(it.productId); orderedIds.push(it.productId); }
            }
          }
          if (orderedIds.length) {
            const rows: any[] = await productTable.findMany({ where: { organizationId, id: { in: orderedIds } } }).catch(() => []);
            const byId = new Map((rows ?? []).map((p: any) => [p.id, p]));
            for (const pid of orderedIds) {
              const p = byId.get(pid);
              if (p) purchased.push({ productId: pid, category: p.category ?? null });
            }
          }
        }
      }
      // Browsing signal: identified visitor (email/phone match)
      // → their product_view events, most recent first.
      const browsedCategories: (string | null)[] = [];
      const visitorTable = (this.prisma as any).visitor;
      const eventTable = (this.prisma as any).trackingEvent;
      if (visitorTable?.findMany && eventTable?.findMany && (entry.email || entry.phone)) {
        const or: Record<string, unknown>[] = [];
        if (entry.email) or.push({ email: entry.email });
        if (entry.phone) or.push({ phone: entry.phone });
        const visitors: any[] = await visitorTable.findMany({ where: { organizationId, OR: or }, select: { id: true } }).catch(() => []);
        const visitorIds = (visitors ?? []).map((v: any) => v.id).filter(Boolean);
        if (visitorIds.length) {
          const events: any[] = await eventTable.findMany({
            where: { organizationId, visitorId: { in: visitorIds }, type: "product_view" },
            orderBy: { occurredAt: "desc" }, take: 100,
          }).catch(() => []);
          const viewedIds: string[] = [];
          const seenViewed = new Set<string>();
          for (const e of events ?? []) {
            const pid = e?.properties && typeof e.properties === "object" ? (e.properties as any).productId : null;
            if (pid != null && !seenViewed.has(String(pid))) { seenViewed.add(String(pid)); viewedIds.push(String(pid)); }
          }
          if (viewedIds.length) {
            const rows: any[] = await productTable.findMany({ where: { organizationId, id: { in: viewedIds } } }).catch(() => []);
            const byId = new Map((rows ?? []).map((p: any) => [p.id, p]));
            for (const pid of viewedIds) {
              const p = byId.get(pid);
              if (p) browsedCategories.push(p.category ?? null);
            }
          }
        }
      }
      // The org's real catalog: ACTIVE, in stock (a null
      // stockQuantity is untracked inventory — the product is
      // sellable, as elsewhere in this codebase), newest first.
      const catalogRows: any[] = await productTable.findMany({
        where: { organizationId, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 200,
      }).catch(() => []);
      const catalog = (catalogRows ?? [])
        .filter((p: any) => p.stockQuantity === null || p.stockQuantity === undefined || Number(p.stockQuantity) > 0)
        .map((p: any) => ({
          id: p.id, name: p.name, priceMinor: p.priceMinor, currency: p.currency ?? "BDT",
          url: p.slug ? `${webBaseUrl()}/checkout/${p.slug}` : null, category: p.category ?? null,
        }));
      const result = pickRecommendations({ purchased, browsedCategories, catalog, limit: cfg.limit });
      const rendered = renderRecommendationBlock(result, cfg);
      return { text: rendered.text, html: rendered.html, signal: result.signal, productIds: result.products.map((p) => p.id) };
    } catch {
      return none;
    }
  }

  /**
   * MX8 — compute ONE recipient's personalized content for a
   * broadcast send (broadcast engines only — workflow sends
   * never come here, so the MS5/MS7 pins hold structurally).
   * `existing` is the recipient's persisted MX8 state (recipient
   * row / snapshot entry): anything already computed there —
   * above all an issued coupon code — is REUSED verbatim, so a
   * resume or retry-failed can never issue a second coupon or
   * change the dynamic content mid-broadcast. The caller
   * persists a changed state BEFORE the provider call.
   */
  private async personalizeForRecipient(
    organizationId: string, broadcast: any, config: PersonalizationConfig,
    entry: SnapshotEntry, existing: Record<string, unknown> | null,
  ): Promise<{ body: string; htmlBody: string | null; vars: Record<string, unknown>; state: Record<string, unknown>; stateChanged: boolean }> {
    const state: Record<string, unknown> = { ...(existing ?? {}) };
    let stateChanged = false;
    let vars: Record<string, unknown> = entry.vars ?? {};

    // Unique coupon — issued at send time, once per recipient.
    let couponCode: string | null = typeof state.couponCode === "string" ? state.couponCode : null;
    if (config.uniqueCoupon) {
      if (!couponCode) {
        const recipientKey = recipientDedupeKey({ type: entry.type, id: entry.id });
        const issued = await this.issueUniqueCoupon(organizationId, broadcast.id, recipientKey, config.uniqueCoupon);
        if ("code" in issued) {
          couponCode = issued.code;
          state.couponCode = issued.code;
          state.couponDiscountId = issued.discountId;
          delete state.couponError;
        } else {
          // Recorded per recipient; the variable renders empty
          // and NO shared/fake code is substituted.
          state.couponError = issued.error;
        }
        stateChanged = true;
      }
      vars = { ...vars, [UNIQUE_COUPON_VARIABLE]: couponCode ?? "" };
    }

    // Recommendation block — computed once, then reused from
    // state (rendered bytes are stored, so retries are stable
    // even if the catalog moves in between).
    let recommendation: { text: string; html: string } | null = null;
    if (config.recommendations?.enabled) {
      if (typeof state.recommendationSignal === "string") {
        recommendation = {
          text: typeof state.recommendationText === "string" ? state.recommendationText : "",
          html: typeof state.recommendationHtml === "string" ? state.recommendationHtml : "",
        };
      } else {
        const rec = await this.recommendationForRecipient(organizationId, entry, config.recommendations);
        state.recommendationSignal = rec.signal;
        state.recommendationProductIds = rec.productIds;
        state.recommendationText = rec.text;
        state.recommendationHtml = rec.html;
        stateChanged = true;
        recommendation = { text: rec.text, html: rec.html };
      }
    }

    // Segment-conditional blocks — membership via the MS3
    // evaluator over this recipient's real facts, computed once.
    let memberBlocks: SegmentBlockConfig[] = [];
    if (config.segmentBlocks?.length) {
      let matched: number[];
      if (Array.isArray(state.segmentBlocksMatched)) {
        matched = (state.segmentBlocksMatched as unknown[]).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n < config.segmentBlocks!.length);
      } else {
        matched = [];
        for (let i = 0; i < config.segmentBlocks.length; i++) {
          const block = config.segmentBlocks[i];
          const def = await this.segmentDefinitionFor(organizationId, block).catch(() => null);
          if (!def) continue;
          const facts = await this.audienceFactsForRecipient(organizationId, entry, def).catch(() => null);
          if (facts && matchesAudienceDefinition(def, facts)) matched.push(i);
        }
        state.segmentBlocksMatched = matched;
        stateChanged = true;
      }
      memberBlocks = matched.map((i) => config.segmentBlocks![i]);
    }

    const content = applyDynamicBlocks({
      body: broadcast.body, htmlBody: broadcast.htmlBody ?? null, memberBlocks, recommendation,
    });

    // The rendered message must CARRY the recipient's code: if
    // the org did not reference {{uniqueCouponCode}} anywhere,
    // the standard coupon line (MS5 snippet format) is appended.
    if (couponCode && config.uniqueCoupon) {
      const referenced = [broadcast.body, broadcast.htmlBody, broadcast.subject]
        .some((part) => typeof part === "string" && new RegExp(`\\{\\{\\s*${UNIQUE_COUPON_VARIABLE}\\s*\\}\\}`).test(part));
      if (!referenced) {
        const label = discountLabel({ code: couponCode, kind: config.uniqueCoupon.kind, value: config.uniqueCoupon.value });
        const snippet = { code: couponCode, label: label || null };
        content.body = content.body ? `${content.body}\n\n${couponSnippetText(snippet)}` : couponSnippetText(snippet);
        if (content.htmlBody !== null) content.htmlBody = `${content.htmlBody}\n${couponSnippetHtml(snippet)}`;
      }
    }

    return { body: content.body, htmlBody: content.htmlBody, vars, state, stateChanged };
  }

  /** MX8 — persist one recipient row's personalization state
   * (BEFORE the provider call — see the schema note). A persist
   * failure must not lose the send: the StoreDiscount sourceRef
   * claim still makes a later re-issuance return the same code. */
  private async persistRecipientPersonalization(rowId: string, state: Record<string, unknown>): Promise<void> {
    const t = this.recipientTable();
    if (!t) return;
    await t.update({ where: { id: rowId }, data: { personalization: state } }).catch(() => undefined);
  }

  // ---------- MX1: recipient table (BroadcastRecipient) ----------

  /**
   * MX1 — the recipient-table delegate, or null when it does not
   * exist (pre-MX1 deployments and every pre-MX1 fake-prisma
   * fixture). That null is the dual-path switch: without the
   * table the engine keeps the MS1 snapshot behaviour
   * byte-for-byte; with it, NEW broadcasts materialize into
   * BroadcastRecipient rows and leave recipientSnapshot NULL.
   * Broadcasts that already carry a snapshot always stay on the
   * snapshot path, table or not (see processBroadcast).
   */
  private recipientTable(): any | null {
    const t = (this.prisma as any).broadcastRecipient;
    if (!t || typeof t.findMany !== "function" || typeof t.create !== "function") return null;
    return t;
  }

  /** MX1 — does this broadcast have recipient rows? Defensive:
   * any read failure reads as "no rows" (the snapshot path then
   * decides, exactly as it did pre-MX1). */
  private async hasRecipientRows(broadcastId: string): Promise<boolean> {
    const t = this.recipientTable();
    if (!t) return false;
    try {
      if (typeof t.count === "function") return (await t.count({ where: { broadcastId } })) > 0;
      const row = await t.findFirst({ where: { broadcastId }, select: { id: true } });
      return !!row;
    } catch {
      return false;
    }
  }

  /** MX1 — walk a broadcast's recipient rows in sortIndex order,
   * in pages of 500 (the chunk-read index). Used by the report
   * helpers; the engine's hot loop reads its own pending pages. */
  private async walkRecipientRows(broadcastId: string, onChunk: (rows: any[]) => Promise<void>): Promise<void> {
    const t = this.recipientTable();
    if (!t) return;
    let last = -1;
    for (;;) {
      const rows: any[] = await t.findMany({
        where: { broadcastId, sortIndex: { gt: last } },
        orderBy: { sortIndex: "asc" }, take: 500,
      }).catch(() => []);
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) break;
      await onChunk(list);
      last = list[list.length - 1].sortIndex;
      if (list.length < 500) break;
    }
  }

  /** MX1 — per-status counts DERIVED from the recipient rows.
   * The broadcast's progress counters are only ever written from
   * these counts, so they can never claim more than the rows
   * (and therefore the deliveries) actually recorded. */
  private async countRecipientsByStatus(broadcastId: string): Promise<{ total: number; sent: number; failed: number; skipped: number; pending: number }> {
    const t = this.recipientTable();
    const counts = { total: 0, sent: 0, failed: 0, skipped: 0, pending: 0 };
    if (!t) return counts;
    if (typeof t.count === "function") {
      counts.sent = await t.count({ where: { broadcastId, status: "sent" } });
      counts.failed = await t.count({ where: { broadcastId, status: "failed" } });
      counts.skipped = await t.count({ where: { broadcastId, status: "skipped" } });
      counts.pending = await t.count({ where: { broadcastId, status: "pending" } });
      counts.total = counts.sent + counts.failed + counts.skipped + counts.pending;
      return counts;
    }
    await this.walkRecipientRows(broadcastId, async (rows) => {
      for (const r of rows) {
        counts.total++;
        if (r.status === "sent") counts.sent++;
        else if (r.status === "failed") counts.failed++;
        else if (r.status === "skipped") counts.skipped++;
        else if (r.status === "pending") counts.pending++;
      }
    });
    return counts;
  }

  /** MX1 — a recipient row as the SnapshotEntry the senders
   * already speak (WhatsApp sender, sendToRecipient via the
   * process loop). providerMessageId / error / address / vars are
   * present only when the row carries them — the snapshot
   * entry's own optional-field discipline. */
  private static recipientRowToEntry(row: any): SnapshotEntry {
    return {
      type: row.recipientType, id: row.recipientId, name: row.name,
      email: row.email ?? null, phone: row.phone ?? null,
      status: row.status, attempts: row.attempts ?? 0,
      ...(row.error ? { error: row.error } : {}),
      ...(row.providerMessageId ? { providerMessageId: row.providerMessageId } : {}),
      ...(row.address ? { address: row.address } : {}),
      ...(row.vars ? { vars: row.vars } : {}),
      ...(row.personalization ? { personalization: row.personalization } : {}),
      // MX12: a push row's endpoint was stamped into `address`
      // at prepare — it is the entry's pushEndpoint.
      ...(row.pushSubscriptionId ? { pushSubscriptionId: row.pushSubscriptionId, pushEndpoint: row.address ?? null } : {}),
      // MX13: a telegram row's chat id rides in its own column
      // (and was stamped into `address` at prepare too).
      ...(row.telegramChatId ? { telegramChatId: row.telegramChatId } : {}),
    };
  }

  /** MX1 — persist ONE processed recipient row (its outcome was
   * already recorded as a MessageDelivery by the send path; this
   * row is the resume truth — once written non-pending it is
   * never selected for sending again). */
  private async persistRecipientOutcome(rowId: string, entry: SnapshotEntry): Promise<void> {
    const t = this.recipientTable();
    if (!t) return;
    await t.update({
      where: { id: rowId },
      data: {
        status: entry.status, attempts: entry.attempts,
        address: entry.address ?? null,
        providerMessageId: entry.providerMessageId ?? null,
        error: entry.error ?? null,
      },
    });
  }

  /** MX1 — delete ALL recipient rows of a broadcast (the
   * plan-cap cleanup: rows written before the cap was known are
   * removed again, so a refused prepare leaves no partial
   * recipient set behind). */
  private async deleteRecipientRows(broadcastId: string): Promise<void> {
    const t = this.recipientTable();
    if (!t) return;
    if (typeof t.deleteMany === "function") {
      await t.deleteMany({ where: { broadcastId } });
      return;
    }
    const ids: string[] = [];
    await this.walkRecipientRows(broadcastId, async (rows) => { ids.push(...rows.map((r) => r.id)); });
    for (const id of ids) await t.delete({ where: { id } });
  }

  /** MX1 — mark every pending recipient row skipped with a
   * reason (cancel semantics), in pages. Attempts are untouched:
   * a skipped-by-cancel recipient was never attempted. */
  private async markPendingRecipientsSkipped(broadcastId: string, reason: string): Promise<void> {
    const t = this.recipientTable();
    if (!t) return;
    if (typeof t.updateMany === "function") {
      await t.updateMany({ where: { broadcastId, status: "pending" }, data: { status: "skipped", error: reason } });
      return;
    }
    for (;;) {
      const rows: any[] = await t.findMany({ where: { broadcastId, status: "pending" }, orderBy: { sortIndex: "asc" }, take: 500 });
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) break;
      for (const r of list) await t.update({ where: { id: r.id }, data: { status: "skipped", error: reason } });
      if (list.length < 500) break;
    }
  }

  /** MX1 — reset ONLY the failed recipient rows back to pending
   * (retry-failed). Attempts and the last error stay on the row
   * until the next attempt's outcome overwrites them — the
   * snapshot retry's discipline, on rows. */
  private async resetFailedRecipients(broadcastId: string): Promise<void> {
    const t = this.recipientTable();
    if (!t) return;
    if (typeof t.updateMany === "function") {
      await t.updateMany({ where: { broadcastId, status: "failed" }, data: { status: "pending" } });
      return;
    }
    for (;;) {
      const rows: any[] = await t.findMany({ where: { broadcastId, status: "failed" }, orderBy: { sortIndex: "asc" }, take: 500 });
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) break;
      for (const r of list) await t.update({ where: { id: r.id }, data: { status: "pending" } });
      if (list.length < 500) break;
    }
  }

  // ---------- MS1: async send engine ----------

  /**
   * MX1 — prepare, recipient-table form. Same guards, same
   * messages, same ONE shared resolver as the snapshot form —
   * but the resolved set STREAMS through
   * resolveBroadcastRecipientsInChunks and is written to
   * BroadcastRecipient in chunks (createMany per chunk,
   * BROADCAST_RECIPIENT_WRITE_CHUNK or the caller's smaller
   * size): no recipient array is accumulated and no Json
   * snapshot is stamped (recipientSnapshot stays NULL on new
   * broadcasts — the documented MX1 choice).
   * Order of the policy checks, adapted to streaming honestly:
   * the kill-switch and the plan cap are read BEFORE any row is
   * written; recipients stream in and dedupe by dedupeKey (the
   * unique constraint is the backstop — an overlapping audience
   * source can never produce a second row); the A/B hash split
   * applies per recipient exactly as in the snapshot form. The
   * cap is a POLICY limit on the total: when the streamed total
   * passes it, the remaining recipients are only COUNTED (so
   * the refusal names the true audience size), the rows written
   * so far are deleted again, and the refusal is the snapshot
   * form's exact message. An empty audience likewise refuses
   * with the exact message, before the broadcast moves.
   */
  private async prepareBroadcastTable(organizationId: string, broadcast: any, opts?: { recipientChunkSize?: number }) {
    const broadcastId: string = broadcast.id;
    const t = this.recipientTable()!;
    const { killSwitches, effectiveLimits } = await import("../common/platform-settings");
    const ks = await killSwitches(this.prisma as any);
    if (ks.broadcastsPaused) {
      throw badRequest("messaging.broadcastsAreTemporarilyPausedPlatformWide");
    }
    const baselineCap = Number(process.env.BROADCAST_MAX_RECIPIENTS ?? 1000);
    const { broadcastCap: max } = await effectiveLimits(this.prisma as any, organizationId, { aiDaily: 200, broadcastCap: baselineCap });

    const writeChunkSize = Math.max(1, opts?.recipientChunkSize ?? BROADCAST_RECIPIENT_WRITE_CHUNK);
    const seen = new Set<string>();
    let nextSort = 0;
    let total = 0;
    let overCap = false;
    // MX11: held-out recipients are counted (for the stamp +
    // report) but never written as rows — resume reads the
    // frozen rows, so the holdout can never be re-rolled.
    let heldOutTotal = 0;

    const resolution = await this.resolveBroadcastRecipientsInChunks(organizationId, {
      channel: broadcast.channel, audienceType: broadcast.audienceType,
      audienceStage: broadcast.audienceStage ?? undefined, audienceSegment: broadcast.audienceSegment ?? undefined,
      excludePreviousRecipients: !!broadcast.excludePreviousRecipients,
      excludePastDays: broadcast.excludePastDays ?? undefined,
      excludeOptOut: broadcast.excludeOptOut ?? true,
      audienceDefinition: broadcast.audienceDefinition ?? undefined,
      audienceSavedId: broadcast.audienceSavedId ?? undefined,
      audienceCsv: broadcast.audienceCsv ?? undefined,
      topic: broadcast.topic ?? undefined,
    }, writeChunkSize, async (chunk) => {
      let kept = chunk;
      // MX11: holdout FIRST (a bucket of the same hash), then
      // the A/B split runs over the survivors — disjoint by
      // construction, no double exclusion.
      if (broadcast.holdoutPercent) {
        const split = this.splitHoldout(kept, broadcast.holdoutPercent);
        kept = split.kept;
        heldOutTotal += split.heldOutCount;
      }
      if (broadcast.abGroupId && broadcast.abVariant) {
        // Deterministic split, per recipient — the same hash as
        // the snapshot form, so variants stay disjoint and cover
        // the audience.
        const want = broadcast.abVariant === "A" ? 0 : 1;
        kept = kept.filter((r) => {
          const key = `${r.type}:${r.id}`;
          let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
          return h % 2 === want;
        });
      }
      if (!kept.length) return;
      if (overCap) {
        // Counting only, for the honest refusal total.
        for (const r of kept) {
          const key = recipientDedupeKey(r);
          if (!seen.has(key)) { seen.add(key); total++; }
        }
        return;
      }
      // MS5 vars per chunk (buildSnapshotVars pages its own
      // lookups), built only for the recipients in this chunk.
      const varsList = await this.buildSnapshotVars(organizationId, kept);
      const data: any[] = [];
      kept.forEach((r, i) => {
        const key = recipientDedupeKey(r);
        if (seen.has(key)) return;
        seen.add(key);
        data.push({
          organizationId, broadcastId,
          recipientType: r.type, recipientId: r.id ?? "", dedupeKey: key,
          name: r.name, email: r.email ?? null, phone: r.phone ?? null,
          // MX12: push rows carry their subscription id, and
          // the endpoint is stamped into `address` at prepare
          // (for push the endpoint IS the channel address — the
          // preference-store identity used by every resolver
          // stage). Non-push rows keep address null here,
          // exactly as before (stamped at send time).
          pushSubscriptionId: r.pushSubscriptionId ?? null,
          // MX13: telegram rows carry their chat id, stamped
          // into `address` at prepare for the same reason (for
          // telegram the chat id IS the channel address).
          // Non-telegram rows keep address from pushEndpoint,
          // exactly as before.
          telegramChatId: r.telegramChatId ?? null,
          // MX14: for onsite the customer id IS the channel
          // address (the preference-store identity), stamped
          // into `address` at prepare like push/telegram.
          address: broadcast.channel === "onsite" ? (r.id ?? null) : (r.telegramChatId ?? r.pushEndpoint ?? null),
          vars: varsList[i], status: "pending", attempts: 0, sortIndex: nextSort++,
        });
      });
      if (data.length) {
        if (typeof t.createMany === "function") await t.createMany({ data, skipDuplicates: true });
        else for (const d of data) await t.create({ data: d });
        total += data.length;
      }
      if (total > max) overCap = true;
    });

    if (total === 0) {
      const excluded = resolution.excludedPreviousCount + resolution.excludedSuppressedCount + resolution.excludedFrequencyCount + resolution.excludedNoOptInCount;
      throw badRequest(
        resolution.audienceTotal > 0 && excluded > 0
          ? heldOutTotal > 0 ? "messaging.audienceEmptyAfterExclusionsHeldout" : "messaging.audienceEmptyAfterExclusions"
          : heldOutTotal > 0 ? "messaging.audienceEmptyAfterHoldout" : "messaging.audienceEmptyNoUsableAddress",
        { audienceTotal: resolution.audienceTotal, excluded, prev: resolution.excludedPreviousCount, suppressed: resolution.excludedSuppressedCount, freq: resolution.excludedFrequencyCount, noOptIn: resolution.excludedNoOptInCount, heldOut: heldOutTotal, percent: broadcast.holdoutPercent },
      );
    }
    if (total > max) {
      await this.deleteRecipientRows(broadcastId);
      throw badRequest("messaging.audienceHasTotalRecipientsOverThe", { total: total, max: max });
    }
    const updated = await (this.prisma as any).broadcast.update({
      where: { id: broadcastId },
      data: {
        status: "sending", recipientSnapshot: null, totalRecipients: total, sentCount: 0, failedCount: 0, skippedCount: 0,
        ...(broadcast.holdoutPercent ? { holdoutCount: heldOutTotal } : {}),
      },
    });
    return updated;
  }

  /**
   * MS1 — prepare: everything the pre-MS1 sendBroadcast checked at
   * send time, now separated so scheduling, the sweep and retries
   * share it. Resolves through the ONE shared resolver (CX10 + MS2
   * stages), applies the deterministic A/B hash split, stamps the
   * recipient snapshot (all pending) and moves the broadcast to
   * "sending". A broadcast that already has a snapshot is never
   * re-prepared (its recipient set is frozen).
   */
  async prepareBroadcast(organizationId: string, broadcastId: string, opts?: { fromSweep?: boolean; recipientChunkSize?: number }) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    // MS10: archived broadcasts never prepare — for the sweep
    // this surfaces as a per-broadcast error in its result,
    // never a silent skip or a send.
    if ((broadcast as any).archivedAt) {
      throw badRequest("messaging.thisBroadcastIsArchivedUnarchiveIt");
    }
    // MX15: the approval gate also lives here — prepare is the
    // choke point the sweep, manual sends and retries all share,
    // so a pending/rejected broadcast can never be prepared (and
    // therefore never sent) by any path.
    await this.assertApprovalAllowsSend(organizationId, broadcast);
    if (broadcast.status === "cancelled") {
      throw badRequest("messaging.thisBroadcastWasCancelledAndCan");
    }
    if (broadcast.status === "sent") {
      throw badRequest("messaging.thisBroadcastWasAlreadySentOr");
    }
    if (broadcast.recipientSnapshot) {
      throw badRequest("messaging.thisBroadcastWasAlreadySentOr");
    }
    if (broadcast.status === "sending" || broadcast.status === "paused") {
      throw badRequest("messaging.thisBroadcastWasAlreadySentOr");
    }
    // MS1 schedule rule (locked): a manual send of a broadcast
    // whose schedule is still in the future is REFUSED — cancel
    // the schedule first (schedule endpoint with null), so a
    // scheduled send can never be fired early by accident. The
    // sweep prepares due broadcasts with fromSweep, and a due
    // (past) schedule no longer blocks a manual send either.
    if (!opts?.fromSweep && broadcast.status === "scheduled" && broadcast.scheduledAt && new Date(broadcast.scheduledAt).getTime() > Date.now()) {
      throw badRequest("messaging.thisBroadcastIsScheduledForToISOString", { toISOString: new Date(broadcast.scheduledAt).toISOString() });
    }
    // MX1 dual path: with the recipient table present, a
    // broadcast that already has recipient rows was already
    // prepared (its set is frozen, like a snapshot); otherwise a
    // NEW broadcast prepares into the table. Without the table
    // (pre-MX1) everything below is the original snapshot form.
    if (this.recipientTable()) {
      if (await this.hasRecipientRows(broadcastId)) {
        throw badRequest("messaging.thisBroadcastWasAlreadySentOr");
      }
      return this.prepareBroadcastTable(organizationId, broadcast, opts);
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
      topic: (broadcast as any).topic ?? undefined,
    });
    let recipients = resolved.recipients;
    // MX11: holdout FIRST (same hash bucket discipline as the
    // recipient-table path), then the A/B split over survivors.
    let heldOutCount = 0;
    if ((broadcast as any).holdoutPercent) {
      const split = this.splitHoldout(recipients, (broadcast as any).holdoutPercent);
      recipients = split.kept;
      heldOutCount = split.heldOutCount;
    }
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
      throw badRequest("messaging.broadcastsAreTemporarilyPausedPlatformWide");
    }
    const baselineCap = Number(process.env.BROADCAST_MAX_RECIPIENTS ?? 1000);
    const { broadcastCap: max } = await effectiveLimits(this.prisma as any, organizationId, { aiDaily: 200, broadcastCap: baselineCap });
    if (recipients.length === 0) {
      const excluded = resolved.excludedPreviousCount + resolved.excludedSuppressedCount + resolved.excludedFrequencyCount + resolved.excludedNoOptInCount;
      throw badRequest(
        resolved.audienceTotal > 0 && excluded > 0
          ? heldOutCount > 0 ? "messaging.audienceEmptyAfterExclusionsHeldout" : "messaging.audienceEmptyAfterExclusions"
          : heldOutCount > 0 ? "messaging.audienceEmptyAfterHoldout" : "messaging.audienceEmptyNoUsableAddress",
        { audienceTotal: resolved.audienceTotal, excluded, prev: resolved.excludedPreviousCount, suppressed: resolved.excludedSuppressedCount, freq: resolved.excludedFrequencyCount, noOptIn: resolved.excludedNoOptInCount, heldOut: heldOutCount, percent: (broadcast as any).holdoutPercent },
      );
    }
    if (recipients.length > max) {
      throw badRequest("messaging.audienceHasRecipientsLengthRecipientsOverThe", { recipientsLength: recipients.length, max: max });
    }
    // MS5: real personalization vars per recipient, built AFTER
    // resolution + the A/B split (only the recipients who will
    // actually be sent to get vars).
    let varsList = await this.buildSnapshotVars(organizationId, recipients);
    // SA-B20 (G2): the personalisation pass — ONLY when the
    // broadcast carries an enabled config (persisted on the row
    // at create/edit, so this later prepare — manual, scheduled
    // or sweep — applies exactly what staff previewed). It runs
    // on the FINAL recipient set: everyone the resolver
    // suppressed is already gone, so no personalisation (and no
    // LLM call) is ever spent on them. A refusal here (Tier 2
    // cap / no real LLM / daily cap / missing {{aiHook}})
    // refuses the prepare — the row stays untouched, nothing
    // sends half-personalised.
    let personalTiers: PersonalTier[] | null = null;
    const pConfig = normalizePersonalizationConfig((broadcast as any).personalization, broadcast.channel);
    if (pConfig?.enabled) {
      const outcome = await this.personalization().personaliseRecipients({
        organizationId, channel: broadcast.channel,
        body: broadcast.body, subject: broadcast.subject ?? null,
        recipients, baseVarsList: varsList, config: pConfig,
        actorId: broadcast.createdById ?? "system",
      });
      varsList = outcome.varsList;
      personalTiers = outcome.tiers;
      await this.audit.log({
        organizationId, userId: broadcast.createdById ?? "system",
        action: "broadcast.personalised", entityType: "Broadcast", entityId: broadcastId,
        metadata: {
          tier1Memory: outcome.counts.memory, tier2Ai: outcome.counts.ai, base: outcome.counts.base,
          tier2Eligible: outcome.counts.tier2Eligible, tier2Fallbacks: outcome.counts.tier2Fallbacks,
          tier2FallbackReasons: outcome.tier2FallbackReasons, llmCalls: outcome.llmCallsMade,
        },
      }).catch(() => undefined);
    }
    const snapshot: SnapshotEntry[] = recipients.map((r, i) => ({
      // The resolver never yields a null id (entity rows have
      // ids; a csv recipient's id is its normalized address).
      type: r.type, id: r.id ?? "", name: r.name,
      email: r.email ?? null, phone: r.phone ?? null,
      status: "pending", attempts: 0,
      vars: varsList[i],
      // MX12: push identity rides in the snapshot Json, so the
      // legacy engine sends push identically to the table one.
      ...(r.pushSubscriptionId ? { pushSubscriptionId: r.pushSubscriptionId, pushEndpoint: r.pushEndpoint ?? undefined } : {}),
      // MX13: telegram identity (the chat id) rides in the
      // snapshot Json the same way, so the legacy engine sends
      // telegram identically to the table one.
      ...(r.telegramChatId ? { telegramChatId: r.telegramChatId } : {}),
      ...(personalTiers ? { personalTier: personalTiers[i] } : {}),
    }));
    const updated = await (this.prisma as any).broadcast.update({
      where: { id: broadcastId },
      data: {
        status: "sending", recipientSnapshot: snapshot, totalRecipients: snapshot.length, sentCount: 0, failedCount: 0,
        ...((broadcast as any).holdoutPercent ? { holdoutCount: heldOutCount } : {}),
      },
    });
    return updated;
  }

  /** MX2 — build the per-run cascade state: which cascade
   * channels are usable at all (content check, recorded once
   * with the honest reason), and the org-entered rates for
   * cheapest-first (SMS rate is per PART, so it is scaled by
   * the cascade SMS body's segment count — the only honest
   * per-message figure available). */
  private async buildCascadeRun(organizationId: string, broadcast: any, config: CascadeConfig): Promise<{
    breaker: SmsCircuitBreaker;
    skippedChannels: { channel: string; reason: string }[];
    ratesMissing: Set<CascadeChannel>;
    rates: Partial<Record<CascadeChannel, number | null>>;
    engagementCache: Map<string, ReturnType<typeof engagementStats>>;
    waSenders: Map<string, { send: ((entry: SnapshotEntry) => Promise<{ status: "sent" | "failed" | "skipped"; providerMessageId?: string; error?: string; address: string }>) | null; buildError: string | null }>;
  }> {
    const skippedChannels: { channel: string; reason: string }[] = [];
    for (const ch of config.channels) {
      if (ch === "email") {
        const ok = broadcast.channel === "email"
          ? Boolean(broadcast.subject && broadcast.body)
          : Boolean(config.emailSubject && config.emailBody);
        if (!ok) skippedChannels.push({ channel: "email", reason: "No email content configured for the cascade (the broadcast has no email subject/body for this channel) — email attempts skipped" });
      } else if (ch === "sms") {
        const ok = broadcast.channel === "sms" ? Boolean(broadcast.body) : Boolean(config.smsBody);
        if (!ok) skippedChannels.push({ channel: "sms", reason: "No SMS content configured for the cascade (smsBody missing) — SMS attempts skipped" });
      } else if (ch === "whatsapp") {
        const tplId = broadcast.channel === "whatsapp" ? broadcast.whatsappTemplateId : config.whatsappTemplateId;
        if (!tplId) skippedChannels.push({ channel: "whatsapp", reason: "No WhatsApp template configured for the cascade (whatsappTemplateId missing) — WhatsApp attempts require an approved template, so the channel is skipped" });
      }
    }
    const senderRow = await this.getSenderConfigRow(organizationId);
    const smsText = broadcast.channel === "sms" ? String(broadcast.body ?? "") : (config.smsBody ?? "");
    const smsParts = smsText ? smsSegments(smsText).parts : 1;
    const rates: Partial<Record<CascadeChannel, number | null>> = {
      email: senderRow?.emailCostPerMessageMinor ?? null,
      sms: senderRow?.smsCostPerPartMinor == null ? null : Number(senderRow.smsCostPerPartMinor) * smsParts,
      whatsapp: senderRow?.whatsappCostPerMessageMinor ?? null,
    };
    return {
      breaker: new SmsCircuitBreaker(),
      skippedChannels,
      ratesMissing: new Set<CascadeChannel>(),
      rates,
      engagementCache: new Map(),
      waSenders: new Map(),
    };
  }

  /** MX2 — one recipient's historical engagement, gathered
   * from their REAL MessageDelivery rows + MessageLinkClick
   * rows (this org only), reduced by the pure engagementStats.
   * csv/test recipients have no entity id behind their
   * deliveries (recipientId is null there), so they honestly
   * have no gatherable history — org order applies. Cached
   * per run. */
  private async cascadeEngagement(organizationId: string, run: { engagementCache: Map<string, ReturnType<typeof engagementStats>> }, recipient: { type: string; id: string | null }): Promise<ReturnType<typeof engagementStats>> {
    if (!recipient.id || recipient.type === "csv" || recipient.type === "test") return [];
    const key = `${recipient.type}:${recipient.id}`;
    const cached = run.engagementCache.get(key);
    if (cached) return cached;
    const deliveries: any[] = await (this.prisma as any).messageDelivery.findMany({
      where: { organizationId, recipientType: recipient.type, recipientId: recipient.id, status: "sent" },
      take: 200,
    }).catch(() => []);
    const clicks: any[] = await (this.prisma as any).messageLinkClick.findMany({
      where: { organizationId, recipientKey: key }, take: 200,
    }).catch(() => []);
    const stats = engagementStats(
      Array.isArray(deliveries) ? deliveries : [],
      new Set((Array.isArray(clicks) ? clicks : []).map((c: any) => String(c.broadcastId))),
    );
    run.engagementCache.set(key, stats);
    return stats;
  }

  /** MX2 — ONE cascade attempt on ONE channel for ONE
   * recipient. Every attempt records its own MessageDelivery
   * row (via the channel's existing send path, or directly for
   * the missing-address skip), linked by recipientRowId +
   * attemptIndex + cascadeGroupId (= the recipient row id). */
  private async sendCascadeAttempt(organizationId: string, broadcast: any, config: CascadeConfig, run: any,
    channel: CascadeChannel, entry: SnapshotEntry, recipientRowId: string, attemptIndex: number,
  ): Promise<{ status: "sent" | "failed" | "skipped"; providerMessageId?: string; error?: string; address: string }> {
    const broadcastId: string = broadcast.id;
    const recipient: Recipient = { type: entry.type, id: entry.id, name: entry.name, email: entry.email, phone: entry.phone };
    const link = { recipientRowId, attemptIndex, cascadeGroupId: recipientRowId };
    const hasAddress = channel === "email" ? Boolean(entry.email) : Boolean(entry.phone);
    if (!hasAddress) {
      const error = channel === "email"
        ? "Recipient has no email address — email attempt skipped"
        : "Recipient has no phone number — " + channel + " attempt skipped";
      await this.recordDelivery(organizationId, { channel, recipient, broadcastId, ...link }, "", "skipped", undefined, error);
      return { status: "skipped", error, address: "" };
    }
    if (channel === "whatsapp") {
      const tplId = broadcast.channel === "whatsapp" ? broadcast.whatsappTemplateId : config.whatsappTemplateId;
      let slot = run.waSenders.get(String(tplId));
      if (!slot) {
        slot = { send: null, buildError: null };
        try {
          slot.send = await this.createWhatsAppSender(
            organizationId, { ...broadcast, channel: "whatsapp", whatsappTemplateId: tplId }, broadcastId,
            broadcast.createdById ?? null, () => link,
          );
        } catch (e) { slot.buildError = e instanceof Error ? e.message : "WhatsApp sender unavailable"; }
        run.waSenders.set(String(tplId), slot);
      }
      if (slot.buildError) return this.failWhatsAppEntry(organizationId, entry, broadcastId, slot.buildError, link);
      return slot.send!(entry);
    }
    const isPrimary = broadcast.channel === channel;
    const subject = channel === "email" ? (isPrimary ? broadcast.subject : config.emailSubject) : undefined;
    const body = channel === "email"
      ? (isPrimary ? broadcast.body : config.emailBody ?? "")
      : (isPrimary ? broadcast.body : config.smsBody ?? "");
    return this.sendToRecipient(organizationId, {
      channel, recipient, subject, body,
      htmlBody: channel === "email" && isPrimary ? (broadcast.htmlBody ?? null) : null,
      vars: entry.vars ?? {}, broadcastId, ...link,
      smsBreaker: run.breaker,
    });
  }

  /** MX2 — run the cascade for ONE recipient: decide the
   * attempt order (org / cheapest / smart-routing), then try
   * channels until one confirms sent. A per-channel opt-out
   * "skipped" (checked inside the channel send path, as
   * always) does NOT stop the cascade — the next channel may
   * legitimately reach this recipient; the resolve-time
   * suppression stages already removed fully-suppressed
   * recipients at prepare, so they never reach this runner.
   * Final status: sent if ANY channel confirmed; failed if at
   * least one real attempt failed and none succeeded; skipped
   * when every attempt was a skip. */
  private async runCascadeForRecipient(organizationId: string, broadcast: any, config: CascadeConfig, run: any,
    entry: SnapshotEntry, recipientRowId: string,
  ): Promise<{ status: "sent" | "failed" | "skipped"; providerMessageId?: string; error?: string; address: string; attemptsMade: number }> {
    const engagement = config.smartRouting
      ? await this.cascadeEngagement(organizationId, run, { type: entry.type, id: entry.id })
      : undefined;
    const { order, ratesMissing } = resolveAttemptOrder({ config, ratesMinorPerMessage: run.rates, engagement });
    for (const ch of ratesMissing) run.ratesMissing.add(ch);
    const skipped = new Set(run.skippedChannels.map((x: any) => x.channel));
    let attemptsMade = 0;
    let last: { status: "sent" | "failed" | "skipped"; providerMessageId?: string; error?: string; address: string } | null = null;
    let anyFailed = false;
    for (const channel of order) {
      if (skipped.has(channel)) continue;
      const result = await this.sendCascadeAttempt(organizationId, broadcast, config, run, channel, entry, recipientRowId, attemptsMade);
      attemptsMade++;
      last = result;
      if (result.status === "sent") return { ...result, attemptsMade };
      if (result.status === "failed") anyFailed = true;
    }
    return {
      status: anyFailed ? "failed" : "skipped",
      error: last?.error, address: last?.address ?? "", attemptsMade,
    };
  }

  /**
   * MX1 — process, recipient-table form. Pending rows are read
   * in sortIndex order in chunks of BROADCAST_CHUNK_SIZE (or the
   * caller's chunkSize); each outcome is persisted to its row
   * immediately, and the broadcast's counters are re-derived
   * from the rows after every chunk. Between chunks the
   * broadcast row is re-read: "paused" stops leaving the rest
   * pending; "cancelled" marks the rest skipped ("cancelled").
   * Resume IS this same loop: it selects only pending rows, so
   * a recipient whose row already records sent/failed/skipped
   * (and whose delivery is recorded) is never sent again.
   * Final-status rule is the MS1 rule, computed from row counts.
   */
  private async processBroadcastTable(organizationId: string, broadcastId: string, initial: any, opts?: { maxEntries?: number; chunkSize?: number }): Promise<{
    status: string; processed: number; sent: number; failed: number; skipped: number; pending: number; finalized: boolean; stopped?: "paused" | "cancelled";
  }> {
    const t = this.recipientTable()!;
    const chunkSize = Math.max(1, opts?.chunkSize ?? BROADCAST_CHUNK_SIZE);
    const maxEntries = opts?.maxEntries ?? Number.POSITIVE_INFINITY;
    const delayMs = Number(process.env.BROADCAST_CHUNK_DELAY_MS ?? 0);
    let broadcast = initial;
    let processed = 0;
    let stopped: "paused" | "cancelled" | undefined;
    // WhatsApp sender built ONCE for the run, as in the snapshot
    // form; a build failure becomes an honest per-row failure.
    let waSend: ((entry: SnapshotEntry) => Promise<{ status: "sent" | "failed" | "skipped"; providerMessageId?: string; error?: string; address: string }>) | null = null;
    let waBuildError: string | null = null;
    if (broadcast.channel === "whatsapp") {
      try { waSend = await this.createWhatsAppSender(organizationId, broadcast, broadcastId, broadcast.createdById ?? null); }
      catch (e) { waBuildError = e instanceof Error ? e.message : "WhatsApp sender unavailable"; }
    }
    // MX16: A/B auto-winner content state for THIS run.
    // `abContent` is the row whose content the sends below use:
    // this broadcast itself until a winner is decided; after a
    // decision, the WINNING variant's row — so the losing
    // variant's PENDING recipients receive the winning content
    // (their delivery rows still record this broadcastId; the
    // decision + its inputs are recorded on both rows).
    // waBuiltForId tracks which row the WhatsApp sender above
    // was built from, so a mid-flight winner switch rebuilds it.
    let abContent: any = broadcast;
    let waBuiltForId: string = broadcast.id;
    // MX2: cascade state for THIS run (null = single-channel
    // broadcast — the loop below is then byte-identical to
    // MX1). The cascade runner builds its own per-template
    // WhatsApp senders, so a cascade broadcast never uses the
    // waSend above.
    const cascade = readCascadeConfig((broadcast as any).cascadeConfig, String(broadcast.channel));
    const cascadeRun = cascade ? await this.buildCascadeRun(organizationId, broadcast, cascade) : null;
    // MX8: per-recipient personalization config for THIS run
    // (null = pre-MX8 broadcast — the loop is then byte-identical
    // to MX1/MX2). Applied on the plain email/sms path only: a
    // cascade run owns its per-channel content, and WhatsApp
    // sends Meta templates — neither is rewritten here.
    const personalization = cascade ? null : readPersonalizationConfig((broadcast as any).personalizationConfig);
    const persistCounters = async () => {
      const c = await this.countRecipientsByStatus(broadcastId);
      await (this.prisma as any).broadcast.update({
        where: { id: broadcastId },
        data: { totalRecipients: c.total, sentCount: c.sent, failedCount: c.failed, skippedCount: c.skipped },
      });
      return c;
    };

    while (processed < maxEntries) {
      // Re-read between chunks: external pause/cancel lands here.
      const fresh = await this.getBroadcastOrThrow(organizationId, broadcastId);
      if (fresh.status === "paused") { stopped = "paused"; break; }
      if (fresh.status === "cancelled") {
        stopped = "cancelled";
        await this.markPendingRecipientsSkipped(broadcastId, "cancelled");
        await persistCounters();
        break;
      }
      broadcast = fresh;
      // MX16: A/B auto-winner — evaluated HERE, at the chunk
      // boundary the MB6 audit named, and ONLY on this
      // recipient-table path (the legacy snapshot path in
      // processBroadcast never decides — stated in the report
      // and the acceptance doc). It re-reads the pair's current
      // state every chunk, so a human disabling it mid-flight
      // (the toggle endpoint writes both rows) takes effect at
      // this next chunk. An evaluation failure must never break
      // a send: it is caught and the chunk proceeds undecided.
      abContent = broadcast;
      if (broadcast.abGroupId) {
        try {
          const st = await this.evaluateAbAutoWinner(organizationId, broadcastId);
          if (st.decided && st.winnerBroadcast && broadcast.abVariant !== st.winner) {
            abContent = st.winnerBroadcast;
          }
        } catch { /* an undecided chunk sends this variant's own content */ }
        // A winner switch on WhatsApp means a different Meta
        // template: rebuild the sender from the winning row
        // (a build failure becomes the honest per-row failure,
        // exactly like the initial build).
        if (broadcast.channel === "whatsapp" && abContent.id !== waBuiltForId) {
          waBuiltForId = abContent.id;
          waSend = null; waBuildError = null;
          try { waSend = await this.createWhatsAppSender(organizationId, abContent, broadcastId, abContent.createdById ?? null); }
          catch (e) { waBuildError = e instanceof Error ? e.message : "WhatsApp sender unavailable"; }
        }
      }
      const take = Math.min(chunkSize, maxEntries - processed);
      if (take <= 0) break;
      const rows: any[] = await t.findMany({
        where: { broadcastId, status: "pending" }, orderBy: { sortIndex: "asc" }, take,
      });
      const chunk = Array.isArray(rows) ? rows : [];
      if (!chunk.length) break;
      for (const row of chunk) {
        const entry = MessagingService.recipientRowToEntry(row);
        const baseAttempts = entry.attempts ?? 0;
        entry.attempts = baseAttempts + 1;
        let result: { status: "sent" | "failed" | "skipped"; providerMessageId?: string; error?: string; address: string };
        if (cascade && cascadeRun) {
          const r = await this.runCascadeForRecipient(organizationId, broadcast, cascade, cascadeRun, entry, row.id);
          result = r;
          // The row's attempts count CHANNEL attempts on the
          // cascade path (each is a real provider attempt with
          // its own delivery row).
          entry.attempts = baseAttempts + Math.max(1, r.attemptsMade);
        } else if (broadcast.channel === "whatsapp") {
          result = waBuildError
            ? await this.failWhatsAppEntry(organizationId, entry, broadcastId, waBuildError)
            : await waSend!(entry);
        } else {
          // MX8: personalize for THIS recipient (issuing their
          // unique coupon on first attempt). The state is
          // persisted BEFORE the provider call, so a crash or a
          // later resume reuses it verbatim — never a second
          // coupon, never different dynamic content.
          // MX16: the content comes from abContent — the winning
          // variant's row once a winner is decided, else this
          // broadcast itself (byte-identical to pre-MX16).
          let sendBody = abContent.body;
          let sendHtml = abContent.htmlBody ?? null;
          let sendVars = entry.vars ?? {};
          if (personalization) {
            const pz = await this.personalizeForRecipient(organizationId, broadcast, personalization, entry, entry.personalization ?? null);
            sendBody = pz.body; sendHtml = pz.htmlBody; sendVars = pz.vars;
            if (pz.stateChanged) await this.persistRecipientPersonalization(row.id, pz.state);
          }
          result = await this.sendToRecipient(organizationId, {
              channel: broadcast.channel,
              recipient: { type: entry.type, id: entry.id, name: entry.name, email: entry.email, phone: entry.phone, pushSubscriptionId: entry.pushSubscriptionId ?? null, pushEndpoint: entry.pushEndpoint ?? null, telegramChatId: entry.telegramChatId ?? null },
              subject: abContent.subject, body: sendBody,
              vars: sendVars,
              htmlBody: sendHtml,
              broadcastId,
              pushUrl: (broadcast as any).pushUrl ?? null,
              telegramButtons: (broadcast as any).telegramButtons ?? null,
              onsiteUrl: (broadcast as any).onsiteUrl ?? null,
            });
        }
        entry.status = result.status;
        entry.address = result.address;
        if (result.providerMessageId) entry.providerMessageId = result.providerMessageId;
        if (result.error) entry.error = result.error; else delete entry.error;
        await this.persistRecipientOutcome(row.id, entry);
        processed++;
      }
      const c = await persistCounters();
      if (c.pending > 0 && delayMs > 0 && processed < maxEntries) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    const c = await this.countRecipientsByStatus(broadcastId);
    let finalized = false;
    let status = String(broadcast.status ?? "sending");
    if (!stopped && c.pending === 0) {
      status = c.sent > 0 && (c.failed > 0 || c.skipped > 0) ? "partial" : c.sent > 0 ? "sent" : "failed";
      await (this.prisma as any).broadcast.update({
        where: { id: broadcastId },
        data: { status, totalRecipients: c.total, sentCount: c.sent, failedCount: c.failed, skippedCount: c.skipped, sentAt: new Date() },
      });
      finalized = true;
      // MS8 recurrence chaining: the same finalize hook as the
      // snapshot form (best-effort, never fails the send).
      await this.chainRecurrence(organizationId, broadcastId).catch(() => undefined);
    } else if (stopped === "paused") {
      status = "paused";
    } else if (stopped === "cancelled") {
      status = "cancelled";
    }
    // MX2: persist the run's cascade facts that delivery rows
    // cannot express (breaker events, broadcast-level skipped
    // channels, missing rates) for the report. Only when the
    // run actually produced any — a clean cascade run leaves
    // cascadeReport null and the report derives everything
    // from the delivery chains.
    if (cascadeRun && (cascadeRun.breaker.events.length || cascadeRun.skippedChannels.length || cascadeRun.ratesMissing.size)) {
      await (this.prisma as any).broadcast.update({
        where: { id: broadcastId },
        data: {
          cascadeReport: {
            breakerEvents: cascadeRun.breaker.events,
            skippedChannels: cascadeRun.skippedChannels,
            ratesMissing: [...cascadeRun.ratesMissing],
          },
        },
      }).catch(() => undefined);
    }
    return { status, processed, sent: c.sent, failed: c.failed, skipped: c.skipped, pending: c.pending, finalized, ...(stopped ? { stopped } : {}) };
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
    status: string; processed: number; sent: number; failed: number; skipped: number; pending: number; finalized: boolean; stopped?: "paused" | "cancelled"; deferred?: "quiet_hours";
  }> {
    const chunkSize = Math.max(1, opts?.chunkSize ?? BROADCAST_CHUNK_SIZE);
    const maxEntries = opts?.maxEntries ?? Number.POSITIVE_INFINITY;
    const delayMs = Number(process.env.BROADCAST_CHUNK_DELAY_MS ?? 0);
    let broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    // MX1 dual path: recipient rows present and NO snapshot ⇒
    // the table engine. A snapshot (pre-MX1 broadcast) always
    // wins and keeps the legacy loop below byte-for-byte.
    const snapshotEntries: SnapshotEntry[] = Array.isArray(broadcast.recipientSnapshot) ? broadcast.recipientSnapshot : [];
    const hasRows = !snapshotEntries.length && (await this.hasRecipientRows(broadcastId));
    if (!snapshotEntries.length && !hasRows && broadcast.status === "sending") {
      // A "sending" row with neither a snapshot nor recipient
      // rows: its recipient set was never recorded (a pre-MS1
      // row stuck mid-send), so there is nothing honest to
      // resume — the historical refusal.
      throw badRequest("messaging.thisBroadcastWasAlreadySentOr");
    }
    // MX15 — budget gate: on a FRESH send (nothing sent, failed
    // or skipped yet) the estimated cost — org-entered rate ×
    // planned recipients — is checked against the per-broadcast
    // cap (broadcast override, else the org default) and the
    // monthly spend cap BEFORE any provider call. A blocked
    // broadcast throws here: manual sends surface the figures
    // as a 400, the sweep records it as that broadcast's error.
    // A partially-sent broadcast (resume / retry / stale
    // recovery) is NEVER re-gated — part of its spend already
    // happened and stopping mid-send would strand it. When the
    // cost cannot be estimated (no org rate), the decision is
    // allow-with-warning (see governance.ts decideBudget).
    {
      const progress = MessagingService.broadcastProgress(broadcast);
      if (progress.total > 0 && progress.sent === 0 && progress.failed === 0 && progress.skipped === 0) {
        await this.assertBudgetAllowsSend(organizationId, broadcast, progress.total);
      }
    }
    // MX3 — quiet-hours gate: while the org's marketing quiet
    // window is active, chunk processing DEFERS. No provider is
    // called, nothing is written, and the broadcast keeps its
    // current status with every recipient still pending — the
    // next sweep (or a later manual send) after the window ends
    // picks it up exactly where it is. The deferral is RETURNED
    // (deferred: "quiet_hours"), never a silent swallow. This
    // gate lives ONLY here, in the broadcast engine: the shared
    // providers and every transactional path (OrderNotification,
    // Shop OTP) are untouched by it.
    const stream = await this.getStreamSetting(organizationId);
    if (stream.quietHoursActive) {
      const c = hasRows
        ? await this.countRecipientsByStatus(broadcastId)
        : {
            sent: snapshotEntries.filter((e) => e.status === "sent").length,
            failed: snapshotEntries.filter((e) => e.status === "failed").length,
            skipped: snapshotEntries.filter((e) => e.status === "skipped").length,
            pending: snapshotEntries.filter((e) => e.status === "pending").length,
          };
      return {
        status: String(broadcast.status ?? "sending"), processed: 0,
        sent: c.sent, failed: c.failed, skipped: c.skipped, pending: c.pending,
        finalized: false, deferred: "quiet_hours",
      };
    }
    if (hasRows) {
      return this.processBroadcastTable(organizationId, broadcastId, broadcast, opts);
    }
    let snapshot: SnapshotEntry[] = snapshotEntries;
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
        // MX8: same personalization as the recipient-table
        // engine, for legacy snapshot broadcasts carrying an
        // MX8 config (a config can only be set at create, and
        // new broadcasts use the table — so this serves rows
        // whose snapshot was stamped by a deployment where the
        // recipient table was absent). The state rides inside
        // the entry and is persisted with the snapshot after
        // the chunk; the StoreDiscount sourceRef claim covers
        // the crash window before that persist. WhatsApp is
        // not personalized (Meta templates), exactly as on
        // the table path.
        let snapBody = broadcast.body;
        let snapHtml = broadcast.htmlBody ?? null;
        let snapVars = entry.vars ?? {};
        const snapPersonalization = broadcast.channel === "whatsapp"
          ? null
          : readPersonalizationConfig((broadcast as any).personalizationConfig);
        if (snapPersonalization) {
          const pz = await this.personalizeForRecipient(organizationId, broadcast, snapPersonalization, entry, entry.personalization ?? null);
          snapBody = pz.body; snapHtml = pz.htmlBody; snapVars = pz.vars;
          if (pz.stateChanged) entry.personalization = pz.state;
        }
        const result = broadcast.channel === "whatsapp"
          ? waBuildError
            ? await this.failWhatsAppEntry(organizationId, entry, broadcastId, waBuildError)
            : await waSend!(entry)
          : await this.sendToRecipient(organizationId, {
              channel: broadcast.channel,
              recipient: { type: entry.type, id: entry.id, name: entry.name, email: entry.email, phone: entry.phone, pushSubscriptionId: entry.pushSubscriptionId ?? null, pushEndpoint: entry.pushEndpoint ?? null, telegramChatId: entry.telegramChatId ?? null },
              subject: broadcast.subject, body: snapBody,
              // MS5: the snapshot entry's real vars (pre-MS5
              // entries have none — read defensively as {}).
              vars: snapVars,
              htmlBody: snapHtml,
              broadcastId,
              pushUrl: (broadcast as any).pushUrl ?? null,
              telegramButtons: (broadcast as any).telegramButtons ?? null,
              onsiteUrl: (broadcast as any).onsiteUrl ?? null,
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
    // MX15: a chained instance is a NEW broadcast by the
    // original creator — under an approval-enabled org, a
    // non-approver creator's next instance enters review like
    // any create, instead of inheriting the previous instance's
    // approval by being born "scheduled".
    const govChain = await this.getGovernanceSetting(organizationId);
    const chainNeedsApproval = govChain.approvalEnabled
      && !(await this.isBroadcastApprover(organizationId, broadcast.createdById));
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
        pushUrl: (broadcast as any).pushUrl ?? null,
        telegramButtons: (broadcast as any).telegramButtons ?? null,
        onsiteUrl: (broadcast as any).onsiteUrl ?? null,
        audienceType: broadcast.audienceType, audienceStage: broadcast.audienceStage ?? null,
        audienceSegment: broadcast.audienceSegment ?? null,
        audienceDefinition: broadcast.audienceDefinition ?? undefined,
        audienceSavedId: broadcast.audienceSavedId ?? null,
        audienceCsv: broadcast.audienceCsv ?? undefined,
        abVariant: broadcast.abVariant ?? null, abGroupId: broadcast.abGroupId ?? null,
        excludePreviousRecipients: broadcast.excludePreviousRecipients ?? false,
        // MX15: the per-broadcast budget cap carries into the
        // next recurrence instance — each instance is a fresh
        // send and the cap the org set must govern it too.
        // Approval state is NOT carried: the next instance is
        // created by the chain under the original creator, and
        // if approval is on it must be decided like any send
        // (prepareBroadcast's gate stops an unapproved chain
        // instance — see the MX15 doc).
        ...((broadcast as any).budgetCapMinor != null ? { budgetCapMinor: (broadcast as any).budgetCapMinor } : {}),
        // MX16: the auto-winner override is pair configuration
        // and carries like the budget cap; a recorded winner
        // decision is NEVER carried (each instance decides its
        // own, or not at all).
        ...((broadcast as any).abAutoWinnerEnabled != null ? { abAutoWinnerEnabled: (broadcast as any).abAutoWinnerEnabled } : {}),
        ...(chainNeedsApproval ? { approvalStatus: "pending" } : {}),
        cascadeConfig: (broadcast as any).cascadeConfig ?? undefined,
        personalizationConfig: (broadcast as any).personalizationConfig ?? undefined,
        // SA-B20 (G2): a recurring chain keeps its personalisation
        // config — dropping it would silently un-personalise
        // every later instance.
        personalization: (broadcast as any).personalization ?? undefined,
        status: chainNeedsApproval ? "pending_approval" : "scheduled", scheduledAt: next,
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
      throw badRequest("messaging.thisBroadcastIsArchivedUnarchiveIt");
    }
    // MX15: approval gate (prepareBroadcast re-checks it too).
    await this.assertApprovalAllowsSend(organizationId, broadcast);
    if (!broadcast.recipientSnapshot && !(await this.hasRecipientRows(broadcastId))) {
      broadcast = await this.prepareBroadcast(organizationId, broadcastId);
    } else if (broadcast.status === "sent" || broadcast.status === "cancelled") {
      throw badRequest(broadcast.status === "cancelled" ? "messaging.thisBroadcastWasCancelledAndCan" : "messaging.thisBroadcastWasAlreadySentOr");
    }
    const result = await this.processBroadcast(organizationId, broadcastId);
    const updated = await this.getBroadcastOrThrow(organizationId, broadcastId);
    await this.audit.log({
      organizationId, userId: actorId, action: "broadcast.send", entityType: "Broadcast", entityId: broadcastId,
      metadata: { channel: updated.channel, total: result.sent + result.failed + result.skipped, sent: result.sent, failed: result.failed, skipped: result.skipped, status: result.status, ...(result.deferred ? { deferred: result.deferred } : {}) },
    });
    const { recipientSnapshot: _snapshot, ...rest } = updated as any;
    // MX3: a manual send inside quiet hours DEFERS like any
    // other chunk processing (processBroadcast is the one gate)
    // — the response says so honestly instead of implying a
    // send happened: the broadcast stays "sending" with its
    // recipients pending for the next sweep after the window.
    return { ...rest, progress: MessagingService.broadcastProgress(updated), ...(result.deferred ? { deferred: result.deferred } : {}) };
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
      throw badRequest("messaging.thisBroadcastIsArchivedUnarchiveIt2");
    }
    // MX15: a pending/rejected broadcast cannot be scheduled to
    // send either — scheduling IS queueing for the sweep.
    await this.assertApprovalAllowsSend(organizationId, broadcast);
    if (scheduledAt === null) {
      if (broadcast.status !== "scheduled") throw badRequest("messaging.onlyAScheduledBroadcastHasA");
      const updated = await (this.prisma as any).broadcast.update({ where: { id: broadcastId }, data: { status: "draft", scheduledAt: null } });
      await this.audit.log({ organizationId, userId: actorId, action: "broadcast.schedule_cancel", entityType: "Broadcast", entityId: broadcastId, metadata: {} });
      return updated;
    }
    if (broadcast.status !== "draft" && broadcast.status !== "scheduled") {
      throw badRequest("messaging.onlyADraftBroadcastCanBe2", { broadcastStatus: broadcast.status });
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
          if (e instanceof HttpException) throw e; throw new BadRequestException(e instanceof RecurrenceValidationError ? e.message : "Invalid recurrence");
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
      throw badRequest("messaging.onlyASendingOrScheduledBroadcast", { broadcastStatus: broadcast.status });
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
    if (broadcast.status !== "paused") throw badRequest("messaging.onlyAPausedBroadcastCanBe", { broadcastStatus: broadcast.status });
    await this.audit.log({ organizationId, userId: actorId, action: "broadcast.resume", entityType: "Broadcast", entityId: broadcastId, metadata: {} });
    if (!broadcast.recipientSnapshot && !(await this.hasRecipientRows(broadcastId))) {
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
      throw badRequest("messaging.aBroadcastStatusBroadcastCannotBeCancelled", { broadcastStatus: broadcast.status });
    }
    // MX1: a recipient-table broadcast cancels on its rows —
    // pending rows become skipped ("cancelled") and the counters
    // are re-derived from the rows.
    if (await this.hasRecipientRows(broadcastId)) {
      await this.markPendingRecipientsSkipped(broadcastId, "cancelled");
      const c = await this.countRecipientsByStatus(broadcastId);
      const updatedTable = await (this.prisma as any).broadcast.update({
        where: { id: broadcastId },
        data: { status: "cancelled", totalRecipients: c.total, sentCount: c.sent, failedCount: c.failed, skippedCount: c.skipped },
      });
      await this.audit.log({ organizationId, userId: actorId, action: "broadcast.cancel", entityType: "Broadcast", entityId: broadcastId, metadata: { from: broadcast.status } });
      return updatedTable;
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
      throw badRequest("messaging.onlyAFinishedBroadcastSentPartial", { broadcastStatus: broadcast.status });
    }
    // MX1: a recipient-table broadcast retries on its rows —
    // only failed rows reset to pending; sent rows are never
    // touched, so a retry can never double-send.
    if (await this.hasRecipientRows(broadcastId)) {
      const c = await this.countRecipientsByStatus(broadcastId);
      if (!c.failed) throw badRequest("messaging.thisBroadcastHasNoFailedRecipients");
      await this.resetFailedRecipients(broadcastId);
      await (this.prisma as any).broadcast.update({ where: { id: broadcastId }, data: { status: "sending" } });
      await this.audit.log({ organizationId, userId: actorId, action: "broadcast.retry_failed", entityType: "Broadcast", entityId: broadcastId, metadata: { retrying: c.failed } });
      const resultTable = await this.processBroadcast(organizationId, broadcastId);
      const updatedTable = await this.getBroadcastOrThrow(organizationId, broadcastId);
      const { recipientSnapshot: _snapshotTable, ...restTable } = updatedTable as any;
      return { ...restTable, progress: MessagingService.broadcastProgress(updatedTable), retried: resultTable };
    }
    const snapshot: SnapshotEntry[] = Array.isArray(broadcast.recipientSnapshot) ? broadcast.recipientSnapshot : [];
    const failedCount = snapshot.filter((e) => e.status === "failed").length;
    if (!failedCount) throw badRequest("messaging.thisBroadcastHasNoFailedRecipients");
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
    // MX12: push click-through URL (push channel only; null clears).
    pushUrl?: string | null;
    // MX13: telegram inline URL buttons (telegram channel
    // only; null clears back to a text-only message).
    telegramButtons?: unknown;
    // MX14: onsite click-through URL (onsite channel only;
    // null clears back to no link).
    onsiteUrl?: string | null;
    // SA-B20 (G2): personalisation config; null turns it off.
    personalization?: unknown;
  }) {
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    if ((broadcast as any).archivedAt) {
      throw badRequest("messaging.thisBroadcastIsArchivedUnarchiveIt3");
    }
    if (!["draft", "scheduled", "paused", "pending_approval"].includes(broadcast.status)) {
      throw badRequest("messaging.aBroadcastStatusBroadcastCannotBeEdited", { broadcastStatus: broadcast.status });
    }
    const channel: string = broadcast.channel;
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) throw badRequest("messaging.broadcastNameIsRequired");
      data.name = name;
    }
    if (dto.scheduledAt !== undefined) {
      if (broadcast.status === "paused") {
        throw badRequest("messaging.aPausedBroadcastSScheduleCannot");
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
        // MX15: a pending-approval broadcast keeps its review
        // status — editing its planned time must never become a
        // back door into "scheduled" (approval decides the next
        // status, and it restores "scheduled" itself when the
        // approved time is still in the future).
        if (broadcast.status !== "pending_approval") data.status = "scheduled";
      }
    }
    if (channel === "whatsapp") {
      if (dto.templateId !== undefined || dto.subject !== undefined || dto.htmlBody !== undefined) {
        throw badRequest("messaging.whatsAppBroadcastsHaveNoSubjectHtmlBody");
      }
      if (dto.whatsappTemplateId !== undefined && dto.whatsappTemplateId !== broadcast.whatsappTemplateId) {
        const tpl = await (this.prisma as any).whatsAppTemplate.findFirst({ where: { id: dto.whatsappTemplateId, organizationId } });
        if (!tpl) throw notFound("messaging.whatsAppTemplateNotFoundInThis");
        await this.assertWhatsAppTemplateNotQualityBlocked(organizationId, tpl);
        data.whatsappTemplateId = tpl.id;
        // Create derives the stored body from the template —
        // an edit that swaps the template does the same.
        data.body = tpl.bodyText ?? `[WhatsApp template: ${tpl.name}]`;
      }
      if (dto.templateParams !== undefined) {
        if (!Array.isArray(dto.templateParams) || dto.templateParams.some((v) => typeof v !== "string")) {
          throw badRequest("messaging.templateParamsMustBeAnArrayOf");
        }
        data.templateParams = dto.templateParams;
      }
      if (dto.templateComponents !== undefined) {
        data.templateComponents = this.validateTemplateComponents(channel, dto.templateComponents);
      }
      if (dto.body !== undefined) {
        throw badRequest("messaging.whatsAppBroadcastBodyComesFromIts");
      }
    } else {
      if (dto.whatsappTemplateId !== undefined || dto.templateComponents !== undefined) {
        throw badRequest("messaging.whatsappTemplateIdTemplateComponentsAreOnlyForWhatsA");
      }
      // MX12: pushUrl edits — push channel only, same
      // shop-relative rule as create (validatePushUrl); an
      // explicit null clears back to the shop-root default.
      if (dto.pushUrl !== undefined) {
        if (channel !== "push") throw badRequest("messaging.pushUrlIsOnlyAllowedForPush");
        try { data.pushUrl = validatePushUrl(dto.pushUrl); }
        catch (e) { if (e instanceof HttpException) throw e; throw new BadRequestException(e instanceof Error ? e.message : "Invalid pushUrl"); }
      }
      if (channel === "push" && dto.templateId !== undefined && dto.templateId !== null) {
        throw badRequest("messaging.pushBroadcastsDoNotUseMessage2");
      }
      if (channel === "telegram" && dto.templateId !== undefined && dto.templateId !== null) {
        throw badRequest("messaging.telegramBroadcastsDoNotUseMessage2");
      }
      if (channel === "onsite" && dto.templateId !== undefined && dto.templateId !== null) {
        throw badRequest("messaging.onSiteBroadcastsDoNotUse2");
      }
      // MX14: onsiteUrl edits — onsite channel only, same
      // shop-relative rule as create (validateOnsiteUrl); an
      // explicit null clears back to no link.
      if (dto.onsiteUrl !== undefined) {
        if (channel !== "onsite") throw badRequest("messaging.onsiteUrlIsOnlyAllowedForOnsite");
        try { data.onsiteUrl = validateOnsiteUrl(dto.onsiteUrl); }
        catch (e) { if (e instanceof HttpException) throw e; throw new BadRequestException(e instanceof Error ? e.message : "Invalid onsiteUrl"); }
      }
      // MX13: telegramButtons edits — telegram channel only,
      // the same validateTelegramButtons rule as create; an
      // explicit null clears back to a text-only message.
      if (dto.telegramButtons !== undefined) {
        if (channel !== "telegram") throw badRequest("messaging.telegramButtonsIsOnlyAllowedForTelegram");
        try { data.telegramButtons = validateTelegramButtons(dto.telegramButtons); }
        catch (e) { if (e instanceof HttpException) throw e; throw new BadRequestException(e instanceof Error ? e.message : "Invalid telegramButtons"); }
      }
      if (dto.templateId !== undefined) {
        if (dto.templateId === null) {
          data.templateId = null;
        } else {
          // Create's exact checks: the template must exist in
          // this org and its channel must match.
          const template = await this.getTemplate(organizationId, dto.templateId);
          if (template.channel !== channel) throw badRequest("messaging.templateChannelDoesNotMatchThe");
          data.templateId = template.id;
        }
      }
      if (dto.subject !== undefined) data.subject = dto.subject;
      if (dto.body !== undefined) data.body = dto.body;
      if (dto.htmlBody !== undefined) {
        // MS5's rule, shared with create: HTML is email-only.
        if (dto.htmlBody && channel !== "email") throw badRequest("messaging.htmlBodyIsOnlyAllowedForEmail3");
        data.htmlBody = dto.htmlBody;
      }
    }
    // Create's closing invariants, evaluated on the MERGED row:
    // a body is always required, and email always needs a
    // subject — an edit may not hollow a broadcast out.
    const mergedBody = data.body !== undefined ? data.body : broadcast.body;
    if (!mergedBody) throw badRequest("messaging.broadcastBodyIsRequiredWriteOne");
    const mergedSubject = data.subject !== undefined ? data.subject : broadcast.subject;
    if (channel === "email" && !mergedSubject) throw badRequest("messaging.emailBroadcastsNeedASubject");
    if (channel === "push") {
      // MX12: create's push invariants on the MERGED row — a
      // title is always required and the base system's length
      // caps (title ≤ 120, body ≤ 300) always hold.
      if (!mergedSubject || !String(mergedSubject).trim()) throw badRequest("messaging.pushBroadcastsNeedATitleSubject");
      if (String(mergedSubject).length > 120) throw badRequest("messaging.pushTitleMustBeAtMost");
      if (String(mergedBody).length > 300) throw badRequest("messaging.pushBodyMustBeAtMost");
    }
    if (channel === "telegram") {
      // MX13: create's telegram invariants on the MERGED row —
      // the Bot API's 4096-char cap and no subject, always.
      if (String(mergedBody).length > 4096) throw badRequest("messaging.telegramMessageTextMustBeAt");
      if (mergedSubject && String(mergedSubject).trim() !== "") throw badRequest("messaging.telegramBroadcastsHaveNoSubjectThe");
    }
    if (channel === "onsite") {
      // MX14: create's onsite invariants on the MERGED row — a
      // title is always required and the channel's own caps
      // (title ≤ 120, body ≤ 2000) always hold.
      if (!mergedSubject || !String(mergedSubject).trim()) throw badRequest("messaging.onSiteBroadcastsNeedATitle");
      if (String(mergedSubject).length > 120) throw badRequest("messaging.onSiteTitleMustBeAt");
      if (String(mergedBody).length > 2000) throw badRequest("messaging.onSiteBodyMustBeAt");
    }
    // SA-B20 (G2): personalisation edits validate against the
    // MERGED body (create's closing-invariant pattern) — a body
    // edit that removes {{aiHook}} while Tier 2 stays on is
    // refused here, not discovered at send time.
    if (dto.personalization !== undefined) {
      if (dto.personalization === null) {
        data.personalization = null;
      } else {
        const pConfig = normalizePersonalizationConfig(dto.personalization, channel);
        assertTier2HookPlaceholder(String(mergedBody ?? ""), pConfig);
        data.personalization = pConfig ?? null;
      }
    }
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
        // MX12: the push click-through URL is content — a clone
        // without it would silently change where clicks land.
        pushUrl: (broadcast as any).pushUrl ?? null,
        // MX13: the telegram inline buttons are content too —
        // a clone without them would silently lose the buttons.
        telegramButtons: (broadcast as any).telegramButtons ?? null,
        // MX14: the onsite click-through URL is content too.
        onsiteUrl: (broadcast as any).onsiteUrl ?? null,
        audienceType: broadcast.audienceType, audienceStage: broadcast.audienceStage ?? null,
        audienceSegment: broadcast.audienceSegment ?? null,
        audienceDefinition: broadcast.audienceDefinition ?? undefined,
        audienceSavedId: broadcast.audienceSavedId ?? null,
        audienceCsv: broadcast.audienceCsv ?? undefined,
        excludePreviousRecipients: broadcast.excludePreviousRecipients ?? false,
        // MX15: the per-broadcast budget cap is configuration —
        // a clone without it would silently lose the governance
        // the original carried. Approval state is NOT copied:
        // the clone is a fresh draft by its own creator.
        ...((broadcast as any).budgetCapMinor != null ? { budgetCapMinor: (broadcast as any).budgetCapMinor } : {}),
        cascadeConfig: (broadcast as any).cascadeConfig ?? undefined,
        personalizationConfig: (broadcast as any).personalizationConfig ?? undefined,
        // SA-B20 (G2): the personalisation config is content,
        // not send state — a clone keeps it.
        personalization: (broadcast as any).personalization ?? undefined,
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
      throw badRequest("messaging.aBroadcastStatusBroadcastCannotBeDeleted", { broadcastStatus: broadcast.status });
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
      throw badRequest("messaging.aBroadcastThatIsSendingCannot");
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
   *
   * MX3 — stream controls: the per-org caps bound the WHOLE run
   * for this org — at most effectiveMaxBroadcastsPerSweep
   * broadcasts are attempted across both phases (due first, then
   * stale recovery with what is left) and each broadcast gets at
   * most effectiveMaxEntriesPerSweep entries. Broadcasts beyond
   * the cap are counted in `skippedByLimit` and stay queued for
   * the next run. While the org's quiet hours are active the
   * whole run defers: nothing is prepared or processed, no
   * provider is called, and the result says so
   * (deferred: "quiet_hours" + how many broadcasts were waiting).
   * Null settings read as the platform defaults, which reproduce
   * the pre-MX3 behaviour exactly.
   */
  async runDueBroadcasts(organizationId: string): Promise<{
    started: number; recovered: number; processed: number; finalized: number;
    errors: { broadcastId: string; error: string }[];
    skippedByLimit: number;
    deferred?: "quiet_hours";
    deferredBroadcasts?: number;
  }> {
    const out = {
      started: 0, recovered: 0, processed: 0, finalized: 0,
      errors: [] as { broadcastId: string; error: string }[], skippedByLimit: 0,
    };
    const stream = await this.getStreamSetting(organizationId);
    const maxBroadcasts = stream.effectiveMaxBroadcastsPerSweep;
    const maxEntries = stream.effectiveMaxEntriesPerSweep;
    const now = new Date();
    const dueWhere = { organizationId, status: "scheduled", scheduledAt: { lte: now } };
    const staleBefore = new Date(Date.now() - BROADCAST_STALE_MS);
    const staleWhere = { organizationId, status: "sending", updatedAt: { lt: staleBefore } };
    // Defensive count: some deployments/fixtures lack the
    // delegate method entirely — a synchronous throw must read
    // as "unknown" (null), never crash the sweep.
    const safeBroadcastCount = async (where: Record<string, unknown>): Promise<number | null> => {
      try {
        const n = await (this.prisma as any).broadcast.count({ where });
        return typeof n === "number" ? n : null;
      } catch { return null; }
    };
    if (stream.quietHoursActive) {
      // Count what is waiting (honest deferral signal), touch
      // nothing: due broadcasts stay scheduled, stale rows stay
      // sending, and the next sweep after the window sends them.
      const dueCount = await safeBroadcastCount(dueWhere);
      const staleCount = await safeBroadcastCount(staleWhere);
      return { ...out, deferred: "quiet_hours", deferredBroadcasts: (dueCount ?? 0) + (staleCount ?? 0) };
    }
    const due: any[] = await (this.prisma as any).broadcast.findMany({
      where: dueWhere,
      orderBy: { scheduledAt: "asc" }, take: Math.min(MARKETING_SWEEP_PHASE_MAX, maxBroadcasts),
    }).catch(() => []);
    const dueTotal = await safeBroadcastCount(dueWhere);
    let attempted = 0;
    for (const b of due) {
      try {
        if (!b.recipientSnapshot && !(await this.hasRecipientRows(b.id))) await this.prepareBroadcast(organizationId, b.id, { fromSweep: true });
        const r = await this.processBroadcast(organizationId, b.id, { maxEntries });
        out.started++; out.processed += r.processed; if (r.finalized) out.finalized++;
        await this.audit.log({ organizationId, userId: "system", action: "broadcast.sweep_send", entityType: "Broadcast", entityId: b.id, metadata: { kind: "scheduled", processed: r.processed, status: r.status } }).catch(() => undefined);
      } catch (e) {
        out.errors.push({ broadcastId: b.id, error: e instanceof Error ? e.message : "Sweep send failed" });
      }
      attempted++;
    }
    out.skippedByLimit += Math.max(0, (dueTotal ?? due.length) - attempted);
    const staleTake = Math.min(MARKETING_SWEEP_PHASE_MAX, Math.max(0, maxBroadcasts - attempted));
    const stale: any[] = staleTake > 0 ? await (this.prisma as any).broadcast.findMany({
      where: staleWhere,
      orderBy: { updatedAt: "asc" }, take: staleTake,
    }).catch(() => []) : [];
    const staleTotal = await safeBroadcastCount(staleWhere);
    let staleAttempted = 0;
    for (const b of stale) {
      try {
        const r = await this.processBroadcast(organizationId, b.id, { maxEntries });
        out.recovered++; out.processed += r.processed; if (r.finalized) out.finalized++;
        await this.audit.log({ organizationId, userId: "system", action: "broadcast.sweep_send", entityType: "Broadcast", entityId: b.id, metadata: { kind: "recovery", processed: r.processed, status: r.status } }).catch(() => undefined);
      } catch (e) {
        out.errors.push({ broadcastId: b.id, error: e instanceof Error ? e.message : "Sweep recovery failed" });
      }
      staleAttempted++;
    }
    out.skippedByLimit += Math.max(0, (staleTotal ?? stale.length) - staleAttempted);
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
  private async createWhatsAppSender(organizationId: string, broadcast: any, broadcastId: string, denyActorId?: string | null,
    // MX2: optional per-entry cascade link (recipient row +
    // attempt index + group) stamped onto every delivery this
    // sender records. Absent = pre-MX2 rows (null links).
    linkForEntry?: (entry: SnapshotEntry) => { recipientRowId?: string; attemptIndex?: number; cascadeGroupId?: string } | undefined) {
    const integration = await (this.prisma as any).integration.findFirst({
      where: { organizationId, provider: "whatsapp", status: "CONNECTED" }, include: { credential: true },
    });
    if (!integration?.credential) throw badRequest("messaging.noConnectedWhatsAppIntegrationForThis");
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
      throw forbidden("messaging.theAuthorOfThisBroadcastHas");
    }
    const template = await (this.prisma as any).whatsAppTemplate.findFirst({ where: { id: broadcast.whatsappTemplateId, organizationId } });
    if (!template) throw notFound("messaging.whatsAppTemplateNotFound");
    // MX9: send-time quality-guard re-check — the template's
    // synced quality may have dropped after this broadcast was
    // created. The throw lands in the engine's build-error path.
    await this.assertWhatsAppTemplateNotQualityBlocked(organizationId, template);
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
        await this.recordDelivery(organizationId, { channel: "whatsapp", recipient, broadcastId, ...(linkForEntry?.(entry) ?? {}) }, address, "skipped", undefined, error);
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
        await this.recordDelivery(organizationId, { channel: "whatsapp", recipient, broadcastId, ...(linkForEntry?.(entry) ?? {}) }, address, "sent", messageId);
        return { status: "sent", providerMessageId: messageId, address };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Send failed";
        await this.recordDelivery(organizationId, { channel: "whatsapp", recipient, broadcastId, ...(linkForEntry?.(entry) ?? {}) }, address, "failed", undefined, message);
        return { status: "failed", error: message, address };
      }
    };
  }

  /** A WhatsApp entry whose sender could not be built at all
   * (no connected integration / template missing): recorded as a
   * failed delivery with the verbatim build error. */
  private async failWhatsAppEntry(organizationId: string, entry: SnapshotEntry, broadcastId: string, error: string,
    link?: { recipientRowId?: string; attemptIndex?: number; cascadeGroupId?: string }): Promise<{ status: "failed"; providerMessageId?: string; error: string; address: string }> {
    const recipient: Recipient = { type: entry.type, id: entry.id, name: entry.name, email: entry.email, phone: entry.phone };
    const address = normalizeBdPhone(entry.phone ?? "") ?? normalizePhoneGeneric(entry.phone ?? "") ?? (entry.phone ?? "");
    await this.recordDelivery(organizationId, { channel: "whatsapp", recipient, broadcastId, ...(link ?? {}) }, address, "failed", undefined, error);
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
  /**
   * MX6 — delivery → inbox bridge: each row gains
   * `conversationId: string | null`. Resolved ONLY for channel
   * "whatsapp" rows, by matching a ChannelConversation of the
   * same org + channel whose digits-only(externalContactId)
   * equals digits-only(delivery.address) (wa_id is phone digits;
   * a delivery address may carry a "+" or BD prefix form).
   * Batched: the page's rows resolve through ONE conversation
   * query. Every other channel, no conversation, or any lookup
   * failure → null. Never guessed.
   */
  private async withDeliveryConversationIds(organizationId: string, rows: any[]): Promise<any[]> {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
    const resolved = new Map<string, string>();
    try {
      const waRows = rows.filter((r) => r?.channel === "whatsapp" && digits(r.address));
      const table = (this.prisma as any).channelConversation;
      if (waRows.length && table?.findMany) {
        const convs: any[] = await table.findMany({
          where: { organizationId, channel: "whatsapp" },
          select: { id: true, externalContactId: true },
        });
        const byDigits = new Map<string, string>();
        for (const c of convs ?? []) {
          const d = digits(c.externalContactId);
          if (d && !byDigits.has(d)) byDigits.set(d, c.id);
        }
        for (const r of waRows) {
          const hit = byDigits.get(digits(r.address));
          if (hit) resolved.set(r.id, hit);
        }
      }
    } catch { /* best-effort bridge: an unresolved row is null, never a failed listing */ }
    return rows.map((r) => ({ ...r, conversationId: r?.channel === "whatsapp" ? (resolved.get(r.id) ?? null) : null }));
  }

  async listDeliveries(organizationId: string, broadcastId: string, opts?: { status?: string; q?: string; cursor?: string }) {
    if (!opts) {
      const rows = await (this.prisma as any).messageDelivery.findMany({
        where: { organizationId, broadcastId }, orderBy: { createdAt: "desc" }, take: 200,
      });
      return this.withDeliveryConversationIds(organizationId, rows);
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
    return { items: await this.withDeliveryConversationIds(organizationId, items), nextCursor };
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
        // MX15 — auto-suppression gap closure. Audit verdict:
        // NO bounce/complaint webhook exists anywhere in this
        // system and, before MX15, NO webhook path wrote a
        // preference — a WhatsApp "failed" status only stamped
        // deliveryStatus. When the failure identifies the
        // RECIPIENT as unreachable / not on WhatsApp (the hard-
        // failure patterns in governance.ts — template, quality
        // or rate failures never match), the address is now
        // suppressed in the SAME MS2 preference store every send
        // path enforces, with the source recorded honestly.
        // Best-effort: a suppression failure never breaks the
        // webhook's applied result.
        if (isHardRecipientFailure(error)) {
          try {
            await this.setPreference(organizationId, {
              channel: "whatsapp", address: delivery.address, status: "opted_out",
              source: "auto_suppression", actor: "system",
              recipientType: delivery.recipientType ?? null, recipientId: delivery.recipientId ?? null,
              note: `Auto-suppressed after a WhatsApp hard delivery failure: ${String(error).slice(0, 200)}`,
            });
          } catch { /* the lifecycle update above already landed */ }
        }
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
    if (!payload) throw badRequest("messaging.thisTrackingPixelIsInvalidOr");
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
   *  - delivered/read: WhatsApp webhooks only — plus MX14
   *    onsite, where both are REAL first-class signals of this
   *    system itself: the send creates the notification row in
   *    the customer's center and stamps the delivery delivered
   *    at creation (the create IS the delivery — the row's
   *    presence in the center is observed, not assumed), and
   *    the customer's real open action stamps readAt on the
   *    notification AND this delivery. Push (MX12) has
   *    no browser delivery/read signal at all — the push
   *    service's acceptance IS the sent stage, so both stay
   *    null. Email over SMTP
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
      delivered: channel === "whatsapp" || channel === "onsite" ? deliveredKeys.size : null,
      read: channel === "whatsapp" || channel === "onsite" ? readKeys.size : null,
      opened: channel === "email" && broadcast.htmlBody ? openedKeys.size : null,
      // MX12: push joins WhatsApp here — its click-through is
      // the service worker opening the payload URL directly;
      // no tracked-link wrap exists, so clicks are null.
      // MX14: onsite joins them — opening a notification in the
      // center follows its shop-relative URL directly in the
      // shop UI; no tracked-link wrap exists, so clicks are
      // null (the READ stage is this channel's real engagement
      // signal instead).
      clickedRecipients: channel === "whatsapp" || channel === "push" || channel === "telegram" || channel === "onsite" ? null : clickedKeys.size,
      totalClicks: channel === "whatsapp" || channel === "push" || channel === "telegram" || channel === "onsite" ? null : totalClicks,
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
    // MX1: recipient-table broadcasts carry no snapshot — their
    // customer ids come from the recipient rows instead.
    let customerIds = [...new Set(snapshot.filter((e) => e.type === "customer" && e.id).map((e) => e.id))];
    if (!snapshot.length) {
      const fromRows = new Set<string>();
      await this.walkRecipientRows(broadcast.id, async (rows) => {
        for (const r of rows) if (r.recipientType === "customer" && r.recipientId) fromRows.add(r.recipientId);
      });
      customerIds = [...fromRows];
    }
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
    // MX1: recipient-table broadcasts carry no snapshot — their
    // phones come from the recipient rows instead.
    let rawPhones = snapshot.map((e) => e.phone ?? "");
    if (!snapshot.length) {
      const fromRows: string[] = [];
      await this.walkRecipientRows(broadcast.id, async (rows) => {
        for (const r of rows) fromRows.push(r.phone ?? "");
      });
      rawPhones = fromRows;
    }
    const phones = [...new Set(rawPhones
      .map((phone) => normalizeBdPhone(phone) ?? normalizePhoneGeneric(phone) ?? phone)
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
      // MX16: the auto-winner state of this pair — the org /
      // pair opt-in resolution, the recorded decision (winner,
      // the z-test inputs and the timestamp) when one exists,
      // and the stated rule. With no decision this stays a
      // status view; the suggestion above remains a suggestion.
      const decidedRow = rows.find((v: any) => v.abWinnerVariant);
      const orgAutoWinner = await this.getAbAutoWinnerEnabled(organizationId);
      const autoWinnerEnabled = rows.some((v: any) => v.abAutoWinnerEnabled === false)
        ? false
        : rows.some((v: any) => v.abAutoWinnerEnabled === true) ? true : orgAutoWinner;
      ab = {
        groupId: broadcast.abGroupId,
        variants,
        suggestion: abSuggestion({ A: lite.A, B: lite.B }, await resolveDocumentLocale(this.prisma as any, organizationId)),
        autoWinner: {
          enabled: autoWinnerEnabled,
          winner: decidedRow ? decidedRow.abWinnerVariant : null,
          decidedAt: decidedRow?.abWinnerAt ? new Date(decidedRow.abWinnerAt).toISOString() : null,
          detail: decidedRow?.abWinnerDetail ?? null,
          rule: autoWinnerRuleTextFor(await resolveDocumentLocale(this.prisma as any, organizationId)),
          scopeNote: catalogText("messaging.abScopeNote", await resolveDocumentLocale(this.prisma as any, organizationId)),
        },
      } as any;
    }
    // MX2: the cascade section — per-channel attempt breakdown
    // + final-channel success counts + per-recipient chains,
    // all derived from the linked delivery rows, merged with
    // the stored run facts (breaker events, skipped channels,
    // missing rates). Null for a broadcast with no cascade
    // config and no linked attempts (every pre-MX2 report is
    // byte-identical).
    let cascade: Record<string, unknown> | null = null;
    {
      const cfg = readCascadeConfig((broadcast as any).cascadeConfig, String(broadcast.channel));
      const deliveries = await this.walkDeliveries(organizationId, broadcast.id);
      const hasLinked = deliveries.some((d: any) => d.attemptIndex !== null && d.attemptIndex !== undefined);
      if (cfg || hasLinked) {
        const breakdown = cascadeBreakdown(deliveries);
        const stored = ((broadcast as any).cascadeReport ?? {}) as any;
        const ratesMissing: string[] = Array.isArray(stored.ratesMissing) ? stored.ratesMissing : [];
        cascade = {
          config: cfg,
          channels: breakdown.channels,
          chains: breakdown.chains.slice(0, 200),
          breakerEvents: Array.isArray(stored.breakerEvents) ? stored.breakerEvents : [],
          skippedChannels: Array.isArray(stored.skippedChannels) ? stored.skippedChannels : [],
          ratesMissing,
          ...(ratesMissing.length
            ? { ratesNote: `Cheapest-first চাওয়া হয়েছিল, কিন্তু এই চ্যানেলগুলোর org-দেওয়া rate নেই (${ratesMissing.join(", ")}) — তাই org-এর নিজের ক্রমই ব্যবহার হয়েছে; কোনো দাম অনুমান করা হয়নি।` }
            : {}),
        };
      }
    }
    return {
      broadcast: {
        id: broadcast.id, name: broadcast.name, channel: broadcast.channel,
        // MX12: the push click-through URL (null elsewhere).
        pushUrl: (broadcast as any).pushUrl ?? null,
        // MX13: the telegram inline URL buttons (null elsewhere).
        telegramButtons: (broadcast as any).telegramButtons ?? null,
        // MX14: the onsite click-through URL (null elsewhere).
        onsiteUrl: (broadcast as any).onsiteUrl ?? null,
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
      cascade,
      // MX11: the holdout section — present only on broadcasts
      // that set a holdout (pre-MX11 reports are byte-identical).
      // heldOutCount was stamped at prepare; held-out contacts
      // received nothing, by construction.
      ...((broadcast as any).holdoutPercent
        ? {
          holdout: {
            percent: (broadcast as any).holdoutPercent,
            heldOutCount: (broadcast as any).holdoutCount ?? 0,
            label: "Holdout group (comparison) — these contacts were deliberately NOT sent this broadcast. Count stamped at prepare time; a resumed send never re-rolls it.",
          },
        }
        : {}),
    };
  }

  // ---------- MX16: comparative analytics, auto-winner, AI v2 ----------

  /** MX16 — the funnel fields the analytics/auto-winner
   * consumers read (broadcastFunnel's report shape minus the
   * failure-reason list). */
  private static funnelShape(funnel: any): BroadcastFunnelShape {
    return {
      audience: funnel.audience, sent: funnel.sent, failed: funnel.failed, skipped: funnel.skipped,
      delivered: funnel.delivered, read: funnel.read, opened: funnel.opened,
      clickedRecipients: funnel.clickedRecipients, totalClicks: funnel.totalClicks,
    };
  }

  /**
   * MX16 — cross-broadcast comparative analytics over a Dhaka
   * date range (default: the finance range convention, last 30
   * days). Every figure comes from the SAME per-broadcast
   * machinery the report uses (broadcastFunnel +
   * broadcastRevenue), aggregated by the pure analytics module:
   * a stage a channel cannot report stays null at every level.
   * Revenue is ASSOCIATION only (the labelled 7-day figure) —
   * per the MB6 Step-0 audit there is NO honest join from a
   * messaging delivery to Touchpoint/AttributionCredit, so
   * `attribution` is null here and the note says why; nothing
   * in this payload presents association as attribution.
   * A broadcast belongs to the range by sentAt ?? createdAt.
   */
  async getComparativeAnalytics(organizationId: string, rangeInput?: { from?: string; to?: string }) {
    let range;
    try { range = parseFinanceRange(rangeInput?.from, rangeInput?.to); }
    catch (e) { if (e instanceof HttpException) throw e; throw new BadRequestException(e instanceof Error ? e.message : "Invalid date range"); }
    const rows: any[] = await (this.prisma as any).broadcast.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: 500,
    }).catch(() => []);
    const inRange = (rows ?? []).filter((b: any) => {
      const d = new Date(b.sentAt ?? b.createdAt);
      return !Number.isNaN(d.getTime()) && d.getTime() >= range.fromDate.getTime() && d.getTime() <= range.toDate.getTime();
    });
    const broadcasts: any[] = [];
    for (const b of inRange) {
      const funnel = await this.broadcastFunnel(organizationId, b);
      const revenue = await this.broadcastRevenue(organizationId, b);
      broadcasts.push({
        id: b.id, name: b.name, channel: b.channel, status: b.status,
        sentAt: b.sentAt ? new Date(b.sentAt).toISOString() : null,
        createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : null,
        funnel: MessagingService.funnelShape(funnel),
        revenueAssociation: revenue
          ? { orders: revenue.orders, totalMinor: revenue.totalMinor, customerRecipients: revenue.customerRecipients, windowDays: revenue.windowDays }
          : null,
      });
    }
    const channels = aggregateFunnels(broadcasts.map((b) => ({ channel: b.channel, funnel: b.funnel })));
    const totalsList = aggregateFunnels(broadcasts.map((b) => ({ channel: "all", funnel: b.funnel })));
    const totals = totalsList[0] ?? {
      channel: "all", broadcasts: 0, audience: 0, sent: 0, failed: 0, skipped: 0,
      delivered: null, read: null, opened: null, clickedRecipients: null, totalClicks: null,
    };
    let assocOrders = 0;
    let assocTotal = BigInt(0);
    for (const b of broadcasts) {
      if (!b.revenueAssociation) continue;
      assocOrders += b.revenueAssociation.orders;
      try { assocTotal += BigInt(b.revenueAssociation.totalMinor ?? 0); } catch { /* a malformed stored figure contributes nothing */ }
    }
    return {
      range: { from: range.from, to: range.to },
      broadcasts,
      channels,
      totals,
      association: {
        orders: assocOrders, totalMinor: assocTotal.toString(),
        label: ASSOCIATION_LABEL_BN,
      },
      // Honest by construction: no AttributionCredit figure is
      // computed for messaging, because no honest join exists.
      attribution: null,
      attributionNote: "Touchpoint/AttributionCredit ওয়েব-ভিজিটরের ডেটা — Broadcast Delivery-র সঙ্গে কোনো shared key নেই, তাই Messaging-এর জন্য Attribution সংখ্যা দেখানো হয় না; উপরের অর্ডার-সংখ্যা শুধুই Association।",
      stageNote: "যে ধাপ কোনো Channel রিপোর্ট করতে পারে না, সেই ঘর null (\"—\") — কখনো বানানো ০ নয়। Email-এর opened শুধু HTML Broadcast থেকে যোগ হয়।",
    };
  }

  /** MX16 — CSV export of the comparative analytics, built by
   * the pure builder from the SAME aggregates the screen shows
   * (so the numbers match by construction). Audited like every
   * other messaging export. */
  async exportComparativeAnalyticsCsv(organizationId: string, actorId: string, rangeInput?: { from?: string; to?: string }) {
    const analytics = await this.getComparativeAnalytics(organizationId, rangeInput);
    const csvLocale = await resolveDocumentLocale(this.prisma as any, organizationId);
    const csv = buildAnalyticsCsv({
      range: analytics.range,
      broadcasts: analytics.broadcasts.map((b: any) => ({
        id: b.id, name: b.name, channel: b.channel, status: b.status, sentAt: b.sentAt,
        funnel: b.funnel, revenueAssociation: b.revenueAssociation,
      })),
      channels: analytics.channels,
    }, csvLocale);
    await this.audit.log({
      organizationId, userId: actorId, action: "messaging.analytics_export", entityType: "Broadcast", entityId: "analytics",
      metadata: { from: analytics.range.from, to: analytics.range.to, broadcasts: analytics.broadcasts.length },
    });
    return csv;
  }

  /**
   * MX16 — the A/B auto-winner evaluation for one pair, run at
   * the chunk boundary of the recipient-table send path (the
   * seam the MB6 Step-0 audit named: processBroadcastTable
   * re-reads state per chunk, so a decision taken here honestly
   * affects only PENDING recipients — sent rows are frozen
   * truth). The rule lives in messaging/analytics.ts
   * (decideAutoWinner): opt-in first (per-pair override, else
   * the org switch, default OFF), never twice, never on a
   * cascade pair, never without an honestly-reported metric,
   * never below 100 sent per variant, never on a tie or below
   * |z| >= 1.96 on the two-proportion z-test. A taken decision
   * is recorded on BOTH variant rows (winner, timestamp, and
   * the full test inputs) and in the audit log.
   *
   * Returns the state the engine needs: whether a decision
   * exists after this call, and the winning variant's row (its
   * content is what the losing variant's remaining recipients
   * receive).
   */
  async evaluateAbAutoWinner(organizationId: string, broadcastId: string): Promise<{
    decided: boolean; newlyDecided: boolean; winner: "A" | "B" | null;
    winnerBroadcast: any | null; detail: any | null; reason: string; enabled: boolean;
  }> {
    const idle = (reason: string, enabled = false) => ({
      decided: false, newlyDecided: false, winner: null as "A" | "B" | null,
      winnerBroadcast: null, detail: null, reason, enabled,
    });
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    if (!broadcast.abGroupId) return idle("not_ab_pair");
    const variants: any[] = await (this.prisma as any).broadcast.findMany({
      where: { organizationId, abGroupId: broadcast.abGroupId }, orderBy: { abVariant: "asc" },
    }).catch(() => []);
    const rowA = variants.find((v: any) => v.abVariant === "A");
    const rowB = variants.find((v: any) => v.abVariant === "B");
    if (!rowA || !rowB) return idle("pair_incomplete");
    // Never twice: a decision recorded on either row stands.
    const decidedRow = variants.find((v: any) => v.abWinnerVariant);
    if (decidedRow) {
      return {
        decided: true, newlyDecided: false,
        winner: decidedRow.abWinnerVariant as "A" | "B",
        winnerBroadcast: variants.find((v: any) => v.abVariant === decidedRow.abWinnerVariant) ?? null,
        detail: decidedRow.abWinnerDetail ?? null,
        reason: "already_decided", enabled: true,
      };
    }
    // Opt-in resolution: an explicit false on EITHER variant
    // disables the pair (the mid-flight off-switch); else an
    // explicit true on either enables it; else the org switch.
    const enabled = variants.some((v: any) => v.abAutoWinnerEnabled === false)
      ? false
      : variants.some((v: any) => v.abAutoWinnerEnabled === true)
        ? true
        : await this.getAbAutoWinnerEnabled(organizationId);
    const funnelA = MessagingService.funnelShape(await this.broadcastFunnel(organizationId, rowA));
    const funnelB = MessagingService.funnelShape(await this.broadcastFunnel(organizationId, rowB));
    const decision = decideAutoWinner({
      enabled,
      alreadyDecided: false,
      hasCascade: Boolean((rowA as any).cascadeConfig || (rowB as any).cascadeConfig),
      channel: String(broadcast.channel),
      funnelA, funnelB,
    });
    if (!decision.decided || !decision.winner || !decision.a || !decision.b || !decision.metric) {
      return { ...idle(decision.reason, enabled), detail: null };
    }
    const now = new Date();
    const rate = (s: { sent: number; success: number }) => (s.sent > 0 ? s.success / s.sent : 0);
    const detail = {
      winner: decision.winner,
      metric: decision.metric,
      test: AUTO_WINNER_TEST_NAME,
      alpha: 0.05,
      zCritical: 1.96,
      minSamplePerVariant: AUTO_WINNER_MIN_SAMPLE,
      a: { sent: decision.a.sent, success: decision.a.success, rate: rate(decision.a) },
      b: { sent: decision.b.sent, success: decision.b.success, rate: rate(decision.b) },
      z: decision.z, pValue: decision.pValue,
      decidedAt: now.toISOString(),
      rule: autoWinnerRuleTextFor(await resolveDocumentLocale(this.prisma as any, organizationId)),
    };
    for (const v of variants) {
      await (this.prisma as any).broadcast.update({
        where: { id: v.id },
        data: { abWinnerVariant: decision.winner, abWinnerAt: now, abWinnerDetail: detail },
      });
    }
    await this.audit.log({
      organizationId, userId: "system", action: "broadcast.ab_winner", entityType: "Broadcast", entityId: broadcastId,
      metadata: { abGroupId: broadcast.abGroupId, ...detail },
    }).catch(() => undefined);
    return {
      decided: true, newlyDecided: true, winner: decision.winner,
      winnerBroadcast: decision.winner === "A" ? rowA : rowB,
      detail, reason: "significant", enabled,
    };
  }

  /** MX16 — flip the per-pair auto-winner override (true /
   * false / null = back to inheriting the org switch) on BOTH
   * variant rows. This is the human mid-flight switch: it is
   * deliberately NOT the broadcast edit path (a "sending"
   * broadcast cannot be edited), and the engine re-reads it at
   * the next chunk, so disabling takes effect there. A pair
   * that already finished sending cannot be toggled. */
  async setBroadcastAbAutoWinner(organizationId: string, actorId: string, broadcastId: string, enabled: boolean | null) {
    if (enabled !== null && typeof enabled !== "boolean") {
      throw badRequest("messaging.enabledMustBeTrueFalseOr");
    }
    const broadcast = await this.getBroadcastOrThrow(organizationId, broadcastId);
    if (!broadcast.abGroupId) throw badRequest("messaging.thisBroadcastIsNotPartOf");
    if (["sent", "partial", "failed", "cancelled"].includes(String(broadcast.status))) {
      throw badRequest("messaging.thisBroadcastAlreadyFinishedBroadcastStatusThe", { broadcastStatus: broadcast.status });
    }
    const variants: any[] = await (this.prisma as any).broadcast.findMany({
      where: { organizationId, abGroupId: broadcast.abGroupId }, select: { id: true },
    }).catch(() => []);
    for (const v of variants) {
      await (this.prisma as any).broadcast.update({ where: { id: v.id }, data: { abAutoWinnerEnabled: enabled } });
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "broadcast.ab_auto_winner_toggle", entityType: "Broadcast", entityId: broadcastId,
      metadata: { abGroupId: broadcast.abGroupId, enabled },
    });
    return { abGroupId: broadcast.abGroupId, abAutoWinnerEnabled: enabled, variants: variants.map((v: any) => v.id) };
  }

  /**
   * MX16 — AI campaign planner (through the MS9 guard path
   * VERBATIM: checkMessagingAiLimit first — kill switch 403,
   * daily cap 429, both before any provider call; ONE usage
   * record per usable response on the shared messaging_copy
   * ledger). Returns a PROPOSAL ONLY: an audience rule in the
   * MS3 evaluator format, a content draft, a channel
   * recommendation and a timing suggestion. It creates NO
   * audience, NO template and NO broadcast — the composer
   * applies each piece only on an explicit human click.
   * With no real LLM configured there is no honest proposal
   * (a template cannot plan a campaign), so that is a 502 —
   * the MX11 segment-draft precedent.
   */
  async planCampaign(organizationId: string, actorId: string, dto: {
    goal: string; channel?: string; audienceHint?: string;
  }) {
    const goal = String(dto.goal ?? "").trim();
    if (!goal) throw badRequest("messaging.goalIsRequiredSayWhatThis2");
    if (goal.length > 1000) throw badRequest("messaging.goalIsTooLongMax1000");
    const channelHint = dto.channel && ["email", "sms", "whatsapp"].includes(dto.channel) ? dto.channel : null;
    await this.checkMessagingAiLimit(organizationId);
    const provider = await this.messagingAiProvider(organizationId);
    if (!provider.isRealLlm) {
      throw new ApiException("messaging.aIIsNotConfiguredForThis2", 502);
    }
    const facts: string[] = [`Campaign goal: ${goal}`];
    if (channelHint) facts.push(`Preferred channel hint: ${channelHint}`);
    if (dto.audienceHint?.trim()) facts.push(`Audience hint: ${dto.audienceHint.trim()}`);
    facts.push(...(await this.businessProfileFacts(organizationId)));
    const { fieldsForEntity } = await import("./audience-rules");
    const vocabulary = (entity: string) => Object.entries(fieldsForEntity(entity as any))
      .map(([field, spec]) => `${field} (ops: ${spec.ops.join("|")}, value: ${spec.kind})`).join("; ");
    const systemPrompt = [
      "You plan ONE marketing campaign for an ecommerce business and return a PROPOSAL for a human to review — nothing you return is sent or saved automatically.",
      "Use ONLY the facts given. Never invent prices, discounts, stock, delivery promises or results.",
      'Return ONLY JSON {"audienceDefinition":{"entity":"customers"|"leads","match":"all"|"any","conditions":[{"field":string,"op":string,"value":...,"key"?:string}]},"contentDraft":{"subject":string|null,"body":string},"channelRecommendation":"email"|"sms"|"whatsapp","timingSuggestion":string,"rationale":string}.',
      `Allowed audience fields for customers: ${vocabulary("customers")}. For leads: ${vocabulary("leads")}. At most 5 conditions.`,
      "contentDraft.body is the message text (the personalization variables {{name}} and {{firstName}} may be used); subject is for email (null otherwise). Write the content in the goal's language (Bengali goals get Bangla script).",
      "timingSuggestion is a short suggestion in the same language as the goal, stated as a suggestion — never a guarantee.",
    ].join("\n");
    let result: { text: string; model: string; inputTokens: number; outputTokens: number; tokensEstimated: boolean };
    try {
      result = await provider.complete(
        [{ role: "system", content: systemPrompt }, { role: "user", content: facts.join("\n") }],
        { jsonMode: true, maxTokens: 1200 },
      );
    } catch (e: any) {
      throw new HttpException(e?.message ?? String(e), 502);
    }
    let parsed: any = null;
    try { parsed = JSON.parse(result.text); } catch { parsed = null; }
    const draft = parsed?.contentDraft ?? {};
    const body = typeof draft?.body === "string" ? draft.body.trim() : "";
    if (!parsed || !body) {
      // Unusable answer: honest 502, NO usage record, nothing
      // stored (the draftMessagingCopy rule).
      throw new ApiException("messaging.theAIResponseCouldNotBe", 502);
    }
    await this.recordMessagingAiUsage(organizationId, actorId, provider.name, result.model, result.inputTokens, result.outputTokens, result.tokensEstimated);
    let audienceDefinition: unknown = parsed.audienceDefinition ?? null;
    let audienceValid = false;
    const audienceErrors: string[] = [];
    if (audienceDefinition) {
      try {
        audienceDefinition = validateAudienceDefinition(audienceDefinition as any);
        audienceValid = true;
      } catch (e) {
        audienceErrors.push(e instanceof Error ? e.message : "The proposed audience definition failed validation.");
      }
    } else {
      audienceErrors.push("The AI returned no audience definition.");
    }
    const channelRecommendation = ["email", "sms", "whatsapp"].includes(parsed.channelRecommendation)
      ? parsed.channelRecommendation : null;
    return {
      proposal: {
        audienceDefinition, audienceValid, audienceErrors,
        contentDraft: {
          subject: typeof draft.subject === "string" && draft.subject.trim() ? draft.subject.trim().slice(0, 200) : null,
          body: body.slice(0, 4000),
        },
        channelRecommendation,
        timingSuggestion: typeof parsed.timingSuggestion === "string" ? parsed.timingSuggestion.trim().slice(0, 500) : null,
        rationale: typeof parsed.rationale === "string" ? parsed.rationale.trim().slice(0, 1000) : null,
      },
      providerLabel: provider.name, isRealLlm: true,
      notice: "এটি শুধু একটি প্রস্তাব (proposal) — কোনো Audience, Template বা Broadcast তৈরি হয়নি। প্রতিটি অংশ আলাদাভাবে যাচাই করে Composer-এ নিজে বসান।",
    };
  }

  /**
   * MX16 — Bangla↔English translation DRAFT (through the MS9
   * guard path verbatim, like every AI feature here). The
   * translation is RETURNED ONLY: it is never written to a
   * template or broadcast — a human inserts it into the
   * composer and saves through the existing paths. The dev
   * provider cannot translate, so without a real LLM this is
   * an honest 502 (the MX6 classify precedent).
   */
  async translateDraft(organizationId: string, actorId: string, dto: {
    subject?: string; body: string; targetLanguage: string;
  }) {
    const body = String(dto.body ?? "").trim();
    if (!body) throw badRequest("messaging.bodyIsRequiredWriteTheMessage");
    if (body.length > 10000) throw badRequest("messaging.bodyIsTooLongToTranslate");
    const target = dto.targetLanguage === "en" ? "en" : dto.targetLanguage === "bn" ? "bn" : null;
    if (!target) throw badRequest("messaging.targetLanguageMustBeBnOrEn");
    const subject = dto.subject !== undefined && dto.subject !== null ? String(dto.subject) : null;
    await this.checkMessagingAiLimit(organizationId);
    const provider = await this.messagingAiProvider(organizationId);
    if (!provider.isRealLlm) {
      throw new ApiException("messaging.theRealAILLMIsNot", 502);
    }
    const systemPrompt = [
      `You translate marketing message text into ${target === "bn" ? "Bengali (Bangla script)" : "English"}.`,
      "Translate faithfully — add nothing, promise nothing new, and keep every {{variable}} token, URL and line break exactly as in the source.",
      'Return ONLY JSON {"subject": string|null, "body": string} — subject is the translation of the given subject (null when no subject was given).',
    ].join("\n");
    const userText = [subject ? `Subject: ${subject}` : "Subject: (none)", `Body:\n${body}`].join("\n");
    let result: { text: string; model: string; inputTokens: number; outputTokens: number; tokensEstimated: boolean };
    try {
      result = await provider.complete(
        [{ role: "system", content: systemPrompt }, { role: "user", content: userText }],
        { jsonMode: true, maxTokens: 2000 },
      );
    } catch (e: any) {
      throw new HttpException(e?.message ?? String(e), 502);
    }
    let parsed: any = null;
    try { parsed = JSON.parse(result.text); } catch { parsed = null; }
    const translatedBody = typeof parsed?.body === "string" ? parsed.body.trim() : "";
    if (!translatedBody) {
      throw new ApiException("messaging.theAIResponseCouldNotBe", 502);
    }
    await this.recordMessagingAiUsage(organizationId, actorId, provider.name, result.model, result.inputTokens, result.outputTokens, result.tokensEstimated);
    return {
      subject: typeof parsed.subject === "string" && parsed.subject.trim() ? parsed.subject.trim().slice(0, 200) : null,
      body: translatedBody.slice(0, 10000),
      targetLanguage: target,
      providerLabel: provider.name, isRealLlm: true,
      notice: "এটি একটি অনুবাদ-খসড়া — কোথাও সংরক্ষিত হয়নি। Composer-এ নিজে বসিয়ে তারপর বিদ্যমান পথে সংরক্ষণ করুন।",
    };
  }

  /** MX16 — subject-line quality score: a DETERMINISTIC
   * HEURISTIC (see analytics.ts), not AI and not a measured
   * open-rate prediction. No guard path is consumed because
   * no AI is involved; the payload labels itself heuristic. */
  scoreSubjectQuality(dto: { subject: string }) {
    const subject = String(dto.subject ?? "");
    if (!subject.trim()) throw badRequest("messaging.subjectIsRequired");
    return subjectQualityScore(subject);
  }

  /**
   * MX16 — per-recipient send-time suggestion: a DETERMINISTIC
   * statistic (not AI) — the modal Asia/Dhaka hour of THIS
   * recipient's own recorded engagement (MessageLinkClick rows
   * for their recipient key + their deliveries' openedAt /
   * readAt). Below RECIPIENT_SEND_TIME_MIN_EVENTS recorded
   * events the answer is "insufficient data" with the real
   * count — never a fabricated time.
   */
  async recipientSendTimeSuggestion(organizationId: string, recipientType: string, recipientId: string) {
    if (!["customer", "lead"].includes(recipientType)) throw badRequest("messaging.recipientTypeMustBeCustomerOrLead");
    const id = String(recipientId ?? "").trim();
    if (!id) throw badRequest("messaging.recipientIdIsRequired");
    const recipientKey = `${recipientType}:${id}`;
    const clicks: any[] = await (this.prisma as any).messageLinkClick.findMany({
      where: { organizationId, recipientKey }, select: { createdAt: true }, take: 5000,
    }).catch(() => []);
    const opened: any[] = await (this.prisma as any).messageDelivery.findMany({
      where: { organizationId, recipientType, recipientId: id, openedAt: { not: null } },
      select: { openedAt: true }, take: 5000,
    }).catch(() => []);
    const read: any[] = await (this.prisma as any).messageDelivery.findMany({
      where: { organizationId, recipientType, recipientId: id, readAt: { not: null } },
      select: { readAt: true }, take: 5000,
    }).catch(() => []);
    const stamps: Date[] = [
      ...(clicks ?? []).map((r: any) => new Date(r.createdAt)),
      ...(opened ?? []).map((r: any) => new Date(r.openedAt)),
      ...(read ?? []).map((r: any) => new Date(r.readAt)),
    ];
    const stat = recipientSendTimeFromEvents(stamps);
    return {
      recipientKey,
      available: stat.available,
      totalEvents: stat.totalEvents,
      minEvents: stat.minEvents,
      modalHour: stat.modalHour,
      modalHourEvents: stat.modalHourEvents,
      ...(stat.available
        ? { method: "এই প্রাপকের নিজের রেকর্ডকৃত Click/Open/Read ইভেন্টের সবচেয়ে ঘন ঘণ্টা (ঢাকা সময়) — একটি পরিসংখ্যান, AI নয়; ভবিষ্যতে এই সময়ে পাঠালেই সাড়া মিলবে এমন গ্যারান্টি নয়।" }
        : { reason: `এই প্রাপকের মাত্র ${stat.totalEvents}টি engagement ইভেন্ট রেকর্ড আছে — নির্ভরযোগ্য পরামর্শের জন্য কমপক্ষে ${stat.minEvents}টি দরকার (insufficient data)। কোনো সময় অনুমান করা হয়নি।` }),
    };
  }

  // ---------- MS5: test sends ----------

  /** The synthetic "test" recipient: type "test", id null (its
   * deliveries record recipientId null — see recordDelivery). */
  private static testRecipient(channel: string, to: string): Recipient {
    return {
      type: "test", id: null, name: "Test",
      email: channel === "email" ? to : null,
      // MX13: for telegram the typed address IS a chat id — it
      // rides in telegramChatId (and stays out of phone, so no
      // phone logic can ever mistake it for a number).
      phone: channel === "email" || channel === "telegram" ? null : to,
      ...(channel === "telegram" ? { telegramChatId: to } : {}),
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
    if (broadcast.channel === "push") {
      // MX12: a push test send cannot target a typed address —
      // push reaches BROWSER SUBSCRIPTIONS, not addresses. The
      // honest path is the base system's test devices (Web
      // Push panel: register this browser, then test-send
      // there); a fake "test" delivery here would lie.
      throw badRequest("messaging.pushBroadcastsCannotBeTestSent");
    }
    if (broadcast.channel === "onsite") {
      // MX14: an onsite test send cannot target a typed address
      // either — the channel reaches a customer's shop account
      // notification center, and writing a "test" notification
      // into a real customer's center would pollute it with a
      // message that is not a real broadcast. The honest path
      // is a real broadcast to a narrow customers audience
      // (e.g. a segment containing only the test account).
      throw badRequest("messaging.onSiteBroadcastsCannotBeTest");
    }
    const to = String(toInput ?? "").trim();
    if (!to) throw badRequest("messaging.aTestRecipientAddressIsRequired");
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
        // MX13: a telegram test send carries the broadcast's
        // buttons, so the tester sees exactly what subscribers
        // get. MX12: a push "to" never reaches this branch (the
        // refusal above), so pushUrl stays unset here.
        telegramButtons: (broadcast as any).telegramButtons ?? null,
        onsiteUrl: (broadcast as any).onsiteUrl ?? null,
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
    if (!to) throw badRequest("messaging.aTestRecipientAddressIsRequired");
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
    if (!payload) throw badRequest("messaging.thisLinkIsInvalidOrHas");
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
    if (!["email", "sms", "whatsapp", "push", "telegram", "onsite"].includes(channel)) throw badRequest("messaging.channelMustBeEmailSmsWhatsapp");
    const address = normalizePrefAddress(channel, raw ?? "");
    if (channel === "onsite") {
      // MX14: an onsite preference address is a CUSTOMER ID —
      // the notification-center account identity. Customer ids
      // are uuids in this schema; the rule is a non-empty id
      // of at most 100 chars with no whitespace (an id with a
      // space in it can never match a real customer row).
      if (!address || address.length > 100 || /\s/.test(address)) throw badRequest("messaging.invalidOnsiteCustomerIdRaw", { raw: raw });
      return address;
    }
    if (channel === "telegram") {
      // MX13: a telegram preference address is a chat id —
      // Telegram's own shape: an integer (user chats positive,
      // group chats negative), at most 20 digits.
      if (!/^-?\d{1,20}$/.test(address)) throw badRequest("messaging.invalidTelegramChatIdRaw", { raw: raw });
      return address;
    }
    if (channel === "push") {
      // MX12: a manually-entered push preference address is a
      // subscription endpoint — the base system's own rule
      // (an https URL, ≤ 1000 chars) applies verbatim.
      let ok = address.length > 0 && address.length <= 1000;
      if (ok) { try { ok = new URL(address).protocol === "https:"; } catch { ok = false; } }
      if (!ok) throw badRequest("messaging.invalidPushSubscriptionEndpointRaw", { raw: raw });
      return address;
    }
    if (channel === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw badRequest("messaging.invalidEmailAddressRaw", { raw: raw });
    } else if (address.replace(/\D/g, "").length < 10) {
      throw badRequest("messaging.invalidPhoneNumberRaw", { raw: raw });
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
    if (!["opted_out", "opted_in"].includes(status)) throw badRequest("messaging.statusMustBeOptedOutOr");
    const address = this.validatePrefAddress(dto.channel, dto.address);
    const row = await this.setPreference(organizationId, {
      channel: dto.channel, address, status: status as "opted_out" | "opted_in", source: "manual", note: dto.note ?? null, actor: `user:${actorId}`,
    });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.preference_add", entityType: "MessagePreference", entityId: row.id, metadata: { channel: dto.channel, address, status } });
    return row;
  }

  async removePreference(organizationId: string, actorId: string, preferenceId: string) {
    const row = await (this.prisma as any).messagePreference.findFirst({ where: { id: preferenceId, organizationId } });
    if (!row) throw notFound("messaging.preferenceNotFound");
    await (this.prisma as any).messagePreference.delete({ where: { id: preferenceId } });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.preference_remove", entityType: "MessagePreference", entityId: preferenceId, metadata: { channel: row.channel, address: row.address, status: row.status } });
    return { deleted: true };
  }

  /** Bulk opt-out import: per-row results, never all-or-nothing
   * and never silent — bad rows come back with their error. */
  async importPreferences(organizationId: string, actorId: string, dto: { channel: string; addresses: string[] }) {
    if (!["email", "sms", "whatsapp", "push", "telegram", "onsite"].includes(dto.channel)) throw badRequest("messaging.channelMustBeEmailSmsWhatsapp");
    if (!Array.isArray(dto.addresses) || dto.addresses.length === 0) throw badRequest("messaging.addressesMustBeANonEmpty");
    if (dto.addresses.length > 1000) throw badRequest("messaging.importIsCappedAt1000Addresses");
    let imported = 0;
    const errors: { address: string; error: string }[] = [];
    for (const raw of dto.addresses) {
      try {
        const address = this.validatePrefAddress(dto.channel, String(raw ?? ""));
        await this.setPreference(organizationId, { channel: dto.channel, address, status: "opted_out", source: "import", actor: `user:${actorId}` });
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
    if (!payload) throw badRequest("messaging.thisUnsubscribeLinkIsInvalidOr");
    return {
      valid: true, channel: payload.channel,
      address: payload.channel === "email" ? maskEmailAddress(payload.address) : maskPhoneAddress(payload.address),
    };
  }

  /** POST side: the actual opt-out write (source unsubscribe_link). */
  async performUnsubscribe(token: string) {
    const payload = verifyUnsubscribeToken(token);
    if (!payload) throw badRequest("messaging.thisUnsubscribeLinkIsInvalidOr");
    await this.setPreference(payload.orgId, {
      channel: payload.channel, address: payload.address, status: "opted_out", source: "unsubscribe_link", actor: "public",
    });
    return { ok: true, message: "আপনাকে আনসাবস্ক্রাইব করা হয়েছে। এই ঠিকানায় আর কোনো Broadcast ইমেইল যাবে না।" };
  }

  // ---------- MX10: growth tools & preference center v2 ----------
  // Opt-out is supreme everywhere below: no growth path ever
  // flips an opted_out row, and a pending (unconfirmed) signup
  // receives no marketing sends — the resolver excludes pending
  // addresses and sendToRecipient skips them.

  private optInFormTable(): any | null {
    const t = (this.prisma as any).messagingOptInForm;
    return t && typeof t.findMany === "function" ? t : null;
  }

  private slugifyOptIn(value: string): string {
    return String(value ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }

  private validateOptInChannels(raw: unknown): string[] {
    const channels = Array.isArray(raw) ? raw.map(String) : [];
    const out = channels.filter((c) => ["email", "sms", "whatsapp"].includes(c));
    if (!out.length || out.length !== channels.length) throw badRequest("messaging.channelsMustBeANonEmpty");
    return [...new Set(out)];
  }

  /** Shared keyword-claim check for opt-in forms: the keyword may
   * not be a reserved STOP/START keyword, may not be claimed by
   * another enabled opt-in form, and may not collide with an
   * MX6 keyword-campaign rule (inbound dispatch order is
   * STOP/START → opt-in keyword → campaign rules). */
  private async assertOptInKeywordFree(organizationId: string, keyword: string, excludeFormId?: string) {
    if (isReservedKeyword(normalizeKeywordText(keyword))) throw badRequest("messaging.keywordIsAReservedKeywordSTOP", { keyword: keyword });
    const forms: any[] = await (this.optInFormTable()?.findMany({ where: { organizationId, enabled: true } }) ?? Promise.resolve([])).catch(() => []);
    if (forms.some((f) => f.id !== excludeFormId && f.keyword && normalizeKeywordText(f.keyword) === normalizeKeywordText(keyword))) {
      throw badRequest("messaging.keywordKeywordIsAlreadyUsedBy", { keyword: keyword });
    }
    const ruleTable = this.keywordRuleTable();
    if (ruleTable) {
      const rules: any[] = await ruleTable.findMany({ where: { organizationId, enabled: true } }).catch(() => []);
      const claimed = rules.some((r) => (r.keyword && normalizeKeywordText(r.keyword) === normalizeKeywordText(keyword))
        || (Array.isArray(r.pollOptions) && r.pollOptions.some((o: any) => Array.isArray(o?.keywords) && o.keywords.some((k: string) => normalizeKeywordText(k) === normalizeKeywordText(keyword)))));
      if (claimed) throw badRequest("messaging.keywordKeywordIsAlreadyClaimedBy", { keyword: keyword });
    }
  }

  async listOptInForms(organizationId: string) {
    const t = this.optInFormTable();
    if (!t) return [];
    const forms: any[] = await t.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } }).catch(() => []);
    return forms.map((f) => ({ ...f, joinUrl: this.optInJoinUrl(organizationId, f.slug) }));
  }

  optInJoinUrl(organizationId: string, slug: string): string {
    return `${webBaseUrl()}/join/${organizationId}/${slug}`;
  }

  async createOptInForm(organizationId: string, actorId: string, dto: {
    name: string; slug?: string; headline?: string; description?: string; channels: unknown;
    topic?: string; doubleOptIn?: boolean; successMessage?: string; popup?: unknown; keyword?: string;
  }) {
    const t = this.optInFormTable();
    if (!t) throw badRequest("messaging.optInFormsAreNotAvailable");
    const name = String(dto.name ?? "").trim();
    if (!name) throw badRequest("messaging.nameIsRequired");
    const channels = this.validateOptInChannels(dto.channels);
    const slug = this.slugifyOptIn(dto.slug || name);
    if (!slug) throw badRequest("messaging.slugMustContainLettersOrDigits");
    const existing = await t.findFirst({ where: { organizationId, slug } }).catch(() => null);
    if (existing) throw badRequest("messaging.anOptInFormWithSlug", { slug: slug });
    const doubleOptIn = dto.doubleOptIn !== false;
    const keyword = dto.keyword ? normalizeKeywordText(dto.keyword) : null;
    if (keyword) await this.assertOptInKeywordFree(organizationId, keyword);
    if (doubleOptIn && !channels.includes("email") && !keyword) {
      throw badRequest("messaging.doubleOptInNeedsAConfirmation");
    }
    const row = await t.create({
      data: {
        organizationId, name, slug,
        headline: dto.headline ?? null, description: dto.description ?? null,
        channels, topic: dto.topic ? String(dto.topic).trim() : null,
        doubleOptIn, successMessage: dto.successMessage ?? null,
        popup: dto.popup ?? null, keyword, enabled: true, createdById: actorId,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.optin_form_create", entityType: "MessagingOptInForm", entityId: row.id, metadata: { slug, channels } });
    return { ...row, joinUrl: this.optInJoinUrl(organizationId, slug) };
  }

  async updateOptInForm(organizationId: string, actorId: string, formId: string, dto: {
    name?: string; headline?: string; description?: string; channels?: unknown; topic?: string;
    doubleOptIn?: boolean; successMessage?: string; popup?: unknown; keyword?: string | null; enabled?: boolean;
  }) {
    const t = this.optInFormTable();
    if (!t) throw badRequest("messaging.optInFormsAreNotAvailable");
    const row = await t.findFirst({ where: { id: formId, organizationId } });
    if (!row) throw notFound("messaging.optInFormNotFound");
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = String(dto.name).trim();
    if (dto.headline !== undefined) data.headline = dto.headline;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.channels !== undefined) data.channels = this.validateOptInChannels(dto.channels);
    if (dto.topic !== undefined) data.topic = dto.topic ? String(dto.topic).trim() : null;
    if (dto.doubleOptIn !== undefined) data.doubleOptIn = !!dto.doubleOptIn;
    if (dto.successMessage !== undefined) data.successMessage = dto.successMessage;
    if (dto.popup !== undefined) data.popup = dto.popup;
    if (dto.enabled !== undefined) data.enabled = !!dto.enabled;
    if (dto.keyword !== undefined) {
      const keyword = dto.keyword ? normalizeKeywordText(dto.keyword) : null;
      if (keyword) await this.assertOptInKeywordFree(organizationId, keyword, formId);
      data.keyword = keyword;
    }
    const channels = (data.channels as string[] | undefined) ?? (Array.isArray(row.channels) ? row.channels : []);
    const doubleOptIn = (data.doubleOptIn as boolean | undefined) ?? row.doubleOptIn;
    const keyword = (data.keyword as string | null | undefined) ?? row.keyword;
    if (doubleOptIn && !channels.includes("email") && !keyword) {
      throw badRequest("messaging.doubleOptInNeedsAConfirmation");
    }
    const updated = await t.update({ where: { id: formId }, data });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.optin_form_update", entityType: "MessagingOptInForm", entityId: formId, metadata: {} });
    return { ...updated, joinUrl: this.optInJoinUrl(organizationId, updated.slug) };
  }

  async deleteOptInForm(organizationId: string, actorId: string, formId: string) {
    const t = this.optInFormTable();
    if (!t) throw badRequest("messaging.optInFormsAreNotAvailable");
    const row = await t.findFirst({ where: { id: formId, organizationId } });
    if (!row) throw notFound("messaging.optInFormNotFound");
    await t.delete({ where: { id: formId } });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.optin_form_delete", entityType: "MessagingOptInForm", entityId: formId, metadata: { slug: row.slug } });
    return { deleted: true };
  }

  /** QR code (PNG data URL) of the form's real public join URL,
   * generated server-side with the repo's qrcode dependency — no
   * external shortening or tracking service. */
  async getOptInFormQr(organizationId: string, formId: string): Promise<{ url: string; dataUrl: string }> {
    const t = this.optInFormTable();
    if (!t) throw badRequest("messaging.optInFormsAreNotAvailable");
    const row = await t.findFirst({ where: { id: formId, organizationId } });
    if (!row) throw notFound("messaging.optInFormNotFound");
    const url = this.optInJoinUrl(organizationId, row.slug);
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 });
    return { url, dataUrl };
  }

  /** The public form view: config only — never any subscriber data. */
  async getPublicOptInForm(organizationId: string, slug: string) {
    const t = this.optInFormTable();
    if (!t) throw notFound("messaging.formNotFound");
    const form = await t.findFirst({ where: { organizationId, slug, enabled: true } }).catch(() => null);
    if (!form) throw notFound("messaging.formNotFound");
    const org = await (this.prisma as any).organization?.findUnique({ where: { id: organizationId }, select: { name: true } }).catch(() => null);
    return {
      name: form.name, slug: form.slug, headline: form.headline, description: form.description,
      channels: form.channels, topic: form.topic, doubleOptIn: form.doubleOptIn,
      popup: form.popup ?? null, organizationName: org?.name ?? null,
    };
  }

  /** Find the contact behind an email/phone pair: an existing
   * customer first, then a lead (the MS3 csv-resolver precedent). */
  private async findContactByAddress(organizationId: string, email: string, phone: string): Promise<{ type: "customer" | "lead"; row: any } | null> {
    const phoneNorm = phone ? (normalizeBdPhone(phone) ?? phone.replace(/\D/g, "")) : "";
    const matchesContact = (r: any) => {
      if (email && r.email && String(r.email).trim().toLowerCase() === email) return true;
      if (phoneNorm && r.phone && (normalizeBdPhone(String(r.phone)) ?? String(r.phone).replace(/\D/g, "")) === phoneNorm) return true;
      return false;
    };
    for (const [table, type] of [["customer", "customer"], ["lead", "lead"]] as const) {
      const rows: any[] = await (this.prisma as any)[table]?.findMany({ where: { organizationId }, take: 5000 }).catch(() => []) ?? [];
      const hit = rows.find(matchesContact);
      if (hit) return { type, row: hit };
    }
    return null;
  }

  /**
   * Public signup submit. Lands as a REAL Lead (or the existing
   * customer/lead) + MessagePreference rows — never a parallel
   * subscriber store. With double opt-in the preferences start
   * "pending" (no marketing sends until confirmed); an existing
   * opted_out row is NEVER flipped by a signup (opt-out supreme).
   */
  async submitOptInForm(organizationId: string, slug: string, dto: { name?: string; email?: string; phone?: string }) {
    const t = this.optInFormTable();
    if (!t) throw notFound("messaging.formNotFound");
    const form = await t.findFirst({ where: { organizationId, slug, enabled: true } }).catch(() => null);
    if (!form) throw notFound("messaging.formNotFound");
    const channels: string[] = Array.isArray(form.channels) ? form.channels : [];
    const email = String(dto.email ?? "").trim().toLowerCase();
    const phoneRaw = String(dto.phone ?? "").trim();
    if (channels.includes("email")) {
      if (!email) throw badRequest("messaging.emailIsRequired");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("messaging.invalidEmailAddress");
    }
    if (channels.some((c) => c === "sms" || c === "whatsapp")) {
      if (!phoneRaw) throw badRequest("messaging.phoneIsRequired");
      if ((normalizeBdPhone(phoneRaw) ?? phoneRaw.replace(/\D/g, "")).replace(/\D/g, "").length < 10) throw badRequest("messaging.invalidPhoneNumber");
    }
    const found = await this.findContactByAddress(organizationId, email, phoneRaw);
    let recipientType: "customer" | "lead";
    let recipientId: string;
    if (found) {
      recipientType = found.type; recipientId = found.row.id;
    } else {
      const lead = await (this.prisma as any).lead.create({
        data: {
          organizationId, name: String(dto.name ?? "").trim() || email || phoneRaw,
          email: email || null, phone: phoneRaw || null,
          source: "messaging_form", stage: "new", tags: [`optin:${form.slug}`],
        },
      });
      recipientType = "lead"; recipientId = lead.id;
    }
    const target = form.doubleOptIn ? "pending" : "opted_in";
    const skippedOptOut: string[] = [];
    let confirmationSent = false;
    for (const channel of channels) {
      const address = channel === "email" ? email : phoneRaw;
      if (!address) continue;
      const existing = await (this.prisma as any).messagePreference.findFirst({
        where: { organizationId, channel, address: normalizePrefAddress(channel, address) },
      }).catch(() => null);
      if (existing?.status === "opted_out") { skippedOptOut.push(channel); continue; }
      await this.setPreference(organizationId, {
        channel, address, status: target as "pending" | "opted_in", source: "signup_form", actor: "public",
        recipientType, recipientId, note: `Opt-in form "${form.name}"`,
      });
    }
    if (form.doubleOptIn && email && channels.includes("email") && !skippedOptOut.includes("email")) {
      confirmationSent = await this.sendOptInConfirmationEmail(organizationId, form, email).catch(() => false);
    }
    return {
      ok: true,
      status: form.doubleOptIn ? "pending" : "active",
      confirmationSent,
      message: form.successMessage ?? (form.doubleOptIn
        ? "ধন্যবাদ! নিশ্চিত করতে আপনার ইমেইলে পাঠানো লিংকটি ক্লিক করুন।"
        : "ধন্যবাদ! আপনার সাবস্ক্রিপশন সম্পন্ন হয়েছে।"),
    };
  }

  /** The double opt-in confirmation email — sent through the
   * org's real email path (tenant SMTP when configured, else the
   * platform provider), carrying the signed confirm link AND the
   * preference-center link. NOT routed through sendToRecipient:
   * that guard (correctly) refuses pending addresses. */
  private async sendOptInConfirmationEmail(organizationId: string, form: any, email: string): Promise<boolean> {
    const token = issueOptInToken({ orgId: organizationId, channel: "email", address: normalizePrefAddress("email", email) });
    const confirmUrl = `${webBaseUrl()}/optin/${token}`;
    const text = `ধন্যবাদ! "${form.name}"-এ আপনার সাবস্ক্রিপশন নিশ্চিত করতে নিচের লিংকে ক্লিক করুন:\n\n${confirmUrl}\n\nআপনি এই সাইনআপ না করে থাকলে এই ইমেইল উপেক্ষা করুন — নিশ্চিত না করলে কোনো মার্কেটিং বার্তা পাঠানো হবে না।`;
    const tenantSmtp = await this.resolveTenantSmtp(organizationId).catch(() => null);
    const mailInput = { to: email, subject: "আপনার সাবস্ক্রিপশন নিশ্চিত করুন", text };
    const result = tenantSmtp && typeof (this.email as any).sendTenant === "function"
      ? await this.email.sendTenant(organizationId, tenantSmtp, mailInput)
      : await this.email.send(mailInput);
    return !!result;
  }

  inspectOptInToken(token: string) {
    const payload = verifyOptInToken(token);
    if (!payload) throw badRequest("messaging.thisConfirmationLinkIsInvalidOr");
    return { valid: true, channel: payload.channel, address: payload.channel === "email" ? maskEmailAddress(payload.address) : maskPhoneAddress(payload.address) };
  }

  /** Confirm a double opt-in: the token's (channel, address)
   * flips pending → opted_in; other PENDING rows of the SAME
   * contact (from the same signup) confirm with it — one person,
   * one confirmation. An opted_out row is never flipped. */
  async confirmOptIn(token: string) {
    const payload = verifyOptInToken(token);
    if (!payload) throw badRequest("messaging.thisConfirmationLinkIsInvalidOr");
    const row = await (this.prisma as any).messagePreference.findFirst({
      where: { organizationId: payload.orgId, channel: payload.channel, address: payload.address },
    }).catch(() => null);
    if (!row) throw badRequest("messaging.noRecordWasFoundForThis");
    if (row.status === "opted_out") return { ok: true, message: "আপনি এই ঠিকানায় আনসাবস্ক্রাইব করেছেন — সেটি বহাল আছে।" };
    if (row.status === "opted_in") return { ok: true, message: "আপনার সাবস্ক্রিপশন আগেই নিশ্চিত হয়েছে। ধন্যবাদ!" };
    await this.setPreference(payload.orgId, {
      channel: payload.channel, address: payload.address, status: "opted_in", source: "double_optin", actor: "public",
      recipientType: row.recipientType ?? null, recipientId: row.recipientId ?? null,
    });
    if (row.recipientId) {
      const siblings: any[] = await (this.prisma as any).messagePreference.findMany({
        where: { organizationId: payload.orgId, recipientId: row.recipientId, status: "pending" },
      }).catch(() => []);
      for (const sib of siblings) {
        await this.setPreference(payload.orgId, {
          channel: sib.channel, address: sib.address, status: "opted_in", source: "double_optin", actor: "public",
          recipientType: sib.recipientType ?? null, recipientId: sib.recipientId ?? null,
        });
      }
    }
    return { ok: true, message: "ধন্যবাদ! আপনার সাবস্ক্রিপশন নিশ্চিত হয়েছে।" };
  }

  // ----- MX10: public preference center -----
  // The token (same HMAC discipline as unsubscribe) identifies
  // ONE contact; the page manages channel on/off (real
  // opted_in/opted_out rows — enforced by the existing resolver),
  // topics and a per-contact frequency cap (stored on the
  // contact's preference rows and enforced in the resolver's
  // topic + frequency stages). Unsubscribe-all stays ONE click.

  private async resolvePreferenceContact(organizationId: string, payload: { recipientType?: string | null; recipientId?: string | null; channel: string; address: string }) {
    let row: any = null; let type: "customer" | "lead" | null = null;
    if (payload.recipientId) {
      const table = payload.recipientType === "customer" ? "customer" : "lead";
      row = await (this.prisma as any)[table]?.findFirst({ where: { id: payload.recipientId, organizationId } }).catch(() => null);
      if (row) type = table as "customer" | "lead";
    }
    if (!row) {
      const found = await this.findContactByAddress(
        organizationId,
        payload.channel === "email" ? payload.address : "",
        payload.channel === "email" ? "" : payload.address,
      );
      if (found) { row = found.row; type = found.type; }
    }
    const email = row?.email ? String(row.email).trim().toLowerCase() : (payload.channel === "email" ? payload.address : "");
    const phone = row?.phone ? String(row.phone) : (payload.channel !== "email" ? payload.address : "");
    return {
      recipientType: type, recipientId: row?.id ?? null,
      name: row ? (type === "customer" ? MessagingService.customerName(row) : row.name ?? "") : "",
      email, phone,
    };
  }

  private async preferenceRowsForContact(organizationId: string, contact: { email: string; phone: string }) {
    const out: { channel: string; address: string; row: any }[] = [];
    for (const channel of ["email", "sms", "whatsapp"]) {
      const raw = channel === "email" ? contact.email : contact.phone;
      if (!raw) continue;
      const address = normalizePrefAddress(channel, raw);
      const row = await (this.prisma as any).messagePreference.findFirst({ where: { organizationId, channel, address } }).catch(() => null);
      out.push({ channel, address, row });
    }
    return out;
  }

  async getPreferenceCenter(token: string) {
    const payload = verifyPreferenceToken(token);
    if (!payload) throw badRequest("messaging.thisLinkIsInvalidOrHas2");
    const contact = await this.resolvePreferenceContact(payload.orgId, payload);
    const rows = await this.preferenceRowsForContact(payload.orgId, contact);
    const formTopics: any[] = await (this.optInFormTable()?.findMany({ where: { organizationId: payload.orgId } }) ?? Promise.resolve([])).catch(() => []);
    const broadcasts: any[] = await (this.prisma as any).broadcast?.findMany({ where: { organizationId: payload.orgId }, select: { topic: true }, take: 500 }).catch(() => []) ?? [];
    const availableTopics = [...new Set([...formTopics.map((f) => f.topic), ...broadcasts.map((b) => b.topic)].filter(Boolean).map(String))];
    const firstTopics = rows.find((r) => Array.isArray(r.row?.topics))?.row?.topics ?? null;
    const firstCap = rows.find((r) => typeof r.row?.maxPerDay === "number")?.row?.maxPerDay ?? null;
    const org = await (this.prisma as any).organization?.findUnique({ where: { id: payload.orgId }, select: { name: true } }).catch(() => null);
    return {
      organizationName: org?.name ?? null,
      name: contact.name,
      channels: rows.map(({ channel, address, row }) => ({
        channel,
        address: channel === "email" ? maskEmailAddress(address) : maskPhoneAddress(address),
        status: row?.status ?? "none", // none = no explicit preference recorded; broadcasts may still reach this channel unless opted out
      })),
      topics: firstTopics, availableTopics,
      maxPerDay: firstCap,
    };
  }

  async updatePreferenceCenter(token: string, dto: { channels?: Record<string, boolean>; topics?: string[] | null; maxPerDay?: number | null }) {
    const payload = verifyPreferenceToken(token);
    if (!payload) throw badRequest("messaging.thisLinkIsInvalidOrHas2");
    const organizationId = payload.orgId;
    const contact = await this.resolvePreferenceContact(organizationId, payload);
    if (dto.maxPerDay !== undefined && dto.maxPerDay !== null && (!Number.isInteger(dto.maxPerDay) || dto.maxPerDay < 0 || dto.maxPerDay > 20)) {
      throw badRequest("messaging.maxPerDayMustBeAnIntegerBetween");
    }
    if (dto.channels) {
      for (const [channel, on] of Object.entries(dto.channels)) {
        if (!["email", "sms", "whatsapp"].includes(channel)) continue;
        const raw = channel === "email" ? contact.email : contact.phone;
        if (!raw) continue;
        await this.setPreference(organizationId, {
          channel, address: raw, status: on ? "opted_in" : "opted_out", source: "preference_center", actor: "public",
          recipientType: contact.recipientType, recipientId: contact.recipientId,
        });
      }
    }
    if (dto.topics !== undefined || dto.maxPerDay !== undefined) {
      const rows = await this.preferenceRowsForContact(organizationId, contact);
      for (const { channel, address, row } of rows) {
        if (!row) continue;
        const data: Record<string, unknown> = {};
        if (dto.topics !== undefined) data.topics = dto.topics === null ? null : dto.topics.map(String).slice(0, 50);
        if (dto.maxPerDay !== undefined) data.maxPerDay = dto.maxPerDay;
        await (this.prisma as any).messagePreference.update({ where: { id: row.id }, data }).catch(() => null);
        await this.recordConsentEvent(organizationId, {
          channel, address, fromStatus: row.status, toStatus: "preferences_updated",
          source: "preference_center", actor: "public",
          recipientType: contact.recipientType, recipientId: contact.recipientId,
          note: `topics=${dto.topics === undefined ? "unchanged" : JSON.stringify(data.topics ?? null)} maxPerDay=${dto.maxPerDay === undefined ? "unchanged" : String(dto.maxPerDay)}`,
        });
      }
    }
    return this.getPreferenceCenter(token);
  }

  /** ONE-CLICK unsubscribe-all from the preference center: every
   * channel of this contact flips to opted_out in one action —
   * the center adds choice, never friction to opting out. */
  async unsubscribeAllFromCenter(token: string) {
    const payload = verifyPreferenceToken(token);
    if (!payload) throw badRequest("messaging.thisLinkIsInvalidOrHas2");
    const contact = await this.resolvePreferenceContact(payload.orgId, payload);
    for (const channel of ["email", "sms", "whatsapp"]) {
      const raw = channel === "email" ? contact.email : contact.phone;
      if (!raw) continue;
      await this.setPreference(payload.orgId, {
        channel, address: raw, status: "opted_out", source: "preference_center", actor: "public",
        recipientType: contact.recipientType, recipientId: contact.recipientId, note: "Unsubscribe all (preference center)",
      });
    }
    return { ok: true, message: "আপনাকে সব চ্যানেল থেকে আনসাবস্ক্রাইব করা হয়েছে।" };
  }

  /** Authenticated: mint a preference-center link for one contact
   * address (dashboard use + inclusion in org-sent mail). */
  async issuePreferenceCenterLink(organizationId: string, actorId: string, dto: { channel: string; address: string }) {
    const channel = dto.channel;
    if (!["email", "sms", "whatsapp"].includes(channel)) throw badRequest("messaging.channelMustBeEmailSmsOr");
    const address = this.validatePrefAddress(channel, dto.address);
    const pref = await (this.prisma as any).messagePreference.findFirst({ where: { organizationId, channel, address } }).catch(() => null);
    const found = await this.findContactByAddress(organizationId, channel === "email" ? address : "", channel === "email" ? "" : address);
    const token = issuePreferenceToken({
      orgId: organizationId, channel, address,
      recipientType: pref?.recipientType ?? found?.type ?? null,
      recipientId: pref?.recipientId ?? found?.row?.id ?? null,
    });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.preference_link_issue", entityType: "MessagePreference", entityId: organizationId, metadata: { channel } });
    return { url: `${webBaseUrl()}/preferences/${token}` };
  }

  // ----- MX10: CSV import wizard -----

  private async existingAddressSet(organizationId: string, channel: string): Promise<Set<string>> {
    const set = new Set<string>();
    for (const table of ["customer", "lead"] as const) {
      const rows: any[] = await (this.prisma as any)[table]?.findMany({ where: { organizationId }, take: 20000 }).catch(() => []) ?? [];
      for (const r of rows) {
        const raw = channel === "email" ? r.email : r.phone;
        if (raw) set.add(normalizePrefAddress(channel, String(raw)));
      }
    }
    return set;
  }

  /** Step 1+2 of the wizard: parse + map + hygiene report. The
   * report is PERSISTED (MessagingCsvImport, status previewed)
   * BEFORE any contact exists; commit reads it back verbatim. */
  async previewCsvImport(organizationId: string, actorId: string, dto: { channel: string; csv: string; mapping: CsvImportMapping }) {
    const table = (this.prisma as any).messagingCsvImport;
    if (!table || typeof table.create !== "function") throw badRequest("messaging.cSVImportIsNotAvailableDatabase");
    if (!["email", "sms", "whatsapp"].includes(dto.channel)) throw badRequest("messaging.channelMustBeEmailSmsOr");
    const { headers, records } = parseContactsCsv(dto.csv ?? "");
    if (!headers.length) throw badRequest("messaging.cSVMustHaveAHeaderRow");
    if (!records.length) throw badRequest("messaging.cSVHasNoDataRows");
    if (records.length > 5000) throw badRequest("messaging.cSVImportIsCappedAt5000");
    const mapping = dto.mapping ?? {};
    if (dto.channel === "email" && !mapping.email) throw badRequest("messaging.mapTheEmailColumnForAn");
    if (dto.channel !== "email" && !mapping.phone) throw badRequest("messaging.mapThePhoneColumnForA");
    for (const key of ["name", "email", "phone"] as const) {
      if (mapping[key] && !headers.includes(mapping[key]!)) throw badRequest("messaging.mappedColumnKeyIsNotIn", { key: mapping[key], headersJoin: headers.join(", ") });
    }
    const existing = await this.existingAddressSet(organizationId, dto.channel);
    const result = classifyCsvRows({ records, mapping, channel: dto.channel, existingAddresses: existing });
    const row = await table.create({
      data: {
        organizationId, createdById: actorId, channel: dto.channel, mapping,
        totalRows: records.length, cleanCount: result.cleanCount,
        duplicateCount: result.duplicateCount, invalidCount: result.invalidCount, roleCount: result.roleCount,
        report: result.rows, status: "previewed",
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.csv_import_preview", entityType: "MessagingCsvImport", entityId: row.id, metadata: { channel: dto.channel, totalRows: records.length, clean: result.cleanCount } });
    return { importId: row.id, headers, totalRows: records.length, cleanCount: result.cleanCount, duplicateCount: result.duplicateCount, invalidCount: result.invalidCount, roleCount: result.roleCount, rows: result.rows };
  }

  /** Step 3: import ONLY the clean rows of a previewed report —
   * each becomes a real Lead (source "csv_import") + an opted_in
   * preference stamped source "import" (the org's asserted
   * consent source for the file). An existing opted_out for the
   * address stays opted_out (supreme) and is counted, not hidden. */
  async commitCsvImport(organizationId: string, actorId: string, importId: string) {
    const table = (this.prisma as any).messagingCsvImport;
    if (!table) throw badRequest("messaging.cSVImportIsNotAvailableDatabase");
    const row = await table.findFirst({ where: { id: importId, organizationId } });
    if (!row) throw notFound("messaging.importNotFound");
    if (row.status === "committed") throw badRequest("messaging.thisImportWasAlreadyCommittedPreview");
    const outcomes: any[] = Array.isArray(row.report) ? row.report : [];
    let imported = 0, suppressedOptOut = 0;
    const errors: { row: number; error: string }[] = [];
    for (const o of outcomes) {
      if (o.status !== "clean") continue;
      try {
        const existingPref = await (this.prisma as any).messagePreference.findFirst({
          where: { organizationId, channel: row.channel, address: o.address },
        }).catch(() => null);
        const lead = await (this.prisma as any).lead.create({
          data: {
            organizationId, name: o.name || o.address,
            email: o.email || null, phone: o.phone || null,
            source: "csv_import", stage: "new", tags: ["csv-import"],
          },
        });
        if (existingPref?.status === "opted_out") { suppressedOptOut++; imported++; continue; }
        await this.setPreference(organizationId, {
          channel: row.channel, address: o.address, status: "opted_in", source: "import", actor: `user:${actorId}`,
          recipientType: "lead", recipientId: lead.id, note: `CSV import ${row.id}`,
        });
        imported++;
      } catch (e) {
        errors.push({ row: o.row, error: e instanceof Error ? e.message : "Import failed" });
      }
    }
    await table.update({ where: { id: importId }, data: { status: "committed", committedAt: new Date() } });
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.csv_import_commit", entityType: "MessagingCsvImport", entityId: importId, metadata: { imported, suppressedOptOut, failed: errors.length } });
    return { imported, suppressedOptOut, errors };
  }

  async getCsvImport(organizationId: string, importId: string) {
    const table = (this.prisma as any).messagingCsvImport;
    if (!table) throw badRequest("messaging.cSVImportIsNotAvailableDatabase");
    const row = await table.findFirst({ where: { id: importId, organizationId } });
    if (!row) throw notFound("messaging.importNotFound");
    return row;
  }

  /** The persisted hygiene report as a downloadable CSV — every
   * row with its outcome and (for exclusions) its reason. */
  async csvImportReportCsv(organizationId: string, importId: string): Promise<string> {
    const row = await this.getCsvImport(organizationId, importId);
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["row,name,email,phone,address,status,reason,reasonText"];
    for (const o of (Array.isArray(row.report) ? row.report : []) as any[]) {
      lines.push([o.row, o.name ?? "", o.email ?? "", o.phone ?? "", o.address ?? "", o.status, o.reason ?? "", o.reasonText ?? ""].map(esc).join(","));
    }
    return lines.join("\n");
  }

  // ----- MX10: consent audit export -----
  // From the REAL MessageConsentEvent records. History begins
  // at MX10 — the export honestly contains nothing earlier,
  // because nothing earlier was ever recorded.

  async listConsentEvents(organizationId: string, take = 200) {
    const table = (this.prisma as any).messageConsentEvent;
    if (!table || typeof table.findMany !== "function") return { events: [], historyBeginsAt: "MX10" };
    const events = await table.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: Math.min(take, 1000) }).catch(() => []);
    return { events, historyBeginsAt: "MX10" };
  }

  async exportConsentEventsCsv(organizationId: string, actorId: string): Promise<string> {
    const table = (this.prisma as any).messageConsentEvent;
    const rows: any[] = table && typeof table.findMany === "function"
      ? await table.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, take: 10000 }).catch(() => [])
      : [];
    await this.audit.log({ organizationId, userId: actorId, action: "messaging.consent_export", entityType: "MessageConsentEvent", entityId: organizationId, metadata: { rows: rows.length } });
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["createdAt,channel,address,recipientType,recipientId,fromStatus,toStatus,source,actor,note"];
    for (const r of rows) lines.push([r.createdAt ? new Date(r.createdAt).toISOString() : "", r.channel, r.address, r.recipientType ?? "", r.recipientId ?? "", r.fromStatus ?? "", r.toStatus, r.source, r.actor, r.note ?? ""].map(esc).join(","));
    return lines.join("\n");
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
   * MX13: telegram IS hooked (from the same inbox dispatch) —
   * unlike a Messenger PSID, a telegram chat id IS addressable
   * by a broadcast send path (this package's), and telegram's
   * native "/start" counts as START.
   */
  async handleInboundKeyword(organizationId: string, channel: string, senderAddress: string, text: string): Promise<{ matched: boolean; action?: "opted_out" | "opted_in" }> {
    // MX13: telegram joins whatsapp here — the SAME preference
    // store, channel = the inbound channel, address = the
    // sender's channel address (phone for whatsapp, chat id for
    // telegram). Telegram's own "/start" command (the message
    // every subscriber sends to open the bot) ALSO counts as
    // START → opted_in: a user who (re)started the bot has
    // signalled they want its messages. "/start" stays
    // telegram-only — it is NOT added to the shared reserved
    // set, so WhatsApp behaviour is unchanged.
    if (channel !== "whatsapp" && channel !== "telegram") return { matched: false };
    const normalized = String(text ?? "").trim();
    if (!normalized || !senderAddress) return { matched: false };
    const upper = normalized.toUpperCase();
    const isStop = KEYWORD_RESERVED_STOP.some((k) => upper === k.toUpperCase());
    const isStart = !isStop && (KEYWORD_RESERVED_START.some((k) => upper === k.toUpperCase()) || (channel === "telegram" && upper === "/START"));
    if (!isStop && !isStart) return { matched: false };
    const status = isStop ? "opted_out" : "opted_in";
    await this.setPreference(organizationId, {
      channel, address: senderAddress, status, source: "inbound_keyword", actor: "inbound",
    });
    return { matched: true, action: status };
  }

  /**
   * MX10 — WhatsApp opt-in keyword (growth): an inbound message
   * equal to an ENABLED opt-in form's keyword for this org. This
   * runs in the same inbound path as the MS2 hook (the inbox
   * dispatch calls it only when STOP/START did not match —
   * opt-out stays supreme): a pending signup for this phone is
   * CONFIRMED (pending → opted_in, source keyword_optin);
   * otherwise a fresh opted_in is recorded for the form's
   * channels the phone can receive (whatsapp), because the
   * sender initiated contact from their own handset. Returns
   * false when no enabled form claims the keyword, so MX6
   * campaign matching proceeds exactly as before.
   */
  async handleOptInKeyword(organizationId: string, senderAddress: string, text: string): Promise<boolean> {
    const keyword = normalizeKeywordText(text);
    if (!keyword || !senderAddress) return false;
    const table = (this.prisma as any).messagingOptInForm;
    if (!table || typeof table.findMany !== "function") return false;
    const forms: any[] = await table.findMany({ where: { organizationId, enabled: true } }).catch(() => []);
    const form = forms.find((f) => f.keyword && normalizeKeywordText(f.keyword) === keyword);
    if (!form) return false;
    const address = normalizePrefAddress("whatsapp", senderAddress);
    const existing = await (this.prisma as any).messagePreference.findFirst({
      where: { organizationId, channel: "whatsapp", address },
    }).catch(() => null);
    if (existing?.status === "opted_out") return true; // opt-out is supreme: claimed, but never flipped by a growth keyword
    await this.setPreference(organizationId, {
      channel: "whatsapp", address, status: "opted_in", source: "keyword_optin", actor: "inbound",
      recipientType: existing?.recipientType ?? null, recipientId: existing?.recipientId ?? null,
      note: `Opt-in form "${form.name}" keyword`,
    });
    return true;
  }

  // ---------- MX6: keyword campaigns (two-way & interactive) ----------
  // Rules match an inbound WhatsApp reply AFTER the MS2 hook
  // above has had its exclusive say: the inbox dispatch calls
  // handleKeywordReply ONLY when handleInboundKeyword did NOT
  // match, and handleKeywordReply re-checks the reserved set
  // itself (defense in depth) — a STOP/START message can never
  // produce a campaign hit or an auto-reply. Channel scope is
  // WhatsApp ONLY, honestly: it is the only channel with an
  // inbound path into messaging. There is NO SMS inbound path
  // anywhere in this codebase and email replies are not hooked
  // into messaging, so keyword campaigns on those channels are
  // NOT BUILT; Messenger is not hooked either (a PSID matches no
  // preference/send keying — a rule on it could never fire, the
  // MS2 dead-data rationale).

  private keywordRuleTable(): any | null {
    const t = (this.prisma as any).messagingKeywordRule;
    return t && typeof t.findMany === "function" ? t : null;
  }

  private keywordHitTable(): any | null {
    const t = (this.prisma as any).messagingKeywordHit;
    return t && typeof t.findMany === "function" ? t : null;
  }

  private requireKeywordTables() {
    const rules = this.keywordRuleTable();
    const hits = this.keywordHitTable();
    if (!rules || !hits) {
      throw badRequest("messaging.keywordCampaignsAreNotAvailableIn");
    }
    return { rules, hits };
  }

  /** Every normalized keyword a rule claims: its own keyword
   * (keyword rules) or every option keyword (poll rules). */
  private claimedKeywordsOf(rule: any): string[] {
    const out: string[] = [];
    if (rule?.kind === "poll") {
      for (const opt of Array.isArray(rule.pollOptions) ? rule.pollOptions : []) {
        for (const k of Array.isArray(opt?.keywords) ? opt.keywords : []) out.push(normalizeKeywordText(k));
      }
    } else if (rule?.keyword) {
      out.push(normalizeKeywordText(rule.keyword));
    }
    return out.filter(Boolean);
  }

  /**
   * MX6 — validate a keyword-rule shape (create, or the merged
   * shape on update) and return the normalized row data. Rules:
   *  - channel: "whatsapp" only — any other value is an honest
   *    400 naming the reason (no inbound path on that channel);
   *  - keyword rules: keyword required; RESERVED keywords
   *    (the full STOP + START sets, same normalization) refused;
   *    at least one action (a tag or an auto-reply text) — a
   *    rule that does nothing is refused;
   *  - tag shape: ONE tag string + applyTagTo naming where it
   *    goes (customer | lead | conversation) — the two must
   *    come together;
   *  - autoReplyText: org-authored plain text, ≤ 1000 chars;
   *  - poll rules: 2..6 options, each with a label and ≥ 1
   *    keyword; keywords unique across the poll's options, not
   *    reserved; polls carry no tag / auto-reply in v1 (they
   *    only record votes);
   *  - no keyword may already be claimed by ANOTHER enabled
   *    rule of the org — including inside another poll's
   *    options (a disabled rule claims nothing).
   */
  private async validateKeywordRule(organizationId: string, dto: any, excludeRuleId?: string) {
    const { rules } = this.requireKeywordTables();
    const name = String(dto?.name ?? "").trim();
    if (!name) throw badRequest("messaging.aKeywordRuleNeedsAName");
    if (name.length > 120) throw badRequest("messaging.ruleNameIsTooLongMax");
    const kind = String(dto?.kind ?? "");
    if (!["keyword", "poll"].includes(kind)) throw badRequest("messaging.kindMustBeKeywordOrPoll");
    const channel = String(dto?.channel ?? "whatsapp").trim() || "whatsapp";
    if (channel !== "whatsapp") {
      throw badRequest("messaging.keywordCampaignsAreWhatsAppOnlyIn", { channel: channel });
    }

    let keyword: string | null = null;
    let tag: string | null = null;
    let applyTagTo: string[] | null = null;
    let autoReplyText: string | null = null;
    let pollOptions: { key: string; label: string; keywords: string[] }[] | null = null;
    const ownKeywords: string[] = [];

    if (kind === "keyword") {
      if (dto?.pollOptions !== undefined && dto?.pollOptions !== null) {
        throw badRequest("messaging.pollOptionsBelongToPollRulesA");
      }
      keyword = String(dto?.keyword ?? "").trim();
      if (!keyword) throw badRequest("messaging.keywordIsRequiredForAKeyword");
      if (keyword.length > 100) throw badRequest("messaging.keywordIsTooLongMax100");
      const normalizedKeyword = normalizeKeywordText(keyword);
      if (isReservedKeyword(normalizedKeyword)) {
        throw badRequest("messaging.keywordIsAReservedKeywordSTOP2", { keyword: keyword });
      }
      ownKeywords.push(normalizedKeyword);

      tag = String(dto?.tag ?? "").trim() || null;
      if (tag && tag.length > 80) throw badRequest("messaging.tagIsTooLongMax80");
      const targets: string[] = Array.isArray(dto?.applyTagTo) ? [...new Set<string>(dto.applyTagTo.map((t: unknown) => String(t)))] : [];
      for (const t of targets) {
        if (!["customer", "lead", "conversation"].includes(t)) {
          throw badRequest("messaging.applyTagToMayOnlyContainCustomerLead", { t: t });
        }
      }
      if (tag && targets.length === 0) throw badRequest("messaging.applyTagToMustNameAtLeastOne");
      if (!tag && targets.length > 0) throw badRequest("messaging.aTagValueIsRequiredWhen");
      applyTagTo = tag ? targets : null;

      autoReplyText = String(dto?.autoReplyText ?? "").trim() || null;
      if (autoReplyText && autoReplyText.length > 1000) throw badRequest("messaging.autoReplyTextIsTooLong");
      if (!tag && !autoReplyText) {
        throw badRequest("messaging.aKeywordRuleNeedsAtLeast");
      }
    } else {
      if (dto?.keyword !== undefined && dto?.keyword !== null && String(dto.keyword).trim()) {
        throw badRequest("messaging.pollRulesMatchThroughTheirOptions");
      }
      if (String(dto?.tag ?? "").trim() || (Array.isArray(dto?.applyTagTo) && dto.applyTagTo.length) || String(dto?.autoReplyText ?? "").trim()) {
        throw badRequest("messaging.pollRulesOnlyRecordVotesIn");
      }
      const rawOptions: any[] = Array.isArray(dto?.pollOptions) ? dto.pollOptions : [];
      if (rawOptions.length < 2 || rawOptions.length > 6) {
        throw badRequest("messaging.aPollNeeds2To6");
      }
      const seenKeys = new Set<string>();
      const seenKeywords = new Map<string, string>();
      pollOptions = rawOptions.map((opt: any, i: number) => {
        const key = String(opt?.key ?? "").trim() || `opt${i + 1}`;
        if (seenKeys.has(key)) throw badRequest("messaging.pollOptionKeysMustBeUnique", { key: key });
        seenKeys.add(key);
        const label = String(opt?.label ?? "").trim();
        if (!label) throw badRequest("messaging.pollOptionKeyNeedsALabel", { key: key });
        const keywords = (Array.isArray(opt?.keywords) ? opt.keywords : [])
          .map((k: unknown) => String(k ?? "").trim()).filter(Boolean);
        if (keywords.length === 0) throw badRequest("messaging.pollOptionLabelNeedsAtLeast", { label: label });
        for (const k of keywords) {
          if (k.length > 100) throw badRequest("messaging.pollKeywordKIsTooLong", { k: k });
          const nk = normalizeKeywordText(k);
          if (isReservedKeyword(nk)) {
            throw badRequest("messaging.kIsAReservedKeywordSTOP", { k: k });
          }
          const prior = seenKeywords.get(nk);
          if (prior !== undefined) {
            throw badRequest("messaging.pollKeywordKIsClaimedBy", { k: k, prior: prior, label: label });
          }
          seenKeywords.set(nk, label);
          ownKeywords.push(nk);
        }
        return { key, label, keywords };
      });
    }

    // Duplicate claim: no keyword may already be claimed by
    // another ENABLED rule of this org (keyword rules and poll
    // options alike).
    const others: any[] = await rules.findMany({ where: { organizationId, enabled: true } });
    for (const other of others ?? []) {
      if (excludeRuleId && other.id === excludeRuleId) continue;
      const claimed = new Set(this.claimedKeywordsOf(other));
      for (const nk of ownKeywords) {
        if (claimed.has(nk)) {
          throw badRequest("messaging.keywordNkIsAlreadyClaimedBy", { nk: nk, name: other.name });
        }
      }
    }

    return {
      name, kind, keyword, channel, tag, applyTagTo, autoReplyText, pollOptions,
      enabled: dto?.enabled === undefined ? true : Boolean(dto.enabled),
    };
  }

  async listKeywordRules(organizationId: string) {
    const { rules, hits } = this.requireKeywordTables();
    const rows: any[] = await rules.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
    const withCounts: any[] = [];
    for (const row of rows ?? []) {
      const hitCount = typeof hits.count === "function"
        ? await hits.count({ where: { organizationId, ruleId: row.id } }).catch(() => 0)
        : 0;
      withCounts.push({ ...row, hitCount });
    }
    return withCounts;
  }

  private async getKeywordRuleOrThrow(organizationId: string, ruleId: string) {
    const { rules } = this.requireKeywordTables();
    const row = await rules.findFirst({ where: { id: ruleId, organizationId } });
    if (!row) throw notFound("messaging.keywordRuleNotFound");
    return row;
  }

  async createKeywordRule(organizationId: string, actorId: string, dto: any) {
    const { rules } = this.requireKeywordTables();
    const data = await this.validateKeywordRule(organizationId, dto);
    const row = await rules.create({ data: { organizationId, ...data, createdById: actorId } });
    await this.audit.log({
      organizationId, userId: actorId, action: "messaging.keyword_rule_create",
      entityType: "MessagingKeywordRule", entityId: row.id,
      metadata: { kind: row.kind, keyword: row.keyword ?? undefined },
    });
    return row;
  }

  async updateKeywordRule(organizationId: string, actorId: string, ruleId: string, dto: any) {
    const { rules } = this.requireKeywordTables();
    const existing = await this.getKeywordRuleOrThrow(organizationId, ruleId);
    // Validate the MERGED shape: a partial PATCH (e.g. only the
    // enabled toggle) is checked as the rule it would become.
    const merged = {
      name: existing.name, kind: existing.kind, keyword: existing.keyword, channel: existing.channel,
      tag: existing.tag, applyTagTo: existing.applyTagTo, autoReplyText: existing.autoReplyText,
      pollOptions: existing.pollOptions, enabled: existing.enabled,
      ...(dto ?? {}),
    };
    const data = await this.validateKeywordRule(organizationId, merged, ruleId);
    const row = await rules.update({ where: { id: ruleId }, data });
    await this.audit.log({
      organizationId, userId: actorId, action: "messaging.keyword_rule_update",
      entityType: "MessagingKeywordRule", entityId: ruleId, metadata: { enabled: row.enabled },
    });
    return row;
  }

  async deleteKeywordRule(organizationId: string, actorId: string, ruleId: string) {
    const { rules } = this.requireKeywordTables();
    const existing = await this.getKeywordRuleOrThrow(organizationId, ruleId);
    await rules.delete({ where: { id: existing.id } });
    await this.audit.log({
      organizationId, userId: actorId, action: "messaging.keyword_rule_delete",
      entityType: "MessagingKeywordRule", entityId: ruleId, metadata: { name: existing.name },
    });
    return { deleted: true };
  }

  async listKeywordHits(organizationId: string, opts?: { ruleId?: string; take?: number }) {
    const { rules, hits } = this.requireKeywordTables();
    const take = Math.min(Math.max(Number(opts?.take ?? 50) || 50, 1), 200);
    const rows: any[] = await hits.findMany({
      where: { organizationId, ...(opts?.ruleId ? { ruleId: opts.ruleId } : {}) },
      orderBy: { createdAt: "desc" }, take,
    });
    const ruleRows: any[] = await rules.findMany({ where: { organizationId } }).catch(() => []);
    const byId = new Map((ruleRows ?? []).map((r: any) => [r.id, r]));
    return (rows ?? []).map((h: any) => ({
      ...h,
      ruleName: byId.get(h.ruleId)?.name ?? null,
      ruleKind: byId.get(h.ruleId)?.kind ?? null,
    }));
  }

  /**
   * MX6 — poll tally. Semantics (also in the acceptance doc):
   * one voter = one conversation; a voter may CHANGE their vote
   * by replying with another option's keyword — each
   * conversation counts ONCE, under its LATEST hit. Earlier
   * votes from the same conversation do not count.
   */
  async getKeywordPollTally(organizationId: string, ruleId: string) {
    const { hits } = this.requireKeywordTables();
    const rule = await this.getKeywordRuleOrThrow(organizationId, ruleId);
    if (rule.kind !== "poll") throw badRequest("messaging.tallyIsOnlyAvailableForPoll");
    const rows: any[] = await hits.findMany({
      where: { organizationId, ruleId, pollOptionKey: { not: null } },
      orderBy: { createdAt: "asc" },
    });
    const latestByConversation = new Map<string, string>();
    for (const h of rows ?? []) {
      if (h.conversationId && h.pollOptionKey) latestByConversation.set(h.conversationId, h.pollOptionKey);
    }
    const counts = new Map<string, number>();
    for (const key of latestByConversation.values()) counts.set(key, (counts.get(key) ?? 0) + 1);
    const options = (Array.isArray(rule.pollOptions) ? rule.pollOptions : []).map((o: any) => ({
      key: String(o.key), label: String(o.label), votes: counts.get(String(o.key)) ?? 0,
    }));
    return { ruleId: rule.id, options, totalVoters: latestByConversation.size };
  }

  /** MX6: append ONE tag to a Json string-array field (Customer
   * .tags / Lead.tags), deduped, other tags preserved. Returns
   * the per-action outcome recorded on the hit. */
  private async appendJsonTag(table: any, organizationId: string, entityId: string, tag: string, entity: string, target: string) {
    const row = await table.findFirst({ where: { id: entityId, organizationId } }).catch(() => null);
    if (!row) return { action: "tag", target, entity, status: "failed", reason: `linked ${entity} not found` };
    const current: string[] = Array.isArray(row.tags) ? row.tags.map((t: unknown) => String(t)) : [];
    if (current.includes(tag)) {
      return { action: "tag", target, entity, status: "skipped", reason: `tag already present on ${entity}` };
    }
    await table.update({ where: { id: row.id }, data: { tags: [...current, tag] } });
    return { action: "tag", target, entity, status: "applied" };
  }

  /** MX6: one tag action of a keyword rule against ONE selected
   * target. The "customer" target falls back to the linked lead
   * when the conversation has no customer (the outcome records
   * which entity was actually tagged); "conversation" tags the
   * ChannelConversation row itself (String[] tags). */
  private async applyKeywordTag(
    organizationId: string,
    conversation: { id: string; customerId?: string | null; leadId?: string | null },
    target: string, tag: string,
  ): Promise<Record<string, unknown>> {
    const p = this.prisma as any;
    if (target === "customer") {
      if (conversation.customerId) return this.appendJsonTag(p.customer, organizationId, conversation.customerId, tag, "customer", target);
      if (conversation.leadId) return this.appendJsonTag(p.lead, organizationId, conversation.leadId, tag, "lead", target);
      return { action: "tag", target, status: "skipped", reason: "conversation is linked to neither a customer nor a lead" };
    }
    if (target === "lead") {
      if (!conversation.leadId) return { action: "tag", target, status: "skipped", reason: "conversation has no linked lead" };
      return this.appendJsonTag(p.lead, organizationId, conversation.leadId, tag, "lead", target);
    }
    if (target === "conversation") {
      const conv = await p.channelConversation.findFirst({ where: { id: conversation.id, organizationId } }).catch(() => null);
      if (!conv) return { action: "tag", target, entity: "conversation", status: "failed", reason: "conversation not found" };
      const current: string[] = Array.isArray(conv.tags) ? conv.tags.map((t: unknown) => String(t)) : [];
      if (current.includes(tag)) return { action: "tag", target, entity: "conversation", status: "skipped", reason: "tag already present on conversation" };
      await p.channelConversation.update({ where: { id: conv.id }, data: { tags: [...current, tag] } });
      return { action: "tag", target, entity: "conversation", status: "applied" };
    }
    return { action: "tag", target, status: "skipped", reason: `unknown tag target "${target}"` };
  }

  /** MX6: the auto-reply action. The sender's WhatsApp opt-out
   * is checked FIRST through the SAME preference lookup the
   * broadcast resolver uses — an opted-out sender gets NO reply
   * (the tags above still apply: they record the customer's own
   * explicit reply; only the send is blocked). The send itself
   * goes through the registered inbox-reply port (the real
   * inbox conversation send path — a keyword reply just arrived,
   * so the WhatsApp 24h window is open by construction); without
   * a registered port the action is recorded as skipped, never
   * as sent. */
  private async sendKeywordAutoReply(
    organizationId: string,
    conversation: { id: string; externalContactId?: string | null },
    replyText: string,
  ): Promise<Record<string, unknown>> {
    const address = normalizePrefAddress("whatsapp", conversation.externalContactId ?? "");
    const optOut = await this.findOptOut(organizationId, "whatsapp", address);
    if (optOut) return { action: "auto_reply", status: "skipped", reason: "sender opted out" };
    if (!this.inboxReplyPort) {
      return { action: "auto_reply", status: "skipped", reason: "inbox reply path is not available in this deployment (no inbox module registered)" };
    }
    try {
      const sent = await this.inboxReplyPort.sendConversationText(organizationId, conversation.id, replyText);
      return { action: "auto_reply", status: "applied", providerMessageId: sent.providerMessageId };
    } catch (e) {
      return { action: "auto_reply", status: "failed", reason: e instanceof Error ? e.message : "Auto-reply send failed" };
    }
  }

  /**
   * MX6 — inbound campaign matching. Called best-effort from
   * the inbox dispatch ONLY when the MS2 hook did not match
   * (STOP/START never reaches campaign logic — and this method
   * re-checks the reserved set itself, so no caller mistake can
   * route a STOP into a campaign). WhatsApp only. No claim →
   * { matched: false } and NO hit row (non-campaign chatter is
   * not recorded). A claim → the rule's actions run (each
   * outcome recorded), exactly ONE hit row is written, and a
   * poll claim records a vote (pollOptionKey) with no actions.
   */
  async handleKeywordReply(
    organizationId: string,
    conversation: { id: string; externalContactId?: string | null; customerId?: string | null; leadId?: string | null },
    text: string,
  ): Promise<{ matched: boolean; ruleId?: string; pollOptionKey?: string; hitId?: string }> {
    const rulesTable = this.keywordRuleTable();
    const hitsTable = this.keywordHitTable();
    if (!rulesTable || !hitsTable || !conversation?.id) return { matched: false };
    const normalized = normalizeKeywordText(text);
    if (!normalized) return { matched: false };
    if (isReservedKeyword(normalized)) return { matched: false };
    const rules: any[] = await rulesTable.findMany({ where: { organizationId, enabled: true, channel: "whatsapp" } }).catch(() => []);
    let matchedRule: any = null;
    let matchedKeyword = "";
    let pollOptionKey: string | null = null;
    for (const rule of rules ?? []) {
      if (rule.kind === "poll") {
        for (const opt of Array.isArray(rule.pollOptions) ? rule.pollOptions : []) {
          const kw = (Array.isArray(opt?.keywords) ? opt.keywords : []).find((k: unknown) => normalizeKeywordText(k) === normalized);
          if (kw) { matchedRule = rule; matchedKeyword = String(kw); pollOptionKey = String(opt.key); break; }
        }
      } else if (rule.keyword && normalizeKeywordText(rule.keyword) === normalized) {
        matchedRule = rule; matchedKeyword = String(rule.keyword);
      }
      if (matchedRule) break;
    }
    if (!matchedRule) return { matched: false };

    const actions: Record<string, unknown>[] = [];
    if (matchedRule.kind !== "poll") {
      const tag = String(matchedRule.tag ?? "").trim();
      const targets: string[] = Array.isArray(matchedRule.applyTagTo) ? matchedRule.applyTagTo.map((t: unknown) => String(t)) : [];
      if (tag) {
        for (const target of targets) {
          actions.push(await this.applyKeywordTag(organizationId, conversation, target, tag).catch((e) => ({
            action: "tag", target, status: "failed", reason: e instanceof Error ? e.message : "Tag failed",
          })));
        }
      }
      const replyText = String(matchedRule.autoReplyText ?? "").trim();
      if (replyText) actions.push(await this.sendKeywordAutoReply(organizationId, conversation, replyText));
    }

    const hit = await hitsTable.create({
      data: {
        organizationId, ruleId: matchedRule.id, conversationId: conversation.id,
        customerId: conversation.customerId ?? null, leadId: conversation.leadId ?? null,
        matchedText: String(text ?? ""), matchedKeyword, pollOptionKey,
        actions: actions.length ? actions : null,
      },
    });
    return { matched: true, ruleId: matchedRule.id, ...(pollOptionKey ? { pollOptionKey } : {}), hitId: hit?.id };
  }

  /** MX6: the labels an AI classification may suggest — exactly
   * one of these four, nothing else is ever stored. */
  static readonly KEYWORD_HIT_LABELS = ["interest", "complaint", "opt-out", "other"];

  /**
   * MX6 — AI classification of one hit's matched text:
   * a SUGGESTION only. Runs through the SAME guard path as MS9
   * (checkMessagingAiLimit: org kill switch 403 → daily cap
   * 429, before any provider call; one usage record per
   * completed call on the shared messaging_copy ledger). The
   * dev-template provider is NOT a model and cannot classify —
   * it gets an honest 502 instead of a fabricated label. On
   * success only suggestedLabel + classifyStatus "suggested"
   * are stored; NOTHING is applied at this stage.
   */
  async classifyKeywordHit(organizationId: string, actorId: string, hitId: string) {
    const { hits } = this.requireKeywordTables();
    const hit = await hits.findFirst({ where: { id: hitId, organizationId } });
    if (!hit) throw notFound("messaging.keywordHitNotFound");
    await this.checkMessagingAiLimit(organizationId);
    const provider = await this.messagingAiProvider(organizationId);
    if (!provider.isRealLlm) {
      throw new ApiException("messaging.theRealAILLMIsNot2", 502);
    }
    const labels = MessagingService.KEYWORD_HIT_LABELS;
    const systemPrompt = [
      "You classify a single inbound WhatsApp reply a customer sent to an ecommerce business.",
      `Reply with ONLY JSON {"label": "..."} where the label is exactly one of: ${labels.join(" | ")}.`,
      '"interest" = the customer shows buying/product interest. "complaint" = a complaint or problem report.',
      '"opt-out" = the customer asks not to receive marketing messages (in any language). "other" = anything else.',
      "Use ONLY the message text given. Never invent context.",
    ].join("\n");
    let result: { text: string; model: string; inputTokens: number; outputTokens: number; tokensEstimated: boolean };
    try {
      result = await provider.complete(
        [{ role: "system", content: systemPrompt }, { role: "user", content: String(hit.matchedText ?? "") }],
        { jsonMode: true, maxTokens: 100 },
      );
    } catch (e: any) {
      throw new HttpException(e?.message ?? String(e), 502);
    }
    let parsed: any = null;
    try { parsed = JSON.parse(result.text); } catch { parsed = null; }
    const label = typeof parsed?.label === "string" ? parsed.label.trim() : "";
    if (!labels.includes(label)) {
      // Unparseable / off-vocabulary answer: honest 502, no
      // suggestion stored, no usage recorded (the MS9 rule).
      throw new ApiException("messaging.theAIResponseCouldNotBe", 502);
    }
    await this.recordMessagingAiUsage(organizationId, actorId, provider.name, result.model, result.inputTokens, result.outputTokens, result.tokensEstimated);
    const updated = await hits.update({
      where: { id: hit.id },
      data: { suggestedLabel: label, classifyStatus: "suggested" },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "messaging.keyword_hit_classify",
      entityType: "MessagingKeywordHit", entityId: hit.id, metadata: { suggestedLabel: label },
    });
    return updated;
  }

  /**
   * MX6 — a human decides on an AI suggestion. Confirm stores
   * confirmedLabel; for interest/complaint the confirmed label
   * is ALSO appended as a tag on the conversation (visible to
   * agents, reversible like any tag). For "opt-out" the label
   * is stored ONLY — confirming a suggestion NEVER writes a
   * MessagePreference and NEVER suppresses anyone: suppression
   * happens only through the real STOP path, which is instant
   * and already supreme. Dismiss stores classifyStatus
   * "dismissed" and applies nothing.
   */
  async applyKeywordHitLabel(organizationId: string, actorId: string, hitId: string, decision: string) {
    const { hits } = this.requireKeywordTables();
    if (!["confirm", "dismiss"].includes(decision)) {
      throw badRequest("messaging.decisionMustBeConfirmOrDismiss");
    }
    const hit = await hits.findFirst({ where: { id: hitId, organizationId } });
    if (!hit) throw notFound("messaging.keywordHitNotFound");
    if (hit.classifyStatus !== "suggested" || !hit.suggestedLabel) {
      throw badRequest("messaging.thereIsNoPendingAISuggestion");
    }
    if (decision === "dismiss") {
      const updated = await hits.update({ where: { id: hit.id }, data: { classifyStatus: "dismissed" } });
      await this.audit.log({
        organizationId, userId: actorId, action: "messaging.keyword_hit_label_dismiss",
        entityType: "MessagingKeywordHit", entityId: hit.id, metadata: { suggestedLabel: hit.suggestedLabel },
      });
      return updated;
    }
    const label = String(hit.suggestedLabel);
    let conversationTagged = false;
    if (label === "interest" || label === "complaint") {
      const outcome = await this.applyKeywordTag(organizationId, { id: hit.conversationId }, "conversation", label).catch(() => null);
      conversationTagged = outcome?.status === "applied" || outcome?.status === "skipped";
    }
    // label === "opt-out" / "other": the label is stored ONLY
    // (see the rule above — never a preference write).
    const updated = await hits.update({
      where: { id: hit.id },
      data: { classifyStatus: "confirmed", confirmedLabel: label },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "messaging.keyword_hit_label_confirm",
      entityType: "MessagingKeywordHit", entityId: hit.id,
      metadata: { confirmedLabel: label, conversationTagged },
    });
    return { ...updated, conversationTagged };
  }

  // ---------- MS8: messaging journey presets ----------

  /** The journey catalogue — MS8 v1 (journey-presets.ts) plus
   * MX5 v2 (journey-presets-v2.ts: multi-template lifecycle
   * presets on the MX4 journey structure). Every preset is
   * audited against the triggers/steps the workflow engine
   * really executes; see those modules for the audits. The
   * `version` marker separates the catalogues; v2 entries carry
   * their full template list instead of a single template. */
  listJourneyPresets() {
    const v1 = JOURNEY_PRESETS.map((p) => ({
      key: p.key, name: p.name, descriptionBn: p.descriptionBn, descriptionEn: p.descriptionEn, flow: p.flow, flowEn: p.flowEn,
      trigger: p.trigger, channel: p.channel, templateName: p.template.name, templateNameEn: p.templateEn.name,
      version: 1 as const, stepsCount: p.steps("template-id").length,
    }));
    const v2 = JOURNEY_PRESETS_V2.map((p) => {
      const dummyIds = Object.fromEntries(p.templates.map((t) => [t.slot, "template-id"]));
      return {
        key: p.key, name: p.name, descriptionBn: p.descriptionBn, descriptionEn: p.descriptionEn, flow: p.flow, flowEn: p.flowEn,
        trigger: p.trigger, version: 2 as const, stepsCount: p.steps(dummyIds).length,
        channels: [...new Set(p.templates.map((t) => t.channel))],
        templates: p.templates.map((t) => ({ slot: t.slot, channel: t.channel, name: t.name })),
        templatesEn: p.templatesEn.map((t) => ({ slot: t.slot, channel: t.channel, name: t.name })),
        exitOnPurchase: p.exitOnPurchase === true,
      };
    });
    return [...v1, ...v2];
  }

  /** MX5 — presets that are deliberately NOT built, with the
   * honest reason (journey-presets-v2.ts carries the audit).
   * The presets endpoint returns these alongside the catalogue
   * so the UI can show them greyed instead of hiding them. */
  listUnavailableJourneyPresets() {
    return UNAVAILABLE_JOURNEY_PRESETS.map((p) => ({ ...p }));
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
    const presetV2 = preset ? undefined : JOURNEY_PRESETS_V2.find((p) => p.key === key);
    if (!preset && !presetV2) throw notFound("messaging.journeyPresetNotFound");
    if (!this.workflowCreator) {
      throw badRequest("messaging.workflowEngineIsNotAvailableIn");
    }
    if (presetV2) return this.installJourneyPresetV2(organizationId, actorId, presetV2, dto);
    // MB4 (D-MB4-8): preset content installs in the org locale.
    const locale = await resolveDocumentLocale(this.prisma as any, organizationId);
    const localized = journeyPresetForLocale(preset!, locale);
    const template = await this.createTemplate(organizationId, actorId, {
      name: localized.template.name, channel: preset!.channel,
      ...(localized.template.subject ? { subject: localized.template.subject } : {}),
      body: localized.template.body,
    });
    const workflow = await this.workflowCreator.create(organizationId, actorId, {
      name: dto?.name?.trim() || preset!.name,
      trigger: preset!.trigger,
      steps: preset!.steps(template.id),
      // MX5: MS8 installs now also carry the MX4 journey meta
      // ({ origin, preset } — no exitOnPurchase key; the v1
      // presets never opted into it). The ms8-bridge spec does
      // NOT pin the port-create payload (it asserts trigger /
      // enabled / steps / template only), so this is additive:
      // name, trigger, conditions (none) and steps are exactly
      // as before, and the installed workflows become visible
      // in the MX4 Journeys list with per-step stats.
      journey: { origin: "messaging", preset: key },
    });
    const disabled = await this.workflowCreator.update(organizationId, workflow.id, { enabled: false }, actorId);
    await this.audit.log({
      organizationId, userId: actorId, action: "messaging.journey_preset_install",
      entityType: "Workflow", entityId: workflow.id,
      metadata: { preset: key, templateId: template.id },
    });
    return { preset: key, workflow: disabled, template, enabled: false };
  }

  /**
   * MX5 — install a v2 preset through the SAME discipline as
   * MS8, extended for multiple templates:
   *  1. EVERY template slot becomes a REAL MessageTemplate row
   *     via createTemplate (editable afterwards);
   *  2. ONE Workflow is created through the registered port
   *     (the engine's validator included) with the preset's
   *     steps built from the created template ids, its journey
   *     conditions (win_back's inactiveDays) when it has any,
   *     and MX4 journey meta { origin: "messaging", preset,
   *     exitOnPurchase };
   *  3. the workflow is set enabled: false — a human reviews
   *     before it can act.
   * The response keeps the MS8 shape ({ preset, workflow,
   * template, enabled }) with `template` = the first created
   * template, extended with the full `templates` list.
   */
  private async installJourneyPresetV2(
    organizationId: string, actorId: string,
    preset: (typeof JOURNEY_PRESETS_V2)[number], dto?: { name?: string },
  ) {
    const creator = this.workflowCreator!;
    const templates: any[] = [];
    const ids: Record<string, string> = {};
    // MB4 (D-MB4-8): preset content installs in the org locale.
    const locale = await resolveDocumentLocale(this.prisma as any, organizationId);
    const localizedTemplates = journeyPresetV2ForLocale(preset, locale).templates;
    for (const t of localizedTemplates) {
      const row = await this.createTemplate(organizationId, actorId, {
        name: t.name, channel: t.channel,
        ...(t.subject ? { subject: t.subject } : {}),
        body: t.body,
      });
      templates.push(row);
      ids[t.slot] = row.id;
    }
    const workflow = await creator.create(organizationId, actorId, {
      name: dto?.name?.trim() || preset.name,
      trigger: preset.trigger,
      ...(preset.journeyConditions ? { conditions: preset.journeyConditions } : {}),
      steps: preset.steps(ids),
      journey: { origin: "messaging", preset: preset.key, exitOnPurchase: preset.exitOnPurchase === true },
    });
    const disabled = await creator.update(organizationId, workflow.id, { enabled: false }, actorId);
    await this.audit.log({
      organizationId, userId: actorId, action: "messaging.journey_preset_install",
      entityType: "Workflow", entityId: workflow.id,
      metadata: { preset: preset.key, version: 2, templateIds: templates.map((t) => t.id) },
    });
    return { preset: preset.key, workflow: disabled, template: templates[0], templates, enabled: false };
  }

  // ---------- MX4: messaging journeys (visual builder) ----------
  // A journey IS a Workflow (Workflow.journey non-null) — the
  // definitions created here are executed by the Workflows
  // engine itself; there is no second engine. Messaging NEVER
  // writes the Workflow table directly: every read/write goes
  // through the registered MS8 port (the engine's own create /
  // update / list / listRuns, validator included), exactly like
  // installJourneyPreset. Per-step stats are the one exception
  // to "reads via the port": they aggregate WorkflowRun /
  // MessageDelivery / MessageLinkClick rows directly, because
  // the port has no aggregation surface and inventing one in
  // the engine for a read-only report would be a bigger change.

  /** The registered engine, or the honest refusal every
   * journey endpoint shares (installJourneyPreset precedent). */
  private requireWorkflowCreator(): WorkflowCreatorPort {
    if (!this.workflowCreator) {
      throw badRequest("messaging.workflowEngineIsNotAvailableIn");
    }
    return this.workflowCreator;
  }

  /** MX4: the builder's vocabulary — journey-usable triggers,
   * condition fields and step types (the constants above carry
   * the audit for each list). */
  getJourneyMeta() {
    return { triggers: JOURNEY_TRIGGERS, conditionFields: JOURNEY_CONDITION_FIELDS, stepTypes: JOURNEY_STEP_TYPES };
  }

  /** MX4: messaging-side step validation. It MIRRORS the
   * engine's rules for the journey subset (allowlist, wait
   * range, condition/branch shape, arm rules) so the API
   * refuses what the engine would refuse — and the engine
   * re-validates on create/update anyway. Send-step template
   * CHANNEL is checked here (the engine checks template
   * existence in its validator and channel match only at run
   * time; a journey authored against the wrong channel should
   * fail at save, not at 2am in a run). */
  private async validateJourneySteps(organizationId: string, steps: unknown, inArm = false): Promise<void> {
    if (!Array.isArray(steps)) throw badRequest("messaging.journeyStepsMustBeAnArray");
    if (!inArm && steps.length === 0) throw badRequest("messaging.aJourneyNeedsAtLeastOne");
    const allowed = inArm ? JOURNEY_ARM_STEP_TYPES : JOURNEY_STEP_TYPES.map((t) => t.type);
    for (const step of steps as any[]) {
      if (!step || typeof step !== "object") throw badRequest("messaging.eachJourneyStepMustBeAn");
      if (!allowed.includes(step.type)) {
        throw new BadRequestException(inArm
          ? `Branch arms in a journey may only contain send_email, send_sms or add_tag steps — got ${String(step.type)}`
          : `Journey steps may only use ${JOURNEY_STEP_TYPES.map((t) => t.type).join(", ")} — got ${String(step.type)}`);
      }
      if (step.type === "send_email" || step.type === "send_sms") {
        if (!step.templateId) throw badRequest("messaging.typeStepsNeedATemplateId", { type: step.type });
        const template = await this.getTemplate(organizationId, step.templateId);
        const want = step.type === "send_email" ? "email" : "sms";
        if (template.channel !== want) {
          throw badRequest("messaging.templateChannelChannelDoesNotMatch", { channel: template.channel, want: want });
        }
      }
      if (step.type === "wait" && (!Number(step.minutes) || Number(step.minutes) < 1 || Number(step.minutes) > 43200)) {
        throw badRequest("messaging.waitStepsNeedMinutesBetween1");
      }
      if ((step.type === "condition" || step.type === "branch") && (!step.field || !step.op)) {
        throw badRequest("messaging.typeStepsNeedAFieldAnd", { type: step.type });
      }
      if (step.type === "add_tag") {
        if (!step.tag) throw badRequest("messaging.addTagStepsNeedATag");
        if (step.target !== undefined && !["lead", "conversation"].includes(step.target)) {
          throw badRequest("messaging.addTagStepsNeedATarget");
        }
      }
      if (step.type === "branch") {
        const thenSteps = Array.isArray(step.then) ? step.then : [];
        const elseSteps = Array.isArray(step.else) ? step.else : [];
        if (thenSteps.length + elseSteps.length === 0) {
          throw badRequest("messaging.branchStepsNeedAtLeastOne");
        }
        await this.validateJourneySteps(organizationId, thenSteps, true);
        await this.validateJourneySteps(organizationId, elseSteps, true);
      }
    }
  }

  /** MX4: journey-level conditions are the engine's flat
   * {field, op, value} list — shape-checked only; the engine
   * evaluates them, and an unknown field simply never matches
   * (evaluateConditions semantics), never a fabricated pass. */
  private validateJourneyConditions(conditions: unknown): void {
    if (conditions === undefined || conditions === null) return;
    if (!Array.isArray(conditions)) throw badRequest("messaging.conditionsMustBeAnArrayOf");
    for (const c of conditions as any[]) {
      if (!c || typeof c !== "object" || !c.field || !c.op) {
        throw badRequest("messaging.eachConditionNeedsAFieldAnd");
      }
    }
  }

  private static runSummary(runs: any[]): { total: number; waiting: number; completed: number; failed: number; skipped: number } {
    const count = (s: string) => runs.filter((r) => r.status === s).length;
    return {
      total: runs.length,
      waiting: count("waiting") + count("resuming"),
      completed: count("completed"), failed: count("failed"), skipped: count("skipped"),
    };
  }

  private journeyView(w: any) {
    return {
      id: w.id, name: w.name, trigger: w.trigger,
      conditions: w.conditions ?? null, steps: Array.isArray(w.steps) ? w.steps : [],
      enabled: w.enabled, journey: w.journey ?? null,
      createdAt: w.createdAt ?? null, updatedAt: w.updatedAt ?? null,
    };
  }

  /** List this org's journeys (workflows with journey != null),
   * each with a run summary. Reads go through the port. */
  async listJourneys(organizationId: string) {
    const creator = this.requireWorkflowCreator();
    if (typeof creator.list !== "function") {
      throw badRequest("messaging.workflowEngineIsNotAvailableIn");
    }
    const all = await creator.list(organizationId);
    const journeys = (Array.isArray(all) ? all : []).filter((w: any) => w.journey != null);
    const out: any[] = [];
    for (const w of journeys) {
      const runs = typeof creator.listRuns === "function"
        ? await creator.listRuns(organizationId, { workflowId: w.id, take: 200 }).catch(() => [])
        : [];
      out.push({ ...this.journeyView(w), runSummary: MessagingService.runSummary(Array.isArray(runs) ? runs : []) });
    }
    return out;
  }

  /** Find one journey of this org through the port — a
   * workflow that is missing, foreign, or not a journey is a
   * 404 (never a leak of which case it was). */
  private async findJourneyOrThrow(organizationId: string, workflowId: string) {
    const creator = this.requireWorkflowCreator();
    if (typeof creator.list !== "function") {
      throw badRequest("messaging.workflowEngineIsNotAvailableIn");
    }
    const all = await creator.list(organizationId);
    const workflow = (Array.isArray(all) ? all : []).find((w: any) => w.id === workflowId);
    if (!workflow || workflow.journey == null) throw notFound("messaging.journeyNotFound");
    return { creator, workflow };
  }

  /**
   * Create a journey: validated messaging-side, created
   * through the REAL engine (its validator runs too), then set
   * enabled:false — the preset discipline: a human reviews
   * before it can act. The journey meta rides the create, so
   * the row is a journey from its first moment.
   */
  async createJourney(organizationId: string, actorId: string, dto: {
    name: string; trigger: string; conditions?: unknown; steps: any[]; exitOnPurchase?: boolean;
  }) {
    const creator = this.requireWorkflowCreator();
    if (typeof creator.create !== "function" || typeof creator.update !== "function") {
      throw badRequest("messaging.workflowEngineIsNotAvailableIn");
    }
    const name = String(dto.name ?? "").trim();
    if (!name) throw badRequest("messaging.aJourneyNeedsAName");
    if (!JOURNEY_TRIGGERS.some((t) => t.trigger === dto.trigger)) {
      throw badRequest("messaging.triggerTriggerCannotStartAMessaging", { trigger: String(dto.trigger) });
    }
    this.validateJourneyConditions(dto.conditions);
    await this.validateJourneySteps(organizationId, dto.steps);
    const journey = { origin: "messaging", exitOnPurchase: dto.exitOnPurchase === true };
    const workflow = await creator.create(organizationId, actorId, {
      name, trigger: dto.trigger, conditions: dto.conditions ?? undefined, steps: dto.steps, journey,
    });
    const disabled = await creator.update(organizationId, workflow.id, { enabled: false }, actorId);
    await this.audit.log({
      organizationId, userId: actorId, action: "messaging.journey_create",
      entityType: "Workflow", entityId: workflow.id,
      metadata: { trigger: dto.trigger, steps: Array.isArray(dto.steps) ? dto.steps.length : 0, exitOnPurchase: journey.exitOnPurchase },
    });
    return {
      workflow: disabled, enabled: false,
      note: "Journey তৈরি হয়েছে কিন্তু বন্ধ (disabled) অবস্থায় আছে — পর্যালোচনা করে Enable না করলে এটি চলবে না।",
    };
  }

  /**
   * MX4 — per-step stats for one journey, computed from the
   * real rows. Exact semantics (also in the acceptance doc):
   *  - entered/ok/skipped/failed count stepsLog ENTRIES whose
   *    idx equals the step's top-level index, across all of
   *    this workflow's runs (read capped at 1000 runs). A
   *    branch step's idx covers its own log line PLUS its arm
   *    sub-steps' lines (they carry the same idx, with ref).
   *  - waitingHere (wait steps only; null elsewhere): runs
   *    currently waiting whose nextStepIndex - 1 === idx and
   *    whose frozen position is this wait step.
   *  - delivery (send steps, and branch steps via their arm
   *    sub-steps' refs): MessageDelivery rows of this
   *    workflow's runs whose stepRef is String(idx) — or, for
   *    a branch, starts with `${idx}.` — counted by status,
   *    with opened = openedAt non-null among them. Clicks are
   *    NOT attributed per step: MessageLinkClick rows carry
   *    no stepRef, so clicks are reported at journey level
   *    only (totalClicks) — inventing an attribution would be
   *    fabrication.
   *  - legacyRunCount: runs whose stepsLog has entries but
   *    NONE carries a numeric idx (pre-MX4 runs). They count
   *    in the run summary totals only, never in per-step rows.
   */
  private async computeJourneyStats(organizationId: string, workflow: any) {
    const p = this.prisma as any;
    const runs: any[] = await p.workflowRun.findMany({
      where: { organizationId, workflowId: workflow.id }, orderBy: { createdAt: "desc" }, take: 1000,
    }).catch(() => []);
    const runIds = runs.map((r) => r.id);
    const deliveries: any[] = runIds.length
      ? await p.messageDelivery.findMany({ where: { organizationId, workflowRunId: { in: runIds } }, take: 20000 }).catch(() => [])
      : [];
    const clicks: any[] = runIds.length
      ? await p.messageLinkClick.findMany({ where: { organizationId, workflowRunId: { in: runIds } }, take: 20000 }).catch(() => [])
      : [];
    const steps: any[] = Array.isArray(workflow.steps) ? workflow.steps : [];
    const legacyRunCount = runs.filter((r) => {
      const log: any[] = Array.isArray(r.stepsLog) ? r.stepsLog : [];
      return log.length > 0 && !log.some((e: any) => typeof e?.idx === "number");
    }).length;
    const perStep = steps.map((step, idx) => {
      let entered = 0, ok = 0, skipped = 0, failed = 0;
      for (const r of runs) {
        const log: any[] = Array.isArray(r.stepsLog) ? r.stepsLog : [];
        for (const e of log) {
          if (e?.idx !== idx) continue;
          entered++;
          if (e.status === "ok") ok++;
          else if (e.status === "skipped") skipped++;
          else if (e.status === "failed") failed++;
        }
      }
      const waitingHere = step.type === "wait"
        ? runs.filter((r) => (r.status === "waiting" || r.status === "resuming") && (r.nextStepIndex ?? 0) - 1 === idx).length
        : null;
      let delivery: { sent: number; failed: number; skipped: number; opened: number } | null = null;
      if (step.type === "send_email" || step.type === "send_sms" || step.type === "branch") {
        const mine = deliveries.filter((d) => d.stepRef === String(idx)
          || (step.type === "branch" && typeof d.stepRef === "string" && d.stepRef.startsWith(`${idx}.`)));
        delivery = {
          sent: mine.filter((d) => d.status === "sent").length,
          failed: mine.filter((d) => d.status === "failed").length,
          skipped: mine.filter((d) => d.status === "skipped").length,
          opened: mine.filter((d) => d.openedAt).length,
        };
      }
      return { idx, type: step.type, entered, ok, skipped, failed, waitingHere, delivery };
    });
    return {
      perStep, legacyRunCount,
      runSummary: MessagingService.runSummary(runs),
      totalClicks: clicks.length,
    };
  }

  /** One journey + per-step stats + recent runs (port, take 20). */
  async getJourney(organizationId: string, workflowId: string) {
    const { creator, workflow } = await this.findJourneyOrThrow(organizationId, workflowId);
    const recentRuns = typeof creator.listRuns === "function"
      ? await creator.listRuns(organizationId, { workflowId, take: 20 }).catch(() => [])
      : [];
    const stats = await this.computeJourneyStats(organizationId, workflow);
    return {
      workflow: this.journeyView(workflow),
      runSummary: stats.runSummary,
      stepStats: stats.perStep,
      legacyRunCount: stats.legacyRunCount,
      // Journey-level only — see computeJourneyStats for why
      // clicks are never attributed to a step.
      totalClicks: stats.totalClicks,
      recentRuns: Array.isArray(recentRuns) ? recentRuns : [],
    };
  }

  /**
   * Update a journey through the port (the engine re-validates
   * the resulting definition). NOTE — runs already in flight
   * keep their frozen stepsSnapshot (Workflows W1): an edit
   * affects NEW runs only, and the response says so.
   */
  async updateJourney(organizationId: string, actorId: string, workflowId: string, dto: {
    name?: string; trigger?: string; conditions?: unknown; steps?: any[];
    enabled?: boolean; exitOnPurchase?: boolean;
  }) {
    const { creator, workflow } = await this.findJourneyOrThrow(organizationId, workflowId);
    if (typeof creator.update !== "function") {
      throw badRequest("messaging.workflowEngineIsNotAvailableIn");
    }
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) throw badRequest("messaging.aJourneyNeedsAName");
      data.name = name;
    }
    if (dto.trigger !== undefined) {
      if (!JOURNEY_TRIGGERS.some((t) => t.trigger === dto.trigger)) {
        throw badRequest("messaging.triggerTriggerCannotStartAMessaging", { trigger: String(dto.trigger) });
      }
      data.trigger = dto.trigger;
    }
    if (dto.conditions !== undefined) {
      this.validateJourneyConditions(dto.conditions);
      data.conditions = dto.conditions;
    }
    if (dto.steps !== undefined) {
      await this.validateJourneySteps(organizationId, dto.steps);
      data.steps = dto.steps;
    }
    if (dto.enabled !== undefined) {
      if (typeof dto.enabled !== "boolean") throw badRequest("messaging.enabledMustBeABoolean");
      data.enabled = dto.enabled;
    }
    if (dto.exitOnPurchase !== undefined) {
      data.journey = { ...(workflow.journey ?? {}), origin: "messaging", exitOnPurchase: dto.exitOnPurchase === true };
    }
    const updated = await creator.update(organizationId, workflowId, data, actorId);
    await this.audit.log({
      organizationId, userId: actorId, action: "messaging.journey_update",
      entityType: "Workflow", entityId: workflowId,
      metadata: { fields: Object.keys(data) },
    });
    return {
      workflow: updated,
      note: "চলমান (in-flight) রানগুলো তাদের শুরুর সময়ের ধাপ-স্ন্যাপশট (stepsSnapshot) দিয়েই শেষ হবে — এই বদল শুধু নতুন রানে প্রযোজ্য।",
    };
  }
}
