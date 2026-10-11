import { PaymentsService, buildInvoiceHtml } from "./payments.service";
import { EmailProvider } from "../messaging/email.provider";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * Admin Polish AP4: the invoice email carries the
 * HTML rendering of the SAME invoice the tenant can
 * download — one builder, one data path, and the
 * text part stays as fallback. Provider sends count
 * only on a returned message id (unchanged).
 */
const NOW = new Date("2026-10-11T06:00:00.000Z").getTime();

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

describe("AP4 HTML invoice email", () => {
  beforeEach(() => { jest.useFakeTimers({ now: NOW }); });
  afterEach(() => { jest.useRealTimers(); });

  it("activation email carries HTML with the invoice's own numbers + the text fallback", async () => {
    const sent: any[] = [];
    const { svc, p } = makeSvc({ send: async (m: any) => { sent.push(m); return { providerMessageId: "x" }; } });
    const co: any = { id: "co-1", organizationId: "org-1", plan: "STARTER", amountMinor: 150000n, currency: "BDT", tranId: "T1", gateway: "sslcommerz", cycle: "monthly", creditAppliedMinor: 0n, discountMinor: 0n, prorationMinor: 0n, couponCode: null, createdById: "u-1" };
    p.planCheckout.rows.push(co);
    const out: any = await (svc as any).activate(co, "val-1");
    expect(out.activated).toBe(true);
    expect(sent.length).toBe(2);
    const m = sent[0];
    expect(m.text).toContain("BDT 1,500.00");
    expect(typeof m.html).toBe("string");
    expect(m.html).toContain("INV-");
    expect(m.html).toContain("BDT 1,500.00");
    expect(m.html).toContain("Shop");
    expect(m.html).toContain("BIN-123");
    expect(m.html).toContain("border-top:1px solid"); // inline styles for mail clients
    expect(m.html).not.toContain("window.print"); // no print button in email
  });

  it("the downloadable (non-email) rendering is unchanged: print button present", () => {
    const html = buildInvoiceHtml({ payment: { id: "pay-12345678", amountMinor: 100n, currency: "BDT", method: "sslcommerz", createdAt: new Date(NOW) }, orgName: "Shop" });
    expect(html).toContain("window.print()");
    const emailHtml = buildInvoiceHtml({ payment: { id: "pay-12345678", amountMinor: 100n, currency: "BDT", method: "sslcommerz", createdAt: new Date(NOW) }, orgName: "Shop", forEmail: true });
    expect(emailHtml).not.toContain("window.print");
    expect(emailHtml).toContain("BDT 1.00");
  });

  it("EmailProvider passes html to the transport and still requires a message id", async () => {
    process.env.SMTP_HOST = "mailpit.local"; process.env.SMTP_FROM = "billing@qosprey.example";
    const calls: any[] = [];
    const provider = new EmailProvider({ sendMail: async (m: any) => { calls.push(m); return { messageId: "mid-1" }; } });
    const out = await provider.send({ to: "a@b.c", subject: "s", text: "t", html: "<b>h</b>" });
    expect(out.providerMessageId).toBe("mid-1");
    expect(calls[0].html).toBe("<b>h</b>");
    expect(calls[0].text).toBe("t");
    const noId = new EmailProvider({ sendMail: async () => ({}) });
    await expect(noId.send({ to: "a@b.c", subject: "s", text: "t" })).rejects.toThrow(/NOT counted as sent/);
    delete process.env.SMTP_HOST; delete process.env.SMTP_FROM;
  });
});
