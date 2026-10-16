import * as ExcelJS from "exceljs";
import { BadRequestException } from "@nestjs/common";
import { parseProductRecords, parseProductsCsv } from "./csv";
import { parseProductsXlsx } from "./xlsx";
import { ImportsService } from "./imports.service";

// GB2 (GC6 §2–§3): product CSV export column-shape support (brand /
// status / variant columns) in the parser, variant-group + brand
// handling in the import service, and the Excel (.xlsx) front-end.

describe("GB2 parser — new columns", () => {
  it("parses a valid variant row with brand and status", () => {
    const csv = [
      "name,sku,price,brand,status,variant_name,variant_sku,variant_price,variant_stock,variant_cost",
      "Cotton T-Shirt,TS-100,1200.50,Acme,Active,Red / M,TS-100-RED,1250,12,700",
    ].join("\n");
    const r = parseProductsCsv(csv);
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      name: "Cotton T-Shirt", sku: "TS-100", brand: "Acme", status: "ACTIVE",
      variantName: "Red / M", variantSku: "TS-100-RED",
    });
    expect(r.rows[0].priceMinor).toBe(120050n);
    expect(r.rows[0].variantPriceMinor).toBe(125000n);
    expect(r.rows[0].variantStockQuantity).toBe(12);
    expect(r.rows[0].variantCostMinor).toBe(70000n);
  });

  it("normalizes status case-insensitively to the UPPERCASE enum", () => {
    const r = parseProductsCsv("name,price,status\nA,100,draft\nB,200,ARCHIVED\nC,300,active");
    expect(r.errors).toHaveLength(0);
    expect(r.rows.map((x) => x.status)).toEqual(["DRAFT", "ARCHIVED", "ACTIVE"]);
  });

  it("rejects a bad status with a row error and keeps other rows", () => {
    const r = parseProductsCsv("name,price,status\nGood,100,active\nBad,200,published");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].name).toBe("Good");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].row).toBe(2);
    expect(r.errors[0].message).toContain("Invalid status");
    expect(r.errors[0].message).toContain("published");
  });

  it("rejects variant columns without variant_name", () => {
    const r = parseProductsCsv("name,price,variant_sku,variant_price\nShirt,500,SH-1,550");
    expect(r.rows).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toBe("variant_name is required when variant columns are used");
  });

  it("rejects invalid variant money and variant stock", () => {
    const badPrice = parseProductsCsv("name,price,variant_name,variant_price\nShirt,500,Red,abc");
    expect(badPrice.rows).toHaveLength(0);
    expect(badPrice.errors[0].message).toContain("Invalid variant_price");
    const badStock = parseProductsCsv("name,price,variant_name,variant_stock\nShirt,500,Red,1.5");
    expect(badStock.rows).toHaveLength(0);
    expect(badStock.errors[0].message).toContain("Invalid variant_stock");
    const negStock = parseProductsCsv("name,price,variant_name,variant_stock\nShirt,500,Red,-2");
    expect(negStock.rows).toHaveLength(0);
    expect(negStock.errors[0].message).toContain("Invalid variant_stock");
  });

  it("legacy files produce rows with all new fields undefined, field-for-field", () => {
    const r = parseProductsCsv("name,sku,price,cost,stock,category\nCotton T-Shirt,TS-001,850.00,420,25,Apparel");
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(row.rowNumber).toBe(1);
    expect(row.name).toBe("Cotton T-Shirt");
    expect(row.sku).toBe("TS-001");
    expect(row.priceMinor).toBe(85000n);
    expect(row.costMinor).toBe(42000n);
    expect(row.stockQuantity).toBe(25);
    expect(row.currency).toBe("BDT");
    expect(row.category).toBe("Apparel");
    expect(row.brand).toBeUndefined();
    expect(row.status).toBeUndefined();
    expect(row.variantName).toBeUndefined();
    expect(row.variantSku).toBeUndefined();
    expect(row.variantPriceMinor).toBeUndefined();
    expect(row.variantStockQuantity).toBeUndefined();
    expect(row.variantCostMinor).toBeUndefined();
  });

  it("parseProductRecords stringifies numbers/booleans and nulls", () => {
    const r = parseProductRecords([
      { name: "  Mug  ", price: 350, stock: 7, sku: 12345 },
      { name: "NoPrice", price: null },
    ]);
    expect(r.totalRows).toBe(2);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].name).toBe("Mug");
    expect(r.rows[0].priceMinor).toBe(35000n);
    expect(r.rows[0].stockQuantity).toBe(7);
    expect(r.rows[0].sku).toBe("12345");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toContain("price");
  });
});

// ---- Fake prisma (mirrors imports.service.spec.ts style, extended) ----

