import { ImportsService } from "./imports.service";

// Minimal in-memory fake of the Prisma models the service uses.
function fakePrisma() {
  const products = new Map<string, any>();
  const jobs = new Map<string, any>();
  let seq = 0;
  return {
    products, jobs,
    importJob: {
      create: async ({ data }: any) => { const job = { id: `job-${++seq}`, ...data }; jobs.set(job.id, job); return job; },
      update: async ({ where, data }: any) => { const job = { ...jobs.get(where.id), ...data }; jobs.set(where.id, job); return job; },
      findMany: async () => [...jobs.values()],
      findFirst: async () => null,
    },
    product: {
      findUnique: async ({ where }: any) => products.get(`${where.organizationId_sku.organizationId}:${where.organizationId_sku.sku}`) ?? null,
      create: async ({ data }: any) => {
        const p = { id: `prod-${++seq}`, ...data };
        if (data.sku) products.set(`${data.organizationId}:${data.sku}`, p);
        return p;
      },
    },
    productCost: { create: async ({ data }: any) => ({ id: `cost-${++seq}`, ...data }) },
  };
}

describe("ImportsService.importProducts", () => {
  it("imports valid rows, skips duplicate SKUs on re-upload, and reports bad rows", async () => {
    const prisma = fakePrisma();
    const audit = { log: async () => {} } as any;
    const svc = new ImportsService(prisma as any, audit);
    const csv = "name,sku,price,cost\nShirt,TS-1,850,420\nBroken,TS-2,not-a-price,";

    const first = await svc.importProducts("org-1", "user-1", { csvText: csv });
    expect(first.successRows).toBe(1);
    expect(first.failedRows).toBe(1);
    expect(first.skippedRows).toBe(0);
    expect(first.status).toBe("COMPLETED");

    const second = await svc.importProducts("org-1", "user-1", { csvText: csv });
    expect(second.successRows).toBe(0);
    expect(second.skippedRows).toBe(1); // TS-1 already exists: skipped, not overwritten
  });
});
