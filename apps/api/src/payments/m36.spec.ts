import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { PaymentsService, verifyIpnSignature } from "./payments.service";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/** Milestone 36 (Phase N1): SSLCommerz checkout + IPN trust rules. */
const STORE_PASS = "test-pass";

function sign(body: Record<string, string>, keyOrder: string[]): Record<string, string> {
  let acc = createHash("md5").update(STORE_PASS).digest("hex");
  for (const k of keyOrder) acc += body[k] ?? "";
  return { ...body, verify_key: keyOrder.join(","), verify_sign: createHash("md5").update(acc).digest("hex") };
}

function table() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    create: async ({ data }: any) => { const row = { id: `row-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id || r.tranId === where.tranId) ?? null,
    findFirst: async () => rows[0] ?? null,
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data);
      return row;
    },
  };
}

function makeService() {
  const p: any = {
    planCheckout: table(),
    organization: { findUnique: async () => ({ id: "org-1", name: "Test Shop" }) },
    businessProfile: { findUnique: async () => ({ contactEmail: "owner@x.com", contactPhone: "01700000000" }) },
    subscription: table(),
    saasPayment: table(),
    systemSetting: { findUnique: async () => null },
  };
  p.subscription.rows.push({ id: "sub-1", organizationId: "org-1", plan: "FREE", status: "TRIALING", currentPeriodEnd: new Date(Date.now() - 86400000), createdAt: new Date() });
  const auditEntries: any[] = [];
  const audit: any = { log: async (e: any) => { auditEntries.push(e); } };
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null,
    sslcommerz: { storeId: "teststore", storePass: STORE_PASS, sandbox: true },
    loadedAt: Date.now(),
  });
  return { svc: new PaymentsService(p, audit), p, auditEntries };
}

function stubFetch(handler: (url: string) => any) {
  (global as any).fetch = async (url: string) => ({ json: async () => handler(String(url)) });
}

const ACTOR = { userId: "u-1", email: "owner@x.com" };

describe("M36 SSLCommerz checkout", () => {
  it("creates a checkout only from the gateway's own SUCCESS + page URL", async () => {
    const { svc, p } = makeService();
    stubFetch(() => ({ status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/pay/x", sessionkey: "S1" }));
    const out = await svc.createCheckout("org-1", ACTOR, "GROWTH", "01712345678");
    expect(out.gatewayUrl).toContain("sslcommerz.com");
    expect(out.amountMinor).toBe("300000");
    expect(out.sandbox).toBe(true);
    const row = p.planCheckout.rows[0];
    expect(row.status).toBe("initiated");
    expect(row.plan).toBe("GROWTH");
  });

  it("surfaces the gateway's refusal and marks the checkout failed; FREE and unknown plans refuse before any call", async () => {
    const { svc, p } = makeService();
    stubFetch(() => ({ status: "FAILED", failed_reason: "Store ID is not valid" }));
    await expect(svc.createCheckout("org-1", ACTOR, "STARTER", "01712345678")).rejects.toBeInstanceOf(BadRequestException);
    expect(p.planCheckout.rows[0].status).toBe("failed");
    await expect(svc.createCheckout("org-1", ACTOR, "FREE", "01712345678")).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createCheckout("org-1", ACTOR, "MEGA", "01712345678")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses honestly when the gateway is not configured", async () => {
    const { svc } = makeService();
    setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, loadedAt: Date.now() });
    delete process.env.SSLCOMMERZ_STORE_ID; delete process.env.SSLCOMMERZ_STORE_PASS;
    await expect(svc.createCheckout("org-1", ACTOR, "GROWTH", "01712345678")).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("M36 IPN trust rules", () => {
  async function initiatedCheckout() {
    const ctx = makeService();
    stubFetch(() => ({ status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/pay/x", sessionkey: "S1" }));
    const out = await ctx.svc.createCheckout("org-1", ACTOR, "GROWTH", "01712345678");
    return { ...ctx, tranId: out.tranId };
  }

  it("activates ONLY after signature + gateway validation + exact amount; replay is a no-op", async () => {
    const { svc, p, tranId, auditEntries } = await initiatedCheckout();
    stubFetch(() => ({ status: "VALID", amount: "3000.00", currency: "BDT", tran_id: tranId }));
    const ipn = sign({ tran_id: tranId, status: "VALID", val_id: "VAL123", amount: "3000.00" }, ["tran_id", "status", "val_id", "amount"]);
    const first = await svc.handleIpn(ipn);
    expect(first.ok).toBe(true);
    expect((first as any).activated).toBe(true);
    const sub = p.subscription.rows[0];
    expect(sub.plan).toBe("GROWTH");
    expect(sub.status).toBe("ACTIVE");
    const endMs = new Date(sub.currentPeriodEnd).getTime();
    expect(endMs).toBeGreaterThan(Date.now() + 29 * 86400000);
    expect(p.saasPayment.rows.length).toBe(1);
    expect(p.saasPayment.rows[0].method).toBe("sslcommerz");
    expect(p.saasPayment.rows[0].amountMinor).toBe(300000n);
    expect(p.planCheckout.rows[0].status).toBe("success");
    expect(auditEntries.some((e: any) => e.action === "billing.online_payment_completed")).toBe(true);

    const replay = await svc.handleIpn(ipn);
    expect((replay as any).alreadyProcessed).toBe(true);
    expect(p.saasPayment.rows.length).toBe(1);
    expect(new Date(p.subscription.rows[0].currentPeriodEnd).getTime()).toBe(endMs);
  });

  it("never activates on a bad signature, a validation refusal, or an amount mismatch", async () => {
    const { svc, p, tranId } = await initiatedCheckout();
    stubFetch(() => ({ status: "VALID", amount: "3000.00", currency: "BDT", tran_id: tranId }));
    const good = sign({ tran_id: tranId, status: "VALID", val_id: "VAL123", amount: "3000.00" }, ["tran_id", "status", "val_id", "amount"]);
    const tampered = { ...good, val_id: "FORGED" };
    expect(verifyIpnSignature(STORE_PASS, tampered)).toBe(false);
    expect((await svc.handleIpn(tampered)).ok).toBe(false);
    expect(p.subscription.rows[0].plan).toBe("FREE");

    stubFetch(() => ({ status: "INVALID_TRANSACTION" }));
    expect((await svc.handleIpn(good)).ok).toBe(false);
    expect(p.subscription.rows[0].plan).toBe("FREE");

    stubFetch(() => ({ status: "VALID", amount: "10.00", currency: "BDT", tran_id: tranId }));
    const mismatch = await svc.handleIpn(good);
    expect(mismatch.ok).toBe(false);
    expect((mismatch as any).reason).toContain("amount");
    expect(p.saasPayment.rows.length).toBe(0);
  });

  it("records FAILED IPNs without activating; unknown tran ids are ignored", async () => {
    const { svc, p, tranId } = await initiatedCheckout();
    const failed = sign({ tran_id: tranId, status: "FAILED", val_id: "", amount: "3000.00" }, ["tran_id", "status", "val_id", "amount"]);
    const out = await svc.handleIpn(failed);
    expect(out.ok).toBe(true);
    expect(p.planCheckout.rows[0].status).toBe("failed");
    expect(p.saasPayment.rows.length).toBe(0);
    const unknown = await svc.handleIpn(sign({ tran_id: "QCNOPE", status: "VALID", val_id: "V", amount: "1.00" }, ["tran_id", "status", "val_id", "amount"]));
    expect((unknown as any).ignored).toBe(true);
  });
});