function fakePrismaGb2() {
  const products = new Map<string, any>();
  const productList: any[] = [];
  const jobs = new Map<string, any>();
  const variants: any[] = [];
  const costs: any[] = [];
  const brands: any[] = [];
  let seq = 0;
  return {
    products, productList, jobs, variants, costs, brands,
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
        productList.push(p);
        if (data.sku) products.set(`${data.organizationId}:${data.sku}`, p);
        return p;
      },
    },
    productVariant: {
      create: async ({ data }: any) => {
        if (data.sku && variants.some((v) => v.productId === data.productId && v.sku === data.sku)) {
          throw new Error("Unique constraint failed on the fields: (`productId`,`sku`)");
        }
        const v = { id: `var-${++seq}`, ...data };
        variants.push(v);
        return v;
      },
    },
    productCost: {
      create: async ({ data }: any) => { const c = { id: `cost-${++seq}`, ...data }; costs.push(c); return c; },
    },
    brand: {
      findMany: async ({ where }: any) => brands.filter((b) => b.organizationId === where.organizationId),
      findFirst: async ({ where }: any) =>
        brands.find((b) => b.organizationId === where.organizationId && (where.slug ? b.slug === where.slug : b.name === where.name)) ?? null,
      create: async ({ data }: any) => {
        if (brands.some((b) => b.organizationId === data.organizationId && b.slug === data.slug)) {
          throw new Error("Unique constraint failed on the fields: (`organizationId`,`slug`)");
        }
        const b = { id: `brand-${++seq}`, ...data };
        brands.push(b);
        return b;
      },
    },
  };
}

describe("GB2 ImportsService — variant groups, brand, status", () => {
  it("creates one product + one variant per group row, with variant costs and brand", async () => {
    const prisma = fakePrismaGb2();
    const audit = { log: async () => {} } as any;
    const svc = new ImportsService(prisma as any, audit);
    const csv = [
      "name,sku,price,cost,brand,status,variant_name,variant_sku,variant_price,variant_stock,variant_cost",
      "T-Shirt,TS-V,1000,500,Acme,draft,Red / M,TS-V-RED,1000,10,520",
      "T-Shirt,TS-V,1000,500,Acme,draft,Blue / M,TS-V-BLUE,1100,4,560",
    ].join("\n");
    const job = await svc.importProducts("org-1", "user-1", { csvText: csv });
    // Counting choice: one persisted row per variant created -> 2.
    expect(job.successRows).toBe(2);
    expect(job.failedRows).toBe(0);
    expect(job.skippedRows).toBe(0);
    expect(prisma.productList).toHaveLength(1);
    expect(prisma.productList[0]).toMatchObject({ name: "T-Shirt", sku: "TS-V", status: "DRAFT" });
    expect(prisma.productList[0].brandId).toBe(prisma.brands[0].id);
    expect(prisma.brands).toHaveLength(1);
    expect(prisma.brands[0]).toMatchObject({ name: "Acme", slug: "acme", organizationId: "org-1" });
    expect(prisma.variants).toHaveLength(2);
    expect(prisma.variants[0]).toMatchObject({ name: "Red / M", sku: "TS-V-RED", stockQuantity: 10 });
    expect(prisma.variants[0].priceMinor).toBe(100000n);
    expect(prisma.variants[1]).toMatchObject({ name: "Blue / M", sku: "TS-V-BLUE" });
    // Costs: 1 product-level (first row cost) + 2 variant-level.
    expect(prisma.costs).toHaveLength(3);
    const productCost = prisma.costs.find((c) => !c.variantId);
    expect(productCost.costMinor).toBe(50000n);
    const variantCosts = prisma.costs.filter((c) => c.variantId);
    expect(variantCosts.map((c) => c.costMinor).sort()).toEqual([52000n, 56000n]);
  });

  it("skips the WHOLE variant group when the product SKU already exists", async () => {
    const prisma = fakePrismaGb2();
    const audit = { log: async () => {} } as any;
    const svc = new ImportsService(prisma as any, audit);
    await svc.importProducts("org-1", "user-1", { csvText: "name,sku,price\nExisting,TS-DUP,900" });
    const csv = [
      "name,sku,price,variant_name,variant_sku",
      "Other,TS-DUP,900,Red,TS-DUP-RED",
      "Other,TS-DUP,900,Blue,TS-DUP-BLUE",
    ].join("\n");
    const job = await svc.importProducts("org-1", "user-1", { csvText: csv });
    expect(job.skippedRows).toBe(2);
    expect(job.successRows).toBe(0);
    expect(prisma.productList).toHaveLength(1); // only the pre-existing product
    expect(prisma.variants).toHaveLength(0);
  });

  it("standalone rows honour status and link an existing brand case-insensitively (created once)", async () => {
    const prisma = fakePrismaGb2();
    const audit = { log: async () => {} } as any;
    const svc = new ImportsService(prisma as any, audit);
    const csv = "name,sku,price,brand,status\nMug,M-1,350,ACME,archived\nCup,C-1,250,acme,active";
    const job = await svc.importProducts("org-1", "user-1", { csvText: csv });
    expect(job.successRows).toBe(2);
    expect(prisma.brands).toHaveLength(1); // second row matched the first brand
    expect(prisma.productList[0].status).toBe("ARCHIVED");
    expect(prisma.productList[0].brandId).toBe(prisma.brands[0].id);
    expect(prisma.productList[1].status).toBe("ACTIVE");
    expect(prisma.productList[1].brandId).toBe(prisma.brands[0].id);
  });

  it("brand slug collisions append -2 for a different brand name with the same slug", async () => {
    const prisma = fakePrismaGb2();
    const audit = { log: async () => {} } as any;
    const svc = new ImportsService(prisma as any, audit);
    const csv = "name,sku,price,brand\nA,A-1,100,My Brand!\nB,B-1,100,My Brand";
    const job = await svc.importProducts("org-1", "user-1", { csvText: csv });
    expect(job.successRows).toBe(2);
    expect(prisma.brands.map((b) => b.slug).sort()).toEqual(["my-brand", "my-brand-2"]);
  });

  it("a duplicate variant SKU inside a group fails only that row", async () => {
    const prisma = fakePrismaGb2();
    const audit = { log: async () => {} } as any;
    const svc = new ImportsService(prisma as any, audit);
    const csv = [
      "name,sku,price,variant_name,variant_sku",
      "Shirt,SH-1,500,Red,SH-RED",
      "Shirt,SH-1,500,Red Again,SH-RED",
      "Shirt,SH-1,500,Blue,SH-BLUE",
    ].join("\n");
    const job = await svc.importProducts("org-1", "user-1", { csvText: csv });
    expect(job.successRows).toBe(2);
    expect(job.failedRows).toBe(1);
    expect(job.errors[0].row).toBe(2);
    expect(prisma.variants).toHaveLength(2);
  });

  it("brand resolution failure does not fail the row (no brand table)", async () => {
    const prisma: any = fakePrismaGb2();
    delete prisma.brand;
    const audit = { log: async () => {} } as any;
    const svc = new ImportsService(prisma as any, audit);
    const job = await svc.importProducts("org-1", "user-1", { csvText: "name,sku,price,brand\nMug,M-9,350,Acme" });
    expect(job.successRows).toBe(1);
    expect(prisma.productList[0].brandId).toBeUndefined();
  });
});

