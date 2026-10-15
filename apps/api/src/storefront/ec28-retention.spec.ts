import { BadRequestException, NotFoundException } from "@nestjs/common";
import { RetentionService } from "./retention.service";
import { ShopAccountService } from "./shop-account.service";
import { StorefrontService } from "./storefront.service";
import { InventoryService } from "../inventory/inventory.service";
import { EventsService } from "../common/events.service";
import { ReturnsService } from "../fulfillment/returns.service";

/* Compact fake prisma (EC spec style, with update/delete). */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cond: any = v;
      if ("in" in cond) { if (!cond.in.includes(row[k])) return false; continue; }
      if ("gte" in cond) { if (new Date(row[k]).getTime() < new Date(cond.gte).getTime()) return false; continue; }
      if ("contains" in cond) {
        const hay = String(row[k] ?? "");
        const hit = cond.mode === "insensitive" ? hay.toLowerCase().includes(String(cond.contains).toLowerCase()) : hay.includes(String(cond.contains));
        if (!hit) return false;
        continue;
      }
      if (!matchWhere(row, cond)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}

function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where))[0] ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let found = rows.filter((r) => matchWhere(r, where));
      if (orderBy?.createdAt) {
        found = [...found].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        if (orderBy.createdAt === "desc") found.reverse();
      }
      if (take !== undefined) found = found.slice(0, take);
      return found;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}-${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) if (matchWhere(row, where)) { Object.assign(row, data); count++; }
      return { count };
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
    organization: makeTable(),
    storefrontSetting: makeTable(),
    businessProfile: makeTable(),
    category: makeTable(),
    product: makeTable(),
    productVariant: makeTable(),
    productImage: makeTable(),
    customer: makeTable(),
    messagingSenderConfig: makeTable(),
    stockAlertSubscription: makeTable(),
    wishlistItem: makeTable(),
    returnRequest: makeTable(),
    order: makeTable(),
    orderItem: makeTable(),
    fulfillment: makeTable(),
    courierShipment: makeTable(),
    productQuestion: makeTable(),
    stockMovement: makeTable(),
    auditLog: makeTable(),
    membership: makeTable(),
    agentNotification: makeTable(),
  } as any;
}

const T0 = new Date("2026-10-01T00:00:00Z");

function seed(prisma: any) {
  prisma.organization.rows.push(
    { id: "org-1", slug: "shop-one", name: "Shop One", brandName: null, logoUrl: null, primaryColor: null, customDomain: null },
    { id: "org-2", slug: "shop-two", name: "Shop Two", brandName: null, logoUrl: null, primaryColor: null, customDomain: null },
  );
  prisma.storefrontSetting.rows.push(
    { id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: "ShopOne", locale: "bn" },
    { id: "set-2", organizationId: "org-2", shopEnabled: true, shopName: "ShopTwo", locale: "bn" },
  );
  const base = { description: null, category: null, categoryId: null, status: "ACTIVE", compareAtMinor: null, currency: "BDT", lowStockThreshold: null, imageUrl: null, preorderEnabled: false, createdAt: T0, updatedAt: T0 };
  prisma.product.rows.push(
    { ...base, id: "p-oos", organizationId: "org-1", name: "শেষ হওয়া পণ্য", slug: "oos-product", sku: "OOS-1", priceMinor: 40000n, stockQuantity: 0 },
    { ...base, id: "p-stock", organizationId: "org-1", name: "স্টকের পণ্য", slug: "in-stock", sku: "STK-1", priceMinor: 50000n, stockQuantity: 7 },
    { ...base, id: "p-var", organizationId: "org-1", name: "ভ্যারিয়েন্ট পণ্য", slug: "variant-product", sku: "VAR-1", priceMinor: 60000n, stockQuantity: null },
    { ...base, id: "p-foreign", organizationId: "org-2", name: "অন্য দোকান", slug: "foreign-product", sku: "FOR-1", priceMinor: 10000n, stockQuantity: 0 },
    { ...base, id: "p-drop", organizationId: "org-1", name: "দাম কমা পণ্য", slug: "drop-product", sku: "DRP-1", priceMinor: 80000n, stockQuantity: 3 },
  );
  prisma.productVariant.rows.push(
    { id: "v-red", productId: "p-var", name: "লাল", sku: "VAR-1-RED", priceMinor: null, stockQuantity: 0, attributes: null, createdAt: T0, updatedAt: T0 },
    { id: "v-blue", productId: "p-var", name: "নীল", sku: "VAR-1-BLUE", priceMinor: null, stockQuantity: 2, attributes: null, createdAt: T0, updatedAt: T0 },
  );
  prisma.customer.rows.push(
    { id: "c-1", organizationId: "org-1", firstName: "রহিম", lastName: null, phone: "01711111111", email: null, source: "native_storefront", externalId: "01711111111" },
  );
}

