import { PaymentsService } from "./payments.service";
import { sweepSubscription } from "../common/platform-settings";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * Billing Package B2: upgrade proration is exact money math,
 * downgrades are scheduled (never instant checkouts), an
 * upgrade's activation starts a fresh period (the unused
 * days were already paid back as proration), a renewal
 * extends, and the sweep lands scheduled changes at the
 * period end.
 */
const NOW = new Date("2026-10-11T06:00:00.000Z").getTime();
const DAY = 86400000;

function table(seed: any[] = []) {
  const rows = [...seed];
  return {
    rows,
    create: async ({ data }: any) => { const r = { id: `r-${rows.length + 1}`, createdAt: new Date(NOW), ...data }; rows.push(r); return r; },
    findFirst: async () => [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id || r.code === where.code || r.tranId === where.tranId) ?? null,
    findMany: async () => rows,
    update: async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id); if (r) Object.assign(r, data); return r; },
    count: async () => rows.length,
  };
}

function makeSvc(subRow: any) {
  const p: any = {
    planCheckout: table(),
    organization: {
      rows: [{ id: "org-1", name: "Shop", creditMinor: 0n }],
      findUnique: async () => p.organization.rows[0],
      update: async ({ data }: any) => { Object.assign(p.organization.rows[0], data); return p.organization.rows[0]; },
    },
    businessProfile: { findUnique: async () => ({ contactEmail: "o@x.com", contactPhone: "01700000000" }) },
    subscription: table([subRow]),
    saasPayment: table(),
    coupon: table(), couponRedemption: table(),
    systemSetting: { findUnique: async () => null },
  };
  const auditEntries: any[] = [];
  const svc = new PaymentsService(p, { log: async (e: any) => { auditEntries.push(e); } } as any);
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null,
    sslcommerz: { storeId: "s", storePass: "p", sandbox: true }, bkash: null, loadedAt: Date.now(),
  } as any);
  (global as any).fetch = async () => ({ json: async () => ({ status: "SUCCESS", GatewayPageURL: "https://gw/pay", sessionkey: "S" }) });
  return { svc, p, auditEntries };
}

const ACTOR = { userId: "u-1", email: "owner@x.com" };

describe("B2 proration + scheduled changes", () => {
  beforeEach(() => { jest.useFakeTimers({ now: NOW }); });
  afterEach(() => { jest.useRealTimers(); });

  it("upgrade credits exactly half the STARTER price at 15 of 30 days left", async () => {
    const { svc, p } = makeSvc({ id: "sub-1", organizationId: "org-1", plan: "STARTER", status: "ACTIVE", currentPeriodEnd: new Date(NOW + 15 * DAY), createdAt: new Date(NOW - 15 * DAY) });
    const out: any = await svc.createCheckout("org-1", ACTOR, "GROWTH", "01712345678");
    expect(out.prorationMinor).toBe("75000"); // 150000 * 15/30
    expect(out.amountMinor).toBe("225000"); // 300000 - 75000
    expect(BigInt(p.planCheckout.rows[0].prorationMinor)).toBe(75000n);
  });

  it("a downgrade checkout is refused with a pointer to scheduling", async () => {
    const { svc } = makeSvc({ id: "sub-1", organizationId: "org-1", plan: "GROWTH", status: "ACTIVE", currentPeriodEnd: new Date(NOW + 10 * DAY), createdAt: new Date(NOW) });
    await expect(svc.createCheckout("org-1", ACTOR, "STARTER", "01712345678")).rejects.toMatchObject({ code: "payments.downgradeAtPeriodEnd", status: 400 });
  });

  it("activation: prorated upgrade starts a fresh period; renewal extends the old end", async () => {
    const oldEnd = new Date(NOW + 15 * DAY);
    const a = makeSvc({ id: "sub-1", organizationId: "org-1", plan: "STARTER", status: "ACTIVE", currentPeriodEnd: oldEnd, createdAt: new Date(NOW - 15 * DAY) });
    const coA: any = { id: "co-a", organizationId: "org-1", plan: "GROWTH", amountMinor: 225000n, currency: "BDT", tranId: "T1", gateway: "sslcommerz", creditAppliedMinor: 0n, discountMinor: 0n, prorationMinor: 75000n, couponCode: null, createdById: "u-1" };
    a.p.planCheckout.rows.push(coA);
    await (a.svc as any).activate(coA, "val-1");
    expect(new Date(a.p.subscription.rows[0].currentPeriodEnd).getTime()).toBe(NOW + 30 * DAY);
    expect(BigInt(a.p.saasPayment.rows[0].amountMinor)).toBe(300000n); // full value incl. proration

    const b = makeSvc({ id: "sub-1", organizationId: "org-1", plan: "STARTER", status: "ACTIVE", currentPeriodEnd: oldEnd, createdAt: new Date(NOW - 15 * DAY) });
    const coB: any = { id: "co-b", organizationId: "org-1", plan: "STARTER", amountMinor: 150000n, currency: "BDT", tranId: "T2", gateway: "sslcommerz", creditAppliedMinor: 0n, discountMinor: 0n, prorationMinor: 0n, couponCode: null, createdById: "u-1" };
    b.p.planCheckout.rows.push(coB);
    await (b.svc as any).activate(coB, "val-2");
    expect(new Date(b.p.subscription.rows[0].currentPeriodEnd).getTime()).toBe(NOW + 45 * DAY);
  });

  it("schedule + cancel + sweep: FREE lands active, a paid target lands past-due at the new plan", async () => {
    const { svc, p } = makeSvc({ id: "sub-1", organizationId: "org-1", plan: "GROWTH", status: "ACTIVE", currentPeriodEnd: new Date(NOW + 5 * DAY), createdAt: new Date(NOW) });
    await expect(svc.schedulePlanChange("org-1", "u-1", "AGENCY")).rejects.toMatchObject({ code: "payments.scheduleDowngradeOnly", status: 400 });
    const set = await svc.schedulePlanChange("org-1", "u-1", "FREE");
    expect(set.pendingPlan).toBe("FREE");
    expect(p.subscription.rows[0].pendingPlan).toBe("FREE");
    await svc.cancelScheduledPlanChange("org-1", "u-1");
    expect(p.subscription.rows[0].pendingPlan).toBeNull();
    await svc.schedulePlanChange("org-1", "u-1", "STARTER");

    const prismaFake: any = { subscription: p.subscription };
    jest.setSystemTime(NOW + 6 * DAY); // period has closed
    const landed = await sweepSubscription(prismaFake, "org-1");
    expect(landed).toEqual({ changed: true, status: "PAST_DUE" });
    expect(p.subscription.rows[0].plan).toBe("STARTER");
    expect(p.subscription.rows[0].pendingPlan).toBeNull();

    // FREE variant on a fresh row.
    const c = makeSvc({ id: "sub-9", organizationId: "org-1", plan: "STARTER", status: "ACTIVE", currentPeriodEnd: new Date(NOW + 1 * DAY), pendingPlan: "FREE", createdAt: new Date(NOW) });
    jest.setSystemTime(NOW + 2 * DAY);
    const free = await sweepSubscription({ subscription: c.p.subscription }, "org-1");
    expect(free).toEqual({ changed: true, status: "FREE" });
    expect(c.p.subscription.rows[0].plan).toBe("FREE");
    expect(c.p.subscription.rows[0].status).toBe("ACTIVE");
    expect(c.p.subscription.rows[0].currentPeriodEnd).toBeNull();
  });
});
