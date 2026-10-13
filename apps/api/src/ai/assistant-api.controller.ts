import { Body, Controller, Headers, HttpException, HttpStatus, Post } from "@nestjs/common";
import { AssistantApiService } from "./assistant-api.service";
import { ChatService } from "./chat.service";
import { PrismaService } from "../prisma/prisma.service";
import { AssistantApiChatDto } from "./ai.dto";

/**
 * AP7 public Assistant API. Authenticated ONLY by an org-scoped
 * API key in the `x-api-key` header (no session/JWT). The key
 * resolves to one organization and its creator; the chat itself is
 * the ordinary ChatService pipeline — kill switch, daily caps,
 * planner/sanitize boundary and usage accounting all apply, and
 * tool RBAC uses the creator's live membership role.
 */
@Controller("assistant-api")
export class AssistantApiController {
  constructor(
    private readonly keys: AssistantApiService,
    private readonly chat: ChatService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("chat")
  async chatOnce(@Headers("x-api-key") apiKey: string | undefined, @Body() dto: AssistantApiChatDto) {
    const auth = await this.keys.authenticate(apiKey);
    if (!auth) throw new HttpException("Invalid or revoked API key", HttpStatus.UNAUTHORIZED);
    const orgId = auth.organizationId;

    // The creator's current role governs restricted tools; a
    // removed member's key stops working for restricted tools and
    // the conversation ownership check stops it entirely.
    const membership = await (this.prisma as any).membership.findFirst({
      where: { organizationId: orgId, userId: auth.userId, status: "ACTIVE" },
    }).catch(() => null);

    let conversationId = dto.conversationId;
    if (!conversationId) {
      const conv = await this.chat.createConversation(orgId, auth.userId, undefined, dto.persona);
      conversationId = conv.id;
    }
    const result: any = await this.chat.sendMessage(
      orgId, auth.userId, conversationId!, dto.content,
      undefined, undefined, undefined, membership?.role,
    );
    return {
      conversationId,
      answer: result.message?.content ?? "",
      messageId: result.message?.id ?? null,
      provider: result.provider,
      isRealLlm: result.isRealLlm,
      proposal: result.proposal ?? null,
    };
  }
}
