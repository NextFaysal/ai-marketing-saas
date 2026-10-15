import "reflect-metadata";
import { parseBdAddress } from "./bd-address";
import { computeIntakeWarnings } from "./intake-warnings";
import { OrdersService } from "./orders.service";
import { ProductsService } from "../products/products.service";
import { LandingsService } from "../landings/landings.service";
import { StorefrontService } from "../storefront/storefront.service";

/**
 * ON11 — Intake Quality: BD address parser, intake warnings,
 * the two new queues, ready_to_pack hold exclusion, the
 * listV2 riskBand filter, and the three checkout blocklist
 * refusals (generic Bengali message; upsertOrder never called).
 */

// ---------- parseBdAddress ----------

describe("ON11 parseBdAddress", () => {
  it("Dhaka thana + district → Dhaka / Mirpur / high", () => {
    const r = parseBdAddress("বাসা ৫, রোড ২, মিরপুর, ঢাকা");
    expect(r.district).toBe("Dhaka");
    expect(r.thana).toBe("Mirpur");
    expect(r.confidence).toBe("high");
    expect(r.matchedTerms).toContain("ঢাকা");
    expect(r.matchedTerms).toContain("মিরপুর");
  });

  it("Bengali district name alone → canonical English, medium", () => {
    const r = parseBdAddress("খুলনা");
    expect(r.district).toBe("Khulna");
    expect(r.thana).toBeNull();
    expect(r.confidence).toBe("medium");
  });

  it("explicit জেলা marker → high", () => {
    const r = parseBdAddress("বাসা ১, বোয়ালিয়া, জেলা: রাজশাহী");
    expect(r.district).toBe("Rajshahi");
    expect(r.confidence).toBe("high");
    expect(r.thana).toBe("Boalia");
  });

  it("thana-only inference → medium (Sonadanga → Khulna)", () => {
    const bn = parseBdAddress("ঠিকানা: সোনাডাঙ্গা");
    expect(bn.district).toBe("Khulna");
    expect(bn.thana).toBe("Sonadanga");
    expect(bn.confidence).toBe("medium");
    const en = parseBdAddress("House 10, Sonadanga");
    expect(en.district).toBe("Khulna");
    expect(en.confidence).toBe("medium");
  });

  it("English variants resolve (Chittagong → Chattogram, Jessore → Jashore)", () => {
    expect(parseBdAddress("Chittagong").district).toBe("Chattogram");
    expect(parseBdAddress("Jessore Sadar").district).toBe("Jashore");
    expect(parseBdAddress("Comilla").district).toBe("Cumilla");
  });

  it("unknown text → low + null district", () => {
    const r = parseBdAddress("কোনো এক অজানা গ্রাম");
    expect(r).toMatchObject({ district: null, thana: null, confidence: "low" });
    expect(parseBdAddress("").confidence).toBe("low");
    expect(parseBdAddress(null).district).toBeNull();
  });

  it("two conflicting districts with no tiebreak → low + null", () => {
    const r = parseBdAddress("ঢাকা থেকে খুলনা পাঠাতে হবে");
    expect(r.district).toBeNull();
    expect(r.confidence).toBe("low");
    expect(r.matchedTerms).toContain("ঢাকা");
    expect(r.matchedTerms).toContain("খুলনা");
  });

  it("short English terms need a word boundary (Fenimore ≠ Feni)", () => {
    const r = parseBdAddress("Fenimore Road, Somewhere");
    expect(r.district).toBeNull();
    expect(r.confidence).toBe("low");
    expect(parseBdAddress("Feni").district).toBe("Feni");
  });
});

// ---------- computeIntakeWarnings ----------

