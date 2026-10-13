import { BadRequestException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { StorefrontService } from "./storefront.service";
import { ShopAccountService } from "./shop-account.service";
import { hashShopSecret } from "./shop-auth.util";

/* Fake prisma (EC spec style, self-contained copy + updateMany /
 * deleteMany / count / findUnique extensions for EC25 tables). */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cond: any = v;
      if ("in" in cond) {
        if (!cond.in.includes(row[k])) return false;
        continue;
      }
      if ("not" in cond) {
        if (row[k] === cond.not) return false;
        continue;
      }
      if ("gte" in cond || "lte" in cond) {
        if (row[k] === null || row[k] === undefined) return false;
        const t = new Date(row[k]).getTime();
        if ("gte" in cond && t < new Date(cond.gte).getTime()) return false;
        if ("lte" in cond && t > new Date(cond.lte).getTime()) return false;
        continue;
      }
      if ("contains" in cond) {
        const hay = String(row[k] ?? "");
        const hit = cond.mode === "insensitive"
          ? hay.toLowerCase().includes(String(cond.contains).toLowerCase())
          : hay.includes(String(cond.contains));
        if (!hit) return false;
        continue;
      }
      if (!matchWhere(row, cond)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (row[k] !== v) {
      return false;
    }
  }
  return true;
}

function applyOrderBy(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of [...specs].reverse()) {
    for (const [field, dir] of Object.entries(spec)) {
      out.sort((a: any, b: any) => {
        const av = a[field];
        const bv = b[field];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = av instanceof Date || bv instanceof Date
          ? new Date(av).getTime() - new Date(bv).getTime()
          : av < bv ? -1 : 1;
        return dir === "desc" ? -cmp : cmp;
      });
    }
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
    findUnique: async ({ where }: any = {}) =>
      rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let found = applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy);
      if (skip) found = found.slice(skip);
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
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matchWhere(rows[i], where)) { rows.splice(i, 1); count++; }
      }
      return { count };
    },
  };
}

function makePrisma() {
  const prisma: any = {
    organization: makeTable(),
    storefrontSetting: makeTable(),
    businessProfile: makeTable(),
    category: makeTable(),
    product: makeTable(),
    productVariant: makeTable(),
    productImage: makeTable(),
    shippingZone: makeTable(),
    storeCart: makeTable(),
    storeCartItem: makeTable(),
    order: makeTable(),
    orderItem: makeTable(),
    customer: makeTable(),
    shopOtpChallenge: makeTable(),
    shopSession: makeTable(),
    customerAddress: makeTable(),
    wishlistItem: makeTable(),
    messagingSenderConfig: makeTable(),
  };
  // MessagingService-style findUnique read: the fake table's
  // findUnique already matches on organizationId.
  return prisma;
}

const T0 = new Date("2026-10-01T00:00:00Z");

