import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
export class ConnectMessagingDto {
  @IsString() channel!: string;
  @IsString() accessToken!: string;
  // Optional since Milestone 33: tenants connecting under the
  // operator's platform Meta app omit it; verification then falls
  // back to the platform app secret.
  @IsOptional() @IsString() appSecret?: string;
  @IsString() verifyToken!: string;
  @IsOptional() @IsString() phoneNumberId?: string;
  @IsOptional() @IsString() pageId?: string;
  // MS6: WhatsApp Business Account id (whatsapp connects only;
  // ignored for other channels). Needed for template sync/submit.
  @IsOptional() @IsString() wabaId?: string;
  // CC4: which Meta app this connection belongs to — "platform"
  // (default; the operator's app) or "own" (the tenant's
  // TenantAppConfig app; its saved secret is used when no
  // per-call appSecret is given, and the connect refuses when
  // no own config exists).
  @IsOptional() @IsIn(["platform", "own"]) appSource?: string;
}
/** MS6: set or clear (null/empty) the WABA id on the org's
 * connected WhatsApp integration. */
export class UpdateWhatsAppWabaDto {
  @IsOptional() @IsString() wabaId?: string | null;
}
export class SendMessageDto {
  @IsString() @MaxLength(4096) content!: string;
  // CX11ac: composer-reported attribution (optional; absent =
  // a plain hand-typed send).
  @IsOptional() @IsBoolean() aiAssisted?: boolean;
  @IsOptional() @IsString() @MaxLength(120) quickReplyId?: string;
  // IN6b: quote target — must be a message in the same conversation
  // (the service validates; another thread's id is a 400).
  @IsOptional() @IsString() @MaxLength(120) replyToMessageId?: string;
}
/** IN6d: pin toggle for one message (DB-only feature). */
export class PinMessageDto {
  @IsBoolean() pinned!: boolean;
}
/** IN6c: agent reaction — an emoji, or null to remove ours. Only
 * Messenger/Instagram have a real platform send; the service
 * refuses other channels honestly. */
export class ReactMessageDto {
  @IsOptional() @IsString() @MaxLength(16) emoji?: string | null;
}
export class UpdateConversationDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() assignedUserId?: string | null;
  // CX4: timed assignment (minutes, 5..480 — range enforced in the
  // service with a Bengali message; only valid with assignedUserId).
  @IsOptional() @IsInt() assignForMinutes?: number;
  @IsOptional() @IsBoolean() spamFlag?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsBoolean() autoReplyPaused?: boolean;
  // Unified Inbox U5: pipeline + close outcome.
  @IsOptional() @IsString() pipelineStage?: string;
  @IsOptional() @IsString() outcome?: string | null;
  @IsOptional() @IsString() @MaxLength(300) outcomeReason?: string | null;
}
/** CX5: snooze a conversation — exactly one of minutes / until;
 * the one-of rule and the ranges are enforced in the service with
 * Bengali messages (minutes 5..10080, until a future ISO time). */
export class SnoozeConversationDto {
  @IsOptional() @IsInt() minutes?: number;
  @IsOptional() @IsString() @MaxLength(64) until?: string;
}
export class RefundRequestDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
export class SendDraftDto { @IsOptional() @IsString() @MaxLength(4096) content?: string; }

export class AddNoteDto {
  @IsString() @MaxLength(4000) content!: string;
  // IN10b: opt-in — mask phone/card/transaction-id shaped tokens
  // before the note is stored (the original is never persisted).
  @IsOptional() @IsBoolean() maskSensitive?: boolean;
}
/** IN2: merge two customer records from a conversation (agent-
 * confirmed only; the service ties one side to this thread). */
export class MergeCustomerDto {
  @IsString() sourceCustomerId!: string;
  @IsString() targetCustomerId!: string;
}
export class UnmergeCustomerDto {
  @IsString() sourceCustomerId!: string;
}
export class LinkCustomerDto {
  @IsString() customerId!: string;
}
/** IN10a: block/unblock this conversation's customer (our
 * system-level block only — never a platform block). */
