import "reflect-metadata";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AffiliatesService } from "./affiliates.service";

/**
 * EC32 — affiliate program: attribution stamps (enabled/active/
 * self-dealing rules), commission creation on the EC33 sold
 * definition with round-half-up math and exactly-once semantics,
 * voiding on cancel / full refund (paid entries never voided),
 * the FIFO payout model and its outstanding guard, and the staff
 * CRUD validations. Fake prisma in the ec31 style.
 */

type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}

function applyOrder(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const out = [...rows];
  if (orderBy.createdAt === "desc") out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (orderBy.createdAt === "asc") out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return out;
}

/** Event handlers are fire-and-forget by design (EventsService
 * discipline); flush pending microtasks before asserting. */
const flush = () => new Promise((r) => setTimeout(r, 10));

class FakeEvents {
  handlers = new Map<string, ((p: any) => void)[]>();
  on(event: string, handler: (p: any) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }
  async fire(event: string, payload: any) {
    for (const h of this.handlers.get(event) ?? []) await h(payload);
  }
}

function setup(opts: { setting?: Row } = {}) {
  let seq = 0;
  let clock = 0;
  const nextDate = () => new Date(1_700_000_000_000 + ++clock * 1000);

  const setting: Row = {
    id: "set-1",
    organizationId: "org-1",
    affiliateEnabled: true,
    affiliateDefaultPercent: null,
    affiliateAttributionDays: 30,
    ...(opts.setting ?? {}),
  };
  const partners: Row[] = [
    {
      id: "partner-1", organizationId: "org-1", name: "Rafi Partner",
      phone: "01711111111", email: null, code: "AFFXYZ12",
      commissionPercent: 15, status: "active", note: null,
      createdAt: nextDate(), updatedAt: nextDate(),
    },
    {
      id: "partner-2", organizationId: "org-1", name: "Second Partner",
      phone: "01922222222", email: null, code: "AFFSEC22",
      commissionPercent: 10, status: "active", note: null,
      createdAt: nextDate(), updatedAt: nextDate(),
    },
    {
      id: "partner-foreign", organizationId: "org-2", name: "Foreign",
      phone: "01633333333", email: null, code: "AFFFOR33",
      commissionPercent: 10, status: "active", note: null,
      createdAt: nextDate(), updatedAt: nextDate(),
    },
  ];
  const orders: Row[] = [];
  const shipments: Row[] = [];
  const entries: Row[] = [];
  const payouts: Row[] = [];

  const table = (rows: Row[], prefix: string) => ({
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null),
    findMany: jest.fn(async ({ where, orderBy, skip = 0, take }: any = {}) => {
      let out = applyOrder(rows.filter((r) => matches(r, where)), orderBy);
      out = out.slice(skip, take === undefined ? undefined : skip + take);
      return out;
    }),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length),
    create: jest.fn(async ({ data }: any) => {
      const row: Row = {
        id: `${prefix}-${++seq}`, createdAt: nextDate(), updatedAt: nextDate(),
        status: data.status ?? undefined, voidReason: null, ...data,
      };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data, { updatedAt: nextDate() });
      return row;
    }),
  });

  const prisma: any = {
    storefrontSetting: {
      findFirst: jest.fn(async ({ where }: any = {}) =>
        matches(setting, where) ? setting : null),
    },
    affiliatePartner: table(partners, "partner"),
    commissionEntry: table(entries, "entry"),
    affiliatePayout: table(payouts, "payout"),
    order: table(orders, "order"),
    courierShipment: {
      findMany: jest.fn(async ({ where }: any = {}) => shipments.filter((r) => matches(r, where))),
    },
  };
  const audit: any = { log: jest.fn(async () => undefined) };
  const events = new FakeEvents();
  const svc = new AffiliatesService(prisma, audit, events as any);

  const addOrder = (over: Row = {}): Row => {
    const row: Row = {
      id: `order-${++seq}`, organizationId: "org-1",
      source: "manual", externalId: `ext-${seq}`, externalNumber: `ORD-${1000 + seq}`,
      status: "completed", subtotalMinor: 10999n, discountMinor: 1000n,
      totalMinor: 9999n, refundedMinor: 0n,
      affiliatePartnerId: "partner-1", affiliateCode: "AFFXYZ12",
      createdAt: nextDate(), updatedAt: nextDate(), ...over,
    };
    orders.push(row);
    return row;
  };
  const addEntry = (over: Row = {}): Row => {
    const row: Row = {
      id: `entry-seed-${++seq}`, organizationId: "org-1", partnerId: "partner-1",
      orderId: "order-x", baseMinor: 10000n, percentSnapshot: 10,
      commissionMinor: 1000n, status: "pending", voidReason: null,
      createdAt: nextDate(), updatedAt: nextDate(), ...over,
    };
    entries.push(row);
    return row;
  };

  return { svc, prisma, audit, events, setting, partners, orders, shipments, entries, payouts, addOrder, addEntry };
}

