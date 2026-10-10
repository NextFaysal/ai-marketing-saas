import { IntegrationsService } from "./integrations.service";
import { normalizeWooOrder, normalizeWooProduct } from "./woocommerce/normalize";

// Generic in-memory fake: findFirst matches equality on the given fields.
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([k, v]) => v === undefined || row[k] === v);
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `id-${++seq}`, ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data); return row;
    },
    deleteMany: async ({ where }: any) => { for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1); },
  };
}

function fakePrisma() {
  return {
    product: makeTable(), productVariant: makeTable(), customer: makeTable(),
    order: makeTable(), orderItem: makeTable(), store: makeTable(),
    integration: makeTable(), syncJob: makeTable(),
    integrationCredential: makeTable(), webhookEvent: makeTable(),
  };
}

const audit = { log: async () => {} } as any;

describe("IntegrationsService upserts (tenant-scoped, idempotent)", () => {
  it("creating the same Woo product twice updates it instead of duplicating", async () => {
    const prisma = fakePrisma();
    const svc = new IntegrationsService(prisma as any, audit);
    const p = normalizeWooProduct({ id: 42, name: "Shirt", status: "publish", price: "850", sku: "TS-1" });
    expect(await svc.upsertProduct("org-1", p)).toBe("created");
    expect(await svc.upsertProduct("org-1", { ...p, priceMinor: 90000n })).toBe("updated");
    expect(prisma.product.rows).toHaveLength(1);
    expect(prisma.product.rows[0].priceMinor).toBe(90000n);
  });

  it("the same Woo product id in a different organization is a separate product", async () => {
    const prisma = fakePrisma();
    const svc = new IntegrationsService(prisma as any, audit);
    const p = normalizeWooProduct({ id: 42, name: "Shirt", status: "publish", price: "850", sku: "TS-1" });
    await svc.upsertProduct("org-1", p);
    await svc.upsertProduct("org-2", p);
    expect(prisma.product.rows).toHaveLength(2);
  });

  it("syncing the same order twice updates status and replaces items, keeping one customer", async () => {
    const prisma = fakePrisma();
    const svc = new IntegrationsService(prisma as any, audit);
    const raw = {
      id: 900, number: "900", status: "processing", payment_method: "cod", currency: "BDT",
      total: "910", shipping_total: "60", discount_total: "0", total_tax: "0",
      customer_id: 7, billing: { first_name: "Rahim", email: "r@example.com", phone: "017" },
      line_items: [{ product_id: 42, name: "Shirt", sku: "TS-1", quantity: 1, price: "850", subtotal: "850", total: "850" }],
      refunds: [],
    };
    expect(await svc.upsertOrder("org-1", null, normalizeWooOrder(raw))).toBe("created");
    expect(await svc.upsertOrder("org-1", null, normalizeWooOrder({ ...raw, status: "completed" }))).toBe("updated");
    expect(prisma.order.rows).toHaveLength(1);
    expect(prisma.order.rows[0].status).toBe("completed");
    expect(prisma.order.rows[0].isCod).toBe(true);
    expect(prisma.orderItem.rows).toHaveLength(1); // replaced, not duplicated
    expect(prisma.customer.rows).toHaveLength(1);  // matched by external id
  });

  it("public integration output never exposes credential material", () => {
    const svc = new IntegrationsService(fakePrisma() as any, audit);
    const out = svc.toPublicIntegration({ id: "i1", provider: "woocommerce", credential: { encryptedData: "v1:secret" } });
    expect(JSON.stringify(out)).not.toContain("v1:secret");
    expect(out.hasCredentials).toBe(true);
  });
});
