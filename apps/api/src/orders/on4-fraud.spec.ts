import "reflect-metadata";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { scoreFraud, namesMateriallyDifferent, FRAUD_WEIGHTS } from "./fraud-score";
import { normalizeBdPhone, bdPhoneMatchKey } from "./phone-utils";
import { FraudShieldService } from "./fraud-shield.service";
import { BlockedPhoneService } from "../fraud/blocked-phone.service";
import { CourierService } from "../courier/courier.service";

/**
 * ON4 — Fraud Shield v2. Pure scorer + phone utils pinned
 * exactly; services run on a fake-Prisma harness in the
 * on1-queues style (matcher + in-memory tables).
 */

// ---------- fake prisma ----------

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
      if ("notIn" in c) { if (c.notIn.map(String).includes(String(row[k]))) return false; continue; }
      if ("not" in c) { if (String(row[k]) === String(c.not)) return false; continue; }
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

const BASE_INPUT = {
  burstCount: 0, burstThreshold: 3, burstWindowHours: 24,
  historyBand: null as string | null, historyScore: null as number | null,
  badOutcomeCount: 0, reliabilityPercent: null as number | null, reliabilityDecided: 0,
  priorOrderCount: 10, totalMinor: 1000n, highValueMinor: 500000n,
  nameMismatch: false, mismatchedName: null as string | null, blocked: false,
  deviceVelocity: 0,
};

// ---------- pure scorer ----------

describe("ON4 scoreFraud (pure)", () => {
  it("blocked forces 100/high with ONLY the blocked reason", () => {
    const r = scoreFraud({ ...BASE_INPUT, blocked: true, burstCount: 9, historyBand: "high", historyScore: 90 });
    expect(r.score).toBe(100);
    expect(r.band).toBe("high");
    expect(r.reasons).toEqual([{ key: "blocked_phone", label: "এই ফোন নম্বরটি প্রতিষ্ঠানের ব্লকলিস্টে আছে", points: 100 }]);
  });

  it("duplicate_burst fires at the threshold with exact points", () => {
    const r = scoreFraud({ ...BASE_INPUT, burstCount: 3 });
    expect(r.reasons).toEqual([
      expect.objectContaining({ key: "duplicate_burst", points: FRAUD_WEIGHTS.burst }),
    ]);
    expect(r.score).toBe(30);
    expect(scoreFraud({ ...BASE_INPUT, burstCount: 2 }).reasons[0].key).toBe("no_signals");
  });

  it("history_band: high +35, medium +15", () => {
    expect(scoreFraud({ ...BASE_INPUT, historyBand: "high", historyScore: 80 }).reasons)
      .toEqual([expect.objectContaining({ key: "history_band", points: 35 })]);
    expect(scoreFraud({ ...BASE_INPUT, historyBand: "medium", historyScore: 40 }).reasons)
      .toEqual([expect.objectContaining({ key: "history_band", points: 15 })]);
    expect(scoreFraud({ ...BASE_INPUT, historyBand: "low", historyScore: 5 }).reasons[0].key).toBe("no_signals");
    expect(scoreFraud({ ...BASE_INPUT, historyBand: "unknown", historyScore: null }).reasons[0].key).toBe("no_signals");
  });

  it("history_outcomes: >=2 bad outcomes, or low reliability with >=3 decided", () => {
    expect(scoreFraud({ ...BASE_INPUT, badOutcomeCount: 2 }).reasons)
      .toEqual([expect.objectContaining({ key: "history_outcomes", points: 20 })]);
    const rel = scoreFraud({ ...BASE_INPUT, badOutcomeCount: 1, reliabilityPercent: 40, reliabilityDecided: 5 });
    expect(rel.reasons).toEqual([expect.objectContaining({ key: "history_outcomes", points: 20 })]);
    expect(rel.reasons[0].label).toContain("40%");
    // reliability alone with too little evidence does not fire
    expect(scoreFraud({ ...BASE_INPUT, badOutcomeCount: 1, reliabilityPercent: 40, reliabilityDecided: 2 }).reasons[0].key)
      .toBe("no_signals");
  });

  it("high_value_new_customer fires only for near-new customers at/above the threshold", () => {
    const r = scoreFraud({ ...BASE_INPUT, priorOrderCount: 1, totalMinor: 500000n });
    expect(r.reasons).toEqual([expect.objectContaining({ key: "high_value_new_customer", points: 20 })]);
    expect(r.reasons[0].label).toContain("5,000");
    expect(scoreFraud({ ...BASE_INPUT, priorOrderCount: 2, totalMinor: 500000n }).reasons[0].key).toBe("no_signals");
    expect(scoreFraud({ ...BASE_INPUT, priorOrderCount: 0, totalMinor: 499999n }).reasons[0].key).toBe("no_signals");
  });

  it("phone_name_mismatch +15 with the stored name in the label", () => {
    const r = scoreFraud({ ...BASE_INPUT, nameMismatch: true, mismatchedName: "Karim Sheikh" });
    expect(r.reasons).toEqual([expect.objectContaining({ key: "phone_name_mismatch", points: 15 })]);
    expect(r.reasons[0].label).toContain("Karim Sheikh");
  });

  it("score caps at 100", () => {
    const r = scoreFraud({
      ...BASE_INPUT, burstCount: 5, historyBand: "high", historyScore: 90,
      badOutcomeCount: 3, priorOrderCount: 0, totalMinor: 900000n,
      nameMismatch: true, mismatchedName: "X Y",
    });
    expect(r.score).toBe(100);
    expect(r.band).toBe("high");
  });

  it("band boundaries via reachable weight sums (35 low, 40 medium, 65 medium, 70 high)", () => {
    // The fixed weights cannot sum to 39/69; the nearest
    // reachable sums pin the <40 / 40–69 / >=70 edges.
    expect(scoreFraud({ ...BASE_INPUT, historyBand: "high", historyScore: 1 }).band).toBe("low"); // 35
    expect(scoreFraud({ ...BASE_INPUT, badOutcomeCount: 2, priorOrderCount: 0, totalMinor: 500000n }).band).toBe("medium"); // 40
    expect(scoreFraud({ ...BASE_INPUT, burstCount: 3, historyBand: "high", historyScore: 1 }).band).toBe("medium"); // 65
    expect(scoreFraud({ ...BASE_INPUT, historyBand: "high", historyScore: 1, badOutcomeCount: 2, nameMismatch: true, mismatchedName: "A B" }).band).toBe("high"); // 70
  });

  it("no signals → 0/low with the no_signals reason", () => {
    const r = scoreFraud({ ...BASE_INPUT });
    expect(r).toEqual({
      score: 0, band: "low",
      reasons: [{ key: "no_signals", label: "কোনো ঝুঁকির সংকেত পাওয়া যায়নি", points: 0 }],
    });
  });
});

