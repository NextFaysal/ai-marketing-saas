import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SubscriptionsService } from "./subscriptions.service";

/** EC24c — subscriptions: snapshots, sweep, failure discipline. */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      return matches(row[k] ?? {}, v);
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
  };
}
function fakePrisma() {
  return {
    customer: makeTable("customer"), product: makeTable("product"),
    productVariant: makeTable("variant"), order: makeTable("order"),
    orderItem: makeTable("item"), customerSubscription: makeTable("sub"),
    auditLog: makeTable("audit"),
  } as any;
}
function fakeAudit(prisma: any) {
  return {
    log: jest.fn(async (input: any) => {
      await prisma.auditLog.create({ data: { organizationId: input.organizationId, action: input.action, entityType: input.entityType, entityId: input.entityId, metadata: input.metadata ?? null } });
    }),
  } as any;
}
/** Integrations stub mirroring the real upsertOrder contract:
 * org+source+externalId unique (re-run updates, never duplicates),
 * order + items written, customerId/subscriptionId stamped. */
function fakeIntegrations(prisma: any) {
  return {
    upsertOrder: jest.fn(async (orgId: string, _s: any, o: any, source: string) => {
      const existing = await prisma.order.findFirst({ where: { organizationId: orgId, source, externalId: o.externalId } });
      if (existing) return "updated";
      const order = await prisma.order.create({
        data: {
          organizationId: orgId, source, externalId: o.externalId, externalNumber: o.externalNumber,
          status: o.status, paymentMethod: o.paymentMethod, isCod: o.isCod, currency: o.currency,
          subtotalMinor: o.subtotalMinor, shippingMinor: o.shippingMinor, discountMinor: o.discountMinor,
          taxMinor: o.taxMinor, totalMinor: o.totalMinor, refundedMinor: o.refundedMinor,
          customerId: o.customerId ?? null, subscriptionId: o.subscriptionId ?? null, placedAt: o.placedAt,
        },
      });
      for (const item of o.items) {
        await prisma.orderItem.create({
          data: { orderId: order.id, productId: item.productId ?? null, name: item.name, sku: item.sku ?? null, quantity: item.quantity, priceMinor: item.priceMinor, totalMinor: item.totalMinor },
        });
      }
      return "created";
    }),
  } as any;
}

function seedBase(prisma: any) {
  prisma.customer.rows.push({ id: "c-1", organizationId: "org-1", firstName: "রহিম", lastName: null, phone: "01711111111", email: "r@example.com", externalId: null });
  prisma.product.rows.push({
    id: "p-1", organizationId: "org-1", name: "কফি", sku: "COF-1", priceMinor: 50000n, currency: "BDT",
    subscriptionEnabled: true, subscriptionIntervalDays: 30, subscriptionDiscountPercent: 10,
  });
}

