import "reflect-metadata";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { GamifiedPromotionsService } from "./gamified-promotions.service";
import { pickWheelSegment, validateWheelConfig } from "./promo-config";
import { bdPhoneMatchKey } from "../orders/phone-utils";

/**
 * NF6 (FB3) — Gamified promotions specs. Fake-prisma harness in
 * the booking.spec.ts pattern (in-memory tables, org-scoped
 * `matches`). The fake StoreDiscount table enforces the real
 * (organizationId, code) unique; PromoPlay / PromoGroupBuyJoin
 * enforce the real (campaignId, phoneKey) unique — a duplicate
 * create throws a P2002-shaped error exactly like Prisma.
 * BlockedPhoneService is a STUB whose isBlocked call count and
 * verdict pin the Fraud Shield gate.
 */

type Row = Record<string, any>;

function cmp(a: any, b: any): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => matches(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("notIn" in v) return !(v as any).notIn.includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
      if ("lt" in v) return cmp(row[k], (v as any).lt) < 0;
      if ("lte" in v) return cmp(row[k], (v as any).lte) <= 0;
      if ("gt" in v) return cmp(row[k], (v as any).gt) > 0;
      if ("gte" in v) return cmp(row[k], (v as any).gte) >= 0;
      return true;
    }
    if (v instanceof Date) return row[k] instanceof Date && row[k].getTime() === v.getTime();
    return row[k] === v;
  });
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean);
  if (!specs.length) return rows;
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const [key, dir] = Object.entries(spec)[0] as [string, string];
      const c = cmp(a[key], b[key]);
      if (c !== 0) return dir === "desc" ? -c : c;
    }
    return 0;
  });
}