describe("EC32 attribution stamp", () => {
  it("stamps partner + presented code when enabled and partner is active", async () => {
    const { svc, addOrder } = setup();
    const order = addOrder({ affiliatePartnerId: null, affiliateCode: null });
    await svc.stampAttribution("org-1", "manual", order.externalId, " affxyz12 ", "01822222222");
    expect(order.affiliatePartnerId).toBe("partner-1");
    // The code is kept AS PRESENTED (trimmed) for audit.
    expect(order.affiliateCode).toBe("affxyz12");
  });

  it("is ignored when the program is disabled", async () => {
    const { svc, addOrder } = setup({ setting: { affiliateEnabled: false } });
    const order = addOrder({ affiliatePartnerId: null, affiliateCode: null });
    await svc.stampAttribution("org-1", "manual", order.externalId, "AFFXYZ12", "01822222222");
    expect(order.affiliatePartnerId).toBeNull();
  });

  it("is ignored for a paused partner and for an unknown code", async () => {
    const { svc, partners, addOrder } = setup();
    partners[0].status = "paused";
    const o1 = addOrder({ affiliatePartnerId: null, affiliateCode: null });
    await svc.stampAttribution("org-1", "manual", o1.externalId, "AFFXYZ12", "01822222222");
    expect(o1.affiliatePartnerId).toBeNull();

    partners[0].status = "active";
    const o2 = addOrder({ affiliatePartnerId: null, affiliateCode: null });
    await svc.stampAttribution("org-1", "manual", o2.externalId, "NOSUCH99", "01822222222");
    expect(o2.affiliatePartnerId).toBeNull();
  });

  it("self-dealing guard: partner phone == buyer phone (loose match) stamps nothing", async () => {
    const { svc, addOrder } = setup();
    const order = addOrder({ affiliatePartnerId: null, affiliateCode: null });
    // Partner phone is 01711111111; buyer presents the +880 form.
    await svc.stampAttribution("org-1", "manual", order.externalId, "AFFXYZ12", "+8801711111111");
    expect(order.affiliatePartnerId).toBeNull();
  });

  it("never throws on a blank code", async () => {
    const { svc, addOrder } = setup();
    const order = addOrder({ affiliatePartnerId: null, affiliateCode: null });
    await expect(
      svc.stampAttribution("org-1", "manual", order.externalId, "   ", "01822222222"),
    ).resolves.toBeUndefined();
    expect(order.affiliatePartnerId).toBeNull();
  });
});

