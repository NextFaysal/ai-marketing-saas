import { SyncOutboxService, MAX_ATTEMPTS, backoffSeconds } from "./sync-outbox.service";
import { CommerceAdapterRegistry, NativeAdapter } from "../integrations/commerce/adapters";
import { CAPABILITY_NOT_IMPLEMENTED } from "../integrations/commerce/adapter";

function matches(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      // support {in: [...]}
      if ("in" in (v as any)) return (v as any).in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}

function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, orderBy, skip, take }: any = {}) => {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "asc") out = [...out].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (orderBy?.createdAt === "desc") out = [...out].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (typeof skip === "number") out = out.slice(skip);
      if (typeof take === "number") out = out.slice(0, take);
      return out;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `id-${++seq}`, createdAt: new Date(Date.now() + seq), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
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
    syncOutbox: makeTable(),
    store: makeTable(),
    integration: makeTable(),
  } as any;
}

function testAdapter(behavior: "ok" | "fail" | "throw" = "ok") {
  return {
    platform: "test",
    capabilities: { register_webhooks: true },
    execute: async () => {
      if (behavior === "throw") throw new Error("adapter exploded verbatim");
      if (behavior === "fail") return { ok: false, error: "temporary boom" };
      return { ok: true, responseSummary: { echoed: true } };
    },
  } as any;
}

async function seedStore(prisma: any, id: string, org: string, platform: string) {
  prisma.store.rows.push({ id, organizationId: org, platform, url: "https://shop.example.com", name: "Shop" });
}

