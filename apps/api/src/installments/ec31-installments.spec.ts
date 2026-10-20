import "reflect-metadata";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { InstallmentsService } from "./installments.service";

/**
 * EC31 — installment plans: split identity, EC19-coherent
 * collections (the collection IS an approved PaymentVerification
 * row, so the order due drops by construction), one plan per
 * order lifetime, any-order collection, exactly-once due
 * reminders with EC28-style honesty, the due worklist and the
 * tracking summary. Fake prisma in the ec19 style, extended for
 * InstallmentPlan's nested items.create.
 */

// ---------- Dhaka day helpers (mirror of the service's) ----------
function dhakaDayString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 24 * 3600 * 1000);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
function dayToDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const TODAY = dhakaDayString(new Date());

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

function setup(opts: { smsMode?: "ok" | "notConfigured" | "fail" } = {}) {
  const orders: Row[] = [
    {
      id: "o1", organizationId: "org-1", customerId: "c1",
      externalNumber: "1001", totalMinor: 100000n,
      conversationId: "conv-1", codConversationId: null,
    },
    {
      id: "o2", organizationId: "org-1", customerId: "c1",
      externalNumber: "1002", totalMinor: 60000n,
      conversationId: null, codConversationId: "cod-conv-2",
    },
  ];
  const customers: Row[] = [
    { id: "c1", organizationId: "org-1", firstName: "Test", lastName: "Customer", phone: "01711111111" },
  ];
  const pvRows: Row[] = [];
  const plans: Row[] = [];
  const items: Row[] = [];
  let pvSeq = 0, planSeq = 0, itemSeq = 0, clock = 0;
  const nextDate = () => new Date(Date.now() + ++clock);

  const attachItems = (plan: Row, include: any) => {
    if (!include?.items) return plan;
    return { ...plan, items: items.filter((i) => i.planId === plan.id) };
  };

  const prisma: any = {
    order: {
      findFirst: jest.fn(async ({ where }: any) => orders.find((r) => matches(r, where)) ?? null),
    },
    customer: {
      findFirst: jest.fn(async ({ where }: any) => customers.find((r) => matches(r, where)) ?? null),
    },
    paymentVerification: {
      findMany: jest.fn(async ({ where }: any = {}) => pvRows.filter((r) => matches(r, where))),
      findFirst: jest.fn(async ({ where }: any) => pvRows.find((r) => matches(r, where)) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `pv-${++pvSeq}`, createdAt: nextDate(), ...data };
        pvRows.push(row);
        return row;
      }),
    },
    installmentPlan: {
      findFirst: jest.fn(async ({ where, include }: any = {}) => {
        const row = plans.find((r) => matches(r, where)) ?? null;
        return row ? attachItems(row, include) : null;
      }),
      findMany: jest.fn(async ({ where, orderBy, skip = 0, take, include }: any = {}) => {
        let rows = plans.filter((r) => matches(r, where));
        if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        rows = rows.slice(skip, take === undefined ? undefined : skip + take);
        return rows.map((r) => attachItems(r, include));
      }),
      count: jest.fn(async ({ where }: any = {}) => plans.filter((r) => matches(r, where)).length),
      create: jest.fn(async ({ data, include }: any) => {
        const { items: nested, ...rest } = data;
        const plan: Row = {
          id: `plan-${++planSeq}`, createdAt: nextDate(), updatedAt: nextDate(),
          status: "active", note: null, createdById: null, ...rest,
        };
        plans.push(plan);
        for (const itemData of nested?.create ?? []) {
          items.push({
            id: `item-${++itemSeq}`, planId: plan.id, createdAt: nextDate(), updatedAt: nextDate(),
            paidMinor: 0n, paidAt: null,
            dueSoonRemindedAt: null, dueSoonRemindStatus: null,
            overdueRemindedAt: null, overdueRemindStatus: null,
            ...itemData,
          });
        }
        return attachItems(plan, include);
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = plans.find((r) => matches(r, where));
        if (row) Object.assign(row, data);
        return row;
      }),
    },
    installmentItem: {
      findFirst: jest.fn(async ({ where }: any) => items.find((r) => matches(r, where)) ?? null),
      findMany: jest.fn(async ({ where, orderBy }: any = {}) => {
        let rows = items.filter((r) => matches(r, where));
        if (orderBy?.seq === "asc") rows = [...rows].sort((a, b) => a.seq - b.seq);
        return rows;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = items.find((r) => matches(r, where));
        if (row) Object.assign(row, data);
        return row;
      }),
    },
  };

  const audit: any = { log: jest.fn(async () => undefined) };
  const smsMode = opts.smsMode ?? "ok";
  const shopAccounts: any = {
    sendShopSms: jest.fn(async () => {
      if (smsMode === "ok") return { sent: true as const };
      if (smsMode === "notConfigured") return { sent: false as const, notConfigured: true, reason: "no SMS sender configured" };
      return { sent: false as const, notConfigured: false, reason: "gateway refused" };
    }),
  };
  const svc = new InstallmentsService(prisma as any, audit as any, shopAccounts as any);
  return { svc, prisma, audit, shopAccounts, orders, customers, pvRows, plans, items };
}

