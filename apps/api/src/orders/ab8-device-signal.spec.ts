import "reflect-metadata";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  IDENTIFIER_KINDS, deviceHashPrefix, maskIdentifier,
  normalizeDeviceHash, normalizeIdentifier,
} from "../fraud/identifier-utils";
import { IdentifierListsService } from "../fraud/identifier-lists.service";
import { FraudAttemptLogService } from "../fraud/fraud-attempt-log.service";
import { CheckoutGuardService } from "../fraud/checkout-guard.service";
import { IdempotencyService } from "../fraud/idempotency.service";
import { FRAUD_WEIGHTS, scoreFraud } from "./fraud-score";
import { FraudShieldService } from "./fraud-shield.service";
import { OrdersService } from "./orders.service";
import { ProductsService } from "../products/products.service";
import { DiscountsService } from "../commerce/discounts.service";
import { PromotionsService } from "../commerce/promotions.service";
import { CheckoutDto, ExpressCheckoutDto } from "../storefront/storefront.dto";
import { PublicCheckoutOrderDto } from "../products/products.dto";
import { LandingOrderDto } from "../landings/landings.dto";

/**
 * AB8 (AX27) — device-fingerprint fraud signal: device
 * identifier kind, checkout-gate block, device-velocity
 * scoring (FraudShield), checkout stamping and the staff
 * payload prefix. Fake-Prisma harness in the gb3 style.
 */

const HASH = "0123456789abcdef".repeat(4); // 64 hex chars
const HASH_PREFIX = "0123456789ab";
const OTHER_HASH = "f".repeat(64);
const PHONE = "01711111111";

// ---------- fake prisma (gb3 style) ----------

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const c: any = v;
      if ("in" in c) { if (!c.in.map(String).includes(String(row[k]))) return false; continue; }
      if ("gte" in c) { if (!(new Date(row[k]).getTime() >= new Date(c.gte).getTime())) return false; continue; }
      continue;
    }
    if (v === null) { if (row[k] !== null && row[k] !== undefined) return false; continue; }
    if (String(row[k]) !== String(v)) return false;
  }
  return true;
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  const findFirst = async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null;
  return {
    rows,
    findFirst,
    findUnique: findFirst,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let out = rows.filter((r) => matchWhere(r, where));
      if (orderBy) {
        const [field, dir] = Object.entries(orderBy)[0] as [string, string];
        out = [...out].sort((a, b) => {
          const cmp = new Date(a[field] ?? 0).getTime() - new Date(b[field] ?? 0).getTime();
          return dir === "desc" ? -cmp : cmp;
        });
      }
      if (skip) out = out.slice(skip);
      if (take !== undefined) out = out.slice(0, take);
      return out;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
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
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (row) { Object.assign(row, update); return row; }
      const created = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(created);
      return created;
    },
  };
}

const auditStub: any = { log: jest.fn(async () => undefined) };

function makeFraudWorld() {
  const prisma: any = {
    order: makeTable("order"),
    customer: makeTable("customer"),
    blockedIdentifier: makeTable("blockedIdentifier"),
    trustedIdentifier: makeTable("trustedIdentifier"),
    fraudAttemptLog: makeTable("fraudAttemptLog"),
    fraudShieldSetting: makeTable("fraudShieldSetting"),
    courierShipment: makeTable("courierShipment"),
    returnRequest: makeTable("returnRequest"),
  };
  prisma.fraudShieldSetting.rows.push({
    id: "set-1", organizationId: "org-1", enabled: true, autoHoldEnabled: false,
    autoHoldBand: "high", highValueMinor: 500000n, burstCount: 3, burstWindowHours: 24,
    openOrderPolicy: "off", openOrderWindowHours: 72, waitingPeriodMinutes: 0,
    maxOrdersPerPhonePerDay: 0, captchaEnabled: false, captchaOnCheckout: true,
    captchaOnOtp: false, turnstileSiteKey: null, turnstileSecretEncrypted: null,
  });
  const audit = { log: jest.fn(async () => undefined) };
  const identifiers = new IdentifierListsService(prisma, audit as any);
  const attempts = new FraudAttemptLogService(prisma);
  const turnstile = { verify: jest.fn(async () => ({ ok: true, providerError: false })) };
  const guard = new CheckoutGuardService(prisma, identifiers, attempts, turnstile as any);
  return { prisma, audit, identifiers, attempts, guard };
}

