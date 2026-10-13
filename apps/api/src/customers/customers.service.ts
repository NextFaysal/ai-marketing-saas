import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RiskService } from "../orders/risk.service";
import { minorToMajor, toCsv } from "../imports/csv";
import { CustomFieldsService, renderCustomFieldValue } from "../crm/custom-fields.service";

const customerName = (c: any) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || null;

/**
 * Customer 360: one record per real person. Lists exclude merged
 * records; detail aggregates orders, conversations and shipments from
 * the real tables; merge moves relationships to the surviving record
 * and keeps the source as a marked, hidden shell (never deleted).
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly risk?: RiskService,
    @Optional() private readonly customFields?: CustomFieldsService,
  ) {}

  async list(organizationId: string, q?: string) {
    return this.rowsWithStats(organizationId, q, 100);
  }

  /** The list computation, shared verbatim by list() (first 100)
   * and the C3 CSV export (the full fetched window of 500). */
  private async rowsWithStats(organizationId: string, q: string | undefined, limit: number) {
    const rows = await (this.prisma as any).customer.findMany({
      where: { organizationId, mergedIntoId: null }, orderBy: { createdAt: "desc" }, take: 500,
    });
    const needle = q?.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((c: any) => [customerName(c), c.phone, c.email].filter(Boolean).some((v: string) => v.toLowerCase().includes(needle)))
      : rows;
    const withStats = await Promise.all(filtered.slice(0, limit).map(async (c: any) => {
      const orders = await (this.prisma as any).order.findMany({
        where: { organizationId, customerId: c.id, status: { not: "cancelled" } }, take: 200,
      });
      return {
        id: c.id, name: customerName(c), firstName: c.firstName, lastName: c.lastName,
        phone: c.phone, email: c.email, source: c.source, createdAt: c.createdAt,
        // CRM C4: carried through so the export can append def columns.
        customFields: c.customFields ?? null,
        orderCount: orders.length,
        totalSpentMinor: String(orders.reduce((s: bigint, o: any) => s + BigInt(o.totalMinor), 0n)),
      };
    }));
    return withStats;
  }

  /**
   * CRM C3: CSV export — strictly the caller's org, same rows and
   * lifetime figures as the list (orders excluding cancelled).
   * `total_spent` is in taka (major units). CRM C4 appends the
   * org's custom-field columns after the core columns.
   */
  async exportCsv(organizationId: string): Promise<string> {
    const rows = await this.rowsWithStats(organizationId, undefined, 500);
    const headers = ["id", "name", "first_name", "last_name", "phone", "email", "source", "order_count", "total_spent", "created_at"];
    const body = rows.map((c: any) => [
      c.id, c.name ?? "", c.firstName ?? "", c.lastName ?? "", c.phone ?? "", c.email ?? "",
      c.source, c.orderCount, minorToMajor(BigInt(c.totalSpentMinor)),
      c.createdAt ? new Date(c.createdAt).toISOString() : "",
    ]);
    // CRM C4: the org's non-archived customer custom fields are
    // appended as extra columns, headered by LABEL, in def order.
    if (this.customFields) {
      const defs = await this.customFields.activeDefs(organizationId, "customer");
      if (defs.length) {
        headers.push(...defs.map((d: any) => d.label));
        body.forEach((row, i) => {
          const cf = (rows[i] as any).customFields ?? {};
          for (const d of defs as any[]) row.push(renderCustomFieldValue(cf[d.key]));
        });
      }
    }
    return toCsv(headers, body);
  }

  /**
   * CRM C4: the customer PATCH that did not exist before — contact
   * basics + custom fields, nothing else. Before C4 customers were
   * write-only-by-sync (orders/inbox/convert created them; the UI
   * could only merge). Custom-field values go through the same
   * validation gate as leads; required is NOT enforced here
   * (partial updates; customers are born from sync, not forms).
   * Audited as "customer.updated" with the changed field names.
   */
  async update(organizationId: string, actorId: string, customerId: string, dto: {
    firstName?: string | null; lastName?: string | null;
    email?: string | null; phone?: string | null;
    customFields?: Record<string, unknown> | null;
  }) {
    const customer = await (this.prisma as any).customer.findFirst({ where: { id: customerId, organizationId } });
    if (!customer) throw new NotFoundException("Customer not found in this organization");
    const data: Record<string, unknown> = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName?.trim() || null;
    if (dto.lastName !== undefined) data.lastName = dto.lastName?.trim() || null;
    if (dto.email !== undefined) data.email = dto.email?.trim().toLowerCase() || null;
    if (dto.phone !== undefined) data.phone = dto.phone?.trim() || null;
    if (dto.customFields !== undefined) {
      if (dto.customFields === null) data.customFields = null;
      else if (this.customFields) {
        const sanitized = await this.customFields.validateAndSanitize(organizationId, "customer", dto.customFields, { forCreate: false });
        data.customFields = this.customFields.mergeValues(customer.customFields ?? null, sanitized);
      } else if (Object.keys(dto.customFields).length) {
        throw new BadRequestException("Custom fields are not available in this deployment");
      }
    }
    if (!Object.keys(data).length) return this.detail(organizationId, customerId);
    await (this.prisma as any).customer.update({ where: { id: customerId }, data });
    await this.audit.log({
      organizationId, userId: actorId, action: "customer.updated", entityType: "Customer", entityId: customerId,
      metadata: { fields: Object.keys(data) },
    });
    return this.detail(organizationId, customerId);
  }

  async detail(organizationId: string, customerId: string) {
    const customer = await (this.prisma as any).customer.findFirst({ where: { id: customerId, organizationId } });
    if (!customer) throw new NotFoundException("Customer not found in this organization");
    const orders = await (this.prisma as any).order.findMany({
      where: { organizationId, customerId }, orderBy: { createdAt: "desc" }, take: 50,
    });
    const conversations = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, customerId }, orderBy: { lastMessageAt: "desc" }, take: 20,
    }).catch(() => []);
    const shipments = orders.length ? await (this.prisma as any).courierShipment.findMany({
      where: { organizationId, orderId: { in: orders.map((o: any) => o.id) } }, take: 20,
    }).catch(() => []) : [];
    const lead = customer.id ? await (this.prisma as any).lead.findFirst({
      where: { organizationId, customerId },
    }).catch(() => null) : null;
    const activeOrders = orders.filter((o: any) => o.status !== "cancelled");
    // M50: return-risk summary for this customer (own org rows only).
    let risk: any = null;
    if (this.risk) {
      try { risk = await this.risk.forCustomer(organizationId, customer); } catch { risk = null; }
    }
    // CX1: courier delivery record (delivery success rate +
    // per-courier split) — an additive sibling of the risk block,
    // computed by the same RiskService from the same history. It
    // degrades to null exactly like the risk block does.
    let courierRecord: any = null;
    if (this.risk) {
      try { courierRecord = await this.risk.courierRecordForCustomer(organizationId, customer.id); } catch { courierRecord = null; }
    }
    // EC6: per-store identities for this customer (guarded — the
    // table is optional in older deployments / fakes).
    let storeIdentities: any[] = [];
    try {
      const table = (this.prisma as any).customerStoreIdentity;
      if (table?.findMany) {
        const rows = await table.findMany({ where: { customerId } });
        const ids = [...new Set((rows ?? []).map((r: any) => r.storeId).filter(Boolean))];
        const nameById = new Map<string, string | null>();
        if (ids.length) {
          const stores = await (this.prisma as any).store.findMany({ where: { organizationId, id: { in: ids } } });
          for (const s of stores ?? []) nameById.set(s.id, s.name ?? null);
        }
        storeIdentities = (rows ?? []).map((r: any) => ({ ...r, storeName: nameById.get(r.storeId) ?? null }));
      }
    } catch { storeIdentities = []; }
    return {
      risk,
      courierRecord,
      storeIdentities,
      customer: { ...customer, name: customerName(customer) },
      orders: orders.map((o: any) => ({
        ...o,
        totalMinor: String(o.totalMinor), subtotalMinor: String(o.subtotalMinor ?? o.totalMinor),
        shippingMinor: String(o.shippingMinor ?? 0), discountMinor: String(o.discountMinor ?? 0),
        taxMinor: String(o.taxMinor ?? 0), refundedMinor: String(o.refundedMinor ?? 0),
      })),
      conversations: conversations.map((c: any) => ({
        id: c.id, channel: c.channel, status: c.status, contactName: c.contactName,
        lastMessagePreview: c.lastMessagePreview, lastMessageAt: c.lastMessageAt, unreadCount: c.unreadCount,
      })),
      shipments: shipments.map((s: any) => ({ ...s, codAmountMinor: String(s.codAmountMinor) })),
      lead: lead ? { id: lead.id, stage: lead.stage, source: lead.source } : null,
      lifetime: {
        orderCount: activeOrders.length,
        totalSpentMinor: String(activeOrders.reduce((s: bigint, o: any) => s + BigInt(o.totalMinor), 0n)),
        currency: activeOrders[0]?.currency ?? orders[0]?.currency ?? "BDT",
      },
    };
  }

  async merge(organizationId: string, actorId: string, dto: { sourceId: string; targetId: string }) {
    if (dto.sourceId === dto.targetId) throw new BadRequestException("Source and target must differ");
    const source = await (this.prisma as any).customer.findFirst({ where: { id: dto.sourceId, organizationId } });
    const target = await (this.prisma as any).customer.findFirst({ where: { id: dto.targetId, organizationId } });
    if (!source || !target) throw new NotFoundException("Customer not found in this organization");
    if (source.mergedIntoId) throw new BadRequestException("Source customer was already merged");
    if (target.mergedIntoId) throw new BadRequestException("Target customer was itself merged into another record");
    const orders = await (this.prisma as any).order.findMany({ where: { organizationId, customerId: source.id }, take: 1000 });
    for (const o of orders) {
      await (this.prisma as any).order.update({ where: { id: o.id }, data: { customerId: target.id } });
    }
    const conversations = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, customerId: source.id }, take: 200,
    }).catch(() => []);
    for (const c of conversations) {
      await (this.prisma as any).channelConversation.update({ where: { id: c.id }, data: { customerId: target.id } });
    }
    // EC6: carry store identities — move source rows to the target
    // unless the target already has an identity for the same store
    // (target's wins; the source row is removed). Guarded like
    // other optional tables: a missing table skips silently.
    let identitiesMoved = 0;
    let identityConflicts = 0;
    try {
      const table = (this.prisma as any).customerStoreIdentity;
      if (table?.findMany) {
        const rows = await table.findMany({ where: { customerId: source.id } });
        for (const row of rows ?? []) {
          let targetExisting: any = null;
          if (typeof table.findFirst === "function") {
            targetExisting = await table.findFirst({ where: { customerId: target.id, storeId: row.storeId } });
          } else {
            const targetRows = await table.findMany({ where: { customerId: target.id, storeId: row.storeId } });
            targetExisting = (targetRows ?? [])[0] ?? null;
          }
          if (targetExisting) {
            if (typeof table.delete === "function") await table.delete({ where: { id: row.id } });
            else if (typeof table.deleteMany === "function") await table.deleteMany({ where: { id: row.id } });
            identityConflicts++;
          } else {
            await table.update({ where: { id: row.id }, data: { customerId: target.id } });
            identitiesMoved++;
          }
        }
      }
    } catch { /* optional table — skip silently */ }
    // Fill gaps on the survivor from the source (never overwrite).
    const fill: any = {};
    if (!target.phone && source.phone) fill.phone = source.phone;
    if (!target.email && source.email) fill.email = source.email;
    if (!target.firstName && source.firstName) fill.firstName = source.firstName;
    if (!target.lastName && source.lastName) fill.lastName = source.lastName;
    // CRM C4: custom fields gap-fill per key, same discipline.
    if (this.customFields) {
      const filled = this.customFields.fillGaps(target.customFields ?? null, source.customFields ?? null);
      if (Object.keys(filled).length || target.customFields) fill.customFields = filled;
    }
    // IN2: remember, per filled field, the survivor's pre-merge
    // value and the value filled in — unmerge restores a field
    // only when it still holds exactly the filled value.
    const filledFields: Record<string, { before: unknown; filledWith: unknown }> = {};
    for (const field of Object.keys(fill)) {
      filledFields[field] = { before: (target as any)[field] ?? null, filledWith: fill[field] ?? null };
    }
    if (Object.keys(fill).length) await (this.prisma as any).customer.update({ where: { id: target.id }, data: fill });
    await (this.prisma as any).customer.update({ where: { id: source.id }, data: { mergedIntoId: target.id } });
    // IN2: the reversible merge record (moved row ids + the
    // gap-fill snapshot). Guarded: on a deployment whose IN2
    // migration has not run yet the delegate is absent/failing and
    // the merge keeps its pre-IN2 behaviour — but such a merge is
    // then honestly NOT unmergeable (no record exists).
    const mrt = (this.prisma as any).customerMergeRecord;
    if (mrt?.create) {
      await mrt.create({
        data: {
          organizationId, sourceCustomerId: source.id, targetCustomerId: target.id,
          movedOrderIds: orders.map((o: any) => o.id),
          movedConversationIds: conversations.map((c: any) => c.id),
          filledFields, createdByUserId: actorId,
        },
      }).catch(() => undefined);
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "customer.merged", entityType: "Customer", entityId: target.id,
      metadata: { sourceId: source.id, ordersMoved: orders.length, conversationsMoved: conversations.length, identitiesMoved, identityConflicts },
    });
    return this.detail(organizationId, target.id);
  }

  /**
   * IN2: non-reverted merge records where this customer was the
   * SURVIVOR — the inbox context panel's "merged records" list
   * with its undo affordance. Empty when the IN2 delegate is
   * unavailable (pre-migration deployment) — never an error.
   */
  async listMergeRecords(organizationId: string, targetCustomerId: string) {
    const mrt = (this.prisma as any).customerMergeRecord;
    if (!mrt?.findMany) return [];
    const rows = await mrt.findMany({
      where: { organizationId, targetCustomerId }, orderBy: { createdAt: "desc" }, take: 20,
    }).catch(() => []);
    const active = (rows as any[]).filter((r) => !r.revertedAt);
    const out: any[] = [];
    for (const r of active) {
      const source = await (this.prisma as any).customer.findFirst({
        where: { id: r.sourceCustomerId, organizationId },
      }).catch(() => null);
      out.push({
        id: r.id, sourceCustomerId: r.sourceCustomerId, targetCustomerId: r.targetCustomerId,
        sourceName: source ? customerName(source) : null, sourcePhone: source?.phone ?? null,
        ordersMoved: Array.isArray(r.movedOrderIds) ? r.movedOrderIds.length : 0,
        conversationsMoved: Array.isArray(r.movedConversationIds) ? r.movedConversationIds.length : 0,
        createdAt: r.createdAt, createdByUserId: r.createdByUserId,
      });
    }
    return out;
  }

  /**
   * IN2: undo an agent-confirmed merge — the exact inverse of
   * merge(), driven by the CustomerMergeRecord the merge wrote:
   *  - orders/conversations move back to the source ONLY when
   *    they still point at the survivor (a row a human has since
   *    re-pointed elsewhere is never stolen back);
   *  - a gap-filled survivor field is restored to its pre-merge
   *    value ONLY when it still holds the filled value (a later
   *    human edit is never clobbered);
   *  - the source's mergedIntoId clears and the record is marked
   *    reverted, so the same merge can never be reverted twice.
   * Nothing is deleted at any point. Audited both ways.
   * Merges made before IN2 (or while the IN2 migration had not
   * run) have no record and are honestly refused here — they
   * stay merged rather than being half-undone by guessing.
   */
  async unmerge(organizationId: string, actorId: string, dto: { sourceId: string }) {
    const source = await (this.prisma as any).customer.findFirst({ where: { id: dto.sourceId, organizationId } });
    if (!source) throw new NotFoundException("Customer not found in this organization");
    if (!source.mergedIntoId) throw new BadRequestException("এই Customer রেকর্ডটি কারো সাথে মার্জ করা নেই — undo করার কিছু নেই।");
    const mrt = (this.prisma as any).customerMergeRecord;
    if (!mrt?.findMany) throw new BadRequestException("এই মার্জটি IN2-এর আগের — কোনো merge record নেই, তাই স্বয়ংক্রিয়ভাবে undo করা যাবে না।");
    const records = await mrt.findMany({
      where: { organizationId, sourceCustomerId: source.id }, orderBy: { createdAt: "desc" }, take: 20,
    }).catch(() => []);
    const record = (records as any[]).find((r) => !r.revertedAt && r.targetCustomerId === source.mergedIntoId);
    if (!record) throw new BadRequestException("এই মার্জটি IN2-এর আগের — কোনো merge record নেই, তাই স্বয়ংক্রিয়ভাবে undo করা যাবে না।");
    const target = await (this.prisma as any).customer.findFirst({ where: { id: record.targetCustomerId, organizationId } });
    if (!target) throw new NotFoundException("Surviving customer not found in this organization");

    let ordersRestored = 0;
    for (const oid of (Array.isArray(record.movedOrderIds) ? record.movedOrderIds : [])) {
      const o = await (this.prisma as any).order.findFirst({ where: { id: oid, organizationId } }).catch(() => null);
      if (o && o.customerId === target.id) {
        await (this.prisma as any).order.update({ where: { id: o.id }, data: { customerId: source.id } });
        ordersRestored++;
      }
    }
    let conversationsRestored = 0;
    for (const cid of (Array.isArray(record.movedConversationIds) ? record.movedConversationIds : [])) {
      const c = await (this.prisma as any).channelConversation.findFirst({ where: { id: cid, organizationId } }).catch(() => null);
      if (c && c.customerId === target.id) {
        await (this.prisma as any).channelConversation.update({ where: { id: c.id }, data: { customerId: source.id } });
        conversationsRestored++;
      }
    }
    const filled = (record.filledFields && typeof record.filledFields === "object") ? record.filledFields : {};
    const restore: Record<string, unknown> = {};
    const fieldsRestored: string[] = [];
    for (const [field, snap] of Object.entries(filled as Record<string, any>)) {
      if (!snap || typeof snap !== "object" || !("filledWith" in snap)) continue;
      const current = (target as any)[field] ?? null;
      if (JSON.stringify(current) === JSON.stringify(snap.filledWith ?? null)) {
        restore[field] = snap.before ?? null;
        fieldsRestored.push(field);
      }
    }
    if (Object.keys(restore).length) {
      await (this.prisma as any).customer.update({ where: { id: target.id }, data: restore });
    }
    await (this.prisma as any).customer.update({ where: { id: source.id }, data: { mergedIntoId: null } });
    await mrt.update({
      where: { id: record.id },
      data: { revertedAt: new Date(), revertedByUserId: actorId },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "customer.unmerged", entityType: "Customer", entityId: source.id,
      metadata: { targetId: target.id, mergeRecordId: record.id, ordersRestored, conversationsRestored, fieldsRestored },
    });
    return {
      sourceId: source.id, targetId: target.id, mergeRecordId: record.id,
      ordersRestored, conversationsRestored, fieldsRestored,
    };
  }
}