/** Seed an EC19-shape approved advance directly in the fake. */
function seedAdvance(fx: ReturnType<typeof setup>, orderId: string, amount: bigint, trxId?: string) {
  fx.pvRows.push({
    id: `pv-seed-${fx.pvRows.length + 1}`, organizationId: "org-1", orderId,
    conversationId: null, messageId: null, provider: "bkash", trxId: trxId ?? null,
    amountMinor: amount, expectedAmountMinor: 100000n, verdict: "matched",
    status: "approved", source: "manual_advance", reviewedById: "staff-1",
    createdById: "staff-1", modelProvider: "manual_staff", note: null,
    installmentItemId: null, createdAt: new Date(),
  });
}

const approvedSum = (rows: Row[], orderId: string) =>
  rows.filter((r) => r.orderId === orderId && r.status === "approved")
    .reduce((s, r) => s + BigInt(r.amountMinor ?? 0), 0n);

describe("EC31 createPlan — split, dates, refusals", () => {
  it("splits the due with the remainder on item 1 — sum identity holds (100000 / 3)", async () => {
    const fx = setup();
    const out: any = await fx.svc.createPlan("org-1", "staff-1", "o1", {
      installmentCount: 3, intervalDays: 10, startDate: "2026-11-01",
    });
    expect(out.totalMinor).toBe("100000");
    expect(out.status).toBe("active");
    expect(out.items.map((i: any) => i.amountMinor)).toEqual(["33334", "33333", "33333"]);
    const sum = out.items.reduce((s: bigint, i: any) => s + BigInt(i.amountMinor), 0n);
    expect(sum).toBe(100000n);
    expect(out.orderAmountDueMinor).toBe("100000");
    expect(out.remainingMinor).toBe("100000");
    expect(out.paidMinor).toBe("0");
    const auditCall = fx.audit.log.mock.calls.find((c: any[]) => c[0].action === "installments.plan_created");
    expect(auditCall[0]).toMatchObject({ entityType: "InstallmentPlan", entityId: out.id });
    expect(auditCall[0].metadata).toMatchObject({ orderId: "o1", totalMinor: "100000", installmentCount: 3, intervalDays: 10 });
  });

  it("due dates step from the startDate's Dhaka day by intervalDays", async () => {
    const fx = setup();
    const out: any = await fx.svc.createPlan("org-1", "staff-1", "o1", {
      installmentCount: 3, intervalDays: 10, startDate: "2026-11-01",
    });
    expect(out.items.map((i: any) => i.dueDay)).toEqual(["2026-11-01", "2026-11-11", "2026-11-21"]);
    expect(out.items[0].dueDate).toBe("2026-11-01T00:00:00.000Z");
    expect(out.startDate).toBe("2026-11-01T00:00:00.000Z");
  });

  it("the plan total is the DUE at creation, not the order total (advance already paid)", async () => {
    const fx = setup();
    seedAdvance(fx, "o1", 30000n);
    const out: any = await fx.svc.createPlan("org-1", "staff-1", "o1", {
      installmentCount: 2, intervalDays: 15, startDate: "2026-11-01",
    });
    expect(out.totalMinor).toBe("70000");
    expect(out.items.map((i: any) => i.amountMinor)).toEqual(["35000", "35000"]);
    expect(out.orderAmountDueMinor).toBe("70000");
  });

  it("refuses when the order has no due (fully covered by an approved advance)", async () => {
    const fx = setup();
    seedAdvance(fx, "o1", 100000n);
    await expect(
      fx.svc.createPlan("org-1", "staff-1", "o1", { installmentCount: 2, intervalDays: 15, startDate: "2026-11-01" }),
    ).rejects.toThrow("বকেয়া নেই");
    expect(fx.plans).toHaveLength(0);
  });

  it("refuses a duplicate active plan, and any second plan after cancel or completion (one plan per order lifetime)", async () => {
    const fx = setup();
    const dto = { installmentCount: 2, intervalDays: 15, startDate: "2026-11-01" };
    await fx.svc.createPlan("org-1", "staff-1", "o1", dto);
    await expect(fx.svc.createPlan("org-1", "staff-1", "o1", dto)).rejects.toThrow("ইতিমধ্যে একটি সক্রিয়");
    await fx.svc.cancelPlan("org-1", "staff-1", fx.plans[0].id);
    await expect(fx.svc.createPlan("org-1", "staff-1", "o1", dto)).rejects.toThrow("বাতিল কিস্তি প্ল্যান ছিল");
    expect(fx.plans).toHaveLength(1);
  });

  it("foreign or missing order is a 404; count/interval out of range is a 400", async () => {
    const fx = setup();
    const dto = { installmentCount: 2, intervalDays: 15, startDate: "2026-11-01" };
    await expect(fx.svc.createPlan("org-2", "staff-1", "o1", dto)).rejects.toMatchObject({ code: "installments.orderNotFoundInThisOrganization" });
    await expect(fx.svc.createPlan("org-1", "staff-1", "missing", dto)).rejects.toMatchObject({ code: "installments.orderNotFoundInThisOrganization" });
    await expect(fx.svc.createPlan("org-1", "staff-1", "o1", { ...dto, installmentCount: 1 })).rejects.toMatchObject({ code: "installments.theNumberOfInstallmentsMustBe" });
    await expect(fx.svc.createPlan("org-1", "staff-1", "o1", { ...dto, installmentCount: 25 })).rejects.toThrow("২ থেকে ২৪");
    await expect(fx.svc.createPlan("org-1", "staff-1", "o1", { ...dto, intervalDays: 0 })).rejects.toThrow("১ থেকে ৯০");
    await expect(fx.svc.createPlan("org-1", "staff-1", "o1", { ...dto, startDate: "not-a-date" })).rejects.toThrow("শুরুর তারিখ");
  });

  it("getPlanByOrder 404s when no plan exists", async () => {
    const fx = setup();
    await expect(fx.svc.getPlanByOrder("org-1", "o1")).rejects.toThrow("কিস্তি প্ল্যান পাওয়া যায়নি");
  });
});

