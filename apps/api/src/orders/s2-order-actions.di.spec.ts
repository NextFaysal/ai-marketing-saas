import { Global, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { OrdersModule } from "./orders.module";
import { OrdersService } from "./orders.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuditModule } from "../audit/audit.module";
import { EventsModule, EventsService } from "../common/events.service";
import { InventoryService } from "../inventory/inventory.service";

/**
 * Sales & Data S2 — DI regression spec (the M65 insurance).
 *
 * The M65 lesson: a service that references EventsService only
 * through an inline import() type gets `undefined` injected by
 * Nest and its events silently never fire, while every
 * positional-construction unit test stays green. This spec
 * builds the REAL module graph the way Nest does and proves:
 *   1. OrdersService's S2 deps (events, inventory) are actually
 *      injected (the very instances from the graph), and
 *   2. a PATCH status change to "completed" really delivers
 *      "order.delivered" to a handler on that EventsService.
 *
 * Approach note: @nestjs/testing is not a dependency of this
 * repo (no spec uses createTestingModule and it is not in any
 * package.json), so the graph is compiled with
 * NestFactory.createApplicationContext instead — same Nest DI
 * container, same provider resolution. PrismaService is
 * supplied by a @Global fake module (mirroring the real
 * @Global PrismaModule) so no database is touched; AuditModule
 * and EventsModule are the real @Global modules AppModule uses.
 */
describe("S2 OrdersModule DI graph", () => {
  it("injects real EventsService + InventoryService and emits order.delivered through the graph", async () => {
    const row: any = {
      id: "o1", organizationId: "org-1", status: "processing",
      totalMinor: 100000n, refundedMinor: 0n, internalNote: null,
      items: [], customer: null,
    };
    const fakePrisma: any = {
      order: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.id && where.id !== row.id) return null;
          if (where.organizationId && where.organizationId !== row.organizationId) return null;
          return { ...row };
        }),
        update: jest.fn(async ({ data }: any) => { Object.assign(row, data); return { ...row }; }),
      },
      auditLog: { create: jest.fn(async () => ({})) },
    };

    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: fakePrisma }], exports: [PrismaService] })
    class FakePrismaModule {}

    @Module({ imports: [FakePrismaModule, AuditModule, EventsModule, OrdersModule] })
    class S2GraphRootModule {}

    const ctx = await NestFactory.createApplicationContext(S2GraphRootModule, { logger: false });
    try {
      const svc = ctx.get(OrdersService);
      const events = ctx.get(EventsService);
      const inventory = ctx.get(InventoryService);

      // The M65 failure mode, asserted directly: neither S2 dep
      // may be undefined, and both must be the graph's instances.
      expect((svc as any).events).toBeDefined();
      expect((svc as any).events).toBe(events);
      expect((svc as any).inventory).toBeDefined();
      expect((svc as any).inventory).toBe(inventory);

      const delivered: any[] = [];
      const changed: any[] = [];
      events.on("order.delivered", (p: any) => { delivered.push(p); });
      events.on("order.status_changed", (p: any) => { changed.push(p); });

      await svc.updateOrder("org-1", "u1", "o1", { status: "completed" });
      // EventsService.emit dispatches handlers on a microtask.
      await new Promise((r) => setImmediate(r));

      expect(row.status).toBe("completed");
      expect(delivered).toEqual([{ organizationId: "org-1", context: { orderId: "o1" } }]);
      expect(changed).toEqual([
        { organizationId: "org-1", context: { orderId: "o1", from: "processing", to: "completed" } },
      ]);
    } finally {
      await ctx.close();
    }
  });
});
