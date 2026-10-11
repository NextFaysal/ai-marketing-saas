import { PaymentsService, buildInvoiceHtml } from "./payments.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * Billing Package B5: billing recipients are validated and
 * bounded on the profile, the invoice prints the buyer
 * block, and a confirmed activation emails the invoice to
 * OWNER/ADMIN + billing recipients — audited only when it
 * actually went out, and never breaking the payment.
 */
const NOW = new Date("2026-10-11T06:00:00.000Z").getTime();
const DAY = 86400000;

function table(seed: any[] = []) {
  const rows = [...seed];
  return {
    rows,
    create: async ({ data }: any) => { const r = { id: `pay-${rows.length + 1}-abcdefgh`, createdAt: new Date(NOW), ...data }; rows.push(r); return r; },
    findFirst: async () => [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id || r.organizationId === where.organizationId) ?? null,
    findMany: async () => rows,
    update: async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id); if (r) Object.assign(r, data); return r; },
    count: async () => rows.length,
  };
}

function makeSvc(emailImpl: any) {
  const p: any = {
    planCheckout: table(),
    organization: {
      rows: [{ id: "org-1", name: "Shop", creditMinor: 0n }],
      findUnique: async () => p.organization.rows[0],
      update: async ({ data }: any) => { Object.assign(p.organization.rows[0], data); return p.organization.rows[0]; },
    },
    businessProfile: { findUnique: async () => ({ billingEmails: ["Accounts@X.com"], billingAddress: "Road 5, Khulna", billingBin: "BIN-123" }) },
    subscription: table([{ id: "sub-1", organizationId: "org-1", plan: "FREE", status: "TRIALING", currentPeriodEnd: null, billingCycle: "monthly", createdAt: new Date(NOW) }]),
    saasPayment: table(),
    coupon: table(), couponRedemption: table(),
    membership: { findMany: async () => [{ userId: "u-1", role: "OWNER", status: "ACTIVE", user: { email: "owner@x.com" } }] },
    systemSetting: { findUnique: async () => null },
  };
  const audits: any[] = [];
  const svc = new PaymentsService(p, { log: async (e: any) => { audits.push(e); } } as any, emailImpl);
  setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, bkash: null, loadedAt: Date.now() } as any);
  return { svc, p, audits };
}

describe("B5 billing contacts + invoice email", () => {
  beforeEach(() => { jest.useFakeTimers({ now: NOW }); });
  afterEach(() => { jest.useRealTimers(); });

  it("activation emails the invoice to the owner + billing recipients and audits the send", async () => {
    const sent: any[] = [];
    const { svc, p, audits } = makeSvc({ send: async (m: any) => { sent.push(m); return { providerMessageId: "x" }; } });
    const co: any = { id: "co-1", organizationId: "org-1", plan: "STARTER", amountMinor: 150000n, currency: "BDT", tranId: "T1", gateway: "sslcommerz", cycle: "monthly", creditAppliedMinor: 0n, discountMinor: 0n, prorationMinor: 0n, couponCode: null, createdById: "u-1" };
    p.planCheckout.rows.push(co);
    const out: any = await (svc as any).activate(co, "val-1");
    expect(out.activated).toBe(true);
    expect(sent.map((m) => m.to).sort()).toEqual(["Accounts@X.com", "owner@x.com"]);
    expect(sent[0].text).toContain("INV-");
    expect(sent[0].text).toContain("BDT 1,500.00");
    expect(audits.some((a) => a.action === "billing.invoice_emailed" && a.metadata.recipients === 2)).toBe(true);
  });

  it("a failing mail provider never breaks a confirmed activation and is not claimed", async () => {
    const { svc, p, audits } = makeSvc({ send: async () => { throw new Error("SMTP down"); } });
    const co: any = { id: "co-2", organizationId: "org-1", plan: "STARTER", amountMinor: 150000n, currency: "BDT", tranId: "T2", gateway: "sslcommerz", cycle: "monthly", creditAppliedMinor: 0n, discountMinor: 0n, prorationMinor: 0n, couponCode: null, createdById: "u-1" };
    p.planCheckout.rows.push(co);
    const out: any = await (svc as any).activate(co, "val-2");
    expect(out.activated).toBe(true);
    expect(audits.some((a) => a.action === "billing.invoice_emailed")).toBe(false);
  });

  it("the invoice HTML prints the buyer block, escaped", () => {
    const html = buildInvoiceHtml({
      payment: { id: "pay-12345678", amountMinor: 150000n, currency: "BDT", method: "sslcommerz", createdAt: new Date(NOW), periodEnd: new Date(NOW + 30 * DAY) },
      orgName: "Shop", buyer: { address: "Road 5, <Khulna>", bin: "BIN-123" },
    });
    expect(html).toContain("Road 5, &lt;Khulna&gt;");
    expect(html).toContain("BIN: BIN-123");
  });

  it("profile validation: max 3 billing emails, real emails only, normalized + deduped", async () => {
    const store: any = { profile: null };
    const fake: any = {
      businessProfile: {
        findUnique: jest.fn(async () => store.profile),
        upsert: jest.fn(async ({ create, update }: any) => { store.profile = store.profile ? { ...store.profile, ...update } : { id: "p1", ...create }; return store.profile; }),
      },
    };
    const svc = new OrganizationsService(fake, { log: async () => undefined } as any);
    await expect(svc.updateBusinessProfile("org", "boss", { billingEmails: ["a@x.com", "b@x.com", "c@x.com", "d@x.com"] } as any)).rejects.toThrow(/সর্বোচ্চ ৩টি/);
    await expect(svc.updateBusinessProfile("org", "boss", { billingEmails: ["not-an-email"] } as any)).rejects.toThrow(/সঠিক নয়/);
    await svc.updateBusinessProfile("org", "boss", { billingEmails: ["Accounts@X.com", "accounts@x.com"] } as any);
    expect(store.profile.billingEmails).toEqual(["accounts@x.com"]);
  });
});