describe("EC31 collect — EC19 coherence", () => {
  async function withPlan(fx: ReturnType<typeof setup>) {
    const out: any = await fx.svc.createPlan("org-1", "staff-1", "o1", {
      installmentCount: 3, intervalDays: 10, startDate: "2026-11-01",
    });
    return out;
  }

  it("partial collect: item paidMinor grows, paidAt stays null, and the order due (from approved rows) drops by exactly the amount", async () => {
    const fx = setup();
    const plan = await withPlan(fx);
    const item1 = plan.items[0];
    const out: any = await fx.svc.collect("org-1", "staff-9", item1.id, {
      amountMinor: "10000", method: "bkash", reference: "TRX-A",
    });
    const collected = fx.pvRows.filter((r) => r.source === "installment");
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({
      organizationId: "org-1", orderId: "o1", conversationId: "conv-1", messageId: null,
      provider: "bkash", trxId: "TRX-A", verdict: "matched", status: "approved",
      source: "installment", reviewedById: "staff-9", createdById: "staff-9",
      modelProvider: "manual_staff", installmentItemId: item1.id,
    });
    expect(collected[0].amountMinor).toBe(10000n);
    expect(collected[0].expectedAmountMinor).toBe(100000n);
    // THE coherence spec: due recomputed from the fake's approved
    // verification rows drops by exactly the collected amount.
    const dueFromRows = 100000n - approvedSum(fx.pvRows, "o1");
    expect(dueFromRows).toBe(90000n);
    expect(out.orderAmountDueMinor).toBe("90000");
    const updatedItem = out.items.find((i: any) => i.id === item1.id);
    expect(updatedItem.paidMinor).toBe("10000");
    expect(updatedItem.paidAt).toBeNull();
    expect(updatedItem.fullyPaid).toBe(false);
    expect(out.status).toBe("active");
  });

  it("collecting every item (in ANY order) completes the plan; the last full collect stamps paidAt", async () => {
    const fx = setup();
    const plan = await withPlan(fx);
    const [i1, i2, i3] = plan.items;
    // Out of order on purpose: no sequence gate.
    await fx.svc.collect("org-1", "staff-1", i2.id, { amountMinor: i2.amountMinor, method: "cash" });
    await fx.svc.collect("org-1", "staff-1", i3.id, { amountMinor: i3.amountMinor, method: "cash" });
    const out: any = await fx.svc.collect("org-1", "staff-1", i1.id, { amountMinor: i1.amountMinor, method: "cash" });
    expect(out.status).toBe("completed");
    expect(out.remainingMinor).toBe("0");
    expect(out.orderAmountDueMinor).toBe("0");
    for (const item of out.items) {
      expect(item.fullyPaid).toBe(true);
      expect(item.paidAt).not.toBeNull();
    }
    // And a second plan is now refused as completed.
    await expect(
      fx.svc.createPlan("org-1", "staff-1", "o1", { installmentCount: 2, intervalDays: 7, startDate: "2026-12-01" }),
    ).rejects.toThrow("ইতিমধ্যে সম্পূর্ণ");
  });

  it("overpay is a 400 naming both amounts; a fully-paid item refuses further collection", async () => {
    const fx = setup();
    const plan = await withPlan(fx);
    const item1 = plan.items[0];
    await expect(
      fx.svc.collect("org-1", "staff-1", item1.id, { amountMinor: "33335", method: "cash" }),
    ).rejects.toThrow(/33335.*33334/);
    await fx.svc.collect("org-1", "staff-1", item1.id, { amountMinor: "33334", method: "cash" });
    await expect(
      fx.svc.collect("org-1", "staff-1", item1.id, { amountMinor: "1", method: "cash" }),
    ).rejects.toThrow("ইতিমধ্যে সম্পূর্ণ পরিশোধ");
    expect(fx.pvRows.filter((r) => r.source === "installment")).toHaveLength(1);
  });

  it("collect on a cancelled plan is a 400; unknown item is a 404", async () => {
    const fx = setup();
    const plan = await withPlan(fx);
    await fx.svc.cancelPlan("org-1", "staff-1", plan.id);
    await expect(
      fx.svc.collect("org-1", "staff-1", plan.items[0].id, { amountMinor: "100", method: "cash" }),
    ).rejects.toThrow("সক্রিয় নয়");
    await expect(
      fx.svc.collect("org-1", "staff-1", "no-such-item", { amountMinor: "100", method: "cash" }),
    ).rejects.toMatchObject({ code: "installments.theInstallmentItemWasNotFound" });
  });

  it("a duplicate approved transaction reference is refused org-wide (EC19 guard)", async () => {
    const fx = setup();
    const plan = await withPlan(fx);
    await fx.svc.collect("org-1", "staff-1", plan.items[0].id, {
      amountMinor: "5000", method: "bkash", reference: "TRX-DUP",
    });
    await expect(
      fx.svc.collect("org-1", "staff-1", plan.items[1].id, {
        amountMinor: "5000", method: "bkash", reference: "TRX-DUP",
      }),
    ).rejects.toMatchObject({ code: "installments.thisTransactionReferenceHasAlreadyBeen" });
    expect(fx.pvRows.filter((r) => r.source === "installment")).toHaveLength(1);
  });

  it("cancel keeps collected verifications and paid amounts — the order due stays reduced", async () => {
    const fx = setup();
    const plan = await withPlan(fx);
    await fx.svc.collect("org-1", "staff-1", plan.items[0].id, { amountMinor: "10000", method: "cash" });
    const out: any = await fx.svc.cancelPlan("org-1", "staff-1", plan.id);
    expect(out.status).toBe("cancelled");
    expect(out.orderAmountDueMinor).toBe("90000");
    expect(out.items[0].paidMinor).toBe("10000");
    expect(fx.pvRows.filter((r) => r.source === "installment")).toHaveLength(1);
    const auditCall = fx.audit.log.mock.calls.find((c: any[]) => c[0].action === "installments.plan_cancelled");
    expect(auditCall[0]).toMatchObject({ entityType: "InstallmentPlan", entityId: plan.id });
    // Cancelling again is a 400.
    await expect(fx.svc.cancelPlan("org-1", "staff-1", plan.id)).rejects.toThrow("সক্রিয় নয়");
  });
});

