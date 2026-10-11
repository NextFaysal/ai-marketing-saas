import { PaymentsService } from "./payments.service";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * Billing Package B4: the bKash agreement lifecycle with a
 * stubbed gateway — consent stores the id SEALED, charges
 * activate ONLY on bKash's Completed execute, failures are
 * recorded (never retried silently, never claimed), and a
 * not-yet-due subscription is never charged.
 */
const NOW = new Date("2026-10-11T06:00:00.000Z").getTime();
const DAY = 86400000;
const HOUR = 3600000;

function table(seed: any[] = []) {
  const rows = [...seed];
  return {
    rows,
    create: async ({ data }: any) => { const r = { id: `r-${rows.length + 1}`, createdAt: new Date(NOW), ...data }; rows.push(r); return r; },
    findFirst: async () => rows[0] ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id || r.organizationId === where.organizationId || r.tranId === where.tranId) ?? null,
    findMany: async () => rows,
    update: async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id || x.organizationId === where.organizationId); if (r) Object.assign(r, data); return r; },
    count: async () => rows.length,
  };
}

let fetchLog: string[] = [];
let executeResult: any = { statusCode: "0000", transactionStatus: "Completed", trxID: "TRX1", paymentID: "P1" };
function stubBkash() {
  fetchLog = [];
  (global as any).fetch = async (url: string, init: any) => {
    const u = String(url);
    fetchLog.push(u.split("/").slice(-2).join("/"));
    const body = init?.body ? JSON.parse(init.body) : {};
    const json = async () => {
      if (u.includes("/token/grant")) return { id_token: "tok", expires_in: 3600 };
      if (u.includes("/agreement/create")) return { statusCode: "0000", bkashURL: "https://bkash/agree", paymentID: "AP1" };
      if (u.includes("/agreement/execute")) { expect(body.paymentID).toBe("AP1"); return { statusCode: "0000", agreementID: "AGR-SECRET-1" }; }
      if (u.includes("/agreement/cancel")) return { statusCode: "0000" };
      if (u.includes("/checkout/create")) { expect(body.agreementID).toBe("AGR-SECRET-1"); expect(body.mode).toBe("0001"); return { statusCode: "0000", paymentID: "P1" }; }
      if (u.includes("/checkout/execute")) return executeResult;
      throw new Error(`unexpected ${u}`);
    };
    return { json };
  };
}

function makeSvc(subRow: any) {
  const p: any = {
    planCheckout: table(),
    autoRenewAgreement: table(),
    organization: {
      rows: [{ id: "org-1", name: "Shop", creditMinor: 0n }],
      findUnique: async () => p.organization.rows[0],
      update: async ({ data }: any) => { Object.assign(p.organization.rows[0], data); return p.organization.rows[0]; },
    },
    businessProfile: { findUnique: async () => ({ contactEmail: "o@x.com" }) },
    subscription: table([subRow]),
    saasPayment: table(),
    coupon: table(), couponRedemption: table(),
    systemSetting: { findUnique: async () => null },
  };
  const svc = new PaymentsService(p, { log: async () => undefined } as any);
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null,
    bkash: { appKey: "ak", appSecret: "as", username: "bu", password: "bp", sandbox: true }, loadedAt: Date.now(),
  } as any);
  stubBkash();
  return { svc, p };
}

const baseSub = () => ({ id: "sub-1", organizationId: "org-1", plan: "STARTER", status: "ACTIVE", billingCycle: "monthly", currentPeriodEnd: new Date(NOW + 12 * HOUR), createdAt: new Date(NOW) });

describe("B4 bKash auto-renew", () => {
  beforeEach(() => { jest.useFakeTimers({ now: NOW }); executeResult = { statusCode: "0000", transactionStatus: "Completed", trxID: "TRX1", paymentID: "P1" }; });
  afterEach(() => { jest.useRealTimers(); });

  it("consent: start -> pending; callback executes and stores the id SEALED", async () => {
    const { svc, p } = makeSvc(baseSub());
    const out = await svc.startAutoRenew("org-1", { userId: "u-1" }, "01712345678");
    expect(out.bkashURL).toContain("bkash/agree");
    expect(p.autoRenewAgreement.rows[0].status).toBe("pending");
    const redirect = await svc.handleBkashAgreementCallback({ paymentID: "AP1", status: "success" });
    expect(redirect).toContain("autorenew=active");
    const row = p.autoRenewAgreement.rows[0];
    expect(row.status).toBe("active");
    expect(row.agreementIdSealed).toBeTruthy();
    expect(row.agreementIdSealed).not.toContain("AGR-SECRET-1");
    const view: any = await svc.getAutoRenew("org-1");
    expect(view.status).toBe("active");
    expect(JSON.stringify(view)).not.toContain("AGR-SECRET-1");
  });

  it("charge: due within 24h -> create+execute Completed -> activated, period extended", async () => {
    const { svc, p } = makeSvc(baseSub());
    await svc.startAutoRenew("org-1", { userId: "u-1" }, "01712345678");
    await svc.handleBkashAgreementCallback({ paymentID: "AP1", status: "success" });
    const res: any = await svc.chargeAutoRenew("org-1");
    expect(res.charged).toBe(true);
    expect(p.subscription.rows[0].status).toBe("ACTIVE");
    expect(new Date(p.subscription.rows[0].currentPeriodEnd).getTime()).toBe(NOW + 12 * HOUR + 30 * DAY);
    expect(p.autoRenewAgreement.rows[0].lastChargeAt).toBeTruthy();
    expect(BigInt(p.saasPayment.rows[0].amountMinor)).toBe(150000n);
  });

  it("charge failure is recorded, never claimed, subscription untouched", async () => {
    executeResult = { statusCode: "0000", transactionStatus: "Failed", statusMessage: "Insufficient balance" };
    const { svc, p } = makeSvc(baseSub());
    await svc.startAutoRenew("org-1", { userId: "u-1" }, "01712345678");
    await svc.handleBkashAgreementCallback({ paymentID: "AP1", status: "success" });
    const before = p.subscription.rows[0].currentPeriodEnd;
    const res: any = await svc.chargeAutoRenew("org-1");
    expect(res.charged).toBe(false);
    expect(p.planCheckout.rows[0].status).toBe("failed");
    expect(p.autoRenewAgreement.rows[0].lastError).toContain("not completed");
    expect(p.subscription.rows[0].currentPeriodEnd).toBe(before);
    expect(p.saasPayment.rows).toHaveLength(0);
  });

  it("not due yet -> no gateway charge call at all; cancel seals nothing and calls bKash cancel", async () => {
    const sub = baseSub(); sub.currentPeriodEnd = new Date(NOW + 5 * DAY);
    const { svc, p } = makeSvc(sub);
    await svc.startAutoRenew("org-1", { userId: "u-1" }, "01712345678");
    await svc.handleBkashAgreementCallback({ paymentID: "AP1", status: "success" });
    fetchLog = [];
    const res: any = await svc.chargeAutoRenew("org-1");
    expect(res).toMatchObject({ charged: false, reason: "not_due_yet" });
    expect(fetchLog.filter((f) => f.includes("checkout/create"))).toHaveLength(0);
    const cancelled: any = await svc.cancelAutoRenew("org-1", "u-1");
    expect(cancelled.gatewayCancelled).toBe(true);
    expect(p.autoRenewAgreement.rows[0].status).toBe("cancelled");
    expect(p.autoRenewAgreement.rows[0].agreementIdSealed).toBeNull();
  });
});