describe("ON11 computeIntakeWarnings", () => {
  const noBlock = { isBlocked: jest.fn(async () => false) };
  const emptyPrisma: any = { customer: { findMany: jest.fn(async () => []) } };

  it("invalid_phone fires for a malformed number", async () => {
    const r = await computeIntakeWarnings(emptyPrisma, noBlock, "org-1", {
      phone: "12345", addressText: "মিরপুর, ঢাকা",
    });
    expect(r.warnings.map((w) => w.key)).toContain("invalid_phone");
  });

  it("phone_blocked fires when the blocklist says so", async () => {
    const blocked = { isBlocked: jest.fn(async () => true) };
    const r = await computeIntakeWarnings(emptyPrisma, blocked, "org-1", {
      phone: "01711111111", addressText: "মিরপুর, ঢাকা",
    });
    expect(r.warnings.map((w) => w.key)).toContain("phone_blocked");
  });

  it("duplicate_customer_phone fires when the same number carries a different name", async () => {
    const prisma: any = {
      customer: {
        findMany: jest.fn(async () => [
          { id: "c-9", phone: "+8801711111111", firstName: "Karim", lastName: "Sheikh" },
        ]),
      },
    };
    const r = await computeIntakeWarnings(prisma, noBlock, "org-1", {
      phone: "01711111111", name: "Rahim Uddin", addressText: "মিরপুর, ঢাকা",
    });
    const w = r.warnings.find((x) => x.key === "duplicate_customer_phone");
    expect(w).toBeTruthy();
    expect(w!.label).toContain("Karim Sheikh");
  });

  it("missing_address_parts fires and no suggestion is offered when nothing parses", async () => {
    const r = await computeIntakeWarnings(emptyPrisma, noBlock, "org-1", {
      phone: "01711111111", addressText: "অজানা জায়গা",
    });
    expect(r.warnings.map((w) => w.key)).toContain("missing_address_parts");
    expect(r.addressSuggestion).toBeNull();
  });

  it("addressSuggestion is offered for a confident parse with no district supplied — and suppressed when one is", async () => {
    const r = await computeIntakeWarnings(emptyPrisma, noBlock, "org-1", {
      phone: "01711111111", addressText: "বাসা ১, মিরপুর, ঢাকা",
    });
    expect(r.addressSuggestion).toEqual({ district: "Dhaka", thana: "Mirpur", confidence: "high" });
    expect(r.warnings.map((w) => w.key)).not.toContain("missing_address_parts");

    const withDistrict = await computeIntakeWarnings(emptyPrisma, noBlock, "org-1", {
      phone: "01711111111", addressText: "বাসা ১, মিরপুর, ঢাকা", customerDistrict: "Dhaka",
    });
    expect(withDistrict.addressSuggestion).toBeNull();
  });

  it("warnings never throw — a failing blocklist check degrades silently", async () => {
    const throwing = { isBlocked: jest.fn(async () => { throw new Error("db down"); }) };
    const r = await computeIntakeWarnings({}, throwing, "org-1", {
      phone: "01711111111", addressText: "মিরপুর, ঢাকা",
    });
    expect(Array.isArray(r.warnings)).toBe(true);
    expect(r.warnings.map((w) => w.key)).not.toContain("phone_blocked");
  });
});

// ---------- queues + riskBand (fake prisma, on1 style) ----------

function matchWhere(row: any, where: any): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    const val = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c: any = cond;
      if ("in" in c && !c.in.map(String).includes(String(val))) return false;
      if ("notIn" in c && c.notIn.map(String).includes(String(val))) return false;
      if ("not" in c && String(val) === String(c.not)) return false;
      continue;
    }
    if (String(val) !== String(cond)) return false;
  }
  return true;
}

