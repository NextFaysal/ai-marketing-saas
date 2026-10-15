import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CourierRulesService } from "./courier-rules.service";

/**
 * EC22 — CourierRulesService specs (fake-Prisma makeTable style,
 * after inventory.spec.ts). Matching facts are always REAL rows —
 * a product without weightGrams makes the order weight null and
 * weight-conditioned rules simply never match.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("notIn" in v) return !v.notIn.includes(row[k]);
      if ("gte" in v && !(row[k] != null && new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("lt" in v && !(row[k] != null && new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of [...specs].reverse()) {
    const [field, dir] = Object.entries(spec)[0] as [string, string];
    out.sort((a, b) => {
      const av: any = a[field] instanceof Date ? a[field].getTime() : a[field];
      const bv: any = b[field] instanceof Date ? b[field].getTime() : b[field];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
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
    findFirst: async ({ where, orderBy }: any = {}) => sortRows(rows.filter((r) => matches(r, where)), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let f = sortRows(rows.filter((r) => matches(r, where ?? {})), orderBy);
      if (take) f = f.slice(0, take);
      return f;
    },
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(Date.now() + seq * 1000), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}));
      if (!row) throw new Error(`row not found in ${name}`);
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => matches(r, where ?? {}));
      if (i < 0) throw new Error(`row not found in ${name}`);
      return rows.splice(i, 1)[0];
    },
  };
}

function setup() {
  const prisma: any = {
    courierRule: makeTable("rule"),
    integration: makeTable("integration"),
    order: makeTable("order"),
    orderItem: makeTable("orderItem"),
    product: makeTable("product"),
    customer: makeTable("customer"),
  };
  const auditCalls: any[] = [];
  const audit = { log: jest.fn(async (e: any) => { auditCalls.push(e); }) } as any;
  const svc = new CourierRulesService(prisma as any, audit);
  return { prisma, svc, audit, auditCalls };
}

async function seedAccounts(prisma: any) {
  prisma.integration.rows.push(
    { id: "int-steadfast", organizationId: "org-1", provider: "steadfast", status: "CONNECTED" },
    { id: "int-pathao", organizationId: "org-1", provider: "pathao", status: "CONNECTED" },
    { id: "int-meta", organizationId: "org-1", provider: "meta", status: "CONNECTED" },
    { id: "int-foreign", organizationId: "org-2", provider: "redx", status: "CONNECTED" },
  );
}

describe("CourierRulesService.create validation", () => {
  it("rejects a bad paymentType with a 400 naming the field", async () => {
    const { prisma, svc } = setup(); await seedAccounts(prisma);
    await expect(svc.create("org-1", "owner", {
      name: "R", conditions: { paymentType: "card" }, courierAccountId: "int-steadfast",
    })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("paymentType") });
  });

  it("rejects minWeightGrams > maxWeightGrams, non-positive and non-integer weights", async () => {
    const { prisma, svc } = setup(); await seedAccounts(prisma);
    await expect(svc.create("org-1", "owner", {
      name: "R", conditions: { minWeightGrams: 900, maxWeightGrams: 100 }, courierAccountId: "int-steadfast",
    })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("minWeightGrams") });
    await expect(svc.create("org-1", "owner", {
      name: "R", conditions: { minWeightGrams: 0 }, courierAccountId: "int-steadfast",
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create("org-1", "owner", {
      name: "R", conditions: { maxWeightGrams: 1.5 }, courierAccountId: "int-steadfast",
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects bad districts (non-array, empty string, non-string)", async () => {
    const { prisma, svc } = setup(); await seedAccounts(prisma);
    for (const districts of ["Dhaka", [""], [123], ["Dhaka", " "]]) {
      await expect(svc.create("org-1", "owner", {
        name: "R", conditions: { districts }, courierAccountId: "int-steadfast",
      })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("districts") });
    }
  });

  it("rejects non-object conditions and bad order-minor strings", async () => {
    const { prisma, svc } = setup(); await seedAccounts(prisma);
    await expect(svc.create("org-1", "owner", {
      name: "R", conditions: ["Dhaka"], courierAccountId: "int-steadfast",
    })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("conditions") });
    await expect(svc.create("org-1", "owner", {
      name: "R", conditions: { minOrderMinor: "-5" }, courierAccountId: "int-steadfast",
    })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("minOrderMinor") });
    await expect(svc.create("org-1", "owner", {
      name: "R", conditions: { minOrderMinor: "900", maxOrderMinor: "100" }, courierAccountId: "int-steadfast",
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create("org-1", "owner", {
      name: "R", conditions: { minOrderMinor: 500 }, courierAccountId: "int-steadfast",
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("404s for a foreign or missing courier account", async () => {
    const { prisma, svc } = setup(); await seedAccounts(prisma);
    await expect(svc.create("org-1", "owner", {
      name: "R", conditions: {}, courierAccountId: "int-foreign",
    })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.create("org-1", "owner", {
      name: "R", conditions: {}, courierAccountId: "int-missing",
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("400s for a non-courier integration (provider meta)", async () => {
    const { prisma, svc } = setup(); await seedAccounts(prisma);
    await expect(svc.create("org-1", "owner", {
      name: "R", conditions: {}, courierAccountId: "int-meta",
    })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("এটি কোনো কুরিয়ার অ্যাকাউন্ট নয়") });
  });

  it("creates with the provider snapshot and audits the create", async () => {
    const { prisma, svc, auditCalls } = setup(); await seedAccounts(prisma);
    const rule = await svc.create("org-1", "owner", {
      name: "ঢাকায় Pathao", conditions: { districts: ["Dhaka"] }, courierAccountId: "int-pathao", priority: 5,
    });
    expect(rule.provider).toBe("pathao");
    expect(rule.priority).toBe(5);
    expect(rule.active).toBe(true);
    expect(auditCalls.some((c) => c.action === "courier_rule.created" && c.entityId === rule.id)).toBe(true);
  });

  it("update re-validates the account and remove hard-deletes; both 404 foreign rules", async () => {
    const { prisma, svc } = setup(); await seedAccounts(prisma);
    const rule = await svc.create("org-1", "owner", { name: "R", conditions: {}, courierAccountId: "int-steadfast" });
    const updated = await svc.update("org-1", "owner", rule.id, { courierAccountId: "int-pathao" });
    expect(updated.provider).toBe("pathao");
    await expect(svc.update("org-2", "owner", rule.id, { name: "X" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove("org-2", "owner", rule.id)).rejects.toBeInstanceOf(NotFoundException);
    await svc.remove("org-1", "owner", rule.id);
    expect(prisma.courierRule.rows).toHaveLength(0);
  });
});

describe("CourierRulesService.evaluate (matching matrix)", () => {
  const facts = { district: "Dhaka", totalWeightGrams: 800 as number | null, totalMinor: 150000n, paymentType: "cod" as const };

  function seedRule(prisma: any, over: any = {}) {
    prisma.courierRule.rows.push({
      id: `rule-${prisma.courierRule.rows.length + 1}`, organizationId: "org-1", name: "R",
      conditions: {}, courierAccountId: "int-steadfast", provider: "steadfast",
      priority: 0, active: true, createdAt: new Date(Date.now() + prisma.courierRule.rows.length * 1000), ...over,
    });
  }

  it("matches district / weight / order / payment conditions together", async () => {
    const { prisma, svc } = setup();
    seedRule(prisma, { conditions: { districts: ["Dhaka", "Gazipur"], minWeightGrams: 500, maxWeightGrams: 1000, minOrderMinor: "100000", maxOrderMinor: "200000", paymentType: "cod" } });
    const m = await svc.evaluate("org-1", facts);
    expect(m?.provider).toBe("steadfast");
    expect(m?.courierAccountId).toBe("int-steadfast");
    expect(m?.reason).toContain("জেলা: Dhaka");
  });

  it("does not match when any single condition fails", async () => {
    const { prisma, svc } = setup();
    seedRule(prisma, { conditions: { districts: ["Chattogram"] } });
    seedRule(prisma, { conditions: { paymentType: "prepaid" } });
    seedRule(prisma, { conditions: { minOrderMinor: "150001" } });
    seedRule(prisma, { conditions: { maxWeightGrams: 799 } });
    await expect(svc.evaluate("org-1", facts)).resolves.toBeNull();
  });

  it("weight-null facts never match a weight-conditioned rule, but match others", async () => {
    const { prisma, svc } = setup();
    seedRule(prisma, { id: "w-rule", conditions: { minWeightGrams: 1 }, priority: 10 });
    seedRule(prisma, { id: "d-rule", conditions: { districts: ["Dhaka"] }, priority: 1 });
    const m = await svc.evaluate("org-1", { ...facts, totalWeightGrams: null });
    expect(m?.rule.id).toBe("d-rule");
  });

  it("district-null facts never match a district-conditioned rule", async () => {
    const { prisma, svc } = setup();
    seedRule(prisma, { conditions: { districts: ["Dhaka"] } });
    await expect(svc.evaluate("org-1", { ...facts, district: null })).resolves.toBeNull();
  });

  it("'any' paymentType matches both cod and prepaid; inactive rules are skipped", async () => {
    const { prisma, svc } = setup();
    seedRule(prisma, { id: "off", conditions: {}, active: false, priority: 99 });
    seedRule(prisma, { id: "any", conditions: { paymentType: "any" }, priority: 1 });
    expect((await svc.evaluate("org-1", facts))?.rule.id).toBe("any");
    expect((await svc.evaluate("org-1", { ...facts, paymentType: "prepaid" }))?.rule.id).toBe("any");
  });

  it("priority wins first; createdAt breaks ties (oldest first)", async () => {
    const { prisma, svc } = setup();
    const t0 = new Date("2026-10-01T00:00:00Z");
    seedRule(prisma, { id: "old-low", priority: 1, createdAt: t0 });
    seedRule(prisma, { id: "new-high", priority: 9, createdAt: new Date(t0.getTime() + 5000) });
    expect((await svc.evaluate("org-1", facts))?.rule.id).toBe("new-high");

    const { prisma: p2, svc: s2 } = setup();
    seedRule(p2, { id: "first", priority: 5, createdAt: t0 });
    seedRule(p2, { id: "second", priority: 5, createdAt: new Date(t0.getTime() + 5000) });
    expect((await s2.evaluate("org-1", facts))?.rule.id).toBe("first");
  });

  it("an unconditional rule matches anything; no rules => null", async () => {
    const { prisma, svc } = setup();
    await expect(svc.evaluate("org-1", facts)).resolves.toBeNull();
    seedRule(prisma, { conditions: {} });
    expect(await svc.evaluate("org-1", { district: null, totalWeightGrams: null, totalMinor: 0n, paymentType: "prepaid" })).not.toBeNull();
  });
});

describe("CourierRulesService.factsForOrder + suggestion", () => {
  async function seedOrder(prisma: any, weights: (number | null)[]) {
    prisma.customer.rows.push({
      id: "cus-1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin",
      address: { district: "Dhaka", city: "Dhaka", line: "Mirpur" },
    });
    prisma.order.rows.push({
      id: "ord-1", organizationId: "org-1", customerId: "cus-1", isCod: true, totalMinor: 150000n,
    });
    for (let i = 0; i < weights.length; i++) {
      prisma.product.rows.push({ id: `prod-${i}`, organizationId: "org-1", name: `P${i}`, weightGrams: weights[i] });
      prisma.orderItem.rows.push({ id: `item-${i}`, orderId: "ord-1", productId: `prod-${i}`, quantity: 2, name: `P${i}` });
    }
    return prisma.order.rows[0];
  }

  it("reads the district from the customer Json and sums complete weights", async () => {
    const { prisma, svc } = setup();
    const order = await seedOrder(prisma, [300, 100]);
    const facts = await svc.factsForOrder("org-1", order);
    expect(facts.district).toBe("Dhaka");
    expect(facts.totalWeightGrams).toBe(300 * 2 + 100 * 2);
    expect(facts.totalMinor).toBe(150000n);
    expect(facts.paymentType).toBe("cod");
  });

  it("weight is null when one product lacks weightGrams — never invented", async () => {
    const { prisma, svc } = setup();
    const order = await seedOrder(prisma, [300, null]);
    const facts = await svc.factsForOrder("org-1", order);
    expect(facts.totalWeightGrams).toBeNull();
  });

  it("weight is null when a line has no product link; district null without a customer", async () => {
    const { prisma, svc } = setup();
    prisma.order.rows.push({ id: "ord-9", organizationId: "org-1", customerId: null, isCod: false, totalMinor: 5000n });
    prisma.orderItem.rows.push({ id: "i-1", orderId: "ord-9", productId: null, quantity: 1, name: "X" });
    const facts = await svc.factsForOrder("org-1", prisma.order.rows[0]);
    expect(facts.totalWeightGrams).toBeNull();
    expect(facts.district).toBeNull();
    expect(facts.paymentType).toBe("prepaid");
  });

  it("suggestion returns the match, the honest no-match shape, and 404s foreign orders", async () => {
    const { prisma, svc } = setup(); await seedAccounts(prisma);
    const order = await seedOrder(prisma, [300]);
    await svc.create("org-1", "owner", { name: "ঢাকার নিয়ম", conditions: { districts: ["Dhaka"] }, courierAccountId: "int-pathao" });
    const sug = await svc.suggestion("org-1", order.id);
    expect(sug).toMatchObject({ ruleName: "ঢাকার নিয়ম", provider: "pathao", courierAccountId: "int-pathao" });
    expect(sug.ruleId).toBeTruthy();

    const { prisma: p2, svc: s2 } = setup();
    p2.order.rows.push({ id: "ord-x", organizationId: "org-1", customerId: null, isCod: true, totalMinor: 100n });
    await expect(s2.suggestion("org-1", "ord-x")).resolves.toEqual({
      ruleId: null, ruleName: null, provider: null, courierAccountId: null,
      reason: "কোনো সক্রিয় নিয়ম এই অর্ডারের সঙ্গে মেলেনি",
    });
    await expect(s2.suggestion("org-2", "ord-x")).rejects.toBeInstanceOf(NotFoundException);
  });
});
