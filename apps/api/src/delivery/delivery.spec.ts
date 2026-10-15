import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DeliveryService } from "./delivery.service";

/**
 * EC22 — Delivery (riders + assignments) specs. Fake Prisma in
 * the makeTable style; OrdersService is a recording stub because
 * the contract under test is WHEN/HOW updateOrder is called
 * (delivered => "completed", BEFORE the assignment is stamped;
 * returned => never), not OrdersService's own transition logic.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("gte" in v && !(row[k] != null && new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("lt" in v && !(row[k] != null && new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      return true;
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
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy) {
        const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
        for (const spec of [...specs].reverse()) {
          const [field, dir] = Object.entries(spec)[0] as [string, string];
          f = [...f].sort((a, b) => {
            const av: any = a[field] instanceof Date ? a[field].getTime() : a[field];
            const bv: any = b[field] instanceof Date ? b[field].getTime() : b[field];
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return dir === "desc" ? -cmp : cmp;
          });
        }
      }
      if (take) f = f.slice(0, take);
      return f;
    },
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), assignedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}));
      if (!row) throw new Error(`row not found in ${name}`);
      Object.assign(row, data);
      return row;
    },
  };
}

function setup() {
  const prisma: any = {
    rider: makeTable("rider"),
    deliveryAssignment: makeTable("assignment"),
    order: makeTable("order"),
  };
  prisma.order.rows.push(
    { id: "ord-1", organizationId: "org-1", externalNumber: "1042", status: "processing", totalMinor: 150000n, address: "Mirpur, Dhaka" },
    { id: "ord-foreign", organizationId: "org-2", externalNumber: "9999", status: "processing", totalMinor: 100n, address: "Elsewhere" },
  );
  prisma.rider.rows.push(
    { id: "rider-1", organizationId: "org-1", name: "Karim", phone: "01711111111", active: true },
    { id: "rider-off", organizationId: "org-1", name: "Rahim", phone: "01722222222", active: false },
    { id: "rider-foreign", organizationId: "org-2", name: "Other", phone: "01733333333", active: true },
  );
  const auditCalls: any[] = [];
  const audit = { log: jest.fn(async (e: any) => { auditCalls.push(e); }) } as any;

  // Recording OrdersService stub; `events` interleaves updateOrder
  // calls with assignment stamps so ordering can be asserted.
  const events: string[] = [];
  let updateOrderError: Error | null = null;
  const orders = {
    updateOrder: jest.fn(async (_org: string, _actor: string, orderId: string, dto: any) => {
      events.push(`updateOrder:${orderId}:${dto.status}`);
      if (updateOrderError) throw updateOrderError;
      const row = prisma.order.rows.find((r: any) => r.id === orderId);
      if (row) row.status = dto.status;
      return row;
    }),
  } as any;
  const origUpdate = prisma.deliveryAssignment.update;
  prisma.deliveryAssignment.update = async (args: any) => {
    const out = await origUpdate(args);
    events.push(`assignment:${args.data.status}`);
    return out;
  };

  const svc = new DeliveryService(prisma as any, audit, orders);
  return {
    prisma, svc, auditCalls, orders, events,
    failUpdateOrder: (e: Error) => { updateOrderError = e; },
  };
}

describe("DeliveryService riders", () => {
  it("creates a rider (name + phone both required) and audits", async () => {
    const { svc, auditCalls } = setup();
    await expect(svc.createRider("org-1", "owner", { name: "  ", phone: "017" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createRider("org-1", "owner", { name: "Jamal" })).rejects.toBeInstanceOf(BadRequestException);
    const rider = await svc.createRider("org-1", "owner", { name: "Jamal", phone: "01744444444" });
    expect(rider.active).toBe(true);
    expect(auditCalls.some((c) => c.action === "rider.created" && c.entityId === rider.id)).toBe(true);
  });

  it("DELETE deactivates (soft); foreign riders 404 everywhere", async () => {
    const { prisma, svc } = setup();
    const out = await svc.removeRider("org-1", "owner", "rider-1");
    expect(out.active).toBe(false);
    expect(prisma.rider.rows.find((r: any) => r.id === "rider-1")).toBeTruthy(); // row kept
    await expect(svc.updateRider("org-1", "owner", "rider-foreign", { name: "X" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.removeRider("org-1", "owner", "rider-foreign")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("DeliveryService assignments", () => {
  it("assigns a rider and audits rider.assigned", async () => {
    const { svc, auditCalls } = setup();
    const a = await svc.createAssignment("org-1", "agent", { orderId: "ord-1", riderId: "rider-1", note: "সাবধানে" });
    expect(a.status).toBe("assigned");
    expect(a.assignedById).toBe("agent");
    expect(auditCalls.some((c) => c.action === "rider.assigned" && c.entityId === a.id)).toBe(true);
  });

  it("inactive rider => 400; foreign order => 404; foreign rider => 404", async () => {
    const { svc } = setup();
    await expect(svc.createAssignment("org-1", "agent", { orderId: "ord-1", riderId: "rider-off" }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createAssignment("org-1", "agent", { orderId: "ord-foreign", riderId: "rider-1" }))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.createAssignment("org-1", "agent", { orderId: "ord-1", riderId: "rider-foreign" }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("a second ACTIVE assignment for the same order => 400; after return, re-assign works", async () => {
    const { svc } = setup();
    const a = await svc.createAssignment("org-1", "agent", { orderId: "ord-1", riderId: "rider-1" });
    await expect(svc.createAssignment("org-1", "agent", { orderId: "ord-1", riderId: "rider-1" }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining("ইতিমধ্যে একজন রাইডার সক্রিয় আছেন") });
    await svc.transition("org-1", "agent", a.id, { status: "returned" });
    const b = await svc.createAssignment("org-1", "agent", { orderId: "ord-1", riderId: "rider-1" });
    expect(b.status).toBe("assigned");
  });
});

describe("DeliveryService transitions", () => {
  it("illegal transitions => 400 naming the allowed next states", async () => {
    const { svc } = setup();
    const a = await svc.createAssignment("org-1", "agent", { orderId: "ord-1", riderId: "rider-1" });
    await expect(svc.transition("org-1", "agent", a.id, { status: "delivered" }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining("picked_up") });
    await expect(svc.transition("org-1", "agent", a.id, { status: "assigned" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.transition("org-1", "agent", a.id, { status: "lost" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.transition("org-2", "agent", a.id, { status: "picked_up" })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("picked_up stamps pickedUpAt and does not touch the order", async () => {
    const { svc, orders } = setup();
    const a = await svc.createAssignment("org-1", "agent", { orderId: "ord-1", riderId: "rider-1" });
    const out = await svc.transition("org-1", "agent", a.id, { status: "picked_up" });
    expect(out.status).toBe("picked_up");
    expect(out.pickedUpAt).toBeInstanceOf(Date);
    expect(orders.updateOrder).not.toHaveBeenCalled();
  });

  it("delivered calls updateOrder(completed) BEFORE stamping the assignment", async () => {
    const { svc, orders, events, auditCalls } = setup();
    const a = await svc.createAssignment("org-1", "agent", { orderId: "ord-1", riderId: "rider-1" });
    await svc.transition("org-1", "agent", a.id, { status: "picked_up" });
    events.length = 0;
    const out = await svc.transition("org-1", "agent", a.id, { status: "delivered" });
    expect(orders.updateOrder).toHaveBeenCalledWith("org-1", "agent", "ord-1", { status: "completed" });
    expect(events).toEqual(["updateOrder:ord-1:completed", "assignment:delivered"]); // order of operations
    expect(out.status).toBe("delivered");
    expect(out.deliveredAt).toBeInstanceOf(Date);
    expect(auditCalls.some((c) => c.action === "rider.assignment_transition" && c.metadata.from === "picked_up" && c.metadata.to === "delivered")).toBe(true);
    // delivered is terminal
    await expect(svc.transition("org-1", "agent", a.id, { status: "returned" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("when updateOrder throws, the error propagates and the assignment is UNCHANGED", async () => {
    const { prisma, svc, failUpdateOrder } = setup();
    const a = await svc.createAssignment("org-1", "agent", { orderId: "ord-1", riderId: "rider-1" });
    await svc.transition("org-1", "agent", a.id, { status: "picked_up" });
    failUpdateOrder(new BadRequestException("এই অবস্থা থেকে completed এ যাওয়া যায় না"));
    await expect(svc.transition("org-1", "agent", a.id, { status: "delivered" })).rejects.toThrow("completed");
    const row = prisma.deliveryAssignment.rows.find((r: any) => r.id === a.id);
    expect(row.status).toBe("picked_up");
    expect(row.deliveredAt ?? null).toBeNull();
  });

  it("returned stamps returnedAt and never calls updateOrder", async () => {
    const { svc, orders } = setup();
    const a = await svc.createAssignment("org-1", "agent", { orderId: "ord-1", riderId: "rider-1" });
    const out = await svc.transition("org-1", "agent", a.id, { status: "returned" });
    expect(out.status).toBe("returned");
    expect(out.returnedAt).toBeInstanceOf(Date);
    expect(orders.updateOrder).not.toHaveBeenCalled();
  });
});

describe("DeliveryService listAssignments enrichment + filters", () => {
  it("enriches rider/order facts and filters by rider and Dhaka date", async () => {
    const { svc } = setup();
    const a = await svc.createAssignment("org-1", "agent", { orderId: "ord-1", riderId: "rider-1" });
    const all = await svc.listAssignments("org-1", {});
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: a.id, riderName: "Karim", orderNumber: "1042",
      orderStatus: "processing", orderTotalMinor: "150000", orderAddress: "Mirpur, Dhaka",
    });
    await expect(svc.listAssignments("org-1", { riderId: "rider-off" })).resolves.toHaveLength(0);
    await expect(svc.listAssignments("org-1", { riderId: "rider-1" })).resolves.toHaveLength(1);

    // Dhaka date of "now": format via the same Intl zone the service uses.
    const todayDhaka = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await expect(svc.listAssignments("org-1", { date: todayDhaka })).resolves.toHaveLength(1);
    await expect(svc.listAssignments("org-1", { date: "2020-01-01" })).resolves.toHaveLength(0);
    await expect(svc.listAssignments("org-1", { date: "13/10/2026" })).rejects.toBeInstanceOf(BadRequestException);
  });
});