describe("ON4 namesMateriallyDifferent", () => {
  it("different people → true; same person / containment / honorific → false", () => {
    expect(namesMateriallyDifferent("Rahim Uddin", "Karim Sheikh")).toBe(true);
    expect(namesMateriallyDifferent("Rahim Uddin", "Rahim Uddin")).toBe(false);
    expect(namesMateriallyDifferent("Rahim", "Rahim Uddin")).toBe(false);
    expect(namesMateriallyDifferent("Md Rahim Uddin", "Rahim Uddin")).toBe(false);
    expect(namesMateriallyDifferent("Md. Karim Sheikh", "Karim Sheikh")).toBe(false);
    expect(namesMateriallyDifferent("Rahim Uddin", "Rahim Khan")).toBe(false); // first tokens equal
  });
  it("empty on either side → false", () => {
    expect(namesMateriallyDifferent("", "Rahim")).toBe(false);
    expect(namesMateriallyDifferent(null, "Rahim")).toBe(false);
    expect(namesMateriallyDifferent("Rahim", undefined)).toBe(false);
  });
});

// ---------- phone utils ----------

describe("ON11 phone utils", () => {
  it("normalizeBdPhone accepts all local forms, incl. Bengali digits", () => {
    expect(normalizeBdPhone("01712345678")).toBe("+8801712345678");
    expect(normalizeBdPhone("8801712345678")).toBe("+8801712345678");
    expect(normalizeBdPhone("+8801712345678")).toBe("+8801712345678");
    expect(normalizeBdPhone("+880 1712-345 678")).toBe("+8801712345678");
    expect(normalizeBdPhone("1712345678")).toBe("+8801712345678");
    expect(normalizeBdPhone("০১৭১২৩৪৫৬৭৮")).toBe("+8801712345678");
  });
  it("normalizeBdPhone rejects invalid numbers", () => {
    expect(normalizeBdPhone("01212345678")).toBeNull(); // 12x is not a mobile prefix
    expect(normalizeBdPhone("0171234567")).toBeNull(); // too short
    expect(normalizeBdPhone("12345")).toBeNull();
    expect(normalizeBdPhone("")).toBeNull();
    expect(normalizeBdPhone(null)).toBeNull();
    expect(normalizeBdPhone("02987654321")).toBeNull(); // landline shape
  });
  it("bdPhoneMatchKey is the last 10 digits, null under 10", () => {
    expect(bdPhoneMatchKey("01712345678")).toBe("1712345678");
    expect(bdPhoneMatchKey("+8801712345678")).toBe("1712345678");
    expect(bdPhoneMatchKey("০১৭১২৩৪৫৬৭৮")).toBe("1712345678");
    expect(bdPhoneMatchKey("123456789")).toBeNull();
    expect(bdPhoneMatchKey(null)).toBeNull();
  });
});

