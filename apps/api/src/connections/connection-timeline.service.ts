import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * CC13 (Connect Center Advanced) — per-connection activity &
 * error timeline.
 *
 * The timeline aggregates REAL records only — AuditLog rows for
 * the target, its SyncJob history, its WebhookEvent deliveries,
 * CC11 ConnectionHealthCheck runs, and (for payment targets) its
 * TenantPaymentTransaction outcomes. A target with no records
 * gets an empty timeline; nothing is ever synthesized to fill
 * the page. Health-check and alert audit rows are skipped in the
 * audit stream because the health checks themselves are already
 * timeline items (no double-reporting).
 *
 * Pagination is cursor-by-item-id over the merged, sorted list
 * (the source takes are bounded, so the merge stays small):
 * pass back `nextCursor` as `cursor` for the next page.
 */

export interface TimelineItem {
  id: string;
  at: string; // ISO
  kind: "audit" | "sync" | "webhook" | "health_check" | "payment";
  title: string;
  detail: string | null;
  severity: "info" | "warn" | "error";
}

const AUDIT_SKIP_ACTIONS = new Set(["connection.health_check", "connection.alert"]);

@Injectable()
export class ConnectionTimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async getTimeline(
    organizationId: string,
    targetType: string,
    targetId: string,
    opts: { onlyProblems?: boolean; limit?: number; cursor?: string } = {},
  ): Promise<{ items: TimelineItem[]; nextCursor: string | null; webhookStatus: any | null }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const { integrationId, entityIds, paymentWhere } = await this.resolveTarget(organizationId, targetType, targetId);

    const items: TimelineItem[] = [];

    const auditRows = await (this.prisma as any).auditLog.findMany({
      where: { organizationId, entityId: { in: entityIds } },
      orderBy: { createdAt: "desc" }, take: 200,
    }).catch(() => []);
    for (const row of auditRows ?? []) {
      if (AUDIT_SKIP_ACTIONS.has(row.action)) continue;
      const isProblem = /disconnect|fail|error|delete/i.test(String(row.action));
      items.push({
        id: `audit:${row.id}`,
        at: new Date(row.createdAt).toISOString(),
        kind: "audit",
        title: String(row.action),
        detail: row.metadata ? safeDetail(row.metadata) : null,
        severity: isProblem ? "warn" : "info",
      });
    }

    let webhookStatus: any | null = null;
    if (integrationId) {
      const integration = await (this.prisma as any).integration.findFirst({
        where: { id: integrationId, organizationId },
      }).catch(() => null);
      webhookStatus = integration?.webhookStatus ?? null;

      const syncJobs = await (this.prisma as any).syncJob.findMany({
        where: { integrationId }, orderBy: { startedAt: "desc" }, take: 100,
      }).catch(() => []);
      for (const job of syncJobs ?? []) {
        const failed = String(job.status) === "FAILED" || Boolean(job.error);
        items.push({
          id: `sync:${job.id}`,
          at: new Date(job.completedAt ?? job.startedAt).toISOString(),
          kind: "sync",
          title: `Sync (${job.kind}) — ${job.status}`,
          detail: job.error ? String(job.error) : `${job.fetched ?? 0}টি আনা হয়েছে · ${job.created ?? 0} নতুন · ${job.updated ?? 0} হালনাগাদ · ${job.skipped ?? 0} বাদ`,
          severity: failed ? "error" : "info",
        });
      }

      const webhookEvents = await (this.prisma as any).webhookEvent.findMany({
        where: { integrationId }, orderBy: { receivedAt: "desc" }, take: 100,
      }).catch(() => []);
      for (const ev of webhookEvents ?? []) {
        const failed = Boolean(ev.error) || ev.signatureValid === false;
        items.push({
          id: `webhook:${ev.id}`,
          at: new Date(ev.receivedAt).toISOString(),
          kind: "webhook",
          title: `Webhook ${ev.topic ?? ev.provider ?? ""}`.trim(),
          detail: ev.error ? String(ev.error) : ev.signatureValid === false ? "স্বাক্ষর মেলেনি — ইভেন্টটি গ্রহণ করা হয়নি" : "স্বাক্ষর সঠিক ছিল",
          severity: failed ? "error" : "info",
        });
      }
    }

    const checks = await (this.prisma as any).connectionHealthCheck.findMany({
      where: { organizationId, targetType, targetId },
      orderBy: { createdAt: "desc" }, take: 50,
    }).catch(() => []);
    for (const run of checks ?? []) {
      const steps: any[] = Array.isArray(run.steps) ? run.steps : [];
      const counts = {
        pass: steps.filter((s) => s.status === "pass").length,
        fail: steps.filter((s) => s.status === "fail").length,
        na: steps.filter((s) => s.status === "not_checkable").length,
      };
      items.push({
        id: `health:${run.id}`,
        at: new Date(run.createdAt).toISOString(),
        kind: "health_check",
        title: `Connection Doctor পরীক্ষা — ${run.overall}`,
        detail: `পাস ${counts.pass} · ব্যর্থ ${counts.fail} · যাচাই সম্ভব নয় ${counts.na} (${run.trigger === "sweep" ? "স্বয়ংক্রিয়" : "ম্যানুয়াল"})`,
        severity: run.overall === "fail" ? "error" : run.overall === "partial" ? "warn" : "info",
      });
    }

    if (paymentWhere) {
      const txns = await (this.prisma as any).tenantPaymentTransaction.findMany({
        where: paymentWhere, orderBy: { createdAt: "desc" }, take: 100,
      }).catch(() => []);
      for (const txn of txns ?? []) {
        items.push({
          id: `payment:${txn.id}`,
          at: new Date(txn.updatedAt ?? txn.createdAt).toISOString(),
          kind: "payment",
          title: `পেমেন্ট (${txn.provider}) — ${txn.status}`,
          detail: `পরিমাণ: ${txn.amountMinor?.toString?.() ?? txn.amountMinor} ${txn.currency ?? "BDT"} (minor)${txn.valId ? ` · val_id: ${txn.valId}` : ""}${txn.providerTxnId ? ` · txn: ${txn.providerTxnId}` : ""}`,
          severity: txn.status === "failed" ? "error" : txn.status === "cancelled" ? "warn" : "info",
        });
      }
    }

    items.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
    const filtered = opts.onlyProblems ? items.filter((i) => i.severity !== "info") : items;

    let start = 0;
    if (opts.cursor) {
      const idx = filtered.findIndex((i) => i.id === opts.cursor);
      if (idx >= 0) start = idx + 1;
    }
    const page = filtered.slice(start, start + limit);
    const nextCursor = start + limit < filtered.length && page.length ? page[page.length - 1].id : null;
    return { items: page, nextCursor, webhookStatus };
  }

  /** Resolve a Connect Center target to the rows that carry its
   * history: the backing Integration (for sync/webhook streams),
   * the entity ids its audit rows use, and the payment-transaction
   * filter for payment targets. */
  private async resolveTarget(organizationId: string, targetType: string, targetId: string) {
    let integrationId: string | null = null;
    let paymentWhere: any | null = null;
    const entityIds = [targetId];

    switch (targetType) {
      case "integration":
        integrationId = targetId;
        break;
      case "social_account": {
        const row = await (this.prisma as any).socialAccount.findFirst({
          where: { id: targetId, organizationId },
        }).catch(() => null);
        integrationId = row?.integrationId ?? null;
        break;
      }
      case "ad_account": {
        const row = await (this.prisma as any).adAccount.findFirst({
          where: { id: targetId, organizationId },
        }).catch(() => null);
        integrationId = row?.integrationId ?? null;
        break;
      }
      case "store": {
        const row = await (this.prisma as any).integration.findFirst({
          where: { organizationId, storeId: targetId },
        }).catch(() => null);
        integrationId = row?.id ?? null;
        break;
      }
      case "tenant_payment_gateway":
        paymentWhere = { organizationId, gatewayId: targetId };
        break;
      case "platform_payment_enablement": {
        const row = await (this.prisma as any).platformPaymentEnablement.findFirst({
          where: { id: targetId, organizationId },
        }).catch(() => null);
        if (row) paymentWhere = { organizationId, source: "platform", provider: row.provider };
        break;
      }
      default:
        break;
    }
    if (integrationId && integrationId !== targetId) entityIds.push(integrationId);
    return { integrationId, entityIds, paymentWhere };
  }
}

function safeDetail(metadata: any): string | null {
  try {
    const text = JSON.stringify(metadata);
    if (!text || text === "{}") return null;
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  } catch { return null; }
}