describe("EC31 due worklist", () => {
  it("separates today vs overdue buckets with day counts and joined customer fields", async () => {
    const fx = setup();
    await fx.svc.createPlan("org-1", "staff-1", "o1", {
      installmentCount: 2, intervalDays: 30, startDate: dayToDate(TODAY).toISOString(),
    });
    await fx.svc.createPlan("org-1", "staff-1", "o2", {
      installmentCount: 2, intervalDays: 30, startDate: dayToDate(addDays(TODAY, -3)).toISOString(),
    });
    const todayList: any = await fx.svc.dueWorklist("org-1", "today");
    expect(todayList.items).toHaveLength(1);
    expect(todayList.items[0]).toMatchObject({
      orderId: "o1", orderNumber: "1001", customerName: "Test Customer",
      customerPhone: "01711111111", seq: 1, dueDay: TODAY, daysOverdue: 0,
      amountMinor: "50000", remainingMinor: "50000",
    });
    const overdueList: any = await fx.svc.dueWorklist("org-1", "overdue");
    expect(overdueList.items).toHaveLength(1);
    expect(overdueList.items[0]).toMatchObject({ orderId: "o2", seq: 1, daysOverdue: 3 });
    await expect(fx.svc.dueWorklist("org-1", "next-week")).rejects.toMatchObject({ code: "installments.bucketMustBeTodayOrOverdue" });
  });
});

