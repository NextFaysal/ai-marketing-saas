import { BadRequestException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { ProductsService } from "./products.service";

/** CP5: POST products/push-batch service behaviour. */

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
function makeTable() {
  const rows: any[] = [];
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
  };
}

function setup() {
  const prisma: any = { product: makeTable(), storeListing: makeTable() };
  prisma.product.rows.push(
    { id: "p1", organizationId: "org-1", name: "Shirt" },
    { id: "p2", organizationId: "org-1", name: "No Listing Product" },
    { id: "p-foreign", organizationId: "org-2", name: "Foreign" },
  );
  prisma.storeListing.rows.push(
    { id: "l1", organizationId: "org-1", storeId: "s1", productId: "p1" },
    { id: "l2", organizationId: "org-1", storeId: "s2", productId: "p1" },
  );
  const audits: any[] = [];
  const audit: any = { log: async (e: any) => { audits.push(e); } };
  const pushCalls: any[] = [];
  const catalogPush: any = {
    enqueueProductPush: async (orgId: string, productId: string, opts: any) => {
      pushCalls.push({ orgId, productId, opts });
      return { enqueued: 2, skipped: 0 };
    },
  };
  const svc = new ProductsService(prisma, audit, undefined, undefined, catalogPush);
  return { svc, audits, pushCalls };
}

describe("CP5 ProductsService.pushBatch", () => {
  it("mixed batch: found pushes, foreign is not_found, listing-less is no_listings; one audit", async () => {
    const { svc, audits, pushCalls } = setup();
    const out = await svc.pushBatch("org-1", "u1", ["p1", "p-foreign", "p2", "ghost"]);
    expect(out.results).toEqual([
      { productId: "p1", ok: true, enqueued: 2, skipped: 0 },
      { productId: "p-foreign", ok: false, error: "not_found" },
      { productId: "p2", ok: false, error: "no_listings" },
      { productId: "ghost", ok: false, error: "not_found" },
    ]);
    expect(out.enqueued).toBe(2);
    // The SAME single-push path: enqueueProductPush(org, productId).
    expect(pushCalls).toEqual([{ orgId: "org-1", productId: "p1", opts: undefined }]);
    const batchAudits = audits.filter((a) => a.action === "products.push_batch");
    expect(batchAudits).toHaveLength(1);
    expect(batchAudits[0].metadata).toMatchObject({ count: 4, enqueued: 2 });
  });

  it("empty array 400s (Bengali) and >50 400s (Bengali)", async () => {
    const { svc } = setup();
    await expect(svc.pushBatch("org-1", "u1", [])).rejects.toBeInstanceOf(ApiException);
    await expect(svc.pushBatch("org-1", "u1", [])).rejects.toThrow("কমপক্ষে একটি");
    const fiftyOne = Array.from({ length: 51 }, (_, i) => `p${i}`);
    await expect(svc.pushBatch("org-1", "u1", fiftyOne)).rejects.toBeInstanceOf(ApiException);
    await expect(svc.pushBatch("org-1", "u1", fiftyOne)).rejects.toThrow("৫০");
  });

  it("exactly 50 is allowed", async () => {
    const { svc } = setup();
    const fifty = Array.from({ length: 50 }, (_, i) => `ghost-${i}`);
    const out = await svc.pushBatch("org-1", "u1", fifty);
    expect(out.results).toHaveLength(50);
    expect(out.enqueued).toBe(0);
  });
});