export class BlockConversationDto {
  @IsBoolean() blocked!: boolean;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
export class QuickReplyDto {
  @IsString() @MaxLength(120) title!: string;
  @IsString() @MaxLength(4000) content!: string;
}
export class WhatsAppTemplateDto {
  @IsString() @MaxLength(512) name!: string;
  @IsOptional() @IsString() @MaxLength(10) language?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsString() @MaxLength(2000) bodyText?: string;
}
/** MS6: create + submit a WhatsApp template to Meta for approval.
 * Deep validation (name rule, category, examples, buttons) runs in
 * the service with Bengali errors BEFORE any Meta call; the DTO
 * only shapes the payload. */
export class SubmitWhatsAppTemplateDto {
  @IsString() @MaxLength(512) name!: string;
  @IsOptional() @IsString() @MaxLength(10) language?: string;
  @IsString() @MaxLength(40) category!: string;
  @IsString() @MaxLength(4000) bodyText!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) exampleValues?: string[];
  @IsOptional() @IsIn(["none", "text", "image"]) headerType?: "none" | "text" | "image";
  @IsOptional() @IsString() @MaxLength(2000) headerText?: string;
  @IsOptional() @IsString() @MaxLength(200) headerExample?: string;
  @IsOptional() @IsString() @MaxLength(500) headerHandle?: string;
  @IsOptional() @IsArray() buttons?: { type: "url" | "quick_reply"; text: string; url?: string }[];
}
export class SendTemplateDto {
  @IsString() templateId!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) variables?: string[];
}
export class SendImageDto {
  @IsString() @MaxLength(2000) imageUrl!: string;
  @IsOptional() @IsString() @MaxLength(1024) caption?: string;
}

/** Inbox Next-Gen P1: browser-uploaded media (drag-drop / paste /
 * voice recorder). Base64 in JSON like the M59 logo upload; the
 * decoded cap (2MB in InboxService) keeps the payload inside the
 * 3MB body limit. The declared contentType is never trusted for
 * images/PDF — the service sniffs magic bytes. */
export class SendMediaDto {
  @IsString() @MaxLength(2900000) dataBase64!: string;
  @IsOptional() @IsString() @MaxLength(200) fileName?: string;
  @IsOptional() @IsString() @MaxLength(120) contentType?: string;
  @IsOptional() @IsString() @MaxLength(1024) caption?: string;
}

export class UpdateInboxSettingsDto {
  @IsOptional() @IsString() autoReplyMode?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) confidenceThreshold?: number;
  @IsOptional() @IsObject() perIntent?: Record<string, string>;
  @IsOptional() @IsString() smartAssign?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10080) slaFirstResponseMinutes?: number;
  @IsOptional() @IsBoolean() botEnabled?: boolean;
  @IsOptional() @IsInt() @Min(0) botDeliveryChargeMinor?: number | null;
  @IsOptional() @IsInt() @Min(5) @Max(10080) reassignAfterMinutes?: number | null;
  @IsOptional() @IsString() escalationTeamId?: string | null;
  @IsOptional() @IsObject() perChannelModes?: Record<string, string>;
  @IsOptional() @IsInt() @Min(0) escalationThresholdMinor?: number | null;
  @IsOptional() @IsInt() @Min(7) @Max(3650) retentionDays?: number | null;
  // CX3: wait-before-answering (seconds, 0 = immediate).
  @IsOptional() @IsInt() @Min(0) @Max(600) aiReplyDelaySeconds?: number;
  @IsOptional() @IsObject() aiReplyDelayByChannel?: Record<string, number>;
  // CX12d: channel-wise AI schedule (deep-validated in the service).
  @IsOptional() @IsObject() aiScheduleByChannel?: Record<string, unknown>;
  // CX12b: post-delivery review requests (opt-in + delay hours).
  @IsOptional() @IsBoolean() reviewRequestEnabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(168) reviewRequestDelayHours?: number;
  // CX7: "To Chase" stalled-session nudges (opt-in + bounds,
  // deep-validated again in the service like the review delay).
  @IsOptional() @IsBoolean() chaseEnabled?: boolean;
  @IsOptional() @IsInt() @Min(15) @Max(1440) chaseFirstDelayMinutes?: number;
  @IsOptional() @IsInt() @Min(60) @Max(2880) chaseIntervalMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) chaseMaxAttempts?: number;
  @IsOptional() @IsBoolean() chaseQuietHoursRespect?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(23) chaseQuietStartHour?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) chaseQuietEndHour?: number;
  // Owner CX7 variant fields (his series): max attempts + custom message.
  @IsOptional() @IsInt() @Min(1) @Max(10) maxChaseAttempts?: number;
  @IsOptional() @IsString() @MaxLength(1000) chaseMessage?: string;
  // IN4: layered SLA + escalation chain (deep-validated again in
  // the service: channel vocabulary + per-value ranges).
  @IsOptional() @IsObject() slaByChannel?: Record<string, number>;
  @IsOptional() @IsInt() @Min(1) @Max(10080) slaVipMinutes?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(1440) slaEscalateAfterMinutes?: number;
  @IsOptional() @IsBoolean() slaLeadAlertEnabled?: boolean;
  @IsOptional() @IsBoolean() slaAutoReassignEnabled?: boolean;
}
export class CodConfirmationDto { @IsString() orderId!: string; }