function queueWorld() {
  const completeCustomer = (phone: string) => ({
    phone, firstName: "Rahim", lastName: "Uddin",
    address: { address_1: "House, Mirpur", district: "Dhaka" },
  });
  const base = {
    organizationId: "org-1", isPractice: false, isCod: false, codConfirmationStatus: null,
    subtotalMinor: 0n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, refundedMinor: 0n,
    totalMinor: 1000n, items: [] as any[],
  };
  const orders: any[] = [
    { ...base, id: "o-held", status: "processing", reviewHold: true, riskBand: "high", placedAt: new Date("2026-10-10T10:00:00Z"), createdAt: new Date("2026-10-10T10:00:00Z"), address: "House 1, Mirpur, Dhaka", customer: completeCustomer("01711111111"), items: [{ id: "oi-h", quantity: 1 }] },
    { ...base, id: "o-ready", status: "processing", reviewHold: false, riskBand: "low", placedAt: new Date("2026-10-09T10:00:00Z"), createdAt: new Date("2026-10-09T10:00:00Z"), address: "House 2, Mirpur, Dhaka", customer: completeCustomer("01811111111"), items: [{ id: "oi-r", quantity: 1 }] },
    { ...base, id: "o-nophone", status: "pending", placedAt: new Date("2026-10-08T10:00:00Z"), createdAt: new Date("2026-10-08T10:00:00Z"), address: "Mirpur, Dhaka", customer: { phone: null, firstName: "X", address: { address_1: "Mirpur", district: "Dhaka" } } },
    { ...base, id: "o-noaddr", status: "pending", placedAt: new Date("2026-10-07T10:00:00Z"), createdAt: new Date("2026-10-07T10:00:00Z"), address: null, customer: { phone: "01711111111", firstName: "X", address: null } },
    { ...base, id: "o-nodistrict", status: "pending", placedAt: new Date("2026-10-06T10:00:00Z"), createdAt: new Date("2026-10-06T10:00:00Z"), address: "অজানা জায়গা ১২৩", customer: { phone: "01711111111", firstName: "X", address: { address_1: "অজানা জায়গা ১২৩" } } },
    { ...base, id: "o-complete", status: "pending", placedAt: new Date("2026-10-05T10:00:00Z"), createdAt: new Date("2026-10-05T10:00:00Z"), address: "House, Mirpur, Dhaka", customer: completeCustomer("01711111111") },
    { ...base, id: "o-held-done", status: "completed", reviewHold: true, placedAt: new Date("2026-10-04T10:00:00Z"), createdAt: new Date("2026-10-04T10:00:00Z"), address: "House, Dhaka", customer: completeCustomer("01711111111") },
  ];
  const table = (rows: any[]) => ({
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where))),
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length),
  });
  const prisma: any = {
    order: {
      ...table(orders),
      findMany: jest.fn(async (args: any = {}) => {
        let rows = orders.filter((r) => matchWhere(r, args.where));
        if (args.skip) rows = rows.slice(args.skip);
        if (args.take) rows = rows.slice(0, args.take);
        return rows;
      }),
    },
    courierShipment: table([]),
    fulfillment: table([]),
    returnRequest: table([]),
    paymentVerification: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
    $queryRaw: jest.fn(async () => []),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new OrdersService(prisma, undefined, undefined, audit as any);
  return { svc, prisma };
}

describe("ON11 queues", () => {
  it("review_hold resolves only open held orders; count == list", async () => {
    const { svc } = queueWorld();
    const ids = await svc.resolveQueueOrderIds("org-1", "review_hold");
    expect(ids).toEqual(["o-held"]);
    const list = await svc.list("org-1", { queue: "review_hold", pageSize: 100 });
    expect(list.total).toBe(ids.length);
    expect(list.items.map((i: any) => i.id)).toEqual(ids);
  });

  it("incomplete_intake resolves phone/address/district gaps only; count == list", async () => {
    const { svc } = queueWorld();
    const ids = await svc.resolveQueueOrderIds("org-1", "incomplete_intake");
    expect([...ids].sort()).toEqual(["o-noaddr", "o-nodistrict", "o-nophone"]);
    const list = await svc.list("org-1", { queue: "incomplete_intake", pageSize: 100 });
    expect(list.total).toBe(3);
    expect(list.items.map((i: any) => i.id).sort()).toEqual([...ids].sort());
  });

  it("ready_to_pack EXCLUDES a review-held order", async () => {
    const { svc } = queueWorld();
    const ids = await svc.resolveQueueOrderIds("org-1", "ready_to_pack");
    expect(ids).toContain("o-ready");
    expect(ids).not.toContain("o-held");
  });

  it("queueCounts includes the two new queues with labels", async () => {
    const { svc } = queueWorld();
    const counts = await svc.queueCounts("org-1");
    expect(counts.find((c) => c.key === "review_hold")).toMatchObject({ label: "পর্যালোচনার জন্য আটকানো", count: 1 });
    expect(counts.find((c) => c.key === "incomplete_intake")).toMatchObject({ label: "তথ্য অসম্পূর্ণ অর্ডার", count: 3 });
  });
});

describe("ON4 listV2 riskBand filter", () => {
  it("filters by the persisted band; a bogus band is a Bengali 400", async () => {
    const { svc } = queueWorld();
    const high = await svc.list("org-1", { riskBand: "high", pageSize: 100 });
    expect(high.total).toBe(1);
    expect(high.items[0].id).toBe("o-held");
    const low = await svc.list("org-1", { riskBand: "low", pageSize: 100 });
    expect(low.items.map((i: any) => i.id)).toEqual(["o-ready"]);
    await expect(svc.list("org-1", { riskBand: "bogus" })).rejects.toThrow(/riskBand/);
  });
});

