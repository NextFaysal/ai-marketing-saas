import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { FraudShieldService } from "../orders/fraud-shield.service";
import { OrdersService } from "../orders/orders.service";
import { OrgBrainService } from "../ai/org-brain.service";
import { VoiceService } from "./voice.service";
import { killSwitches } from "../common/platform-settings";
import { createAgentNotification } from "../common/agent-notify";
import { formatMinor } from "@repo/contracts";
import {
  buildGreeting,
  step,
  type ConversationState,
} from "./voice-conversation.engine";
import {
  SimulationConversationProvider,
  TwilioRelayConversationProvider,
  type ConversationMode,
  type RelayInboundMessage,
  type RelayTextMessage,
  type VoiceConversationFacts,
} from "./voice-conversation.types";

const AGENT_ACTOR = "ai-voice-agent";

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function providerLabel(raw: unknown): string {
  const v = String(raw ?? "").toLowerCase();
  if (v === "google") return "Google";
  if (v === "amazon") return "Amazon";
  if (v === "elevenlabs") return "ElevenLabs";
  if (v === "deepgram") return "Deepgram";
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : "Google";
}

/**
 * NF3 (FB2): conversational voice agent service.
 *
 * Honesty rules (FB1 conventions): every response carries the
 * labelled mode ("simulation" | "twilio_relay"); the simulation
 * path never claims telephony/STT/TTS happened; terminal actions
 * run ONLY through existing service paths and are recorded only
 * after the result is verified; agent lines are engine templates
 * filled from the real order + OrgBrain PUBLIC facts only
 * (brain.facts / brain.deliveryFacts — internalProfile and
 * internal documents are never read here).
 */
@Injectable()
export class VoiceConversationService {
  private readonly logger = new Logger(VoiceConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fraudShield: FraudShieldService,
    private readonly orders: OrdersService,
    @Optional() private readonly orgBrain?: OrgBrainService,
    @Optional() private readonly voiceService?: VoiceService,
  ) {}

  // --- settings (same load-or-create discipline as VoiceService) ---
  private async getSettings(organizationId: string) {
    const p = this.prisma as any;
    let settings = await p.voiceCallSetting.findUnique({
      where: { organizationId },
    });
    if (!settings) {
      settings = await p.voiceCallSetting.create({
        data: {
          organizationId,
          enabled: false,
          autoCallNewCod: false,
          delayMinutes: 2,
          provider: "mock",
          maxAttempts: 3,
          retryIntervalMinutes: 15,
        },
      });
    }
    return settings;
  }

  private modeOf(settingsOrCall: any): ConversationMode {
    const raw =
      settingsOrCall?.conversationMode ?? settingsOrCall?.provider ?? "simulation";
    return raw === "twilio_relay" ? "twilio_relay" : "simulation";
  }

  private async loadCall(organizationId: string, callId: string) {
    const p = this.prisma as any;
    let call: any = null;
    if (typeof p.orderVoiceCall?.findFirst === "function") {
      call = await p.orderVoiceCall.findFirst({
        where: { id: callId, organizationId },
      });
    } else if (typeof p.orderVoiceCall?.findUnique === "function") {
      const found = await p.orderVoiceCall.findUnique({ where: { id: callId } });
      if (found && found.organizationId === organizationId) call = found;
    }
    if (!call) throw new NotFoundException("কলের রেকর্ড পাওয়া যায়নি");
    return call;
  }

  private async listTurns(organizationId: string, callId: string) {
    const p = this.prisma as any;
    if (typeof p.voiceConversationTurn?.findMany !== "function") return [];
    return p.voiceConversationTurn.findMany({
      where: { organizationId, callId },
      orderBy: { seq: "asc" },
    });
  }

  private async persistTurn(
    organizationId: string,
    callId: string,
    seq: number,
    role: string,
    text: string,
    intent?: string | null,
    confidence?: number | null,
  ) {
    const p = this.prisma as any;
    if (typeof p.voiceConversationTurn?.create !== "function") return null;
    return p.voiceConversationTurn.create({
      data: {
        organizationId,
        callId,
        seq,
        role,
        text,
        intent: intent ?? null,
        confidence: confidence ?? null,
      },
    });
  }

