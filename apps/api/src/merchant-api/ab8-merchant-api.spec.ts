import { BadRequestException, ForbiddenException, HttpException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { MerchantApiService, hashMerchantApiKey, validateScopes, MERCHANT_API_SCOPES } from "./merchant-api.service";
import { MerchantApiKeyGuard, requireScope } from "./merchant-api.guard";
import { MerchantApiController } from "./merchant-api.controller";
import { MerchantApiKeysController } from "./merchant-api-keys.controller";
import { assertWithinApiDailyLimit, incrementApiUsage, apiUsageToday } from "../common/api-usage";
import { todayDhakaKey } from "../common/plan-limit-checks";
import { PublicDocsService, MERCHANT_API_ROUTES } from "../public-docs/public-docs.service";

/**
 * AB8 (AX21) — Merchant Developer API.
 *
 * Fake-prisma + real service / guard / controllers. Covers:
 * plaintext-once + hash-only storage, authenticate ok / revoked /
 * unknown, throttled lastUsedAt, scope validation, guard 401 /
 * scope 403 naming the scope / daily-limit 429, ApiUsageDaily
 * increments, controller delegation with the KEY's org (foreign
 * product 404 propagates), customers page slicing, staff key CRUD
 * (foreign revoke 404), audit without secrets, and the OpenAPI
 * Merchant API section staying OUTSIDE the frozen public paths.
 */

function makePrisma(opts: { apiDailyLimit?: number; usageToday?: number } = {}) {
  const keyRows: any[] = [];
  let seq = 0;
  let updateCalls = 0;
  const usageRows = new Map<string, any>();
  const day = todayDhakaKey();
  if (opts.usageToday != null) {
    usageRows.set(`org-1|${day}`, { organizationId: "org-1", day, count: opts.usageToday });
  }
  const matches = (row: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => row[k] === v);
  const upsertCalls: any[] = [];
  const prisma: any = {
    _keyRows: keyRows,
    _usageRows: usageRows,
    _upsertCalls: upsertCalls,
    get _updateCalls() { return updateCalls; },
    merchantApiKey: {
      create: async ({ data }: any) => {
        const row = { id: `mk-${++seq}`, createdAt: new Date(), lastUsedAt: null, ...data };
        keyRows.push(row);
        return row;
      },
      findMany: async ({ where }: any = {}) =>
        keyRows.filter((r) => matches(r, where)).slice().reverse(),
      findFirst: async ({ where }: any) => keyRows.find((r) => matches(r, where)) ?? null,
      update: async ({ where, data }: any) => {
        updateCalls++;
        const row = keyRows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    apiUsageDaily: {
      findUnique: async ({ where }: any) => {
        const { organizationId, day: d } = where.organizationId_day;
        return usageRows.get(`${organizationId}|${d}`) ?? null;
      },
      upsert: async (args: any) => {
        upsertCalls.push(args);
        const { organizationId, day: d } = args.where.organizationId_day;
        const k = `${organizationId}|${d}`;
        const existing = usageRows.get(k);
        if (existing) {
          existing.count += args.update?.count?.increment ?? 0;
          return existing;
        }
        const row = { ...args.create };
        usageRows.set(k, row);
        return row;
      },
    },
    systemSetting: {
      findUnique: async ({ where }: any) => {
        if (where.key === "planLimits" && opts.apiDailyLimit != null) {
          return { key: where.key, value: { GROWTH: { apiDailyLimit: opts.apiDailyLimit } } };
        }
        return null;
      },
    },
    subscription: {
      findFirst: async () => ({ id: "sub-1", organizationId: "org-1", plan: "GROWTH", status: "ACTIVE", createdAt: new Date() }),
    },
  };
  return prisma;
}

function makeAudit() {
  const logs: any[] = [];
  return { _logs: logs, log: async (input: any) => { logs.push(input); } };
}

function ctxFor(req: any): any {
  return { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null };
}

function reqWith(scopes: string[], extra: any = {}) {
  return { merchantApi: { orgId: "org-1", keyId: "mk-1", scopes, createdById: "user-1" }, ...extra };
}

describe("AB8 MerchantApiService — key lifecycle", () => {
  it("create returns the plaintext ONCE; only its SHA-256 hash is stored; keyPrefix is the random segment's first 8", async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    const svc = new MerchantApiService(prisma, audit as any);
    const { key, record } = await svc.createKey("org-1", "user-1", { name: "Zapier", scopes: ["products:read", "orders:read"] });

    expect(key.startsWith("qk_live_")).toBe(true);
    expect(key.length).toBe("qk_live_".length + 43);
    const stored = prisma._keyRows[0];
    expect(stored.keyHash).toBe(hashMerchantApiKey(key));
    expect(JSON.stringify(stored)).not.toContain(key);
    expect(record).not.toHaveProperty("keyHash");
    // Compromise documented in the service: keyPrefix = first 8 of
    // the random segment (token chars 8..16), displayed qk_live_<prefix>…
    expect(record.keyPrefix).toBe(key.slice(8, 16));
    expect(record.scopes).toEqual(["products:read", "orders:read"]);
    expect(record.status).toBe("active");

    // Audited — with name + scopes, NEVER the token or hash.
    expect(audit._logs).toHaveLength(1);
    expect(audit._logs[0]).toMatchObject({
      organizationId: "org-1", userId: "user-1",
      action: "merchant_api_key.create", entityType: "MerchantApiKey", entityId: record.id,
      metadata: { name: "Zapier", scopes: ["products:read", "orders:read"] },
    });
    expect(JSON.stringify(audit._logs)).not.toContain(key);
    expect(JSON.stringify(audit._logs)).not.toContain(stored.keyHash);
  });

  it("authenticate resolves an active key, stamps lastUsedAt THROTTLED (60s), and returns null for unknown / wrong-format tokens", async () => {
    const prisma = makePrisma();
    const svc = new MerchantApiService(prisma, makeAudit() as any);
    const { key, record } = await svc.createKey("org-1", "user-1", { name: "K", scopes: ["products:read"] });

    const auth = await svc.authenticate(key);
    expect(auth).toEqual({ organizationId: "org-1", keyId: record.id, scopes: ["products:read"], createdById: "user-1" });
    expect(prisma._keyRows[0].lastUsedAt).toBeInstanceOf(Date);
    const callsAfterFirst = prisma._updateCalls;
    // Immediate second authenticate: throttled, no new stamp write.
    await svc.authenticate(key);
    expect(prisma._updateCalls).toBe(callsAfterFirst);
    // A stamp older than 60s is refreshed.
    prisma._keyRows[0].lastUsedAt = new Date(Date.now() - 61_000);
    await svc.authenticate(key);
    expect(prisma._updateCalls).toBe(callsAfterFirst + 1);

    expect(await svc.authenticate("qk_live_doesnotexist")).toBeNull();
    expect(await svc.authenticate("sk_live_123")).toBeNull();
    expect(await svc.authenticate(undefined)).toBeNull();
  });

  it("revoked keys no longer authenticate; revoke is audited and idempotent", async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    const svc = new MerchantApiService(prisma, audit as any);
    const { key, record } = await svc.createKey("org-1", "user-1", { name: "K", scopes: ["orders:read"] });
    const revoked = await svc.revokeKey("org-1", record.id, "user-1");
    expect(revoked.status).toBe("revoked");
    expect(await svc.authenticate(key)).toBeNull();
    expect(audit._logs.map((l: any) => l.action)).toEqual(["merchant_api_key.create", "merchant_api_key.revoke"]);
    const again = await svc.revokeKey("org-1", record.id, "user-1");
    expect(again.status).toBe("revoked");
  });

  it("listKeys is org-scoped, newest first, capped, and hash-free", async () => {
    const prisma = makePrisma();
    const svc = new MerchantApiService(prisma, makeAudit() as any);
    await svc.createKey("org-1", "user-1", { name: "A", scopes: ["products:read"] });
    await svc.createKey("org-2", "user-9", { name: "B", scopes: ["products:read"] });
    const list = await svc.listKeys("org-1");
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("A");
    expect(JSON.stringify(list)).not.toContain("keyHash");
  });
});

describe("AB8 scope validation", () => {
  it("rejects an unknown scope with a 400 listing the allowed scopes", async () => {
    const svc = new MerchantApiService(makePrisma(), makeAudit() as any);
    const err = await svc.createKey("org-1", "user-1", { name: "K", scopes: ["products:read", "admin:all"] }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    for (const s of MERCHANT_API_SCOPES) expect(err.message).toContain(s);
    expect(err.message).toContain("admin:all");
  });

  it("rejects empty / missing scopes; dedupes valid ones", async () => {
    expect(() => validateScopes([])).toThrow(BadRequestException);
    expect(() => validateScopes(undefined)).toThrow(BadRequestException);
    expect(() => validateScopes("products:read")).toThrow(BadRequestException);
    expect(validateScopes(["orders:read", "orders:read", "products:read"])).toEqual(["orders:read", "products:read"]);
  });

  it("requireScope throws a 403 naming the missing scope", () => {
    expect(() => requireScope(reqWith(["orders:read"]), "products:read")).toThrow(ForbiddenException);
    try {
      requireScope(reqWith(["orders:read"]), "products:read");
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(e.message).toContain("products:read");
      expect(e.message).toContain("scope");
    }
    expect(() => requireScope(reqWith(["products:read"]), "products:read")).not.toThrow();
  });
});

describe("AB8 api-usage helper", () => {
  it("incrementApiUsage upserts today's Dhaka row and increments; apiUsageToday reads it back", async () => {
    const prisma = makePrisma();
    await incrementApiUsage(prisma, "org-1");
    await incrementApiUsage(prisma, "org-1");
    expect(prisma._upsertCalls).toHaveLength(2);
    expect(prisma._upsertCalls[0].where.organizationId_day.day).toBe(todayDhakaKey());
    expect(await apiUsageToday(prisma, "org-1")).toBe(2);
    expect(await apiUsageToday(prisma, "org-other")).toBe(0);
  });

  it("increment/read are fully failure-isolated", async () => {
    const broken: any = { apiUsageDaily: { upsert: async () => { throw new Error("db down"); }, findUnique: async () => { throw new Error("db down"); } } };
    await expect(incrementApiUsage(broken, "org-1")).resolves.toBeUndefined();
    await expect(apiUsageToday(broken, "org-1")).resolves.toBe(0);
    await expect(incrementApiUsage({}, "org-1")).resolves.toBeUndefined();
  });

  it("assertWithinApiDailyLimit: below limit passes, at limit throws 429 naming the limit, no limit = unlimited, broken reads allow", async () => {
    await expect(assertWithinApiDailyLimit(makePrisma({ apiDailyLimit: 3, usageToday: 2 }), "org-1")).resolves.toBeUndefined();
    const err = await assertWithinApiDailyLimit(makePrisma({ apiDailyLimit: 3, usageToday: 3 }), "org-1").catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(err.message).toContain("3");
    expect(err.message).toContain("দৈনিক");
    await expect(assertWithinApiDailyLimit(makePrisma({ usageToday: 9999 }), "org-1")).resolves.toBeUndefined();
    await expect(assertWithinApiDailyLimit({}, "org-1")).resolves.toBeUndefined();
  });
});

describe("AB8 MerchantApiKeyGuard", () => {
  async function setup(opts: { apiDailyLimit?: number; usageToday?: number } = {}) {
    const prisma = makePrisma(opts);
    const svc = new MerchantApiService(prisma, makeAudit() as any);
    const { key } = await svc.createKey("org-1", "user-1", { name: "K", scopes: ["products:read"] });
    const guard = new MerchantApiKeyGuard(svc, prisma);
    return { prisma, svc, key, guard };
  }

  it("missing token → 401", async () => {
    const { guard } = await setup();
    const err = await guard.canActivate(ctxFor({ headers: {} })).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.getStatus()).toBe(401);
  });

  it("revoked token → 401 (via the guard)", async () => {
    const { guard, svc, key, prisma } = await setup();
    const record = prisma._keyRows[0];
    await svc.revokeKey("org-1", record.id);
    const req = { headers: { authorization: `Bearer ${key}` } };
    const err = await guard.canActivate(ctxFor(req)).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.getStatus()).toBe(401);
  });

  it("valid Bearer token passes, attaches req.merchantApi from the KEY, and increments ApiUsageDaily; x-merchant-api-key header also works", async () => {
    const { guard, key, prisma } = await setup();
    const req: any = { headers: { authorization: `Bearer ${key}` } };
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.merchantApi).toEqual({ orgId: "org-1", keyId: prisma._keyRows[0].id, scopes: ["products:read"], createdById: "user-1" });
    expect(await apiUsageToday(prisma, "org-1")).toBe(1);

    const req2: any = { headers: { "x-merchant-api-key": key } };
    await expect(guard.canActivate(ctxFor(req2))).resolves.toBe(true);
    expect(await apiUsageToday(prisma, "org-1")).toBe(2);
  });

  it("daily limit reached → 429 BEFORE the handler, and no usage increment is counted for the refused call", async () => {
    const { guard, key, prisma } = await setup({ apiDailyLimit: 2, usageToday: 2 });
    const req: any = { headers: { authorization: `Bearer ${key}` } };
    const err = await guard.canActivate(ctxFor(req)).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(req.merchantApi).toBeUndefined();
    expect(await apiUsageToday(prisma, "org-1")).toBe(2);
  });
});