function seedShop(prisma: any) {
  prisma.organization.rows.push(
    { id: "org-1", slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne", logoUrl: null, primaryColor: null, customDomain: null },
    { id: "org-2", slug: "shop-two", name: "Shop Two", brandName: null, logoUrl: null, primaryColor: null, customDomain: null },
  );
  prisma.storefrontSetting.rows.push(
    { id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: "ShopOne", createdAt: T0, updatedAt: T0 },
    { id: "set-2", organizationId: "org-2", shopEnabled: true, shopName: "ShopTwo", createdAt: T0, updatedAt: T0 },
  );
  prisma.product.rows.push(
    { id: "p-a", organizationId: "org-1", name: "লেদার ওয়ালেট", slug: "leather-wallet", category: null, categoryId: null, sku: "WAL-1", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, currency: "BDT", stockQuantity: 10, lowStockThreshold: null, imageUrl: "https://img/a.jpg", preorderEnabled: false, createdAt: T0, updatedAt: T0 },
    { id: "p-b", organizationId: "org-1", name: "ক্যানভাস ব্যাগ", slug: "canvas-bag", category: null, categoryId: null, sku: "BAG-1", status: "ACTIVE", priceMinor: 120000n, compareAtMinor: null, currency: "BDT", stockQuantity: null, lowStockThreshold: null, imageUrl: null, preorderEnabled: false, createdAt: T0, updatedAt: T0 },
    { id: "p-oos", organizationId: "org-1", name: "শেষ পণ্য", slug: "oos", category: null, categoryId: null, sku: "OOS-1", status: "ACTIVE", priceMinor: 30000n, compareAtMinor: null, currency: "BDT", stockQuantity: 0, lowStockThreshold: null, imageUrl: null, preorderEnabled: false, createdAt: T0, updatedAt: T0 },
    { id: "p-disc", organizationId: "org-1", name: "পুরনো পণ্য", slug: "disc", category: null, categoryId: null, sku: "DISC-1", status: "ACTIVE", priceMinor: 20000n, compareAtMinor: null, currency: "BDT", stockQuantity: 5, lowStockThreshold: null, imageUrl: null, preorderEnabled: false, createdAt: T0, updatedAt: T0 },
    { id: "p-foreign", organizationId: "org-2", name: "অন্য দোকানের পণ্য", slug: "foreign", category: null, categoryId: null, sku: "FOR-1", status: "ACTIVE", priceMinor: 99000n, compareAtMinor: null, currency: "BDT", stockQuantity: 5, lowStockThreshold: null, imageUrl: null, preorderEnabled: false, createdAt: T0, updatedAt: T0 },
  );
  prisma.productVariant.rows.push(
    { id: "v-a1", productId: "p-a", name: "কালো", sku: "WAL-1-BLK", priceMinor: 55000n, stockQuantity: 3, attributes: null, createdAt: T0, updatedAt: T0 },
  );
  prisma.shippingZone.rows.push(
    { id: "z-all", organizationId: "org-1", name: "সব জায়গায়", kind: "all", districts: null, chargeMinor: 6000n, deliveryDays: 3, freeAboveMinor: null, active: true, position: 0, createdAt: T0, updatedAt: T0 },
  );
}

function makeSmsStub(configured = true) {
  const calls: any[] = [];
  return {
    calls,
    isConfigured: () => configured,
    send: jest.fn(async (input: any) => { calls.push(input); return { providerMessageId: "msg-1" }; }),
    sendWithGateway: jest.fn(async (_gateway: any, _cfg: any, input: any) => { calls.push(input); return { providerMessageId: "msg-2" }; }),
  };
}

function makeWorld(smsConfigured = true) {
  const prisma = makePrisma();
  seedShop(prisma);
  const sms = makeSmsStub(smsConfigured);
  const accounts = new ShopAccountService(prisma, sms as any);
  return { prisma, sms, accounts };
}

function lastCode(sms: any): string {
  const text = sms.calls[sms.calls.length - 1].text as string;
  const m = text.match(/\d{6}/);
  if (!m) throw new Error(`no code in sms text: ${text}`);
  return m[0];
}

function wrongCodeFor(code: string): string {
  return code === "000000" ? "000001" : "000000";
}

function ageChallenges(prisma: any, msAgo: number) {
  for (const row of prisma.shopOtpChallenge.rows) {
    row.createdAt = new Date(Date.now() - msAgo);
  }
}

async function login(accounts: ShopAccountService, sms: any, phone = "01711111111", slug = "shop-one") {
  await accounts.requestOtp(slug, phone);
  const code = lastCode(sms);
  const res: any = await accounts.verifyOtp(slug, phone, code);
  return res;
}

const CONSTANT = "কোডটি সঠিক নয় অথবা মেয়াদ শেষ হয়ে গেছে";

describe("EC25 (a) OTP happy path — hashes only", () => {
  it("request stores a HASH (never the code); verify returns a token whose hash is the stored session", async () => {
    const { prisma, sms, accounts } = makeWorld();
    const res: any = await accounts.requestOtp("shop-one", "01711111111");
    expect(res).toEqual({ sent: true, expiresInSeconds: 300 });
    const code = lastCode(sms);
    expect(JSON.stringify(res)).not.toContain(code);
    expect(sms.calls[0].to).toBe("8801711111111");
    expect(prisma.shopOtpChallenge.rows).toHaveLength(1);
    const challenge = prisma.shopOtpChallenge.rows[0];
    expect(challenge.codeHash).not.toBe(code);
    expect(challenge.codeHash).toBe(hashShopSecret(`org-1:01711111111:${code}`));
    expect(challenge.phone).toBe("01711111111");
    expect(challenge.attempts).toBe(0);
    // customer find-or-created with the storefront source
    expect(prisma.customer.rows).toHaveLength(1);
    expect(prisma.customer.rows[0]).toMatchObject({ source: "native_storefront", phone: "01711111111" });

    const verified: any = await accounts.verifyOtp("shop-one", "01711111111", code);
    expect(verified.token).toMatch(/^[0-9a-f]{64}$/);
    expect(verified.customer).toMatchObject({ phone: "01711111111" });
    expect(prisma.shopSession.rows).toHaveLength(1);
    const session = prisma.shopSession.rows[0];
    expect(session.tokenHash).not.toBe(verified.token);
    expect(session.tokenHash).toBe(hashShopSecret(verified.token));
    expect(session.organizationId).toBe("org-1");
    expect(challenge.consumedAt).not.toBeNull();
    // challenge cannot be replayed
    await expect(accounts.verifyOtp("shop-one", "01711111111", code)).rejects.toThrow(CONSTANT);
  });

  it("short phone is refused in Bengali", async () => {
    const { accounts } = makeWorld();
    await expect(accounts.requestOtp("shop-one", "01711")).rejects.toThrow("সঠিক মোবাইল নম্বর দিন");
  });

  it("disabled / unknown shop 404s", async () => {
    const { accounts } = makeWorld();
    await expect(accounts.requestOtp("no-such-shop", "01711111111")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("EC25 (b) no SMS config — honest failure", () => {
  it("400 with the honest message and the challenge consumed; nothing pretend-sent", async () => {
    const { prisma, sms, accounts } = makeWorld(false);
    await expect(accounts.requestOtp("shop-one", "01711111111")).rejects.toThrow(
      "এই দোকানে SMS লগইন সেটআপ করা নেই — দোকানে যোগাযোগ করুন",
    );
    expect(sms.send).not.toHaveBeenCalled();
    expect(prisma.shopOtpChallenge.rows).toHaveLength(1);
    expect(prisma.shopOtpChallenge.rows[0].consumedAt).not.toBeNull();
  });

  it("a gateway send failure consumes the challenge and surfaces the gateway message", async () => {
    const { prisma, sms, accounts } = makeWorld();
    (sms.send as jest.Mock).mockRejectedValue(new Error("SMS gateway did not accept the message: balance"));
    await expect(accounts.requestOtp("shop-one", "01711111111")).rejects.toBeInstanceOf(BadRequestException);
    await expect(accounts.requestOtp("shop-one", "01811111111")).rejects.toThrow(/balance/);
    expect(prisma.shopOtpChallenge.rows.every((r: any) => r.consumedAt)).toBe(true);
  });
});

describe("EC25 (c)(d) OTP failures — one constant message", () => {
  it("wrong code increments attempts; the 5th wrong attempt kills the challenge; the CORRECT code then still fails the same way", async () => {
    const { prisma, sms, accounts } = makeWorld();
    await accounts.requestOtp("shop-one", "01711111111");
    const code = lastCode(sms);
    const wrong = wrongCodeFor(code);
    for (let i = 1; i <= 5; i++) {
      await expect(accounts.verifyOtp("shop-one", "01711111111", wrong)).rejects.toThrow(CONSTANT);
      expect(prisma.shopOtpChallenge.rows[0].attempts).toBe(i);
    }
    expect(prisma.shopOtpChallenge.rows[0].consumedAt).not.toBeNull();
    await expect(accounts.verifyOtp("shop-one", "01711111111", code)).rejects.toThrow(CONSTANT);
    expect(prisma.shopSession.rows).toHaveLength(0);
  });

  it("expired challenge fails with the same constant message", async () => {
    const { prisma, sms, accounts } = makeWorld();
    await accounts.requestOtp("shop-one", "01711111111");
    const code = lastCode(sms);
    prisma.shopOtpChallenge.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(accounts.verifyOtp("shop-one", "01711111111", code)).rejects.toThrow(CONSTANT);
    expect(prisma.shopSession.rows).toHaveLength(0);
  });

  it("no challenge at all fails with the same constant message", async () => {
    const { accounts } = makeWorld();
    await expect(accounts.verifyOtp("shop-one", "01711111111", "123456")).rejects.toThrow(CONSTANT);
  });
});

describe("EC25 (e) resend supersede + rate caps", () => {
  it("a newer request supersedes the old code: first code fails, second works", async () => {
    const { prisma, sms, accounts } = makeWorld();
    await accounts.requestOtp("shop-one", "01711111111");
    const code1 = lastCode(sms);
    ageChallenges(prisma, 70_000);
    await accounts.requestOtp("shop-one", "01711111111");
    const code2 = lastCode(sms);
    expect(prisma.shopOtpChallenge.rows[0].consumedAt).not.toBeNull();
    if (code1 !== code2) {
      await expect(accounts.verifyOtp("shop-one", "01711111111", code1)).rejects.toThrow(CONSTANT);
    }
    const ok: any = await accounts.verifyOtp("shop-one", "01711111111", code2);
    expect(ok.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("resend within 60 seconds → 429", async () => {
    const { accounts } = makeWorld();
    await accounts.requestOtp("shop-one", "01711111111");
    await expect(accounts.requestOtp("shop-one", "01711111111")).rejects.toMatchObject({ status: 429 });
  });

  it("3 challenges within an hour → the 4th request is 429", async () => {
    const { prisma, accounts } = makeWorld();
    for (let i = 0; i < 3; i++) {
      await accounts.requestOtp("shop-one", "01711111111");
      ageChallenges(prisma, 120_000);
    }
    await expect(accounts.requestOtp("shop-one", "01711111111")).rejects.toMatchObject({ status: 429 });
  });
});

describe("EC25 (f)(g) session scoping + logout", () => {
  it("a token from org A is a 401 at org B; logout revokes the token", async () => {
    const { accounts, sms } = makeWorld();
    const { token } = await login(accounts, sms);
    const me: any = await accounts.me("shop-one", token);
    expect(me.customer.phone).toBe("01711111111");
    await expect(accounts.me("shop-two", token)).rejects.toBeInstanceOf(UnauthorizedException);

    const out: any = await accounts.logout("shop-one", token);
    expect(out).toEqual({ loggedOut: true });
    await expect(accounts.me("shop-one", token)).rejects.toBeInstanceOf(UnauthorizedException);
    // logout with the dead token still answers loggedOut:true
    await expect(accounts.logout("shop-one", token)).resolves.toEqual({ loggedOut: true });
    // unknown org still 404s
    await expect(accounts.logout("no-such-shop", token)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("missing / garbage token is a 401 on account routes", async () => {
    const { accounts } = makeWorld();
    await expect(accounts.me("shop-one", undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(accounts.me("shop-one", "deadbeef")).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe("EC25 (h) account order isolation", () => {
  async function twoCustomersWithOrders() {
    const world = makeWorld();
    const { prisma, accounts, sms } = world;
    const a = await login(accounts, sms, "01711111111");
    const b = await login(accounts, sms, "01822222222");
    const mkOrder = (id: string, customerId: string, num: string, day: number) => {
      prisma.order.rows.push({
        id, organizationId: "org-1", customerId, externalId: `ext-${id}`, externalNumber: num,
        status: "processing", subtotalMinor: 50000n, shippingMinor: 6000n, discountMinor: 0n,
        totalMinor: 56000n, placedAt: new Date(`2026-10-0${day}T00:00:00Z`), createdAt: T0, updatedAt: T0,
        address: "বাড়ি ১", giftSkipped: false,
      });
      prisma.orderItem.rows.push({
        id: `oi-${id}`, orderId: id, productId: "p-a", name: "লেদার ওয়ালেট", sku: "WAL-1",
        quantity: 1, priceMinor: 50000n, totalMinor: 50000n, isGift: false, bundleName: null, createdAt: T0,
      });
    };
    mkOrder("ord-a1", a.customer.id, "ORD-A1", 2);
    mkOrder("ord-a2", a.customer.id, "ORD-A2", 3);
    mkOrder("ord-b1", b.customer.id, "ORD-B1", 4);
    return { ...world, a, b };
  }

  it("one customer's token never returns the other's orders; foreign reorder/detail 404", async () => {
    const { accounts, a, b } = await twoCustomersWithOrders();
    const listA: any = await accounts.listOrders("shop-one", a.token, 1, 20);
    expect(listA.items.map((o: any) => o.id).sort()).toEqual(["ord-a1", "ord-a2"]);
    expect(listA.pagination.total).toBe(2);
    expect(listA.items[0].orderNumber).toBe("ORD-A2"); // newest placedAt first
    expect(listA.items[0].items[0]).toMatchObject({ name: "লেদার ওয়ালেট", priceMinor: "50000", totalMinor: "50000", isGift: false });
    expect(listA.items[0].hasTracking).toBe(true);

    const detail: any = await accounts.getOrder("shop-one", a.token, "ord-a1");
    expect(detail).toMatchObject({ id: "ord-a1", subtotalMinor: "50000", deliveryMinor: "6000", shippingMinor: "6000", discountMinor: "0", address: "বাড়ি ১", giftSkipped: false });

    await expect(accounts.getOrder("shop-one", a.token, "ord-b1")).rejects.toBeInstanceOf(NotFoundException);
    await expect(accounts.reorder("shop-one", a.token, "ord-b1")).rejects.toThrow("অর্ডারটি পাওয়া যায়নি");
    const listB: any = await accounts.listOrders("shop-one", b.token, 1, 20);
    expect(listB.items.map((o: any) => o.id)).toEqual(["ord-b1"]);
  });
});

describe("EC25 (i) reorder", () => {
  it("discontinued → unavailable; out-of-stock → unavailable; in-stock → CURRENT price with qty clamped to stock; productId-less line → catalogue reason", async () => {
    const { prisma, accounts, sms } = makeWorld();
    const a = await login(accounts, sms);
    prisma.product.rows.find((p: any) => p.id === "p-disc").status = "INACTIVE";
    prisma.productVariant.rows[0].priceMinor = 58000n; // price moved since the order
    prisma.order.rows.push({
      id: "ord-r", organizationId: "org-1", customerId: a.customer.id, externalId: "ext-r", externalNumber: "ORD-R",
      status: "completed", subtotalMinor: 0n, shippingMinor: 0n, discountMinor: 0n, totalMinor: 0n,
      placedAt: new Date(), createdAt: T0, updatedAt: T0, address: null, giftSkipped: false,
    });
    prisma.orderItem.rows.push(
      { id: "ri-1", orderId: "ord-r", productId: "p-disc", name: "পুরনো পণ্য", sku: "DISC-1", quantity: 1, priceMinor: 20000n, totalMinor: 20000n, isGift: false, createdAt: T0 },
      { id: "ri-2", orderId: "ord-r", productId: "p-oos", name: "শেষ পণ্য", sku: "OOS-1", quantity: 2, priceMinor: 30000n, totalMinor: 60000n, isGift: false, createdAt: T0 },
      { id: "ri-3", orderId: "ord-r", productId: "p-a", name: "লেদার ওয়ালেট", sku: "WAL-1-BLK", quantity: 5, priceMinor: 55000n, totalMinor: 275000n, isGift: false, createdAt: T0 },
      { id: "ri-4", orderId: "ord-r", productId: null, name: "রহস্য পণ্য", sku: null, quantity: 1, priceMinor: 1000n, totalMinor: 1000n, isGift: false, createdAt: T0 },
    );
    const res: any = await accounts.reorder("shop-one", a.token, "ord-r");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      productId: "p-a", variantId: "v-a1", variantSku: "WAL-1-BLK",
      quantity: 3, // clamped from 5 to the variant's stock of 3
      currentPriceMinor: "58000", // CURRENT variant price, not the ordered 55000
      available: true,
    });
    const reasons = Object.fromEntries(res.unavailable.map((u: any) => [u.name, u.reason]));
    expect(reasons["পুরনো পণ্য"]).toBe("পণ্যটি আর পাওয়া যাচ্ছে না");
    expect(reasons["শেষ পণ্য"]).toBe("স্টক শেষ");
    expect(reasons["রহস্য পণ্য"]).toBe("পণ্যটি এখন ক্যাটালগে নেই");
  });
});

describe("EC25 (j) wishlist", () => {
  it("price drop is honest against the add-time snapshot; merge counts are honest; foreign product 404s", async () => {
    const { prisma, accounts, sms } = makeWorld();
    const a = await login(accounts, sms);
    const added: any = await accounts.addWishlist("shop-one", a.token, "p-a");
    expect(added.item).toMatchObject({ productId: "p-a", priceAtAddMinor: "50000", currentPriceMinor: "50000", priceDropped: false, stockState: "in_stock" });
    // re-add keeps the original snapshot
    const again: any = await accounts.addWishlist("shop-one", a.token, "p-a");
    expect(again.item.priceAtAddMinor).toBe("50000");
    expect(prisma.wishlistItem.rows).toHaveLength(1);

    prisma.product.rows.find((p: any) => p.id === "p-a").priceMinor = 40000n;
    const list: any = await accounts.listWishlist("shop-one", a.token);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ currentPriceMinor: "40000", priceAtAddMinor: "50000", priceDropped: true });

    const merged: any = await accounts.mergeWishlist("shop-one", a.token, ["p-b", "p-a", "p-foreign", "missing-id"]);
    expect(merged).toEqual({ added: 1, skipped: 3 });

    await expect(accounts.addWishlist("shop-one", a.token, "p-foreign")).rejects.toThrow("পণ্যটি পাওয়া যায়নি");

    const removed: any = await accounts.removeWishlist("shop-one", a.token, "p-b");
    expect(removed).toEqual({ removed: true });
    const removedAgain: any = await accounts.removeWishlist("shop-one", a.token, "p-b");
    expect(removedAgain).toEqual({ removed: false });
  });
});

describe("EC25 (k) addresses", () => {
  it("first address becomes default; setting a new default unsets the old; deleting the default promotes the oldest; foreign PATCH 404s", async () => {
    const { prisma, accounts, sms } = makeWorld();
    const a = await login(accounts, sms, "01711111111");
    const b = await login(accounts, sms, "01822222222");
    const dto = (line: string) => ({ recipientName: "রহিম", phone: "01711111111", addressLine: line, district: "ঢাকা" });

    const first: any = await accounts.createAddress("shop-one", a.token, dto("বাড়ি ১"));
    expect(first.isDefault).toBe(true);
    const second: any = await accounts.createAddress("shop-one", a.token, { ...dto("বাড়ি ২"), isDefault: true });
    expect(second.isDefault).toBe(true);
    let list: any = await accounts.listAddresses("shop-one", a.token);
    expect(list.items.find((x: any) => x.id === first.id).isDefault).toBe(false);
    expect(list.items[0].id).toBe(second.id); // default sorts first

    const meRes: any = await accounts.me("shop-one", a.token);
    expect(meRes.defaultAddress.id).toBe(second.id);

    // foreign address: b cannot touch a's address
    await expect(accounts.updateAddress("shop-one", b.token, first.id, { addressLine: "হ্যাক" })).rejects.toThrow("ঠিকানাটি পাওয়া যায়নি");
    await expect(accounts.deleteAddress("shop-one", b.token, first.id)).rejects.toBeInstanceOf(NotFoundException);

    // deleting the default promotes the oldest remaining
    await accounts.deleteAddress("shop-one", a.token, second.id);
    list = await accounts.listAddresses("shop-one", a.token);
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe(first.id);
    expect(list.items[0].isDefault).toBe(true);
    expect(prisma.customerAddress.rows).toHaveLength(1);
  });

  it("profile update: name → firstName, email set + clear", async () => {
    const { prisma, accounts, sms } = makeWorld();
    const a = await login(accounts, sms);
    const upd: any = await accounts.updateProfile("shop-one", a.token, { name: "রহিম উদ্দিন", email: "rahim@example.com" });
    expect(upd.customer).toMatchObject({ name: "রহিম উদ্দিন", email: "rahim@example.com" });
    expect(prisma.customer.rows[0].firstName).toBe("রহিম উদ্দিন");
    const cleared: any = await accounts.updateProfile("shop-one", a.token, { email: null });
    expect(cleared.customer.email).toBeNull();
  });
});

describe("EC25 (l) checkout session pin", () => {
  function makeCheckoutWorld() {
    const prisma = makePrisma();
    seedShop(prisma);
    const integrations = {
      upsertOrder: jest.fn(async (orgId: string, _storeId: any, payload: any, source: string) => {
        prisma.order.rows.push({
          id: `order-${prisma.order.rows.length + 1}`, organizationId: orgId, source,
          externalId: payload.externalId, externalNumber: payload.externalNumber,
          totalMinor: payload.totalMinor, createdAt: new Date(), updatedAt: new Date(),
        });
        return "created";
      }),
    };
    const svc = new StorefrontService(prisma, integrations as any);
    return { prisma, integrations, svc };
  }

  async function cartWith(svc: StorefrontService) {
    const { cartToken } = await svc.createCart("shop-one");
    await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 1 });
    return cartToken;
  }
  const dtoFor = (cartToken: string, phone: string) => ({
    cartToken, name: "রহিম", phone, address: "বাড়ি ১, রোড ২", district: "ঢাকা",
  });

  it("valid session + matching phone pins customerId on the upsert payload", async () => {
    const { prisma, integrations, svc } = makeCheckoutWorld();
    const sms = makeSmsStub(true);
    const accounts = new ShopAccountService(prisma, sms as any);
    const a = await login(accounts, sms, "01711111111");
    const cartToken = await cartWith(svc);
    const res: any = await svc.checkout("shop-one", dtoFor(cartToken, "01711111111"), a.token);
    expect(res.success).toBe(true);
    const payload = (integrations.upsertOrder as jest.Mock).mock.calls[0][2];
    expect(payload.customerId).toBe(a.customer.id);
  });

  it("session with a MISMATCHED phone does not pin — guest upsert as before", async () => {
    const { prisma, integrations, svc } = makeCheckoutWorld();
    const sms = makeSmsStub(true);
    const accounts = new ShopAccountService(prisma, sms as any);
    const a = await login(accounts, sms, "01711111111");
    const cartToken = await cartWith(svc);
    const res: any = await svc.checkout("shop-one", dtoFor(cartToken, "01899999999"), a.token);
    expect(res.success).toBe(true);
    const payload = (integrations.upsertOrder as jest.Mock).mock.calls[0][2];
    expect("customerId" in payload).toBe(false);
  });

  it("no token → payload carries no customerId (guest parity)", async () => {
    const { integrations, svc } = makeCheckoutWorld();
    const cartToken = await cartWith(svc);
    const res: any = await svc.checkout("shop-one", dtoFor(cartToken, "01711111111"));
    expect(res.success).toBe(true);
    const payload = (integrations.upsertOrder as jest.Mock).mock.calls[0][2];
    expect("customerId" in payload).toBe(false);
  });

  it("invalid token is IGNORED — checkout still succeeds as a guest", async () => {
    const { integrations, svc } = makeCheckoutWorld();
    const cartToken = await cartWith(svc);
    const res: any = await svc.checkout("shop-one", dtoFor(cartToken, "01711111111"), "f".repeat(64));
    expect(res.success).toBe(true);
    const payload = (integrations.upsertOrder as jest.Mock).mock.calls[0][2];
    expect("customerId" in payload).toBe(false);
  });
});
