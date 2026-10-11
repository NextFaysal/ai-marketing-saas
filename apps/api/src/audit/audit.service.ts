import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}
  async log(input: { organizationId?: string; userId?: string; action: string; entityType: string; entityId?: string; metadata?: Record<string, unknown>; ipAddress?: string }) {
    try {
      await (this.prisma as any).auditLog.create({
        data: {
          organizationId: input.organizationId ?? null,
          // AuditLog.userId is a real FK: the literal "system" used
          // by automated actors is not a user row and made every
          // system audit insert fail (silently) on a real database.
          // System actions record a null actor instead.
          userId: !input.userId || input.userId === "system" ? null : input.userId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          metadata: input.metadata ?? undefined,
          ipAddress: input.ipAddress ?? null,
        },
      });
    } catch (e) {
      this.logger.error(`Audit log failed for action ${input.action}`, e as Error);
    }
  }
}