// ---------- services on fake prisma ----------

function makeWorld(opts: { riskResult?: any; setting?: any } = {}) {
  const prisma: any = {
    order: makeTable("order"),
    customer: makeTable("customer"),
    blockedPhone: makeTable("blockedPhone"),
    fraudShieldSetting: makeTable("fraudShieldSetting"),
    courierShipment: makeTable("courierShipment"),
    channelConversation: makeTable("channelConversation"),
    returnRequest: makeTable("returnRequest"),
  };
  prisma.fraudShieldSetting.rows.push({
    id: "set-1", organizationId: "org-1", enabled: true, autoHoldEnabled: false,
    autoHoldBand: "high", highValueMinor: 500000n, burstCount: 3, burstWindowHours: 24,
    ...(opts.setting ?? {}),
  });
  const audit = { log: jest.fn(async () => undefined) };
  const events = { on: jest.fn(), emit: jest.fn() };
  const blocked = new BlockedPhoneService(prisma, audit as any);
  const risk = { forOrder: jest.fn(async () => opts.riskResult ?? { band: "low", score: 5 }) };
  const fraud = new FraudShieldService(prisma, risk as any, blocked, audit as any, events as any, undefined);
  return { prisma, audit, events, blocked, risk, fraud };
}

function seedOrder(prisma: any, over: any = {}) {
  const customer = { id: "c-1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin", phone: "01711111111" };
  prisma.customer.rows.push(customer);
  const order = {
    id: "o-1", organizationId: "org-1", customerId: "c-1", customer,
    status: "pending", isCod: true, isPractice: false, totalMinor: 1000n,
    codConfirmationStatus: "awaiting", codCallAttempts: 0,
    reviewHold: false, reviewHoldReason: null, reviewHeldAt: null,
    createdAt: new Date(), placedAt: new Date(), ...over,
  };
  prisma.order.rows.push(order);
  return order;
}