describe("EC32 commission creation", () => {
  it("math: base = subtotal − discount, round-half-up (9999 @ 15% = 1500)", async () => {
    const { svc, addOrder, entries } = setup();
    const order = addOrder(); // subtotal 10999 − discount 1000 = base 9999, completed
    const entry = await svc.maybeCreateCommission("org-1", order.id);
    expect(entries).toHaveLength(1);
    expect(entry.baseMinor).toBe(9999n);
    expect(entry.percentSnapshot).toBe(15);
    expect(entry.commissionMinor).toBe(1500n);
    expect(entry.status).toBe("pending");
  });

  it("exactly-once: repeated calls + repeated delivered events create one entry", async () => {
    const { svc, events, addOrder, entries } = setup();
    const order = addOrder();
    await svc.maybeCreateCommission("org-1", order.id);
    await svc.maybeCreateCommission("org-1", order.id);
    await events.fire("order.delivered", { organizationId: "org-1", context: { orderId: order.id } });
    await events.fire("order.delivered", { organizationId: "org-1", context: { orderId: order.id } });
    await flush();
    expect(entries).toHaveLength(1);
  });

  it("no entry for a not-sold-yet order (processing, no delivered shipment)", async () => {
    const { svc, addOrder, entries } = setup();
    const order = addOrder({ status: "processing" });
    const out = await svc.maybeCreateCommission("org-1", order.id);
    expect(out).toBeNull();
    expect(entries).toHaveLength(0);
  });

  it("sold via a delivered shipment while still processing creates the entry", async () => {
    const { svc, addOrder, shipments, entries } = setup();
    const order = addOrder({ status: "processing" });
    shipments.push({ id: "sh-1", organizationId: "org-1", orderId: order.id, status: "delivered" });
    const entry = await svc.maybeCreateCommission("org-1", order.id);
    expect(entry).not.toBeNull();
    expect(entries).toHaveLength(1);
  });

  it("no entry for a dead order, an unattributed order, or a fully-discounted order", async () => {
    const { svc, addOrder, shipments, entries } = setup();
    const dead = addOrder({ status: "cancelled" });
    shipments.push({ id: "sh-2", organizationId: "org-1", orderId: dead.id, status: "delivered" });
    expect(await svc.maybeCreateCommission("org-1", dead.id)).toBeNull();

    const plain = addOrder({ affiliatePartnerId: null, affiliateCode: null });
    expect(await svc.maybeCreateCommission("org-1", plain.id)).toBeNull();

    const free = addOrder({ subtotalMinor: 5000n, discountMinor: 5000n });
    expect(await svc.maybeCreateCommission("org-1", free.id)).toBeNull();
    expect(entries).toHaveLength(0);
  });
});

describe("EC32 voiding", () => {
  it("voids pending + approved on cancel; paid entries are untouched", async () => {
    const { svc, addEntry } = setup();
    const pending = addEntry({ orderId: "o-void", status: "pending" });
    const approved = addEntry({ orderId: "o-void", status: "approved" });
    const paid = addEntry({ orderId: "o-void", status: "paid" });
    const n = await svc.maybeVoidForOrder("org-1", "o-void", "order_cancelled");
    expect(n).toBe(2);
    expect(pending.status).toBe("voided");
    expect(pending.voidReason).toBe("order_cancelled");
    expect(approved.status).toBe("voided");
    expect(paid.status).toBe("paid");
  });

  it("status_changed to cancelled voids through the event handler", async () => {
    const { svc, events, addEntry } = setup();
    const entry = addEntry({ orderId: "o-ev", status: "pending" });
    await events.fire("order.status_changed", {
      organizationId: "org-1",
      context: { orderId: "o-ev", from: "processing", to: "cancelled" },
    });
    await flush();
    expect(entry.status).toBe("voided");
    expect(entry.voidReason).toBe("order_cancelled");
  });

  it("paid entry on a refunded order is NOT voided and is flagged on the partner detail", async () => {
    const { svc, addOrder, addEntry } = setup();
    const order = addOrder({ status: "refunded" });
    const paid = addEntry({ orderId: order.id, status: "paid" });
    await svc.maybeVoidForOrder("org-1", order.id, "order_refunded");
    expect(paid.status).toBe("paid");
    const detail = await svc.getPartnerDetail("org-1", "partner-1");
    expect(detail.paidOnRefundedOrders).toBe(1);
  });

  it("full refund via the refunded event voids pending/approved", async () => {
    const { svc, events, addOrder, addEntry } = setup();
    const order = addOrder({ totalMinor: 9999n });
    const entry = addEntry({ orderId: order.id, status: "approved" });
    await events.fire("order.refunded", {
      organizationId: "org-1",
      context: { orderId: order.id, amountMinor: "9999", cumulativeRefundedMinor: "9999" },
    });
    await flush();
    expect(entry.status).toBe("voided");
    expect(entry.voidReason).toBe("order_fully_refunded");
  });

  it("partial refund does NOT void", async () => {
    const { svc, addOrder, addEntry } = setup();
    const order = addOrder({ totalMinor: 9999n });
    const entry = addEntry({ orderId: order.id, status: "pending" });
    const n = await svc.maybeVoidForFullRefund("org-1", order.id, "4000");
    expect(n).toBe(0);
    expect(entry.status).toBe("pending");
  });
});