// ---------- 1. identifier utils ----------

describe("AB8 identifier utils — device kind", () => {
  it("IDENTIFIER_KINDS gains device", () => {
    expect(IDENTIFIER_KINDS).toContain("device");
  });
  it("normalize device: valid 64-hex → value=matchKey, trim + lowercase", () => {
    expect(normalizeIdentifier("device", HASH)).toEqual({ value: HASH, matchKey: HASH });
    expect(normalizeIdentifier("device", `  ${HASH.toUpperCase()} `)).toEqual({ value: HASH, matchKey: HASH });
    expect(normalizeDeviceHash(HASH.toUpperCase())).toBe(HASH);
  });
  it("normalize device: invalid shapes → null", () => {
    expect(normalizeDeviceHash(HASH.slice(0, 63))).toBeNull();
    expect(normalizeDeviceHash(`${HASH}0`)).toBeNull();
    expect(normalizeDeviceHash("g".repeat(64))).toBeNull();
    expect(normalizeDeviceHash("not-a-hash")).toBeNull();
    expect(normalizeDeviceHash("")).toBeNull();
    expect(normalizeDeviceHash(null)).toBeNull();
    expect(normalizeDeviceHash(undefined)).toBeNull();
    expect(normalizeIdentifier("device", 12345)).toBeNull();
  });
  it("prefix + mask expose ONLY the first 12 chars", () => {
    expect(deviceHashPrefix(HASH)).toBe(HASH_PREFIX);
    expect(maskIdentifier("device", HASH)).toBe(`${HASH_PREFIX}…`);
    expect(maskIdentifier("device", HASH)).not.toContain(HASH);
  });
});

// ---------- 2. identifier lists ----------

describe("AB8 IdentifierListsService — device", () => {
  it("add device normalizes; audit masked = prefix only, full hash nowhere in audit", async () => {
    const { identifiers, audit } = makeFraudWorld();
    const row: any = await identifiers.add("org-1", "actor-1", "blocked", { kind: "device", value: HASH.toUpperCase() });
    expect(row.value).toBe(HASH);
    expect(row.matchKey).toBe(HASH);
    const call = (audit.log as jest.Mock).mock.calls.find((c) => c[0].action === "orders.blocked_identifier_added");
    expect(call[0].metadata).toEqual({ kind: "device", masked: HASH_PREFIX });
    expect(JSON.stringify(call[0].metadata)).not.toContain(HASH);
  });
  it("add device invalid → the Bengali device message", async () => {
    const { identifiers } = makeFraudWorld();
    await expect(identifiers.add("org-1", "a", "blocked", { kind: "device", value: "xyz" }))
      .rejects.toThrow("ডিভাইস হ্যাশটি সঠিক নয় (64-অক্ষরের hex হতে হবে)");
  });
  it("isBlocked matches by deviceHash (any case); other hash / org → no match", async () => {
    const { identifiers } = makeFraudWorld();
    await identifiers.add("org-1", "a", "blocked", { kind: "device", value: HASH });
    await expect(identifiers.isBlocked("org-1", { deviceHash: HASH })).resolves.toEqual({ blocked: true, kind: "device" });
    await expect(identifiers.isBlocked("org-1", { deviceHash: HASH.toUpperCase() })).resolves.toEqual({ blocked: true, kind: "device" });
    await expect(identifiers.isBlocked("org-1", { deviceHash: OTHER_HASH })).resolves.toEqual({ blocked: false, kind: null });
    await expect(identifiers.isBlocked("org-2", { deviceHash: HASH })).resolves.toEqual({ blocked: false, kind: null });
    await expect(identifiers.isBlocked("org-1", { deviceHash: "garbage" })).resolves.toEqual({ blocked: false, kind: null });
  });
});

