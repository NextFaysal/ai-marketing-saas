import { OrderPushService } from "./order-push.service";
import { SyncOutboxService } from "./sync-outbox.service";
import { OrdersService } from "../orders/orders.service";

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if (!matchWhere(row, v)) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)),
    create: async ({ data }: any) => { const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
  };
}

function setup(syncMode: string, refundPushEnabled: boolean) {
  const prisma: any = {
    store: makeTable(), order: makeTable(), orderItem: makeTable(),
    customer: makeTable(), syncOutbox: makeTable(), integration: makeTable(),
  };
  prisma.store.rows.push({ id: "st1", organizationId: "org-1", platform: "WOOCOMMERCE", name: "Shop", url: "https://shop.example.com", syncMode, refundPushEnabled });
  prisma.order.rows.push({
    id: "o1", organizationId: "org-1", storeId: "st1", source: "woocommerce", externalId: "77",
    status: "processing", totalMinor: 20000n, refundedMinor: 0n, currency: "BDT", items: [],
  });
  const executed: any[] = [];
  const stubAdapter = {
    platform: "woocommerce",
    capabilities: { push_order_status: true, push_refund: true, cancel_order: true },
    execute: async (ctx: any) => { executed.push(ctx); return { ok: true, responseSummary: { stub: true } }; },
  };
  const registry: any = { get: (p: string) => (p === "woocommerce" ? stubAdapter : undefined) };
  const outbox = new SyncOutboxService(prisma, registry);
  const audit: any = { log: async () => undefined };
  const orderPush = new OrderPushService(prisma, outbox, audit);
  const orders = new OrdersService(prisma, undefined, undefined, audit, undefined, undefined, orderPush);
  return { prisma, outbox, orderPush, orders, executed };
}

const outboxOps = (prisma: any) => prisma.syncOutbox.rows.map((r: any) => r.operation);

describe("EC5 OrderPushService + S2 hooks", () => {
  it("mirror store: a status change enqueues NOTHING", async () => {
    const { prisma, orders } = setup("mirror", true);
    await orders.updateOrder("org-1", "u1", "o1", { status: "completed" } as any);
    expect(prisma.order.rows[0].status).toBe("completed");
    expect(prisma.syncOutbox.rows.length).toBe(0);
  });

  it("co-manage: status change enqueues push_order_status and the outbox processes it", async () => {
    const { prisma, orders, outbox, executed } = setup("co-manage", false);
    await orders.updateOrder("org-1", "u1", "o1", { status: "completed" } as any);
    expect(outboxOps(prisma)).toEqual(["push_order_status"]);
    const res = await outbox.processDue({ organizationId: "org-1" });
    expect(res.done).toBe(1);
    expect(executed[0].operation).toBe("push_order_status");
    expect(executed[0].payload).toMatchObject({ orderId: "o1", status: "completed" });
  });

  it("cancel flows through the cancel_order operation", async () => {
    const { prisma, orders } = setup("co-manage", false);
    await orders.updateOrder("org-1", "u1", "o1", { status: "cancelled" } as any);
    expect(outboxOps(prisma)).toEqual(["cancel_order"]);
  });

  it("REFUND GATE OFF (default): recording a refund enqueues NO store refund", async () => {
    const { prisma, orders } = setup("co-manage", false);
    await orders.updateOrder("org-1", "u1", "o1", { refund: { amountMinor: "5000" } } as any);
    expect(prisma.order.rows[0].refundedMinor).toBe(5000n);
    expect(prisma.syncOutbox.rows.length).toBe(0);
  });

  it("REFUND GATE ON: recording a refund enqueues push_refund with the amount", async () => {
    const { prisma, orders } = setup("full-manage", true);
    await orders.updateOrder("org-1", "u1", "o1", { refund: { amountMinor: "5000", reason: "damaged" } } as any);
    expect(outboxOps(prisma)).toEqual(["push_refund"]);
    expect(prisma.syncOutbox.rows[0].payload).toMatchObject({ amountMinor: "5000", reason: "damaged" });
  });

  it("the gate is checked directly too: enqueueRefund returns gated=true when off", async () => {
    const { orderPush } = setup("co-manage", false);
    const res = await orderPush.enqueueRefund("org-1", "o1", { amountMinor: "100" });
    expect(res).toMatchObject({ enqueued: 0, gated: true, reason: "refund_push_disabled" });
  });

  it("internalNote is NEVER pushed — a note-only PATCH creates no outbox rows", async () => {
    const { prisma, orders } = setup("full-manage", true);
    await orders.updateOrder("org-1", "u1", "o1", { internalNote: "VIP customer, careful" } as any);
    expect(prisma.order.rows[0].internalNote).toBe("VIP customer, careful");
    expect(prisma.syncOutbox.rows.length).toBe(0);
  });

  it("address change enqueues push_order_address", async () => {
    const { prisma, orders } = setup("co-manage", false);
    await orders.updateOrder("org-1", "u1", "o1", { address: "New Road, Khulna" } as any);
    expect(outboxOps(prisma)).toEqual(["push_order_address"]);
    expect(prisma.syncOutbox.rows[0].payload.address).toBe("New Road, Khulna");
  });

  it("createStoreDraft refuses an order already in the store", async () => {
    const { orderPush } = setup("co-manage", true);
    await expect(orderPush.createStoreDraft("org-1", "u1", "o1")).rejects.toThrow("ইতিমধ্যে স্টোরে আছে");
  });

  it("pushState reports the gate + mode for the UI", async () => {
    const { orderPush } = setup("co-manage", false);
    const state = await orderPush.pushState("org-1", "o1");
    expect(state.store).toMatchObject({ syncMode: "co-manage", refundPushEnabled: false });
  });

  it("a foreign order id is a 404", async () => {
    const { orderPush } = setup("co-manage", false);
    await expect(orderPush.pushState("org-2", "o1")).rejects.toMatchObject({ code: "commerce.orderNotFoundInOrg", status: 404 });
  });
});