// ---------- checkout refusals ----------

const GENERIC_REFUSAL = "দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না";
const blockedStub = (blocked: boolean) => ({ isBlocked: jest.fn(async () => blocked) });
const auditStub: any = { log: jest.fn(async () => undefined) };

describe("ON4 checkout refusal — single-product (ProductsService)", () => {
  function world(blocked: boolean) {
    const productRow = {
      id: "p-1", slug: "prod-one", name: "পণ্য", sku: "P-1", status: "ACTIVE",
      priceMinor: 100000n, compareAtMinor: null, categoryId: null, currency: "BDT",
      stockQuantity: null, preorderEnabled: false, bumpTitle: null, bumpPriceMinor: null,
      variants: [],
      organization: {
        id: "org-1", name: "Shop One",
        businessProfile: { deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n },
      },
    };
    const prisma: any = { product: { findFirst: jest.fn(async () => productRow) } };
    const integrations: any = { upsertOrder: jest.fn(async () => "created") };
    const svc = new ProductsService(
      prisma, auditStub, undefined, integrations, undefined, undefined, undefined, undefined,
      blockedStub(blocked) as any,
    );
    return { svc, integrations };
  }
  const dto: any = {
    customerName: "Buyer", customerPhone: "01711111111",
    customerAddress: "Dhaka address", quantity: 1, deliveryZone: "inside_dhaka",
  };
  it("blocked phone → generic refusal, upsertOrder NOT called", async () => {
    const { svc, integrations } = world(true);
    await expect(svc.placePublicOrder("prod-one", dto)).rejects.toThrow(GENERIC_REFUSAL);
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
  });
  it("clean phone → order placed", async () => {
    const { svc, integrations } = world(false);
    await svc.placePublicOrder("prod-one", dto);
    expect(integrations.upsertOrder).toHaveBeenCalledTimes(1);
  });
});

describe("ON4 checkout refusal — landing (LandingsService)", () => {
  function world(blocked: boolean) {
    const orderRows: any[] = [];
    let seq = 0;
    const prisma: any = {
      landingPage: { findFirst: jest.fn(async () => ({ id: "land-1", organizationId: "org-1", productId: "p-a", slug: "wallet-offer", status: "published", upsellProductId: null })) },
      product: { findFirst: jest.fn(async () => ({ id: "p-a", organizationId: "org-1", name: "ওয়ালেট", sku: "WAL-1", status: "ACTIVE", priceMinor: 50000n, currency: "BDT", preorderEnabled: false, bumpTitle: null, bumpPriceMinor: null, digital: false })) },
      shippingZone: { findMany: jest.fn(async () => []) },
      businessProfile: { findFirst: jest.fn(async () => ({ deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n })) },
      landingVariant: { findFirst: jest.fn(async () => null) },
      order: {
        create: jest.fn(async ({ data }: any) => { const row = { id: `order-${++seq}`, ...data }; orderRows.push(row); return row; }),
        findFirst: jest.fn(async ({ where }: any) => orderRows.find((r) => r.organizationId === where.organizationId && r.source === where.source && r.externalId === where.externalId) ?? null),
        update: jest.fn(async ({ where, data }: any) => { const row = orderRows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; }),
      },
    };
    const integrations: any = {
      upsertOrder: jest.fn(async (orgId: string, _s: any, o: any, source: string) => {
        await prisma.order.create({
          data: { organizationId: orgId, source, externalId: o.externalId, externalNumber: o.externalNumber, status: o.status, totalMinor: o.totalMinor },
        });
        return "created";
      }),
    };
    const svc = new LandingsService(
      prisma, auditStub, undefined, undefined, integrations, undefined, null,
      undefined, undefined, blockedStub(blocked) as any,
    );
    return { svc, integrations };
  }
  const dto: any = { customerName: "রহিম", customerPhone: "01711111111", customerAddress: "বাসা ১, ঢাকা" };
  it("blocked phone → generic refusal, upsertOrder NOT called", async () => {
    const { svc, integrations } = world(true);
    await expect(svc.placeOrder("wallet-offer", dto)).rejects.toThrow(GENERIC_REFUSAL);
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
  });
  it("clean phone → order placed", async () => {
    const { svc, integrations } = world(false);
    const res: any = await svc.placeOrder("wallet-offer", dto);
    expect(res.success).toBe(true);
    expect(integrations.upsertOrder).toHaveBeenCalledTimes(1);
  });
});

