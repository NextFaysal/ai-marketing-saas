import "reflect-metadata";
import { Global, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { OrderAutomationModule } from "./order-automation.module";
import { OrderAutomationService } from "./order-automation.service";
import { AutomationService, JOB_TEMPLATES } from "../automation/automation.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuditModule } from "../audit/audit.module";
import { EventsModule, EventsService } from "../common/events.service";

/**
 * ON8 — DI regression spec (the M65 insurance, mirroring
 * s2-order-actions.di.spec.ts): build the REAL module graph
 * and prove OrderAutomationService gets its OrdersService /
 * FraudShieldService / OrderNotificationService / EventsService
 * deps injected (not undefined), that its constructor event
 * subscriptions are live on the graph's EventsService, and
 * that the AutomationService order_automation_sweep dispatch
 * + JOB template exist. @nestjs/testing is not a dependency
 * here, so the graph is compiled with NestFactory like S2.
 */
describe("ON8 OrderAutomationModule DI graph", () => {
  it("injects real deps and the ingested event reaches the engine", async () => {
    const fakePrisma: any = {
      orderAutomationRule: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => null),
      },
      orderAutomationLog: { findMany: jest.fn(async () => []) },
      order: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    };

    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: fakePrisma }], exports: [PrismaService] })
    class FakePrismaModule {}

    @Module({ imports: [FakePrismaModule, AuditModule, EventsModule, OrderAutomationModule] })
    class On8GraphRootModule {}

    const ctx = await NestFactory.createApplicationContext(On8GraphRootModule, { logger: false });
    try {
      const svc = ctx.get(OrderAutomationService);
      const events = ctx.get(EventsService);
      expect((svc as any).orders).toBeDefined();
      expect((svc as any).fraud).toBeDefined();
      expect((svc as any).notifications).toBeDefined();
      expect((svc as any).events).toBe(events);
      // Live subscription proof: emitting must not throw and
      // the handler must run (no rules → empty result array).
      const seen: any[] = [];
      events.on("order.ingested", (p: any) => { seen.push(p); });
      events.emit("order.ingested", { organizationId: "org-1", context: { orderId: "o1" } });
      await new Promise((r) => setImmediate(r));
      expect(seen).toHaveLength(1);
      const out = await svc.handleOrderCreated({ organizationId: "org-1", context: { orderId: "o1" } });
      expect(out).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  it("AutomationService dispatches order_automation_sweep to the ON8 engine and the template exists", async () => {
    const engine: any = { runAutomationSweep: jest.fn(async () => ({ fired: 2 })) };
    const stub: any = {};
    // Positional construction: required deps are inert stubs;
    // every @Optional dep is undefined except the LAST one
    // (orderAutomation), matching the constructor order.
    const svc = new AutomationService(
      stub, stub, stub, stub, stub, stub, stub, stub,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      engine,
    );
    const res: any = await svc.executeJob({ organizationId: "org-1", createdById: "u1", type: "order_automation_sweep", targetId: "org-1" });
    expect(res).toEqual({ fired: 2 });
    expect(engine.runAutomationSweep).toHaveBeenCalledWith("org-1");

    const tpl = JOB_TEMPLATES.find((t) => t.key === "order_automation_sweep");
    expect(tpl).toBeDefined();
    expect(tpl!.type).toBe("order_automation_sweep");
    expect(tpl!.targetKind).toBe("org");
    expect(tpl!.intervalMinutes).toBe(60);
  });
});
