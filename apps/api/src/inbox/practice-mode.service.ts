import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InboxService } from "./inbox.service";
import { CompletePracticeSessionDto, PracticeMessageDto, StartPracticeSessionDto } from "./practice-mode.dto";
import { badRequest, notFound } from "../i18n/api-exception";

export const DEFAULT_PRACTICE_SCENARIOS = [
  {
    id: "scen-price-inquiry",
    title: "দাম ও ডেলিভারি চার্জ জিজ্ঞাসা",
    description: "গ্রাহক পণ্যের দাম এবং ঢাকার বাইরে ডেলিভারি চার্জ কত তা জানতে চাইছেন।",
    channel: "whatsapp",
    difficulty: "beginner",
    sampleMessages: [
      { role: "customer", text: "ভাইয়া এই প্রোডাক্টটার দাম কত? চিটাগাং ডেলিভারি চার্জ কত?" },
    ],
  },
  {
    id: "scen-order-flow",
    title: "সম্পূর্ণ অর্ডার সম্পন্নকরণ",
    description: "গ্রাহক একটি পণ্য কিনতে চান এবং নাম, ঠিকানা ও ফোন নম্বর দিয়ে ক্যাশ অন ডেলিভারিতে অর্ডার কনফার্ম করতে চান।",
    channel: "messenger",
    difficulty: "intermediate",
    sampleMessages: [
      { role: "customer", text: "আমি ২ পিস নিতে চাই। ক্যাশ অন ডেলিভারি হবে?" },
    ],
  },
  {
    id: "scen-return-policy",
    title: "রিটার্ন ও সাইজ এক্সচেঞ্জ প্রশ্ন",
    description: "গ্রাহক সাইজ সমস্যা হলে বা ডিফেক্ট থাকলে কিভাবে পরিবর্তন করতে পারবেন তা জানতে চান।",
    channel: "webchat",
    difficulty: "intermediate",
    sampleMessages: [
      { role: "customer", text: "যদি সাইজ ঠিক না হয়, রিটার্ন বা এক্সচেঞ্জ করতে পারবো তো?" },
    ],
  },
];

@Injectable()
export class PracticeModeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /**
   * List available practice scenarios. Returns default built-in templates
   * merged with any custom scenarios created in the database.
   */
  async listScenarios() {
    let dbScenarios: any[] = [];
    try {
      dbScenarios = await (this.prisma as any).practiceScenario.findMany({
        orderBy: { createdAt: "desc" },
      });
    } catch {
      dbScenarios = [];
    }

    if (dbScenarios.length > 0) return dbScenarios;
    return DEFAULT_PRACTICE_SCENARIOS;
  }

  /**
   * Start a new practice simulation session for an operator / merchant.
   */
  async startSession(organizationId: string, userId: string, dto: StartPracticeSessionDto) {
    const channel = dto.channel || "whatsapp";
    let initialTranscript: Array<{ role: string; text: string; timestamp: string }> = [];

    let scenario: any = null;
    if (dto.scenarioId) {
      scenario = DEFAULT_PRACTICE_SCENARIOS.find((s) => s.id === dto.scenarioId);
      if (!scenario) {
        scenario = await (this.prisma as any).practiceScenario?.findUnique?.({
          where: { id: dto.scenarioId },
        }).catch(() => null);
      }
    }

    if (scenario && Array.isArray(scenario.sampleMessages)) {
      initialTranscript = scenario.sampleMessages.map((m: any) => ({
        role: m.role || "customer",
        text: m.text,
        timestamp: new Date().toISOString(),
      }));
    }

    const session = await (this.prisma as any).practiceSession.create({
      data: {
        organizationId,
        userId,
        scenarioId: scenario?.id || null,
        channel,
        status: "active",
        transcript: initialTranscript,
      },
    });

    await this.audit?.log?.({
      organizationId,
      userId,
      action: "practice_session.started",
      entityType: "practice_session",
      entityId: session.id,
      metadata: { channel, scenarioId: scenario?.id },
    }).catch(() => undefined);

    return session;
  }

  /**
   * Simulate sending a message inside the practice session.
   * Calls the actual Inbox test compose pipeline so the merchant sees how the AI bot
   * or rule engine answers under the tenant's real knowledge base and instructions,
   * without creating real Customer/ChannelMessage rows.
   */
  async sendMessage(organizationId: string, userId: string, sessionId: string, dto: PracticeMessageDto) {
    const session = await (this.prisma as any).practiceSession.findFirst({
      where: { id: sessionId, organizationId },
    });

    if (!session) throw notFound("inbox.practiceSessionNotFound");
    if (session.status !== "active") throw badRequest("inbox.thisPracticeSessionIsNotActive");

    const userText = dto.message.trim();
    if (!userText) throw badRequest("inbox.theMessageCannotBeEmpty2");

    const history: Array<{ role: string; text: string; timestamp: string }> = Array.isArray(session.transcript)
      ? [...session.transcript]
      : [];

    history.push({
      role: "customer",
      text: userText,
      timestamp: new Date().toISOString(),
    });

    // Run response through the real AI / bot engine
    let botReplyText = "";
    try {
      const response = await this.inbox.testComposeReply(organizationId, userText);
      botReplyText = response?.answer || "";
    } catch (e: any) {
      // In case testComposeReply throws or is restricted
      botReplyText = "ধন্যবাদ আপনার বার্তার জন্য! আমাদের প্রতিনিধি খুব শীঘ্রই যোগাযোগ করবেন।";
    }

    if (!botReplyText) {
      botReplyText = "ধন্যবাদ! আমরা আপনার মেসেজ পেয়েছি।";
    }

    history.push({
      role: "bot",
      text: botReplyText,
      timestamp: new Date().toISOString(),
    });

    const updated = await (this.prisma as any).practiceSession.update({
      where: { id: session.id },
      data: {
        transcript: history,
      },
    });

    return {
      session: updated,
      replyText: botReplyText,
    };
  }

  /**
   * Complete the session with optional score / feedback.
   */
  async completeSession(organizationId: string, userId: string, sessionId: string, dto: CompletePracticeSessionDto) {
    const session = await (this.prisma as any).practiceSession.findFirst({
      where: { id: sessionId, organizationId },
    });

    if (!session) throw notFound("inbox.practiceSessionNotFound");

    const completed = await (this.prisma as any).practiceSession.update({
      where: { id: session.id },
      data: {
        status: "completed",
        score: dto.score ?? 100,
        feedback: dto.feedback || "অনুশীলন সফলভাবে সম্পন্ন হয়েছে।",
        completedAt: new Date(),
      },
    });

    await this.audit?.log?.({
      organizationId,
      userId,
      action: "practice_session.completed",
      entityType: "practice_session",
      entityId: session.id,
      metadata: { score: dto.score },
    }).catch(() => undefined);

    return completed;
  }

  /**
   * Get user's practice history and scores.
   */
  async getSessions(organizationId: string, userId: string) {
    return (this.prisma as any).practiceSession.findMany({
      where: { organizationId, userId },
      orderBy: { startedAt: "desc" },
      take: 20,
    });
  }
}
