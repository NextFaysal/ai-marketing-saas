import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { IntegrationsService } from "../integrations/integrations.service";
import type { CreateSubscriptionDto } from "./subscriptions.dto";

/**
 * EC24c — Customer subscriptions (staff-created ONLY in v1).
 *
 * There is deliberately NO storefront self-serve signup and NO
 * payment-gateway auto-charge: a subscription is a staff-created
 * schedule that, when due, creates a normal COD renewal order
 * through the ONE shared order path (IntegrationsService.
 * upsertOrder, source "subscription"). Renewal orders carry NO
 * delivery charge (shippingMinor 0) — staff handle delivery/COD
 * on the order as-is. No customer notification is sent on
 * renewal in v1.
 *
 * Price/discount are SNAPSHOTS taken at creation: later product
 * price changes never alter an existing subscription's renewal
 * amounts.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly integrations?: IntegrationsService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  private serialize(s: any) {
    if (!s) return s;
    return {
      ...s,
      unitPriceMinor: s.unitPriceMinor != null ? String(s.unitPriceMinor) : null,
      nextRunAt: s.nextRunAt ? new Date(s.nextRunAt).toISOString() : null,
      createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : null,
      updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : null,
    };
  }

  private async loadOr404(organizationId: string, id: string) {
    const row = await this.t("customerSubscription").findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundException("Subscription not found in this organization");
    return row;
  }

  async create(organizationId: string, actorId: string, dto: CreateSubscriptionDto) {
    const customer = await this.t("customer").findFirst({
      where: { id: dto.customerId, organizationId },
    });
    if (!customer) throw new NotFoundException("Customer not found in this organization");
    const product = await this.t("product").findFirst({
      where: { id: dto.productId, organizationId },
    });
    if (!product) throw new NotFoundException("Product not found in this organization");
    if (!product.subscriptionEnabled || !(Number(product.subscriptionIntervalDays) > 0)) {
      throw new BadRequestException("এই পণ্যে সাবস্ক্রিপশন চালু নেই");
    }
    const qty = dto.qty ?? 1;
    if (!Number.isInteger(qty) || qty < 1) {
      throw new BadRequestException("পরিমাণ কমপক্ষে ১ হতে হবে");
    }

    // Unit-price snapshot: the source order's line price wins when
    // a source order is given and has a line for this product;
    // otherwise the current product (or matching variant) price.
    let unitPriceMinor: bigint | null = null;
    if (dto.createdFromOrderId) {
      const order = await this.t("order").findFirst({
        where: { id: dto.createdFromOrderId, organizationId },
      });
      if (!order) throw new NotFoundException("Order not found in this organization");
      const line = await this.t("orderItem")
        .findFirst({ where: { orderId: order.id, productId: product.id } })
        .catch(() => null);
      if (line) unitPriceMinor = BigInt(line.priceMinor);
    }
    if (unitPriceMinor === null) {
      unitPriceMinor = BigInt(product.priceMinor);
      if (dto.variantSku) {
        const variant = await this.t("productVariant")
          .findFirst({ where: { productId: product.id, sku: dto.variantSku } })
          .catch(() => null);
        if (variant?.priceMinor != null) unitPriceMinor = BigInt(variant.priceMinor);
      }
    }

    const intervalDays = Number(product.subscriptionIntervalDays);
    let nextRunAt: Date;
    if (dto.startAt) {
      const d = new Date(dto.startAt);
      if (Number.isNaN(d.getTime())) throw new BadRequestException("শুরুর সময় সঠিক নয়");
      nextRunAt = d;
    } else {
      nextRunAt = new Date(Date.now() + intervalDays * 24 * 3600 * 1000);
    }

    const row = await this.t("customerSubscription").create({
      data: {
        organizationId,
        customerId: customer.id,
        productId: product.id,
        variantSku: dto.variantSku ?? null,
        qty,
        unitPriceMinor,
        discountPercent: product.subscriptionDiscountPercent ?? null,
        status: "active",
        nextRunAt,
        createdFromOrderId: dto.createdFromOrderId ?? null,
        failureCount: 0,
      },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "subscriptions.create",
      entityType: "CustomerSubscription", entityId: row.id,
      metadata: { customerId: customer.id, productId: product.id, qty, unitPriceMinor: unitPriceMinor.toString() },
    });
    return { subscription: this.serialize(row) };
  }

  async list(organizationId: string, filter: { status?: string; customerId?: string } = {}) {
    const where: any = { organizationId };
    if (filter.status) where.status = filter.status;
    if (filter.customerId) where.customerId = filter.customerId;
    const rows: any[] =
      (await this.t("customerSubscription").findMany({ where, orderBy: { nextRunAt: "asc" } }).catch(() => [])) ?? [];
    const items: any[] = [];
    for (const row of rows) {
      const customer = await this.t("customer").findFirst({ where: { id: row.customerId, organizationId } }).catch(() => null);
      const product = await this.t("product").findFirst({ where: { id: row.productId, organizationId } }).catch(() => null);
      items.push({
        ...this.serialize(row),
        customerName: customer ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") || null : null,
        customerPhone: customer?.phone ?? null,
        productName: product?.name ?? null,
      });
    }
    return { items };
  }

  async getOne(organizationId: string, id: string) {
    return { subscription: this.serialize(await this.loadOr404(organizationId, id)) };
  }

  async pause(organizationId: string, actorId: string, id: string) {
    const row = await this.loadOr404(organizationId, id);
    if (row.status !== "active") {
      throw new BadRequestException("শুধুমাত্র সক্রিয় সাবস্ক্রিপশন বিরতি দেওয়া যায়");
    }
    const updated = await this.t("customerSubscription").update({
      where: { id: row.id }, data: { status: "paused" },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "subscriptions.pause",
      entityType: "CustomerSubscription", entityId: row.id,
    });
    return { subscription: this.serialize(updated) };
  }

  /** Resume: next run is scheduled one interval FROM NOW (the
   * product's current interval) — documented: a resumed
   * subscription does not try to "catch up" missed runs. */
  async resume(organizationId: string, actorId: string, id: string) {
    const row = await this.loadOr404(organizationId, id);
    if (row.status !== "paused") {
      throw new BadRequestException("শুধুমাত্র বিরতি দেওয়া সাবস্ক্রিপশন আবার চালু করা যায়");
    }
    const product = await this.t("product").findFirst({
      where: { id: row.productId, organizationId },
    }).catch(() => null);
    const intervalDays = Number(product?.subscriptionIntervalDays ?? 0);
    const nextRunAt = intervalDays > 0
      ? new Date(Date.now() + intervalDays * 24 * 3600 * 1000)
      : row.nextRunAt;
    const updated = await this.t("customerSubscription").update({
      where: { id: row.id }, data: { status: "active", nextRunAt, failureCount: 0 },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "subscriptions.resume",
      entityType: "CustomerSubscription", entityId: row.id,
    });
    return { subscription: this.serialize(updated) };
  }

  async cancel(organizationId: string, actorId: string, id: string) {
    const row = await this.loadOr404(organizationId, id);
    if (row.status === "cancelled") {
      throw new BadRequestException("সাবস্ক্রিপশনটি ইতিমধ্যে বাতিল করা হয়েছে");
    }
    const updated = await this.t("customerSubscription").update({
      where: { id: row.id }, data: { status: "cancelled" },
    });
    await this.audit?.log({
      organizationId, userId: actorId, action: "subscriptions.cancel",
      entityType: "CustomerSubscription", entityId: row.id,
    });
    return { subscription: this.serialize(updated) };
  }

  /**
   * The commerce subscription sweep (job type
   * "commerce_subscription_sweep" — NOT the SaaS billing
   * "subscription_sweep"). Due = active AND nextRunAt <= now,
   * capped at 100 per run. Each subscription is failure-isolated:
   * a failure increments failureCount, writes a
   * "subscriptions.renewal_failed" audit, and NEVER advances
   * nextRunAt (it retries next sweep); at 5 consecutive failures
   * the subscription auto-pauses (+ "subscriptions.auto_paused"
   * audit). On success nextRunAt advances from the PREVIOUS
   * scheduled time by one interval (no drift).
   */
  async runDueForOrg(organizationId: string): Promise<{ processed: number; created: number; failed: number }> {
    const table = this.t("customerSubscription");
    if (!table?.findMany) return { processed: 0, created: 0, failed: 0 };
    const now = Date.now();
    const rows: any[] =
      (await table.findMany({ where: { organizationId, status: "active" } }).catch(() => [])) ?? [];
    const due = rows
      .filter((r) => r.nextRunAt && new Date(r.nextRunAt).getTime() <= now)
      .sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime())
      .slice(0, 100);

    let created = 0;
    let failed = 0;
    for (const sub of due) {
      try {
        if (!this.integrations) throw new Error("integrations service unavailable");
        const product = await this.t("product").findFirst({
          where: { id: sub.productId, organizationId },
        });
        if (!product) throw new Error("product not found (deleted?)");
        const intervalDays = Number(product.subscriptionIntervalDays ?? 0);
        if (!(intervalDays > 0)) throw new Error("product subscription interval missing");

        const customer = await this.t("customer").findFirst({
          where: { id: sub.customerId, organizationId },
        }).catch(() => null);

        const unit = BigInt(sub.unitPriceMinor);
        const qty = Math.max(1, Number(sub.qty ?? 1));
        const subtotal = unit * BigInt(qty);
        const pct = sub.discountPercent != null ? Number(sub.discountPercent) : 0;
        // round-half-up on positive amounts
        const discount = pct > 0 ? (subtotal * BigInt(pct) + 50n) / 100n : 0n;
        const total = subtotal - discount;
        const scheduledAt = new Date(sub.nextRunAt);
        const externalId = `sub-${sub.id}-${scheduledAt.toISOString()}`;

        await this.integrations.upsertOrder(
          organizationId,
          null,
          {
            externalId,
            externalNumber: `SUB-${sub.id.slice(0, 8).toUpperCase()}`,
            status: "pending",
            paymentMethod: "cod",
            isCod: true,
            currency: product.currency ?? "BDT",
            subtotalMinor: subtotal,
            shippingMinor: 0n, // documented: renewals carry no delivery charge
            discountMinor: discount,
            taxMinor: 0n,
            totalMinor: total,
            refundedMinor: 0n,
            placedAt: new Date(),
            customerId: sub.customerId,
            subscriptionId: sub.id,
            customer: {
              externalId: customer?.externalId ?? undefined,
              firstName: customer?.firstName ?? undefined,
              lastName: customer?.lastName ?? undefined,
              email: customer?.email ?? undefined,
              phone: customer?.phone ?? undefined,
            },
            items: [
              {
                productId: sub.productId,
                name: product.name,
                sku: sub.variantSku ?? undefined,
                quantity: qty,
                priceMinor: unit,
                totalMinor: subtotal,
              },
            ],
          } as any,
          "subscription",
        );

        const order = await this.t("order")
          .findFirst({ where: { organizationId, source: "subscription", externalId } })
          .catch(() => null);
        const nextRunAt = new Date(scheduledAt.getTime() + intervalDays * 24 * 3600 * 1000);
        await table.update({
          where: { id: sub.id },
          data: { lastOrderId: order?.id ?? sub.lastOrderId ?? null, nextRunAt, failureCount: 0 },
        });
        created++;
      } catch (e) {
        failed++;
        const message = e instanceof Error ? e.message : String(e);
        const failureCount = (Number(sub.failureCount ?? 0) || 0) + 1;
        try {
          await table.update({
            where: { id: sub.id },
            data: { failureCount, ...(failureCount >= 5 ? { status: "paused" } : {}) },
          });
        } catch { /* the audit below still records the failure */ }
        await this.audit?.log({
          organizationId, action: "subscriptions.renewal_failed",
          entityType: "CustomerSubscription", entityId: sub.id,
          metadata: { subscriptionId: sub.id, error: message, failureCount },
        }).catch(() => undefined);
        if (failureCount >= 5) {
          await this.audit?.log({
            organizationId, action: "subscriptions.auto_paused",
            entityType: "CustomerSubscription", entityId: sub.id,
            metadata: { subscriptionId: sub.id, failureCount },
          }).catch(() => undefined);
        }
        this.logger.warn(`subscription renewal failed for ${sub.id}: ${message}`);
      }
    }
    return { processed: due.length, created, failed };
  }
}