describe("ON4 FraudShieldService assessment", () => {
  it("stamps score/band/reasons; no signals → 0/low; no hold by default", async () => {
    const { prisma, fraud } = makeWorld();
    const order = seedOrder(prisma);
    const r: any = await fraud.assessOrder("org-1", "o-1");
    expect(r.score).toBe(0);
    expect(r.band).toBe("low");
    expect(r.reviewHold).toBe(false);
    expect(order.riskScore).toBe(0);
    expect(order.riskBand).toBe("low");
    expect((order.riskReasons as any[])[0].key).toBe("no_signals");
    expect(order.riskAssessedAt).toBeInstanceOf(Date);
    expect(order.reviewHold).toBe(false);
  });

  it("blocked phone force-holds with score 100 regardless of other signals", async () => {
    const { prisma, fraud, blocked } = makeWorld();
    const order = seedOrder(prisma);
    await blocked.add("org-1", "actor-1", { phone: "01711111111", reason: "প্রতারণা" });
    const r: any = await fraud.assessOrder("org-1", "o-1");
    expect(r.score).toBe(100);
    expect(r.band).toBe("high");
    expect(r.reviewHold).toBe(true);
    expect(order.reviewHold).toBe(true);
    expect(order.reviewHoldReason).toBe("ব্লকলিস্টে থাকা ফোন নম্বর থেকে অর্ডার");
  });

  it("autoHold OFF: a high band does NOT hold; autoHold ON: holds with the স্বয়ংক্রিয় reason", async () => {
    const { prisma, fraud } = makeWorld({ riskResult: { band: "high", score: 90 } });
    const order = seedOrder(prisma, { totalMinor: 600000n });
    // 3 burst orders from the same phone (other customers).
    for (let i = 0; i < 3; i++) {
      prisma.order.rows.push({
        id: `o-b${i}`, organizationId: "org-1", customerId: `c-b${i}`,
        customer: { id: `c-b${i}`, firstName: "Rahim", lastName: "Uddin", phone: "+8801711111111" },
        status: "pending", isCod: true, isPractice: false, totalMinor: 1000n,
        createdAt: new Date(), placedAt: new Date(),
      });
    }
    const r1: any = await fraud.assessOrder("org-1", "o-1");
    expect(r1.band).toBe("high"); // 30 burst + 35 history + 20 high-value = 85
    expect(r1.score).toBe(85);
    expect(order.reviewHold).toBe(false);

    prisma.fraudShieldSetting.rows[0].autoHoldEnabled = true;
    const r2: any = await fraud.reassess("org-1", "actor-1", "o-1");
    expect(r2.score).toBe(85);
    expect(order.reviewHold).toBe(true);
    expect(order.reviewHoldReason).toContain("স্বয়ংক্রিয়:");
  });

  it("disabled setting stamps nothing and returns null", async () => {
    const { prisma, fraud } = makeWorld({ setting: { enabled: false } });
    const order = seedOrder(prisma);
    await expect(fraud.assessOrder("org-1", "o-1")).resolves.toBeNull();
    expect(order.riskScore).toBeUndefined();
  });

  it("assessment never throws on a broken prisma", async () => {
    const fraud = new FraudShieldService({} as any, undefined, undefined, { log: jest.fn(async () => undefined) } as any, undefined, undefined);
    await expect(fraud.assessOrder("org-1", "o-1")).resolves.toBeNull();
  });

  it("an existing hold keeps its original reason during reassessment", async () => {
    const { prisma, fraud, blocked } = makeWorld();
    const order = seedOrder(prisma, { reviewHold: true, reviewHoldReason: "ম্যানুয়াল যাচাই", reviewHeldAt: new Date() });
    await blocked.add("org-1", "actor-1", { phone: "01711111111" });
    const r: any = await fraud.assessOrder("org-1", "o-1");
    expect(r.reviewHold).toBe(true);
    expect(order.reviewHoldReason).toBe("ম্যানুয়াল যাচাই");
  });
});

describe("ON4 hold / release", () => {
  it("hold sets fields with audit metadata {} (no reason text); release clears", async () => {
    const { prisma, fraud, audit } = makeWorld();
    const order = seedOrder(prisma);
    await fraud.hold("org-1", "actor-1", "o-1", "  যাচাই দরকার  ");
    expect(order.reviewHold).toBe(true);
    expect(order.reviewHoldReason).toBe("যাচাই দরকার");
    const holdAudit = (audit.log as jest.Mock).mock.calls.find((c) => c[0].action === "orders.review_hold_set");
    expect(holdAudit[0].metadata).toEqual({});
    await fraud.release("org-1", "actor-1", "o-1");
    expect(order.reviewHold).toBe(false);
    expect(order.reviewHoldReason).toBeNull();
    expect(order.reviewHeldAt).toBeNull();
  });
  it("hold requires a reason; foreign order is 404", async () => {
    const { prisma, fraud } = makeWorld();
    seedOrder(prisma);
    await expect(fraud.hold("org-1", "actor-1", "o-1", "   ")).rejects.toThrow(/কারণ/);
    await expect(fraud.hold("org-2", "actor-1", "o-1", "কারণ")).rejects.toMatchObject({ code: "commerce.orderNotFoundInOrg", status: 404 });
    await expect(fraud.release("org-2", "actor-1", "o-1")).rejects.toMatchObject({ code: "commerce.orderNotFoundInOrg", status: 404 });
  });
});

