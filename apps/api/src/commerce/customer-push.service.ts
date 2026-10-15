import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SyncOutboxService } from "./sync-outbox.service";

/**
 * EC6 — customer push orchestration.
 * A customer is pushed to a store only when the store is in
 * co-manage or full-manage mode; mirror stores are refused with
 * a Bengali explanation (never a silent no-op presented as a push).
 */
@Injectable()
export class CustomerPushService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: SyncOutboxService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async pushToStore(organizationId: string, actorId: string, customerId: string, storeId: string) {
    const customer = await (this.prisma as any).customer.findFirst({ where: { id: customerId, organizationId } });
    if (!customer) throw new NotFoundException("Customer not found in this organization");
    if (customer.mergedIntoId) throw new BadRequestException("মার্জ করা কাস্টমার push করা যাবে না");
    const store = await (this.prisma as any).store.findFirst({ where: { id: storeId, organizationId } });
    if (!store) throw new NotFoundException("Store not found in this organization");
    if (store.syncMode !== "co-manage" && store.syncMode !== "full-manage") {
      throw new BadRequestException("এই স্টোরটি mirror মোডে আছে — কাস্টমার push করতে Store-এর sync mode co-manage বা full-manage করুন");
    }

    let identity: any = null;
    try {
      const table = (this.prisma as any).customerStoreIdentity;
      if (table && typeof table.findFirst === "function") {
        identity = await table.findFirst({ where: { customerId, storeId } });
      }
    } catch {
      identity = null;
    }

    const row = await this.outbox.enqueue({
      organizationId,
      storeId,
      entityType: "customer",
      entityId: customerId,
      operation: "push_customer",
      payload: { customerId, storeId },
      idempotencyKey: `push_customer:${customerId}:${storeId}:${randomUUID()}`,
    });

    try {
      await this.audit?.log({
        organizationId,
        userId: actorId,
        action: "customer.push_to_store",
        entityType: "Customer",
        entityId: customerId,
        metadata: { storeId, hadIdentity: !!identity },
      } as any);
    } catch { /* audit is best-effort for a queued push */ }

    return { enqueued: 1, outboxId: row?.id, storeId, mode: store.syncMode, existingIdentity: !!identity };
  }
}
