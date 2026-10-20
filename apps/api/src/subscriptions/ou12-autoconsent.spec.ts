import { BadRequestException } from "@nestjs/common";
import { AUTO_CHARGE_READY_LABEL, SubscriptionsService } from "./subscriptions.service";

/**
 * OU12 — auto-charge CONSENT capture for shop subscriptions.
 *
 * Step-0 (docs/one-umbrella-ou12-section.md) proved there is NO
 * shop tokenized charge path in-repo: the tenant gateway client
 * has no bKash agreement / mode-0001 charge method, and the one
 * integrated tokenized charge (PaymentsService.chargeAutoRenew)
 * is bound to platform billing. So OU12 ships consent capture +
 * honest labelling ONLY. These specs pin that contract:
 *  - no consent → the manual/COD flow is byte-identical;
 *  - consent is stored with a SERVER timestamp + method;
 *  - consent without a method (or method without consent) is
 *    refused, never half-recorded;
 *  - the sweep NEVER attempts a charge and NEVER marks a
 *    renewal order paid, consent or not.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      return matches(row[k] ?? {}, v);
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
  };
}
function fakePrisma() {
  return {
    customer: makeTable("customer"), product: makeTable("product"),
    productVariant: makeTable("variant"), order: makeTable("order"),
    orderItem: makeTable("item"), customerSubscription: makeTable("sub"),
    auditLog: makeTable("audit"),
  } as any;
}
function fakeAudit(prisma: any) {
  return {
    log: jest.fn(async (input: any) => {
      await prisma.auditLog.create({ data: { organizationId: input.organizationId, userId: input.userId ?? null, action: input.action, entityType: input.entityType, entityId: input.entityId, metadata: input.metadata ?? null } });
    }),
  } as any;
}
function fakeIntegrations(prisma: any) {
  return {
    upsertOrder: jest.fn(async (orgId: string, _s: any, o: any, source: string) => {
      const existing = await prisma.order.findFirst({ where: { organizationId: orgId, source, externalId: o.externalId } });
      if (existing) return "updated";
      await prisma.order.create({
        data: {
          organizationId: orgId, source, externalId: o.externalId, externalNumber: o.externalNumber,
          status: o.status, paymentMethod: o.paymentMethod, isCod: o.isCod, currency: o.currency,
          subtotalMinor: o.subtotalMinor, shippingMinor: o.shippingMinor, discountMinor: o.discountMinor,
          taxMinor: o.taxMinor, totalMinor: o.totalMinor, refundedMinor: o.refundedMinor,
          customerId: o.customerId ?? null, subscriptionId: o.subscriptionId ?? null, placedAt: o.placedAt,
        },
      });
      return "created";
    }),
  } as any;
}
function seedBase(prisma: any) {
  prisma.customer.rows.push({ id: "c-1", organizationId: "org-1", firstName: "রহিম", lastName: null, phone: "01711111111", email: "r@example.com", externalId: null });
  prisma.product.rows.push({
    id: "p-1", organizationId: "org-1", name: "কফি", sku: "COF-1", priceMinor: 50000n, currency: "BDT",
    subscriptionEnabled: true, subscriptionIntervalDays: 30, subscriptionDiscountPercent: 10,
  });
}
function makeSvc(prisma: any) {
  return new SubscriptionsService(prisma, fakeAudit(prisma), fakeIntegrations(prisma));
}

describe("OU12 consent capture at creation", () => {
  it("no consent → all three fields null, label no_consent, chargingActive false (manual flow untouched)", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    const svc = makeSvc(prisma);
    const { subscription }: any = await svc.create("org-1", "staff-1", { customerId: "c-1", productId: "p-1" } as any);
    expect(subscription.autoChargeConsentAt).toBeNull();
    expect(subscription.autoChargeConsentMethod ?? null).toBeNull();
    expect(subscription.autoChargeConsentNote ?? null).toBeNull();
    expect(subscription.autoCharge).toEqual({
      consentGiven: false, consentAt: null, method: null,
      chargingActive: false, statusLabel: "no_consent",
    });
    const audit = prisma.auditLog.rows.find((r: any) => r.action === "subscriptions.create");
    expect(audit.metadata.autoChargeConsentGiven).toBe(false);
  });

  it("consent given + method → stored with a SERVER timestamp; label is the honest ready label", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    const svc = makeSvc(prisma);
    const before = Date.now();
    const { subscription }: any = await svc.create("org-1", "staff-1", {
      customerId: "c-1", productId: "p-1",
      autoChargeConsentGiven: true, autoChargeConsentMethod: "phone_call", autoChargeConsentNote: "কল করে সম্মতি দিয়েছেন",
    } as any);
    const at = new Date(subscription.autoChargeConsentAt).getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
    expect(subscription.autoChargeConsentMethod).toBe("phone_call");
    expect(subscription.autoChargeConsentNote).toBe("কল করে সম্মতি দিয়েছেন");
    expect(subscription.autoCharge.consentGiven).toBe(true);
    expect(subscription.autoCharge.chargingActive).toBe(false);
    expect(subscription.autoCharge.statusLabel).toBe(AUTO_CHARGE_READY_LABEL);
    expect(AUTO_CHARGE_READY_LABEL).toContain("চার্জিং এখনো চালু নয়");
    const audit = prisma.auditLog.rows.find((r: any) => r.action === "subscriptions.create");
    expect(audit.metadata.autoChargeConsentGiven).toBe(true);
    expect(audit.metadata.autoChargeConsentMethod).toBe("phone_call");
  });

  it("given=true WITHOUT a method → refused, and NO subscription row is created", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    const svc = makeSvc(prisma);
    await expect(svc.create("org-1", "staff-1", {
      customerId: "c-1", productId: "p-1", autoChargeConsentGiven: true,
    } as any)).rejects.toMatchObject({ code: "subscriptions.consentMethodRequired", status: 400 });
    expect(prisma.customerSubscription.rows).toHaveLength(0);
  });

  it("method/note WITHOUT given=true → refused (contradictory input is never stored)", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    const svc = makeSvc(prisma);
    await expect(svc.create("org-1", "staff-1", {
      customerId: "c-1", productId: "p-1", autoChargeConsentMethod: "written",
    } as any)).rejects.toMatchObject({ code: "subscriptions.consentMethodWithoutConsent", status: 400 });
    await expect(svc.create("org-1", "staff-1", {
      customerId: "c-1", productId: "p-1", autoChargeConsentGiven: false, autoChargeConsentNote: "x",
    } as any)).rejects.toMatchObject({ code: "subscriptions.consentMethodWithoutConsent", status: 400 });
    expect(prisma.customerSubscription.rows).toHaveLength(0);
  });

  it("an unknown method string is refused even with given=true", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    const svc = makeSvc(prisma);
    await expect(svc.create("org-1", "staff-1", {
      customerId: "c-1", productId: "p-1", autoChargeConsentGiven: true, autoChargeConsentMethod: "telepathy",
    } as any)).rejects.toMatchObject({ code: "subscriptions.consentMethodRequired", status: 400 });
    expect(prisma.customerSubscription.rows).toHaveLength(0);
  });
});

describe("OU12 consent endpoint (record / withdraw later)", () => {
  it("records consent on an existing subscription, then withdrawal clears all three fields; both audited", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    const svc = makeSvc(prisma);
    const { subscription }: any = await svc.create("org-1", "staff-1", { customerId: "c-1", productId: "p-1" } as any);
    const recorded: any = await svc.setAutoChargeConsent("org-1", "staff-1", subscription.id, {
      autoChargeConsentGiven: true, autoChargeConsentMethod: "in_person",
    } as any);
    expect(recorded.subscription.autoCharge.consentGiven).toBe(true);
    expect(recorded.subscription.autoCharge.chargingActive).toBe(false);
    const withdrawn: any = await svc.setAutoChargeConsent("org-1", "staff-1", subscription.id, {
      autoChargeConsentGiven: false,
    } as any);
    expect(withdrawn.subscription.autoChargeConsentAt).toBeNull();
    expect(withdrawn.subscription.autoCharge.consentGiven).toBe(false);
    const actions = prisma.auditLog.rows.map((r: any) => r.action);
    expect(actions).toContain("subscriptions.autocharge_consent_recorded");
    expect(actions).toContain("subscriptions.autocharge_consent_withdrawn");
  });

  it("a cancelled subscription refuses consent recording", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    const svc = makeSvc(prisma);
    const { subscription }: any = await svc.create("org-1", "staff-1", { customerId: "c-1", productId: "p-1" } as any);
    await svc.cancel("org-1", "staff-1", subscription.id);
    await expect(svc.setAutoChargeConsent("org-1", "staff-1", subscription.id, {
      autoChargeConsentGiven: true, autoChargeConsentMethod: "written",
    } as any)).rejects.toMatchObject({ code: "subscriptions.consentOnCancelledSubscription", status: 400 });
  });
});

describe("OU12 sweep honesty — consent changes NOTHING about charging", () => {
  it("a DUE subscription WITH consent: sweep creates a COD, UNPAID renewal order; no charge is attempted, no order is marked paid", async () => {
    const prisma = fakePrisma(); seedBase(prisma);
    const integrations = fakeIntegrations(prisma);
    const svc = new SubscriptionsService(prisma, fakeAudit(prisma), integrations);
    const fetchSpy = jest.fn(async () => { throw new Error("network must never be called by the subscription sweep"); });
    (global as any).fetch = fetchSpy;
    try {
      const { subscription }: any = await svc.create("org-1", "staff-1", {
        customerId: "c-1", productId: "p-1",
        autoChargeConsentGiven: true, autoChargeConsentMethod: "written",
        startAt: new Date(Date.now() - 60_000).toISOString(),
      } as any);
      const res = await svc.runDueForOrg("org-1");
      expect(res).toEqual({ processed: 1, created: 1, failed: 0 });
      // The renewal order is the SAME manual/COD order as always.
      expect(integrations.upsertOrder).toHaveBeenCalledTimes(1);
      const orderArg = (integrations.upsertOrder.mock.calls[0] as any[])[2];
      expect(orderArg.paymentMethod).toBe("cod");
      expect(orderArg.isCod).toBe(true);
      expect(orderArg.status).toBe("pending");
      const stored = prisma.order.rows[0];
      expect(stored.paymentMethod).toBe("cod");
      expect(stored.status).toBe("pending"); // NOT paid — no payment state exists on it at all
      expect(fetchSpy).not.toHaveBeenCalled(); // no gateway call of any kind
      // The subscription simply advanced like a manual renewal.
      const row = prisma.customerSubscription.rows.find((r: any) => r.id === subscription.id);
      expect(row.failureCount).toBe(0);
      expect(new Date(row.nextRunAt).getTime()).toBeGreaterThan(Date.now());
      // Consent survived the sweep untouched (the sweep never reads it).
      expect(row.autoChargeConsentMethod).toBe("written");
      expect(row.autoChargeConsentAt).toBeTruthy();
    } finally {
      delete (global as any).fetch;
    }
  });
});