describe("EC31 reminder sweep — exactly once per item per state", () => {
  it("due_soon fires once; a second run sends nothing new", async () => {
    const fx = setup();
    await fx.svc.createPlan("org-1", "staff-1", "o1", {
      installmentCount: 2, intervalDays: 30, startDate: dayToDate(TODAY).toISOString(),
    });
    const first: any = await fx.svc.runDueRemindersForOrg("org-1");
    expect(first.sent).toBe(1);
    expect(fx.shopAccounts.sendShopSms).toHaveBeenCalledTimes(1);
    const [to, phone, text, ref] = fx.shopAccounts.sendShopSms.mock.calls[0];
    expect(to).toBe("org-1");
    expect(phone).toBe("01711111111");
    expect(text).toContain(TODAY);
    expect(ref).toContain("due_soon");
    const second: any = await fx.svc.runDueRemindersForOrg("org-1");
    expect(second.sent).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(1);
    expect(fx.shopAccounts.sendShopSms).toHaveBeenCalledTimes(1);
    const itemRow = fx.items.find((i) => i.seq === 1)!;
    expect(itemRow.dueSoonRemindStatus).toBe("sent");
    expect(itemRow.dueSoonRemindedAt).not.toBeNull();
  });

  it("overdue fires once with the overdue text/state", async () => {
    const fx = setup();
    await fx.svc.createPlan("org-1", "staff-1", "o1", {
      installmentCount: 2, intervalDays: 30, startDate: dayToDate(addDays(TODAY, -5)).toISOString(),
    });
    const first: any = await fx.svc.runDueRemindersForOrg("org-1");
    expect(first.sent).toBe(1);
    const [, , text, ref] = fx.shopAccounts.sendShopSms.mock.calls[0];
    expect(text).toContain("পার হয়ে গেছে");
    expect(ref).toContain("overdue");
    const second: any = await fx.svc.runDueRemindersForOrg("org-1");
    expect(second.sent).toBe(0);
    expect(fx.shopAccounts.sendShopSms).toHaveBeenCalledTimes(1);
    expect(fx.items.find((i) => i.seq === 1)!.overdueRemindStatus).toBe("sent");
  });

  it("no SMS channel: the attempt is stamped failed_no_channel and audited, never claimed sent", async () => {
    const fx = setup({ smsMode: "notConfigured" });
    await fx.svc.createPlan("org-1", "staff-1", "o1", {
      installmentCount: 2, intervalDays: 30, startDate: dayToDate(TODAY).toISOString(),
    });
    const out: any = await fx.svc.runDueRemindersForOrg("org-1");
    expect(out.sent).toBe(0);
    expect(out.failedNoChannel).toBe(1);
    const itemRow = fx.items.find((i) => i.seq === 1)!;
    expect(itemRow.dueSoonRemindStatus).toBe("failed_no_channel");
    expect(itemRow.dueSoonRemindedAt).not.toBeNull();
    const auditCall = fx.audit.log.mock.calls.find((c: any[]) => c[0].action === "installments.reminder");
    expect(auditCall[0].entityType).toBe("InstallmentItem");
    expect(auditCall[0].metadata).toMatchObject({ state: "due_soon", status: "failed_no_channel" });
    expect(auditCall[0].userId).toBeUndefined();
  });

  it("no customer phone is also failed_no_channel (reason recorded), and a fully-paid item is never reminded", async () => {
    const fx = setup();
    fx.customers[0].phone = null;
    const plan: any = await fx.svc.createPlan("org-1", "staff-1", "o1", {
      installmentCount: 2, intervalDays: 30, startDate: dayToDate(addDays(TODAY, -1)).toISOString(),
    });
    const out: any = await fx.svc.runDueRemindersForOrg("org-1");
    expect(out.failedNoChannel).toBe(1);
    expect(fx.shopAccounts.sendShopSms).not.toHaveBeenCalled();
    const auditCall = fx.audit.log.mock.calls.find((c: any[]) => c[0].action === "installments.reminder");
    expect(auditCall[0].metadata).toMatchObject({ state: "overdue", status: "failed_no_channel", reason: "no customer phone" });
    void plan;
  });

  it("a fully-paid item produces no reminder even when past due", async () => {
    const fx = setup();
    const plan: any = await fx.svc.createPlan("org-1", "staff-1", "o1", {
      installmentCount: 2, intervalDays: 30, startDate: dayToDate(addDays(TODAY, -1)).toISOString(),
    });
    await fx.svc.collect("org-1", "staff-1", plan.items[0].id, {
      amountMinor: plan.items[0].amountMinor, method: "cash",
    });
    const out: any = await fx.svc.runDueRemindersForOrg("org-1");
    expect(out.sent).toBe(0);
    expect(out.checked).toBe(1); // only the still-unpaid second item is examined (and it is not due yet)
    expect(fx.shopAccounts.sendShopSms).not.toHaveBeenCalled();
  });
});