let seq = 0;
function makeTable(rows: Row[], uniqueKeys: string[][] = []) {
  return {
    rows,
    async findFirst({ where }: any = {}) {
      return rows.find((r) => matches(r, where)) ?? null;
    },
    async findMany({ where, orderBy, take }: any = {}) {
      let out = rows.filter((r) => matches(r, where));
      out = sortRows(out, orderBy);
      if (take) out = out.slice(0, take);
      return out;
    },
    async create({ data }: any) {
      for (const keys of uniqueKeys) {
        if (rows.some((r) => keys.every((k) => r[k] === data[k]))) {
          throw new Error("Unique constraint failed on the fields: P2002");
        }
      }
      const row = {
        id: `row-${++seq}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      rows.push(row);
      return row;
    },
    async update({ where, data }: any) {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("record not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async count({ where }: any = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
  };
}

const PHONE_A = "01712345678";
const PHONE_B = "01812345678";
const PHONE_C = "01912345678";
const PHONE_D = "01612345678";

function setup(opts: { blocked?: string[] } = {}) {
  const organizations: Row[] = [
    { id: "org-1", slug: "shop-one", name: "দোকান এক" },
    { id: "org-2", slug: "shop-two", name: "দোকান দুই" },
  ];
  const storefrontSettings: Row[] = [
    { id: "ss-1", organizationId: "org-1", shopEnabled: true },
    { id: "ss-2", organizationId: "org-2", shopEnabled: true },
  ];
  const products: Row[] = [
    { id: "p-1", organizationId: "org-1", name: "কটন শার্ট", slug: "cotton-shirt", categoryId: "cat-1", category: "শার্ট", priceMinor: 120000n, compareAtMinor: null, imageUrl: null, status: "ACTIVE", createdAt: new Date() },
    { id: "p-2", organizationId: "org-1", name: "ডেনিম শার্ট", slug: "denim-shirt", categoryId: "cat-1", category: "শার্ট", priceMinor: 150000n, compareAtMinor: null, imageUrl: null, status: "ACTIVE", createdAt: new Date() },
    { id: "p-3", organizationId: "org-2", name: "অন্য দোকানের শার্ট", slug: "other-shirt", categoryId: "cat-1", category: "শার্ট", priceMinor: 90000n, compareAtMinor: null, imageUrl: null, status: "ACTIVE", createdAt: new Date() },
    { id: "gb-1", organizationId: "org-1", name: "গ্রুপ বাই পণ্য", slug: "gb-product", categoryId: null, category: null, priceMinor: 200000n, compareAtMinor: null, imageUrl: null, status: "ACTIVE", createdAt: new Date() },
  ];
  const promoCampaigns: Row[] = [];
  const promoPlays: Row[] = [];
  const promoGroupBuyJoins: Row[] = [];
  const storeDiscounts: Row[] = [];
  const prisma: any = {
    organization: makeTable(organizations),
    storefrontSetting: makeTable(storefrontSettings),
    product: makeTable(products),
    productTag: makeTable([]),
    productTagAssignment: makeTable([]),
    promoCampaign: makeTable(promoCampaigns),
    promoPlay: makeTable(promoPlays, [["campaignId", "phoneKey"]]),
    promoGroupBuyJoin: makeTable(promoGroupBuyJoins, [["campaignId", "phoneKey"]]),
    storeDiscount: makeTable(storeDiscounts, [["organizationId", "code"]]),
  };
  const blockedStub = {
    // the real BlockedPhoneService matches on the phone match
    // key, so the stub does the same (the service passes the
    // canonical +880… form).
    isBlocked: jest.fn(async (_orgId: string, phone: string) =>
      (opts.blocked ?? []).some((b) => bdPhoneMatchKey(b) === bdPhoneMatchKey(phone))),
  };
  const auditStub = { log: jest.fn(async () => undefined) };
  const service = new GamifiedPromotionsService(prisma, auditStub as any, blockedStub as any);
  return {
    service, prisma, blockedStub,
    tables: { promoCampaigns, promoPlays, promoGroupBuyJoins, storeDiscounts, products },
  };
}

async function makeWheel(service: any, orgId = "org-1", segments?: any[]) {
  const { campaign } = await service.createCampaign(orgId, "u1", {
    kind: "spin_wheel",
    name: "ঈদ স্পিন",
    config: {
      segments: segments ?? [
        { label: "কিছু না", weight: 100, prizeKind: "none" },
        { label: "৫০% ছাড়", weight: 0, prizeKind: "percent", prizeValue: 50 },
      ],
      couponExpiryHours: 48,
    },
  });
  return campaign;
}

async function makeQuiz(service: any, orgId = "org-1") {
  const { campaign } = await service.createCampaign(orgId, "u1", {
    kind: "quiz",
    name: "পণ্য খুঁজুন",
    config: {
      questions: [
        {
          text: "কোন ধরনের পোশাক খুঁজছেন?",
          options: [
            { text: "শার্ট", categoryId: "cat-1" },
            { text: "অন্য কিছু", categoryId: "cat-2" },
          ],
        },
      ],
      completionCoupon: { kind: "percent", value: 10 },
    },
  });
  return campaign;
}

async function makeGroupBuy(service: any, orgId = "org-1", requiredBuyers = 3) {
  const { campaign } = await service.createCampaign(orgId, "u1", {
    kind: "group_buy",
    name: "গ্রুপ বাই অফার",
    endsAt: new Date(Date.now() + 3600_000).toISOString(),
    config: {
      productId: "gb-1",
      requiredBuyers,
      discountKind: "percent",
      discountValue: 15,
    },
  });
  return campaign;
}

// ================= (a) server-side outcome =================

describe("NF6 spin wheel — server-side outcome", () => {
  it("pickWheelSegment walks weights and never lands on a zero-weight segment", () => {
    const config = validateWheelConfig({
      segments: [
        { label: "কিছু না", weight: 100, prizeKind: "none" },
        { label: "৫০% ছাড়", weight: 0, prizeKind: "percent", prizeValue: 50 },
      ],
    });
    for (let roll = 0; roll < 100; roll++) {
      expect(pickWheelSegment(config, roll)).toBe(0);
    }
  });

  it("a client-claimed winning segment is ignored — the server weights decide (loss)", async () => {
    const { service, tables } = setup();
    const campaign = await makeWheel(service);
    const res = await service.publicSpinPlay("shop-one", campaign.id, {
      phone: PHONE_A, claimedSegmentIndex: 1,
    });
    expect(res.play.outcome).toBe("lost");
    expect(res.play.segmentIndex).toBe(0);
    expect(res.play.couponCode).toBeNull();
    expect(tables.storeDiscounts).toHaveLength(0);
  });

  it("a client-claimed losing segment is ignored too — the server weights decide (win)", async () => {
    const { service } = setup();
    const campaign = await makeWheel(service, "org-1", [
      { label: "কিছু না", weight: 0, prizeKind: "none" },
      { label: "৫০% ছাড়", weight: 100, prizeKind: "percent", prizeValue: 50 },
    ]);
    const res = await service.publicSpinPlay("shop-one", campaign.id, {
      phone: PHONE_A, claimedSegmentIndex: 0,
    });
    expect(res.play.outcome).toBe("won");
    expect(res.play.segmentIndex).toBe(1);
    expect(res.play.couponCode).toMatch(/^WIN-/);
  });

  it("the public campaign shape never leaks segment weights or prize values", async () => {
    const { service } = setup();
    await makeWheel(service);
    const active = await service.publicActive("shop-one");
    const wheel = active.campaigns.find((c: any) => c.kind === "spin_wheel");
    expect(wheel.segments).toEqual([{ label: "কিছু না" }, { label: "৫০% ছাড়" }]);
    expect(JSON.stringify(wheel)).not.toContain("weight");
    expect(JSON.stringify(wheel)).not.toContain("prizeValue");
  });
});

// ================= (b) one play per phone =================

describe("NF6 one-play-per-phone (Fraud Shield key + unique)", () => {
  it("a second play from the same phone (any format) is the same play — no second coupon", async () => {
    const { service, tables } = setup();
    const campaign = await makeWheel(service, "org-1", [
      { label: "১০% ছাড়", weight: 100, prizeKind: "percent", prizeValue: 10 },
      { label: "কিছু না", weight: 0, prizeKind: "none" },
    ]);
    const first = await service.publicSpinPlay("shop-one", campaign.id, { phone: PHONE_A });
    expect(first.play.alreadyPlayed).toBe(false);
    // same subscriber number in international format
    const second = await service.publicSpinPlay("shop-one", campaign.id, { phone: "+8801712345678" });
    expect(second.play.alreadyPlayed).toBe(true);
    expect(second.play.id).toBe(first.play.id);
    expect(second.play.couponCode).toBe(first.play.couponCode);
    expect(tables.promoPlays).toHaveLength(1);
    expect(tables.storeDiscounts).toHaveLength(1);
  });

  it("a BlockedPhone (Fraud Shield) number is refused before any play is written", async () => {
    const { service, tables, blockedStub } = setup({ blocked: [PHONE_A] });
    const campaign = await makeWheel(service);
    await expect(
      service.publicSpinPlay("shop-one", campaign.id, { phone: PHONE_A }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(blockedStub.isBlocked).toHaveBeenCalled();
    expect(tables.promoPlays).toHaveLength(0);
    expect(tables.storeDiscounts).toHaveLength(0);
  });

  it("an invalid phone is a Bengali 400, never a play", async () => {
    const { service, tables } = setup();
    const campaign = await makeWheel(service);
    await expect(
      service.publicSpinPlay("shop-one", campaign.id, { phone: "12345" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tables.promoPlays).toHaveLength(0);
  });
});

// ================= (c) coupon exactly once =================

describe("NF6 coupon issuance — exactly once through the existing engine", () => {
  it("a win creates ONE single-use StoreDiscount (usageLimit 1, origin gamified_promo, sourceRef play id)", async () => {
    const { service, tables } = setup();
    const campaign = await makeWheel(service, "org-1", [
      { label: "২০% ছাড়", weight: 100, prizeKind: "percent", prizeValue: 20 },
      { label: "কিছু না", weight: 0, prizeKind: "none" },
    ]);
    const res = await service.publicSpinPlay("shop-one", campaign.id, { phone: PHONE_A });
    expect(tables.storeDiscounts).toHaveLength(1);
    const coupon = tables.storeDiscounts[0];
    expect(coupon.code).toBe(res.play.couponCode);
    expect(coupon.kind).toBe("percent");
    expect(coupon.value).toBe(20);
    expect(coupon.usageLimit).toBe(1);
    expect(coupon.perCustomerLimit).toBe(1);
    expect(coupon.origin).toBe("gamified_promo");
    expect(coupon.sourceRef).toBe(`nf6:play:${res.play.id}`);
    expect(coupon.organizationId).toBe("org-1");
    expect(coupon.endsAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("replays and double-submits never create a second coupon", async () => {
    const { service, tables } = setup();
    const campaign = await makeWheel(service, "org-1", [
      { label: "২০% ছাড়", weight: 100, prizeKind: "percent", prizeValue: 20 },
      { label: "কিছু না", weight: 0, prizeKind: "none" },
    ]);
    await service.publicSpinPlay("shop-one", campaign.id, { phone: PHONE_A });
    await service.publicSpinPlay("shop-one", campaign.id, { phone: PHONE_A });
    await service.publicSpinPlay("shop-one", campaign.id, { phone: PHONE_A });
    expect(tables.promoPlays).toHaveLength(1);
    expect(tables.storeDiscounts).toHaveLength(1);
  });

  it("quiz completion coupon is also exactly once per phone", async () => {
    const { service, tables } = setup();
    const quiz = await makeQuiz(service);
    const first = await service.publicQuizComplete("shop-one", quiz.id, { phone: PHONE_A, answers: [0] });
    const second = await service.publicQuizComplete("shop-one", quiz.id, { phone: PHONE_A, answers: [0] });
    expect(second.play.alreadyPlayed).toBe(true);
    expect(second.play.couponCode).toBe(first.play.couponCode);
    expect(tables.storeDiscounts).toHaveLength(1);
    expect(tables.storeDiscounts[0].sourceRef).toBe(`nf6:play:${first.play.id}`);
  });
});

// ================= (d) group buy threshold + expiry =================

describe("NF6 group buy — threshold math and expiry", () => {
  it("N-1 joiners = no discount; the Nth join unlocks a real product-scoped coupon for EVERY joiner", async () => {
    const { service, tables } = setup();
    const gb = await makeGroupBuy(service, "org-1", 3);
    const j1 = await service.publicGroupBuyJoin("shop-one", gb.id, { phone: PHONE_A });
    expect(j1.status).toBe("open");
    expect(j1.joinedCount).toBe(1);
    expect(j1.join.couponCode).toBeNull();
    const j2 = await service.publicGroupBuyJoin("shop-one", gb.id, { phone: PHONE_B });
    expect(j2.status).toBe("open");
    expect(j2.joinedCount).toBe(2);
    expect(tables.storeDiscounts).toHaveLength(0);

    const j3 = await service.publicGroupBuyJoin("shop-one", gb.id, { phone: PHONE_C });
    expect(j3.status).toBe("unlocked");
    expect(j3.join.status).toBe("unlocked");
    expect(j3.join.couponCode).toMatch(/^GB-/);
    // every joiner got exactly one coupon, scoped to the product
    expect(tables.storeDiscounts).toHaveLength(3);
    for (const coupon of tables.storeDiscounts) {
      expect(coupon.scopeType).toBe("products");
      expect(coupon.scopeIds).toEqual(["gb-1"]);
      expect(coupon.usageLimit).toBe(1);
      expect(coupon.origin).toBe("gamified_promo");
      expect(coupon.sourceRef).toMatch(/^nf6:groupbuy:/);
    }
    // settling again issues nothing new (exactly-once)
    const status = await service.publicGroupBuyStatus("shop-one", gb.id);
    expect(status.status).toBe("unlocked");
    expect(tables.storeDiscounts).toHaveLength(3);
    // re-joining after unlock returns the same coupon
    const again = await service.publicGroupBuyJoin("shop-one", gb.id, { phone: PHONE_A });
    expect(again.join.alreadyJoined).toBe(true);
    expect(again.join.couponCode).toBeTruthy();
    expect(tables.storeDiscounts).toHaveLength(3);
  });

  it("window expires unmet → no discount, no charge, joins flip to expired and stay staff-visible", async () => {
    const { service, tables } = setup();
    const gb = await makeGroupBuy(service, "org-1", 3);
    await service.publicGroupBuyJoin("shop-one", gb.id, { phone: PHONE_A });
    await service.publicGroupBuyJoin("shop-one", gb.id, { phone: PHONE_B });
    // the window passes with only 2 of 3
    tables.promoCampaigns.find((c) => c.id === gb.id)!.endsAt = new Date(Date.now() - 1000);
    const status = await service.publicGroupBuyStatus("shop-one", gb.id);
    expect(status.status).toBe("expired_unmet");
    expect(tables.storeDiscounts).toHaveLength(0);
    const joins = await service.listJoins("org-1", gb.id);
    expect(joins.map((j: any) => j.status)).toEqual(["expired", "expired"]);
    // joining after the window is refused honestly
    await expect(
      service.publicGroupBuyJoin("shop-one", gb.id, { phone: PHONE_D }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // and the expired campaign is no longer presented on the shop
    const active = await service.publicActive("shop-one");
    expect(active.campaigns.find((c: any) => c.id === gb.id)).toBeUndefined();
  });

  it("the public group-buy shape states the no-prepayment rule in Bengali", async () => {
    const { service } = setup();
    await makeGroupBuy(service);
    const active = await service.publicActive("shop-one");
    const gb = active.campaigns.find((c: any) => c.kind === "group_buy");
    expect(gb.noPrepaymentNote).toContain("কোনো অগ্রিম পেমেন্ট নেওয়া হয় না");
    expect(gb.product.name).toBe("গ্রুপ বাই পণ্য");
    expect(gb.requiredBuyers).toBe(3);
    expect(gb.discountLabel).toBe("15% ছাড়");
  });

  it("a group buy without a window end, or on another org's product, is refused at save", async () => {
    const { service } = setup();
    await expect(service.createCampaign("org-1", "u1", {
      kind: "group_buy", name: "x",
      config: { productId: "gb-1", requiredBuyers: 3, discountKind: "percent", discountValue: 10 },
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createCampaign("org-2", "u2", {
      kind: "group_buy", name: "x",
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
      config: { productId: "gb-1", requiredBuyers: 3, discountKind: "percent", discountValue: 10 },
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ================= (e) org isolation =================

describe("NF6 org isolation", () => {
  it("public endpoints never cross orgs: org-2's campaign is invisible and unplayable via org-1's slug", async () => {
    const { service } = setup();
    const foreign = await makeWheel(service, "org-2");
    const active = await service.publicActive("shop-one");
    expect(active.campaigns.find((c: any) => c.id === foreign.id)).toBeUndefined();
    await expect(
      service.publicSpinPlay("shop-one", foreign.id, { phone: PHONE_A }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const mine = await service.publicActive("shop-two");
    expect(mine.campaigns.find((c: any) => c.id === foreign.id)).toBeTruthy();
  });

  it("staff reads are org-scoped: org-2's list never contains org-1's campaign", async () => {
    const { service } = setup();
    const mine = await makeWheel(service, "org-1");
    const list2 = await service.listCampaigns("org-2");
    expect(list2.campaigns.find((c: any) => c.id === mine.id)).toBeUndefined();
    await expect(service.getCampaign("org-2", mine.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("an unknown shop slug is a 404 on every public surface", async () => {
    const { service } = setup();
    await expect(service.publicActive("no-such-shop")).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ================= (f) quiz results =================

describe("NF6 quiz — result maps to the org's own products only", () => {
  it("answers mapping to a category return only THIS org's ACTIVE products of that category", async () => {
    const { service } = setup();
    const quiz = await makeQuiz(service);
    const res = await service.publicQuizComplete("shop-one", quiz.id, { phone: PHONE_A, answers: [0] });
    expect(res.resultKey).toBe("cat:cat-1");
    const ids = res.products.map((p: any) => p.id).sort();
    expect(ids).toEqual(["p-1", "p-2"]); // p-3 is org-2's — never leaks
    expect(res.play.outcome).toBe("completed");
    expect(res.play.couponCode).toMatch(/^WIN-/); // configured completion coupon
  });

  it("incomplete or out-of-range answers are refused, and config without a mapping is refused at save", async () => {
    const { service } = setup();
    const quiz = await makeQuiz(service);
    await expect(
      service.publicQuizComplete("shop-one", quiz.id, { phone: PHONE_A, answers: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.publicQuizComplete("shop-one", quiz.id, { phone: PHONE_A, answers: [9] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createCampaign("org-1", "u1", {
      kind: "quiz", name: "bad",
      config: { questions: [{ text: "q", options: [{ text: "a" }, { text: "b", categoryId: "cat-1" }] }] },
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ================= config validation + stats =================

describe("NF6 config validation and real stats", () => {
  it("a wheel whose total weight is zero is refused at save", async () => {
    const { service } = setup();
    await expect(service.createCampaign("org-1", "u1", {
      kind: "spin_wheel", name: "bad",
      config: {
        segments: [
          { label: "a", weight: 0, prizeKind: "none" },
          { label: "b", weight: 0, prizeKind: "none" },
        ],
      },
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("stats count plays/wins/coupons from the real rows, redemptions from StoreDiscount.usedCount", async () => {
    const { service, tables } = setup();
    const campaign = await makeWheel(service, "org-1", [
      { label: "১০% ছাড়", weight: 100, prizeKind: "percent", prizeValue: 10 },
      { label: "কিছু না", weight: 0, prizeKind: "none" },
    ]);
    await service.publicSpinPlay("shop-one", campaign.id, { phone: PHONE_A });
    await service.publicSpinPlay("shop-one", campaign.id, { phone: PHONE_B });
    let detail = await service.getCampaign("org-1", campaign.id);
    expect(detail.campaign.stats).toEqual({
      plays: 2, wins: 2, completions: 0, couponsIssued: 2, couponsRedeemed: 0,
    });
    // simulate checkout redemption of one issued coupon
    tables.storeDiscounts[0].usedCount = 1;
    detail = await service.getCampaign("org-1", campaign.id);
    expect(detail.campaign.stats.couponsRedeemed).toBe(1);
    expect(detail.plays).toHaveLength(2);
  });
});