describe("GB2 Excel front-end", () => {
  async function buildWorkbookBuffer(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Products");
    ws.addRow(["name", "sku", "price", "brand", "status", "variant_name", "variant_sku", "variant_price", "variant_stock", "variant_cost"]);
    ws.addRow(["T-Shirt", "TS-X", 1000, "Acme", "active", "Red / M", "TS-X-RED", 1000, 10, 500]);
    ws.addRow(["T-Shirt", "TS-X", 1000, "Acme", "active", "Blue / M", "TS-X-BLUE", 1100.5, 4, 550]);
    ws.addRow(["Mug", "MUG-1", 350.25, "", "draft", "", "", "", "", ""]);
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf as any);
  }

  it("round-trips a workbook through parseProductsXlsx", async () => {
    const buffer = await buildWorkbookBuffer();
    const r = await parseProductsXlsx(buffer);
    expect(r.errors).toHaveLength(0);
    expect(r.totalRows).toBe(3);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ name: "T-Shirt", sku: "TS-X", brand: "Acme", status: "ACTIVE", variantName: "Red / M", variantSku: "TS-X-RED" });
    expect(r.rows[0].variantPriceMinor).toBe(100000n);
    expect(r.rows[1].variantPriceMinor).toBe(110050n);
    expect(r.rows[2]).toMatchObject({ name: "Mug", status: "DRAFT" });
    expect(r.rows[2].priceMinor).toBe(35025n);
    expect(r.rows[2].variantName).toBeUndefined();
  });

  it("imports an xlsx file end-to-end through the service (audit import.products.xlsx)", async () => {
    const prisma = fakePrismaGb2();
    const auditCalls: any[] = [];
    const audit = { log: async (entry: any) => { auditCalls.push(entry); } } as any;
    const svc = new ImportsService(prisma as any, audit);
    const buffer = await buildWorkbookBuffer();
    const job = await svc.importProductsXlsx("org-1", "user-1", { fileName: "products.xlsx", fileBase64: buffer.toString("base64") });
    expect(job.kind).toBe("products");
    expect(job.successRows).toBe(3); // 2 variant rows + 1 standalone row
    expect(prisma.productList).toHaveLength(2);
    expect(prisma.variants).toHaveLength(2);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe("import.products.xlsx");
  });

  it("malformed buffers become the Bengali 400 at the service boundary", async () => {
    const prisma = fakePrismaGb2();
    const audit = { log: async () => {} } as any;
    const svc = new ImportsService(prisma as any, audit);
    await expect(
      svc.importProductsXlsx("org-1", "user-1", { fileBase64: Buffer.from("this is not excel").toString("base64") }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.importProductsXlsx("org-1", "user-1", { fileBase64: "" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    try {
      await svc.importProductsXlsx("org-1", "user-1", { fileBase64: Buffer.from("nope").toString("base64") });
      throw new Error("expected BadRequestException");
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).message).toContain("Excel ফাইলটি পড়া যায়নি");
    }
    await expect(parseProductsXlsx(Buffer.from("not excel"))).rejects.toThrow();
  });
});
