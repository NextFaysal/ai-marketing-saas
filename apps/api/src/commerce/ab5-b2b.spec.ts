import "reflect-metadata";
import { ApiException } from "../i18n";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PriceListsService, pickGroupPrice } from "./price-lists.service";
import { QuotesService, hashQuoteToken, quoteTotalMinor } from "./quotes.service";
import { PosService } from "../pos/pos.service";
import { OrdersService } from "../orders/orders.service";
import { CustomersService } from "../customers/customers.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { dhakaDayStartUtc } from "../crm/lead-followups";

/**
 * AB5 (AX7) — B2B completion: customer groups + price lists,
 * group pricing at line-build (POS level — the storefront
 * computeQuote harness is too heavy to reuse here, so the
 * precedence rule is pinned via pickGroupPrice unit tests +
 * this POS-level application test, which exercises the same
 * resolve-map → pick → replace-unit flow), net terms
 * (upsertOrder stamp + khata overdue), and quotes (totals,
 * numbering, token send, public respond, conversion).
 *
 * Self-contained fake-prisma harness in the ec29-bundles /
 * on7-khata style.
 */

function cmpVal(a: any, b: any): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av === bv) return 0;
  if (av == null) return -1;
  if (bv == null) return 1;
  return av < bv ? -1 : 1;
}

function matchWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!Array.isArray(cond) || !(cond as any[]).some((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (key === "AND") {
      if (!Array.isArray(cond) || !(cond as any[]).every((w) => matchWhere(row, w))) return false;
      continue;
    }
    const v = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
      const c: any = cond;
      if ("in" in c && !c.in.some((x: any) => x === v || String(x) === String(v))) return false;
      if ("notIn" in c && c.notIn.some((x: any) => x === v)) return false;
      if ("gt" in c && !(cmpVal(v, c.gt) > 0)) return false;
      if ("gte" in c && !(cmpVal(v, c.gte) >= 0)) return false;
      if ("lt" in c && !(cmpVal(v, c.lt) < 0)) return false;
      if ("lte" in c && !(cmpVal(v, c.lte) <= 0)) return false;
      if ("not" in c) {
        if (c.not === null) { if (v == null) return false; }
        else if (v === c.not) return false;
        continue;
      }
      if ("equals" in c && v !== c.equals) return false;
      if ("contains" in c && !(typeof v === "string" && v.includes(c.contains))) return false;
      continue;
    }
    if (cond === null) {
      if (v != null) return false;
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}

function applyData(row: any, data: any) {
  for (const [k, val] of Object.entries(data ?? {})) {
    if (val !== null && typeof val === "object" && !(val instanceof Date) && !Array.isArray(val)) {
      const o: any = val;
      if ("increment" in o) row[k] = (row[k] ?? 0) + o.increment;
      else if ("decrement" in o) row[k] = (row[k] ?? 0) - o.decrement;
      else if ("set" in o) row[k] = o.set;
      else row[k] = val;
    } else {
      row[k] = val;
    }
  }
}

function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of [...specs].reverse()) {
    const [field, dir] = Object.entries(spec)[0] as [string, string];
    out.sort((a, b) => cmpVal(a[field], b[field]) * (dir === "desc" ? -1 : 1));
  }
  return out;
}

let globalSeq = 0;