export class CreateChatOrderItemDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() variantId?: string;
  @IsInt() @Min(1) @Max(99) quantity!: number;
}
export class CreateChatOrderDto {
  @IsArray() items!: CreateChatOrderItemDto[];
  @IsOptional() @IsInt() @Min(0) shippingMinor?: number;
  @IsOptional() @IsBoolean() isCod?: boolean;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
}
export class TranslateMessageDto { @IsString() target!: string; }

// Unified Inbox U2: teams + agent state.
export class TeamDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) channels?: string[];
}
/** Milestone 73 (Team T4): the agent's own chat signature. */
export class UpdateSignatureDto {
  @IsOptional() @IsString() @MaxLength(300) signature?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

/** Milestone 74 (Team T5): workload rebalance request. */
export class RebalanceDto {
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class UpdateTeamDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) channels?: string[];
  /** Milestone 71: the team's lead (org member id) or null to clear. */
  @IsOptional() @IsString() @MaxLength(80) leadUserId?: string | null;
}
export class TeamMemberInputDto {
  @IsString() userId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(200) capacity?: number;
}
export class TeamMembersDto {
  @IsArray() members!: TeamMemberInputDto[];
}
export class AgentStateDto {
  @IsString() status!: string;
}
/** Milestone 68 (Team T2): weekly working hours. The windows
 * object is shape-validated in the service (weekday keys with
 * ["HH:MM","HH:MM"] pairs). */
export class AgentScheduleDto {
  @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @IsObject() windows!: Record<string, [string, string][]>;
}

// Unified Inbox U4: channel connects.
export class ConnectTelegramDto {
  @IsString() @MinLength(10) @MaxLength(200) botToken!: string;
}
export class ConnectEmailDto {
  @IsString() @MaxLength(200) imapHost!: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) imapPort?: number;
  @IsString() @MaxLength(200) smtpHost!: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) smtpPort?: number;
  @IsString() @MaxLength(200) user!: string;
  @IsString() @MinLength(1) @MaxLength(400) password!: string;
}

/** Inbox Next-Gen P2: bulk conversation actions. The 25-id cap
 * and the action vocabulary are enforced in the service as well;
 * the DTO only shapes the payload. */
export class BulkConversationsDto {
  @IsArray() @IsString({ each: true }) ids!: string[];
  @IsString() @MaxLength(20) action!: string; // close | assign | tag-add | mark-read
  @IsOptional() @IsString() assignedUserId?: string | null;
  @IsOptional() @IsString() @MaxLength(60) tag?: string;
}

/** Inbox Next-Gen P2: product showcase card send. */
export class SendProductDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() @MaxLength(500) caption?: string;
}

/** Inbox Next-Gen P3: ghost completion — the agent's half-written
 * reply text the model should continue. */
export class GhostDto {
  @IsString() @MaxLength(2000) partial!: string;
}

/** Inbox Next-Gen P3: tone rewrite of the agent's own draft. */
export class ToneRewriteDto {
  @IsString() @MaxLength(2000) text!: string;
  @IsIn(["polite", "professional", "sales"]) tone!: string;
}

/** IN1: saved inbox view — a named filter preset. The `filters`
 * object is deep-validated in the service (whitelist of the list
 * filter keys, per-key type/range checks); the DTO only shapes it. */
export class CreateSavedViewDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsObject() filters!: Record<string, unknown>;
  @IsOptional() @IsBoolean() shared?: boolean;
}
export class UpdateSavedViewDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsObject() filters?: Record<string, unknown>;
  @IsOptional() @IsBoolean() shared?: boolean;
}

/** IN3: an inbox macro — a named step sequence. `steps` is
 * deep-validated in the service (sanitizeMacroSteps, strict: an
 * invalid step is a 400, never silently dropped); the DTO only
 * shapes the payload. */
export class CreateMacroDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsArray() steps!: unknown[];
  @IsOptional() @IsBoolean() shared?: boolean;
}
export class UpdateMacroDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsArray() steps?: unknown[];
  @IsOptional() @IsBoolean() shared?: boolean;
}
export class RunMacroDto {
  @IsString() conversationId!: string;
}

/** IN3c: bulk reply — the same quick reply OR WhatsApp template
 * to up to 25 conversations (caps + the one-of rule are enforced
 * in the service as well). */
export class BulkReplyDto {
  @IsArray() @IsString({ each: true }) ids!: string[];
  @IsOptional() @IsString() @MaxLength(120) quickReplyId?: string;
  @IsOptional() @IsString() @MaxLength(120) templateId?: string;
}