  private async buildFacts(organizationId: string, order: any): Promise<VoiceConversationFacts> {
    let deliveryFactLines: string[] = [];
    if (this.orgBrain) {
      try {
        const brain: any = await this.orgBrain.getContext(organizationId, {
          audience: "customer",
        });
        // L3: ONLY the public fact lines are read. internalProfile,
        // documents and knowledgeMatches are never touched here.
        if (Array.isArray(brain?.deliveryFacts) && brain.deliveryFacts.length) {
          deliveryFactLines = brain.deliveryFacts.map(String);
        } else if (Array.isArray(brain?.facts)) {
          deliveryFactLines = brain.facts.map(String);
        }
      } catch {
        deliveryFactLines = [];
      }
    }
    const customerName =
      order.customer?.name ||
      [order.customer?.firstName, order.customer?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      null;
    const brandName =
      order.organization?.brandName || order.organization?.name || "আমাদের শপ";
    const itemCount = order.items?.length || 0;
    const firstItem = order.items?.[0]?.name;
    const itemsSummary =
      itemCount > 1
        ? `${firstItem} সহ মোট ${itemCount}টি পণ্য`
        : firstItem || "আপনার কাঙ্ক্ষিত পণ্য";
    const totalFormatted = formatMinor(
      order.totalMinor,
      order.organization?.currency || "BDT",
    );
    const address =
      typeof order.address === "string" ? order.address : order.address ? String(order.address) : null;
    return {
      customerName,
      brandName,
      itemsSummary,
      totalFormatted,
      address,
      deliveryFactLines,
    };
  }

  private async loadOrder(organizationId: string, orderId: string) {
    const order = await (this.prisma as any).order.findFirst({
      where: { id: orderId, organizationId },
      include: { customer: true, items: true, organization: true },
    });
    if (!order) throw new NotFoundException("অর্ডারটি পাওয়া যায়নি");
    return order;
  }

  private async notifyStaff(
    organizationId: string,
    title: string,
    body: string,
  ): Promise<void> {
    const p = this.prisma as any;
    if (typeof p.membership?.findMany !== "function") return;
    const members = await p.membership.findMany({
      where: {
        organizationId,
        role: { in: ["OWNER", "ADMIN"] },
        status: "ACTIVE",
      },
    });
    for (const m of members ?? []) {
      try {
        await createAgentNotification(this.prisma, {
          organizationId,
          userId: m.userId,
          type: "urgent",
          title,
          body,
        });
      } catch {
        // Notification failure never undoes the conversation action.
      }
    }
  }

  // --- Conversation lifecycle ---

  async startConversation(organizationId: string, orderId: string, actorId: string) {
    const settings = await this.getSettings(organizationId);
    if (!settings.enabled || !settings.conversationAgentEnabled) {
      throw new BadRequestException(
        "ভয়েস কনভারসেশন এজেন্ট চালু নেই — প্রথমে ভয়েস সেটিংসে enabled ও conversationAgentEnabled চালু করুন",
      );
    }
    const ks = await killSwitches(this.prisma as any);
    if (ks.aiDisabledOrgIds.includes(organizationId)) {
      throw new HttpException(
        "AI features are temporarily disabled for this organization by the platform team.",
        403,
      );
    }

    const order = await this.loadOrder(organizationId, orderId);
    if (!order.isCod) {
      throw new BadRequestException("এটি একটি ক্যাশ অন ডেলিভারি (COD) অর্ডার নয়");
    }

    const p = this.prisma as any;
    let attempts = 0;
    if (typeof p.orderVoiceCall?.count === "function") {
      attempts = await p.orderVoiceCall.count({
        where: { organizationId, orderId },
      });
    } else if (typeof p.orderVoiceCall?.findMany === "function") {
      const rows = await p.orderVoiceCall.findMany({
        where: { organizationId, orderId },
      });
      attempts = rows?.length ?? 0;
    }
    const maxAttempts = Number(settings.maxAttempts ?? 3);
    if (attempts >= maxAttempts) {
      throw new BadRequestException(
        `এই অর্ডারের জন্য সর্বোচ্চ ${maxAttempts} বার কল চেষ্টা করা হয়েছে — আর কল করা যাবে না`,
      );
    }

    const targetPhone =
      order.customer?.phone?.trim() ||
      (typeof order.address === "string"
        ? order.address.match(/01\d{9}/)?.[0] ?? null
        : null);
    if (!targetPhone) {
      throw new BadRequestException(
        "গ্রাহকের ফোন নম্বর পাওয়া যায়নি — সঠিক মোবাইল নম্বর নিশ্চিত করুন",
      );
    }

    const facts = await this.buildFacts(organizationId, order);
    const greeting = buildGreeting(facts);
    const mode = this.modeOf(settings);
    const provider =
      mode === "twilio_relay"
        ? new TwilioRelayConversationProvider()
        : new SimulationConversationProvider();

    const call = await p.orderVoiceCall.create({
      data: {
        organizationId,
        orderId,
        phone: targetPhone,
        provider: mode,
        direction: "outbound",
        status: "in_progress",
        outcome: "pending",
        speechPrompt: greeting,
        conversationOutcome: null,
        followUpStatus: "none",
        metadata: {
          conversationState: "awaiting_decision",
          unknownCount: 0,
          mode,
          initiatedBy: actorId,
        },
      },
    });

    const started = await provider.startConversation({
      organizationId,
      orderId,
      callId: call.id,
      greeting,
    });
    await this.persistTurn(organizationId, call.id, 0, "agent", started.agentLine);
    await this.audit
      ?.log({
        organizationId,
        userId: actorId,
        action: "voice.conversation_started",
        entityType: "OrderVoiceCall",
        entityId: call.id,
        metadata: { orderId, mode },
      })
      .catch(() => undefined);

    return { call, mode, agentLine: started.agentLine };
  }

  async getConversation(organizationId: string, callId: string) {
    const call = await this.loadCall(organizationId, callId);
    const turns = await this.listTurns(organizationId, callId);
    return { call, turns, mode: this.modeOf(call) };
  }

  async handleCustomerTurn(
    organizationId: string,
    callId: string,
    actorId: string,
    text: string,
  ) {
    const call = await this.loadCall(organizationId, callId);
    const mode = this.modeOf(call);

    // Exactly-once guard: a completed call never re-acts.
    if (call.actionAppliedAt || call.status === "completed") {
      const turns = await this.listTurns(organizationId, callId);
      const lastAgent = [...turns].reverse().find((t: any) => t.role === "agent");
      return {
        call,
        mode,
        agentLine: lastAgent?.text ?? call.conversationSummary ?? "",
        state: "done" as ConversationState,
        conversationOutcome: call.conversationOutcome ?? null,
      };
    }

    const order = await this.loadOrder(organizationId, call.orderId);
    const facts = await this.buildFacts(organizationId, order);
    const turnsBefore = await this.listTurns(organizationId, callId);
    const nextSeq =
      turnsBefore.length > 0
        ? Math.max(...turnsBefore.map((t: any) => Number(t.seq ?? 0))) + 1
        : 1;
    const state: ConversationState =
      (call.metadata?.conversationState as ConversationState) || "awaiting_decision";
    const unknownCount = Number(call.metadata?.unknownCount ?? 0);

    const result = step({ state, text, facts, unknownCount });

    await this.persistTurn(
      organizationId,
      callId,
      nextSeq,
      "customer",
      String(text ?? ""),
      result.intent,
      result.confidence,
    );

    let agentLine = result.agentLine;
    let updatedCall = call;

    if (result.action) {
      const exec = await this.executeAction(
        organizationId,
        call,
        result.action,
      ).catch((err) => ({
        ok: false as const,
        outcome: null,
        summary: `কাজটি সম্পন্ন করা যায়নি: ${err instanceof Error ? err.message : String(err)}`,
      }));

      if (exec.ok && exec.outcome) {
        agentLine = result.agentLine;
        updatedCall = await (this.prisma as any).orderVoiceCall.update({
          where: { id: callId },
          data: {
            status: "completed",
            conversationOutcome: exec.outcome,
            conversationSummary: exec.summary,
            actionAppliedAt: new Date(),
            ...(exec.outcome === "confirmed" ? { outcome: "confirmed" } : {}),
            ...(exec.outcome === "cancelled" ? { outcome: "rejected" } : {}),
            metadata: {
              ...(call.metadata ?? {}),
              conversationState: "done",
              unknownCount: 0,
            },
          },
        });
        await this.audit
          ?.log({
            organizationId,
            userId: actorId,
            action: "voice.conversation_action",
            entityType: "OrderVoiceCall",
            entityId: callId,
            metadata: { orderId: call.orderId, outcome: exec.outcome, intent: result.intent },
          })
          .catch(() => undefined);
      } else {
        // Honest failure: no outcome, no action stamp — the call
        // stays open so the action is never claimed as done.
        agentLine =
          "দুঃখিত, এই মুহূর্তে কাজটি সম্পন্ন করা যায়নি। আমাদের কর্মী বিষয়টি দেখবেন।";
        updatedCall = await (this.prisma as any).orderVoiceCall.update({
          where: { id: callId },
          data: {
            conversationSummary: exec.summary,
            metadata: {
              ...(call.metadata ?? {}),
              conversationState: "awaiting_decision",
              unknownCount: 0,
            },
          },
        });
        await this.audit
          ?.log({
            organizationId,
            userId: actorId,
            action: "voice.conversation_action",
            entityType: "OrderVoiceCall",
            entityId: callId,
            metadata: {
              orderId: call.orderId,
              outcome: null,
              intent: result.intent,
              failed: true,
              summary: exec.summary,
            },
          })
          .catch(() => undefined);
      }
      await this.persistTurn(
        organizationId,
        callId,
        nextSeq + 1,
        "agent",
        agentLine,
        result.intent,
        result.confidence,
      );
      return {
        call: updatedCall,
        mode,
        agentLine,
        state: updatedCall.actionAppliedAt ? ("done" as const) : ("awaiting_decision" as const),
        intent: result.intent,
        confidence: result.confidence,
        conversationOutcome: updatedCall.conversationOutcome ?? null,
      };
    }

    // Non-terminal turn: persist agent reply + advance state.
    await this.persistTurn(
      organizationId,
      callId,
      nextSeq + 1,
      "agent",
      agentLine,
      result.intent,
      result.confidence,
    );
    updatedCall = await (this.prisma as any).orderVoiceCall.update({
      where: { id: callId },
      data: {
        metadata: {
          ...(call.metadata ?? {}),
          conversationState: result.nextState,
          unknownCount: result.unknownCount,
        },
      },
    });
    return {
      call: updatedCall,
      mode,
      agentLine,
      state: result.nextState,
      intent: result.intent,
      confidence: result.confidence,
      conversationOutcome: null,
    };
  }

  private async executeAction(
    organizationId: string,
    call: any,
    action: NonNullable<ReturnType<typeof step>["action"]>,
  ): Promise<{ ok: boolean; outcome: string | null; summary: string }> {
    const orderId: string = call.orderId;
    switch (action.type) {
      case "confirm": {
        const res: any = await this.fraudShield.recordCodCall(
          organizationId,
          AGENT_ACTOR,
          orderId,
          "confirmed",
        );
        if (res?.codConfirmationStatus !== "confirmed") {
          return {
            ok: false,
            outcome: null,
            summary: `অর্ডার ${orderId}: নিশ্চিতকরণ যাচাই করা যায়নি (codConfirmationStatus=${res?.codConfirmationStatus ?? "null"})`,
          };
        }
        return {
          ok: true,
          outcome: "confirmed",
          summary: `অর্ডার ${orderId} গ্রাহক ভয়েস কলে নিশ্চিত করেছেন।`,
        };
      }
      case "cancel": {
        await this.fraudShield.recordCodCall(
          organizationId,
          AGENT_ACTOR,
          orderId,
          "rejected",
        );
        const updated: any = await this.orders.updateOrder(
          organizationId,
          AGENT_ACTOR,
          orderId,
          { status: "cancelled" },
        );
        if (updated?.status !== "cancelled") {
          return {
            ok: false,
            outcome: null,
            summary: `অর্ডার ${orderId}: বাতিল যাচাই করা যায়নি (status=${updated?.status ?? "null"})`,
          };
        }
        return {
          ok: true,
          outcome: "cancelled",
          summary: `অর্ডার ${orderId} গ্রাহক ভয়েস কলে বাতিল করেছেন।`,
        };
      }
      case "address": {
        const updated: any = await this.orders.updateOrder(
          organizationId,
          AGENT_ACTOR,
          orderId,
          { address: action.address },
        );
        if (updated && updated.address !== undefined && updated.address !== action.address) {
          return {
            ok: false,
            outcome: null,
            summary: `অর্ডার ${orderId}: নতুন ঠিকানা যাচাই করা যায়নি`,
          };
        }
        return {
          ok: true,
          outcome: "address_changed",
          summary: `অর্ডার ${orderId}: গ্রাহক ভয়েস কলে নতুন ঠিকানা দিয়েছেন — ${action.address}`,
        };
      }
      case "time": {
        const note = `[ভয়েস কল] গ্রাহকের অনুরোধের ডেলিভারি সময়: ${action.timeText}`;
        const updated: any = await this.orders.updateOrder(
          organizationId,
          AGENT_ACTOR,
          orderId,
          { internalNote: note },
        );
        if (
          updated &&
          typeof updated.internalNote === "string" &&
          !updated.internalNote.includes(action.timeText)
        ) {
          return {
            ok: false,
            outcome: null,
            summary: `অর্ডার ${orderId}: ডেলিভারি সময়ের নোট যাচাই করা যায়নি`,
          };
        }
        await this.notifyStaff(
          organizationId,
          "ভয়েস কল: ডেলিভারি সময় পরিবর্তনের অনুরোধ",
          `অর্ডার ${orderId}-এর গ্রাহক ভয়েস কলে ডেলিভারির সময় বদলাতে চেয়েছেন: ${action.timeText}। অর্ডারের অভ্যন্তরীণ নোটে এটি লেখা হয়েছে — অনুগ্রহ করে ব্যবস্থা নিন।`,
        );
        return {
          ok: true,
          outcome: "delivery_time_changed",
          summary: `অর্ডার ${orderId}: গ্রাহক ভয়েস কলে ডেলিভারির সময় বদলাতে চেয়েছেন — ${action.timeText}`,
        };
      }
      case "human": {
        await this.notifyStaff(
          organizationId,
          "ভয়েস কল: গ্রাহক কর্মীর সঙ্গে কথা বলতে চান",
          `অর্ডার ${orderId}-এর গ্রাহক ভয়েস কলে কর্মীর সঙ্গে কথা বলতে চেয়েছেন (${action.reason})। অনুগ্রহ করে গ্রাহককে কল করুন।`,
        );
        return {
          ok: true,
          outcome: "human_handoff",
          summary: `অর্ডার ${orderId}: গ্রাহককে কর্মীর কাছে হস্তান্তর করা হয়েছে (${action.reason})।`,
        };
      }
    }
  }

  // --- Twilio ConversationRelay transport-agnostic adapter ---

  async handleRelayMessage(
    organizationId: string,
    callId: string,
    msg: RelayInboundMessage,
  ): Promise<RelayTextMessage | null> {
    const settings = await this.getSettings(organizationId);
    if (
      settings.conversationMode !== "twilio_relay" ||
      !settings.relayWebsocketUrl
    ) {
      throw new BadRequestException(
        "ConversationRelay কনফিগার করা নেই — conversationMode=twilio_relay ও relayWebsocketUrl সেট করুন (relay not configured)",
      );
    }
    if (!msg || typeof (msg as any).type !== "string") return null;
    switch (msg.type) {
      case "setup": {
        const call = await this.loadCall(organizationId, callId);
        const turns = await this.listTurns(organizationId, callId);
        const greeting =
          turns.find((t: any) => t.role === "agent")?.text ??
          call.speechPrompt ??
          "";
        return { type: "text", token: greeting, last: true };
      }
      case "prompt": {
        if (!msg.last) return null;
        const res = await this.handleCustomerTurn(
          organizationId,
          callId,
          AGENT_ACTOR,
          msg.voicePrompt,
        );
        return { type: "text", token: res.agentLine, last: true };
      }
      case "dtmf": {
        const mapped =
          msg.digit === "1" ? "হ্যাঁ" : msg.digit === "2" ? "বাতিল" : null;
        if (!mapped) return null;
        const res = await this.handleCustomerTurn(
          organizationId,
          callId,
          AGENT_ACTOR,
          mapped,
        );
        return { type: "text", token: res.agentLine, last: true };
      }
      case "interrupt":
      case "error":
        return null;
      default:
        return null;
    }
  }

  async generateConversationTwiml(callId: string, baseUrl: string): Promise<string> {
    const p = this.prisma as any;
    const call =
      typeof p.orderVoiceCall?.findUnique === "function"
        ? await p.orderVoiceCall.findUnique({ where: { id: callId } })
        : null;
    if (!call) {
      if (this.voiceService) return this.voiceService.generateTwiml(callId, baseUrl);
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="bn-BD">অর্ডার কল পাওয়া যায়নি।</Say></Response>`;
    }
    const settings = await this.getSettings(call.organizationId);
    if (
      settings.conversationMode !== "twilio_relay" ||
      !settings.relayWebsocketUrl
    ) {
      // Relay not configured — honest fallback to the existing IVR.
      if (this.voiceService) return this.voiceService.generateTwiml(callId, baseUrl);
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="bn-BD">অর্ডার কল পাওয়া যায়নি।</Say></Response>`;
    }
    const language = settings.conversationLanguage || "bn-BD";
    const url = xmlEscape(String(settings.relayWebsocketUrl));
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response><Connect><ConversationRelay url="${url}" language="${xmlEscape(language)}" transcriptionLanguage="${xmlEscape(language)}" transcriptionProvider="${providerLabel(settings.sttProvider)}" ttsProvider="${providerLabel(settings.ttsProvider)}" voice="${xmlEscape(settings.ttsVoice || "Polly.Nabanita")}"><Parameter name="callId" value="${xmlEscape(callId)}"/></ConversationRelay></Connect></Response>`
    );
  }
}
