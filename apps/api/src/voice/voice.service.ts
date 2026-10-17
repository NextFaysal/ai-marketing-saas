import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { FraudShieldService } from "../orders/fraud-shield.service";
import { formatMinor } from "@repo/contracts";
import { createAgentNotification } from "../common/agent-notify";
import {
  buildBanglaVoicePrompt,
  CallOutcome,
  CallStatus,
  InitiateVoiceCallDto,
  VoiceCallSettingDto,
} from "./voice.types";

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fraudShield: FraudShieldService,
  ) {}

  /**
   * Load or initialize VoiceCallSetting for an organization
   */
  async getSettings(organizationId: string) {
    let settings = await (this.prisma as any).voiceCallSetting.findUnique({
      where: { organizationId },
    });

    if (!settings) {
      settings = await (this.prisma as any).voiceCallSetting.create({
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

  /**
   * Update organization voice call settings
   */
  async updateSettings(
    organizationId: string,
    actorId: string,
    dto: VoiceCallSettingDto,
  ) {
    const existing = await this.getSettings(organizationId);

    const updated = await (this.prisma as any).voiceCallSetting.update({
      where: { id: existing.id },
      data: {
        ...(dto.enabled !== undefined && { enabled: Boolean(dto.enabled) }),
        ...(dto.autoCallNewCod !== undefined && {
          autoCallNewCod: Boolean(dto.autoCallNewCod),
        }),
        ...(dto.delayMinutes !== undefined && {
          delayMinutes: Math.max(0, Number(dto.delayMinutes)),
        }),
        ...(dto.provider && { provider: dto.provider }),
        ...(dto.twilioAccountSid !== undefined && {
          twilioAccountSid: dto.twilioAccountSid ? dto.twilioAccountSid.trim() : null,
        }),
        ...(dto.twilioAuthToken !== undefined && {
          twilioAuthToken: dto.twilioAuthToken ? dto.twilioAuthToken.trim() : null,
        }),
        ...(dto.twilioCallerId !== undefined && {
          twilioCallerId: dto.twilioCallerId ? dto.twilioCallerId.trim() : null,
        }),
        ...(dto.promptIntro !== undefined && {
          promptIntro: dto.promptIntro ? dto.promptIntro.trim() : null,
        }),
        ...(dto.maxAttempts !== undefined && {
          maxAttempts: Math.max(1, Number(dto.maxAttempts)),
        }),
        ...(dto.retryIntervalMinutes !== undefined && {
          retryIntervalMinutes: Math.max(1, Number(dto.retryIntervalMinutes)),
        }),
        ...(dto.conversationAgentEnabled !== undefined && {
          conversationAgentEnabled: Boolean(dto.conversationAgentEnabled),
        }),
        ...(dto.conversationMode !== undefined && {
          conversationMode: (() => {
            if (!["simulation", "twilio_relay"].includes(String(dto.conversationMode))) {
              throw new BadRequestException(
                "conversationMode শুধু simulation অথবা twilio_relay হতে পারে",
              );
            }
            return String(dto.conversationMode);
          })(),
        }),
        ...(dto.relayWebsocketUrl !== undefined && {
          relayWebsocketUrl: dto.relayWebsocketUrl ? dto.relayWebsocketUrl.trim() : null,
        }),
        ...(dto.conversationLanguage !== undefined && {
          conversationLanguage: dto.conversationLanguage ? dto.conversationLanguage.trim() : "bn-BD",
        }),
        ...(dto.sttProvider !== undefined && {
          sttProvider: dto.sttProvider ? dto.sttProvider.trim().toLowerCase() : "google",
        }),
        ...(dto.ttsProvider !== undefined && {
          ttsProvider: dto.ttsProvider ? dto.ttsProvider.trim().toLowerCase() : "amazon",
        }),
        ...(dto.ttsVoice !== undefined && {
          ttsVoice: dto.ttsVoice ? dto.ttsVoice.trim() : "Polly.Nabanita",
        }),
      },
    });

    await this.audit
      .log({
        organizationId,
        userId: actorId,
        action: "voice.settings_updated",
        entityType: "VoiceCallSetting",
        entityId: updated.id,
        metadata: { provider: updated.provider, enabled: updated.enabled },
      })
      .catch(() => undefined);

    return updated;
  }

  /**
   * Initiate an outbound COD confirmation call
   */
  async initiateCall(
    organizationId: string,
    orderId: string,
    actorId: string,
    dto?: InitiateVoiceCallDto,
  ) {
    const order = await (this.prisma as any).order.findFirst({
      where: { id: orderId, organizationId },
      include: {
        customer: true,
        items: true,
        organization: true,
      },
    });

    if (!order) {
      throw new NotFoundException("অর্ডারটি পাওয়া যায়নি");
    }

    if (!order.isCod) {
      throw new BadRequestException("এটি একটি ক্যাশ অন ডেলিভারি (COD) অর্ডার নয়");
    }

    // Determine target phone number
    const targetPhone =
      dto?.phone?.trim() ||
      order.customer?.phone?.trim() ||
      (order.address?.match(/01\d{9}/)?.[0] ?? null);

    if (!targetPhone) {
      throw new BadRequestException(
        "গ্রাহকের ফোন নম্বর পাওয়া যায়নি — সঠিক মোবাইল নম্বর নিশ্চিত করুন",
      );
    }

    const settings = await this.getSettings(organizationId);
    const provider = dto?.provider || settings.provider || "mock";

    // Build Bengali Speech Prompt
    const customerName = order.customer?.name || null;
    const brandName = order.organization?.brandName || order.organization?.name || "আমাদের শপ";
    
    // Summarize items
    const itemCount = order.items?.length || 0;
    const firstItem = order.items?.[0]?.name;
    const itemsSummary =
      itemCount > 1
        ? `${firstItem} সহ মোট ${itemCount}টি পণ্য`
        : firstItem || "আপনার কাঙ্ক্ষিত পণ্য";

    const totalFormatted = formatMinor(order.totalMinor, order.organization?.currency || "BDT");

    const speechPrompt =
      dto?.customPrompt ||
      buildBanglaVoicePrompt({
        customerName,
        brandName,
        itemsSummary,
        totalFormatted,
        customIntro: settings.promptIntro,
      });

    // Create Call record
    const call = await (this.prisma as any).orderVoiceCall.create({
      data: {
        organizationId,
        orderId,
        phone: targetPhone,
        provider,
        direction: "outbound",
        status: "initiated",
        outcome: "pending",
        speechPrompt,
        metadata: {
          brandName,
          itemsSummary,
          totalMinor: order.totalMinor.toString(),
          initiatedBy: actorId,
        },
      },
    });

    // Dispatch to provider
    if (provider === "twilio") {
      await this.dispatchTwilioCall(call.id, targetPhone, settings);
    } else {
      // Mock provider
      await this.dispatchMockCall(call.id);
    }

    await this.audit
      .log({
        organizationId,
        userId: actorId,
        action: "voice.call_initiated",
        entityType: "OrderVoiceCall",
        entityId: call.id,
        metadata: { orderId, phone: targetPhone, provider },
      })
      .catch(() => undefined);

    return call;
  }

  /**
   * Generates standard TwiML XML for Twilio Voice webhook
   */
  async generateTwiml(callId: string, baseUrl: string): Promise<string> {
    const call = await (this.prisma as any).orderVoiceCall.findUnique({
      where: { id: callId },
    });

    if (!call) {
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="bn-BD">অর্ডার কল পাওয়া যায়নি।</Say></Response>`;
    }

    const actionUrl = `${baseUrl.replace(/\/$/, "")}/voice/webhook/gather/${callId}`;
    const prompt = call.speechPrompt || "আপনার অর্ডারটি নিশ্চিত করতে ১ চাপুন, বাতিল করতে ২ চাপুন।";

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather action="${actionUrl}" method="POST" numDigits="1" timeout="10">
    <Say language="bn-BD" voice="Polly.Nabanita">${prompt}</Say>
  </Gather>
  <Say language="bn-BD" voice="Polly.Nabanita">আমরা কোনো সাড়া পাইনি। ধন্যবাদ।</Say>
</Response>`;
  }

  /**
   * Handle DTMF key pressed by customer (1 = Confirm, 2 = Reject, others = Unreachable)
   */
  async handleGatherResult(callId: string, digitsPressed: string | null | undefined) {
    const call = await (this.prisma as any).orderVoiceCall.findUnique({
      where: { id: callId },
      include: { order: true },
    });

    if (!call) {
      throw new NotFoundException("কলের রেকর্ড পাওয়া যায়নি");
    }

    const digits = String(digitsPressed ?? "").trim();
    let outcome: CallOutcome = "unreachable";
    let twimlResponseText = "আমরা কোনো সাড়া পাইনি। ধন্যবাদ।";

    if (digits === "1") {
      outcome = "confirmed";
      twimlResponseText = "ধন্যবাদ! আপনার অর্ডারটি নিশ্চিত করা হয়েছে। আমরা দ্রুত ডেলিভারির ব্যবস্থা করছি।";
    } else if (digits === "2") {
      outcome = "rejected";
      twimlResponseText = "আপনার অর্ডারটি বাতিলের অনুরোধ গ্রহণ করা হয়েছে। ধন্যবাদ।";
    }

    // Update Call record
    const updatedCall = await (this.prisma as any).orderVoiceCall.update({
      where: { id: callId },
      data: {
        digitsPressed: digits || null,
        outcome,
        status: "completed",
      },
    });

    // Synchronize outcome into Order state using FraudShield COD call record
    if (call.orderId && call.organizationId) {
      try {
        await this.fraudShield.recordCodCall(
          call.organizationId,
          "ai-voice-bot",
          call.orderId,
          outcome,
        );
      } catch (err) {
        this.logger.warn(`Failed to sync COD call outcome to order: ${err instanceof Error ? err.message : err}`);
      }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="bn-BD" voice="Polly.Nabanita">${twimlResponseText}</Say>
</Response>`;

    return { call: updatedCall, outcome, xml };
  }

  /**
   * Handle status updates from Twilio (ringing, in_progress, completed, failed, busy, no_answer)
   */
  async handleStatusCallback(
    callId: string,
    status: string,
    durationSeconds?: number,
    recordingUrl?: string,
  ) {
    const normalizedStatus: CallStatus =
      status === "completed"
        ? "completed"
        : status === "busy"
        ? "busy"
        : status === "no-answer" || status === "no_answer"
        ? "no_answer"
        : status === "failed"
        ? "failed"
        : status === "in-progress" || status === "in_progress"
        ? "in_progress"
        : "ringing";

    const updateData: Record<string, unknown> = {
      status: normalizedStatus,
      durationSeconds: Number(durationSeconds ?? 0),
    };

    if (recordingUrl) {
      updateData.recordingUrl = recordingUrl;
    }

    // If call ended without digit response, mark unreachable
    if (["busy", "no_answer", "failed"].includes(normalizedStatus)) {
      updateData.outcome = "unreachable";
    }

    const updated = await (this.prisma as any).orderVoiceCall.update({
      where: { id: callId },
      data: updateData,
    });

    // NF3 (FB2): no-answer follow-up — a labelled STAFF task only.
    // There is NO automatic WhatsApp send: staff follow up on
    // WhatsApp manually from the inbox (followUpChannel is the
    // label "whatsapp_manual").
    if (["busy", "no_answer", "failed"].includes(normalizedStatus)) {
      try {
        return await this.markFollowUpForDeadCall(updated);
      } catch (err) {
        this.logger.warn(
          `Failed to mark follow-up for dead call ${callId}: ${err instanceof Error ? err.message : err}`,
        );
        return updated;
      }
    }

    return updated;
  }

  /**
   * NF3 (FB2): when a conversation call ends without an outcome,
   * record a pending manual-WhatsApp follow-up on the call and
   * notify the org's OWNER/ADMIN members. No message is sent.
   */
  async markFollowUpForDeadCall(call: any) {
    if (!call) return call;
    if (call.conversationOutcome) return call;
    if (call.followUpStatus !== "none") return call;

    const updated = await (this.prisma as any).orderVoiceCall.update({
      where: { id: call.id },
      data: {
        followUpStatus: "pending",
        followUpChannel: "whatsapp_manual",
      },
    });

    const p = this.prisma as any;
    if (typeof p.membership?.findMany === "function" && call.organizationId) {
      const members = await p.membership.findMany({
        where: {
          organizationId: call.organizationId,
          role: { in: ["OWNER", "ADMIN"] },
          status: "ACTIVE",
        },
      });
      for (const m of members ?? []) {
        try {
          await createAgentNotification(this.prisma, {
            organizationId: call.organizationId,
            userId: m.userId,
            type: "urgent",
            title: "ভয়েস কল ফলো-আপ প্রয়োজন (WhatsApp — ম্যানুয়াল)",
            body: `অর্ডার ${call.orderId}-এর গ্রাহককে ভয়েস কলে পাওয়া যায়নি। অনুগ্রহ করে ইনবক্স থেকে WhatsApp-এ ম্যানুয়ালি ফলো-আপ করুন — কোনো স্বয়ংক্রিয় বার্তা পাঠানো হয়নি।`,
          });
        } catch {
          // Notification failure never undoes the follow-up record.
        }
      }
    }

    return updated;
  }

  /**
   * Mock simulation helper: allows simulating customer pressing 1 or 2 in dev/sandbox
   */
  async simulateCustomerResponse(
    callId: string,
    digitsPressed: "1" | "2" | "none",
  ) {
    const digits = digitsPressed === "none" ? "" : digitsPressed;
    return this.handleGatherResult(callId, digits);
  }

  /**
   * List calls for a specific order
   */
  async getCallsForOrder(organizationId: string, orderId: string) {
    return (this.prisma as any).orderVoiceCall.findMany({
      where: { organizationId, orderId },
      orderBy: { createdAt: "desc" },
    });
  }

  // --- Private Dispatchers ---

  private async dispatchTwilioCall(
    callId: string,
    phone: string,
    settings: any,
  ) {
    if (!settings.twilioAccountSid || !settings.twilioAuthToken || !settings.twilioCallerId) {
      await (this.prisma as any).orderVoiceCall.update({
        where: { id: callId },
        data: {
          status: "failed",
          outcome: "failed",
          errorMessage: "Twilio credentials are not configured in settings",
        },
      });
      return;
    }

    const apiUrl = process.env.API_PUBLIC_URL || process.env.NEXT_PUBLIC_API_URL || "https://api.qosprey.com";
    const twimlUrl = `${apiUrl}/voice/twiml/${callId}`;
    const statusCallbackUrl = `${apiUrl}/voice/webhook/status/${callId}`;

    const params = new URLSearchParams();
    params.append("To", phone.startsWith("+") ? phone : `+88${phone.replace(/^0/, "")}`);
    params.append("From", settings.twilioCallerId);
    params.append("Url", twimlUrl);
    params.append("StatusCallback", statusCallbackUrl);
    params.append("StatusCallbackMethod", "POST");

    try {
      const authHeader = `Basic ${Buffer.from(
        `${settings.twilioAccountSid}:${settings.twilioAuthToken}`,
      ).toString("base64")}`;

      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${settings.twilioAccountSid}/Calls.json`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        },
      );

      const json = (await res.json()) as any;

      if (!res.ok) {
        await (this.prisma as any).orderVoiceCall.update({
          where: { id: callId },
          data: {
            status: "failed",
            outcome: "failed",
            errorMessage: json.message || "Twilio outbound call rejected",
          },
        });
        return;
      }

      await (this.prisma as any).orderVoiceCall.update({
        where: { id: callId },
        data: {
          callSid: json.sid,
          status: "ringing",
        },
      });
    } catch (err) {
      await (this.prisma as any).orderVoiceCall.update({
        where: { id: callId },
        data: {
          status: "failed",
          outcome: "failed",
          errorMessage: err instanceof Error ? err.message : "Unknown error dispatching call",
        },
      });
    }
  }

  private async dispatchMockCall(callId: string) {
    await (this.prisma as any).orderVoiceCall.update({
      where: { id: callId },
      data: {
        callSid: `mock_${callId.slice(0, 12)}`,
        status: "in_progress",
      },
    });
  }
}
