import "reflect-metadata";
import { CustomersService } from "./customers.service";

/**
 * ON7 — Customer খাতা (ledger) specs: due from APPROVED
 * verifications only, dead-status exclusion, aging bucket
 * boundaries, credit-limit math, credit-limit update validation,
 * and the list dueMinor / hasDue surface.
 * Fake-Prisma in the neighbouring makeTable style (with the
 * groupBy the bulk approved-sum path uses).
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v && !v.in.map(String).includes(String(row[k]))) return false;
      if ("notIn" in v && v.notIn.map(String).includes(String(row[k]))) return false;
      if ("not" in v && row[k] === v.not) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return String(row[k]) === String(v);
  });
}

function applyOrderBy(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of [...specs].reverse()) {
    const [key, dir] = Object.entries(spec)[0] as [string, string];
    out.sort((a, b) => {
      const av = a[key]; const bv = b[key];
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av instanceof Date || bv instanceof Date
        ? new Date(av).getTime() - new Date(bv).getTime()
        : av < bv ? -1 : 1;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  return out;
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) =>
      applyOrderBy(rows.filter((r) => matches(r, where)), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let f = applyOrderBy(rows.filter((r) => matches(r, where ?? {})), orderBy);
      if (skip) f = f.slice(skip);
      if (take !== undefined) f = f.slice(0, take);
      return f;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error(`row not found in ${name}`);
      Object.assign(row, data);
      return row;
    },
    groupBy: async ({ by, where }: any) => {
      const sums = new Map<string, bigint>();
      for (const r of rows.filter((x) => matches(x, where))) {
        const key = String(r[by[0]]);
        sums.set(key, (sums.get(key) ?? 0n) + BigInt(r.amountMinor ?? 0));
      }
      return [...sums.entries()].map(([k, s]) => ({ [by[0]]: k, _sum: { amountMinor: s } }));
    },
  };
}

function setup() {
  const prisma: any = {
    customer: makeTable("customer"),
    order: makeTable("order"),
    orderItem: makeTable("item"),
    paymentVerification: makeTable("pv"),
    channelConversation: makeTable("conv"),
    courierShipment: makeTable("shipment"),
    lead: makeTable("lead"),
    customerStoreIdentity: makeTable("identity"),
    store: makeTable("store"),
    auditLog: makeTable("audit"),
  };
  const audit: any = { log: jest.fn(async () => undefined) };
  const svc = new CustomersService(prisma, audit);
  return { prisma, svc, audit };
}

const DAY = 86400000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY - 3600000); // -1h slack: floor(age) == n

let custSeq = 0;
function seedCustomer(prisma: any, over: any = {}) {
  const row = {
    id: `cust-${++custSeq}`, organizationId: "org-1", firstName: "Rahim", lastName: "Uddin",
    phone: "01711000001", email: null, referralCode: null, creditLimitMinor: null,
    mergedIntoId: null, isWholesale: false, customFields: null,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  prisma.customer.rows.push(row);
  return row;
}

let ordSeq = 0;
function seedOrder(prisma: any, customerId: string, over: any = {}) {
  const row = {
    id: `ord-${++ordSeq}`, organizationId: "org-1", customerId, source: "manual",
    externalId: `ext-${ordSeq}`, externalNumber: `100${ordSeq}`, status: "processing",
    isPractice: false, totalMinor: 100000n, subtotalMinor: 100000n, shippingMinor: 0n,
    discountMinor: 0n, taxMinor: 0n, refundedMinor: 0n, currency: "BDT",
    placedAt: daysAgo(1), createdAt: daysAgo(1), ...over,
  };
  prisma.order.rows.push(row);
  return row;
}

function seedPv(prisma: any, orderId: string, status: string, amount: bigint) {
  prisma.paymentVerification.rows.push({
    id: `pv-${prisma.paymentVerification.rows.length + 1}`, organizationId: "org-1",
    orderId, status, amountMinor: amount, createdAt: new Date(),
  });
}

beforeEach(() => { custSeq = 0; ordSeq = 0; });

// ------------------------------------------------------------------

describe("ON7 khata due math", () => {
  it("due counts APPROVED verifications only — pending and rejected are excluded", async () => {
    const { prisma, svc } = setup();
    const c = seedCustomer(prisma);
    const o = seedOrder(prisma, c.id, { totalMinor: 100000n });
    seedPv(prisma, o.id, "approved", 40000n);
    seedPv(prisma, o.id, "pending", 30000n);
    seedPv(prisma, o.id, "rejected", 20000n);
    const khata: any = await svc.getKhata("org-1", c.id);
    expect(khata.totalDueMinor).toBe("60000");
    expect(khata.orders).toHaveLength(1);
    expect(khata.orders[0].paidMinor).toBe("40000");
    expect(khata.orders[0].dueMinor).toBe("60000");
  });

  it("cancelled / refunded / returned / failed orders are excluded from totalDue AND aging", async () => {
    const { prisma, svc } = setup();
    const c = seedCustomer(prisma);
    seedOrder(prisma, c.id, { totalMinor: 10000n, placedAt: daysAgo(40), createdAt: daysAgo(40) }); // open, old
    for (const status of ["cancelled", "refunded", "returned", "failed"]) {
      seedOrder(prisma, c.id, { status, totalMinor: 90000n, placedAt: daysAgo(40), createdAt: daysAgo(40) });
    }
    const khata: any = await svc.getKhata("org-1", c.id);
    expect(khata.totalDueMinor).toBe("10000"); // only the open order
    expect(khata.aging.d30plus).toBe("10000");
    expect(khata.aging.d0_7).toBe("0");
    // The PAGE still lists every order (dead ones show their raw due there).
    expect(khata.orders).toHaveLength(5);
  });

  it("aging boundaries: 7d in d0_7, 8d in d8_15, 15d in d8_15, 16d in d16_30, 30d in d16_30, 31d in d30plus", async () => {
    const { prisma, svc } = setup();
    const c = seedCustomer(prisma);
    const cases: Array<[number, bigint]> = [
      [7, 1000n], [8, 2000n], [15, 4000n], [16, 8000n], [30, 16000n], [31, 32000n],
    ];
    for (const [days, amount] of cases) {
      seedOrder(prisma, c.id, { totalMinor: amount, placedAt: daysAgo(days), createdAt: daysAgo(days) });
    }
    const khata: any = await svc.getKhata("org-1", c.id);
    expect(khata.aging.d0_7).toBe("1000");
    expect(khata.aging.d8_15).toBe("6000"); // 2000 + 4000
    expect(khata.aging.d16_30).toBe("24000"); // 8000 + 16000
    expect(khata.aging.d30plus).toBe("32000");
    expect(khata.totalDueMinor).toBe("63000");
  });
});

// ------------------------------------------------------------------

describe("ON7 credit limit", () => {
  it("over-limit + available credit, including a NEGATIVE available credit (never floored)", async () => {
    const { prisma, svc } = setup();
    const c = seedCustomer(prisma, { creditLimitMinor: 50000n });
    seedOrder(prisma, c.id, { totalMinor: 80000n });
    const khata: any = await svc.getKhata("org-1", c.id);
    expect(khata.creditLimitMinor).toBe("50000");
    expect(khata.totalDueMinor).toBe("80000");
    expect(khata.overLimit).toBe(true);
    expect(khata.availableCreditMinor).toBe("-30000");
  });

  it("under the limit: overLimit false and positive available credit; no limit → nulls", async () => {
    const { prisma, svc } = setup();
    const c = seedCustomer(prisma, { creditLimitMinor: 50000n });
    seedOrder(prisma, c.id, { totalMinor: 20000n });
    const khata: any = await svc.getKhata("org-1", c.id);
    expect(khata.overLimit).toBe(false);
    expect(khata.availableCreditMinor).toBe("30000");

    const c2 = seedCustomer(prisma, { creditLimitMinor: null });
    seedOrder(prisma, c2.id, { totalMinor: 20000n });
    const khata2: any = await svc.getKhata("org-1", c2.id);
    expect(khata2.creditLimitMinor).toBeNull();
    expect(khata2.overLimit).toBe(false);
    expect(khata2.availableCreditMinor).toBeNull();
  });

  it("credit-limit update: valid string stored as BigInt, null clears, garbage → 400", async () => {
    const { prisma, svc } = setup();
    const c = seedCustomer(prisma);
    const updated: any = await svc.update("org-1", "actor-1", c.id, { creditLimitMinor: "75000" });
    expect(prisma.customer.rows[0].creditLimitMinor).toBe(75000n);
    expect(updated.customer.creditLimitMinor).toBe("75000");

    const cleared: any = await svc.update("org-1", "actor-1", c.id, { creditLimitMinor: null });
    expect(prisma.customer.rows[0].creditLimitMinor).toBeNull();
    expect(cleared.customer.creditLimitMinor).toBeNull();

    await expect(svc.update("org-1", "actor-1", c.id, { creditLimitMinor: "abc" })).rejects.toThrow(/ক্রেডিট লিমিট সঠিক নয়/);
    await expect(svc.update("org-1", "actor-1", c.id, { creditLimitMinor: "-500" })).rejects.toThrow(/ক্রেডিট লিমিট সঠিক নয়/);
    await expect(svc.update("org-1", "actor-1", c.id, { creditLimitMinor: "10.5" })).rejects.toThrow(/ক্রেডিট লিমিট সঠিক নয়/);
  });
});

// ------------------------------------------------------------------

describe("ON7 customer list due surface", () => {
  it("list rows carry dueMinor (approved-only, dead statuses excluded)", async () => {
    const { prisma, svc } = setup();
    const c1 = seedCustomer(prisma, { firstName: "Due" });
    const o1 = seedOrder(prisma, c1.id, { totalMinor: 100000n });
    seedPv(prisma, o1.id, "approved", 25000n);
    seedPv(prisma, o1.id, "pending", 70000n); // must not reduce the due
    seedOrder(prisma, c1.id, { status: "cancelled", totalMinor: 50000n }); // excluded
    const c2 = seedCustomer(prisma, { firstName: "Clear" });
    const o2 = seedOrder(prisma, c2.id, { totalMinor: 30000n });
    seedPv(prisma, o2.id, "approved", 30000n); // fully paid

    const rows: any[] = await svc.list("org-1");
    const r1 = rows.find((r) => r.id === c1.id);
    const r2 = rows.find((r) => r.id === c2.id);
    expect(r1.dueMinor).toBe("75000");
    expect(r2.dueMinor).toBe("0");
  });

  it("hasDue filter returns ONLY customers with due > 0", async () => {
    const { prisma, svc } = setup();
    const c1 = seedCustomer(prisma, { firstName: "Due" });
    seedOrder(prisma, c1.id, { totalMinor: 40000n });
    const c2 = seedCustomer(prisma, { firstName: "Paid" });
    const o2 = seedOrder(prisma, c2.id, { totalMinor: 30000n });
    seedPv(prisma, o2.id, "approved", 30000n);
    seedCustomer(prisma, { firstName: "NoOrders" });

    const all: any[] = await svc.list("org-1");
    expect(all).toHaveLength(3);
    const filtered: any[] = await svc.list("org-1", undefined, { hasDue: true });
    expect(filtered.map((r) => r.id)).toEqual([c1.id]);
    expect(filtered[0].dueMinor).toBe("40000");
  });
});