describe("ON4 checkout refusal — storefront (StorefrontService, ec18-style world)", () => {
  function sfMatch(row: any, where: any): boolean {
    for (const [k, v] of Object.entries(where ?? {})) {
      if (v === undefined) continue;
      if (k === "OR") { if (!(v as any[]).some((sub) => sfMatch(row, sub))) return false; continue; }
      if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
        const c: any = v;
        if ("in" in c) { if (!c.in.includes(row[k])) return false; continue; }
        if ("not" in c) { if (row[k] === c.not) return false; continue; }
        continue;
      }
      if (v === null) { if (row[k] !== null && row[k] !== undefined) return false; continue; }
      if (row[k] !== v) return false;
    }
    return true;
  }
  function sfTable() {
    const rows: any[] = [];
    let seq = 0;
    return {
      rows,
      findFirst: async ({ where }: any = {}) => rows.find((r) => sfMatch(r, where)) ?? null,
      findMany: async ({ where }: any = {}) => rows.filter((r) => sfMatch(r, where)),
      count: async ({ where }: any = {}) => rows.filter((r) => sfMatch(r, where)).length,
      create: async ({ data }: any) => { const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
      update: async ({ where, data }: any) => { const row = rows.find((r) => sfMatch(r, where)); if (!row) throw new Error("record not found"); Object.assign(row, data); return row; },
      delete: async ({ where }: any) => { const idx = rows.findIndex((r) => sfMatch(r, where)); if (idx < 0) throw new Error("record not found"); return rows.splice(idx, 1)[0]; },
    };
  }
  function world(blocked: boolean) {
    const prisma: any = {
      organization: sfTable(), storefrontSetting: sfTable(), businessProfile: sfTable(),
      category: sfTable(), product: sfTable(), productVariant: sfTable(), productImage: sfTable(),
      shippingZone: sfTable(), storeCart: sfTable(), storeCartItem: sfTable(),
      order: sfTable(), orderItem: sfTable(), fulfillment: sfTable(), deliverySlot: sfTable(),
      landingPage: sfTable(), landingVariant: sfTable(), landingEvent: sfTable(),
    };
    prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne", logoUrl: null, primaryColor: null, customDomain: null });
    prisma.storefrontSetting.rows.push({ id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: null });
    prisma.product.rows.push({
      id: "p-a", organizationId: "org-1", name: "ওয়ালেট", slug: "wallet", description: null, category: null,
      categoryId: null, sku: "WAL-1", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, currency: "BDT",
      stockQuantity: 10, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null,
      bumpImageUrl: null, createdAt: new Date(), updatedAt: new Date(),
    });
    prisma.shippingZone.rows.push({
      id: "z-all", organizationId: "org-1", name: "সব জায়গায়", kind: "all", districts: null,
      chargeMinor: 6000n, deliveryDays: 2, freeAboveMinor: null, active: true, position: 0,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const integrations: any = {
      upsertOrder: jest.fn(async (orgId: string, _s: any, o: any, source: string) => {
        await prisma.order.create({
          data: { organizationId: orgId, source, externalId: o.externalId, externalNumber: o.externalNumber, status: o.status, totalMinor: o.totalMinor },
        });
        return "created";
      }),
    };
    const svc = new StorefrontService(
      prisma, integrations, undefined, auditStub, undefined, undefined,
      undefined, undefined, undefined, undefined, blockedStub(blocked) as any,
    );
    return { svc, integrations, prisma };
  }
  async function checkoutWith(svc: StorefrontService) {
    const { cartToken } = await svc.createCart("shop-one");
    await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 1 });
    return svc.checkout("shop-one", {
      cartToken, name: "রহিম", phone: "01711111111", address: "বাড়ি ১, রোড ২", district: "ঢাকা",
    } as any);
  }
  it("blocked phone → generic refusal, upsertOrder NOT called", async () => {
    const { svc, integrations } = world(true);
    await expect(checkoutWith(svc)).rejects.toThrow(GENERIC_REFUSAL);
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
  });
  it("clean phone → order placed", async () => {
    const { svc, integrations } = world(false);
    await checkoutWith(svc);
    expect(integrations.upsertOrder).toHaveBeenCalledTimes(1);
  });
});
