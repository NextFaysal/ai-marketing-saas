import { BadRequestException, NotFoundException } from "@nestjs/common";
import { StorefrontService } from "./storefront.service";

/** EC24b — digital products: reveal gate, cap, and URL secrecy. */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in (v as any)) { if (!(v as any).in.includes(row[k])) return false; continue; }
      if ("not" in (v as any)) { if (row[k] === (v as any).not) return false; continue; }
      if (!matchWhere(row[k] ?? {}, v)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
  };
}
function fakePrisma() {
  return {
    organization: makeTable("org"), storefrontSetting: makeTable("setting"),
    order: makeTable("order"), orderItem: makeTable("item"), customer: makeTable("customer"),
    product: makeTable("product"), fulfillment: makeTable("fulfillment"),
    courierShipment: makeTable("ship"), paymentVerification: makeTable("pv"),
    deliverySlot: makeTable("slot"), integration: makeTable("int"),
    productImage: makeTable("img"), productVariant: makeTable("variant"), category: makeTable("cat"),
  } as any;
}

const PHONE = "01711111111";
function seed(prisma: any, over: { status?: string; limit?: number | null } = {}) {
  prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One" });
  prisma.storefrontSetting.rows.push({ id: "s-1", organizationId: "org-1", shopEnabled: true, trackingPageEnabled: true, shopName: "Shop" });
  prisma.customer.rows.push({ id: "c-1", organizationId: "org-1", phone: PHONE, firstName: "রহিম" });
  prisma.product.rows.push({
    id: "p-digi", organizationId: "org-1", name: "ইবুক", status: "ACTIVE", priceMinor: 10000n,
    digital: true, digitalFileUrl: "https://files.example.com/ebook.pdf",
    digitalAccessLimit: over.limit === undefined ? 1 : over.limit,
  });
  prisma.product.rows.push({
    id: "p-phys", organizationId: "org-1", name: "বই (ছাপা)", status: "ACTIVE", priceMinor: 5000n, digital: false,
  });
  prisma.order.rows.push({
    id: "o-1", organizationId: "org-1", externalId: "native-1", externalNumber: "ORD-1",
    customerId: "c-1", status: over.status ?? "processing", totalMinor: 10000n, currency: "BDT",
    digitalAccessCount: 0, placedAt: new Date(),
  });
  prisma.orderItem.rows.push({ id: "i-1", orderId: "o-1", productId: "p-digi", name: "ইবুক", quantity: 1, totalMinor: 10000n });
}

describe("EC24b digital access reveal", () => {
  it("product payload exposes ONLY digital:true — never the file URL", async () => {
    const prisma = fakePrisma();
    seed(prisma);
    const svc = new StorefrontService(prisma);
    const out = (svc as any).serializeProduct(prisma.product.rows[0], []);
    expect(out.digital).toBe(true);
    expect(JSON.stringify(out)).not.toContain("digitalFileUrl");
    expect(JSON.stringify(out)).not.toContain("files.example.com");
  });

  it("trackOrder carries digitalItems + note and NO url anywhere", async () => {
    const prisma = fakePrisma();
    seed(prisma, { status: "completed" });
    const svc = new StorefrontService(prisma);
    const out: any = await svc.trackOrder("shop-one", { phone: PHONE, orderNumber: "ORD-1" });
    expect(out.digitalItems).toEqual([{ name: "ইবুক", available: true }]);
    expect(typeof out.digitalNote).toBe("string");
    expect(JSON.stringify(out)).not.toContain("files.example.com");
    expect(JSON.stringify(out)).not.toContain("digitalFileUrl");
  });

  it("reveal before delivery => Bengali 400, count untouched", async () => {
    const prisma = fakePrisma();
    seed(prisma, { status: "processing" });
    const svc = new StorefrontService(prisma);
    await expect(svc.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" }))
      .rejects.toThrow(/ডেলিভারি সম্পন্ন হলে ডাউনলোড লিংক পাওয়া যাবে/);
    expect(prisma.order.rows[0].digitalAccessCount).toBe(0);
  });

  it("a delivered Fulfillment also opens the gate", async () => {
    const prisma = fakePrisma();
    seed(prisma, { status: "processing", limit: null });
    prisma.fulfillment.rows.push({ id: "f-1", orderId: "o-1", status: "delivered", createdAt: new Date() });
    const svc = new StorefrontService(prisma);
    const out = await svc.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" });
    expect(out.links).toEqual([{ productName: "ইবুক", url: "https://files.example.com/ebook.pdf" }]);
  });

  it("after completion: links returned, count increments, cap (limit 1) refuses the 2nd reveal", async () => {
    const prisma = fakePrisma();
    seed(prisma, { status: "completed", limit: 1 });
    const svc = new StorefrontService(prisma);
    const out = await svc.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" });
    expect(out.links).toHaveLength(1);
    expect(prisma.order.rows[0].digitalAccessCount).toBe(1);
    expect(prisma.order.rows[0].digitalLastAccessedAt).toBeInstanceOf(Date);
    await expect(svc.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" }))
      .rejects.toThrow(/ডাউনলোডের সীমা শেষ হয়ে গেছে/);
    // and trackOrder now reports the item unavailable (cap reached)
    const tracked: any = await svc.trackOrder("shop-one", { phone: PHONE, orderNumber: "ORD-1" });
    expect(tracked.digitalItems[0].available).toBe(false);
  });

  it("unlimited when every digital product's limit is null", async () => {
    const prisma = fakePrisma();
    seed(prisma, { status: "completed", limit: null });
    const svc = new StorefrontService(prisma);
    await svc.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" });
    await svc.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" });
    expect(prisma.order.rows[0].digitalAccessCount).toBe(2);
  });

  it("non-digital order => Bengali 400", async () => {
    const prisma = fakePrisma();
    seed(prisma, { status: "completed" });
    prisma.orderItem.rows[0].productId = "p-phys";
    const svc = new StorefrontService(prisma);
    await expect(svc.digitalAccess("shop-one", { phone: PHONE, orderNumber: "ORD-1" }))
      .rejects.toThrow(/এই অর্ডারে ডিজিটাল পণ্য নেই/);
  });

  it("wrong phone => the SAME not-found error as trackOrder", async () => {
    const prisma = fakePrisma();
    seed(prisma, { status: "completed" });
    const svc = new StorefrontService(prisma);
    const trackErr = await svc.trackOrder("shop-one", { phone: "01999999999", orderNumber: "ORD-1" }).catch((e) => e);
    const revealErr = await svc.digitalAccess("shop-one", { phone: "01999999999", orderNumber: "ORD-1" }).catch((e) => e);
    expect(trackErr).toBeInstanceOf(NotFoundException);
    expect(revealErr).toBeInstanceOf(NotFoundException);
    expect(revealErr.message).toBe(trackErr.message);
    expect(revealErr).not.toBeInstanceOf(BadRequestException);
  });
});