// ---------- 3. checkout gate ----------

describe("AB8 CheckoutGuardService — blocked device", () => {
  it("refuses with the generic message; ONE attempt log whose summary is prefix-only", async () => {
    const { prisma, guard, identifiers } = makeFraudWorld();
    await identifiers.add("org-1", "a", "blocked", { kind: "device", value: HASH });
    await expect(guard.evaluateGate("org-1", "shop", {
      phone: PHONE, deviceHash: HASH, surface: "checkout",
    })).rejects.toThrow("দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না");
    expect(prisma.fraudAttemptLog.rows).toHaveLength(1);
    const row = prisma.fraudAttemptLog.rows[0];
    expect(row.kind).toBe("blocked_identifier");
    expect(row.identifierSummary).toBe(`${HASH_PREFIX}…`);
    expect(JSON.stringify(row)).not.toContain(HASH);
  });
  it("unblocked / invalid / absent deviceHash passes the gate (never a failure)", async () => {
    const { prisma, guard } = makeFraudWorld();
    await expect(guard.evaluateGate("org-1", "shop", { phone: PHONE, deviceHash: OTHER_HASH, surface: "checkout" }))
      .resolves.toEqual({ trusted: false, warnOpenOrder: false });
    await expect(guard.evaluateGate("org-1", "shop", { phone: PHONE, deviceHash: "garbage", surface: "checkout" }))
      .resolves.toEqual({ trusted: false, warnOpenOrder: false });
    await expect(guard.evaluateGate("org-1", "shop", { phone: PHONE, surface: "checkout" }))
      .resolves.toEqual({ trusted: false, warnOpenOrder: false });
    expect(prisma.fraudAttemptLog.rows).toHaveLength(0);
  });
});

// ---------- 4. pure scorer ----------

const SCORE_BASE = {
  burstCount: 0, burstThreshold: 3, burstWindowHours: 24,
  historyBand: null as string | null, historyScore: null as number | null,
  badOutcomeCount: 0, reliabilityPercent: null as number | null, reliabilityDecided: 0,
  priorOrderCount: 10, totalMinor: 1000n, highValueMinor: 500000n,
  nameMismatch: false, mismatchedName: null as string | null, blocked: false,
  deviceVelocity: 0,
};

describe("AB8 scoreFraud — device_velocity", () => {
  it("weight is capped at 15", () => {
    expect(FRAUD_WEIGHTS.deviceVelocity).toBe(15);
  });
  it("velocity 2 → no device reason", () => {
    const r = scoreFraud({ ...SCORE_BASE, deviceVelocity: 2 });
    expect(r.reasons[0].key).toBe("no_signals");
    expect(r.score).toBe(0);
  });
  it("velocity 3 → +15 with the exact Bengali label", () => {
    const r = scoreFraud({ ...SCORE_BASE, deviceVelocity: 3 });
    expect(r.reasons).toEqual([{
      key: "device_velocity",
      label: "একই ডিভাইস থেকে গত ২৪ ঘণ্টায় 3টি আলাদা নম্বরে অর্ডার এসেছে",
      points: 15,
    }]);
  });
  it("device signal ALONE → score 15, band stays low", () => {
    const r = scoreFraud({ ...SCORE_BASE, deviceVelocity: 9 });
    expect(r.score).toBe(15);
    expect(r.band).toBe("low");
  });
});

// ---------- 5. shield velocity computation ----------

function makeShieldWorld() {
  const w = makeFraudWorld();
  const events = { on: jest.fn(), emit: jest.fn() };
  const risk = { forOrder: jest.fn(async () => ({ band: "low", score: 5 })) };
  const fraud = new FraudShieldService(
    w.prisma, risk as any, undefined, w.audit as any, events as any, undefined,
    undefined, undefined, undefined,
  );
  return { ...w, fraud };
}