describe("ON4 recordCodCall", () => {
  it("confirmed → codConfirmationStatus 'confirmed', attempts increment, event emitted", async () => {
    const { prisma, fraud, events } = makeWorld();
    const order = seedOrder(prisma);
    const r: any = await fraud.recordCodCall("org-1", "actor-1", "o-1", "confirmed");
    expect(order.codCallAttempts).toBe(1);
    expect(order.codLastCallOutcome).toBe("confirmed");
    expect(order.codConfirmationStatus).toBe("confirmed");
    expect(r.codConfirmationStatus).toBe("confirmed");
    expect(r.order.totalMinor).toBe("1000"); // BigInt stringified
    expect(events.emit).toHaveBeenCalledWith("order.cod_confirmed", expect.objectContaining({ organizationId: "org-1" }));
  });
  it("rejected maps onto the stored verdict 'declined'", async () => {
    const { prisma, fraud } = makeWorld();
    const order = seedOrder(prisma);
    const r: any = await fraud.recordCodCall("org-1", "actor-1", "o-1", "rejected");
    expect(order.codLastCallOutcome).toBe("rejected");
    expect(order.codConfirmationStatus).toBe("declined");
    expect(r.codConfirmationStatus).toBe("declined");
  });
  it("unreachable leaves the confirmation status untouched", async () => {
    const { prisma, fraud } = makeWorld();
    const order = seedOrder(prisma);
    await fraud.recordCodCall("org-1", "actor-1", "o-1", "unreachable");
    expect(order.codCallAttempts).toBe(1);
    expect(order.codConfirmationStatus).toBe("awaiting");
  });
  it("non-COD, wrong status and bad outcome are Bengali 400s; foreign order 404", async () => {
    const { prisma, fraud } = makeWorld();
    seedOrder(prisma, { id: "o-nc", isCod: false });
    seedOrder(prisma, { id: "o-done", status: "completed" });
    seedOrder(prisma);
    await expect(fraud.recordCodCall("org-1", "a", "o-nc", "confirmed")).rejects.toThrow("এটি COD অর্ডার নয়");
    await expect(fraud.recordCodCall("org-1", "a", "o-done", "confirmed")).rejects.toThrow(/COD কল রেকর্ড করা যায় না/);
    await expect(fraud.recordCodCall("org-1", "a", "o-1", "maybe")).rejects.toThrow(/কলের ফলাফল/);
    await expect(fraud.recordCodCall("org-2", "a", "o-1", "confirmed")).rejects.toMatchObject({ code: "commerce.orderNotFoundInOrg", status: 404 });
  });
});

describe("ON4 BlockedPhoneService", () => {
  function setup() {
    const prisma: any = { blockedPhone: makeTable("blockedPhone") };
    const audit = { log: jest.fn(async () => undefined) };
    return { prisma, audit, svc: new BlockedPhoneService(prisma, audit as any) };
  }
  it("add canonicalizes; duplicate (any format) is a Bengali 400; audit carries phoneKey only", async () => {
    const { svc, audit } = setup();
    const row: any = await svc.add("org-1", "actor-1", { phone: "01711111111", reason: "গোপন কারণ" });
    expect(row.phone).toBe("+8801711111111");
    expect(row.phoneKey).toBe("1711111111");
    const call = (audit.log as jest.Mock).mock.calls[0][0];
    expect(call.action).toBe("orders.blocked_phone_added");
    expect(call.metadata).toEqual({ phoneKey: "1711111111" });
    await expect(svc.add("org-1", "actor-1", { phone: "+8801711111111" })).rejects.toThrow("ইতিমধ্যে ব্লকলিস্টে আছে");
  });
  it("invalid number is a Bengali 400", async () => {
    const { svc } = setup();
    await expect(svc.add("org-1", "actor-1", { phone: "123" })).rejects.toThrow("সঠিক বাংলাদেশি মোবাইল নম্বর নয়");
  });
  it("isBlocked matches across formats; other numbers / broken tables → false", async () => {
    const { svc } = setup();
    await svc.add("org-1", "actor-1", { phone: "01711111111" });
    await expect(svc.isBlocked("org-1", "+8801711111111")).resolves.toBe(true);
    await expect(svc.isBlocked("org-1", "8801711111111")).resolves.toBe(true);
    await expect(svc.isBlocked("org-1", "01711111111")).resolves.toBe(true);
    await expect(svc.isBlocked("org-1", "01822222222")).resolves.toBe(false);
    await expect(svc.isBlocked("org-2", "01711111111")).resolves.toBe(false);
    await expect(svc.isBlocked("org-1", null)).resolves.toBe(false);
    const broken = new BlockedPhoneService({} as any);
    await expect(broken.isBlocked("org-1", "01711111111")).resolves.toBe(false);
  });
  it("remove is org-scoped (foreign id 404) and audits the key", async () => {
    const { svc, audit } = setup();
    const row: any = await svc.add("org-1", "actor-1", { phone: "01711111111" });
    await expect(svc.remove("org-2", "actor-1", row.id)).rejects.toMatchObject({ code: "fraud.blockedPhoneNotFoundInThis" });
    await svc.remove("org-1", "actor-1", row.id);
    await expect(svc.isBlocked("org-1", "01711111111")).resolves.toBe(false);
    expect((audit.log as jest.Mock).mock.calls.some((c) => c[0].action === "orders.blocked_phone_removed")).toBe(true);
  });
});