describe("AB8 MerchantApiController — delegation with the key's org", () => {
  function fakes() {
    const calls: any[] = [];
    const products: any = {
      list: async (org: string, q: any) => { calls.push(["products.list", org, q]); return { total: 0, items: [] }; },
      getOne: async (org: string, id: string) => {
        calls.push(["products.getOne", org, id]);
        if (id === "foreign-prod") throw new NotFoundException("Product not found in this organization");
        return { id, organizationId: org };
      },
      create: async (org: string, actor: string, dto: any) => { calls.push(["products.create", org, actor, dto]); return { id: "p-new" }; },
      update: async (org: string, actor: string, id: string, dto: any) => { calls.push(["products.update", org, actor, id, dto]); return { id }; },
    };
    const orders: any = {
      list: async (org: string, q: any) => { calls.push(["orders.list", org, q]); return { total: 0, items: [] }; },
      getOne: async (org: string, id: string) => { calls.push(["orders.getOne", org, id]); return { id }; },
    };
    const customers: any = {
      list: async (org: string, search?: string) => {
        calls.push(["customers.list", org, search]);
        return [1, 2, 3, 4, 5].map((n) => ({ id: `c-${n}` }));
      },
      detail: async (org: string, id: string) => { calls.push(["customers.detail", org, id]); return { customer: { id } }; },
    };
    return { calls, products, orders, customers };
  }

  it("GET products delegates with the KEY's org and parsed paging; a foreign product id 404s from the service (called with the key's org, never a client org)", async () => {
    const { calls, products, orders, customers } = fakes();
    const ctl = new MerchantApiController(products, orders, customers);
    await ctl.listProducts(reqWith(["products:read"]), { page: "2", pageSize: "5", search: "hat", status: "ACTIVE" });
    expect(calls[0]).toEqual(["products.list", "org-1", { page: 2, pageSize: 5, search: "hat", status: "ACTIVE" }]);

    const err = await ctl.getProduct(reqWith(["products:read"]), "foreign-prod").catch((e: any) => e);
    // The service was asked for org-1 (the key's org) — the 404 is
    // its tenant-scope verdict, propagated unchanged.
    expect(calls[1]).toEqual(["products.getOne", "org-1", "foreign-prod"]);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.getStatus()).toBe(404);
  });

  it("POST/PATCH products delegate with the key's org + the key creator as actor", async () => {
    const { calls, products, orders, customers } = fakes();
    const ctl = new MerchantApiController(products, orders, customers);
    const dto: any = { name: "Hat", price: "100.00" };
    await ctl.createProduct(reqWith(["products:write"]), dto);
    expect(calls[0]).toEqual(["products.create", "org-1", "user-1", dto]);
    await ctl.updateProduct(reqWith(["products:write"]), "p-1", { name: "Cap" } as any);
    expect(calls[1]).toEqual(["products.update", "org-1", "user-1", "p-1", { name: "Cap" }]);
  });

  it("orders list maps from/to → dateFrom/dateTo and delegates with the key's org", async () => {
    const { calls, products, orders, customers } = fakes();
    const ctl = new MerchantApiController(products, orders, customers);
    await ctl.listOrders(reqWith(["orders:read"]), { status: "pending", from: "2026-10-01", to: "2026-10-16", page: "1", pageSize: "10" });
    expect(calls[0]).toEqual(["orders.list", "org-1", { status: "pending", dateFrom: "2026-10-01", dateTo: "2026-10-16", page: 1, pageSize: 10 }]);
    await ctl.getOrder(reqWith(["orders:read"]), "o-1");
    expect(calls[1]).toEqual(["orders.getOne", "org-1", "o-1"]);
  });

  it("customers list slices page/pageSize over the service's items and reports its total; detail delegates", async () => {
    const { calls, products, orders, customers } = fakes();
    const ctl = new MerchantApiController(products, orders, customers);
    const out = await ctl.listCustomers(reqWith(["customers:read"]), { page: "2", pageSize: "2" });
    expect(calls[0]).toEqual(["customers.list", "org-1", undefined]);
    expect(out.total).toBe(5);
    expect(out.page).toBe(2);
    expect(out.pageSize).toBe(2);
    expect(out.items.map((c: any) => c.id)).toEqual(["c-3", "c-4"]);
    await ctl.getCustomer(reqWith(["customers:read"]), "c-1");
    expect(calls[1]).toEqual(["customers.detail", "org-1", "c-1"]);
  });

  it("scope denial: a key without the route's scope gets a 403 naming the scope, and the service is never called", async () => {
    const { calls, products, orders, customers } = fakes();
    const ctl = new MerchantApiController(products, orders, customers);
    // listProducts throws synchronously (it is not an async method).
    const err: any = (() => { try { return ctl.listProducts(reqWith(["orders:read"]), {}); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getStatus()).toBe(403);
    expect(err.message).toContain("products:read");
    expect(calls).toHaveLength(0);
  });
});

describe("AB8 staff key controller", () => {
  it("create returns the plaintext once; revoking a FOREIGN org's key 404s; own-org revoke works", async () => {
    const prisma = makePrisma();
    const svc = new MerchantApiService(prisma, makeAudit() as any);
    const ctl = new MerchantApiKeysController(svc);
    const user: any = { userId: "user-1", email: "a@b.c", isSuperAdmin: false };

    const created = await ctl.create(user, "org-1", { name: "Integration", scopes: ["products:read"] } as any);
    expect(created.key.startsWith("qk_live_")).toBe(true);
    expect(created.record).not.toHaveProperty("keyHash");

    const err = await ctl.revoke(user, "org-2", created.record.id).catch((e: any) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.getStatus()).toBe(404);
    // Still active for its own org after the foreign attempt.
    expect(await svc.authenticate(created.key)).not.toBeNull();

    const revoked = await ctl.revoke(user, "org-1", created.record.id);
    expect(revoked.status).toBe("revoked");
    const list = await ctl.list("org-1");
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("revoked");
  });
});

describe("AB8 OpenAPI Merchant API section", () => {
  it("documents every /v1/merchant route with the bearer scheme + scopes, OUTSIDE the frozen public paths", () => {
    const doc = new PublicDocsService().buildOpenApiDoc();
    const section = doc["x-merchant-api"];
    expect(section).toBeTruthy();
    expect(section.description).toContain("frozen");
    expect(section.description).toContain("PUBLIC");
    expect(doc.components.securitySchemes.MerchantApiKeyAuth).toMatchObject({ type: "http", scheme: "bearer" });
    const documented = Object.entries<any>(section.paths).flatMap(([path, ops]) =>
      Object.keys(ops).map((m) => `${m} ${path}`),
    );
    expect(documented.sort()).toEqual(MERCHANT_API_ROUTES.map((r) => `${r.method} ${r.path}`).sort());
    for (const [, ops] of Object.entries<any>(section.paths)) {
      for (const op of Object.values<any>(ops)) {
        expect(op.security[0].MerchantApiKeyAuth).toHaveLength(1);
        expect(MERCHANT_API_SCOPES).toContain(op.security[0].MerchantApiKeyAuth[0]);
      }
    }
    // The frozen public inventory is untouched: no merchant path
    // leaks into the introspected public `paths`.
    expect(Object.keys(doc.paths).some((p) => p.startsWith("/v1/merchant"))).toBe(false);
    expect(doc.info.description).toContain("Merchant API");
  });
});
