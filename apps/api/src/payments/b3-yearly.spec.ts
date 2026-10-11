import { PaymentsService } from "./payments.service";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * Billing Package B3: the yearly cycle uses its own price
 * book (defaults monthly × 10), records the cycle on the
 * checkout + subscription, activates a 365-day period,
 * and prorates a yearly period over 365 days.
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
  const svc = new PaymentsService(p, { log: async () => undefined } as any);
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null,
    sslcommerz: { storeId: "s", storePass: "p", sandbox: true }, bkash: null, loadedAt: Date.now(),
  } as any);
  (global as any).fetch = async () => ({ json: async () => ({ status: "SUCCESS", GatewayPageURL: "https://gw/pay", sessionkey: "S" }) });
  return { svc, p };
}

const ACTOR = { userId: "u-1", email: "owner@x.com" };

describe("B3 yearly cycle", () => {
  beforeEach(() => { jest.useFakeTimers({ now: NOW }); });
  afterEach(() => { jest.useRealTimers(); });

  it("yearly checkout charges the yearly book and records the cycle", async () => {
    const { svc, p } = makeSvc({ id: "sub-1", organizationId: "org-1", plan: "FREE", status: "TRIALING", currentPeriodEnd: new Date(NOW - DAY), billingCycle: "monthly", createdAt: new Date(NOW) });
    const out: any = await svc.createCheckout("org-1", ACTOR, "GROWTH", "01712345678", { cycle: "yearly" });
    expect(out.amountMinor).toBe("3000000"); // yearly default = 300000 x 10
    expect(out.cycle).toBe("yearly");
    expect(p.planCheckout.rows[0].cycle).toBe("yearly");
  });

  it("yearly activation sets a 365-day period and remembers the cycle", async () => {
    const { svc, p } = makeSvc({ id: "sub-1", organizationId: "org-1", plan: "FREE", status: "TRIALING", currentPeriodEnd: null, billingCycle: "monthly", createdAt: new Date(NOW) });
    const co: any = { id: "co-y", organizationId: "org-1", plan: "STARTER", amountMinor: 1500000n, currency: "BDT", tranId: "TY", gateway: "sslcommerz", cycle: "yearly", creditAppliedMinor: 0n, discountMinor: 0n, prorationMinor: 0n, couponCode: null, createdById: "u-1" };
    p.planCheckout.rows.push(co);
    const out: any = await (svc as any).activate(co, "val-y");
    expect(new Date(out.currentPeriodEnd).getTime()).toBe(NOW + 365 * DAY);
    expect(p.subscription.rows[0].billingCycle).toBe("yearly");
  });

  it("a yearly period prorates over 365 days (half a year left = half the yearly price, capped)", async () => {
    const { svc, p } = makeSvc({ id: "sub-1", organizationId: "org-1", plan: "STARTER", status: "ACTIVE", billingCycle: "yearly", currentPeriodEnd: new Date(NOW + 182.5 * DAY), createdAt: new Date(NOW) });
    // Upgrading to GROWTH on the MONTHLY book (300000): the
    // unused yearly value is 1500000 x 0.5 = 750000, capped
    // at the target price -> due 0, activates in full.
    const out: any = await svc.createCheckout("org-1", ACTOR, "GROWTH", "01712345678", { cycle: "monthly" });
    expect(out.prorationMinor).toBe("300000");
    expect(out.viaCredit).toBe(true);
    expect(p.subscription.rows[0].plan).toBe("GROWTH");
    expect(p.subscription.rows[0].billingCycle).toBe("monthly");
    expect(new Date(p.subscription.rows[0].currentPeriodEnd).getTime()).toBe(NOW + 30 * DAY);
  });
});