function seedShieldOrder(prisma: any, over: any = {}) {
  const customer = { id: "c-1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin", phone: PHONE };
  prisma.customer.rows.push(customer);
  const order = {
    id: "o-1", organizationId: "org-1", customerId: "c-1", customer,
    status: "pending", isCod: true, isPractice: false, totalMinor: 1000n,
    deviceHash: HASH, reviewHold: false, reviewHoldReason: null, reviewHeldAt: null,
    createdAt: new Date(), ...over,
  };
  prisma.order.rows.push(order);
  return order;
}

let rowSeq = 0;
function deviceRow(prisma: any, phone: string, over: any = {}) {
  const id = `o-x${++rowSeq}`;
  prisma.order.rows.push({
    id, organizationId: "org-1", customerId: `c-${id}`,
    customer: { id: `c-${id}`, firstName: "Other", lastName: "Person", phone },
    status: "pending", isCod: true, isPractice: false, totalMinor: 1000n,
    deviceHash: HASH, createdAt: new Date(), ...over,
  });
}

describe("AB8 FraudShieldService — device velocity from the bounded load", () => {
  it("3 DISTINCT other phones in 24h → device_velocity +15, score 15/low; dup/old/own/other-hash/practice rows excluded", async () => {
    const { prisma, fraud } = makeShieldWorld();
    const order = seedShieldOrder(prisma);
    deviceRow(prisma, "01822222222");
    deviceRow(prisma, "01933333333");
    deviceRow(prisma, "01644444444");
    deviceRow(prisma, "01822222222"); // duplicate phone — distinct count unchanged
    deviceRow(prisma, "01555555555", { createdAt: new Date(Date.now() - 25 * 3600 * 1000) }); // outside 24h
    // The order's own phone — excluded from velocity. Same
    // customer name as the target order: a DIFFERENT name on
    // the same phone would legitimately fire the pre-existing
    // phone_name_mismatch signal, which is not under test here.
    deviceRow(prisma, PHONE, { customer: { id: "c-own", firstName: "Rahim", lastName: "Uddin", phone: PHONE } });
    deviceRow(prisma, "01366666666", { deviceHash: OTHER_HASH }); // different device
    deviceRow(prisma, "01477777777", { isPractice: true }); // practice — pool excludes
    const r: any = await fraud.assessOrder("org-1", "o-1");
    expect(r.score).toBe(15);
    expect(r.band).toBe("low");
    expect(r.reasons).toEqual([{
      key: "device_velocity",
      label: "একই ডিভাইস থেকে গত ২৪ ঘণ্টায় 3টি আলাদা নম্বরে অর্ডার এসেছে",
      points: 15,
    }]);
    expect(order.riskScore).toBe(15);
  });
  it("only 2 distinct other phones → no device signal", async () => {
    const { prisma, fraud } = makeShieldWorld();
    seedShieldOrder(prisma);
    deviceRow(prisma, "01822222222");
    deviceRow(prisma, "01933333333");
    const r: any = await fraud.assessOrder("org-1", "o-1");
    expect(r.score).toBe(0);
    expect(r.reasons[0].key).toBe("no_signals");
  });
  it("order without a deviceHash → velocity 0 even with same-device rows around", async () => {
    const { prisma, fraud } = makeShieldWorld();
    seedShieldOrder(prisma, { deviceHash: null });
    deviceRow(prisma, "01822222222");
    deviceRow(prisma, "01933333333");
    deviceRow(prisma, "01644444444");
    const r: any = await fraud.assessOrder("org-1", "o-1");
    expect(r.reasons[0].key).toBe("no_signals");
  });
});

// ---------- 6. DTOs + stamping (single-product wiring, gb3 pattern) ----------

