import { ForbiddenException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { planLimits, planResourceLimits, billingGraceDays, DEFAULT_PLAN_LIMITS } from "./platform-settings";
import {
  commerceBlocked, checkProductCreate, checkOrderCreate, checkMediaUpload,
  OrderLimitBlockedError, SHOPPER_ORDER_BLOCK_MESSAGE, PAST_DUE_GRACE_MESSAGE,
  dhakaMonthStartUtc,
} from "./plan-limit-checks";
import { saasInvoiceData, buildSaasInvoicePdf, buildInvoiceHtml } from "../payments/payments.service";

/**
 * GC22 (GB9) — Plan Enforcement.
 *
 * Covers: planLimits overlay for the four resource fields
 * (absent = unlimited, stored 0 = blocks, invalid ignored),
 * planResourceLimits/billingGraceDays resolution, commerce
 * pause/grace states, product/order/media check boundaries
 * (limit-1 allowed, at limit refused), the order-block audit +
 * notification throttle, and SaaS invoice PDF data parity
 * with the HTML invoice.
 */

const DAY = 24 * 3600 * 1000;

function makePrisma(opts: {
  settings?: Record<string, unknown>;
  sub?: any;
  productCount?: number;
  orderCount?: number;
  mediaSum?: number | null;
  mediaCount?: number;
  members?: any[];
} = {}) {
  const settings = new Map<string, unknown>(Object.entries(opts.settings ?? {}));
  const subRow = opts.sub === undefined
    ? { id: "sub-1", organizationId: "org-1", plan: "GROWTH", status: "ACTIVE", pausedAt: null, currentPeriodEnd: null, createdAt: new Date() }
    : opts.sub;
  const auditRows: any[] = [];
  const notifications: any[] = [];
  const prisma: any = {
    _auditRows: auditRows,
    _notifications: notifications,
    systemSetting: {
      findUnique: async ({ where }: any) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
    },
    subscription: { findFirst: async () => subRow },
    product: { count: async () => opts.productCount ?? 0 },
    order: { count: async () => opts.orderCount ?? 0 },
    mediaAsset: {
      aggregate: async () => ({ _sum: { sizeBytes: opts.mediaSum ?? 0 }, _count: { _all: opts.mediaCount ?? 0 } }),
    },
    membership: { findMany: async () => opts.members ?? [{ userId: "owner-1" }, { userId: "admin-1" }] },
    notificationPreference: { findUnique: async () => null },
    agentNotification: { create: async ({ data }: any) => { notifications.push(data); return data; } },
    auditLog: {
      findFirst: async ({ where }: any) => {
        const since = where?.createdAt?.gte ? new Date(where.createdAt.gte).getTime() : 0;
        return auditRows.find((r) => r.action === where.action && new Date(r.createdAt).getTime() >= since) ?? null;
      },
      create: async ({ data }: any) => { const row = { ...data, createdAt: data.createdAt ?? new Date() }; auditRows.push(row); return row; },
    },
  };
  return prisma;
}

const limitsSetting = (tierLimits: Record<string, unknown>) => ({ planLimits: { GROWTH: tierLimits } });

describe("GC22 — planLimits overlay for resource fields", () => {
  it("absent everywhere → resource fields absent (unlimited), legacy fields byte-identical", async () => {
    const out = await planLimits(makePrisma());
    expect(out).toEqual(DEFAULT_PLAN_LIMITS);
    expect(out.GROWTH.productLimit).toBeUndefined();
    expect(out.GROWTH.orderLimit).toBeUndefined();
    expect(out.GROWTH.storageLimitMb).toBeUndefined();
    expect(out.GROWTH.apiDailyLimit).toBeUndefined();
  });

  it("stored values overlay per tier/field; other tiers untouched", async () => {
    const p = makePrisma({ settings: limitsSetting({ productLimit: 25, storageLimitMb: 512 }) });
    const out = await planLimits(p);
    expect(out.GROWTH.productLimit).toBe(25);
    expect(out.GROWTH.storageLimitMb).toBe(512);
    expect(out.GROWTH.orderLimit).toBeUndefined();
    expect(out.GROWTH.aiDaily).toBe(DEFAULT_PLAN_LIMITS.GROWTH.aiDaily);
    expect(out.FREE.productLimit).toBeUndefined();
  });

  it("stored 0 is a real value (blocks everything)", async () => {
    const p = makePrisma({ settings: limitsSetting({ productLimit: 0, orderLimit: 0 }) });
    const out = await planLimits(p);
    expect(out.GROWTH.productLimit).toBe(0);
    expect(out.GROWTH.orderLimit).toBe(0);
  });

  it("invalid stored values are ignored (negative, fractional, string)", async () => {
    const p = makePrisma({ settings: limitsSetting({ productLimit: -1, orderLimit: 2.5, storageLimitMb: "100" }) });
    const out = await planLimits(p);
    expect(out.GROWTH.productLimit).toBeUndefined();
    expect(out.GROWTH.orderLimit).toBeUndefined();
    expect(out.GROWTH.storageLimitMb).toBeUndefined();
  });

  it("planResourceLimits resolves the org tier; null = unlimited", async () => {
    const withLimits = await planResourceLimits(makePrisma({ settings: limitsSetting({ productLimit: 10, apiDailyLimit: 100 }) }), "org-1");
    expect(withLimits).toEqual({ plan: "GROWTH", productLimit: 10, orderLimit: null, storageLimitMb: null, apiDailyLimit: 100 });
    const without = await planResourceLimits(makePrisma(), "org-1");
    expect(without).toEqual({ plan: "GROWTH", productLimit: null, orderLimit: null, storageLimitMb: null, apiDailyLimit: null });
  });

  it("billingGraceDays: default 3, stored integer >= 0 wins, invalid → 3", async () => {
    expect(await billingGraceDays(makePrisma())).toBe(3);
    expect(await billingGraceDays(makePrisma({ settings: { billingGraceDays: 7 } }))).toBe(7);
    expect(await billingGraceDays(makePrisma({ settings: { billingGraceDays: 0 } }))).toBe(0);
    expect(await billingGraceDays(makePrisma({ settings: { billingGraceDays: -2 } }))).toBe(3);
    expect(await billingGraceDays(makePrisma({ settings: { billingGraceDays: 1.5 } }))).toBe(3);
  });
});

describe("GC22 — commerceBlocked pause/grace", () => {
  it("no subscription → open", async () => {
    expect(await commerceBlocked(makePrisma({ sub: null }), "org-1")).toEqual({ blocked: false, reason: null, message: null });
  });

  it("pausedAt set → blocked (paused), even when ACTIVE", async () => {
    const out = await commerceBlocked(makePrisma({ sub: { plan: "GROWTH", status: "ACTIVE", pausedAt: new Date(), currentPeriodEnd: null } }), "org-1");
    expect(out.blocked).toBe(true);
    expect(out.reason).toBe("paused");
  });

  it("PAST_DUE inside grace → open; past grace → blocked with the verbatim message", async () => {
    const end = new Date(Date.now() - 2 * DAY); // 2 days past period end, grace 3
    const inside = await commerceBlocked(makePrisma({ sub: { plan: "GROWTH", status: "PAST_DUE", pausedAt: null, currentPeriodEnd: end } }), "org-1");
    expect(inside.blocked).toBe(false);
    const later = await commerceBlocked(makePrisma({ sub: { plan: "GROWTH", status: "PAST_DUE", pausedAt: null, currentPeriodEnd: end } }), "org-1", new Date(Date.now() + 2 * DAY));
    expect(later).toEqual({ blocked: true, reason: "past_due_grace", message: PAST_DUE_GRACE_MESSAGE });
  });

  it("grace 0 setting: PAST_DUE blocks the instant the period ends", async () => {
    const p = makePrisma({
      settings: { billingGraceDays: 0 },
      sub: { plan: "GROWTH", status: "PAST_DUE", pausedAt: null, currentPeriodEnd: new Date(Date.now() - 1000) },
    });
    expect((await commerceBlocked(p, "org-1")).reason).toBe("past_due_grace");
  });

  it("PAST_DUE without a period end → open (nothing positively known)", async () => {
    const out = await commerceBlocked(makePrisma({ sub: { plan: "GROWTH", status: "PAST_DUE", pausedAt: null, currentPeriodEnd: null } }), "org-1");
    expect(out.blocked).toBe(false);
  });

  it("infra failure → open (never blocks on missing limit info)", async () => {
    const broken: any = { subscription: { findFirst: async () => { throw new Error("db down"); } } };
    expect((await commerceBlocked(broken, "org-1")).blocked).toBe(false);
  });
});

describe("GC22 — checkProductCreate boundaries", () => {
  it("limit-1 products → allowed; at limit → Forbidden naming limit + usage", async () => {
    const at = (n: number) => makePrisma({ settings: limitsSetting({ productLimit: 3 }), productCount: n });
    await expect(checkProductCreate(at(2), "org-1")).resolves.toBeUndefined();
    const err = await checkProductCreate(at(3), "org-1").catch((e) => e);
    expect(err).toMatchObject({ code: "common.planProductLimitReached", status: 403 });
    expect(err.message).toContain("3");
    expect(err.message).toContain("পণ্য সীমা");
  });

  it("productLimit 0 blocks the very first product", async () => {
    const p = makePrisma({ settings: limitsSetting({ productLimit: 0 }), productCount: 0 });
    await expect(checkProductCreate(p, "org-1")).rejects.toMatchObject({ code: "common.planProductLimitReached", status: 403 });
  });

  it("no productLimit → unlimited even with many products", async () => {
    await expect(checkProductCreate(makePrisma({ productCount: 99999 }), "org-1")).resolves.toBeUndefined();
  });

  it("paused org is refused before the limit is even read", async () => {
    const p = makePrisma({ sub: { plan: "GROWTH", status: "ACTIVE", pausedAt: new Date(), currentPeriodEnd: null } });
    const err = await checkProductCreate(p, "org-1").catch((e) => e);
    expect(err).toMatchObject({ code: "common.subscriptionPausedBlock", status: 403 });
    expect(err.message).toContain("pause");
  });
});

describe("GC22 — checkOrderCreate boundaries + notification throttle", () => {
  it("limit-1 orders this month → allowed; at limit → OrderLimitBlockedError with shopper message", async () => {
    const at = (n: number) => makePrisma({ settings: limitsSetting({ orderLimit: 5 }), orderCount: n });
    await expect(checkOrderCreate(at(4), "org-1")).resolves.toBeUndefined();
    const err = await checkOrderCreate(at(5), "org-1").catch((e) => e);
    expect(err).toBeInstanceOf(OrderLimitBlockedError);
    // The class keeps its concrete ForbiddenException type by
    // design (ML10 withCatalogCode pattern); MB4's contract is
    // the catalog pointer the filter renders from.
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.catalogCode).toBe("common.monthlyOrderLimitReached");
    expect(err.code).toBe("ORDER_LIMIT_BLOCKED");
    expect(err.shopperMessage).toBe(SHOPPER_ORDER_BLOCK_MESSAGE);
    expect(err.shopperMessage).not.toContain("সীমা");
    expect(err.message).toContain("অর্ডার সীমা");
    expect(err.blockReason).toBe("order_limit");
  });

  it("first block audits + notifies OWNER/ADMIN; a second block within the hour audits but does NOT re-notify", async () => {
    const p = makePrisma({ settings: limitsSetting({ orderLimit: 5 }), orderCount: 5 });
    await expect(checkOrderCreate(p, "org-1")).rejects.toBeInstanceOf(OrderLimitBlockedError);
    expect(p._auditRows.filter((r: any) => r.action === "billing.order_limit_blocked")).toHaveLength(1);
    expect(p._notifications).toHaveLength(2); // owner + admin
    expect(p._notifications[0].type).toBe("billing");
    await expect(checkOrderCreate(p, "org-1")).rejects.toBeInstanceOf(OrderLimitBlockedError);
    expect(p._auditRows.filter((r: any) => r.action === "billing.order_limit_blocked")).toHaveLength(2);
    expect(p._notifications).toHaveLength(2); // throttled
  });

  it("audit/notification failure never unblocks a positively-known breach", async () => {
    const p = makePrisma({ settings: limitsSetting({ orderLimit: 1 }), orderCount: 3 });
    p.auditLog.create = async () => { throw new Error("audit down"); };
    p.agentNotification.create = async () => { throw new Error("notify down"); };
    await expect(checkOrderCreate(p, "org-1")).rejects.toBeInstanceOf(OrderLimitBlockedError);
  });

  it("paused org: block reason is paused (no order-limit audit/notification)", async () => {
    const p = makePrisma({ settings: limitsSetting({ orderLimit: 5 }), orderCount: 0, sub: { plan: "GROWTH", status: "ACTIVE", pausedAt: new Date(), currentPeriodEnd: null } });
    const err = await checkOrderCreate(p, "org-1").catch((e) => e);
    expect(err).toBeInstanceOf(OrderLimitBlockedError);
    expect(err.blockReason).toBe("paused");
    expect(p._auditRows).toHaveLength(0);
    expect(p._notifications).toHaveLength(0);
  });

  it("no orderLimit → unlimited", async () => {
    await expect(checkOrderCreate(makePrisma({ orderCount: 100000 }), "org-1")).resolves.toBeUndefined();
  });

  it("dhakaMonthStartUtc lands on the 1st of the Dhaka month at 18:00Z prev day", () => {
    const start = dhakaMonthStartUtc(new Date("2026-10-15T12:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-09-30T18:00:00.000Z");
  });
});

describe("GC22 — checkMediaUpload boundaries", () => {
  const MB = 1024 * 1024;
  it("used + incoming exactly at the limit → allowed; one byte over → refused", async () => {
    const p = makePrisma({ settings: limitsSetting({ storageLimitMb: 2 }), mediaSum: MB });
    await expect(checkMediaUpload(p, "org-1", MB)).resolves.toBeUndefined();
    const err = await checkMediaUpload(p, "org-1", MB + 1).catch((e) => e);
    expect(err).toMatchObject({ code: "common.planStorageLimitReached", status: 403 });
    expect(err.message).toContain("স্টোরেজ সীমা");
    expect(err.message).toContain("2 MB");
  });

  it("storageLimitMb 0 refuses any positive upload but allows a zero-byte probe", async () => {
    const p = makePrisma({ settings: limitsSetting({ storageLimitMb: 0 }), mediaSum: 0 });
    await expect(checkMediaUpload(p, "org-1", 0)).resolves.toBeUndefined();
    await expect(checkMediaUpload(p, "org-1", 1)).rejects.toMatchObject({ code: "common.planStorageLimitReached", status: 403 });
  });

  it("no storageLimitMb → unlimited", async () => {
    await expect(checkMediaUpload(makePrisma({ mediaSum: 10 * MB }), "org-1", 500 * MB)).resolves.toBeUndefined();
  });
});

describe("GC22 — SaaS invoice PDF data parity", () => {
  const payment = {
    id: "12345678-aaaa-bbbb-cccc-deadbeefcafe",
    organizationId: "org-1",
    amountMinor: 300000n, refundedMinor: 50000n, currency: "BDT",
    method: "bkash", reference: "TRX123", periodEnd: new Date("2026-11-14T00:00:00.000Z"),
    note: "GROWTH monthly", refundReason: "duplicate", createdAt: new Date("2026-10-15T10:00:00.000Z"),
  };

  it("saasInvoiceData carries the same number/amounts the HTML renders", () => {
    const d = saasInvoiceData(payment, "Acme Shop", { address: "Dhaka", bin: "BIN-1" });
    expect(d.invoiceNo).toBe("INV-BEEFCAFE");
    expect(d.date).toBe("2026-10-15");
    expect(d.grossMinor).toBe(300000n);
    expect(d.refundedMinor).toBe(50000n);
    expect(d.netMinor).toBe(250000n);
    const html = buildInvoiceHtml({ payment, orgName: "Acme Shop", buyer: { address: "Dhaka", bin: "BIN-1" } });
    expect(html).toContain(d.invoiceNo);
    expect(html).toContain("3,000.00");
    expect(html).toContain("2,500.00");
  });

  it("buildSaasInvoicePdf returns a real, non-trivial PDF carrying the invoice number + totals", () => {
    const d = saasInvoiceData(payment, "Acme Shop", { address: "Dhaka", bin: "BIN-1" });
    const pdf = buildSaasInvoicePdf(d);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(500);
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF")).toBe(true);
    expect(text).toContain("INV-BEEFCAFE");
    expect(text).toContain("BDT 3,000.00");
    expect(text).toContain("BDT 2,500.00");
    expect(text).toContain("Acme Shop");
  });

  it("no-refund invoice: total is the gross, no refund line", () => {
    const d = saasInvoiceData({ ...payment, refundedMinor: 0n }, "Acme Shop");
    const text = buildSaasInvoicePdf(d).toString("latin1");
    expect(text).toContain("BDT 3,000.00");
    expect(text).not.toContain("Refund");
  });
});
