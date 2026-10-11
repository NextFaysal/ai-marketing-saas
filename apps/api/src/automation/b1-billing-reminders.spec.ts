import { AutomationService } from "./automation.service";

/**
 * Billing Package B1: expiry stages fire ONCE per period
 * (audit is the dedupe record), abandoned checkouts are
 * reminded once each, in-app notifications always land,
 * and email outcomes are reported — never faked.
 */
function world(opts: { withEmail?: boolean } = {}) {
  const auditRows: any[] = [];
  const notifications: any[] = [];
  const mails: any[] = [];
  const end = new Date(Date.now() + 2 * 86400000); // 2 days left -> stage 3
  const fake: any = {
    membership: { findMany: jest.fn(async ({ where }: any) => ([
      { userId: "owner", role: "OWNER", status: "ACTIVE", user: { email: "owner@x.com" } },
      { userId: "agent", role: "SUPPORT_AGENT", status: "ACTIVE", user: { email: "agent@x.com" } },
    ].filter((m) => !where?.role?.in || where.role.in.includes(m.role)))) },
    businessProfile: { findUnique: jest.fn(async () => ({ billingEmails: ["accounts@x.com"] })) },
    organization: { findUnique: jest.fn(async () => ({ id: "org", name: "T1 Shop" })) },
    subscription: { findFirst: jest.fn(async () => ({ id: "sub1", plan: "STARTER", status: "ACTIVE", currentPeriodEnd: end })) },
    planCheckout: { findMany: jest.fn(async () => ([
      { id: "co1", plan: "GROWTH", tranId: "QC1", createdById: "owner", status: "initiated", createdAt: new Date(Date.now() - 2 * 3600000) },
    ])) },
    user: { findUnique: jest.fn(async () => ({ id: "owner", email: "owner@x.com" })) },
    agentNotification: { create: jest.fn(async ({ data }: any) => { notifications.push(data); return data; }) },
    auditLog: { findMany: jest.fn(async ({ where }: any) => auditRows.filter((r) => r.action === where.action)) },
  };
  const audit = { log: jest.fn(async (e: any) => { auditRows.push(e); }) };
  const email = opts.withEmail === false ? undefined : { send: jest.fn(async (m: any) => { mails.push(m); }) };
  const svc = new AutomationService(fake, audit as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    email as any);
  return { svc, notifications, mails, auditRows };
}

describe("B1 billing reminders", () => {
  it("stage 3 fires once: admins notified in-app, owner + billing inbox emailed, re-run is a no-op", async () => {
    const { svc, notifications, mails } = world();
    const out: any = await svc.sendBillingReminders("org");
    expect(out.expiry).toEqual({ stage: 3, daysLeft: 2, sent: true });
    // Only the OWNER membership is an admin recipient (agent isn't).
    expect(notifications.filter((n) => n.title.includes("মেয়াদ"))).toHaveLength(1);
    // Expiry mail goes to owner + billing inbox; the abandoned
    // checkout reminder separately mails its creator (owner).
    expect(mails.map((m) => m.to).sort()).toEqual(["accounts@x.com", "owner@x.com", "owner@x.com"]);
    expect(mails.filter((m) => m.subject.includes("নবায়ন"))).toHaveLength(2);
    expect(out.checkoutReminders).toBe(1);
    const again: any = await svc.sendBillingReminders("org");
    expect(again.expiry.sent).toBe(false);
    expect(again.checkoutReminders).toBe(0);
  });

  it("without an email provider the job still notifies in-app and says so", async () => {
    const { svc, notifications } = world({ withEmail: false });
    const out: any = await svc.sendBillingReminders("org");
    expect(out.emailStatus).toBe("no_provider");
    expect(out.emailsSent).toBe(0);
    expect(notifications.length).toBeGreaterThanOrEqual(2); // expiry + checkout
  });
});
