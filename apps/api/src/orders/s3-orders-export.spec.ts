import "reflect-metadata";
import { ApiException } from "../i18n";
import { BadRequestException } from "@nestjs/common";
import { OrdersService } from "./orders.service";

/**
 * Sales & Data S3 — Orders CSV Export.
 * Fake-prisma style matching m65-manual-orders.spec.ts /
 * s2-order-actions.spec.ts: the fake order table honours
 * where (organizationId, status, isCod, OR with placedAt /
 * createdAt ranges + placedAt:null), orderBy placedAt desc,
 * take, and include (customer/items are already joined on the
 * fake rows, as Prisma's include would return them).
 */
describe("S3 OrdersService.exportCsv", () => {
  const HEADER = "order_id,external_id,external_number,source,status,is_cod,payment_method,customer_name,customer_phone,customer_email,items,subtotal,shipping,discount,tax,total,refunded,currency,placed_at,created_at";

  function baseOrder(overrides: Record<string, unknown> = {}): any {
    return {
      id: "o1", organizationId: "org-1",
      externalId: "ext-1", externalNumber: "1001", source: "woocommerce",
      status: "completed", paymentMethod: "cod", isCod: true, currency: "BDT",
      subtotalMinor: 125050n, shippingMinor: 6000n, discountMinor: 5000n,
      taxMinor: 0n, totalMinor: 126050n, refundedMinor: 0n,
      placedAt: new Date("2026-10-05T04:00:00.000Z"), // Dhaka 2026-10-05 10:00
      createdAt: new Date("2026-10-05T04:05:00.000Z"),
      customer: { firstName: "Rahim", lastName: "Uddin", phone: "01712345678", email: "rahim@example.com" },
      items: [
        { name: "Shirt", quantity: 2, priceMinor: 50000n, totalMinor: 100000n, sku: "SH-1" },
        { name: "Pant", quantity: 1, priceMinor: 25050n, totalMinor: 25050n, sku: "PN-1" },
      ],
      ...overrides,
    };
  }

  function setup(orders: any[]) {
    const findManyArgs: any[] = [];
    const inRange = (d: any, range: any): boolean => {
      if (d === null || d === undefined) return false;
      const t = new Date(d).getTime();
      if (range.gte && t < new Date(range.gte).getTime()) return false;
      if (range.lt && t >= new Date(range.lt).getTime()) return false;
      return true;
    };
    const matches = (row: any, where: any): boolean => {
      if (where.organizationId !== undefined && row.organizationId !== where.organizationId) return false;
      if (where.status !== undefined && row.status !== where.status) return false;
      if (where.isCod !== undefined && row.isCod !== where.isCod) return false;
      if (where.OR) {
        return where.OR.some((cond: any) => {
          if ("placedAt" in cond && cond.placedAt === null) {
            return row.placedAt === null && inRange(row.createdAt, cond.createdAt);
          }
          return inRange(row.placedAt, cond.placedAt);
        });
      }
      return true;
    };
    const prisma: any = {
      order: {
        findMany: jest.fn(async (args: any) => {
          findManyArgs.push(args);
          let rows = orders.filter((r) => matches(r, args.where));
          if (args.orderBy?.placedAt === "desc") {
            rows = [...rows].sort((a, b) => {
              const ta = a.placedAt ? new Date(a.placedAt).getTime() : -Infinity;
              const tb = b.placedAt ? new Date(b.placedAt).getTime() : -Infinity;
              return tb - ta;
            });
          }
          if (typeof args.take === "number") rows = rows.slice(0, args.take);
          // include is honoured trivially: fake rows already carry
          // their customer + items, as the Prisma include would.
          return rows.map((r) => ({ ...r }));
        }),
      },
    };
    const svc = new OrdersService(prisma);
    return { svc, prisma, findManyArgs };
  }

  it("writes the exact header line and a full row's exact cell values", async () => {
    const { svc } = setup([baseOrder()]);
    const csv = await svc.exportCsv("org-1", {});
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe(
      "o1,ext-1,1001,woocommerce,completed,yes,cod,Rahim Uddin,01712345678,rahim@example.com,Shirt ×2 | Pant ×1,1250.50,60.00,50.00,0.00,1260.50,0.00,BDT,2026-10-05T04:00:00.000Z,2026-10-05T04:05:00.000Z",
    );
  });

  it("honours the status filter", async () => {
    const { svc } = setup([
      baseOrder({ id: "o1", status: "completed" }),
      baseOrder({ id: "o2", status: "pending", externalId: "ext-2" }),
    ]);
    const csv = await svc.exportCsv("org-1", { status: "pending" });
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith("o2,")).toBe(true);
  });

  it("honours the cod filter (isCod false)", async () => {
    const { svc } = setup([
      baseOrder({ id: "o1", isCod: true }),
      baseOrder({ id: "o2", isCod: false, externalId: "ext-2", paymentMethod: "bkash" }),
    ]);
    const csv = await svc.exportCsv("org-1", { isCod: false });
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith("o2,")).toBe(true);
    expect(lines[1]).toContain(",no,bkash,");
  });

  describe("Dhaka date range (from/to are Asia/Dhaka calendar days)", () => {
    it("includes an order placed on Dhaka 2026-10-05 for from=2026-10-05&to=2026-10-05 and excludes one at Dhaka 2026-10-04 23:30", async () => {
      const { svc } = setup([
        baseOrder({ id: "in-range" }), // Dhaka 2026-10-05 10:00
        baseOrder({
          id: "before-range", externalId: "ext-late",
          placedAt: new Date("2026-10-04T17:30:00.000Z"), // Dhaka 2026-10-04 23:30
          createdAt: new Date("2026-10-04T17:30:00.000Z"),
        }),
      ]);
      const csv = await svc.exportCsv("org-1", { from: "2026-10-05", to: "2026-10-05" });
      const lines = csv.split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[1].startsWith("in-range,")).toBe(true);
      expect(csv).not.toContain("before-range");
    });

    it("an order with placedAt null falls back to createdAt for the range", async () => {
      const { svc } = setup([
        baseOrder({
          id: "fallback-in", placedAt: null,
          createdAt: new Date("2026-10-05T05:00:00.000Z"), // Dhaka 2026-10-05 11:00
        }),
        baseOrder({
          id: "fallback-out", externalId: "ext-out", placedAt: null,
          createdAt: new Date("2026-10-04T10:00:00.000Z"), // Dhaka 2026-10-04 16:00
        }),
      ]);
      const csv = await svc.exportCsv("org-1", { from: "2026-10-05", to: "2026-10-05" });
      const lines = csv.split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[1].startsWith("fallback-in,")).toBe(true);
      // placed_at cell is empty for the null-placedAt order.
      expect(lines[1].endsWith(",2026-10-05T05:00:00.000Z")).toBe(true);
      expect(csv).not.toContain("fallback-out");
    });

    it("from-only and to-only bounds work on their own", async () => {
      const orders = [
        baseOrder({ id: "d4", placedAt: new Date("2026-10-04T04:00:00.000Z"), createdAt: new Date("2026-10-04T04:00:00.000Z") }),
        baseOrder({ id: "d5", externalId: "ext-5" }),
        baseOrder({ id: "d6", externalId: "ext-6", placedAt: new Date("2026-10-06T04:00:00.000Z"), createdAt: new Date("2026-10-06T04:00:00.000Z") }),
      ];
      const fromOnly = await setup(orders).svc.exportCsv("org-1", { from: "2026-10-05" });
      expect(fromOnly).toContain("d5");
      expect(fromOnly).toContain("d6");
      expect(fromOnly).not.toContain("d4,");
      const toOnly = await setup(orders).svc.exportCsv("org-1", { to: "2026-10-05" });
      expect(toOnly).toContain("d4");
      expect(toOnly).toContain("d5");
      expect(toOnly).not.toContain("d6,");
    });
  });

  it("rejects invalid from dates with BadRequestException", async () => {
    const { svc } = setup([baseOrder()]);
    await expect(svc.exportCsv("org-1", { from: "2026-13-40" })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.exportCsv("org-1", { from: "abc" })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.exportCsv("org-1", { to: "2026-02-30" })).rejects.toBeInstanceOf(ApiException);
  });

  it("rejects from after to with BadRequestException", async () => {
    const { svc } = setup([baseOrder()]);
    await expect(svc.exportCsv("org-1", { from: "2026-10-06", to: "2026-10-05" }))
      .rejects.toBeInstanceOf(ApiException);
  });

  it("cross-org: another org's orders never appear, even with no filters", async () => {
    const { svc } = setup([
      baseOrder({ id: "mine" }),
      baseOrder({ id: "theirs", organizationId: "org-2", externalId: "ext-other" }),
    ]);
    const csv = await svc.exportCsv("org-1", {});
    expect(csv).toContain("mine");
    expect(csv).not.toContain("theirs");
    expect(csv).not.toContain("ext-other");
    expect(csv.split("\n")).toHaveLength(2);
  });

  it("requests the 5000-row cap, newest first, with customer + items included", async () => {
    const { svc, findManyArgs } = setup([baseOrder()]);
    await svc.exportCsv("org-1", {});
    expect(findManyArgs).toHaveLength(1);
    expect(findManyArgs[0].take).toBe(5000);
    expect(findManyArgs[0].orderBy).toEqual({ placedAt: "desc" });
    expect(findManyArgs[0].include).toEqual({ customer: true, items: true });
  });

  it("newest first: a later placedAt sorts before an earlier one", async () => {
    const { svc } = setup([
      baseOrder({ id: "older", placedAt: new Date("2026-10-03T04:00:00.000Z"), createdAt: new Date("2026-10-03T04:00:00.000Z") }),
      baseOrder({ id: "newer", externalId: "ext-new" }),
    ]);
    const lines = (await svc.exportCsv("org-1", {})).split("\n");
    expect(lines[1].startsWith("newer,")).toBe(true);
    expect(lines[2].startsWith("older,")).toBe(true);
  });

  it("nullable fields become empty cells and a customer `name` fallback is used", async () => {
    const { svc } = setup([
      baseOrder({
        id: "o-null", externalId: null, externalNumber: null, paymentMethod: null,
        customer: { firstName: null, lastName: null, name: "Walk-in Customer", phone: null, email: null },
        items: [],
      }),
    ]);
    const lines = (await svc.exportCsv("org-1", {})).split("\n");
    expect(lines[1].startsWith("o-null,,,woocommerce,completed,yes,,Walk-in Customer,,,")).toBe(true);
  });
});
