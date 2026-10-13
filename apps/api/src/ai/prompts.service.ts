import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** GV3 (Global Assistant v2, G4): the per-user saved-prompt cap. */
export const SAVED_PROMPT_CAP = 50;

/**
 * Saved prompts for the AI Assistant "/" picker. Per-user by
 * design: every read and write is scoped to organizationId +
 * userId, so a user never sees or touches another user's prompts —
 * not even in the same organization (a foreign id reads as 404,
 * never 403, so existence is not leaked). Org-shared prompts are a
 * separate, policy-gated feature and are not built here.
 */
@Injectable()
export class PromptsService {
  constructor(private readonly prisma: PrismaService) {}

  private p() {
    return this.prisma as any;
  }

  async list(organizationId: string, userId: string) {
    return this.p().aiSavedPrompt.findMany({
      where: { organizationId, userId },
      orderBy: { updatedAt: "desc" },
      take: SAVED_PROMPT_CAP,
    });
  }

  async create(organizationId: string, userId: string, input: { title?: string; body?: string }) {
    const title = (input.title ?? "").trim();
    const body = (input.body ?? "").trim();
    if (!title || !body) throw new BadRequestException("Prompt-এর title ও body দুটোই লাগবে।");
    const count = await this.p().aiSavedPrompt.count({ where: { organizationId, userId } });
    if (count >= SAVED_PROMPT_CAP) {
      throw new BadRequestException(`আপনি সর্বোচ্চ ${SAVED_PROMPT_CAP}টি prompt save করতে পারবেন। নতুন যোগ করতে পুরনো কোনোটি মুছে ফেলুন।`);
    }
    return this.p().aiSavedPrompt.create({
      data: { organizationId, userId, title: title.slice(0, 80), body: body.slice(0, 2000) },
    });
  }

  private async own(organizationId: string, userId: string, id: string) {
    const row = await this.p().aiSavedPrompt.findFirst({ where: { id, organizationId, userId } });
    if (!row) throw new NotFoundException("Prompt not found");
    return row;
  }

  async update(organizationId: string, userId: string, id: string, input: { title?: string; body?: string }) {
    await this.own(organizationId, userId, id);
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new BadRequestException("Prompt-এর title খালি রাখা যাবে না।");
      data.title = title.slice(0, 80);
    }
    if (input.body !== undefined) {
      const body = input.body.trim();
      if (!body) throw new BadRequestException("Prompt-এর body খালি রাখা যাবে না।");
      data.body = body.slice(0, 2000);
    }
    return this.p().aiSavedPrompt.update({ where: { id }, data });
  }

  async remove(organizationId: string, userId: string, id: string) {
    await this.own(organizationId, userId, id);
    await this.p().aiSavedPrompt.delete({ where: { id } });
    return { deleted: true };
  }
}