function makeSmsStub(configured = true) {
  const calls: any[] = [];
  return {
    calls,
    isConfigured: () => configured,
    send: jest.fn(async (input: any) => { calls.push(input); return { providerMessageId: "m1" }; }),
    sendWithGateway: jest.fn(async (_g: any, _c: any, input: any) => { calls.push(input); return { providerMessageId: "m2" }; }),
  };
}

function makeWorld(smsConfigured = true) {
  const prisma = makePrisma();
  seed(prisma);
  const sms = makeSmsStub(smsConfigured);
  const accounts = new ShopAccountService(prisma, sms as any);
  const storefront = new StorefrontService(prisma);
  const auditCalls: any[] = [];
  const audit: any = { log: jest.fn(async (x: any) => { auditCalls.push(x); }) };
  const events = new EventsService();
  const retention = new RetentionService(prisma, accounts, storefront, audit, events);
  return { prisma, sms, accounts, storefront, audit, auditCalls, events, retention };
}

const tick = () => new Promise((r) => setImmediate(r));

describe("EC28 back-in-stock subscriptions", () => {
  it("subscribing while IN stock is an honest 400", async () => {
    const { retention } = makeWorld();
    await expect(
      retention.subscribeStockAlert("shop-one", { productId: "p-stock", phone: "01711111111" }),
    ).rejects.toMatchObject({ status: 400, message: "পণ্যটি এখন স্টকে আছে" });
  });

  it("foreign product is a 404", async () => {
    const { retention } = makeWorld();
    await expect(
      retention.subscribeStockAlert("shop-one", { productId: "p-foreign", phone: "01711111111" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("re-subscribe is idempotent (one pending row, existing:true)", async () => {
    const { prisma, retention } = makeWorld();
    const first: any = await retention.subscribeStockAlert("shop-one", { productId: "p-oos", phone: "01711111111" });
    const second: any = await retention.subscribeStockAlert("shop-one", { productId: "p-oos", phone: "+8801711111111" });
    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.subscription.id).toBe(first.subscription.id);
    expect(prisma.stockAlertSubscription.rows).toHaveLength(1);
    expect(first.subscription).not.toHaveProperty("phone");
  });

  it("variant-level subscription requires THAT variant to be out of stock", async () => {
    const { retention } = makeWorld();
    const ok: any = await retention.subscribeStockAlert("shop-one", { productId: "p-var", variantSku: "VAR-1-RED", phone: "01711111111" });
    expect(ok.subscription.variantSku).toBe("VAR-1-RED");
    await expect(
      retention.subscribeStockAlert("shop-one", { productId: "p-var", variantSku: "VAR-1-BLUE", phone: "01711111111" }),
    ).rejects.toMatchObject({ status: 400, message: "পণ্যটি এখন স্টকে আছে" });
  });

  it("0→positive transition fires ONCE via InventoryService.adjust + the event hook; a second increase does not re-fire", async () => {
    const { prisma, sms, events, retention } = makeWorld();
    await retention.subscribeStockAlert("shop-one", { productId: "p-oos", phone: "01711111111" });
    const audit: any = { log: jest.fn(async () => ({})) };
    const inventory = new InventoryService(prisma, audit, undefined, events as any);

    await inventory.adjust("org-1", "staff-1", "p-oos", { setTo: 5, reason: "purchase_receive" });
    await tick(); await tick();
    expect(sms.calls).toHaveLength(1);
    expect(sms.calls[0].to).toBe("8801711111111");
    expect(prisma.stockAlertSubscription.rows[0].status).toBe("notified");
    expect(prisma.stockAlertSubscription.rows[0].notifiedAt).toBeInstanceOf(Date);

    // Stock drops and rises again — the SAME subscription never re-fires.
    await inventory.adjust("org-1", "staff-1", "p-oos", { setTo: 0, reason: "manual_adjustment" });
    await inventory.adjust("org-1", "staff-1", "p-oos", { setTo: 9, reason: "purchase_receive" });
    await tick(); await tick();
    expect(sms.calls).toHaveLength(1);
  });

  it("a non-transition increase (3→5) does not fire; a direct handler call on 0→positive does", async () => {
    const { prisma, sms, retention } = makeWorld();
    await retention.subscribeStockAlert("shop-one", { productId: "p-oos", phone: "01711111111" });
    const none = await retention.onStockIncreased({ organizationId: "org-1", productId: "p-oos", prevBalance: 3, balanceAfter: 5 });
    expect(none).toEqual({ notified: 0, failedNoChannel: 0 });
    expect(sms.calls).toHaveLength(0);
    const fired = await retention.onStockIncreased({ organizationId: "org-1", productId: "p-oos", prevBalance: 0, balanceAfter: 2 });
    expect(fired).toEqual({ notified: 1, failedNoChannel: 0 });
    expect(prisma.stockAlertSubscription.rows[0].status).toBe("notified");
  });

  it("no SMS sender configured marks failed_no_channel honestly (never 'sent')", async () => {
    const { prisma, sms, retention } = makeWorld(false);
    await retention.subscribeStockAlert("shop-one", { productId: "p-oos", phone: "01711111111" });
    const res = await retention.onStockIncreased({ organizationId: "org-1", productId: "p-oos", prevBalance: 0, balanceAfter: 4 });
    expect(res).toEqual({ notified: 0, failedNoChannel: 1 });
    const row = prisma.stockAlertSubscription.rows[0];
    expect(row.status).toBe("failed_no_channel");
    expect(row.failureReason).toBeTruthy();
    expect(row.notifiedAt ?? null).toBeNull();
    expect(sms.calls).toHaveLength(0);
  });
});

describe("EC28 wishlist price-drop sweep", () => {
  function seedWishlist(prisma: any, priceAtAdd: bigint) {
    prisma.wishlistItem.rows.push({
      id: "w-1", organizationId: "org-1", customerId: "c-1", productId: "p-drop",
      priceAtAddMinor: priceAtAdd, lastNotifiedPriceMinor: null, lastAlertStatus: null, lastAlertAt: null,
      createdAt: T0,
    });
  }

  it("a drop below the snapshot notifies once; the same price never re-fires; a further drop fires again; an increase never fires", async () => {
    const { prisma, sms, retention } = makeWorld();
    seedWishlist(prisma, 100000n);
    const product = prisma.product.rows.find((p: any) => p.id === "p-drop");

    product.priceMinor = 80000n; // current seed price = the drop
    const first = await retention.runWishlistPriceAlerts("org-1");
    expect(first).toMatchObject({ notified: 1, failedNoChannel: 0 });
    expect(sms.calls).toHaveLength(1);
    expect(prisma.wishlistItem.rows[0].lastNotifiedPriceMinor).toBe(80000n);
    expect(prisma.wishlistItem.rows[0].lastAlertStatus).toBe("sent");

    const again = await retention.runWishlistPriceAlerts("org-1");
    expect(again.notified).toBe(0);
    expect(sms.calls).toHaveLength(1);

    product.priceMinor = 70000n; // further drop = a new price point
    const further = await retention.runWishlistPriceAlerts("org-1");
    expect(further.notified).toBe(1);
    expect(sms.calls).toHaveLength(2);

    product.priceMinor = 120000n; // increase above the snapshot — never
    const up = await retention.runWishlistPriceAlerts("org-1");
    expect(up.notified).toBe(0);
    expect(sms.calls).toHaveLength(2);
  });

  it("no sender records failed_no_channel and does NOT consume the price point", async () => {
    const { prisma, retention } = makeWorld(false);
    seedWishlist(prisma, 100000n);
    const res = await retention.runWishlistPriceAlerts("org-1");
    expect(res).toMatchObject({ notified: 0, failedNoChannel: 1 });
    const row = prisma.wishlistItem.rows[0];
    expect(row.lastAlertStatus).toBe("failed_no_channel");
    expect(row.lastAlertAt).toBeInstanceOf(Date);
    expect(row.lastNotifiedPriceMinor).toBeNull();
  });
});

describe("EC28 customer self-service RMA", () => {
  function seedOrder(prisma: any, status = "completed") {
    prisma.order.rows.push({
      id: "o-1", organizationId: "org-1", customerId: "c-1", externalId: "1001", externalNumber: "1001",
      source: "native_storefront", status, isPractice: false, totalMinor: 80000n, subtotalMinor: 80000n,
      placedAt: T0, createdAt: T0, updatedAt: T0,
    });
    prisma.orderItem.rows.push(
      { id: "it-1", orderId: "o-1", productId: "p-drop", name: "দাম কমা পণ্য", sku: "DRP-1", quantity: 2, priceMinor: 40000n, totalMinor: 80000n, isGift: false, isPreorder: false },
    );
  }
  const NOT_FOUND_MSG = "অর্ডারটি পাওয়া যায়নি — অর্ডার নম্বর ও ফোন নম্বর যাচাই করে আবার চেষ্টা করুন";

  it("matcher failures are constant-shape (wrong phone == unknown order)", async () => {
    const { prisma, retention } = makeWorld();
    seedOrder(prisma);
    const wrongPhone = await retention.createCustomerReturn("shop-one", { phone: "01799999999", orderNumber: "1001", type: "return", reason: "পণ্যটি নষ্ট" }).catch((e) => e);
    const unknownOrder = await retention.createCustomerReturn("shop-one", { phone: "01711111111", orderNumber: "9999", type: "return", reason: "পণ্যটি নষ্ট" }).catch((e) => e);
    expect(wrongPhone).toBeInstanceOf(NotFoundException);
    expect(unknownOrder).toBeInstanceOf(NotFoundException);
    expect(wrongPhone.message).toBe(NOT_FOUND_MSG);
    expect(unknownOrder.message).toBe(NOT_FOUND_MSG);
  });

  it("undelivered order is a 400", async () => {
    const { prisma, retention } = makeWorld();
    seedOrder(prisma, "processing");
    await expect(
      retention.createCustomerReturn("shop-one", { phone: "01711111111", orderNumber: "1001", type: "return", reason: "পণ্যটি নষ্ট" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("qty beyond the delivered quantity is a 400 with the EC9 verbatim message; unknown item too", async () => {
    const { prisma, retention } = makeWorld();
    seedOrder(prisma);
    await expect(
      retention.createCustomerReturn("shop-one", {
        phone: "01711111111", orderNumber: "1001", type: "return", reason: "পণ্যটি নষ্ট",
        items: [{ orderItemId: "it-1", quantity: 3 }],
      }),
    ).rejects.toMatchObject({ status: 400, message: "\"দাম কমা পণ্য\"-এর পরিমাণ অর্ডারের পরিমাণের বেশি হতে পারবে না" });
    await expect(
      retention.createCustomerReturn("shop-one", {
        phone: "01711111111", orderNumber: "1001", type: "return", reason: "পণ্যটি নষ্ট",
        items: [{ orderItemId: "it-zzz", quantity: 1 }],
      }),
    ).rejects.toMatchObject({ status: 400, message: "অর্ডারে এই আইটেমটি নেই" });
  });

  it("creates a source=customer request in the EC9 initial state; staff queue + tracking both see it; duplicate refused", async () => {
    const { prisma, retention, storefront } = makeWorld();
    seedOrder(prisma);
    const created: any = await retention.createCustomerReturn("shop-one", {
      phone: "01711111111", orderNumber: "1001", type: "exchange", reason: "সাইজ মেলেনি",
      items: [{ orderItemId: "it-1", quantity: 1 }],
    });
    expect(created).toMatchObject({ source: "customer", requestType: "exchange", status: "requested" });
    const row = prisma.returnRequest.rows[0];
    expect(row).toMatchObject({ source: "customer", requestType: "exchange", status: "requested", orderId: "o-1" });
    expect(row.token).toMatch(/^[0-9a-f]{48}$/);

    // Staff queue (the EC9 ReturnsService list over the same rows).
    const staff = new ReturnsService(prisma, { log: jest.fn(async () => ({})) } as any);
    const list: any = await staff.list("org-1");
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ id: row.id, source: "customer", requestType: "exchange" });

    // The customer sees it in the tracking response.
    const tracked: any = await storefront.trackOrder("shop-one", { phone: "01711111111", orderNumber: "1001" } as any);
    expect(tracked.returnRequests).toHaveLength(1);
    expect(tracked.returnRequests[0]).toMatchObject({ source: "customer", requestType: "exchange", status: "requested" });

    // Duplicate open request of the same type is refused; a
    // different type is a different request.
    await expect(
      retention.createCustomerReturn("shop-one", { phone: "01711111111", orderNumber: "1001", type: "exchange", reason: "আবার" }),
    ).rejects.toMatchObject({ status: 400 });
    const other: any = await retention.createCustomerReturn("shop-one", { phone: "01711111111", orderNumber: "1001", type: "return", reason: "ফেরত চাই" });
    expect(other.requestType).toBe("return");
    expect(other.items).toEqual([{ orderItemId: "it-1", quantity: 2 }]); // omitted items = whole order
  });
});

describe("EC28 product Q&A", () => {
  it("ask lands pending and is invisible publicly; answering publishes it; the phone never leaves the server", async () => {
    const { prisma, retention } = makeWorld();
    const asked: any = await retention.askQuestion("shop-one", "drop-product", {
      customerName: "করিম", phone: "01711111111", question: "এই পণ্যটি কি ওয়াটারপ্রুফ?",
    });
    expect(asked).toEqual({ id: expect.any(String), status: "pending" });

    const before: any = await retention.publicQuestions("shop-one", "drop-product");
    expect(before.items).toEqual([]);

    const answered: any = await retention.staffAnswerQuestion("org-1", "staff-9", asked.id, "হ্যাঁ, সম্পূর্ণ ওয়াটারপ্রুফ।");
    expect(answered.status).toBe("published");
    expect(answered.phone).toBe("01711111111"); // staff surface may see it

    const after: any = await retention.publicQuestions("shop-one", "drop-product");
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({ customerName: "করিম", answer: "হ্যাঁ, সম্পূর্ণ ওয়াটারপ্রুফ।" });
    expect(JSON.stringify(after)).not.toContain("01711111111");
    expect(after.items[0]).not.toHaveProperty("phone");
    void prisma;
  });

  it("foreign product is a 404; moderation writes audit rows; hide removes it publicly", async () => {
    const { retention, auditCalls } = makeWorld();
    await expect(
      retention.askQuestion("shop-one", "foreign-product", { customerName: "করিম", question: "প্রশ্ন আছে কি?" }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const asked: any = await retention.askQuestion("shop-one", "drop-product", {
      customerName: "করিম", question: "ডেলিভারি কত দিনে পাবো?",
    });
    await retention.staffAnswerQuestion("org-1", "staff-9", asked.id, "২-৩ দিনে।");
    const hidden: any = await retention.staffSetQuestionVisibility("org-1", "staff-9", asked.id, true);
    expect(hidden.status).toBe("hidden");
    const pub: any = await retention.publicQuestions("shop-one", "drop-product");
    expect(pub.items).toEqual([]);
    const actions = auditCalls.map((c) => c.action);
    expect(actions).toContain("product_question.answered");
    expect(actions).toContain("product_question.hidden");

    // Foreign-org question id is a 404 for staff too.
    await expect(retention.staffAnswerQuestion("org-2", "staff-9", asked.id, "উত্তর")).rejects.toBeInstanceOf(NotFoundException);
    expect(BadRequestException).toBeDefined();
  });
});