describe("AB8 DTOs — deviceHash field", () => {
  async function deviceHashErrors(cls: any, value: any) {
    const inst = plainToInstance(cls, { deviceHash: value });
    const errs = await validate(inst as any);
    return errs.filter((e) => e.property === "deviceHash");
  }
  it("CheckoutDto / ExpressCheckoutDto / PublicCheckoutOrderDto / LandingOrderDto accept 64-hex, reject 65 chars", async () => {
    for (const cls of [CheckoutDto, ExpressCheckoutDto, PublicCheckoutOrderDto, LandingOrderDto]) {
      expect(await deviceHashErrors(cls, HASH)).toHaveLength(0);
      expect((await deviceHashErrors(cls, "a".repeat(65))).length).toBeGreaterThan(0);
    }
    // LandingOrderDto carries the field via inheritance.
    expect((plainToInstance(LandingOrderDto, { deviceHash: HASH }) as any).deviceHash).toBe(HASH);
  });
});

function makeSingleWorld() {
  const prisma: any = {
    organization: makeTable("org"),
    storefrontSetting: makeTable("set"),
    businessProfile: makeTable("bp"),
    shopPage: makeTable("page"),
    fraudShieldSetting: makeTable("fss"),
    blockedIdentifier: makeTable("bi"),
    trustedIdentifier: makeTable("ti"),
    fraudAttemptLog: makeTable("fal"),
    fraudRule: makeTable("fr"),
    fraudRuleHit: makeTable("frh"),
    customer: makeTable("cust"),
    order: makeTable("ord"),
    idempotencyRecord: makeTable("idem"),
    product: makeTable("p"),
    productVariant: makeTable("pv"),
    promotion: makeTable("promo"),
    storeDiscount: makeTable("disc"),
    deliverySlot: makeTable("slot"),
    category: makeTable("cat"),
  };
  prisma.fraudShieldSetting.rows.push({
    id: "fss-1", organizationId: "org-1", enabled: true,
    openOrderPolicy: "off", openOrderWindowHours: 72, waitingPeriodMinutes: 0,
    maxOrdersPerPhonePerDay: 0, captchaEnabled: false, captchaOnCheckout: true,
    captchaOnOtp: false, turnstileSiteKey: null, turnstileSecretEncrypted: null,
  });
  const T0 = new Date("2026-10-01T00:00:00Z");
  prisma.product.rows.push({
    id: "p-1", organizationId: "org-1", name: "প্রিমিয়াম পণ্য", slug: "prod-one",
    sku: "P-1", status: "ACTIVE", priceMinor: 34000n, compareAtMinor: null,
    categoryId: null, currency: "BDT", stockQuantity: null, preorderEnabled: false,
    digital: false, bumpTitle: null, bumpPriceMinor: null, variants: [],
    organization: {
      id: "org-1", name: "Shop One",
      businessProfile: {
        deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n,
        codAvailable: true, bkashNumber: null, nagadNumber: null, paymentNote: null,
        codMaxOrderMinor: 100000n, codBlockedDistricts: ["Khulna"],
        codAdvanceRequiredAboveMinor: 50000n,
      },
    },
    createdAt: T0, updatedAt: T0,
  });
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true,
    giftWrapEnabled: false, giftWrapFeeMinor: null,
    requireTermsConsent: false, termsUrl: null, createdAt: T0, updatedAt: T0,
  });
  prisma.shopPage.rows.push({
    id: "page-terms", organizationId: "org-1", slug: "terms", title: "শর্তাবলি",
    blocks: [], published: true, showInFooter: true, showInMenu: false, sortOrder: 0,
    isSystem: true, createdAt: T0, updatedAt: T0,
  });
  const discounts = new DiscountsService(prisma, {} as any, auditStub);
  const promotions = new PromotionsService(prisma, discounts, auditStub);
  const captured: any[] = [];
  const integrations: any = {
    captured,
    upsertOrder: jest.fn(async (orgId: string, _s: any, payload: any, source: string) => {
      captured.push(payload);
      prisma.order.rows.push({
        id: `order-${captured.length}`, organizationId: orgId, source,
        externalId: payload.externalId, externalNumber: payload.externalNumber,
        status: payload.status, totalMinor: payload.totalMinor,
        isCod: payload.isCod, isPractice: false, createdAt: new Date(), updatedAt: new Date(),
      });
      return "created";
    }),
  };
  const identifiers = new IdentifierListsService(prisma, auditStub);
  const attempts = new FraudAttemptLogService(prisma);
  const guard = new CheckoutGuardService(prisma, identifiers, attempts, undefined);
  const idempotency = new IdempotencyService(prisma);
  const products = new ProductsService(
    prisma, auditStub, undefined, integrations as any, undefined,
    discounts as any, promotions as any, undefined, undefined,
    guard as any, idempotency as any,
  );
  return { prisma, products, integrations, identifiers };
}

