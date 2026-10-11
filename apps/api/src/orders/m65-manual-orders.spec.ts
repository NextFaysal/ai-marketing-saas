import { OrdersService } from "./orders.service";
import { parseOrdersCsv } from "../imports/csv";
import { ImportsService } from "../imports/imports.service";

/**
 * Milestone 65: manual + CSV orders enter through the
 * integrations upsert (source manual/csv) so dedupe and the
 * order.created event come from the one pipeline that already
 * fires them for store orders.
 */
describe("M65 manual orders", () => {
  function setup() {
    const upsertOrder = jest.fn(async (..._args: any[]) => "created" as const);
    const saved: any[] = [];
    const prisma: any = {
      order: {
        findFirst: jest.fn(async ({ where }: any) => {
          const row = saved.find((o) => o.organizationId === where.organizationId && o.source === where.source && o.externalId === where.externalId);
          return row ? { ...row, items: row._items ?? [], customer: { id: "c1", phone: row._phone } } : null;
        }),
      },
    };
    const integrations: any = {
      upsertOrder: jest.fn(async (orgId: string, _store: any, o: any, source: string) => {
        const out = await upsertOrder(orgId, _store, o, source);
        saved.push({ organizationId: orgId, source, externalId: o.externalId, totalMinor: o.totalMinor, _items: o.items, _phone: o.customer.phone });
        return out;
      }),
    };
    const audit = { log: jest.fn(async () => undefined) };
    const svc = new OrdersService(prisma, undefined, integrations, audit as any);
    return { svc, upsertOrder, audit };
  }

  it("computes totals server-side and delegates with source=manual, customer keyed by phone", async () => {
    const { svc, upsertOrder } = setup();
    const out = await svc.createManual("org-1", "user-1", {
      customerPhone: "01712345678", customerName: "রহিম", externalRef: "SHOP-1",
      items: [
        { name: "Panjabi", quantity: 2, unitPriceMinor: 125000 },
        { name: "Cap", quantity: 1, unitPriceMinor: 15000 },
      ],
      shippingMinor: 6000, discountMinor: 5000,
    });
    expect(upsertOrder).toHaveBeenCalledTimes(1);
    const [, , normalized, source] = upsertOrder.mock.calls[0] as any[];
    expect(source).toBe("manual");
    expect(normalized.subtotalMinor).toBe(265000n);
    expect(normalized.totalMinor).toBe(266000n);
    expect(normalized.externalId).toBe("SHOP-1");
    expect(normalized.customer).toMatchObject({ externalId: "01712345678", phone: "01712345678", firstName: "রহিম" });
    expect(normalized.isCod).toBe(true);
    expect(out.upsertResult).toBe("created");
    expect(out.totalMinor).toBe("266000");
  });

  it("without an externalRef a random manual id is used (no accidental dedupe)", async () => {
    const { svc, upsertOrder } = setup();
    await svc.createManual("org-1", "user-1", {
      customerPhone: "01712345678",
      items: [{ name: "X", quantity: 1, unitPriceMinor: 100 }],
    });
    const [, , normalized] = upsertOrder.mock.calls[0] as any[];
    expect(normalized.externalId).toMatch(/^manual-/);
  });

  it("rejects an empty item list before touching the pipeline", async () => {
    const { svc, upsertOrder } = setup();
    await expect(svc.createManual("org-1", "user-1", { customerPhone: "017", items: [] }))
      .rejects.toThrow(/At least one item/);
    expect(upsertOrder).not.toHaveBeenCalled();
  });
});

describe("M65 orders CSV", () => {
  it("parses the documented columns with major-unit money", () => {
    const { rows, errors } = parseOrdersCsv(
      "order_ref,customer_phone,customer_name,item_name,quantity,unit_price,shipping,discount,status\n" +
      "SHOP-9,01712345678,রহিম,Panjabi,2,1250,60,50,completed\n",
    );
    expect(errors).toHaveLength(0);
    expect(rows[0]).toMatchObject({
      externalRef: "SHOP-9", customerPhone: "01712345678", quantity: 2,
      unitPriceMinor: 125000n, shippingMinor: 6000n, discountMinor: 5000n, status: "completed",
    });
  });

  it("row errors are reported per row and valid rows still parse", () => {
    const { rows, errors } = parseOrdersCsv(
      "order_ref,customer_phone,item_name,unit_price\n,01712345678,X,100\nSHOP-2,01712345678,Y,not-a-price\nSHOP-3,01712345678,Z,500\n",
    );
    expect(rows.map((r) => r.externalRef)).toEqual(["SHOP-3"]);
    expect(errors).toHaveLength(2);
    expect(errors[0].message).toMatch(/order_ref/);
  });

  it("import delegates each row to upsertOrder with source=csv and counts created vs updated", async () => {
    const calls: any[] = [];
    const integrations: any = {
      upsertOrder: jest.fn(async (...args: any[]) => {
        calls.push(args);
        return calls.length === 1 ? "created" : "updated";
      }),
    };
    const jobs: any[] = [];
    const prisma: any = {
      importJob: {
        create: jest.fn(async ({ data }: any) => { const j = { id: "job-1", ...data }; jobs.push(j); return j; }),
        update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      },
    };
    const svc = new ImportsService(prisma, { log: jest.fn(async () => undefined) } as any, integrations);
    const job: any = await svc.importOrders("org-1", "user-1", {
      csvText: "order_ref,customer_phone,item_name,unit_price\nSHOP-1,01712345678,A,100\nSHOP-1,01712345678,A,100\n",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0][3]).toBe("csv");
    expect(job.successRows).toBe(1);
    expect(job.skippedRows).toBe(1);
    expect(job.failedRows).toBe(0);
  });
});