describe("EC32 payouts (FIFO)", () => {
  function payoutSetup() {
    const ctx = setup();
    const e1 = ctx.addEntry({ orderId: "o-p1", status: "approved", commissionMinor: 10000n });
    const e2 = ctx.addEntry({ orderId: "o-p2", status: "approved", commissionMinor: 10000n });
    const e3 = ctx.addEntry({ orderId: "o-p3", status: "pending", commissionMinor: 5000n });
    return { ...ctx, e1, e2, e3 };
  }

  it("guard: amount above the outstanding approved balance is a 400", async () => {
    const { svc } = payoutSetup();
    await expect(
      svc.recordPayout("org-1", "actor-1", "partner-1", { amountMinor: "20001", method: "bkash" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.recordPayout("org-1", "actor-1", "partner-1", { amountMinor: "0", method: "bkash" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.recordPayout("org-1", "actor-1", "partner-1", { amountMinor: "100", method: "rocket" as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("FIFO flip: partial coverage flips only fully-covered entries; pending never flips", async () => {
    const { svc, e1, e2, e3 } = payoutSetup();
    const out = await svc.recordPayout("org-1", "actor-1", "partner-1", {
      amountMinor: "15000", method: "bkash", reference: "TRX1",
    });
    expect(out.payout.amountMinor).toBe("15000");
    expect(e1.status).toBe("paid"); // cumulative 10000 <= 15000
    expect(e2.status).toBe("approved"); // cumulative 20000 > 15000 — partial stays approved
    expect(e3.status).toBe("pending"); // pending entries never flip
    expect(out.balances.paidMinor).toBe("10000");
    expect(out.balances.paidOutMinor).toBe("15000");
    // outstanding = stored approved (10000) − unapplied payouts (15000 − 10000)
    expect(out.balances.outstandingApprovedMinor).toBe("5000");

    const out2 = await svc.recordPayout("org-1", "actor-1", "partner-1", {
      amountMinor: "5000", method: "cash",
    });
    expect(e2.status).toBe("paid");
    expect(out2.balances.outstandingApprovedMinor).toBe("0");
  });

  it("listPayouts returns the recorded payouts (records only — no money is sent)", async () => {
    const { svc } = payoutSetup();
    await svc.recordPayout("org-1", "actor-1", "partner-1", { amountMinor: "10000", method: "nagad" });
    const list = await svc.listPayouts("org-1", "partner-1");
    expect(list.total).toBe(1);
    expect(list.items[0].method).toBe("nagad");
    expect(list.items[0].amountMinor).toBe("10000");
  });
});

describe("EC32 partners CRUD + entries staff ops", () => {
  it("create: generated code shape + default percent from settings, else 10", async () => {
    const { svc } = setup({ setting: { affiliateDefaultPercent: 20 } });
    const created = await svc.createPartner("org-1", "actor-1", {
      name: "New Partner", phone: "01544444444",
    } as any);
    expect(created.code).toMatch(/^AFF[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(created.commissionPercent).toBe(20);

    const { svc: svc2 } = setup();
    const created2 = await svc2.createPartner("org-1", "actor-1", {
      name: "Plain", phone: "01555555555",
    } as any);
    expect(created2.commissionPercent).toBe(10);
  });

  it("create: an explicit code is normalized (trim + uppercase)", async () => {
    const { svc } = setup();
    const created = await svc.createPartner("org-1", "actor-1", {
      name: "Coded", phone: "01566666666", code: " mycode7 ",
    } as any);
    expect(created.code).toBe("MYCODE7");
  });

  it("percent validation: 51 and -1 are 400s on create and update", async () => {
    const { svc } = setup();
    await expect(
      svc.createPartner("org-1", "actor-1", { name: "X", phone: "01577777777", commissionPercent: 51 } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.createPartner("org-1", "actor-1", { name: "X", phone: "01577777777", commissionPercent: -1 } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.updatePartner("org-1", "actor-1", "partner-1", { commissionPercent: 51 } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    const ok = await svc.updatePartner("org-1", "actor-1", "partner-1", { commissionPercent: 50 } as any);
    expect(ok.commissionPercent).toBe(50);
    const zero = await svc.updatePartner("org-1", "actor-1", "partner-1", { commissionPercent: 0 } as any);
    expect(zero.commissionPercent).toBe(0);
  });

  it("code clash is a 400 on create and on update", async () => {
    const { svc } = setup();
    await expect(
      svc.createPartner("org-1", "actor-1", { name: "X", phone: "01577777777", code: "affxyz12" } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.updatePartner("org-1", "actor-1", "partner-2", { code: "AFFXYZ12" } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Keeping your own code is fine.
    const same = await svc.updatePartner("org-1", "actor-1", "partner-1", { code: "affxyz12" } as any);
    expect(same.code).toBe("AFFXYZ12");
  });

  it("pause via update status blocks new attribution", async () => {
    const { svc, addOrder } = setup();
    await svc.updatePartner("org-1", "actor-1", "partner-1", { status: "paused" } as any);
    const order = addOrder({ affiliatePartnerId: null, affiliateCode: null });
    await svc.stampAttribution("org-1", "manual", order.externalId, "AFFXYZ12", "01822222222");
    expect(order.affiliatePartnerId).toBeNull();
  });

  it("foreign partner / entry are 404s", async () => {
    const { svc, addEntry } = setup();
    await expect(svc.getPartner("org-1", "partner-foreign")).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc.updatePartner("org-1", "actor-1", "partner-foreign", { name: "Hax" } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc.recordPayout("org-1", "actor-1", "partner-foreign", { amountMinor: "1", method: "cash" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const foreignEntry = addEntry({ organizationId: "org-2", orderId: "o-f" });
    await expect(svc.approveEntry("org-1", "actor-1", foreignEntry.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("approve: pending → approved only; a second approve is a 400", async () => {
    const { svc, addOrder, addEntry } = setup();
    const order = addOrder();
    void order;
    const entry = addEntry({ orderId: order.id, status: "pending" });
    const approved = await svc.approveEntry("org-1", "actor-1", entry.id);
    expect(approved.status).toBe("approved");
    expect(approved.orderNumber).toBe(order.externalNumber);
    expect(approved.partnerName).toBe("Rafi Partner");
    await expect(svc.approveEntry("org-1", "actor-1", entry.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("listEntries filters by partner + status and joins display fields", async () => {
    const { svc, addOrder, addEntry } = setup();
    const order = addOrder();
    addEntry({ orderId: order.id, status: "pending" });
    addEntry({ orderId: order.id, status: "voided", partnerId: "partner-2" });
    const all = await svc.listEntries("org-1", {});
    expect(all.total).toBe(2);
    const filtered = await svc.listEntries("org-1", { partnerId: "partner-1", status: "pending" });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].orderNumber).toBe(order.externalNumber);
    expect(filtered.items[0].partnerName).toBe("Rafi Partner");
  });

  it("listPartners carries per-partner aggregates", async () => {
    const { svc, addEntry } = setup();
    addEntry({ status: "pending", commissionMinor: 700n });
    addEntry({ status: "paid", commissionMinor: 300n });
    const list = await svc.listPartners("org-1");
    const p1 = list.items.find((p: any) => p.id === "partner-1") as any;
    expect(p1.aggregates.entries.pending).toEqual({ count: 1, commissionMinor: "700" });
    expect(p1.aggregates.entries.paid).toEqual({ count: 1, commissionMinor: "300" });
    expect(p1.aggregates.payoutsTotalMinor).toBe("0");
  });
});