describe("SyncOutboxService", () => {
  it("backoff is capped exponential", () => {
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(2)).toBe(60);
    expect(backoffSeconds(10)).toBe(3600);
    expect(MAX_ATTEMPTS).toBe(5);
  });

  it("enqueue -> process -> done cycle with test adapter", async () => {
    const prisma = fakePrisma();
    await seedStore(prisma, "store-1", "org-1", "TEST");
    const registry = new CommerceAdapterRegistry();
    registry.register(testAdapter("ok"));
    const svc = new SyncOutboxService(prisma, registry);
    const enq = await svc.enqueue({ organizationId: "org-1", storeId: "store-1", entityType: "product", entityId: "p1", operation: "push_product", payload: { name: "X" } });
    expect(enq.status).toBe("pending");
    const res = await svc.processDue({ organizationId: "org-1" });
    expect(res).toEqual({ processed: 1, done: 1, failed: 0, dead: 0 });
    const row = prisma.syncOutbox.rows[0];
    expect(row.status).toBe("done");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBeNull();
    expect(row.responseSummary).toEqual({ echoed: true });
  });

  it("dedupes on same idempotency key", async () => {
    const prisma = fakePrisma();
    await seedStore(prisma, "store-1", "org-1", "TEST");
    const registry = new CommerceAdapterRegistry();
    registry.register(testAdapter("ok"));
    const svc = new SyncOutboxService(prisma, registry);
    const a = await svc.enqueue({ organizationId: "org-1", storeId: "store-1", entityType: "product", entityId: "p1", operation: "push_product", payload: { a: 1 }, idempotencyKey: "key-1" });
    const b = await svc.enqueue({ organizationId: "org-1", storeId: "store-1", entityType: "product", entityId: "p1", operation: "push_product", payload: { a: 1 }, idempotencyKey: "key-1" });
    expect(b.id).toBe(a.id);
    expect(prisma.syncOutbox.rows).toHaveLength(1);
    // Also dedupe via derived key (same payload)
    const c = await svc.enqueue({ organizationId: "org-1", storeId: "store-1", entityType: "order", entityId: "o1", operation: "push_order_status", payload: { s: "x" } });
    const d = await svc.enqueue({ organizationId: "org-1", storeId: "store-1", entityType: "order", entityId: "o1", operation: "push_order_status", payload: { s: "x" } });
    expect(d.id).toBe(c.id);
  });

  it("capability_not_implemented via NativeAdapter -> failed, nextRetryAt null", async () => {
    const prisma = fakePrisma();
    await seedStore(prisma, "store-1", "org-1", "CUSTOM");
    const registry = new CommerceAdapterRegistry(); // native already registered
    const svc = new SyncOutboxService(prisma, registry);
    await svc.enqueue({ organizationId: "org-1", storeId: "store-1", entityType: "product", entityId: "p1", operation: "push_product", payload: {} });
    const res = await svc.processDue({ organizationId: "org-1" });
    expect(res.failed).toBe(1);
    const row = prisma.syncOutbox.rows[0];
    expect(row.status).toBe("failed");
    expect(row.lastError).toBe(CAPABILITY_NOT_IMPLEMENTED);
    expect(row.nextRetryAt).toBeNull();
  });

  it("transient failure gets backoff, then dead after max attempts (pre-seeded attempts=4)", async () => {
    const prisma = fakePrisma();
    await seedStore(prisma, "store-1", "org-1", "TEST");
    const registry = new CommerceAdapterRegistry();
    registry.register(testAdapter("fail"));
    const svc = new SyncOutboxService(prisma, registry);
    const now = new Date("2026-10-13T00:00:00.000Z");
    const enq = await svc.enqueue({ organizationId: "org-1", storeId: "store-1", entityType: "product", entityId: "p1", operation: "push_product", payload: {} });
    // first failure: attempts 1, failed with backoff 30s
    const r1 = await svc.processDue({ organizationId: "org-1", now });
    expect(r1.failed).toBe(1);
    expect(prisma.syncOutbox.rows[0].status).toBe("failed");
    expect(new Date(prisma.syncOutbox.rows[0].nextRetryAt).getTime() - now.getTime()).toBe(30_000);
    // pre-seed attempts=4 then process after retry time -> dead
    prisma.syncOutbox.rows[0].attempts = 4;
    const later = new Date(now.getTime() + 60_000);
    const r2 = await svc.processDue({ organizationId: "org-1", now: later });
    expect(r2.dead).toBe(1);
    expect(prisma.syncOutbox.rows[0].status).toBe("dead");
    expect(enq.id).toBe(prisma.syncOutbox.rows[0].id);
  });

  it("adapter throw is recorded verbatim", async () => {
    const prisma = fakePrisma();
    await seedStore(prisma, "store-1", "org-1", "TEST");
    const registry = new CommerceAdapterRegistry();
    registry.register(testAdapter("throw"));
    const svc = new SyncOutboxService(prisma, registry);
    await svc.enqueue({ organizationId: "org-1", storeId: "store-1", entityType: "product", entityId: "p1", operation: "push_product", payload: {} });
    await svc.processDue({ organizationId: "org-1" });
    expect(prisma.syncOutbox.rows[0].lastError).toBe("adapter exploded verbatim");
  });

  it("replay resets a dead item", async () => {
    const prisma = fakePrisma();
    await seedStore(prisma, "store-1", "org-1", "TEST");
    const registry = new CommerceAdapterRegistry();
    registry.register(testAdapter("ok"));
    const svc = new SyncOutboxService(prisma, registry);
    const enq = await svc.enqueue({ organizationId: "org-1", storeId: "store-1", entityType: "product", entityId: "p1", operation: "push_product", payload: {} });
    prisma.syncOutbox.rows[0].status = "dead";
    prisma.syncOutbox.rows[0].attempts = 5;
    prisma.syncOutbox.rows[0].lastError = "boom";
    const replayed = await svc.replay("org-1", enq.id);
    expect(replayed.status).toBe("pending");
    expect(replayed.attempts).toBe(0);
    expect(replayed.lastError).toBeNull();
    expect(replayed.nextRetryAt).toBeTruthy();
  });

  it("tenant isolation: replay/list of another org invisible", async () => {
    const prisma = fakePrisma();
    await seedStore(prisma, "store-1", "org-1", "TEST");
    const registry = new CommerceAdapterRegistry();
    registry.register(testAdapter("ok"));
    const svc = new SyncOutboxService(prisma, registry);
    const enq = await svc.enqueue({ organizationId: "org-1", storeId: "store-1", entityType: "product", entityId: "p1", operation: "push_product", payload: {} });
    prisma.syncOutbox.rows[0].status = "failed";
    await expect(svc.replay("org-2", enq.id)).rejects.toThrow();
    const list2 = await svc.list("org-2", {});
    expect(list2.total).toBe(0);
    const list1 = await svc.list("org-1", {});
    expect(list1.total).toBe(1);
  });

  it("per-store cap 20 respected", async () => {
    const prisma = fakePrisma();
    await seedStore(prisma, "store-1", "org-1", "TEST");
    const registry = new CommerceAdapterRegistry();
    registry.register(testAdapter("ok"));
    const svc = new SyncOutboxService(prisma, registry);
    for (let i = 0; i < 25; i++) {
      await svc.enqueue({ organizationId: "org-1", storeId: "store-1", entityType: "product", entityId: `p${i}`, operation: "push_product", payload: { i }, idempotencyKey: `k-${i}` });
    }
    const res = await svc.processDue({ organizationId: "org-1", limit: 50 });
    expect(res.processed).toBe(20);
    expect(prisma.syncOutbox.rows.filter((r: any) => r.status === "done")).toHaveLength(20);
    expect(prisma.syncOutbox.rows.filter((r: any) => r.status === "pending")).toHaveLength(5);
  });

  it("replay refuses non-failed/dead", async () => {
    const prisma = fakePrisma();
    const registry = new CommerceAdapterRegistry();
    const svc = new SyncOutboxService(prisma, registry);
    const enq = await svc.enqueue({ organizationId: "org-1", storeId: "store-1", entityType: "product", entityId: "p1", operation: "push_product", payload: {} });
    await expect(svc.replay("org-1", enq.id)).rejects.toThrow();
  });
});
