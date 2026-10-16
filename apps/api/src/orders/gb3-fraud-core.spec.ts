import "reflect-metadata";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { seal } from "../common/platform-config";
import { IdentifierListsService } from "../fraud/identifier-lists.service";
import { FraudAttemptLogService } from "../fraud/fraud-attempt-log.service";
import { TurnstileVerifier } from "../fraud/turnstile.service";
import { CheckoutGuardService, dhakaDayStartUtc } from "../fraud/checkout-guard.service";
import { FraudRulesService } from "../fraud/fraud-rules.service";
import { evaluateCodRules } from "../fraud/cod-rules";
import {
  maskIdentifier, maskPhoneSummary, normalizeIdentifier,
} from "../fraud/identifier-utils";
import { FraudShieldService } from "./fraud-shield.service";
import { BlockedPhoneService } from "../fraud/blocked-phone.service";

/**
 * GB3 (GC8 + GC9) — fraud core: identifier lists, checkout
 * gate, fraud rules, COD rules, Turnstile verifier and the
 * FraudShieldService extensions, on the on4-style fake-Prisma
 * harness (matcher + in-memory tables).
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
    groupBy: async ({ by, where }: any = {}) => {
      const field = by[0];
      const map = new Map<string, number>();
      for (const r of rows.filter((x) => matchWhere(x, where))) {
        map.set(String(r[field]), (map.get(String(r[field])) ?? 0) + 1);
      }
      return [...map.entries()].map(([k, count]) => ({ [field]: k, _count: { _all: count } }));
    },
  };
}

// ---------- world ----------

const PHONE = "01711111111";
const PHONE_KEY = "1711111111";

function makeWorld(opts: { setting?: any; riskResult?: any; turnstileImpl?: any } = {}) {
  const prisma: any = {
    order: makeTable("order"),
    customer: makeTable("customer"),
    blockedPhone: makeTable("blockedPhone"),
    blockedIdentifier: makeTable("blockedIdentifier"),
    trustedIdentifier: makeTable("trustedIdentifier"),
    fraudAttemptLog: makeTable("fraudAttemptLog"),
    fraudRule: makeTable("fraudRule"),
    fraudRuleHit: makeTable("fraudRuleHit"),
    fraudShieldSetting: makeTable("fraudShieldSetting"),
    courierShipment: makeTable("courierShipment"),
    channelConversation: makeTable("channelConversation"),
    returnRequest: makeTable("returnRequest"),
  };
  prisma.fraudShieldSetting.rows.push({
    id: "set-1", organizationId: "org-1", enabled: true, autoHoldEnabled: false,
    autoHoldBand: "high", highValueMinor: 500000n, burstCount: 3, burstWindowHours: 24,
    openOrderPolicy: "off", openOrderWindowHours: 72, waitingPeriodMinutes: 0,
    maxOrdersPerPhonePerDay: 0, captchaEnabled: false, captchaOnCheckout: true,
    captchaOnOtp: false, turnstileSiteKey: null, turnstileSecretEncrypted: null,
    ...(opts.setting ?? {}),
  });
  const audit = { log: jest.fn(async () => undefined) };
  const events = { on: jest.fn(), emit: jest.fn() };
  const identifiers = new IdentifierListsService(prisma, audit as any);
  const attempts = new FraudAttemptLogService(prisma);
  const turnstile = opts.turnstileImpl ?? {
    verify: jest.fn(async (_s: any, token: any) =>
      token ? { ok: true, providerError: false } : { ok: false, providerError: false }),
  };
  const guard = new CheckoutGuardService(prisma, identifiers, attempts, turnstile as any);
  const rules = new FraudRulesService(prisma, audit as any);
  const blocked = new BlockedPhoneService(prisma, audit as any);
  const risk = { forOrder: jest.fn(async () => opts.riskResult ?? { band: "low", score: 5 }) };
  const fraud = new FraudShieldService(
    prisma, risk as any, blocked, audit as any, events as any, undefined,
    identifiers, guard, rules,
  );
  return { prisma, audit, events, identifiers, attempts, turnstile, guard, rules, blocked, risk, fraud };
}

function seedCustomerOrder(prisma: any, over: any = {}) {
  const customer = { id: "c-1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin", phone: PHONE };
  if (!prisma.customer.rows.some((c: any) => c.id === "c-1")) prisma.customer.rows.push(customer);
  const order = {
    id: "o-1", organizationId: "org-1", customerId: "c-1", customer,
    status: "pending", isCod: true, isPractice: false, totalMinor: 1000n,
    reviewHold: false, reviewHoldReason: null, reviewHeldAt: null,
    createdAt: new Date(), ...over,
  };
  prisma.order.rows.push(order);
  return order;
}

function enableCaptcha(prisma: any) {
  const s = prisma.fraudShieldSetting.rows[0];
  s.captchaEnabled = true;
  s.captchaOnCheckout = true;
  s.turnstileSiteKey = "site-key-1";
  s.turnstileSecretEncrypted = seal("turnstile-secret");
}

// ---------- identifier utils (pure) ----------

describe("GB3 identifier utils", () => {
  it("phone: canonical value + last-10 matchKey; invalid → null", () => {
    expect(normalizeIdentifier("phone", "01712345678")).toEqual({ value: "+8801712345678", matchKey: "1712345678" });
    expect(normalizeIdentifier("phone", "+880 1712-345678")).toEqual({ value: "+8801712345678", matchKey: "1712345678" });
    expect(normalizeIdentifier("phone", "123")).toBeNull();
    expect(normalizeIdentifier("phone", "02987654321")).toBeNull();
  });
  it("email: trim + lowercase; bad shape → null", () => {
    expect(normalizeIdentifier("email", "  User@Example.COM ")).toEqual({ value: "user@example.com", matchKey: "user@example.com" });
    expect(normalizeIdentifier("email", "not-an-email")).toBeNull();
    expect(normalizeIdentifier("email", "a@b")).toBeNull();
    expect(normalizeIdentifier("email", "")).toBeNull();
  });
  it("ip: IPv4 octets validated; IPv6 via colon; hostnames → null", () => {
    expect(normalizeIdentifier("ip", "192.168.0.1")).toEqual({ value: "192.168.0.1", matchKey: "192.168.0.1" });
    expect(normalizeIdentifier("ip", "999.1.1.1")).toBeNull();
    expect(normalizeIdentifier("ip", "1.2.3")).toBeNull();
    expect(normalizeIdentifier("ip", "::1")).toEqual({ value: "::1", matchKey: "::1" });
    expect(normalizeIdentifier("ip", "2001:DB8::1")).toEqual({ value: "2001:db8::1", matchKey: "2001:db8::1" });
    expect(normalizeIdentifier("ip", "example.com")).toBeNull();
  });
  it("masking: phone last-4, email first-char + domain, ip full (documented)", () => {
    expect(maskIdentifier("phone", "+8801712345678")).toBe("•••5678");
    expect(maskIdentifier("email", "user@example.com")).toBe("u***@example.com");
    expect(maskIdentifier("ip", "203.0.113.7")).toBe("203.0.113.7");
    expect(maskPhoneSummary("01712345678")).toBe("•••5678");
    expect(maskPhoneSummary("+8801712345678")).toBe("•••5678");
  });
});

// ---------- identifier lists CRUD ----------

describe("GB3 IdentifierListsService", () => {
  it("add normalizes; duplicate (any form) is the Bengali 400; audit has NO raw email", async () => {
    const { identifiers, audit } = makeWorld();
    const row: any = await identifiers.add("org-1", "actor-1", "blocked", { kind: "email", value: " Shopper@Example.com ", reason: "x" });
    expect(row.value).toBe("shopper@example.com");
    expect(row.matchKey).toBe("shopper@example.com");
    await expect(identifiers.add("org-1", "actor-1", "blocked", { kind: "email", value: "shopper@example.com" }))
      .rejects.toThrow("ইতিমধ্যে তালিকায় আছে");
    const call = (audit.log as jest.Mock).mock.calls.find((c) => c[0].action === "orders.blocked_identifier_added");
    expect(call[0].metadata).toEqual({ kind: "email", masked: "s***@example.com" });
    expect(JSON.stringify(call[0].metadata)).not.toContain("shopper@example.com");
  });

  it("audit metadata never carries the raw ip or full phone", async () => {
    const { identifiers, audit } = makeWorld();
    await identifiers.add("org-1", "actor-1", "trusted", { kind: "ip", value: "203.0.113.7" });
    await identifiers.add("org-1", "actor-1", "trusted", { kind: "phone", value: PHONE });
    const calls = (audit.log as jest.Mock).mock.calls.map((c) => c[0]);
    const ipCall = calls.find((c) => c.action === "orders.trusted_identifier_added" && c.metadata.kind === "ip");
    expect(JSON.stringify(ipCall.metadata)).not.toContain("203.0.113.7");
    const phoneCall = calls.find((c) => c.action === "orders.trusted_identifier_added" && c.metadata.kind === "phone");
    expect(phoneCall.metadata).toEqual({ kind: "phone", masked: PHONE_KEY });
    expect(JSON.stringify(phoneCall.metadata)).not.toContain("+880");
  });

  it("invalid identifier is a Bengali 400; remove is org-scoped (foreign 404)", async () => {
    const { identifiers } = makeWorld();
    await expect(identifiers.add("org-1", "a", "blocked", { kind: "phone", value: "123" }))
      .rejects.toThrow("সঠিক বাংলাদেশি মোবাইল নম্বর নয়");
    await expect(identifiers.add("org-1", "a", "blocked", { kind: "email", value: "nope" }))
      .rejects.toThrow("ইমেইল ঠিকানাটি সঠিক নয়");
    const row: any = await identifiers.add("org-1", "a", "blocked", { kind: "phone", value: PHONE });
    await expect(identifiers.remove("org-2", "a", "blocked", row.id)).rejects.toThrow(/not found/i);
    await identifiers.remove("org-1", "a", "blocked", row.id);
    await expect(identifiers.isBlocked("org-1", { phoneKey: PHONE_KEY })).resolves.toEqual({ blocked: false, kind: null });
  });

  it("matchers: isBlocked by phone/email/ip; missing tables read as no-match; trusted fails closed on error", async () => {
    const { identifiers } = makeWorld();
    await identifiers.add("org-1", "a", "blocked", { kind: "phone", value: PHONE });
    await expect(identifiers.isBlocked("org-1", { phoneKey: PHONE_KEY })).resolves.toEqual({ blocked: true, kind: "phone" });
    await expect(identifiers.isBlocked("org-1", { phoneKey: "1812345678" })).resolves.toEqual({ blocked: false, kind: null });
    await expect(identifiers.isBlocked("org-2", { phoneKey: PHONE_KEY })).resolves.toEqual({ blocked: false, kind: null });
    const broken = new IdentifierListsService({} as any);
    await expect(broken.isBlocked("org-1", { phoneKey: PHONE_KEY })).resolves.toEqual({ blocked: false, kind: null });
    await expect(broken.isTrustedPhone("org-1", PHONE_KEY)).resolves.toBe(false);
  });
});

// ---------- checkout gate ----------

describe("GB3 CheckoutGuardService.evaluateGate", () => {
  it("blocked email refuses with the generic message + exactly ONE attempt row", async () => {
    const { prisma, guard, identifiers } = makeWorld();
    await identifiers.add("org-1", "a", "blocked", { kind: "email", value: "shopper@example.com" });
    await expect(guard.evaluateGate("org-1", "shop", {
      phone: PHONE, email: "shopper@example.com", surface: "checkout",
    })).rejects.toThrow("দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না");
    expect(prisma.fraudAttemptLog.rows).toHaveLength(1);
    expect(prisma.fraudAttemptLog.rows[0].kind).toBe("blocked_identifier");
    expect(prisma.fraudAttemptLog.rows[0].identifierSummary).toBe("s***@example.com");
  });

  it("blocked ip refuses (otp surface uses the OTP message)", async () => {
    const { prisma, guard, identifiers } = makeWorld();
    await identifiers.add("org-1", "a", "blocked", { kind: "ip", value: "203.0.113.7" });
    await expect(guard.evaluateGate("org-1", "shop", {
      phone: PHONE, ip: "203.0.113.7", surface: "checkout",
    })).rejects.toThrow("দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না");
    await expect(guard.evaluateGate("org-1", "otp", {
      phone: PHONE, ip: "203.0.113.7", surface: "otp",
    })).rejects.toThrow("দুঃখিত, এই মুহূর্তে কোড পাঠানো যাচ্ছে না");
    expect(prisma.fraudAttemptLog.rows).toHaveLength(2);
  });

  it("trusted phone bypasses block + open-order + waiting + daily, but NOT captcha", async () => {
    const turnstileImpl = { verify: jest.fn(async () => ({ ok: false, providerError: false })) };
    const { prisma, guard, identifiers } = makeWorld({
      setting: { openOrderPolicy: "block", waitingPeriodMinutes: 60, maxOrdersPerPhonePerDay: 1 },
      turnstileImpl,
    });
    seedCustomerOrder(prisma); // an open order from the same phone, placed now
    await identifiers.add("org-1", "a", "blocked", { kind: "phone", value: PHONE });
    await identifiers.add("org-1", "a", "trusted", { kind: "phone", value: PHONE });
    await expect(guard.evaluateGate("org-1", "shop", { phone: PHONE, surface: "checkout" }))
      .resolves.toEqual({ trusted: true, warnOpenOrder: false });
    expect(prisma.fraudAttemptLog.rows).toHaveLength(0);
    // CAPTCHA still applies to trusted phones.
    enableCaptcha(prisma);
    await expect(guard.evaluateGate("org-1", "shop", { phone: PHONE, captchaToken: "bad", surface: "checkout" }))
      .rejects.toThrow("নিরাপত্তা যাচাই ব্যর্থ হয়েছে — আবার চেষ্টা করুন");
    expect(prisma.fraudAttemptLog.rows).toHaveLength(1);
    expect(prisma.fraudAttemptLog.rows[0].kind).toBe("captcha");
  });

  it("open-order policy block refuses with the process message + log; warn flags without refusing", async () => {
    const w1 = makeWorld({ setting: { openOrderPolicy: "block" } });
    seedCustomerOrder(w1.prisma);
    await expect(w1.guard.evaluateGate("org-1", "shop", { phone: PHONE, surface: "checkout" }))
      .rejects.toThrow("আপনার আগের অর্ডারটি এখনো প্রক্রিয়াধীন আছে — সেটি সম্পন্ন হলে আবার চেষ্টা করুন");
    expect(w1.prisma.fraudAttemptLog.rows).toHaveLength(1);
    expect(w1.prisma.fraudAttemptLog.rows[0].kind).toBe("open_order_policy");

    const w2 = makeWorld({ setting: { openOrderPolicy: "warn" } });
    seedCustomerOrder(w2.prisma);
    await expect(w2.guard.evaluateGate("org-1", "shop", { phone: PHONE, surface: "checkout" }))
      .resolves.toEqual({ trusted: false, warnOpenOrder: true });
    expect(w2.prisma.fraudAttemptLog.rows).toHaveLength(0);

    const w3 = makeWorld({ setting: { openOrderPolicy: "off" } });
    seedCustomerOrder(w3.prisma);
    await expect(w3.guard.evaluateGate("org-1", "shop", { phone: PHONE, surface: "checkout" }))
      .resolves.toEqual({ trusted: false, warnOpenOrder: false });
  });

  it("waiting period refuses with the generic message + log", async () => {
    const { prisma, guard } = makeWorld({ setting: { waitingPeriodMinutes: 60 } });
    seedCustomerOrder(prisma, { status: "completed" });
    await expect(guard.evaluateGate("org-1", "single", { phone: PHONE, surface: "checkout" }))
      .rejects.toThrow("দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না");
    expect(prisma.fraudAttemptLog.rows).toHaveLength(1);
    expect(prisma.fraudAttemptLog.rows[0].kind).toBe("waiting_period");
  });

  it("daily limit refuses with the generic message + log", async () => {
    const { prisma, guard } = makeWorld({ setting: { maxOrdersPerPhonePerDay: 1 } });
    seedCustomerOrder(prisma, { status: "completed" });
    await expect(guard.evaluateGate("org-1", "landing", { phone: PHONE, surface: "checkout" }))
      .rejects.toThrow("দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না");
    expect(prisma.fraudAttemptLog.rows).toHaveLength(1);
    expect(prisma.fraudAttemptLog.rows[0].kind).toBe("daily_limit");
  });

  it("captcha: missing token refuses; providerError refuses AND marks the log summary", async () => {
    const w1 = makeWorld();
    enableCaptcha(w1.prisma);
    await expect(w1.guard.evaluateGate("org-1", "shop", { phone: PHONE, surface: "checkout" }))
      .rejects.toThrow("নিরাপত্তা যাচাই ব্যর্থ হয়েছে — আবার চেষ্টা করুন");
    expect(w1.prisma.fraudAttemptLog.rows[0].kind).toBe("captcha");
    expect(w1.prisma.fraudAttemptLog.rows[0].identifierSummary).toBe("•••1111");
    expect(w1.prisma.fraudAttemptLog.rows[0].identifierSummary).not.toContain("provider_error");

    const w2 = makeWorld({ turnstileImpl: { verify: jest.fn(async () => ({ ok: false, providerError: true })) } });
    enableCaptcha(w2.prisma);
    await expect(w2.guard.evaluateGate("org-1", "shop", { phone: PHONE, captchaToken: "tok", surface: "checkout" }))
      .rejects.toThrow("নিরাপত্তা যাচাই ব্যর্থ হয়েছে");
    expect(w2.prisma.fraudAttemptLog.rows[0].identifierSummary).toContain("(provider_error)");
  });

  it("captcha half-configured (enabled, no secret) SKIPS verification", async () => {
    const turnstileImpl = { verify: jest.fn(async () => ({ ok: false, providerError: false })) };
    const { prisma, guard } = makeWorld({ turnstileImpl });
    const s = prisma.fraudShieldSetting.rows[0];
    s.captchaEnabled = true;
    s.turnstileSiteKey = "site-key-1";
    s.turnstileSecretEncrypted = null; // half-configured
    await expect(guard.evaluateGate("org-1", "shop", { phone: PHONE, surface: "checkout" }))
      .resolves.toEqual({ trusted: false, warnOpenOrder: false });
    expect(turnstileImpl.verify).not.toHaveBeenCalled();
    expect(prisma.fraudAttemptLog.rows).toHaveLength(0);
  });

  it("captcha valid token passes; dhakaDayStartUtc is midnight Dhaka = 18:00 UTC prior day", async () => {
    const { prisma, guard } = makeWorld();
    enableCaptcha(prisma);
    await expect(guard.evaluateGate("org-1", "shop", { phone: PHONE, captchaToken: "tok", surface: "checkout" }))
      .resolves.toEqual({ trusted: false, warnOpenOrder: false });
    expect(dhakaDayStartUtc(new Date("2026-10-15T14:00:00.000Z")).toISOString()).toBe("2026-10-14T18:00:00.000Z");
    expect(dhakaDayStartUtc(new Date("2026-10-15T17:59:00.000Z")).toISOString()).toBe("2026-10-14T18:00:00.000Z");
    expect(dhakaDayStartUtc(new Date("2026-10-15T18:30:00.000Z")).toISOString()).toBe("2026-10-15T18:00:00.000Z");
  });
});

// ---------- Turnstile verifier ----------

describe("GB3 TurnstileVerifier", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it("missing secret/token → not ok, NOT a provider error, no network call", async () => {
    global.fetch = jest.fn(async () => { throw new Error("must not be called"); }) as any;
    const v = new TurnstileVerifier();
    await expect(v.verify("", "tok")).resolves.toEqual({ ok: false, providerError: false });
    await expect(v.verify("secret", "")).resolves.toEqual({ ok: false, providerError: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("success=true → ok; success=false → plain failure; non-200 / network error → providerError", async () => {
    const v = new TurnstileVerifier();
    global.fetch = jest.fn(async () => ({ status: 200, json: async () => ({ success: true }) })) as any;
    await expect(v.verify("s", "t")).resolves.toEqual({ ok: true, providerError: false });
    global.fetch = jest.fn(async () => ({ status: 200, json: async () => ({ success: false }) })) as any;
    await expect(v.verify("s", "t")).resolves.toEqual({ ok: false, providerError: false });
    global.fetch = jest.fn(async () => ({ status: 503, json: async () => ({}) })) as any;
    await expect(v.verify("s", "t")).resolves.toEqual({ ok: false, providerError: true });
    global.fetch = jest.fn(async () => { throw new Error("down"); }) as any;
    await expect(v.verify("s", "t")).resolves.toEqual({ ok: false, providerError: true });
  });
});

// ---------- COD rules (pure) ----------

describe("GB3 evaluateCodRules (pure)", () => {
  const base = { totalMinor: 1000n, district: null, parsedDistrict: null, parsedConfidence: null };
  it("no rules set → refused null + advanceRequired false (parity)", () => {
    expect(evaluateCodRules({}, base)).toEqual({ refused: null, advanceRequired: false, districtUsed: null });
    expect(evaluateCodRules(null, base)).toEqual({ refused: null, advanceRequired: false, districtUsed: null });
  });
  it("max: total > max refuses; equal does not", () => {
    expect(evaluateCodRules({ codMaxOrderMinor: 5000n }, { ...base, totalMinor: 5001n }).refused).toBe("max");
    expect(evaluateCodRules({ codMaxOrderMinor: 5000n }, { ...base, totalMinor: 5000n }).refused).toBeNull();
  });
  it("district via structured district (normalized compare)", () => {
    const r = evaluateCodRules({ codBlockedDistricts: [" Dhaka "] }, { ...base, district: "dhaka" });
    expect(r.refused).toBe("district");
    expect(r.districtUsed).toBe("dhaka");
  });
  it("district via high/medium-confidence parse only — low confidence never blocks", () => {
    const profile = { codBlockedDistricts: ["Khulna"] };
    expect(evaluateCodRules(profile, { ...base, parsedDistrict: "khulna", parsedConfidence: "high" }).refused).toBe("district");
    expect(evaluateCodRules(profile, { ...base, parsedDistrict: "khulna", parsedConfidence: "medium" }).refused).toBe("district");
    const low = evaluateCodRules(profile, { ...base, parsedDistrict: "khulna", parsedConfidence: "low" });
    expect(low.refused).toBeNull();
    expect(low.districtUsed).toBeNull();
  });
  it("advance flag: total > threshold only", () => {
    expect(evaluateCodRules({ codAdvanceRequiredAboveMinor: 1000n }, { ...base, totalMinor: 1500n }).advanceRequired).toBe(true);
    expect(evaluateCodRules({ codAdvanceRequiredAboveMinor: 1000n }, { ...base, totalMinor: 1000n }).advanceRequired).toBe(false);
  });
});

// ---------- fraud rules ----------

describe("GB3 fraud rules at checkout (guard)", () => {
  function seedRule(prisma: any, over: any = {}) {
    const rule = {
      id: "r-1", organizationId: "org-1", name: "বড় COD ব্লক", enabled: true,
      conditions: {}, action: "block_checkout", tagValue: null, createdById: "a",
      createdAt: new Date(), ...over,
    };
    prisma.fraudRule.rows.push(rule);
    return rule;
  }
  const facts = { totalMinor: 150000n, isCod: true, district: null as string | null, openOrderCount: 0, phone: PHONE };

  it("block_checkout matches on total + cod; hit + attempt rows written", async () => {
    const { prisma, guard } = makeWorld();
    seedRule(prisma, { conditions: { minTotalMinor: "100000", isCod: true } });
    const r = await guard.evaluateFraudRulesAtCheckout("org-1", facts);
    expect(r.blockedBy).toEqual({ ruleId: "r-1", name: "বড় COD ব্লক" });
    expect(prisma.fraudRuleHit.rows).toHaveLength(1);
    expect(prisma.fraudRuleHit.rows[0].orderId).toBeNull();
    expect(prisma.fraudRuleHit.rows[0].action).toBe("block_checkout");
    expect(prisma.fraudAttemptLog.rows).toHaveLength(1);
    expect(prisma.fraudAttemptLog.rows[0].kind).toBe("fraud_rule");
    expect(prisma.fraudAttemptLog.rows[0].ruleId).toBe("r-1");
    expect(prisma.fraudAttemptLog.rows[0].identifierSummary).toBe("•••1111");
  });

  it("districtIn and phoneOpenOrdersGte conditions; null district never matches", async () => {
    const { prisma, guard } = makeWorld();
    seedRule(prisma, { conditions: { districtIn: ["Dhaka"] } });
    await expect(guard.evaluateFraudRulesAtCheckout("org-1", { ...facts, district: "dhaka" }))
      .resolves.toEqual({ blockedBy: { ruleId: "r-1", name: "বড় COD ব্লক" } });
    const w2 = makeWorld();
    seedRule(w2.prisma, { conditions: { districtIn: ["Dhaka"] } });
    await expect(w2.guard.evaluateFraudRulesAtCheckout("org-1", { ...facts, district: null }))
      .resolves.toEqual({ blockedBy: null });
    const w3 = makeWorld();
    seedRule(w3.prisma, { conditions: { phoneOpenOrdersGte: 2 } });
    await expect(w3.guard.evaluateFraudRulesAtCheckout("org-1", { ...facts, openOrderCount: 1 }))
      .resolves.toEqual({ blockedBy: null });
    await expect(w3.guard.evaluateFraudRulesAtCheckout("org-1", { ...facts, openOrderCount: 2 }))
      .resolves.toEqual({ blockedBy: { ruleId: "r-1", name: "বড় COD ব্লক" } });
  });

  it("a minRiskScore-only rule does NOT block at checkout", async () => {
    const { prisma, guard } = makeWorld();
    seedRule(prisma, { conditions: { minRiskScore: 80 } });
    await expect(guard.evaluateFraudRulesAtCheckout("org-1", facts)).resolves.toEqual({ blockedBy: null });
    expect(prisma.fraudRuleHit.rows).toHaveLength(0);
    expect(prisma.fraudAttemptLog.rows).toHaveLength(0);
  });
});

describe("GB3 FraudRulesService CRUD + validation", () => {
  it("create validates: tag needs tagValue, unknown condition key is a 400, bad action is a 400", async () => {
    const { rules } = makeWorld();
    await expect(rules.create("org-1", "a", { name: "ট্যাগ নিয়ম", action: "tag", conditions: {} }))
      .rejects.toThrow(/tagValue/);
    await expect(rules.create("org-1", "a", { name: "x", action: "hold", conditions: { nope: 1 } }))
      .rejects.toThrow(/অজানা শর্ত/);
    await expect(rules.create("org-1", "a", { name: "x", action: "explode", conditions: {} }))
      .rejects.toThrow(/action হতে হবে/);
    await expect(rules.create("org-1", "a", { name: "x", action: "hold", conditions: { minTotalMinor: "12a" } }))
      .rejects.toThrow(/minTotalMinor/);
  });

  it("create → list carries hitCount; recordHit never throws; update/delete org-scoped with audit", async () => {
    const { rules, audit, prisma } = makeWorld();
    const row: any = await rules.create("org-1", "actor-1", {
      name: "বড় অর্ডার আটকান", action: "hold", conditions: { minTotalMinor: "100000" },
    });
    expect(row.enabled).toBe(true);
    await rules.recordHit("org-1", row.id, "o-9", "hold");
    await rules.recordHit("org-1", row.id, "o-10", "hold");
    const listed = await rules.list("org-1");
    expect(listed).toHaveLength(1);
    expect(listed[0].hitCount).toBe(2);
    const hits = await rules.listHitsForOrder("org-1", "o-9");
    expect(hits).toHaveLength(1);
    await expect(rules.update("org-2", "a", row.id, { enabled: false })).rejects.toThrow(/not found/i);
    const updated: any = await rules.update("org-1", "a", row.id, { enabled: false });
    expect(updated.enabled).toBe(false);
    await rules.delete("org-1", "a", row.id);
    expect(prisma.fraudRule.rows).toHaveLength(0);
    const actions = (audit.log as jest.Mock).mock.calls.map((c) => c[0].action);
    expect(actions).toContain("orders.fraud_rule_created");
    expect(actions).toContain("orders.fraud_rule_updated");
    expect(actions).toContain("orders.fraud_rule_deleted");
  });
});

// ---------- FraudShield extensions ----------

describe("GB3 FraudShieldService settings extensions", () => {
  it("updateSettings stores the Turnstile secret SEALED; public view shows only turnstileSecretSet", async () => {
    const { prisma, fraud } = makeWorld();
    const pub: any = await fraud.updateSettings("org-1", "actor-1", {
      openOrderPolicy: "block", openOrderWindowHours: 48, waitingPeriodMinutes: 30,
      maxOrdersPerPhonePerDay: 5, captchaEnabled: true, captchaOnOtp: true,
      turnstileSiteKey: "site-key-9", turnstileSecret: "my-secret-value",
    });
    expect(pub.openOrderPolicy).toBe("block");
    expect(pub.openOrderWindowHours).toBe(48);
    expect(pub.waitingPeriodMinutes).toBe(30);
    expect(pub.maxOrdersPerPhonePerDay).toBe(5);
    expect(pub.captchaEnabled).toBe(true);
    expect(pub.captchaOnOtp).toBe(true);
    expect(pub.turnstileSiteKey).toBe("site-key-9");
    expect(pub.turnstileSecretSet).toBe(true);
    expect(JSON.stringify(pub)).not.toContain("my-secret-value");
    const stored = prisma.fraudShieldSetting.rows[0].turnstileSecretEncrypted;
    expect(stored).toBeTruthy();
    expect(String(stored)).not.toContain("my-secret-value");
    // Empty string clears.
    const pub2: any = await fraud.updateSettings("org-1", "actor-1", { turnstileSecret: "" });
    expect(pub2.turnstileSecretSet).toBe(false);
  });

  it("updateSettings validates the GB3 fields with Bengali 400s", async () => {
    const { fraud } = makeWorld();
    await expect(fraud.updateSettings("org-1", "a", { openOrderPolicy: "sometimes" })).rejects.toThrow(/openOrderPolicy/);
    await expect(fraud.updateSettings("org-1", "a", { openOrderWindowHours: 0 })).rejects.toThrow(/openOrderWindowHours/);
    await expect(fraud.updateSettings("org-1", "a", { waitingPeriodMinutes: -1 })).rejects.toThrow(/waitingPeriodMinutes/);
    await expect(fraud.updateSettings("org-1", "a", { maxOrdersPerPhonePerDay: 101 })).rejects.toThrow(/maxOrdersPerPhonePerDay/);
  });
});

describe("GB3 FraudShieldService.assessOrder extensions", () => {
  it("trusted phone stamps 0/low with ONLY the trusted reason — no burst signal even with burst fixtures", async () => {
    const { prisma, fraud, identifiers } = makeWorld();
    const order = seedCustomerOrder(prisma);
    for (let i = 0; i < 3; i++) {
      prisma.order.rows.push({
        id: `o-b${i}`, organizationId: "org-1", customerId: `c-b${i}`,
        customer: { id: `c-b${i}`, firstName: "Rahim", lastName: "Uddin", phone: "+8801711111111" },
        status: "pending", isCod: true, isPractice: false, totalMinor: 1000n, createdAt: new Date(),
      });
    }
    await identifiers.add("org-1", "a", "trusted", { kind: "phone", value: PHONE });
    const r: any = await fraud.assessOrder("org-1", "o-1");
    expect(r.score).toBe(0);
    expect(r.band).toBe("low");
    expect(r.reasons).toEqual([{ key: "trusted_phone", label: "বিশ্বস্ত তালিকাভুক্ত নম্বর", points: 0 }]);
    expect(r.reviewHold).toBe(false);
    expect(order.riskScore).toBe(0);
    expect(order.riskBand).toBe("low");
    expect(order.reviewHold).toBe(false);
  });

  it("open-order policy warn holds a second open order with the exact Bengali reason", async () => {
    const { prisma, fraud } = makeWorld({ setting: { openOrderPolicy: "warn" } });
    const order = seedCustomerOrder(prisma);
    prisma.order.rows.push({
      id: "o-2", organizationId: "org-1", customerId: "c-1",
      customer: { id: "c-1", firstName: "Rahim", lastName: "Uddin", phone: PHONE },
      status: "processing", isCod: true, isPractice: false, totalMinor: 500n, createdAt: new Date(),
    });
    const r: any = await fraud.assessOrder("org-1", "o-1");
    expect(r.reviewHold).toBe(true);
    expect(order.reviewHold).toBe(true);
    expect(order.reviewHoldReason).toBe("একই নম্বরে খোলা অর্ডার আছে");
  });

  it("fraud rules post-placement: hold + tag fire, hits recorded", async () => {
    const { prisma, fraud } = makeWorld();
    const order = seedCustomerOrder(prisma);
    prisma.fraudRule.rows.push(
      { id: "r-hold", organizationId: "org-1", name: "বড় অর্ডার যাচাই", enabled: true, action: "hold", tagValue: null, conditions: { minTotalMinor: "500" }, createdAt: new Date() },
      { id: "r-tag", organizationId: "org-1", name: "COD ট্যাগ", enabled: true, action: "tag", tagValue: "cod-check", conditions: { isCod: true }, createdAt: new Date() },
    );
    const r: any = await fraud.assessOrder("org-1", "o-1");
    expect(r.reviewHold).toBe(true);
    expect(order.reviewHoldReason).toBe("নিয়ম: বড় অর্ডার যাচাই");
    expect(order.tags).toEqual(["cod-check"]);
    expect(prisma.fraudRuleHit.rows).toHaveLength(2);
    expect(prisma.fraudRuleHit.rows.map((h: any) => h.ruleId).sort()).toEqual(["r-hold", "r-tag"]);
    expect(prisma.fraudRuleHit.rows.every((h: any) => h.orderId === "o-1")).toBe(true);
  });

  it("minRiskScore rules fire post-placement against the computed score", async () => {
    const { prisma, fraud } = makeWorld({ riskResult: { band: "high", score: 90 } });
    const order = seedCustomerOrder(prisma);
    prisma.fraudRule.rows.push(
      { id: "r-score", organizationId: "org-1", name: "ঝুঁকি আটকান", enabled: true, action: "hold", tagValue: null, conditions: { minRiskScore: 30 }, createdAt: new Date() },
    );
    const r: any = await fraud.assessOrder("org-1", "o-1");
    expect(r.score).toBe(35); // history_band high weight
    expect(order.reviewHold).toBe(true);
    expect(order.reviewHoldReason).toBe("নিয়ম: ঝুঁকি আটকান");
    expect(prisma.fraudRuleHit.rows).toHaveLength(1);
  });

  it("a BlockedIdentifier phone entry counts as blocked for the score (100/high + force hold)", async () => {
    const { prisma, fraud, identifiers } = makeWorld();
    const order = seedCustomerOrder(prisma);
    await identifiers.add("org-1", "a", "blocked", { kind: "phone", value: PHONE });
    const r: any = await fraud.assessOrder("org-1", "o-1");
    expect(r.score).toBe(100);
    expect(r.band).toBe("high");
    expect(order.reviewHold).toBe(true);
    expect(order.reviewHoldReason).toBe("ব্লকলিস্টে থাকা ফোন নম্বর থেকে অর্ডার");
  });
});
