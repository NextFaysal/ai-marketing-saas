import { BadRequestException, NotFoundException } from "@nestjs/common";
import { allocateBundle } from "./ec29-bundles";
import { BundlesService } from "./bundles.service";

/** EC29 — bundle allocation identity + BundlesService
 * validation / CRUD (fake-prisma style of the neighbouring
 * suites). */

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in (v as any)) {
        if (!((v as any).in as any[]).includes(row[k])) return false;
        continue;
      }
      if ("not" in (v as any)) {
        if (row[k] === (v as any).not) return false;
        continue;
      }
      if (!matchWhere(row, v)) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}

function applyOrderBy(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of [...specs].reverse()) {
    const [key, dir] = Object.entries(spec)[0] as [string, string];
    out.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp =
        av instanceof Date || bv instanceof Date
          ? new Date(av).getTime() - new Date(bv).getTime()
          : av < bv
            ? -1
            : 1;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  return out;
}

function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) =>
      applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let found = applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy);
      if (skip) found = found.slice(skip);
      if (take !== undefined) found = found.slice(0, take);
      return found;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
  };
}

function makePrisma() {
  return {
    bundle: makeTable(),
    product: makeTable(),
    productVariant: makeTable(),
  } as any;
}

const T0 = new Date("2026-10-01T00:00:00Z");
const auditStub: any = { log: jest.fn(async () => undefined) };

function seedProducts(prisma: any) {
  prisma.product.rows.push(
    { id: "p-1", organizationId: "org-1", name: "পণ্য ১", status: "ACTIVE", priceMinor: 10000n, createdAt: T0, updatedAt: T0 },
    { id: "p-2", organizationId: "org-1", name: "পণ্য ২", status: "ACTIVE", priceMinor: 20000n, createdAt: T0, updatedAt: T0 },
    { id: "p-3", organizationId: "org-1", name: "পণ্য ৩", status: "ACTIVE", priceMinor: 5000n, createdAt: T0, updatedAt: T0 },
    { id: "p-foreign", organizationId: "org-2", name: "অন্যের", status: "ACTIVE", priceMinor: 1000n, createdAt: T0, updatedAt: T0 },
  );
  prisma.productVariant.rows.push(
    { id: "v-1", productId: "p-1", name: "লাল", sku: "P1-RED", priceMinor: 11000n, stockQuantity: 5, createdAt: T0, updatedAt: T0 },
  );
}

describe("EC29 allocateBundle — exact identity", () => {
  it("(a) equal-ish regular totals: last component absorbs the remainder, sum is EXACT", () => {
    const out = allocateBundle(10000n, [
      { qty: 1, regularUnitMinor: 3333n },
      { qty: 1, regularUnitMinor: 3333n },
      { qty: 1, regularUnitMinor: 3334n },
    ]);
    const sum = out.reduce((s, x) => s + x.allocatedTotalMinor, 0n);
    expect(sum).toBe(10000n);
    expect(out[0].allocatedTotalMinor).toBe(3333n);
    expect(out[1].allocatedTotalMinor).toBe(3333n);
    expect(out[2].allocatedTotalMinor).toBe(3334n);
  });

  it("(b) qty > 1 components: sum is EXACT and unit = floor(total / qty)", () => {
    const out = allocateBundle(9999n, [
      { qty: 2, regularUnitMinor: 1500n },
      { qty: 1, regularUnitMinor: 2000n },
    ]);
    const sum = out.reduce((s, x) => s + x.allocatedTotalMinor, 0n);
    expect(sum).toBe(9999n);
    // R = 3000 + 2000 = 5000; first = floor(9999*3000/5000) = 5999, last = 4000.
    expect(out[0].allocatedTotalMinor).toBe(5999n);
    expect(out[1].allocatedTotalMinor).toBe(4000n);
    expect(out[0].allocatedUnitMinor).toBe(2999n);
  });

  it("(c) R = 0 falls back to quantity weights, sum still EXACT", () => {
    const out = allocateBundle(10001n, [
      { qty: 1, regularUnitMinor: 0n },
      { qty: 3, regularUnitMinor: 0n },
    ]);
    const sum = out.reduce((s, x) => s + x.allocatedTotalMinor, 0n);
    expect(sum).toBe(10001n);
    expect(out[0].allocatedTotalMinor).toBe(2500n); // floor(10001 * 1/4)
    expect(out[1].allocatedTotalMinor).toBe(7501n);
  });

  it("single component gets the whole price", () => {
    const out = allocateBundle(777n, [{ qty: 2, regularUnitMinor: 100n }]);
    expect(out[0].allocatedTotalMinor).toBe(777n);
    expect(out[0].allocatedUnitMinor).toBe(388n);
  });
});

