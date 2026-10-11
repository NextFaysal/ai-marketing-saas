import { NotFoundException } from "@nestjs/common";
import { CourierService } from "./courier.service";
import { JOB_TEMPLATES, JOB_TYPES } from "../automation/automation.service";

/**
 * CX6 — Tracking Card + All-Customer Updates + Auto-Sync Job.
 *
 * All customer sends are proven ONLY through fake providers at the
 * send seams (inbox stub / SMS stub / email stub) — no real SMS,
 * email or chat message is claimed anywhere in this suite.
 */
describe("CX6 tracking + notify", () => {
  const ORG = "org-1";
  const shipmentRow = (over: any = {}) => ({
    id: "sh-1", organizationId: ORG, orderId: "ord-1", provider: "steadfast",
    consignmentId: "555", trackingCode: "TRK-1", invoice: "INV-1", status: "delivered",
    codAmountMinor: 0n, recipientName: "Rahim", recipientPhone: "01711111111",
    recipientAddress: "Mirpur, Dhaka", lastNotifiedStatus: null, lastCheckedAt: null,
    trackingToken: null, createdAt: new Date("2026-10-01T10:00:00Z"), updatedAt: new Date("2026-10-03T10:00:00Z"),
    ...over,
  });
  const orderRow = (over: any = {}) => ({
    id: "ord-1", organizationId: ORG, externalNumber: "1042", conversationId: "conv-1",
    customerId: "cus-1", customer: { phone: "01711111111", email: "rahim@example.com" }, ...over,
  });

  function makeSvc(opts: { shipment?: any; order?: any; smsConfigured?: boolean; emailConfigured?: boolean } = {}) {
    const shipment = shipmentRow(opts.shipment);
    const order = opts.order === undefined ? orderRow() : opts.order;
    const updates: any[] = [];
    const prisma = {
      courierShipment: {
        findFirst: async ({ where }: any) => {
          if (where.trackingToken) return shipment.trackingToken === where.trackingToken ? shipment : null;
          if (where.id && where.organizationId) return shipment.id === where.id && shipment.organizationId === where.organizationId ? shipment : null;
          return shipment;
        },
        findMany: async () => [shipment],
        update: async ({ where, data }: any) => { updates.push({ where, data }); Object.assign(shipment, data); return shipment; },
      },
      order: { findFirst: async () => order },
      organization: { findFirst: async () => ({ id: ORG, name: "Legal Name Ltd", brandName: "Meghna Attire", logoUrl: "/uploads/logo.png", primaryColor: "#123456" }) },
    };
    const inboxCalls: any[] = [];
    const inbox = { sendAutomatedMessage: async (...a: any[]) => { inboxCalls.push(a); return { id: "m-1" }; } };
    const smsCalls: any[] = [];
    const sms = { isConfigured: () => opts.smsConfigured ?? true, send: async (i: any) => { smsCalls.push(i); return { providerMessageId: "sms-1" }; } };
    const emailCalls: any[] = [];
    const email = { isConfigured: () => opts.emailConfigured ?? true, send: async (i: any) => { emailCalls.push(i); return { providerMessageId: "em-1" }; } };
    const svc = new CourierService(prisma as any, { log: async () => undefined } as any, inbox as any, undefined, undefined, sms as any, email as any);
    return { svc, shipment, updates, inboxCalls, smsCalls, emailCalls };
  }

  it("publicTracking: unknown token -> 404", async () => {
    const { svc } = makeSvc();
    await expect(svc.publicTracking("no-such-token")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("publicTracking: stored facts only — verbatim status, branding, NO recipient PII", async () => {
    const { svc, shipment } = makeSvc();
    shipment.trackingToken = "tok-abc";
    const page: any = await svc.publicTracking("tok-abc");
    expect(page.status).toBe("delivered");
    expect(page.provider).toBe("steadfast");
    expect(page.trackingCode).toBe("TRK-1");
    expect(page.orderNumber).toBe("1042");
    expect(page.branding).toEqual({ name: "Meghna Attire", logoUrl: "/uploads/logo.png", primaryColor: "#123456" });
    const keys: string[] = [];
    (function walk(v: any) { if (v && typeof v === "object") for (const k of Object.keys(v)) { keys.push(k); walk(v[k]); } })(page);
    expect(keys).not.toContain("recipientPhone");
    expect(keys).not.toContain("recipientName");
    expect(keys).not.toContain("recipientAddress");
  });

  it("ensureTrackingToken mints once (base64url, persisted) and then reuses", async () => {
    const { svc, shipment, updates } = makeSvc();
    const t1 = await svc.ensureTrackingToken(ORG, shipment);
    expect(t1).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(updates.filter((u) => u.data.trackingToken).length).toBe(1);
    const t2 = await svc.ensureTrackingToken(ORG, shipment);
    expect(t2).toBe(t1);
    expect(updates.filter((u) => u.data.trackingToken).length).toBe(1);
  });

  it("trackingLinkForShipment is org-scoped (another org's shipment -> 404)", async () => {
    const { svc } = makeSvc();
    await expect(svc.trackingLinkForShipment("org-2", "sh-1")).rejects.toBeInstanceOf(NotFoundException);
    const out = await svc.trackingLinkForShipment(ORG, "sh-1");
    expect(out.link).toContain("/t/");
    expect(out.link).toContain(out.token);
  });

  it("notify precedence: conversation wins; card text carries the tracking link; stamped once", async () => {
    const { svc, shipment, inboxCalls, smsCalls, emailCalls } = makeSvc();
    await (svc as any).notifyCustomer(ORG, shipment);
    expect(inboxCalls.length).toBe(1);
    const [, convId, text, tag] = inboxCalls[0];
    expect(convId).toBe("conv-1");
    expect(tag).toBe("courier_update");
    expect(text).toContain("🚚 steadfast কুরিয়ার");
    expect(text).toContain("Tracking: TRK-1");
    expect(text).toContain("লাইভ ট্র্যাকিং: ");
    expect(text).toContain(`/t/${shipment.trackingToken}`);
    expect(smsCalls.length).toBe(0);
    expect(emailCalls.length).toBe(0);
    expect(shipment.lastNotifiedStatus).toBe("delivered");
  });

  it("dedupe: an already-stamped status is never re-sent on ANY channel", async () => {
    const { svc, shipment, inboxCalls, smsCalls, emailCalls } = makeSvc({ shipment: { lastNotifiedStatus: "delivered" } });
    await (svc as any).notifyCustomer(ORG, shipment);
    expect(inboxCalls.length + smsCalls.length + emailCalls.length).toBe(0);
  });

  it("no conversation -> SMS to the normalized phone; inbox untouched; stamped", async () => {
    const { svc, shipment, inboxCalls, smsCalls } = makeSvc({ order: orderRow({ conversationId: null }) });
    await (svc as any).notifyCustomer(ORG, shipment);
    expect(inboxCalls.length).toBe(0);
    expect(smsCalls.length).toBe(1);
    expect(smsCalls[0].to).toBe("8801711111111");
    expect(smsCalls[0].text).toContain("লাইভ ট্র্যাকিং: ");
    expect(shipment.lastNotifiedStatus).toBe("delivered");
  });

  it("SMS unconfigured -> falls through to email; both unconfigured -> silent, NO stamp, no throw", async () => {
    const a = makeSvc({ order: orderRow({ conversationId: null }), smsConfigured: false });
    await (a.svc as any).notifyCustomer(ORG, a.shipment);
    expect(a.smsCalls.length).toBe(0);
    expect(a.emailCalls.length).toBe(1);
    expect(a.emailCalls[0].to).toBe("rahim@example.com");
    expect(a.shipment.lastNotifiedStatus).toBe("delivered");

    const b = makeSvc({ order: orderRow({ conversationId: null, customer: { phone: "01711111111", email: null } }), smsConfigured: false, emailConfigured: false });
    await expect((b.svc as any).notifyCustomer(ORG, b.shipment)).resolves.toBeUndefined();
    expect(b.smsCalls.length + b.emailCalls.length).toBe(0);
    // not stamped: a later sync may retry when a channel exists
    expect(b.shipment.lastNotifiedStatus).toBeNull();
  });

  it("booked card stamps 'booked'; first movement then sends the shipped card; repeats dedupe", async () => {
    const { svc, shipment, inboxCalls } = makeSvc({ shipment: { status: "in_review" } });
    await (svc as any).notifyCustomer(ORG, shipment, { booked: true });
    expect(inboxCalls.length).toBe(1);
    expect(inboxCalls[0][2]).toContain("বুক করা হয়েছে");
    expect(shipment.lastNotifiedStatus).toBe("booked");
    // booked again -> nothing
    await (svc as any).notifyCustomer(ORG, shipment, { booked: true });
    expect(inboxCalls.length).toBe(1);
    // first real movement
    shipment.status = "in_transit";
    await (svc as any).notifyCustomer(ORG, shipment);
    expect(inboxCalls.length).toBe(2);
    expect(inboxCalls[1][2]).toContain("ডেলিভারির পথে আছে");
    expect(shipment.lastNotifiedStatus).toBe("in_transit");
  });

  it("a pending first status stays silent (pre-movement), exactly as before", async () => {
    const { svc, shipment, inboxCalls, smsCalls } = makeSvc({ shipment: { status: "pending" } });
    await (svc as any).notifyCustomer(ORG, shipment);
    expect(inboxCalls.length + smsCalls.length).toBe(0);
    expect(shipment.lastNotifiedStatus).toBeNull();
  });
});

describe("CX6 courier_auto_sync job", () => {
  it("is registered: JOB_TYPES + template (org, 60 min default)", () => {
    expect(JOB_TYPES).toContain("courier_auto_sync");
    const tpl = JOB_TEMPLATES.find((t) => t.type === "courier_auto_sync");
    expect(tpl).toBeTruthy();
    expect(tpl!.targetKind).toBe("org");
    expect(tpl!.intervalMinutes).toBe(60);
  });

  it("syncAll batches open shipments and isolates per-shipment failures", async () => {
    const rows = [
      { id: "s1", organizationId: "org-1", orderId: "o1", provider: "steadfast", trackingCode: "T1", status: "in_transit", lastNotifiedStatus: null, trackingToken: "x1", recipientPhone: "01711111111", createdAt: new Date(), updatedAt: new Date() },
      { id: "s2", organizationId: "org-1", orderId: "o2", provider: "steadfast", trackingCode: "T2", status: "in_transit", lastNotifiedStatus: null, trackingToken: "x2", recipientPhone: "01711111111", createdAt: new Date(), updatedAt: new Date() },
      { id: "s3", organizationId: "org-1", orderId: "o3", provider: "steadfast", trackingCode: "T3", status: "delivered", lastNotifiedStatus: "delivered", trackingToken: "x3", recipientPhone: "01711111111", createdAt: new Date(), updatedAt: new Date() },
    ];
    const prisma = {
      courierShipment: {
        findMany: async () => rows,
        findFirst: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
        update: async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id)!; Object.assign(r, data); return r; },
      },
      order: { findFirst: async () => null },
      organization: { findFirst: async () => null },
    };
    const svc = new CourierService(prisma as any, { log: async () => undefined } as any);
    (svc as any).clientFor = async () => ({
      statusByTrackingCode: async (code: string) => {
        if (code === "T2") throw new Error("provider down");
        return "delivered";
      },
    });
    const out = await svc.syncAll("org-1");
    // terminal s3 is excluded from the batch; s2's failure is counted, not fatal
    expect(out.checked).toBe(2);
    expect(out.synced).toBe(1);
    expect(out.changed).toBe(1);
    expect(out.errors.length).toBe(1);
    expect(out.errors[0]).toContain("T2");
  });
});
