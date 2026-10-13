process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CourierService } from "./courier.service";
import { CourierRulesService } from "./courier-rules.service";

/**
 * EC22 — CourierService additions: tracking URL templates and
 * rule-driven auto-selection in bookShipment.
 *
 * The harness is courier.spec.ts's own (makeTable fake Prisma +
 * global.fetch stubbing at the provider-client seam), so (c) runs
 * the REAL bookShipment end to end: the rules service really
 * evaluates real rows, and Steadfast/RedX really "book" through
 * their stubbed HTTP APIs. Nothing is faked at the service seam.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async (args: any = {}) => rows.find((r) => matches(r, args.where ?? {})) ?? null,
    findMany: async (args: any = {}) => {
      let f = rows.filter((r) => matches(r, args.where ?? {}));
      const orderBy = args.orderBy;
      if (orderBy) {
        const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
        for (const spec of [...specs].reverse()) {
          const [field, dir] = Object.entries(spec)[0] as [string, string];
          f = [...f].sort((a, b) => {
            const av: any = a[field] instanceof Date ? a[field].getTime() : a[field];
            const bv: any = b[field] instanceof Date ? b[field].getTime() : b[field];
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return dir === "desc" ? -cmp : cmp;
          });
        }
      }
      if (args.take) f = f.slice(0, args.take);
      return f;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(Date.now() + seq * 1000), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => matches(r, where ?? {})); if (row) Object.assign(row, data); return row ?? null; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => matches(r, where ?? {})); return i < 0 ? null : rows.splice(i, 1)[0]; },
  };
}

function setup(withRules = false) {
  const tables: Record<string, any> = {};
  for (const n of ["integration", "integrationCredential", "order", "customer", "courierShipment", "courierRule", "orderItem", "product"]) tables[n] = makeTable(n);
  const origFindFirst = tables.integration.findFirst;
  tables.integration.findFirst = async (args: any) => {
    const row = await origFindFirst(args);
    if (row && args?.include?.credential) {
      const cred = tables.integrationCredential.rows.find((c: any) => c.integrationId === row.id);
      return { ...row, credential: cred ?? null };
    }
    return row;
  };
  tables.customer.rows.push({
    id: "cus-1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin", phone: "01711111111",
    address: { district: "Dhaka" },
  });
  tables.order.rows.push(
    { id: "ord-1", organizationId: "org-1", customerId: "cus-1", isCod: true, totalMinor: 150000n, externalNumber: "1042", status: "processing" },
    { id: "ord-2", organizationId: "org-1", customerId: "cus-1", isCod: true, totalMinor: 90000n, externalNumber: "1043", status: "processing" },
  );
  const auditCalls: any[] = [];
  const audit = { log: async (e: any) => { auditCalls.push(e); } } as any;
  const rules = withRules ? new CourierRulesService(tables as any, audit) : undefined;
  const svc = new CourierService(
    tables as any, audit, undefined, undefined, undefined, undefined, undefined, rules as any,
  );
  return { tables, svc, rules, auditCalls };
}

function stubProviders() {
  global.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes("/get_balance")) {
      return { ok: true, status: 200, json: async () => ({ status: 200, current_balance: 750 }) };
    }
    if (u.includes("/create_order")) {
      return { ok: true, status: 200, json: async () => ({ status: 200, consignment: { consignment_id: 555, tracking_code: "TRK9", status: "in_review" } }) };
    }
    if (u.endsWith("/areas")) {
      return { ok: true, status: 200, json: async () => ({ areas: [{ id: 1, name: "Mirpur" }] }) };
    }
    if (u.endsWith("/parcel")) {
      return { ok: true, status: 200, json: async () => ({ tracking_id: "REDX-TRK-1", status: "pending" }) };
    }
    throw new Error("unexpected url " + u);
  }) as any;
}

describe("EC22 trackingUrlForShipment", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it("substitutes and URL-encodes the tracking code (space/slash)", async () => {
    const { tables, svc } = setup();
    tables.integration.rows.push({
      id: "int-1", organizationId: "org-1", provider: "steadfast", status: "CONNECTED",
      trackingUrlTemplate: "https://track.example/{trackingId}?src=shop",
    });
    const url = await svc.trackingUrlForShipment("org-1", { provider: "steadfast", trackingCode: "TRK 9/ABC" });
    expect(url).toBe("https://track.example/TRK%209%2FABC?src=shop");
  });

  it("returns null with no template, and null with no tracking code", async () => {
    const { tables, svc } = setup();
    tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "steadfast", status: "CONNECTED" });
    await expect(svc.trackingUrlForShipment("org-1", { provider: "steadfast", trackingCode: "TRK9" })).resolves.toBeNull();
    tables.integration.rows[0].trackingUrlTemplate = "https://track.example/{trackingId}";
    await expect(svc.trackingUrlForShipment("org-1", { provider: "steadfast", trackingCode: null })).resolves.toBeNull();
    await expect(svc.trackingUrlForShipment("org-1", null)).resolves.toBeNull();
  });

  it("listShipments and publicTracking carry trackingUrl", async () => {
    const { tables, svc } = setup();
    tables.integration.rows.push({
      id: "int-1", organizationId: "org-1", provider: "steadfast", status: "CONNECTED",
      trackingUrlTemplate: "https://track.example/{trackingId}",
    });
    tables.courierShipment.rows.push({
      id: "sh-1", organizationId: "org-1", orderId: "ord-1", provider: "steadfast", trackingCode: "TRK9",
      status: "in_transit", codAmountMinor: 100n, invoice: "1042", trackingToken: "tok-1",
      createdAt: new Date(), updatedAt: new Date(),
    });
    tables.organization = { findFirst: async () => ({ id: "org-1", name: "Shop" }) };
    const list = await svc.listShipments("org-1");
    expect(list[0].trackingUrl).toBe("https://track.example/TRK9");
    const pub: any = await svc.publicTracking("tok-1");
    expect(pub.trackingUrl).toBe("https://track.example/TRK9");
  });
});

describe("EC22 setTrackingTemplate + getConnection id/template", () => {
  it("getConnection exposes the integration id (null when absent) and the template", async () => {
    const { tables, svc } = setup();
    await expect(svc.getConnection("org-1", "steadfast")).resolves.toMatchObject({ id: null, connected: false, trackingUrlTemplate: null });
    tables.integration.rows.push({ id: "int-9", organizationId: "org-1", provider: "steadfast", status: "CONNECTED", trackingUrlTemplate: "https://t/{trackingId}" });
    await expect(svc.getConnection("org-1", "steadfast")).resolves.toMatchObject({ id: "int-9", trackingUrlTemplate: "https://t/{trackingId}" });
    const all = await svc.getConnections("org-1");
    expect(all.find((c: any) => c.provider === "steadfast")?.id).toBe("int-9");
    expect(all.find((c: any) => c.provider === "pathao")?.id).toBeNull();
  });

  it("rejects a template without {trackingId} with a 400", async () => {
    const { tables, svc } = setup();
    tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "steadfast", status: "CONNECTED" });
    await expect(svc.setTrackingTemplate("org-1", "owner", "steadfast", "https://track.example/plain"))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tables.integration.rows[0].trackingUrlTemplate).toBeUndefined();
  });

  it("404s when the provider integration does not exist", async () => {
    const { svc } = setup();
    await expect(svc.setTrackingTemplate("org-1", "owner", "pathao", "https://t/{trackingId}"))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("sets a trimmed template, audits, and clears with null / whitespace", async () => {
    const { tables, svc, auditCalls } = setup();
    tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "steadfast", status: "CONNECTED" });
    const out: any = await svc.setTrackingTemplate("org-1", "owner", "steadfast", "  https://t/{trackingId}  ");
    expect(out.trackingUrlTemplate).toBe("https://t/{trackingId}");
    expect(tables.integration.rows[0].trackingUrlTemplate).toBe("https://t/{trackingId}");
    expect(auditCalls.some((c) => c.action === "courier.tracking_template_updated" && c.metadata.provider === "steadfast")).toBe(true);

    const cleared: any = await svc.setTrackingTemplate("org-1", "owner", "steadfast", null);
    expect(cleared.trackingUrlTemplate).toBeNull();
    await svc.setTrackingTemplate("org-1", "owner", "steadfast", "https://t/{trackingId}");
    const cleared2: any = await svc.setTrackingTemplate("org-1", "owner", "steadfast", "   ");
    expect(cleared2.trackingUrlTemplate).toBeNull();
  });
});

describe("EC22 bookShipment auto-selection (real harness)", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  async function connectedSetup() {
    const ctx = setup(true);
    stubProviders();
    await ctx.svc.connect("org-1", "owner", { apiKey: "k", secretKey: "s" }); // steadfast (default)
    await ctx.svc.connect("org-1", "owner", { provider: "redx", accessToken: "tok-1" });
    const redxIntegration = ctx.tables.integration.rows.find((r: any) => r.provider === "redx");
    const rule = await ctx.rules!.create("org-1", "owner", {
      name: "ঢাকায় RedX", conditions: { districts: ["Dhaka"] }, courierAccountId: redxIntegration.id,
    });
    return { ...ctx, rule };
  }

  it("provider omitted + matching rule => rule provider, courierRuleId set, courier_auto_selected audit", async () => {
    const { tables, svc, rule, auditCalls } = await connectedSetup();
    const shipment: any = await svc.bookShipment("org-1", "agent", {
      orderId: "ord-1", recipientAddress: "বাসা ৫, রোড ২, মিরপুর, ঢাকা",
      redx: { deliveryAreaId: 1, deliveryArea: "Mirpur" },
    });
    expect(shipment.provider).toBe("redx");
    expect(shipment.trackingCode).toBe("REDX-TRK-1");
    const row = tables.courierShipment.rows.find((r: any) => r.id === shipment.id);
    expect(row.courierRuleId).toBe(rule.id);
    const auto = auditCalls.find((c) => c.action === "courier_auto_selected");
    expect(auto).toBeTruthy();
    expect(auto.metadata).toMatchObject({ ruleId: rule.id, ruleName: "ঢাকায় RedX", provider: "redx", orderId: "ord-1", shipmentId: shipment.id });
  });

  it("explicit provider always wins: a matching rule is NOT applied", async () => {
    const { tables, svc, auditCalls } = await connectedSetup();
    const shipment: any = await svc.bookShipment("org-1", "agent", {
      provider: "steadfast", orderId: "ord-2", recipientAddress: "বাসা ৫, রোড ২, মিরপুর, ঢাকা",
    });
    expect(shipment.provider).toBe("steadfast");
    const row = tables.courierShipment.rows.find((r: any) => r.id === shipment.id);
    expect(row.courierRuleId ?? null).toBeNull();
    expect(auditCalls.some((c) => c.action === "courier_auto_selected")).toBe(false);
  });

  it("provider omitted + no matching rule => steadfast default, no rule stamped", async () => {
    const ctx = setup(true);
    stubProviders();
    await ctx.svc.connect("org-1", "owner", { apiKey: "k", secretKey: "s" });
    // Rule targets Chattogram; the order's customer is in Dhaka.
    const sf = ctx.tables.integration.rows.find((r: any) => r.provider === "steadfast");
    await ctx.rules!.create("org-1", "owner", {
      name: "চট্টগ্রামের নিয়ম", conditions: { districts: ["Chattogram"] }, courierAccountId: sf.id,
    });
    const shipment: any = await ctx.svc.bookShipment("org-1", "agent", {
      orderId: "ord-1", recipientAddress: "বাসা ৫, রোড ২, মিরপুর, ঢাকা",
    });
    expect(shipment.provider).toBe("steadfast");
    const row = ctx.tables.courierShipment.rows.find((r: any) => r.id === shipment.id);
    expect(row.courierRuleId ?? null).toBeNull();
  });
});