describe("EC29 BundlesService.validateItems", () => {
  it("1 entry → 400; 11 entries → 400", async () => {
    const prisma = makePrisma();
    seedProducts(prisma);
    const svc = new BundlesService(prisma, auditStub);
    await expect(
      svc.validateItems("org-1", [{ productId: "p-1", qty: 1 }]),
    ).rejects.toBeInstanceOf(BadRequestException);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ productId: `p-1`, qty: 1, variantSku: `SKU-${i}` }));
    // distinct SKUs would fail variant lookup; use repeated products with distinct fake skus is
    // not possible — the count check must fire BEFORE any lookup, so any 11 entries throw the count error.
    await expect(svc.validateItems("org-1", eleven)).rejects.toThrow(/সর্বোচ্চ ১০টি/);
  });

  it("foreign product → 400 with the product id", async () => {
    const prisma = makePrisma();
    seedProducts(prisma);
    const svc = new BundlesService(prisma, auditStub);
    await expect(
      svc.validateItems("org-1", [
        { productId: "p-1", qty: 1 },
        { productId: "p-foreign", qty: 1 },
      ]),
    ).rejects.toThrow(/পণ্য পাওয়া যায়নি \(এই সংস্থার নয়\): p-foreign/);
  });

  it("duplicate (productId, variantSku) pair → 400", async () => {
    const prisma = makePrisma();
    seedProducts(prisma);
    const svc = new BundlesService(prisma, auditStub);
    await expect(
      svc.validateItems("org-1", [
        { productId: "p-1", qty: 1 },
        { productId: "p-1", qty: 2 },
      ]),
    ).rejects.toThrow(/দুবার দেওয়া যাবে না/);
  });

  it("bad variant SKU → 400", async () => {
    const prisma = makePrisma();
    seedProducts(prisma);
    const svc = new BundlesService(prisma, auditStub);
    await expect(
      svc.validateItems("org-1", [
        { productId: "p-1", qty: 1, variantSku: "NOPE" },
        { productId: "p-2", qty: 1 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("happy path normalizes items (variantSku kept, absent → null)", async () => {
    const prisma = makePrisma();
    seedProducts(prisma);
    const svc = new BundlesService(prisma, auditStub);
    const out = await svc.validateItems("org-1", [
      { productId: "p-1", qty: 2, variantSku: "P1-RED" },
      { productId: "p-2", qty: 1 },
    ]);
    expect(out).toEqual([
      { productId: "p-1", variantSku: "P1-RED", qty: 2 },
      { productId: "p-2", variantSku: null, qty: 1 },
    ]);
  });
});

describe("EC29 BundlesService CRUD", () => {
  it("create audits, price string round-trips; list computes regularTotal + missing flags", async () => {
    const prisma = makePrisma();
    seedProducts(prisma);
    auditStub.log.mockClear();
    const svc = new BundlesService(prisma, auditStub);
    const created: any = await svc.create("org-1", "u1", {
      name: "কম্বো",
      bundlePriceMinor: "25000",
      items: [
        { productId: "p-1", qty: 1 },
        { productId: "p-2", qty: 1 },
      ],
    } as any);
    expect(created.bundle.bundlePriceMinor).toBe("25000");
    expect(created.bundle.regularTotalMinor).toBe("30000");
    expect(created.bundle.hasMissingComponents).toBe(false);
    expect(auditStub.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bundle.created", entityType: "Bundle" }),
    );

    // Delete a component product → the staff list flags it and
    // the regular total drops that component's contribution.
    const idx = prisma.product.rows.findIndex((r: any) => r.id === "p-2");
    prisma.product.rows.splice(idx, 1);
    const list: any = await svc.list("org-1");
    expect(list.items).toHaveLength(1);
    expect(list.items[0].hasMissingComponents).toBe(true);
    expect(list.items[0].regularTotalMinor).toBe("10000");
  });

  it("foreign getOne → 404; invalid price → 400", async () => {
    const prisma = makePrisma();
    seedProducts(prisma);
    const svc = new BundlesService(prisma, auditStub);
    const created: any = await svc.create("org-1", "u1", {
      name: "কম্বো",
      bundlePriceMinor: "100",
      items: [
        { productId: "p-1", qty: 1 },
        { productId: "p-2", qty: 1 },
      ],
    } as any);
    await expect(svc.getOne("org-2", created.bundle.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc.create("org-1", "u1", {
        name: "খারাপ",
        bundlePriceMinor: "0",
        items: [
          { productId: "p-1", qty: 1 },
          { productId: "p-2", qty: 1 },
        ],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
