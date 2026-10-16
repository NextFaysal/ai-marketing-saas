import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * GB3 (GC8): checkout idempotency — one row per (org, key)
 * presented at a public checkout surface. The first successful
 * placement stores its response; a retry with the same key
 * replays that response instead of placing a duplicate order.
 *
 * Discipline: idempotency must NEVER fail a placed order. Every
 * read degrades to "no replay" and every write failure returns
 * the caller's own response (on a unique-violation the stored
 * winner's response wins, because that is the placement that
 * actually happened first).
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  private table(): any {
    return (this.prisma as any)?.idempotencyRecord;
  }

  private async load(orgId: string, key: string): Promise<any | null> {
    const table = this.table();
    if (!table) return null;
    if (typeof table.findFirst === "function") {
      return (await table.findFirst({ where: { organizationId: orgId, key } }).catch(() => null)) ?? null;
    }
    if (typeof table.findUnique === "function") {
      return (
        (await table
          .findUnique({ where: { organizationId_key: { organizationId: orgId, key } } })
          .catch(() => null)) ?? null
      );
    }
    return null;
  }

  /** Stored responseJson for (org, key), or null — any error → null. */
  async findReplay(orgId: string, key: string): Promise<any | null> {
    try {
      if (!orgId || !key) return null;
      const row = await this.load(orgId, key);
      return row?.responseJson ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Record a placement and return the response the caller
   * should return: the passed response on success; on a
   * unique-violation (a concurrent request won the race) the
   * EXISTING row's stored response; on any other error the
   * passed response (the order was placed — idempotency
   * bookkeeping must not fail it).
   */
  async record(
    orgId: string,
    key: string,
    scope: string,
    orderId: string | null,
    response: any,
  ): Promise<any> {
    try {
      const table = this.table();
      if (!table?.create) return response;
      await table.create({
        data: { organizationId: orgId, key, scope, orderId: orderId ?? null, responseJson: response },
      });
      return response;
    } catch (e: any) {
      const code = e?.code ?? "";
      const message = e instanceof Error ? e.message : String(e ?? "");
      if (code === "P2002" || /unique/i.test(message)) {
        try {
          const existing = await this.load(orgId, key);
          if (existing?.responseJson != null) return existing.responseJson;
        } catch {
          /* fall through to the caller's response */
        }
      }
      return response;
    }
  }
}
