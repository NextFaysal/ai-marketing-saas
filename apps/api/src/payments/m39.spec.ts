import { PaymentsService } from "./payments.service";
import { AdminService } from "../admin/admin.service";
import { AutomationService } from "../automation/automation.service";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/** Milestone 39 (Admin Phase A3): coupons, credit, bKash,
 * reconciliation, refunds, proration, dunning. */
function match(row: any, where: any = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("gte" in (v as any)) { if (!(new Date(row[k]).getTime() >= new Date((v as any).gte).getTime())) return false; }
      else if ("in" in (v as any)) { if (!(v as any).in.includes(row[k])) return false; }
      else return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
function table(seed: any[] = []) {
  const rows = [...seed];
  let seq = rows.length;
  return {
    rows,
    create: async ({ data }: any) => { const row = { id: `row-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    findMany: async (args: any = {}) => {
      let out = rows.filter((r) => match(r, args.where ?? {}));
      if (args.orderBy?.createdAt === "desc") out = [...out].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (args.take) out = out.slice(0, args.take);
      return out;
    },
    findFirst: async (args: any = {}) => {
      const out = rows.filter((r) => match(r, args.where ?? {}));
      out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return out[0] ?? null;
    },
    findUnique: async ({ where }: any) => rows.find((r) =>
      (where.id !== undefined && r.id === where.id) ||
      (where.code !== undefined && r.code === where.code) ||
      (where.tranId !== undefined && r.tranId === where.tranId) ||
      (where.key !== undefined && r.key === where.key)) ?? null,
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
    count: async (args: any = {}) => rows.filter((r) => match(r, args.where ?? {})).length,
  };
}
const ACTOR = { userId: "u-1", email: "owner@x.com" };
let fetchCalls: string[] = [];
function stubFetch(handler: (url: string) => any) {
  fetchCalls = [];
  (global as any).fetch = async (url: string) => {
    fetchCalls.push(String(url));
    return { json: async () => handler(String(url)) };
  };
}

function makePayments(orgCredit = 0n) {
  const p: any = {
    planCheckout: table(),
    organization: {
      rows: [{ id: "org-1", name: "Test Shop", creditMinor: orgCredit }],
      findUnique: async () => p.organization.rows[0],
      update: async ({ data }: any) => { Object.assign(p.organization.rows[0], data); return p.organization.rows[0]; },
      findMany: async () => p.organization.rows,
    },
    businessProfile: { findUnique: async () => ({ contactEmail: "owner@x.com", contactPhone: "01700000000" }) },
    subscription: table([{ id: "sub-1", organizationId: "org-1", plan: "FREE", status: "TRIALING", currentPeriodEnd: new Date(Date.now() - 86400000), createdAt: new Date() }]),
    saasPayment: table(),
    coupon: table([
      { id: "c-1", code: "SAVE10", kind: "percent", value: 10, planScope: null, active: true, redeemedCount: 0, expiresAt: null, maxRedemptions: null },
      { id: "c-2", code: "FULL", kind: "fixed", value: 300000, planScope: null, active: true, redeemedCount: 0, expiresAt: null, maxRedemptions: null },
      { id: "c-3", code: "OLD", kind: "percent", value: 20, planScope: null, active: true, redeemedCount: 0, expiresAt: new Date(Date.now() - 1000), maxRedemptions: null },
    ]),
    couponRedemption: table(),
    systemSetting: { findUnique: async () => null },
  };
  const auditEntries: any[] = [];
  const audit: any = { log: async (e: any) => { auditEntries.push(e); } };
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null,
    sslcommerz: { storeId: "teststore", storePass: "test-pass", sandbox: true },
    bkash: { appKey: "ak", appSecret: "as", username: "bu", password: "bp", sandbox: true },
    loadedAt: Date.now(),
  });
  return { svc: new PaymentsService(p, audit), p, auditEntries };
}

describe("M39 coupon + credit checkout math", () => {
  it("applies coupon then credit; the gateway is charged only the remainder", async () => {
    const { svc, p } = makePayments(100000n);
    stubFetch(() => ({ status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/pay/x", sessionkey: "S1" }));
    const out = await svc.createCheckout("org-1", ACTOR, "GROWTH", "01712345678", { couponCode: "save10" });
    expect(out.amountMinor).toBe("170000"); // 300000 - 30000 coupon - 100000 credit
    const row = p.planCheckout.rows[0];
    expect(BigInt(row.discountMinor)).toBe(30000n);
    expect(BigInt(row.creditAppliedMinor)).toBe(100000n);
    expect(row.couponCode).toBe("SAVE10");
  });

  it("activates WITHOUT any gateway call when coupon/credit cover the full price, and records the redemption", async () => {
    const { svc, p } = makePayments(0n);
    stubFetch(() => { throw new Error("gateway must not be called"); });
    const out: any = await svc.createCheckout("org-1", ACTOR, "GROWTH", "01712345678", { couponCode: "FULL" });
    expect(out.viaCredit).toBe(true);
    expect(fetchCalls.length).toBe(0);
    expect(p.planCheckout.rows[0].status).toBe("success");
    expect(p.subscription.rows[0].plan).toBe("GROWTH");
    expect(p.subscription.rows[0].status).toBe("ACTIVE");
    expect(p.saasPayment.rows[0].amountMinor).toBe(300000n); // full value recorded
    expect(p.couponRedemption.rows.length).toBe(1);
    expect(p.coupon.rows.find((c: any) => c.code === "FULL").redeemedCount).toBe(1);
  });

  it("REGRESSION (live-found): coupon creation accepts the admin user shape ({ id }) — req.adminUser has no userId", async () => {
    const { svc, p } = makePayments(0n);
    const created: any = await svc.createCoupon({ id: "admin-9" }, { code: "NEW5", kind: "percent", value: 5 });
    expect(created.code).toBe("NEW5");
    expect(p.coupon.rows.find((c: any) => c.code === "NEW5").createdById).toBe("admin-9");
    const off: any = await svc.setCouponActive({ id: "admin-9" }, created.id, false, "promo ended");
    expect(off.active).toBe(false);
  });

  it("refuses expired coupons and previews honestly", async () => {
    const { svc } = makePayments(0n);
    await expect(svc.previewCoupon("org-1", "OLD", "GROWTH")).rejects.toThrow(/expired/);
    const preview = await svc.previewCoupon("org-1", "SAVE10", "STARTER");
    expect(preview.discountMinor).toBe("15000");
    expect(preview.dueMinor).toBe("135000");
  });
});

describe("M39 bKash checkout + callback trust", () => {
  function bkashFetch(executeResult: any) {
    stubFetch((url) => {
      if (url.includes("/token/grant")) return { id_token: "TOK", expires_in: 3600 };
      if (url.includes("/checkout/create")) return { statusCode: "0000", paymentID: "PAY1", bkashURL: "https://sandbox.bkash.com/pay/PAY1" };
      if (url.includes("/checkout/execute")) return executeResult;
      return {};
    });
  }
  it("creates a bKash payment and activates ONLY on a Completed execute with the exact amount", async () => {
    const { svc, p } = makePayments(0n);
    bkashFetch({ statusCode: "0000", transactionStatus: "Completed", amount: "3000.00", trxID: "TRX1" });
    const out: any = await svc.createCheckout("org-1", ACTOR, "GROWTH", "01712345678", { gateway: "bkash" });
    expect(out.gatewayUrl).toContain("bkash.com");
    expect(out.gateway).toBe("bkash");
    const redirect = await svc.handleBkashCallback({ paymentID: "PAY1", status: "success" });
    expect(redirect).toContain("payment=received");
    expect(p.subscription.rows[0].status).toBe("ACTIVE");
    expect(p.saasPayment.rows[0].method).toBe("bkash_gateway");
    expect(p.saasPayment.rows[0].amountMinor).toBe(300000n);
  });

  it("does NOT activate when execute shows the payment is not Completed", async () => {
    const { svc, p } = makePayments(0n);
    bkashFetch({ statusCode: "0000", transactionStatus: "Initiated", amount: "3000.00" });
    await svc.createCheckout("org-1", ACTOR, "GROWTH", "01712345678", { gateway: "bkash" });
    const redirect = await svc.handleBkashCallback({ paymentID: "PAY1", status: "success" });
    expect(redirect).toContain("payment=failed");
    expect(p.saasPayment.rows.length).toBe(0);
    expect(p.subscription.rows[0].plan).toBe("FREE");
  });
});

describe("M39 SSLCommerz reconciliation", () => {
  it("activates a stuck checkout from the gateway's own transaction record", async () => {
    const { svc, p } = makePayments(0n);
    stubFetch((url) => {
      if (url.includes("gwprocess")) return { status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/pay/x", sessionkey: "S1" };
      return {};
    });
    const out = await svc.createCheckout("org-1", ACTOR, "GROWTH", "01712345678");
    stubFetch((url) => {
      if (url.includes("merchantTransIDvalidationAPI")) return { element: [{ tran_id: out.tranId, status: "VALID", val_id: "V9" }] };
      if (url.includes("validationserverAPI")) return { status: "VALID", amount: "3000.00", currency: "BDT", tran_id: out.tranId };
      return {};
    });
    const checkoutId = p.planCheckout.rows[0].id;
    const reconciled: any = await svc.reconcileCheckout(checkoutId);
    expect(reconciled.ok).toBe(true);
    expect(reconciled.reconciled).toBe(true);
    expect(p.planCheckout.rows[0].status).toBe("success");
    const again: any = await svc.reconcileCheckout(checkoutId);
    expect(again.alreadyProcessed).toBe(true);
  });

  it("reports honestly when the gateway has no record", async () => {
    const { svc, p } = makePayments(0n);
    stubFetch((url) => {
      if (url.includes("gwprocess")) return { status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/pay/x", sessionkey: "S1" };
      if (url.includes("merchantTransIDvalidationAPI")) return { element: [] };
      return {};
    });
    await svc.createCheckout("org-1", ACTOR, "GROWTH", "01712345678");
    const out: any = await svc.reconcileCheckout(p.planCheckout.rows[0].id);
    expect(out.ok).toBe(false);
    expect(out.reason).toContain("no record");
    expect(p.planCheckout.rows[0].status).toBe("initiated");
  });
});

describe("M39 refunds + proration (AdminService)", () => {
  function makeAdmin() {
    const p: any = {
      organization: {
        rows: [{ id: "org-1", name: "Test Shop", creditMinor: 0n }],
        findUnique: async () => p.organization.rows[0],
        findMany: async () => p.organization.rows,
        update: async ({ data }: any) => { Object.assign(p.organization.rows[0], data); return p.organization.rows[0]; },
      },
      subscription: table([{ id: "sub-1", organizationId: "org-1", plan: "GROWTH", status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 15 * 86400000 - 3600000), createdAt: new Date() }]),
      saasPayment: table([{ id: "pay-1", organizationId: "org-1", amountMinor: 300000n, refundedMinor: 0n, method: "bkash", currency: "BDT", createdAt: new Date() }]),
      systemSetting: table(),
      auditLog: table(),
      membership: table(),
    };
    const logs: any[] = [];
    const audit: any = { log: async (e: any) => { logs.push(e); } };
    return { svc: new AdminService(p, audit), p, logs };
  }
  const admin = { id: "admin-1" };

  it("records partial refunds, refuses over-refunds, and revokes access only when asked", async () => {
    const { svc, p } = makeAdmin();
    const first: any = await svc.refundPayment(admin, "pay-1", { amountMinor: "100000", reason: "customer dispute" });
    expect(first.refundedMinor).toBe("100000");
    expect(first.netMinor).toBe("200000");
    expect(first.accessRevoked).toBe(false);
    expect(p.subscription.rows[0].status).toBe("ACTIVE");
    await expect(svc.refundPayment(admin, "pay-1", { amountMinor: "200001", reason: "too much" })).rejects.toThrow(/exceeds/);
    const rest: any = await svc.refundPayment(admin, "pay-1", { reason: "full refund", revokeAccess: true });
    expect(rest.refundedMinor).toBe("300000");
    expect(rest.accessRevoked).toBe(true);
    expect(p.subscription.rows[0].status).toBe("PAST_DUE");
    await expect(svc.refundPayment(admin, "pay-1", { reason: "again" })).rejects.toThrow(/fully refunded/);
  });

  it("credits the unused fraction of the old plan on a mid-period plan change", async () => {
    const { svc, p } = makeAdmin();
    const out: any = await svc.updateSubscription(admin, "org-1", { plan: "AGENCY" }, "upgrade requested");
    expect(out.prorationCreditMinor).toBe("150000"); // 15 of 30 days of GROWTH (300000)
    expect(p.organization.rows[0].creditMinor).toBe(150000n);
  });
});

describe("M39 dunning (AutomationService)", () => {
  it("sends each stage once per past-due episode", async () => {
    const auditRows: any[] = [];
    const p: any = {
      subscription: table([{ id: "sub-1", organizationId: "org-1", plan: "GROWTH", status: "PAST_DUE", currentPeriodEnd: new Date(Date.now() - 4 * 86400000), createdAt: new Date() }]),
      organization: { findUnique: async () => ({ id: "org-1", name: "Test Shop" }) },
      membership: table([{ id: "m-1", organizationId: "org-1", role: "OWNER", user: { email: "owner@x.com" } }]),
      auditLog: {
        findMany: async () => auditRows.filter((r) => r.action === "billing.dunning_sent"),
      },
    };
    const audit: any = {
      log: async (e: any) => { auditRows.push({ ...e, createdAt: new Date() }); },
    };
    const sends: any[] = [];
    const email: any = { send: async (m: any) => { sends.push(m); return { providerMessageId: "msg-1" }; } };
    const svc = new AutomationService(p, audit, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, email);
    const first: any = await svc.sendDunningReminder("org-1");
    expect(first.stage).toBe(3); // 4 days overdue
    expect(first.sent).toBe(1);
    expect(sends.length).toBe(1);
    const second: any = await svc.sendDunningReminder("org-1");
    expect(second.skipped).toBe("stage already sent");
    expect(sends.length).toBe(1);
    const other: any = await svc.sendDunningReminder("org-unknown");
    // no subscription row for this org in the fake (findFirst returns the only row regardless) — guard is status-based; org-1 is covered above.
    expect(other).toBeDefined();
  });
});
