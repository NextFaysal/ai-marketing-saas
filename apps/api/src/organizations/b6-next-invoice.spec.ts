import { OrganizationsService } from "./organizations.service";
import { AutomationService } from "../automation/automation.service";

/**
 * Billing Package B6: the next-invoice preview is computed
 * from the same price books + credit the checkout uses
 * (a scheduled change retargets it), and the reminders job
 * raises 80%/100% usage alerts once per metric per day.
 */
const NOW = Date.now();
const DAY = 86400000;

function billingSvc(subRow: any, credit = 0n) {
  const fake: any = {
    subscription: { findFirst: async () => subRow },
    systemSetting: { findUnique: async () => null },
    organization: { findUnique: async () => ({ id: "org", name: "Shop", creditMinor: credit }) },
    membership: { count: async () => 2 },
    aIUsageRecord: { count: async () => 0 },
    broadcast: { count: async () => 0 },
    saasPayment: { findMany: async () => [] },
    businessProfile: { findUnique: async () => null },
  };
  return new OrganizationsService(fake, { log: async () => undefined } as any);
}

describe("B6 next-invoice preview", () => {
  it("monthly STARTER with credit: amount - credit = due", async () => {
    const svc = billingSvc({ plan: "STARTER", status: "ACTIVE", billingCycle: "monthly", pendingPlan: null, currentPeriodEnd: new Date(NOW + 20 * DAY) }, 50000n);
    const out: any = await svc.getBilling("org");
    expect(out.nextInvoice).toMatchObject({ plan: "STARTER", cycle: "monthly", amountMinor: "150000", creditAppliedMinor: "50000", dueMinor: "100000", scheduledChange: false });
  });

  it("a scheduled FREE change zeroes the preview; a yearly sub prices from the yearly book", async () => {
    const svc = billingSvc({ plan: "STARTER", status: "ACTIVE", billingCycle: "monthly", pendingPlan: "FREE", currentPeriodEnd: new Date(NOW + 20 * DAY) });
    const out: any = await svc.getBilling("org");
    expect(out.nextInvoice).toMatchObject({ plan: "FREE", amountMinor: "0", dueMinor: "0", scheduledChange: true });

    const yearly = billingSvc({ plan: "STARTER", status: "ACTIVE", billingCycle: "yearly", pendingPlan: null, currentPeriodEnd: new Date(NOW + 300 * DAY) });
    const out2: any = await yearly.getBilling("org");
    expect(out2.nextInvoice.amountMinor).toBe("1500000");
    expect(out2.subscription.priceMinor).toBe("1500000");
  });

  it("no live period -> no preview", async () => {
    const svc = billingSvc({ plan: "FREE", status: "TRIALING", billingCycle: "monthly", pendingPlan: null, currentPeriodEnd: null });
    const out: any = await svc.getBilling("org");
    expect(out.nextInvoice).toBeNull();
  });
});

describe("B6 usage alerts", () => {
  it("seats at 100% and AI at 80% alert once per day", async () => {
    const auditRows: any[] = [];
    const notifications: any[] = [];
    const end = new Date(NOW + 20 * DAY);
    const fake: any = {
      membership: {
        findMany: async () => [{ userId: "owner", role: "OWNER", status: "ACTIVE", user: { email: "o@x.com" } }],
        count: async () => 5, // STARTER seat limit is 5 -> 100%
      },
      aIUsageRecord: { count: async () => 41 }, // 41/50 -> 82% -> 80 threshold
      businessProfile: { findUnique: async () => null },
      organization: { findUnique: async () => ({ id: "org", name: "Shop" }) },
      subscription: { findFirst: async () => ({ id: "sub", plan: "STARTER", status: "ACTIVE", currentPeriodEnd: end }) },
      planCheckout: { findMany: async () => [] },
      agentNotification: { create: async ({ data }: any) => { notifications.push(data); return data; } },
      auditLog: { findMany: async ({ where }: any) => auditRows.filter((r) => r.action === where.action) },
    };
    const svc = new AutomationService(fake, { log: async (e: any) => { auditRows.push(e); } } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { send: async () => ({ providerMessageId: "x" }) } as any);
    const out: any = await svc.sendBillingReminders("org");
    expect(out.usageAlerts).toEqual([
      { metric: "seats", threshold: 100 },
      { metric: "aiDaily", threshold: 80 },
    ]);
    expect(notifications.filter((n) => n.title.includes("সীমা"))).toHaveLength(2);
    const again: any = await svc.sendBillingReminders("org");
    expect(again.usageAlerts).toEqual([]);
  });
});