class FakeTable {
  rows: any[] = [];
  constructor(public name: string) {}
  async create({ data }: any) {
    const row = { id: data.id ?? `${this.name}-${++globalSeq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
    this.rows.push(row);
    return row;
  }
  async findFirst(args: any = {}) {
    const m = sortRows(this.rows.filter((r) => matchWhere(r, args.where)), args.orderBy);
    return m[0] ?? null;
  }
  async findMany(args: any = {}) {
    let m = sortRows(this.rows.filter((r) => matchWhere(r, args?.where)), args?.orderBy);
    if (args?.skip) m = m.slice(args.skip);
    if (args?.take !== undefined) m = m.slice(0, args.take);
    return m;
  }
  async findUnique(args: any = {}) {
    return this.findFirst(args);
  }
  async update({ where, data }: any) {
    const row = this.rows.find((r) => matchWhere(r, where));
    if (!row) throw new Error(`record not found in ${this.name}`);
    applyData(row, data);
    row.updatedAt = new Date();
    return row;
  }
  async updateMany({ where, data }: any) {
    let count = 0;
    for (const row of this.rows.filter((r) => matchWhere(r, where))) {
      applyData(row, data);
      count++;
    }
    return { count };
  }
  async upsert({ where, create, update }: any) {
    const existing = await this.findFirst({ where });
    if (existing) {
      if (update && Object.keys(update).length) applyData(existing, update);
      return existing;
    }
    return this.create({ data: create });
  }
  async delete({ where }: any) {
    const idx = this.rows.findIndex((r) => matchWhere(r, where));
    if (idx < 0) throw new Error(`record not found in ${this.name}`);
    return this.rows.splice(idx, 1)[0];
  }
  async deleteMany({ where }: any) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !matchWhere(r, where));
    return { count: before - this.rows.length };
  }
  async count({ where }: any = {}) {
    return this.rows.filter((r) => matchWhere(r, where)).length;
  }
  async groupBy({ by, where }: any) {
    const sums = new Map<string, bigint>();
    for (const r of this.rows.filter((x) => matchWhere(x, where))) {
      const key = String(r[by[0]]);
      sums.set(key, (sums.get(key) ?? 0n) + BigInt(r.amountMinor ?? 0));
    }
    return [...sums.entries()].map(([k, s]) => ({ [by[0]]: k, _sum: { amountMinor: s } }));
  }
}

const TABLE_NAMES = [
  "customerGroup", "priceList", "priceListItem", "product", "productVariant",
  "customer", "quote", "quoteCounter", "order", "orderItem", "organization",
  "messagingSenderConfig", "paymentVerification", "channelConversation",
  "courierShipment", "lead", "customerStoreIdentity", "store", "subscription",
  "checkoutFieldDef", "storefrontSetting",
] as const;

function makePrisma() {
  const prisma: any = {};
  for (const n of TABLE_NAMES) prisma[n] = new FakeTable(n);
  prisma.$transaction = async (cb: any) => cb(prisma);
  return prisma;
}

const auditStub = () => ({ log: jest.fn(async () => undefined) }) as any;

const T0 = new Date("2026-10-01T00:00:00Z");

function seedCatalog(prisma: any) {
  prisma.product.rows.push(
    { id: "p-1", organizationId: "org-1", name: "শার্ট", sku: "SH-1", status: "ACTIVE", priceMinor: 10001n, createdAt: T0, updatedAt: T0 },
    { id: "p-2", organizationId: "org-1", name: "প্যান্ট", sku: "PN-1", status: "ACTIVE", priceMinor: 20000n, createdAt: T0, updatedAt: T0 },
    { id: "p-draft", organizationId: "org-1", name: "খসড়া পণ্য", sku: "DR-1", status: "DRAFT", priceMinor: 5000n, createdAt: T0, updatedAt: T0 },
    { id: "p-foreign", organizationId: "org-2", name: "অন্যের পণ্য", sku: "FR-1", status: "ACTIVE", priceMinor: 1000n, createdAt: T0, updatedAt: T0 },
  );
  prisma.productVariant.rows.push(
    { id: "v-1", productId: "p-1", name: "লাল / XL", sku: "SH-1-RED", priceMinor: 12000n, stockQuantity: 5, createdAt: T0, updatedAt: T0 },
    { id: "v-other", productId: "p-2", name: "নীল", sku: "PN-1-BLU", priceMinor: 21000n, stockQuantity: 5, createdAt: T0, updatedAt: T0 },
  );
}

// ----------------------------------------------------------------
// pickGroupPrice — pure precedence
// ----------------------------------------------------------------

describe("AX7 pickGroupPrice precedence", () => {
  it("variant row beats product-level row; product-level is the fallback; absent ⇒ null", () => {
    const map = new Map<string, bigint>([
      ["p-1::", 8000n],
      ["p-1::v-1", 7500n],
    ]);
    expect(pickGroupPrice(map, "p-1", "v-1")).toBe(7500n);
    expect(pickGroupPrice(map, "p-1", "v-unknown")).toBe(8000n);
    expect(pickGroupPrice(map, "p-1", null)).toBe(8000n);
    expect(pickGroupPrice(map, "p-2", null)).toBeNull();
    expect(pickGroupPrice(null, "p-1", "v-1")).toBeNull();
    expect(pickGroupPrice(undefined, "p-1", null)).toBeNull();
  });
});

// ----------------------------------------------------------------
// PriceListsService
// ----------------------------------------------------------------

describe("AX7 PriceListsService — groups + items", () => {
  it("createGroup audits; duplicate name per org ⇒ Bengali 400; listGroups carries memberCount + hasPriceList", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const audit = auditStub();
    const svc = new PriceListsService(prisma, audit);
    const { group } = await svc.createGroup("org-1", "u-1", { name: "পাইকারি" });
    expect(group.name).toBe("পাইকারি");
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "customer_group.created" }));
    await expect(svc.createGroup("org-1", "u-1", { name: "পাইকারি" })).rejects.toBeInstanceOf(ApiException);
    // Same name in ANOTHER org is fine.
    await svc.createGroup("org-2", "u-1", { name: "পাইকারি" });

    prisma.customer.rows.push({ id: "cust-1", organizationId: "org-1", groupId: group.id, firstName: "A" });
    await svc.setItem("org-1", "u-1", group.id, { productId: "p-1", priceMinor: "9000" });
    const list = await svc.listGroups("org-1");
    expect(list.items).toHaveLength(1);
    expect(list.items[0].memberCount).toBe(1);
    expect(list.items[0].hasPriceList).toBe(true);
  });

  it("setItem validates: foreign product refused; variant of another product refused; bad price refused", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const svc = new PriceListsService(prisma, auditStub());
    const { group } = await svc.createGroup("org-1", "u-1", { name: "G1" });
    await expect(
      svc.setItem("org-1", "u-1", group.id, { productId: "p-foreign", priceMinor: "100" }),
    ).rejects.toThrow(/পণ্য পাওয়া যায়নি/);
    await expect(
      svc.setItem("org-1", "u-1", group.id, { productId: "p-1", variantId: "v-other", priceMinor: "100" }),
    ).rejects.toThrow(/ভ্যারিয়েন্টটি এই পণ্যের নয়/);
    await expect(
      svc.setItem("org-1", "u-1", group.id, { productId: "p-1", priceMinor: "-5" }),
    ).rejects.toBeInstanceOf(ApiException);
  });

  it("setItem find-first-then-write: product-level overwrite keeps ONE row; getPriceList resolves names", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const svc = new PriceListsService(prisma, auditStub());
    const { group } = await svc.createGroup("org-1", "u-1", { name: "G1" });
    await svc.setItem("org-1", "u-1", group.id, { productId: "p-1", priceMinor: "9000" });
    await svc.setItem("org-1", "u-1", group.id, { productId: "p-1", priceMinor: "8500" });
    await svc.setItem("org-1", "u-1", group.id, { productId: "p-1", variantId: "v-1", priceMinor: "8000" });
    expect(prisma.priceListItem.rows).toHaveLength(2);
    const view = await svc.getPriceList("org-1", group.id);
    expect(view.items).toHaveLength(2);
    const prodLevel = view.items.find((i: any) => i.variantId === null);
    expect(prodLevel.priceMinor).toBe("8500");
    expect(prodLevel.productName).toBe("শার্ট");
    const varRow = view.items.find((i: any) => i.variantId === "v-1");
    expect(varRow.priceMinor).toBe("8000");
    expect(varRow.variantName).toBe("লাল / XL");
  });

  it("getPriceList creates the list lazily and returns empty items", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const svc = new PriceListsService(prisma, auditStub());
    const { group } = await svc.createGroup("org-1", "u-1", { name: "G1" });
    const view = await svc.getPriceList("org-1", group.id);
    expect(view.items).toEqual([]);
    expect(prisma.priceList.rows).toHaveLength(1);
  });

  it("bulkPercentOff materializes FLOOR prices for ACTIVE products only (or the given ids)", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const svc = new PriceListsService(prisma, auditStub());
    const { group } = await svc.createGroup("org-1", "u-1", { name: "G1" });
    const out = await svc.bulkPercentOff("org-1", "u-1", group.id, { percentOff: 10 });
    // ACTIVE products of org-1: p-1 + p-2 (draft + foreign excluded).
    expect(out.written).toBe(2);
    const view = await svc.getPriceList("org-1", group.id);
    const p1 = view.items.find((i: any) => i.productId === "p-1");
    // floor(10001 × 90 / 100) = floor(9000.9) = 9000.
    expect(p1.priceMinor).toBe("9000");
    const p2 = view.items.find((i: any) => i.productId === "p-2");
    expect(p2.priceMinor).toBe("18000");
    // Explicit subset overwrites just those rows.
    const out2 = await svc.bulkPercentOff("org-1", "u-1", group.id, { percentOff: 50, productIds: ["p-2"] });
    expect(out2.written).toBe(1);
    const view2 = await svc.getPriceList("org-1", group.id);
    expect(view2.items.find((i: any) => i.productId === "p-2").priceMinor).toBe("10000");
    expect(view2.items.find((i: any) => i.productId === "p-1").priceMinor).toBe("9000");
    await expect(svc.bulkPercentOff("org-1", "u-1", group.id, { percentOff: 0 })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.bulkPercentOff("org-1", "u-1", group.id, { percentOff: 100 })).rejects.toBeInstanceOf(ApiException);
  });

  it("priceMapForCustomer: no group ⇒ null; group without list ⇒ null; with list ⇒ variant beats product-level via pick", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const svc = new PriceListsService(prisma, auditStub());
    prisma.customer.rows.push(
      { id: "cust-plain", organizationId: "org-1", groupId: null, firstName: "P" },
      { id: "cust-g", organizationId: "org-1", groupId: null, firstName: "G" },
    );
    expect(await svc.priceMapForCustomer("org-1", "cust-plain")).toBeNull();
    expect(await svc.priceMapForCustomer("org-1", null)).toBeNull();
    const { group } = await svc.createGroup("org-1", "u-1", { name: "G1" });
    prisma.customer.rows.find((c: any) => c.id === "cust-g").groupId = group.id;
    expect(await svc.priceMapForCustomer("org-1", "cust-g")).toBeNull();
    await svc.setItem("org-1", "u-1", group.id, { productId: "p-1", priceMinor: "8000" });
    await svc.setItem("org-1", "u-1", group.id, { productId: "p-1", variantId: "v-1", priceMinor: "7500" });
    const map = await svc.priceMapForCustomer("org-1", "cust-g");
    expect(map).not.toBeNull();
    expect(pickGroupPrice(map, "p-1", "v-1")).toBe(7500n);
    expect(pickGroupPrice(map, "p-1", null)).toBe(8000n);
  });

  it("deleteGroup nulls members and removes the group + its list", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const svc = new PriceListsService(prisma, auditStub());
    const { group } = await svc.createGroup("org-1", "u-1", { name: "G1" });
    prisma.customer.rows.push({ id: "cust-1", organizationId: "org-1", groupId: group.id, firstName: "A" });
    await svc.setItem("org-1", "u-1", group.id, { productId: "p-1", priceMinor: "8000" });
    await svc.deleteGroup("org-1", "u-1", group.id);
    expect(prisma.customer.rows[0].groupId).toBeNull();
    expect(prisma.customerGroup.rows).toHaveLength(0);
    expect(prisma.priceList.rows).toHaveLength(0);
    expect(prisma.priceListItem.rows).toHaveLength(0);
  });
});

// ----------------------------------------------------------------
// POS-level application: list price replaces catalog (and the
// variant row wins); gift-card lines keep face value.
// ----------------------------------------------------------------

describe("AX7 POS — group price at line-build", () => {
  function setupPos() {
    const prisma = makePrisma();
    prisma.product.rows.push(
      { id: "p1", organizationId: "org-1", name: "চাল ৫ কেজি", sku: "RICE-5", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, stockQuantity: 10, categoryId: null, preorderEnabled: false, isGiftCard: false },
      { id: "p-gc", organizationId: "org-1", name: "গিফট কার্ড", sku: "GC-1", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, stockQuantity: null, categoryId: null, preorderEnabled: false, isGiftCard: true },
    );
    prisma.productVariant.rows.push(
      { id: "v1", productId: "p1", name: "বড়", sku: "RICE-5-L", priceMinor: 60000n, stockQuantity: 5 },
    );
    prisma.organization.rows.push({ id: "org-1", name: "টেস্ট দোকান", brandName: null });
    prisma.customer.rows.push({ id: "cust-1", organizationId: "org-1", groupId: "g-1", phone: "01711000001", firstName: "Rahim", creditTermsDays: 0 });
    prisma.customerGroup.rows.push({ id: "g-1", organizationId: "org-1", name: "পাইকারি" });
    prisma.priceList.rows.push({ id: "pl-1", organizationId: "org-1", groupId: "g-1" });
    prisma.priceListItem.rows.push(
      { id: "pli-1", priceListId: "pl-1", productId: "p1", variantId: null, priceMinor: 40000n },
      { id: "pli-2", priceListId: "pl-1", productId: "p1", variantId: "v1", priceMinor: 55000n },
      { id: "pli-3", priceListId: "pl-1", productId: "p-gc", variantId: null, priceMinor: 1000n },
    );
    const audit = auditStub();
    const priceLists = new PriceListsService(prisma, audit);
    const integrations: any = {
      upsertOrder: jest.fn(async (orgId: string, _s: any, payload: any, source: string) => {
        const row = {
          id: `ord-${prisma.order.rows.length + 1}`, organizationId: orgId, source,
          externalId: payload.externalId, externalNumber: payload.externalNumber,
          status: payload.status, totalMinor: payload.totalMinor, customerId: "cust-1",
          createdAt: new Date(), items: [],
        };
        prisma.order.rows.push(row);
        return "created";
      }),
    };
    const ordersService: any = {
      updateOrder: jest.fn(async (_o: string, _a: string, orderId: string, dto: any) => {
        const row = prisma.order.rows.find((r: any) => r.id === orderId);
        if (row && dto.status) row.status = dto.status;
        return { id: orderId };
      }),
      getOne: jest.fn(async (_o: string, orderId: string) => {
        const row = prisma.order.rows.find((r: any) => r.id === orderId);
        const total = BigInt(row?.totalMinor ?? 0);
        return { id: orderId, totalMinor: total.toString(), advancePaidMinor: "0", amountDueMinor: total.toString(), items: [] };
      }),
    };
    const promotions: any = {
      customerIdForPhone: jest.fn(async () => "cust-1"),
      priorOrderCountFor: jest.fn(async () => 0),
      evaluateCheckout: jest.fn(async (_orgId: string, input: any) => {
        const subtotal = input.lines.reduce((s: bigint, l: any) => s + l.unitPriceMinor * BigInt(l.quantity), 0n);
        return {
          subtotalMinor: subtotal, totalDiscountMinor: 0n, taxMinor: 0n, taxAddedMinor: 0n,
          appliedDiscountId: null, loyaltyPointsApplied: 0, loyaltyDiscountMinor: 0n,
          giftCardDiscountMinor: 0n, giftCardId: null,
        };
      }),
      stampOrder: jest.fn(async () => undefined),
    };
    const discounts: any = { redeem: jest.fn(async () => ({})) };
    const svc = new PosService(
      prisma, integrations, ordersService, promotions, discounts, audit,
      undefined, undefined, undefined, priceLists as any,
    );
    return { svc, prisma, integrations };
  }

  it("product-level list price replaces the catalog price and stamps priceListBreakdown", async () => {
    const { svc, integrations, prisma } = setupPos();
    await svc.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", quantity: 2 }],
      customerPhone: "01711000001",
      payment: { mode: "due" },
    } as any);
    const payload = integrations.upsertOrder.mock.calls[0][2];
    expect(payload.items[0].priceMinor).toBe(40000n);
    expect(payload.totalMinor).toBe(80000n);
    const order = prisma.order.rows[0];
    expect(order.priceListBreakdown).toEqual([{ productId: "p1", variantId: null, priceMinor: "40000" }]);
  });

  it("variant list row beats the product-level row (and the variant catalog price)", async () => {
    const { svc, integrations } = setupPos();
    await svc.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", variantId: "v1", quantity: 1 }],
      customerPhone: "01711000001",
      payment: { mode: "due" },
    } as any);
    const payload = integrations.upsertOrder.mock.calls[0][2];
    expect(payload.items[0].priceMinor).toBe(55000n);
  });

  it("gift-card lines keep face value even when a list row exists", async () => {
    const { svc, integrations, prisma } = setupPos();
    await svc.createSale("org-1", "staff-1", {
      items: [{ productId: "p-gc", quantity: 1 }],
      customerPhone: "01711000001",
      payment: { mode: "due" },
    } as any);
    const payload = integrations.upsertOrder.mock.calls[0][2];
    expect(payload.items[0].priceMinor).toBe(50000n);
    expect(prisma.order.rows[0].priceListBreakdown).toBeUndefined();
  });

  it("without the PriceListsService the sale is byte-identical (catalog price)", async () => {
    const { prisma, integrations } = setupPos();
    const promotions: any = {
      customerIdForPhone: jest.fn(async () => "cust-1"),
      priorOrderCountFor: jest.fn(async () => 0),
      evaluateCheckout: jest.fn(async (_o: string, input: any) => ({
        subtotalMinor: input.lines.reduce((s: bigint, l: any) => s + l.unitPriceMinor * BigInt(l.quantity), 0n),
        totalDiscountMinor: 0n, taxMinor: 0n, taxAddedMinor: 0n, appliedDiscountId: null,
        loyaltyPointsApplied: 0, loyaltyDiscountMinor: 0n, giftCardDiscountMinor: 0n, giftCardId: null,
      })),
      stampOrder: jest.fn(async () => undefined),
    };
    const ordersService: any = {
      updateOrder: jest.fn(async () => ({})),
      getOne: jest.fn(async (_o: string, orderId: string) => ({ id: orderId, totalMinor: "100000", advancePaidMinor: "0", amountDueMinor: "100000", items: [] })),
    };
    const svc2 = new PosService(prisma, integrations, ordersService, promotions, undefined, auditStub());
    integrations.upsertOrder.mockClear();
    await svc2.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", quantity: 2 }],
      customerPhone: "01711000001",
      payment: { mode: "due" },
    } as any);
    const payload = integrations.upsertOrder.mock.calls[0][2];
    expect(payload.items[0].priceMinor).toBe(50000n);
  });
});

// ----------------------------------------------------------------
// Quotes
// ----------------------------------------------------------------

describe("AX7 QuotesService", () => {
  function setupQuotes(opts: { email?: any; sms?: any } = {}) {
    const prisma = makePrisma();
    seedCatalog(prisma);
    prisma.organization.rows.push({ id: "org-1", name: "টেস্ট দোকান", brandName: "টেস্ট ব্র্যান্ড", logoUrl: "https://x/logo.png" });
    prisma.customer.rows.push(
      { id: "cust-1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin", phone: "01711000001", email: "rahim@example.com", groupId: null, creditTermsDays: 0 },
      { id: "cust-nophone", organizationId: "org-1", firstName: "No", lastName: "Phone", phone: null, email: null, groupId: null, creditTermsDays: 0 },
    );
    const audit = auditStub();
    const svc = new QuotesService(prisma, audit, opts.sms, opts.email);
    return { svc, prisma, audit };
  }

  const LINES = [
    { productId: "p-1", qty: 2, unitPriceMinor: "15000" },
    { productId: "p-2", variantId: undefined, qty: 1, unitPriceMinor: "20000" },
  ];

  it("quoteTotalMinor is Σ lines + delivery (no tax/promotion evaluation)", () => {
    expect(quoteTotalMinor([{ qty: 2, unitPriceMinor: "15000" }, { qty: 1, unitPriceMinor: "20000" }], 6000n)).toBe(56000n);
    expect(quoteTotalMinor([], 0n)).toBe(0n);
  });

  it("create snapshots names/sku, totals correctly, and numbers increment QT-00001, QT-00002", async () => {
    const { svc, audit } = setupQuotes();
    const a: any = await svc.createQuote("org-1", "u-1", {
      customerId: "cust-1", lines: LINES, deliveryChargeMinor: "6000",
    } as any);
    expect(a.quote.number).toBe("QT-00001");
    expect(a.quote.status).toBe("draft");
    // 2×15000 + 1×20000 + 6000 = 56000.
    expect(a.quote.totalMinor).toBe("56000");
    expect(a.quote.deliveryChargeMinor).toBe("6000");
    expect(a.quote.lines[0].name).toBe("শার্ট");
    expect(a.quote.lines[0].sku).toBe("SH-1");
    expect(a.quote.lines[0].lineTotalMinor).toBe("30000");
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "quote.created" }));
    const b: any = await svc.createQuote("org-1", "u-1", { walkinName: "Walk", walkinPhone: "01811000002", lines: LINES } as any);
    expect(b.quote.number).toBe("QT-00002");
  });

  it("create validates: foreign product, variant of another product, bad qty, no identity", async () => {
    const { svc } = setupQuotes();
    await expect(svc.createQuote("org-1", "u-1", { customerId: "cust-1", lines: [{ productId: "p-foreign", qty: 1, unitPriceMinor: "100" }] } as any)).rejects.toThrow(/পণ্য পাওয়া যায়নি/);
    await expect(svc.createQuote("org-1", "u-1", { customerId: "cust-1", lines: [{ productId: "p-1", variantId: "v-other", qty: 1, unitPriceMinor: "100" }] } as any)).rejects.toThrow(/ভ্যারিয়েন্টটি এই পণ্যের নয়/);
    await expect(svc.createQuote("org-1", "u-1", { customerId: "cust-1", lines: [{ productId: "p-1", qty: 0, unitPriceMinor: "100" }] } as any)).rejects.toBeInstanceOf(ApiException);
    await expect(svc.createQuote("org-1", "u-1", { customerId: "cust-1", lines: [{ productId: "p-1", qty: 1000, unitPriceMinor: "100" }] } as any)).rejects.toBeInstanceOf(ApiException);
    await expect(svc.createQuote("org-1", "u-1", { lines: LINES } as any)).rejects.toBeInstanceOf(ApiException);
    await expect(svc.createQuote("org-1", "u-1", { customerId: "cust-foreign", lines: LINES } as any)).rejects.toBeInstanceOf(ApiException);
  });

  it("send stores ONLY the sha256 hash, returns the link, prefers email, rotates on re-send", async () => {
    const email: any = { isConfigured: () => true, send: jest.fn(async () => ({ providerMessageId: "e-1" })) };
    const { svc, prisma, audit } = setupQuotes({ email });
    const { quote }: any = await svc.createQuote("org-1", "u-1", { customerId: "cust-1", lines: LINES } as any);
    const sent: any = await svc.sendQuote("org-1", "u-1", quote.id);
    expect(sent.sentVia).toBe("email");
    expect(email.send).toHaveBeenCalledTimes(1);
    const token = sent.link.split("/quote/")[1];
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const row = prisma.quote.rows.find((r: any) => r.id === quote.id);
    expect(row.publicTokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(row.publicTokenHash).not.toBe(token);
    expect(JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain(token);
    expect(row.status).toBe("sent");
    expect(row.sentVia).toBe("email");
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "quote.sent", metadata: { via: "email" } }));
    // Re-send rotates: a new token, a new hash, the old hash gone.
    const sent2: any = await svc.sendQuote("org-1", "u-1", quote.id);
    const token2 = sent2.link.split("/quote/")[1];
    expect(token2).not.toBe(token);
    expect(row.publicTokenHash).toBe(hashQuoteToken(token2));
    await expect(svc.getByToken(token)).rejects.toBeInstanceOf(ApiException);
  });

  it("send falls back to SMS (platform) when there is no email; sentVia none when nothing is configured", async () => {
    const sms: any = {
      isConfigured: () => true,
      send: jest.fn(async () => ({ providerMessageId: "s-1" })),
      sendWithGateway: jest.fn(async () => ({ providerMessageId: "s-2" })),
    };
    const { svc } = setupQuotes({ sms });
    const { quote }: any = await svc.createQuote("org-1", "u-1", {
      walkinName: "Walk In", walkinPhone: "01811000002", lines: LINES,
    } as any);
    const sent: any = await svc.sendQuote("org-1", "u-1", quote.id);
    expect(sent.sentVia).toBe("sms");
    expect(sms.send).toHaveBeenCalledTimes(1);

    const bare = setupQuotes();
    const { quote: q2 }: any = await bare.svc.createQuote("org-1", "u-1", {
      walkinName: "Walk In", walkinPhone: "01811000002", lines: LINES,
    } as any);
    const sent2: any = await bare.svc.sendQuote("org-1", "u-1", q2.id);
    expect(sent2.sentVia).toBe("none");
    // The link still comes back for manual sharing, status is sent.
    expect(sent2.link).toContain("/quote/");
    expect(sent2.quote.status).toBe("sent");
  });

  it("public payload is branded + minimal; respond transitions sent→accepted and is idempotent; draft refuses", async () => {
    const email: any = { isConfigured: () => true, send: jest.fn(async () => ({ providerMessageId: "e-1" })) };
    const { svc, prisma } = setupQuotes({ email });
    const { quote }: any = await svc.createQuote("org-1", "u-1", { customerId: "cust-1", lines: LINES, deliveryChargeMinor: "6000", note: "দ্রুত ডেলিভারি" } as any);
    // A draft quote with a hand-set token hash refuses respond.
    prisma.quote.rows.find((r: any) => r.id === quote.id).publicTokenHash = hashQuoteToken("draft-token");
    await expect(svc.publicRespond("draft-token", { accept: true })).rejects.toBeInstanceOf(ApiException);

    const sent: any = await svc.sendQuote("org-1", "u-1", quote.id);
    const token = sent.link.split("/quote/")[1];
    const pub: any = await svc.getByToken(token);
    expect(pub.number).toBe("QT-00001");
    expect(pub.shop.brandName).toBe("টেস্ট ব্র্যান্ড");
    expect(pub.totalMinor).toBe("56000");
    expect(pub.lines[0]).not.toHaveProperty("productId");
    expect(pub).not.toHaveProperty("customerId");
    expect(pub).not.toHaveProperty("createdById");
    const accepted: any = await svc.publicRespond(token, { accept: true });
    expect(accepted.status).toBe("accepted");
    expect(accepted.respondedAt).toBeTruthy();
    // Responding again returns the current state, no error.
    const again: any = await svc.publicRespond(token, { accept: false });
    expect(again.status).toBe("accepted");
  });

  it("lazy expiry: a sent quote past expiresAt reads as expired on staff get, list and public page", async () => {
    const email: any = { isConfigured: () => true, send: jest.fn(async () => ({ providerMessageId: "e-1" })) };
    const { svc, prisma } = setupQuotes({ email });
    const { quote }: any = await svc.createQuote("org-1", "u-1", { customerId: "cust-1", lines: LINES } as any);
    const sent: any = await svc.sendQuote("org-1", "u-1", quote.id);
    const token = sent.link.split("/quote/")[1];
    prisma.quote.rows.find((r: any) => r.id === quote.id).expiresAt = new Date(Date.now() - 1000);
    const pub: any = await svc.getByToken(token);
    expect(pub.status).toBe("expired");
    const staff: any = await svc.getQuote("org-1", quote.id);
    expect(staff.quote.status).toBe("expired");
    await expect(svc.publicRespond(token, { accept: true })).rejects.toBeInstanceOf(ApiException);
  });

  it("update is draft-only; cancel works from draft/sent only", async () => {
    const { svc } = setupQuotes();
    const { quote }: any = await svc.createQuote("org-1", "u-1", { customerId: "cust-1", lines: LINES } as any);
    const upd: any = await svc.updateQuote("org-1", "u-1", quote.id, { deliveryChargeMinor: "1000" } as any);
    expect(upd.quote.totalMinor).toBe("51000");
    const cancelled: any = await svc.cancelQuote("org-1", "u-1", quote.id);
    expect(cancelled.quote.status).toBe("cancelled");
    await expect(svc.updateQuote("org-1", "u-1", quote.id, { note: "x" } as any)).rejects.toBeInstanceOf(ApiException);
    await expect(svc.cancelQuote("org-1", "u-1", quote.id)).rejects.toBeInstanceOf(ApiException);
    await expect(svc.getQuote("org-2", quote.id)).rejects.toBeInstanceOf(ApiException);
  });
});

// ----------------------------------------------------------------
// Conversion — OrdersService.convertQuote composes the REAL
// QuotesService with createManual (m65-style fake integrations).
// ----------------------------------------------------------------

describe("AX7 quote conversion (orders side)", () => {
  function setupConversion() {
    const prisma = makePrisma();
    seedCatalog(prisma);
    prisma.organization.rows.push({ id: "org-1", name: "টেস্ট দোকান", brandName: null, logoUrl: null });
    prisma.customer.rows.push(
      { id: "cust-1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin", phone: "01711000001", email: null, groupId: null, creditTermsDays: 0 },
      { id: "cust-nophone", organizationId: "org-1", firstName: "No", lastName: "Phone", phone: null, email: null, groupId: null, creditTermsDays: 0 },
    );
    const audit = auditStub();
    const quotes = new QuotesService(prisma, audit);
    const savedOrders: any[] = [];
    const integrations: any = {
      upsertOrder: jest.fn(async (orgId: string, _s: any, o: any, source: string) => {
        const row = {
          id: `ord-${savedOrders.length + 1}`, organizationId: orgId, source,
          externalId: o.externalId, externalNumber: o.externalNumber ?? null,
          status: o.status, totalMinor: o.totalMinor, subtotalMinor: o.subtotalMinor,
          shippingMinor: o.shippingMinor, discountMinor: o.discountMinor, taxMinor: 0n,
          refundedMinor: 0n, items: (o.items ?? []).map((i: any, idx: number) => ({ id: `oi-${idx}`, ...i })),
          customer: { id: "cust-1", phone: o.customer.phone },
        };
        prisma.order.rows.push(row);
        savedOrders.push(row);
        return "created";
      }),
    };
    // OrdersService order.findFirst is served by the fake order
    // table (matchWhere on organizationId/source/externalId).
    const orders = new OrdersService(
      prisma, undefined, integrations, audit, undefined, undefined, undefined, undefined, undefined, quotes as any,
    );
    return { prisma, audit, quotes, orders, integrations, savedOrders };
  }

  const LINES = [{ productId: "p-1", qty: 2, unitPriceMinor: "15000" }];

  async function acceptedQuote(ctx: any, over: any = {}) {
    const { quote }: any = await ctx.quotes.createQuote("org-1", "u-1", {
      customerId: "cust-1", lines: LINES, deliveryChargeMinor: "6000", ...over,
    } as any);
    ctx.prisma.quote.rows.find((r: any) => r.id === quote.id).status = "accepted";
    return quote;
  }

  it("previewConversion matches the manual path's math and creates nothing", async () => {
    const ctx = setupConversion();
    const quote = await acceptedQuote(ctx);
    const preview = await ctx.quotes.previewConversion("org-1", quote.id);
    expect(preview).toEqual({
      quoteTotalMinor: "36000",
      orderSubtotalMinor: "30000",
      orderShippingMinor: "6000",
      orderTotalMinor: "36000",
      matchesQuoteTotal: true,
    });
    expect(ctx.integrations.upsertOrder).not.toHaveBeenCalled();
    expect(ctx.prisma.order.rows).toHaveLength(0);
  });

  it("convert creates the manual order at snapshot prices, stamps the quote, audits quoteId on the order", async () => {
    const ctx = setupConversion();
    const quote = await acceptedQuote(ctx);
    const out: any = await ctx.orders.convertQuote("org-1", "u-1", quote.id);
    expect(out.order.id).toBeTruthy();
    expect(out.order.totalMinor).toBe("36000");
    expect(out.quote.status).toBe("converted");
    expect(out.quote.convertedOrderId).toBe(out.order.id);
    const [, , normalized, source] = ctx.integrations.upsertOrder.mock.calls[0];
    expect(source).toBe("manual");
    expect(normalized.customer.phone).toBe("01711000001");
    expect(normalized.items[0].priceMinor).toBe(15000n);
    expect(normalized.shippingMinor).toBe(6000n);
    // The manual_created audit carries the conversion metadata…
    const manualAudit = ctx.audit.log.mock.calls.find((c: any[]) => c[0]?.action === "orders.manual_created");
    expect(manualAudit[0].metadata).toMatchObject({ quoteId: quote.id, source: "quote_conversion" });
    // …and quote.converted was audited with the order id.
    expect(ctx.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: "quote.converted", metadata: { orderId: out.order.id },
    }));
  });

  it("conversion refuses a non-accepted quote and a double conversion", async () => {
    const ctx = setupConversion();
    const { quote: draft }: any = await ctx.quotes.createQuote("org-1", "u-1", {
      customerId: "cust-1", lines: LINES,
    } as any);
    await expect(ctx.orders.convertQuote("org-1", "u-1", draft.id)).rejects.toThrow(/গৃহীত \(accepted\)/);
    const accepted = await acceptedQuote(ctx);
    await ctx.orders.convertQuote("org-1", "u-1", accepted.id);
    await expect(ctx.orders.convertQuote("org-1", "u-1", accepted.id)).rejects.toThrow(/ইতিমধ্যে অর্ডারে রূপান্তরিত/);
    expect(ctx.integrations.upsertOrder).toHaveBeenCalledTimes(1);
  });

  it("conversion refuses when the quote customer has no phone", async () => {
    const ctx = setupConversion();
    const { quote }: any = await ctx.quotes.createQuote("org-1", "u-1", {
      customerId: "cust-nophone", lines: LINES,
    } as any);
    ctx.prisma.quote.rows.find((r: any) => r.id === quote.id).status = "accepted";
    await expect(ctx.orders.convertQuote("org-1", "u-1", quote.id)).rejects.toThrow(/ফোন নম্বর নেই/);
    expect(ctx.integrations.upsertOrder).not.toHaveBeenCalled();
  });

  it("walk-in quote converts with the walk-in phone/name", async () => {
    const ctx = setupConversion();
    const { quote }: any = await ctx.quotes.createQuote("org-1", "u-1", {
      walkinName: "Walk In", walkinPhone: "01811000009", lines: LINES,
    } as any);
    ctx.prisma.quote.rows.find((r: any) => r.id === quote.id).status = "accepted";
    const out: any = await ctx.orders.convertQuote("org-1", "u-1", quote.id);
    const [, , normalized] = ctx.integrations.upsertOrder.mock.calls[0];
    expect(normalized.customer.phone).toBe("01811000009");
    expect(normalized.customer.firstName).toBe("Walk In");
    expect(out.quote.status).toBe("converted");
  });

  it("createManual WITHOUT quoteId audits byte-identical metadata (no quoteId/source keys)", async () => {
    const ctx = setupConversion();
    await ctx.orders.createManual("org-1", "u-1", {
      customerPhone: "01711000001", customerName: "Rahim",
      items: [{ name: "X", quantity: 1, unitPriceMinor: 100 }],
    } as any);
    const call = ctx.audit.log.mock.calls.find((c: any[]) => c[0]?.action === "orders.manual_created");
    expect(call[0].metadata).not.toHaveProperty("quoteId");
    expect(call[0].metadata).not.toHaveProperty("source");
  });
});

// ----------------------------------------------------------------
// Net terms — upsertOrder creditDueDate stamp (create branch only)
// ----------------------------------------------------------------

describe("AX7 IntegrationsService.upsertOrder — creditDueDate stamp", () => {
  function setupIntegrations() {
    const prisma = makePrisma();
    prisma.customer.rows.push(
      { id: "cust-terms", organizationId: "org-1", source: "manual", externalId: "t-1", firstName: "Terms", phone: "01711000001", creditTermsDays: 14 },
      { id: "cust-zero", organizationId: "org-1", source: "manual", externalId: "z-1", firstName: "Zero", phone: "01711000002", creditTermsDays: 0 },
    );
    const audit = auditStub();
    const svc = new IntegrationsService(prisma, audit);
    return { svc, prisma };
  }

  const placed = new Date("2026-10-01T10:00:00Z");
  const payloadFor = (customerId: string, over: any = {}): any => ({
    externalId: `ext-${customerId}-1`, externalNumber: "1001", status: "processing",
    paymentMethod: "cod", isCod: true, currency: "BDT",
    subtotalMinor: 100000n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n,
    totalMinor: 100000n, refundedMinor: 0n, placedAt: placed,
    customerId, customer: { externalId: "x", firstName: "A" },
    items: [{ name: "P", quantity: 1, priceMinor: 100000n, totalMinor: 100000n }],
    ...over,
  });

  it("create with terms 14 stamps placedAt + 14 days", async () => {
    const { svc, prisma } = setupIntegrations();
    const res = await svc.upsertOrder("org-1", null, payloadFor("cust-terms"), "manual");
    expect(res).toBe("created");
    const order = prisma.order.rows[0];
    expect(order.creditDueDate).toBeInstanceOf(Date);
    expect(order.creditDueDate.getTime()).toBe(placed.getTime() + 14 * 86400000);
  });

  it("terms 0 ⇒ no stamp; cancelled status ⇒ no stamp; zero total ⇒ no stamp", async () => {
    const { svc, prisma } = setupIntegrations();
    await svc.upsertOrder("org-1", null, payloadFor("cust-zero"), "manual");
    expect(prisma.order.rows[0].creditDueDate).toBeUndefined();
    await svc.upsertOrder("org-1", null, payloadFor("cust-terms", { externalId: "ext-c-2", status: "cancelled" }), "manual");
    expect(prisma.order.rows[1].creditDueDate).toBeUndefined();
    await svc.upsertOrder("org-1", null, payloadFor("cust-terms", { externalId: "ext-c-3", totalMinor: 0n, subtotalMinor: 0n }), "manual");
    expect(prisma.order.rows[2].creditDueDate).toBeUndefined();
  });

  it("the UPDATE branch never stamps or rewrites the due date (snapshot rule)", async () => {
    const { svc, prisma } = setupIntegrations();
    await svc.upsertOrder("org-1", null, payloadFor("cust-terms"), "manual");
    const original = prisma.order.rows[0].creditDueDate.getTime();
    // Terms change afterwards; an update to the same order must
    // NOT move the snapshot.
    prisma.customer.rows.find((c: any) => c.id === "cust-terms").creditTermsDays = 30;
    const res = await svc.upsertOrder("org-1", null, payloadFor("cust-terms", { status: "completed" }), "manual");
    expect(res).toBe("updated");
    expect(prisma.order.rows).toHaveLength(1);
    expect(prisma.order.rows[0].creditDueDate.getTime()).toBe(original);
  });
});

// ----------------------------------------------------------------
// Khata — overdue flag math + creditTermsDays + overdueOnly
// ----------------------------------------------------------------

describe("AX7 CustomersService.getKhata — overdue", () => {
  function setupKhata() {
    const prisma = makePrisma();
    prisma.customer.rows.push({
      id: "cust-1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin",
      phone: "01711000001", email: null, creditLimitMinor: null, creditTermsDays: 14, mergedIntoId: null,
    });
    const todayStart = dhakaDayStartUtc(new Date());
    const mk = (id: string, over: any = {}) => ({
      id, organizationId: "org-1", customerId: "cust-1", source: "manual",
      externalId: id, externalNumber: id, status: "processing", isPractice: false,
      totalMinor: 100000n, placedAt: new Date(Date.now() - 20 * 86400000), createdAt: new Date(),
      creditDueDate: null, ...over,
    });
    prisma.order.rows.push(
      // Past due date (just before today's Dhaka start), unpaid ⇒ overdue.
      mk("ord-overdue", { creditDueDate: new Date(todayStart.getTime() - 1000) }),
      // Fully paid (approved PV covers the total) ⇒ never overdue.
      mk("ord-paid", { creditDueDate: new Date(todayStart.getTime() - 1000) }),
      // Due date is TODAY (Dhaka) ⇒ not yet overdue.
      mk("ord-today", { creditDueDate: new Date(todayStart.getTime() + 3600000) }),
      // No due date at all ⇒ not overdue.
      mk("ord-nodate", {}),
    );
    prisma.paymentVerification.rows.push({
      id: "pv-1", organizationId: "org-1", orderId: "ord-paid", status: "approved", amountMinor: 100000n,
    });
    const svc = new CustomersService(prisma, auditStub());
    return { svc, prisma };
  }

  it("flags overdue only when due > 0 AND creditDueDate is before Dhaka today-start; carries creditTermsDays", async () => {
    const { svc } = setupKhata();
    const out: any = await svc.getKhata("org-1", "cust-1");
    expect(out.creditTermsDays).toBe(14);
    const byId = new Map<string, any>(out.orders.map((o: any) => [o.id, o]));
    expect(byId.get("ord-overdue").overdue).toBe(true);
    expect(byId.get("ord-overdue").creditDueDate).toBeTruthy();
    expect(byId.get("ord-paid").overdue).toBe(false);
    expect(byId.get("ord-paid").dueMinor).toBe("0");
    expect(byId.get("ord-today").overdue).toBe(false);
    expect(byId.get("ord-nodate").overdue).toBe(false);
    expect(byId.get("ord-nodate").creditDueDate).toBeNull();
  });

  it("overdueOnly narrows the page orders to overdue ones; totals stay whole", async () => {
    const { svc } = setupKhata();
    const out: any = await svc.getKhata("org-1", "cust-1", { overdueOnly: true });
    expect(out.orders.map((o: any) => o.id)).toEqual(["ord-overdue"]);
    // Total open due still counts every unpaid order (3 × 100000).
    expect(out.totalDueMinor).toBe("300000");
  });
});

// ----------------------------------------------------------------
// Customer update — groupId / creditTermsDays validation
// ----------------------------------------------------------------

describe("AX7 CustomersService.update — groupId + creditTermsDays", () => {
  it("accepts an org group + terms; refuses a foreign group and out-of-range terms; null clears the group", async () => {
    const prisma = makePrisma();
    prisma.customer.rows.push({
      id: "cust-1", organizationId: "org-1", firstName: "Rahim", phone: "01711000001",
      email: null, creditLimitMinor: null, creditTermsDays: 0, groupId: null, mergedIntoId: null, customFields: null,
    });
    prisma.customerGroup.rows.push(
      { id: "g-1", organizationId: "org-1", name: "পাইকারি" },
      { id: "g-foreign", organizationId: "org-2", name: "অন্যের" },
    );
    // detail() reads these tables after the update.
    const svc = new CustomersService(prisma, auditStub());
    const out: any = await svc.update("org-1", "u-1", "cust-1", { groupId: "g-1", creditTermsDays: 30 });
    expect(out.customer.groupId).toBe("g-1");
    expect(out.customer.creditTermsDays).toBe(30);
    await expect(svc.update("org-1", "u-1", "cust-1", { groupId: "g-foreign" })).rejects.toThrow(/কাস্টমার গ্রুপটি পাওয়া যায়নি/);
    await expect(svc.update("org-1", "u-1", "cust-1", { creditTermsDays: 91 })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.update("org-1", "u-1", "cust-1", { creditTermsDays: -1 })).rejects.toBeInstanceOf(ApiException);
    const cleared: any = await svc.update("org-1", "u-1", "cust-1", { groupId: null });
    expect(cleared.customer.groupId).toBeNull();
  });
});
