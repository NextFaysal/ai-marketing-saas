process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { EventsService } from "../common/events.service";
import { CourierService } from "../courier/courier.service";
import { encryptJson } from "../integrations/crypto";
import { WorkflowsService, WORKFLOW_PRESETS, WORKFLOW_TRIGGERS } from "./workflows.service";

/**
 * Automations A2: CourierService.syncShipment — the ONLY
 * status-writing shipment update — emits
 * "shipment.status_changed" on a real change, and
 * WorkflowsService fans it out to shipment_status_changed /
 * shipment_delivered / shipment_returned. Delivered/returned
 * classification reuses S5's classifyShipmentStatus
 * (courier-performance.ts): delivered = delivered |
 * partial_delivered | partially_delivered; returned =
 * returned | return (normalized).
 *
 * These specs wire a REAL CourierService + REAL
 * WorkflowsService to one REAL EventsService over shared
 * in-memory tables; the Steadfast HTTP call is stubbed at
 * global.fetch (the same seam courier.spec.ts uses).
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (k === "OR" && Array.isArray(v)) return v.some((sub) => matches(row, sub));
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("gt" in v) return row[k] > v.gt;
      if ("gte" in v) return row[k] >= v.gte;
      if ("lt" in v) return row[k] < v.lt;
      if ("lte" in v) return row[k] <= v.lte;
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
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take }: any = {}) => {
      const f = rows.filter((r) => matches(r, where ?? {}));
      return take ? f.slice(0, take) : f;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}));
      if (!row) return null;
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) if (matches(r, where ?? {})) { Object.assign(r, data); count++; }
      return { count };
    },
  };
}

async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

function setup() {
  const tables: Record<string, any> = {};
  for (const n of ["workflow", "workflowRun", "conversationNote", "channelConversation", "channelMessage", "leadActivity", "order", "customer", "lead", "membership", "agentNotification", "auditLog", "integration", "integrationCredential", "courierShipment"]) tables[n] = makeTable(n);
  // Emulate prisma's include: { credential: true } on integration.
  const origFindFirst = tables.integration.findFirst;
  tables.integration.findFirst = async (args: any) => {
    const row = await origFindFirst(args);
    if (row && args?.include?.credential) {
      const cred = tables.integrationCredential.rows.find((c: any) => c.integrationId === row.id);
      return { ...row, credential: cred ?? null };
    }
    return row;
  };
  const events = new EventsService();
  let eventCount = 0;
  events.on("shipment.status_changed", () => { eventCount++; });
  const messagingStub = {
    getTemplate: async () => ({ id: "t1", channel: "email", subject: "s", body: "b" }),
    sendToRecipient: async () => ({ status: "sent", address: "x", providerMessageId: "p" }),
  } as any;
  const workflows = new WorkflowsService(tables as any, { log: async () => undefined } as any, events as any, messagingStub, undefined);
  workflows.onModuleInit();
  const inboxStub = { sendAutomatedMessage: async () => ({ id: "m" }) } as any;
  const courier = new CourierService(tables as any, { log: async () => undefined } as any, inboxStub, undefined, events as any);

  tables.integration.rows.push({ id: "int-1", organizationId: "org", provider: "steadfast", status: "CONNECTED" });
  tables.integrationCredential.rows.push({ id: "cred-1", integrationId: "int-1", encryptedData: encryptJson({ apiKey: "k", secretKey: "s" }) });
  tables.order.rows.push({ id: "ord-1", organizationId: "org", customerId: null, totalMinor: 100000, currency: "BDT", status: "processing", source: "manual", externalNumber: "ORD-77", externalId: "77", conversationId: null });
  tables.membership.rows.push({ id: "m1", organizationId: "org", userId: "owner-1", role: "OWNER", status: "ACTIVE" });
  return { tables, workflows, courier, events, count: () => eventCount };
}

let providerStatus = "returned";
let providerFails = false;
function stubFetch() {
  global.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes("/status_by_trackingcode/")) {
      if (providerFails) throw new Error("network down");
      return { ok: true, status: 200, json: async () => ({ status: 200, delivery_status: providerStatus }) };
    }
    throw new Error("unexpected url " + u);
  }) as any;
}

describe("A2 shipment event triggers", () => {
  const realFetch = global.fetch;
  beforeEach(() => { providerStatus = "returned"; providerFails = false; stubFetch(); });
  afterEach(() => { global.fetch = realFetch; });

  it("registers all three shipment triggers", () => {
    expect(WORKFLOW_TRIGGERS).toContain("shipment_status_changed");
    expect(WORKFLOW_TRIGGERS).toContain("shipment_delivered");
    expect(WORKFLOW_TRIGGERS).toContain("shipment_returned");
  });

  it("delivered -> returned: event fires exactly once; shipment_returned + shipment_status_changed runs; no delivered run", async () => {
    const { tables, workflows, courier, count } = setup();
    tables.courierShipment.rows.push({ id: "sh-1", organizationId: "org", orderId: "ord-1", provider: "steadfast", trackingCode: "TRK1", consignmentId: null, status: "delivered", lastNotifiedStatus: "delivered", codAmountMinor: 100000 });
    await workflows.create("org", "u1", {
      name: "Any change", trigger: "shipment_status_changed",
      steps: [{ type: "notify_team", title: "বদল", text: "পার্সেল {{trackingCode}}: {{previousStatus}} → {{shipmentStatus}}" }],
    });
    await workflows.create("org", "u1", {
      name: "Return alert", trigger: "shipment_returned",
      steps: [{ type: "notify_team", title: "রিটার্ন", text: "অর্ডার {{orderNumber}} রিটার্ন (ট্র্যাকিং {{trackingCode}})" }],
    });
    await workflows.create("org", "u1", {
      name: "Delivered thanks", trigger: "shipment_delivered",
      steps: [{ type: "notify_team", title: "ডেলিভারি", text: "অর্ডার {{orderNumber}} ডেলিভারি" }],
    });

    const out = await courier.syncShipment("org", "sh-1");
    expect(out.status).toBe("returned");
    await flush();
    expect(count()).toBe(1);
    const runs = tables.workflowRun.rows;
    expect(runs.filter((r: any) => r.trigger === "shipment_status_changed" && r.status === "completed")).toHaveLength(1);
    expect(runs.filter((r: any) => r.trigger === "shipment_returned" && r.status === "completed")).toHaveLength(1);
    expect(runs.filter((r: any) => r.trigger === "shipment_delivered")).toHaveLength(0);
    const ret = runs.find((r: any) => r.trigger === "shipment_returned");
    expect(ret.context.shipmentStatus).toBe("returned");
    expect(ret.context.previousStatus).toBe("delivered");
    expect(ret.context.trackingCode).toBe("TRK1");
    expect(ret.context.orderNumber).toBe("ORD-77"); // enriched from orderId
    const bodies = tables.agentNotification.rows.map((n: any) => n.body).join("\n");
    expect(bodies).toContain("ORD-77");
    expect(bodies).toContain("TRK1");
    expect(bodies).toContain("delivered → returned");

    // Second sync, same provider status: NO change -> NO event, NO new runs.
    await courier.syncShipment("org", "sh-1");
    await flush();
    expect(count()).toBe(1);
    expect(tables.workflowRun.rows).toHaveLength(runs.length);
  });

  it("in_transit -> delivered fires shipment_delivered (+ status_changed); partial_delivered also counts as delivered (S5 set)", async () => {
    const { tables, workflows, courier } = setup();
    tables.courierShipment.rows.push({ id: "sh-2", organizationId: "org", orderId: "ord-1", provider: "steadfast", trackingCode: "TRK2", consignmentId: null, status: "in_transit", lastNotifiedStatus: null, codAmountMinor: 100000 });
    tables.courierShipment.rows.push({ id: "sh-3", organizationId: "org", orderId: "ord-1", provider: "steadfast", trackingCode: "TRK3", consignmentId: null, status: "in_transit", lastNotifiedStatus: null, codAmountMinor: 100000 });
    await workflows.create("org", "u1", {
      name: "Delivered", trigger: "shipment_delivered",
      steps: [{ type: "notify_team", title: "ডেলিভারি", text: "অর্ডার {{orderNumber}} ডেলিভারি হয়েছে" }],
    });
    providerStatus = "delivered";
    await courier.syncShipment("org", "sh-2");
    await flush();
    expect(tables.workflowRun.rows.filter((r: any) => r.trigger === "shipment_delivered" && r.status === "completed")).toHaveLength(1);
    providerStatus = "partial_delivered";
    await courier.syncShipment("org", "sh-3");
    await flush();
    expect(tables.workflowRun.rows.filter((r: any) => r.trigger === "shipment_delivered" && r.status === "completed")).toHaveLength(2);
    expect(tables.workflowRun.rows.filter((r: any) => r.trigger === "shipment_returned")).toHaveLength(0);
  });

  it("shipmentStatus condition works on the status_changed trigger", async () => {
    const { tables, workflows, courier } = setup();
    tables.courierShipment.rows.push({ id: "sh-4", organizationId: "org", orderId: "ord-1", provider: "steadfast", trackingCode: "TRK4", consignmentId: null, status: "pending", lastNotifiedStatus: null, codAmountMinor: 100000 });
    await workflows.create("org", "u1", {
      name: "Only cancelled parcels", trigger: "shipment_status_changed",
      conditions: [{ field: "shipmentStatus", op: "eq", value: "cancelled" }],
      steps: [{ type: "notify_team", title: "বাতিল পার্সেল", text: "পার্সেল {{trackingCode}} বাতিল" }],
    });
    providerStatus = "in_transit";
    await courier.syncShipment("org", "sh-4");
    await flush();
    expect(tables.workflowRun.rows.filter((r: any) => r.status === "completed")).toHaveLength(0);
    providerStatus = "cancelled";
    await courier.syncShipment("org", "sh-4");
    await flush();
    expect(tables.workflowRun.rows.filter((r: any) => r.status === "completed")).toHaveLength(1);
  });

  it("tenant isolation: another org's shipment_returned workflow never fires", async () => {
    const { tables, workflows, courier } = setup();
    tables.courierShipment.rows.push({ id: "sh-5", organizationId: "org", orderId: "ord-1", provider: "steadfast", trackingCode: "TRK5", consignmentId: null, status: "delivered", lastNotifiedStatus: "delivered", codAmountMinor: 100000 });
    await workflows.create("org-b", "u9", {
      name: "Other tenant", trigger: "shipment_returned",
      steps: [{ type: "notify_team", title: "রিটার্ন", text: "রিটার্ন {{trackingCode}}" }],
    });
    tables.membership.rows.push({ id: "m9", organizationId: "org-b", userId: "owner-9", role: "OWNER", status: "ACTIVE" });
    providerStatus = "returned";
    await courier.syncShipment("org", "sh-5");
    await flush();
    expect(tables.workflowRun.rows).toHaveLength(0);
    expect(tables.agentNotification.rows).toHaveLength(0);
  });

  it("provider failure: syncShipment still throws the courier error and emits nothing", async () => {
    const { tables, courier, count } = setup();
    tables.courierShipment.rows.push({ id: "sh-6", organizationId: "org", orderId: "ord-1", provider: "steadfast", trackingCode: "TRK6", consignmentId: null, status: "in_transit", lastNotifiedStatus: null, codAmountMinor: 100000 });
    providerFails = true;
    await expect(courier.syncShipment("org", "sh-6")).rejects.toThrow();
    await flush();
    expect(count()).toBe(0);
    expect(tables.courierShipment.rows[0].status).toBe("in_transit");
  });

  it("CourierService without the optional events param (old positional construction) syncs unchanged", async () => {
    const { tables } = setup();
    tables.courierShipment.rows.push({ id: "sh-7", organizationId: "org", orderId: "ord-1", provider: "steadfast", trackingCode: "TRK7", consignmentId: null, status: "in_transit", lastNotifiedStatus: null, codAmountMinor: 100000 });
    const bare = new CourierService(tables as any, { log: async () => undefined } as any);
    providerStatus = "delivered";
    const out = await bare.syncShipment("org", "sh-7");
    expect(out.status).toBe("delivered");
  });

  it("preset shipment_return_alert installs (disabled) with the gallery definition", async () => {
    const { workflows } = setup();
    const preset = WORKFLOW_PRESETS.find((p) => p.key === "shipment_return_alert");
    expect(preset).toBeDefined();
    expect(preset!.trigger).toBe("shipment_returned");
    const installed: any = await workflows.installPreset("org", "u1", "shipment_return_alert");
    expect(installed.enabled).toBe(false);
    expect(installed.trigger).toBe("shipment_returned");
    expect(installed.steps).toEqual(preset!.steps);
  });
});