describe("EC31 summaryForOrder + listPlans", () => {
  it("summary shape for an active plan; null when no active plan exists", async () => {
    const fx = setup();
    expect(await fx.svc.summaryForOrder("org-1", "o1")).toBeNull();
    const plan: any = await fx.svc.createPlan("org-1", "staff-1", "o1", {
      installmentCount: 3, intervalDays: 10, startDate: "2026-11-01",
    });
    await fx.svc.collect("org-1", "staff-1", plan.items[0].id, {
      amountMinor: plan.items[0].amountMinor, method: "cash",
    });
    const summary: any = await fx.svc.summaryForOrder("org-1", "o1");
    expect(summary).toEqual({
      totalInstallments: 3,
      paidInstallments: 1,
      nextDueDate: "2026-11-11",
      nextDueAmountMinor: "33333",
      remainingMinor: "66666",
    });
  });

  it("listPlans returns serialized rows with order/customer joins and honours the status filter", async () => {
    const fx = setup();
    await fx.svc.createPlan("org-1", "staff-1", "o1", {
      installmentCount: 2, intervalDays: 15, startDate: "2026-11-01",
    });
    const all: any = await fx.svc.listPlans("org-1", {});
    expect(all.total).toBe(1);
    expect(all.items[0]).toMatchObject({
      orderId: "o1", orderNumber: "1001", customerName: "Test Customer",
      customerPhone: "01711111111", totalMinor: "100000", status: "active",
    });
    const cancelled: any = await fx.svc.listPlans("org-1", { status: "cancelled" });
    expect(cancelled.total).toBe(0);
    expect(cancelled.items).toHaveLength(0);
  });
});