describe("EC24c create", () => {
  it("snapshots price + discount; nextRunAt = now + interval", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    const svc = new SubscriptionsService(prisma, fakeAudit(prisma), fakeIntegrations(prisma));
    const before = Date.now();
    const { subscription }: any = await svc.create("org-1", "staff-1", { customerId: "c-1", productId: "p-1", qty: 2 } as any);
    expect(subscription.unitPriceMinor).toBe("50000");
    expect(subscription.discountPercent).toBe(10);
    expect(subscription.status).toBe("active");
    const next = new Date(subscription.nextRunAt).getTime();
    expect(next).toBeGreaterThanOrEqual(before + 29 * 86400000);
    expect(next).toBeLessThanOrEqual(Date.now() + 31 * 86400000);
    expect(prisma.auditLog.rows.some((r: any) => r.action === "subscriptions.create")).toBe(true);
  });

  it("source order line price wins over current product price; variant price when SKU matches", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    const order = await prisma.order.create({ data: { organizationId: "org-1", source: "manual", externalId: "o-1", status: "completed" } });
    await prisma.orderItem.create({ data: { orderId: order.id, productId: "p-1", name: "কফি", quantity: 1, priceMinor: 42000n, totalMinor: 42000n } });
    prisma.productVariant.rows.push({ id: "v-1", productId: "p-1", name: "বড়", sku: "COF-1-L", priceMinor: 65000n });
    const svc = new SubscriptionsService(prisma, fakeAudit(prisma), fakeIntegrations(prisma));
    const fromOrder: any = await svc.create("org-1", "staff-1", { customerId: "c-1", productId: "p-1", createdFromOrderId: order.id } as any);
    expect(fromOrder.subscription.unitPriceMinor).toBe("42000");
    const fromVariant: any = await svc.create("org-1", "staff-1", { customerId: "c-1", productId: "p-1", variantSku: "COF-1-L" } as any);
    expect(fromVariant.subscription.unitPriceMinor).toBe("65000");
  });

  it("rejects non-subscription product (Bengali 400), foreign customer/product (404)", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    prisma.product.rows.push({ id: "p-2", organizationId: "org-1", name: "সাধারণ", priceMinor: 1000n, subscriptionEnabled: false, subscriptionIntervalDays: null });
    const svc = new SubscriptionsService(prisma, fakeAudit(prisma), fakeIntegrations(prisma));
    await expect(svc.create("org-1", "s", { customerId: "c-1", productId: "p-2" } as any)).rejects.toThrow(/এই পণ্যে সাবস্ক্রিপশন চালু নেই/);
    await expect(svc.create("org-1", "s", { customerId: "foreign", productId: "p-1" } as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.create("org-2", "s", { customerId: "c-1", productId: "p-1" } as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.create("org-1", "s", { customerId: "c-1", productId: "p-1", qty: 0 } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("EC24c sweep (runDueForOrg)", () => {
  async function seedSub(prisma: any, over: any = {}) {
    return prisma.customerSubscription.create({
      data: {
        organizationId: "org-1", customerId: "c-1", productId: "p-1", variantSku: null,
        qty: 2, unitPriceMinor: 50000n, discountPercent: 10, status: "active",
        nextRunAt: new Date("2026-10-01T00:00:00Z"), failureCount: 0, ...over,
      },
    });
  }

  it("creates the renewal order from the SNAPSHOT (product price changed after create) and advances from the scheduled date", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    const integrations = fakeIntegrations(prisma);
    const svc = new SubscriptionsService(prisma, fakeAudit(prisma), integrations);
    const { subscription }: any = await svc.create("org-1", "s", { customerId: "c-1", productId: "p-1", qty: 2, startAt: "2026-10-01T00:00:00Z" } as any);
    // product price changes AFTER the snapshot
    prisma.product.rows[0].priceMinor = 99000n;
    const out = await svc.runDueForOrg("org-1");
    expect(out).toEqual({ processed: 1, created: 1, failed: 0 });
    const order = prisma.order.rows[0];
    expect(order.source).toBe("subscription");
    expect(order.subscriptionId).toBe(subscription.id);
    expect(order.customerId).toBe("c-1");
    expect(order.status).toBe("pending");
    expect(order.isCod).toBe(true);
    // snapshot math: 50000*2 = 100000; 10% discount = 10000; shipping 0; total 90000
    expect(order.subtotalMinor).toBe(100000n);
    expect(order.discountMinor).toBe(10000n);
    expect(order.shippingMinor).toBe(0n);
    expect(order.totalMinor).toBe(90000n);
    expect(prisma.orderItem.rows[0].priceMinor).toBe(50000n);
    const sub = prisma.customerSubscription.rows[0];
    expect(sub.lastOrderId).toBe(order.id);
    // no drift: 2026-10-01 + 30d, NOT now + 30d
    expect(new Date(sub.nextRunAt).toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(sub.failureCount).toBe(0);
    // a re-run does not duplicate (not due anymore)
    const again = await svc.runDueForOrg("org-1");
    expect(again.created).toBe(0);
    expect(prisma.order.rows).toHaveLength(1);
  });

  it("not-due and paused subscriptions are untouched", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    const svc = new SubscriptionsService(prisma, fakeAudit(prisma), fakeIntegrations(prisma));
    await seedSub(prisma, { nextRunAt: new Date(Date.now() + 86400000) });
    await seedSub(prisma, { status: "paused", nextRunAt: new Date("2026-10-01T00:00:00Z") });
    const out = await svc.runDueForOrg("org-1");
    expect(out).toEqual({ processed: 0, created: 0, failed: 0 });
    expect(prisma.order.rows).toHaveLength(0);
  });

  it("failure isolation: a deleted product fails only its own subscription; nextRunAt unchanged", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    const svc = new SubscriptionsService(prisma, fakeAudit(prisma), fakeIntegrations(prisma));
    const bad = await seedSub(prisma, { productId: "p-deleted" });
    const good = await seedSub(prisma, {});
    const out = await svc.runDueForOrg("org-1");
    expect(out).toEqual({ processed: 2, created: 1, failed: 1 });
    const badRow = prisma.customerSubscription.rows.find((r: any) => r.id === bad.id);
    expect(badRow.failureCount).toBe(1);
    expect(new Date(badRow.nextRunAt).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(badRow.status).toBe("active");
    const goodRow = prisma.customerSubscription.rows.find((r: any) => r.id === good.id);
    expect(goodRow.failureCount).toBe(0);
    expect(prisma.auditLog.rows.some((r: any) => r.action === "subscriptions.renewal_failed" && r.entityId === bad.id)).toBe(true);
  });

  it("5th consecutive failure auto-pauses with both audits", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    const svc = new SubscriptionsService(prisma, fakeAudit(prisma), fakeIntegrations(prisma));
    const sub = await seedSub(prisma, { productId: "p-deleted", failureCount: 4 });
    await svc.runDueForOrg("org-1");
    const row = prisma.customerSubscription.rows.find((r: any) => r.id === sub.id);
    expect(row.failureCount).toBe(5);
    expect(row.status).toBe("paused");
    expect(prisma.auditLog.rows.some((r: any) => r.action === "subscriptions.auto_paused")).toBe(true);
    // paused subs are not generated anymore
    const out = await svc.runDueForOrg("org-1");
    expect(out.processed).toBe(0);
  });
});

describe("EC24c transitions", () => {
  it("pause only from active; resume sets next run = now + interval; cancel terminal", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    const svc = new SubscriptionsService(prisma, fakeAudit(prisma), fakeIntegrations(prisma));
    const { subscription }: any = await svc.create("org-1", "s", { customerId: "c-1", productId: "p-1", startAt: "2026-10-01T00:00:00Z" } as any);
    await expect(svc.resume("org-1", "s", subscription.id)).rejects.toBeInstanceOf(BadRequestException);
    const paused: any = await svc.pause("org-1", "s", subscription.id);
    expect(paused.subscription.status).toBe("paused");
    await expect(svc.pause("org-1", "s", subscription.id)).rejects.toBeInstanceOf(BadRequestException);
    const before = Date.now();
    const resumed: any = await svc.resume("org-1", "s", subscription.id);
    expect(resumed.subscription.status).toBe("active");
    const next = new Date(resumed.subscription.nextRunAt).getTime();
    expect(next).toBeGreaterThanOrEqual(before + 29 * 86400000);
    expect(next).toBeLessThanOrEqual(Date.now() + 31 * 86400000);
    const cancelled: any = await svc.cancel("org-1", "s", subscription.id);
    expect(cancelled.subscription.status).toBe("cancelled");
    await expect(svc.cancel("org-1", "s", subscription.id)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.getOne("org-2", subscription.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
