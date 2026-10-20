import { ProposalsService } from "./proposals.service";
import { PROPOSAL_TOOL_CATALOG, PROPOSAL_TOOL_ROLES, ALLOWED_TOOLS } from "./planner";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "in" in (v as any)) return (v as any).in.includes(row[k]);
    return row[k] === v;
  });
}
function makeTable(seed: any[] = []) {
  const rows: any[] = [...seed];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, take }: any = {}) => { const out = rows.filter((r) => matches(r, where)); return take ? out.slice(0, take) : out; },
    create: async ({ data }: any) => { const row = { id: `row-${++seq}-${rows.length}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    updateMany: async ({ where, data }: any) => { const hit = rows.filter((r) => matches(r, where)); for (const r of hit) Object.assign(r, data); return { count: hit.length }; },
  };
}

const REAL_COPY = { description: "নরম সুতির পাঞ্জাবি, ঈদের জন্য উপযুক্ত।", seoTitle: "Panjabi | Shop", seoDescription: "সেরা পাঞ্জাবি কিনুন" };

function setup(opts: { llm?: "dev" | "real" | "none" } = {}) {
  const product = {
    id: "prod-1", organizationId: "org-1", name: "Panjabi", category: "Men",
    description: "old description", priceMinor: 150000n, compareAtMinor: 180000n,
    sku: "SKU-1", barcode: "880123", stockQuantity: 10,
  };
  const untracked = { ...product, id: "prod-untracked", name: "Untracked", stockQuantity: null };
  const foreign = { ...product, id: "prod-foreign", organizationId: "org-2", name: "Foreign" };
  const prisma: any = {
    product: makeTable([product, untracked, foreign]),
    productVariant: makeTable([{ id: "var-1", productId: "prod-1", name: "Size L", priceMinor: 150000n }]),
    store: makeTable([{ id: "store-1", organizationId: "org-1", name: "Woo Store" }]),
    storeListing: makeTable([
      { id: "list-1", organizationId: "org-1", storeId: "store-1", productId: "prod-1", publishState: "draft" },
      { id: "list-2", organizationId: "org-1", storeId: "store-1", productId: "prod-1", publishState: "published" },
      { id: "list-foreign", organizationId: "org-2", storeId: "store-1", productId: "prod-1", publishState: "draft" },
    ]),
    storeDiscount: makeTable([{ id: "disc-existing", organizationId: "org-1", code: "EXISTING", kind: "percent", value: 5 }]),
    aIActionProposal: makeTable(),
    aIAction: makeTable(),
  };
  const audit: any = { log: async () => undefined };

  const products: any = {
    update: jest.fn(async (_org: string, _actor: string, productId: string, dto: any) => {
      const priceMinor = dto.price ? String(Math.round(parseFloat(dto.price) * 100)) : "150000";
      return { id: productId, priceMinor };
    }),
  };
  const inventory: any = {
    adjust: jest.fn(async (_org: string, _actor: string, productId: string, input: any) => ({
      productId,
      stockQuantity: input.setTo !== undefined ? input.setTo : 10 + input.delta,
      movement: { id: "mov-1" },
    })),
  };
  const commerce: any = {
    publishListing: jest.fn(async (_org: string, _actor: string, listingId: string) => {
      const row = prisma.storeListing.rows.find((r: any) => r.id === listingId); if (row) row.publishState = "published"; return row;
    }),
    unpublishListing: jest.fn(async (_org: string, _actor: string, listingId: string) => {
      const row = prisma.storeListing.rows.find((r: any) => r.id === listingId); if (row) row.publishState = "draft"; return row;
    }),
  };
  const discounts: any = {
    create: jest.fn(async (_org: string, _actor: string, dto: any) => ({ discount: { id: "disc-1", code: dto.code }, pushes: [] })),
  };
  let llmFactory: any;
  if (opts.llm === "dev") {
    llmFactory = { getProvider: () => ({ name: "dev-template", isRealLlm: false, complete: jest.fn(async () => ({ text: "should not be used" })) }) };
  } else if (opts.llm === "real") {
    llmFactory = {
      getProvider: () => ({
        name: "openai", isRealLlm: true,
        complete: jest.fn(async () => ({ text: "```json\n" + JSON.stringify(REAL_COPY) + "\n```", model: "fake", inputTokens: 1, outputTokens: 1, tokensEstimated: false })),
      }),
    };
  }
  const svc = new ProposalsService(prisma, audit, undefined, undefined, products, inventory, commerce, discounts, llmFactory);
  return { svc, prisma, products, inventory, commerce, discounts, llmFactory };
}

describe("EC11 proposal tool registry (planner)", () => {
  it("proposal tools are NOT in the read-only ALLOWED_TOOLS, and roles map all six", () => {
    const names = PROPOSAL_TOOL_CATALOG.map((t) => t.name);
    expect(names).toEqual(["propose_price_change", "propose_stock_adjust", "propose_listing_publish", "propose_listing_unpublish", "propose_create_discount", "propose_product_copy"]);
    for (const n of names) {
      expect(ALLOWED_TOOLS).not.toContain(n);
      expect(PROPOSAL_TOOL_ROLES[n]).toEqual(["OWNER", "ADMIN", "MARKETING_MANAGER"]);
    }
    expect(PROPOSAL_TOOL_CATALOG.every((t) => t.module === "commerce")).toBe(true);
  });
});

describe("EC11 ProposalsService — price change", () => {
  it("proposing changes NOTHING; approval executes via products.update with before/after", async () => {
    const { svc, prisma, products } = setup();
    const row: any = await svc.propose("org-1", "user-1", { type: "propose_price_change", productId: "prod-1", newPrice: "2000.00" });
    expect(row.status).toBe("proposed");
    expect(row.preview).toContain("1500.00");
    expect(row.preview).toContain("2000.00");
    expect(row.preview).toContain("full-manage");
    expect(row.payload.newPriceMinor).toBe("200000");
    expect(row.payload.currentPriceMinor).toBe("150000");
    expect(products.update).not.toHaveBeenCalled();
    expect(prisma.product.rows.find((r: any) => r.id === "prod-1").priceMinor).toBe(150000n);

    const done: any = await svc.approve("org-1", "owner-1", row.id);
    expect(done.status).toBe("executed");
    expect(products.update).toHaveBeenCalledWith("org-1", "owner-1", "prod-1", { price: "2000.00" });
    expect(done.result.beforePriceMinor).toBe("150000");
    expect(done.result.afterPriceMinor).toBe("200000");
  });

  it("role floor: SUPPORT_AGENT approval is Forbidden and nothing executes; ADMIN works", async () => {
    const { svc, prisma, products } = setup();
    const row: any = await svc.propose("org-1", "user-1", { type: "propose_price_change", productId: "prod-1", newPrice: "2000.00" });
    await expect(svc.approve("org-1", "support-1", row.id, "SUPPORT_AGENT")).rejects.toThrow(/অনুমতি আপনার ভূমিকায় নেই/);
    expect(products.update).not.toHaveBeenCalled();
    expect(prisma.aIActionProposal.rows.find((r: any) => r.id === row.id).status).toBe("proposed");
    const done: any = await svc.approve("org-1", "admin-1", row.id, "ADMIN");
    expect(done.status).toBe("executed");
    expect(products.update).toHaveBeenCalledTimes(1);
  });

  it("invalid / non-positive prices are refused at propose time", async () => {
    const { svc } = setup();
    await expect(svc.propose("org-1", "u1", { type: "propose_price_change", productId: "prod-1", newPrice: "abc" })).rejects.toMatchObject({ code: "ai.invalidNewprice" });
    await expect(svc.propose("org-1", "u1", { type: "propose_price_change", productId: "prod-1", newPrice: "0" })).rejects.toThrow(/বেশি/);
  });
});

describe("EC11 ProposalsService — stock adjust", () => {
  it("set mode: propose + approve via inventory.adjust {setTo}", async () => {
    const { svc, inventory } = setup();
    const row: any = await svc.propose("org-1", "u1", { type: "propose_stock_adjust", productId: "prod-1", newQuantity: 25 });
    expect(row.payload.mode).toBe("set");
    expect(row.payload.resultingQuantity).toBe(25);
    expect(inventory.adjust).not.toHaveBeenCalled();
    const done: any = await svc.approve("org-1", "owner-1", row.id);
    expect(done.status).toBe("executed");
    expect(inventory.adjust).toHaveBeenCalledWith("org-1", "owner-1", "prod-1", { setTo: 25, reason: "ai_proposal" });
    expect(done.result.before).toBe(10);
    expect(done.result.after).toBe(25);
  });

  it("delta mode: propose + approve via inventory.adjust {delta}", async () => {
    const { svc, inventory } = setup();
    const row: any = await svc.propose("org-1", "u1", { type: "propose_stock_adjust", productId: "prod-1", delta: -3 });
    expect(row.payload.mode).toBe("delta");
    expect(row.payload.resultingQuantity).toBe(7);
    const done: any = await svc.approve("org-1", "owner-1", row.id);
    expect(done.status).toBe("executed");
    expect(inventory.adjust).toHaveBeenCalledWith("org-1", "owner-1", "prod-1", { delta: -3, reason: "ai_proposal" });
    expect(done.result.after).toBe(7);
  });

  it("both/neither of newQuantity/delta refused; untracked product refused", async () => {
    const { svc } = setup();
    await expect(svc.propose("org-1", "u1", { type: "propose_stock_adjust", productId: "prod-1", newQuantity: 5, delta: 1 })).rejects.toThrow(/ঠিক একটি/);
    await expect(svc.propose("org-1", "u1", { type: "propose_stock_adjust", productId: "prod-1" })).rejects.toThrow(/ঠিক একটি/);
    await expect(svc.propose("org-1", "u1", { type: "propose_stock_adjust", productId: "prod-untracked", newQuantity: 5 })).rejects.toThrow(/স্টক ট্র্যাক করা হচ্ছে না/);
    await expect(svc.propose("org-1", "u1", { type: "propose_stock_adjust", productId: "prod-1", delta: -99 })).rejects.toThrow(/ঋণাত্মক/);
  });
});

describe("EC11 ProposalsService — listing publish/unpublish", () => {
  it("publish: propose + approve via commerce.publishListing", async () => {
    const { svc, commerce } = setup();
    const row: any = await svc.propose("org-1", "u1", { type: "propose_listing_publish", listingId: "list-1" });
    expect(row.payload.storeName).toBe("Woo Store");
    expect(row.payload.productName).toBe("Panjabi");
    expect(commerce.publishListing).not.toHaveBeenCalled();
    const done: any = await svc.approve("org-1", "owner-1", row.id);
    expect(done.status).toBe("executed");
    expect(commerce.publishListing).toHaveBeenCalledWith("org-1", "owner-1", "list-1");
    expect(done.result.publishState).toBe("published");
  });

  it("unpublish: propose + approve via commerce.unpublishListing", async () => {
    const { svc, commerce } = setup();
    const row: any = await svc.propose("org-1", "u1", { type: "propose_listing_unpublish", listingId: "list-2" });
    const done: any = await svc.approve("org-1", "owner-1", row.id);
    expect(done.status).toBe("executed");
    expect(commerce.unpublishListing).toHaveBeenCalledWith("org-1", "owner-1", "list-2");
    expect(done.result.publishState).toBe("draft");
  });

  it("already-published publish and not-published unpublish are refused", async () => {
    const { svc } = setup();
    await expect(svc.propose("org-1", "u1", { type: "propose_listing_publish", listingId: "list-2" })).rejects.toThrow(/ইতিমধ্যে published/);
    await expect(svc.propose("org-1", "u1", { type: "propose_listing_unpublish", listingId: "list-1" })).rejects.toThrow(/published নয়/);
  });
});

describe("EC11 ProposalsService — create discount (local only)", () => {
  it("approve calls discounts.create WITHOUT storeIds; preview says local-only", async () => {
    const { svc, discounts } = setup();
    const row: any = await svc.propose("org-1", "u1", { type: "propose_create_discount", discountCode: "eid10", discountKind: "percent", discountValue: 10 });
    expect(row.payload.discount.code).toBe("EID10");
    expect(row.preview).toContain("স্টোরে পাঠানো হবে না");
    expect(discounts.create).not.toHaveBeenCalled();
    const done: any = await svc.approve("org-1", "owner-1", row.id);
    expect(done.status).toBe("executed");
    const arg = discounts.create.mock.calls[0][2];
    expect("storeIds" in arg).toBe(false);
    expect(arg).toMatchObject({ code: "EID10", kind: "percent", value: 10, scopeType: "all" });
    expect(done.result.discountId).toBe("disc-1");
    expect(done.result.code).toBe("EID10");
  });

  it("duplicate code and invalid percent are refused at propose time", async () => {
    const { svc } = setup();
    await expect(svc.propose("org-1", "u1", { type: "propose_create_discount", discountCode: "existing", discountKind: "percent", discountValue: 10 })).rejects.toThrow(/ইতিমধ্যে একটি ডিসকাউন্ট/);
    await expect(svc.propose("org-1", "u1", { type: "propose_create_discount", discountCode: "NEW", discountKind: "percent", discountValue: 95 })).rejects.toThrow(/1 থেকে 90/);
    const fs: any = await svc.propose("org-1", "u1", { type: "propose_create_discount", discountCode: "SHIPFREE", discountKind: "free_shipping", discountValue: 999 });
    expect(fs.payload.discount.value).toBe(0);
  });
});

describe("EC11 ProposalsService — product copy", () => {
  it("dev provider: propose throws BadRequest and NO proposal row is created", async () => {
    const { svc, prisma } = setup({ llm: "dev" });
    await expect(svc.propose("org-1", "u1", { type: "propose_product_copy", productId: "prod-1" })).rejects.toThrow(/আসল LLM কনফিগার করা নেই/);
    expect(prisma.aIActionProposal.rows.length).toBe(0);
  });

  it("no llmFactory at all: honest BadRequest, nothing stored", async () => {
    const { svc, prisma } = setup();
    await expect(svc.propose("org-1", "u1", { type: "propose_product_copy", productId: "prod-1" })).rejects.toThrow(/LLM সেবা/);
    expect(prisma.aIActionProposal.rows.length).toBe(0);
  });

  it("real provider: copy stored on the proposal; approval applies it via products.update", async () => {
    const { svc, products } = setup({ llm: "real" });
    const row: any = await svc.propose("org-1", "u1", { type: "propose_product_copy", productId: "prod-1" });
    expect(row.payload.copy).toEqual(REAL_COPY);
    expect(row.preview).toContain(REAL_COPY.description.slice(0, 50));
    expect(products.update).not.toHaveBeenCalled();
    const done: any = await svc.approve("org-1", "owner-1", row.id);
    expect(done.status).toBe("executed");
    expect(products.update).toHaveBeenCalledWith("org-1", "owner-1", "prod-1", {
      description: REAL_COPY.description, seoTitle: REAL_COPY.seoTitle, seoDescription: REAL_COPY.seoDescription,
    });
    expect(done.result.applied).toEqual(["description", "seoTitle", "seoDescription"]);
  });
});

describe("EC11 ProposalsService — foreign-org targets are 404", () => {
  it("foreign product / listing ids are refused at propose time", async () => {
    const { svc } = setup({ llm: "real" });
    await expect(svc.propose("org-1", "u1", { type: "propose_price_change", productId: "prod-foreign", newPrice: "100.00" })).rejects.toMatchObject({ code: "ai.productNotFoundInThisOrganization" });
    await expect(svc.propose("org-1", "u1", { type: "propose_stock_adjust", productId: "prod-foreign", newQuantity: 1 })).rejects.toMatchObject({ code: "ai.productNotFoundInThisOrganization" });
    await expect(svc.propose("org-1", "u1", { type: "propose_listing_publish", listingId: "list-foreign" })).rejects.toMatchObject({ code: "ai.listingNotFoundInThisOrganization" });
    await expect(svc.propose("org-1", "u1", { type: "propose_product_copy", productId: "prod-foreign" })).rejects.toMatchObject({ code: "ai.productNotFoundInThisOrganization" });
  });
});
