import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * GB3 (GC9): checkout-gate refusal log (FraudAttemptLog).
 * log() NEVER throws — a logging failure must never turn a
 * refusal into a 500 or, worse, let a refused checkout through
 * by erroring the gate path. identifierSummary is always a
 * masked summary supplied by the caller (see identifier-utils).
 */
@Injectable()
export class FraudAttemptLogService {
  constructor(private readonly prisma: PrismaService) {}

  private table(): any {
    return (this.prisma as any).fraudAttemptLog;
  }

  async log(
    orgId: string,
    input: { channel: string; kind: string; identifierSummary: string; ruleId?: string | null },
  ): Promise<void> {
    try {
      const table = this.table();
      if (!table?.create) return;
      await table.create({
        data: {
          organizationId: orgId,
          channel: String(input.channel ?? "shop"),
          kind: String(input.kind ?? ""),
          identifierSummary: String(input.identifierSummary ?? ""),
          ruleId: input.ruleId ?? null,
        },
      }).catch(() => undefined);
    } catch {
      /* never throws */
    }
  }

  /** Staff list, newest first, capped at 200. */
  async list(orgId: string, opts: { limit?: number } = {}) {
    try {
      const table = this.table();
      if (!table?.findMany) return [];
      const raw = Number(opts?.limit);
      const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 200) : 50;
      const rows = (await table.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: limit,
      }).catch(() => [])) ?? [];
      return rows;
    } catch {
      return [];
    }
  }
}
