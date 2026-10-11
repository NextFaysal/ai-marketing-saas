process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { Global, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaService } from "../prisma/prisma.service";
import { AuditModule } from "../audit/audit.module";
import { EventsModule, EventsService } from "../common/events.service";
import { CourierModule } from "../courier/courier.module";
import { CourierService } from "../courier/courier.service";
import { WorkflowsModule } from "./workflows.module";
import { WorkflowsService } from "./workflows.service";
import { encryptJson } from "../integrations/crypto";

/**
 * Automations A2 — DI proof (the M65 insurance, same pattern
 * as orders/s2-order-actions.di.spec.ts).
 *
 * CourierService's events dep is a REAL import + @Optional
 * constructor param appended last. Unit specs construct the
 * service positionally, so only a real Nest graph can prove
 * the @Global EventsModule actually injects the shared bus
 * into CourierService — and that a syncShipment status change
 * on that graph produces a real WorkflowRun through the
 * graph's own WorkflowsService.
 *
 * PrismaService is a @Global fake (no database touched);
 * AuditModule / EventsModule / CourierModule /
 * WorkflowsModule are the real modules AppModule uses.
 * The Steadfast HTTP call is stubbed at global.fetch.
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

describe("A2 CourierModule + WorkflowsModule DI graph", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it("injects the graph's EventsService into CourierService and a returned sync creates a shipment_returned WorkflowRun", async () => {
    const tables: Record<string, any> = {};
    for (const n of ["workflow", "workflowRun", "conversationNote", "channelConversation", "channelMessage", "leadActivity", "order", "customer", "lead", "membership", "agentNotification", "auditLog", "integration", "integrationCredential", "courierShipment"]) tables[n] = makeTable(n);
    const origFindFirst = tables.integration.findFirst;
    tables.integration.findFirst = async (args: any) => {
      const row = await origFindFirst(args);
      if (row && args?.include?.credential) {
        const cred = tables.integrationCredential.rows.find((c: any) => c.integrationId === row.id);
        return { ...row, credential: cred ?? null };
      }
      return row;
    };
    tables.integration.rows.push({ id: "int-1", organizationId: "org", provider: "steadfast", status: "CONNECTED" });
    tables.integrationCredential.rows.push({ id: "cred-1", integrationId: "int-1", encryptedData: encryptJson({ apiKey: "k", secretKey: "s" }) });
    tables.order.rows.push({ id: "ord-1", organizationId: "org", customerId: null, totalMinor: 100000, currency: "BDT", status: "processing", source: "manual", externalNumber: "ORD-77", externalId: "77", conversationId: null });
    tables.membership.rows.push({ id: "m1", organizationId: "org", userId: "owner-1", role: "OWNER", status: "ACTIVE" });
    tables.courierShipment.rows.push({ id: "sh-1", organizationId: "org", orderId: "ord-1", provider: "steadfast", trackingCode: "TRK1", consignmentId: null, status: "delivered", lastNotifiedStatus: "delivered", codAmountMinor: 100000 });
    tables.workflow.rows.push({
      id: "wf-1", organizationId: "org", name: "Return alert", trigger: "shipment_returned", enabled: true,
      conditions: null, createdById: "u1", cooldownMinutes: 0, dailyRunCap: null,
      steps: [{ type: "notify_team", title: "রিটার্ন", text: "অর্ডার {{orderNumber}} রিটার্ন (ট্র্যাকিং {{trackingCode}})" }],
    });

    global.fetch = (async (url: string) => {
      if (String(url).includes("/status_by_trackingcode/")) {
        return { ok: true, status: 200, json: async () => ({ status: 200, delivery_status: "returned" }) };
      }
      throw new Error("unexpected url " + url);
    }) as any;

    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: tables }], exports: [PrismaService] })
    class FakePrismaModule {}

    @Module({ imports: [FakePrismaModule, AuditModule, EventsModule, CourierModule, WorkflowsModule] })
    class A2GraphRootModule {}

    const ctx = await NestFactory.createApplicationContext(A2GraphRootModule, { logger: false });
    try {
      const courier = ctx.get(CourierService);
      const events = ctx.get(EventsService);
      const workflows = ctx.get(WorkflowsService);
      expect(workflows).toBeDefined();
      // The M65 failure mode, asserted directly: the events
      // dep must be the graph's own shared bus instance.
      expect((courier as any).events).toBeDefined();
      expect((courier as any).events).toBe(events);
      expect((workflows as any).events).toBe(events);

      const out = await courier.syncShipment("org", "sh-1");
      expect(out.status).toBe("returned");
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));

      const runs = tables.workflowRun.rows.filter((r: any) => r.trigger === "shipment_returned");
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("completed");
      expect(runs[0].context.orderNumber).toBe("ORD-77");
      expect(tables.agentNotification.rows).toHaveLength(1);
      expect(tables.agentNotification.rows[0].body).toContain("TRK1");
    } finally {
      await ctx.close();
    }
  });
});