const SINGLE_DTO = {
  customerName: "Buyer", customerPhone: PHONE, customerAddress: "House 1, Dhaka",
  quantity: 1, deliveryZone: "inside_dhaka",
};

describe("AB8 stamping — single-product checkout", () => {
  it("valid deviceHash rides the upsert payload (normalized); invalid/absent omits the key entirely", async () => {
    const w1 = makeSingleWorld();
    await w1.products.placePublicOrder("prod-one", { ...SINGLE_DTO, deviceHash: HASH.toUpperCase() } as any);
    expect(w1.integrations.captured).toHaveLength(1);
    expect(w1.integrations.captured[0].deviceHash).toBe(HASH);

    const w2 = makeSingleWorld();
    await w2.products.placePublicOrder("prod-one", { ...SINGLE_DTO, deviceHash: "garbage" } as any);
    expect(w2.integrations.captured).toHaveLength(1);
    expect("deviceHash" in w2.integrations.captured[0]).toBe(false);

    const w3 = makeSingleWorld();
    await w3.products.placePublicOrder("prod-one", { ...SINGLE_DTO } as any);
    expect("deviceHash" in w3.integrations.captured[0]).toBe(false);
  });
  it("a blocked device refuses the single checkout BEFORE any order write", async () => {
    const w = makeSingleWorld();
    await w.identifiers.add("org-1", "a", "blocked", { kind: "device", value: HASH });
    await expect(w.products.placePublicOrder("prod-one", { ...SINGLE_DTO, deviceHash: HASH } as any))
      .rejects.toThrow("দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না");
    expect(w.integrations.upsertOrder).not.toHaveBeenCalled();
  });
});

// ---------- 7. staff payload ----------

describe("AB8 OrdersService.getOne — deviceHashPrefix only", () => {
  it("returns the prefix and NEVER the full hash; no hash → null prefix", async () => {
    const prisma: any = { order: makeTable("ord"), customer: makeTable("cust") };
    prisma.order.rows.push(
      {
        id: "o-1", organizationId: "org-1", status: "pending", isCod: true,
        totalMinor: 1000n, subtotalMinor: 1000n, deviceHash: HASH,
        customer: { id: "c-1", phone: PHONE }, items: [], createdAt: new Date(),
      },
      {
        id: "o-2", organizationId: "org-1", status: "pending", isCod: true,
        totalMinor: 1000n, subtotalMinor: 1000n, deviceHash: null,
        customer: { id: "c-1", phone: PHONE }, items: [], createdAt: new Date(),
      },
    );
    const svc = new OrdersService(prisma, undefined, undefined, auditStub as any);
    const out: any = await svc.getOne("org-1", "o-1");
    expect(out.deviceHashPrefix).toBe(HASH_PREFIX);
    expect(out.deviceHash).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain(HASH);
    const out2: any = await svc.getOne("org-1", "o-2");
    expect(out2.deviceHashPrefix).toBeNull();
  });
});
