import { BadRequestException, Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { TenantGuard } from "../common/tenant.guard";

class FeedbackDto {
  @IsInt() @Min(0) @Max(10) @Type(() => Number) score!: number;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}

/** Tenant feedback / NPS submission (Milestone 41, Admin Phase A5). */
@Controller("organizations/:organizationId/feedback")
@UseGuards(TenantGuard)
export class FeedbackController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async submit(@Req() req: any, @Body() dto: FeedbackDto) {
    const score = Number(dto.score);
    if (!Number.isInteger(score) || score < 0 || score > 10) {
      throw new BadRequestException("score must be an integer between 0 and 10");
    }
    const row = await (this.prisma as any).feedback.create({
      data: {
        organizationId: req.organizationId,
        userId: req.user.userId,
        score,
        comment: dto.comment?.trim() ? dto.comment.trim().slice(0, 2000) : null,
      },
    });
    return { id: row.id, score: row.score, createdAt: row.createdAt, thanks: true };
  }
}