// ---------- courier hold guard (courier.spec harness style) ----------

function courierMatches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}
function courierTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async (args: any = {}) => rows.find((r) => courierMatches(r, args.where ?? {})) ?? null,
    findMany: async (args: any = {}) => rows.filter((r) => courierMatches(r, args.where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => courierMatches(r, where ?? {})); if (row) Object.assign(row, data); return row ?? null; },
  };
}

describe("ON4 bookShipment review-hold guard", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  function setup() {
    const tables: Record<string, any> = {};
    for (const n of ["integration", "integrationCredential", "order", "customer", "courierShipment"]) tables[n] = courierTable(n);
    const origFindFirst = tables.integration.findFirst;
    tables.integration.findFirst = async (args: any) => {
      const row = await origFindFirst(args);
      if (row && args?.include?.credential) {
        const cred = tables.integrationCredential.rows.find((c: any) => c.integrationId === row.id);
        return { ...row, credential: cred ?? null };
      }
      return row;
    };
    tables.customer.rows.push({ id: "cus-1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin", phone: "01711111111" });
    tables.order.rows.push({
      id: "ord-1", organizationId: "org-1", customerId: "cus-1", isCod: true,
      totalMinor: 150000n, externalNumber: "1042", conversationId: "conv-1", status: "processing",
      isPractice: false, reviewHold: true, reviewHoldReason: "যাচাই চলছে",
    });
    const audit = { log: jest.fn(async () => undefined) };
    const svc = new CourierService(tables as any, audit as any, undefined);
    return { tables, svc, audit };
  }

  function stubSteadfast() {
    global.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes("/get_balance")) return { ok: true, status: 200, json: async () => ({ status: 200, current_balance: 750 }) };
      if (u.includes("/create_order")) return { ok: true, status: 200, json: async () => ({ status: 200, consignment: { consignment_id: 555, tracking_code: "TRK9", status: "in_review" } }) };
      throw new Error("unexpected url " + u);
    }) as any;
  }

  it("refuses a held order without override (reason in the message, nothing booked)", async () => {
    const { tables, svc, audit } = setup();
    await expect(svc.bookShipment("org-1", "agent", { orderId: "ord-1", recipientAddress: "বাসা ৫, রোড ২, মিরপুর, ঢাকা" }))
      .rejects.toThrow(/আটকানো আছে \(কারণ: যাচাই চলছে\)/);
    expect(tables.courierShipment.rows).toHaveLength(0);
    expect((audit.log as jest.Mock).mock.calls.some((c) => c[0].action === "courier.booking_review_hold_override")).toBe(false);
  });

  it("override proceeds and is audited BEFORE the booking", async () => {
    const { tables, svc, audit } = setup();
    stubSteadfast();
    await svc.connect("org-1", "owner", { provider: "steadfast", apiKey: "k", secretKey: "s" } as any);
    const shipment: any = await svc.bookShipment("org-1", "agent", {
      orderId: "ord-1", recipientAddress: "বাসা ৫, রোড ২, মিরপুর, ঢাকা", overrideReviewHold: true,
    });
    expect(shipment.trackingCode).toBe("TRK9");
    const overrideCall = (audit.log as jest.Mock).mock.calls.find((c) => c[0].action === "courier.booking_review_hold_override");
    expect(overrideCall).toBeTruthy();
    expect(overrideCall[0].entityId).toBe("ord-1");
    expect(tables.courierShipment.rows).toHaveLength(1);
  });
});
